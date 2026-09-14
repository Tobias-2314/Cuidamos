import { z } from 'zod';

import { supabase } from '../../lib/supabase';
import { isValidMedicationNote } from './medicationFormatting';

/**
 * Normalized error shape returned by every function in this module — same
 * pattern as `authService.ts` (PGM-16/17) / `shiftsService.ts` (PGM-26).
 * Never carries raw Supabase error payloads, only a stable `code` and a
 * user-facing `message`.
 */
export interface MedicationsServiceError {
  code: string;
  message: string;
}

export type MedicationsResult<T> =
  | { data: T; error: null }
  | { data: null; error: MedicationsServiceError };

export interface Medication {
  id: string;
  caredPersonId: string;
  name: string;
  dose: string;
  instructions: string | null;
  schedule: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MedicationLog {
  id: string;
  medicationId: string;
  takenBy: string;
  takenAt: string;
  note: string | null;
  createdAt: string;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

/**
 * Valida cada fila cruda que devuelven las RPC de Supabase antes de confiar
 * en su forma — mismo criterio que `shiftsService.ts` (nunca asumimos que
 * una respuesta externa, aunque venga de nuestra propia DB, tiene el shape
 * esperado).
 */
const medicationRowSchema = z.object({
  id: z.string(),
  cared_person_id: z.string(),
  name: z.string(),
  dose: z.string(),
  instructions: z.string().nullable(),
  schedule: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

const medicationLogRowSchema = z.object({
  id: z.string(),
  medication_id: z.string(),
  taken_by: z.string(),
  taken_at: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
});

/**
 * Fila del historial de tomas (PGM-33) -- superset de `medicationLogRowSchema` con
 * `medication_name` (también descifrado por la RPC), necesario para que una fila del
 * historial tenga sentido fuera del contexto de "este medicamento" (ver comentario de
 * diseño en `supabase/migrations/20260914150000_medication_logs_history_rpc.sql`).
 */
const medicationLogEntryRowSchema = z.object({
  id: z.string(),
  medication_id: z.string(),
  medication_name: z.string(),
  taken_by: z.string(),
  taken_at: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
});

/**
 * `cared_persons.full_name` NO está cifrado (ver
 * `supabase/migrations/20260913220000_cared_persons.sql`) — a diferencia de
 * `medications`, esta fila se puede leer con un `.select()` directo de
 * supabase-js, sin RPC intermedia.
 */
const caredPersonRowSchema = z.object({
  id: z.string(),
  full_name: z.string(),
});

function normalizeUnexpectedError(context: string, _err: unknown): MedicationsServiceError {
  // Never surface the raw error — it may wrap a network response or other
  // sensitive request/response data. Log only a non-sensitive marker.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[medicationsService] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
}

function mapMedicationRow(row: z.infer<typeof medicationRowSchema>): Medication {
  return {
    id: row.id,
    caredPersonId: row.cared_person_id,
    name: row.name,
    dose: row.dose,
    instructions: row.instructions,
    schedule: row.schedule,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapMedicationLogRow(row: z.infer<typeof medicationLogRowSchema>): MedicationLog {
  return {
    id: row.id,
    medicationId: row.medication_id,
    takenBy: row.taken_by,
    takenAt: row.taken_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Fila del historial de tomas (PGM-33), con el nombre del medicamento ya resuelto —
 * ver `medicationLogEntryRowSchema` sobre por qué esta fila lleva un campo extra que
 * `MedicationLog` no tiene.
 */
export interface MedicationLogEntry {
  id: string;
  medicationId: string;
  medicationName: string;
  takenBy: string;
  takenAt: string;
  note: string | null;
  createdAt: string;
}

function mapMedicationLogEntryRow(
  row: z.infer<typeof medicationLogEntryRowSchema>
): MedicationLogEntry {
  return {
    id: row.id,
    medicationId: row.medication_id,
    medicationName: row.medication_name,
    takenBy: row.taken_by,
    takenAt: row.taken_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface CaredPerson {
  id: string;
  fullName: string;
}

/**
 * Trae las `cared_persons` de una familia (id + nombre). PGM-31 la usa para
 * resolver automáticamente el `cared_person_id` al dar de alta un
 * medicamento — ver NOTES sobre por qué no hay UI para elegir entre varias
 * (v1 asume una sola persona cuidada por familia, mismo criterio que
 * `getCurrentUserFamilyId` en `shiftsService.ts`).
 */
export async function getCaredPersonsForFamily(
  familyId: string
): Promise<MedicationsResult<CaredPerson[]>> {
  try {
    const { data, error } = await supabase
      .from('cared_persons')
      .select('id, full_name')
      .eq('family_id', familyId);

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedRows: CaredPerson[] = [];
    for (const rawRow of data ?? []) {
      const parsed = caredPersonRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedRows.push({ id: parsed.data.id, fullName: parsed.data.full_name });
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[medicationsService] dropped a cared_person row that failed validation');
      }
    }

    return { data: parsedRows, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getCaredPersonsForFamily', err) };
  }
}

/**
 * Trae los medicamentos de una familia, con `name`/`dose`/`instructions` ya
 * descifrados.
 *
 * BLOQUEANTE TÉCNICO (ver NOTES del agente): `medications.name`/`dose`/
 * `instructions` son `bytea` cifrados (PGM-30) — `extensions.decrypt_text`
 * vive en Postgres y no es invocable desde un `.select()` normal de
 * supabase-js. Por eso esta función llama a la RPC
 * `get_medications_for_family` (supabase/migrations/20260913241500_medications_rpc.sql,
 * agregada en PGM-32), que envuelve el decrypt y sigue sujeta a las mismas
 * policies de RLS que un `.select()` directo (la función es `security
 * invoker`, no `security definer`).
 *
 * También se reusa acá para el modo edición de PGM-31
 * (`MedicationFormScreen`): no existe un `getMedicationById` separado —
 * editar busca el medicamento dentro de la lista de la familia por `id`,
 * evitando una RPC extra solo para ese caso.
 */
export async function getMedicationsForFamily(
  familyId: string
): Promise<MedicationsResult<Medication[]>> {
  try {
    const { data, error } = await supabase.rpc('get_medications_for_family', {
      p_family_id: familyId,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedRows: Medication[] = [];
    for (const rawRow of data ?? []) {
      const parsed = medicationRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedRows.push(mapMedicationRow(parsed.data));
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[medicationsService] dropped a medication row that failed validation');
      }
    }

    return { data: parsedRows, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getMedicationsForFamily', err) };
  }
}

/**
 * Trae el historial de tomas de medicación de una familia (PGM-33), con
 * `medication_name`/`note` ya descifrados y ordenado por `taken_at desc` (más reciente
 * primero) -- visible para CUALQUIER miembro de la familia, no solo quien registró
 * cada toma (ese es el punto central de la issue).
 *
 * Mismo bloqueante técnico que `getMedicationsForFamily`: `note` es `bytea` cifrado,
 * así que esta función llama a la RPC `get_medication_logs_for_family`
 * (supabase/migrations/20260914150000_medication_logs_history_rpc.sql, PGM-33),
 * `security invoker` -- sigue sujeta a `medication_logs_select_member` (PGM-30).
 */
export async function getMedicationLogsForFamily(
  familyId: string
): Promise<MedicationsResult<MedicationLogEntry[]>> {
  try {
    const { data, error } = await supabase.rpc('get_medication_logs_for_family', {
      p_family_id: familyId,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedRows: MedicationLogEntry[] = [];
    for (const rawRow of data ?? []) {
      const parsed = medicationLogEntryRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedRows.push(mapMedicationLogEntryRow(parsed.data));
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[medicationsService] dropped a medication log row that failed validation');
      }
    }

    return { data: parsedRows, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getMedicationLogsForFamily', err) };
  }
}

export interface RecordMedicationTakenOptions {
  /** Hora real de la toma. Por default, `now()` al momento de llamar. */
  takenAt?: Date;
  /** Nota corta opcional (PGM-32). Se recorta (`trim()`) antes de validar. */
  note?: string | null;
}

/**
 * Registra una toma de medicación (`medication_logs`). `taken_by` es
 * SIEMPRE el usuario actual — ver NOTES sobre por qué no hay UI para
 * "en nombre de quién" registrar.
 *
 * Igual que `getMedicationsForFamily`, pasa por una RPC
 * (`create_medication_log`) porque `note` se escribe cifrada y
 * `extensions.encrypt_text` no es invocable desde un `.insert()` normal.
 */
export async function recordMedicationTaken(
  medicationId: string,
  options: RecordMedicationTakenOptions = {}
): Promise<MedicationsResult<MedicationLog>> {
  const trimmedNote = options.note?.trim() ?? '';

  if (trimmedNote.length > 0 && !isValidMedicationNote(trimmedNote)) {
    return {
      data: null,
      error: {
        code: 'note_too_long',
        message: 'La nota es demasiado larga. Achicala e intentá de nuevo.',
      },
    };
  }

  try {
    const { data, error } = await supabase.rpc('create_medication_log', {
      p_medication_id: medicationId,
      p_taken_at: (options.takenAt ?? new Date()).toISOString(),
      p_note: trimmedNote.length > 0 ? trimmedNote : null,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    // La RPC está definida como `returns table (...)`, así que postgrest-js
    // la devuelve como un array de una fila (nunca como objeto suelto).
    const rawRow = Array.isArray(data) ? data[0] : data;
    const parsed = medicationLogRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[medicationsService] create_medication_log response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapMedicationLogRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('recordMedicationTaken', err) };
  }
}

export interface CreateMedicationInput {
  caredPersonId: string;
  name: string;
  dose: string;
  /** `null`/omitido/string vacío se guardan como "sin instrucciones". */
  instructions?: string | null;
  /** Texto libre, mismo criterio que `medications.schedule` (PGM-30). */
  schedule?: string | null;
}

/**
 * Da de alta un medicamento (PGM-31). `name`/`dose`/`instructions` se
 * cifran server-side — igual que en `getMedicationsForFamily`/
 * `recordMedicationTaken`, `extensions.encrypt_text` no es invocable desde
 * un `.insert()` normal de supabase-js, así que esta función llama a la RPC
 * `create_medication` (supabase/migrations/20260913242000_medications_write_rpc.sql),
 * `security invoker` — sigue sujeta a `medications_insert_member` (PGM-30):
 * un `cared_person_id` de otra familia devuelve `insufficient_privilege`,
 * nunca crea el registro.
 *
 * Valida nombre/dosis no vacíos ANTES de llamar a la RPC (falla rápido, sin
 * round-trip de red para un error que ya sabemos que va a pasar).
 */
export async function createMedication(
  input: CreateMedicationInput
): Promise<MedicationsResult<Medication>> {
  const trimmedName = input.name.trim();
  const trimmedDose = input.dose.trim();

  if (trimmedName.length === 0) {
    return {
      data: null,
      error: { code: 'invalid_name', message: 'Ingresá el nombre del medicamento.' },
    };
  }

  if (trimmedDose.length === 0) {
    return {
      data: null,
      error: { code: 'invalid_dose', message: 'Ingresá la dosis.' },
    };
  }

  const trimmedInstructions = input.instructions?.trim() ?? '';
  const trimmedSchedule = input.schedule?.trim() ?? '';

  try {
    const { data, error } = await supabase.rpc('create_medication', {
      p_cared_person_id: input.caredPersonId,
      p_name: trimmedName,
      p_dose: trimmedDose,
      p_instructions: trimmedInstructions.length > 0 ? trimmedInstructions : null,
      p_schedule: trimmedSchedule.length > 0 ? trimmedSchedule : null,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    // `returns table (...)`: postgrest-js siempre lo devuelve como array.
    const rawRow = Array.isArray(data) ? data[0] : data;
    const parsed = medicationRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[medicationsService] create_medication response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapMedicationRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createMedication', err) };
  }
}

export interface UpdateMedicationInput {
  /** Omitido: no se toca. String vacío/solo espacios: rechazado (ver abajo). */
  name?: string;
  dose?: string;
  /** Omitido: no se toca. `null`: borra la instrucción existente. */
  instructions?: string | null;
  /** Omitido: no se toca. `null`: borra el horario existente. */
  schedule?: string | null;
}

/**
 * Edita un medicamento existente (PGM-31), solo los campos provistos —
 * `undefined` significa "no tocar", `null` (solo `instructions`/`schedule`,
 * son nullable) significa "borrar el valor existente". `name`/`dose` nunca
 * pueden vaciarse (son NOT NULL en la tabla): un string vacío/solo espacios
 * se rechaza ANTES de llamar a la RPC.
 *
 * Misma razón que `createMedication` para pasar por una RPC
 * (`update_medication`, `security invoker`): cifrar server-side los campos
 * que cambian. Sigue sujeta a `medications_update_member` (PGM-30) — si el
 * medicamento no es de la familia del usuario, el UPDATE afecta 0 filas
 * (RLS silenciosa en UPDATE, no excepción — mismo criterio que el resto del
 * modelo) y esta función lo reporta como `not_found`.
 */
export async function updateMedication(
  medicationId: string,
  updates: UpdateMedicationInput
): Promise<MedicationsResult<Medication>> {
  if (updates.name !== undefined && updates.name.trim().length === 0) {
    return {
      data: null,
      error: { code: 'invalid_name', message: 'Ingresá el nombre del medicamento.' },
    };
  }

  if (updates.dose !== undefined && updates.dose.trim().length === 0) {
    return {
      data: null,
      error: { code: 'invalid_dose', message: 'Ingresá la dosis.' },
    };
  }

  const trimmedInstructions =
    typeof updates.instructions === 'string' ? updates.instructions.trim() : updates.instructions;
  const trimmedSchedule =
    typeof updates.schedule === 'string' ? updates.schedule.trim() : updates.schedule;

  // Un string vacío en un campo opcional se interpreta como "borrarlo", no
  // como "dejarlo en blanco" — mismo criterio que `recordMedicationTaken`
  // con `note`.
  const clearInstructions = trimmedInstructions === null || trimmedInstructions === '';
  const clearSchedule = trimmedSchedule === null || trimmedSchedule === '';

  try {
    const { data, error } = await supabase.rpc('update_medication', {
      p_medication_id: medicationId,
      p_name: updates.name !== undefined ? updates.name.trim() : null,
      p_dose: updates.dose !== undefined ? updates.dose.trim() : null,
      p_instructions: clearInstructions ? null : trimmedInstructions ?? null,
      p_clear_instructions: updates.instructions !== undefined && clearInstructions,
      p_schedule: clearSchedule ? null : trimmedSchedule ?? null,
      p_clear_schedule: updates.schedule !== undefined && clearSchedule,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const rawRow = Array.isArray(data) ? data[0] : data;

    if (!rawRow) {
      return {
        data: null,
        error: {
          code: 'not_found',
          message: 'No encontramos el medicamento para editar.',
        },
      };
    }

    const parsed = medicationRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[medicationsService] update_medication response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapMedicationRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('updateMedication', err) };
  }
}

/**
 * Borra un medicamento (PGM-31). A diferencia de create/update, NO hace
 * falta una RPC: un DELETE no involucra ningún campo cifrado, y
 * `medications_delete_member` (PGM-30) ya alcanza para aislar por familia
 * vía un `.delete()` directo de supabase-js.
 */
export async function deleteMedication(medicationId: string): Promise<MedicationsResult<null>> {
  try {
    const { error } = await supabase.from('medications').delete().eq('id', medicationId);

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: null, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('deleteMedication', err) };
  }
}
