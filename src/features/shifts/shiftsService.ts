import { z } from 'zod';

import { supabase } from '../../lib/supabase';

/**
 * Normalized error shape returned by every function in this module — same
 * pattern as `authService.ts` (PGM-16/17). Never carries raw Supabase error
 * payloads, only a stable `code` and a user-facing `message`.
 */
export interface ShiftsServiceError {
  code: string;
  message: string;
}

export type ShiftsResult<T> =
  | { data: T; error: null }
  | { data: null; error: ShiftsServiceError };

export type ShiftStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface Shift {
  id: string;
  familyId: string;
  caredPersonId: string | null;
  /**
   * Nombre de la persona cuidada de este turno, si tiene una `cared_person_id`
   * asociada y pudimos resolverla. `null` si el turno no tiene persona
   * cuidada asignada, o si no pudimos resolver el nombre (ver NOTES del
   * agente que implementó PGM-26 sobre este gap).
   */
  caredPersonName: string | null;
  assignedTo: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  createdBy: string;
  createdAt: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Miembro de familia mínimo, tal como lo devuelve la RPC `list_family_members`
 * (PGM-27, `supabase/migrations/20260914140000_list_family_members_rpc.sql`).
 * Sin nombre real -- ver GAP DE PRODUCTO documentado en `assignedToLabel.ts`.
 * `userId` se resuelve a un label mostrable con `getAssignedToLabel` (mismo
 * criterio que el resto del calendario), `role` permite distinguir entradas
 * en el picker de asignación sin inventar un nombre.
 */
export interface FamilyMember {
  userId: string;
  role: 'admin' | 'cuidador';
}

export interface CreateShiftInput {
  familyId: string;
  assignedTo: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * Fuera de alcance de la UI de PGM-27 (ver NOTES del agente) -- la tabla
   * permite `cared_person_id` nulo, así que se acepta acá por completitud del
   * service, pero `ShiftFormScreen` no lo expone todavía.
   */
  caredPersonId?: string | null;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos cargar los turnos. Intentá de nuevo.';
const GENERIC_WRITE_ERROR_MESSAGE = 'No pudimos guardar el turno. Intentá de nuevo.';

const shiftStatusSchema = z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']);

const familyMemberRowSchema = z.object({
  user_id: z.string(),
  role: z.enum(['admin', 'cuidador']),
});

const SHIFT_SELECT_COLUMNS =
  'id, family_id, cared_person_id, assigned_to, starts_at, ends_at, status, created_by, created_at';

/**
 * Valida cada fila cruda que devuelve Supabase antes de confiar en su forma
 * — nunca asumimos que una respuesta externa (aunque venga de nuestra propia
 * DB) tiene el shape esperado.
 */
const shiftRowSchema = z.object({
  id: z.string(),
  family_id: z.string(),
  cared_person_id: z.string().nullable(),
  assigned_to: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: shiftStatusSchema,
  created_by: z.string(),
  created_at: z.string(),
});

type ShiftRow = z.infer<typeof shiftRowSchema>;

function normalizeUnexpectedError(context: string, _err: unknown): ShiftsServiceError {
  // Never surface the raw error — it may wrap a network response or other
  // sensitive request/response data. Log only a non-sensitive marker.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[shiftsService] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
}

function mapShiftRow(row: ShiftRow, caredPersonNamesById: ReadonlyMap<string, string>): Shift {
  return {
    id: row.id,
    familyId: row.family_id,
    caredPersonId: row.cared_person_id,
    caredPersonName: row.cared_person_id
      ? caredPersonNamesById.get(row.cared_person_id) ?? null
      : null,
    assignedTo: row.assigned_to,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Busca los nombres de las `cared_persons` referenciadas por un lote de
 * turnos, para poder mostrar de qué persona cuidada es cada uno.
 *
 * Consulta separada (no un join embebido de Supabase) a propósito: mantiene
 * el tipado explícito y simple, y una falla acá no debe tirar abajo la carga
 * de turnos — si falla, los turnos igual se muestran, solo que sin nombre de
 * persona cuidada (degradación explícita, ver NOTES).
 */
async function fetchCaredPersonNames(
  caredPersonIds: readonly string[]
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(caredPersonIds));
  const namesById = new Map<string, string>();

  if (uniqueIds.length === 0) {
    return namesById;
  }

  try {
    const { data, error } = await supabase
      .from('cared_persons')
      .select('id, full_name')
      .in('id', uniqueIds);

    if (error || !data) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftsService] could not resolve cared_person names');
      }
      return namesById;
    }

    const rowSchema = z.object({ id: z.string(), full_name: z.string() });
    for (const rawRow of data) {
      const parsed = rowSchema.safeParse(rawRow);
      if (parsed.success) {
        namesById.set(parsed.data.id, parsed.data.full_name);
      }
    }
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[shiftsService] unexpected error resolving cared_person names');
    }
  }

  return namesById;
}

/**
 * Devuelve el `family_id` de la primera familia de la que el usuario actual
 * es miembro (`family_members` filtrado por `user_id = auth.uid()`).
 *
 * GAP DE PRODUCTO (ver NOTES): todavía no existe una pantalla de
 * creación/selección de familia. v1 asume que un usuario pertenece a una
 * sola familia relevante y usa la primera fila que encuentra. `data: null`
 * (sin error) significa "usuario autenticado pero sin ninguna familia
 * todavía" — el caller debe mostrar un estado vacío, no un error.
 */
export async function getCurrentUserFamilyId(): Promise<ShiftsResult<string | null>> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      return { data: null, error: { code: 'auth_error', message: GENERIC_ERROR_MESSAGE } };
    }

    const userId = userData.user?.id;
    if (!userId) {
      return {
        data: null,
        error: { code: 'not_authenticated', message: 'Iniciá sesión para ver tu calendario.' },
      };
    }

    const { data, error } = await supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const familyId = (data as { family_id?: string } | null)?.family_id ?? null;
    return { data: familyId, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getCurrentUserFamilyId', err) };
  }
}

/**
 * Trae los turnos de una familia dentro de un rango de fechas, ordenados por
 * inicio. Usa solapamiento de rango (`starts_at < range.to` y
 * `ends_at > range.from`) para no perder turnos que empiezan antes del rango
 * pero siguen en curso dentro de él.
 */
export async function getShiftsForFamily(
  familyId: string,
  range: DateRange
): Promise<ShiftsResult<Shift[]>> {
  try {
    const { data, error } = await supabase
      .from('shifts')
      .select(SHIFT_SELECT_COLUMNS)
      .eq('family_id', familyId)
      .lt('starts_at', range.to.toISOString())
      .gt('ends_at', range.from.toISOString())
      .order('starts_at', { ascending: true });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedRows: ShiftRow[] = [];
    for (const rawRow of data ?? []) {
      const parsed = shiftRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedRows.push(parsed.data);
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftsService] dropped a shift row that failed validation');
      }
    }

    const caredPersonIds = parsedRows
      .map((row) => row.cared_person_id)
      .filter((id): id is string => id !== null);
    const caredPersonNamesById = await fetchCaredPersonNames(caredPersonIds);

    return {
      data: parsedRows.map((row) => mapShiftRow(row, caredPersonNamesById)),
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getShiftsForFamily', err) };
  }
}

/**
 * Resuelve el usuario actual para poblar `created_by` en el `.insert()`
 * directo de `createShift` -- mismo criterio que
 * `contactsService.resolveCurrentUserId` (duplicado a propósito: son módulos
 * de features distintas, mismo patrón ya aceptado en este repo, ver
 * `caredPersonContext.ts`).
 */
async function resolveCurrentUserId(): Promise<ShiftsResult<string>> {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user?.id) {
    return {
      data: null,
      error: { code: 'not_authenticated', message: 'Iniciá sesión para continuar.' },
    };
  }

  return { data: data.user.id, error: null };
}

/**
 * Lista los miembros de una familia (PGM-27), vía la RPC `list_family_members`
 * (`security definer`, ver `supabase/migrations/20260914140000_list_family_members_rpc.sql`).
 * Necesaria porque `family_members_select_own` (PGM-15) solo deja a cada
 * usuario ver su propia fila -- sin este RPC no hay forma de armar un picker
 * de "asignar a otro cuidador".
 *
 * Si `familyId` no es una familia de la que el usuario actual es miembro, la
 * RPC devuelve un array vacío (nunca las filas reales de una familia ajena) --
 * este service no necesita (ni puede) distinguir ese caso de "familia sin
 * miembros", la RLS ya lo resuelve de forma segura del lado del servidor.
 */
export async function listFamilyMembersForFamily(
  familyId: string
): Promise<ShiftsResult<FamilyMember[]>> {
  try {
    const { data, error } = await supabase.rpc('list_family_members', {
      p_family_id: familyId,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedMembers: FamilyMember[] = [];
    for (const rawRow of data ?? []) {
      const parsed = familyMemberRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedMembers.push({ userId: parsed.data.user_id, role: parsed.data.role });
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftsService] dropped a family member row that failed validation');
      }
    }

    return { data: parsedMembers, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('listFamilyMembersForFamily', err) };
  }
}

/**
 * Trae un turno puntual por id -- usado por `ShiftReassignScreen` para
 * resolver `family_id` (y así poder listar a los miembros asignables) y el
 * `assigned_to` actual (para preseleccionarlo en el picker) a partir de un
 * solo parámetro de ruta. RLS (`shifts_select_member`) ya garantiza que el
 * usuario actual solo puede leer turnos de una familia de la que es miembro.
 */
export async function getShiftById(shiftId: string): Promise<ShiftsResult<Shift>> {
  try {
    const { data, error } = await supabase
      .from('shifts')
      .select(SHIFT_SELECT_COLUMNS)
      .eq('id', shiftId)
      .single();

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsed = shiftRowSchema.safeParse(data);
    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftsService] getShiftById response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    // Turno puntual: no vale la pena pagar el round-trip de
    // `fetchCaredPersonNames` para un solo id -- este screen no muestra el
    // nombre de la persona cuidada, solo lo usa para resolver family_id /
    // assigned_to (ver comentario de la función).
    return { data: mapShiftRow(parsed.data, new Map()), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getShiftById', err) };
  }
}

/**
 * Da de alta un turno nuevo (PGM-27), propio o asignado a otro cuidador de la
 * familia. `.insert()` directo de supabase-js -- a diferencia de
 * `cared_persons`/`medications`, `shifts` no tiene ninguna columna cifrada
 * (ver nota de diseño en `supabase/migrations/20260913230000_shifts.sql`), así
 * que no hace falta ninguna RPC intermedia para escribir.
 *
 * Validación `starts_at < ends_at` en el cliente antes de llamar a Supabase
 * (fallar rápido, mismo criterio que `createEmergencyContact` con
 * `emergency_contacts.phone`): la tabla ya tiene el check `ends_at > starts_at`,
 * pero devolver el error de inmediato sin round-trip de red es mejor UX.
 * `assigned_to` puede ser cualquier miembro de la familia -- RLS
 * (`shifts_insert_member`, vía `is_family_member()`) valida server-side que
 * sea un miembro real, este chequeo cliente es solo para UX (el picker de
 * `ShiftFormScreen` ya solo ofrece miembros reales, vía
 * `listFamilyMembersForFamily`).
 */
export async function createShift(input: CreateShiftInput): Promise<ShiftsResult<Shift>> {
  if (input.startsAt.getTime() >= input.endsAt.getTime()) {
    return {
      data: null,
      error: {
        code: 'invalid_time_range',
        message: 'El turno tiene que empezar antes de terminar.',
      },
    };
  }

  try {
    const userResult = await resolveCurrentUserId();
    if (userResult.error) {
      return { data: null, error: userResult.error };
    }

    const { data, error } = await supabase
      .from('shifts')
      .insert({
        family_id: input.familyId,
        cared_person_id: input.caredPersonId ?? null,
        assigned_to: input.assignedTo,
        starts_at: input.startsAt.toISOString(),
        ends_at: input.endsAt.toISOString(),
        created_by: userResult.data,
      })
      .select(SHIFT_SELECT_COLUMNS)
      .single();

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_WRITE_ERROR_MESSAGE },
      };
    }

    const parsed = shiftRowSchema.safeParse(data);
    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftsService] createShift response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_WRITE_ERROR_MESSAGE },
      };
    }

    return { data: mapShiftRow(parsed.data, new Map()), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createShift', err) };
  }
}

/**
 * Reasigna un turno existente a otro cuidador (o a uno mismo) de la misma
 * familia -- cambia únicamente `assigned_to`. `.update()` directo, mismas
 * razones que `createShift` (sin columnas cifradas, no hace falta RPC). RLS
 * (`shifts_update_member`) valida server-side que el nuevo `assigned_to` siga
 * siendo miembro de la familia del turno.
 */
export async function reassignShift(
  shiftId: string,
  assignedTo: string
): Promise<ShiftsResult<Shift>> {
  try {
    const { data, error } = await supabase
      .from('shifts')
      .update({ assigned_to: assignedTo })
      .eq('id', shiftId)
      .select(SHIFT_SELECT_COLUMNS)
      .single();

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_WRITE_ERROR_MESSAGE },
      };
    }

    const parsed = shiftRowSchema.safeParse(data);
    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftsService] reassignShift response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_WRITE_ERROR_MESSAGE },
      };
    }

    // Nota: igual que `createShift`, no se resuelve `caredPersonName` acá
    // (round-trip extra que este caller -- `ShiftReassignScreen` -- no
    // necesita, vuelve a la pantalla anterior que ya recarga la lista
    // completa con nombres resueltos). Degradación explícita, mismo criterio
    // que el resto del módulo.
    return { data: mapShiftRow(parsed.data, new Map()), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('reassignShift', err) };
  }
}
