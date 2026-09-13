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
 * Trae los medicamentos de una familia, con `name`/`dose`/`instructions` ya
 * descifrados.
 *
 * BLOQUEANTE TÉCNICO (ver NOTES del agente): `medications.name`/`dose`/
 * `instructions` son `bytea` cifrados (PGM-30) — `extensions.decrypt_text`
 * vive en Postgres y no es invocable desde un `.select()` normal de
 * supabase-js. Por eso esta función llama a la RPC
 * `get_medications_for_family` (supabase/migrations/20260913241500_medications_rpc.sql,
 * agregada en esta misma issue), que envuelve el decrypt y sigue sujeta a
 * las mismas policies de RLS que un `.select()` directo (la función es
 * `security invoker`, no `security definer`).
 *
 * PGM-31 ("[FE] Alta y edición de medicamentos") todavía no existe — esta
 * lista es de solo lectura a propósito, ver NOTES.
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
