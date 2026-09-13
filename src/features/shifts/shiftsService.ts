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

const GENERIC_ERROR_MESSAGE = 'No pudimos cargar los turnos. Intentá de nuevo.';

const shiftStatusSchema = z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']);

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
      .select(
        'id, family_id, cared_person_id, assigned_to, starts_at, ends_at, status, created_by, created_at'
      )
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
