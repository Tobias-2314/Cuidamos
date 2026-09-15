import { z } from 'zod';

import { supabase } from '../../lib/supabase';
import {
  hasAnyShiftHandoverContent,
  isValidShiftHandoverField,
  MAX_SHIFT_HANDOVER_FIELD_LENGTH,
  shiftHandoverFieldsSchema,
} from './shiftHandoverValidation';

/**
 * Normalized error shape returned by every function in this module -- mismo
 * patrón que `shiftsService.ts` (PGM-26) / `medicationsService.ts` (PGM-30).
 * Nunca lleva el error crudo de Supabase, solo un `code` estable y un
 * `message` para mostrar al usuario.
 */
export interface ShiftHandoversServiceError {
  code: string;
  message: string;
}

export type ShiftHandoversResult<T> =
  | { data: T; error: null }
  | { data: null; error: ShiftHandoversServiceError };

/**
 * Traspaso de turno (F5, PGM-35/36) ya descifrado. `resumen`/`comida`/
 * `animo`/`pendientes` son `null` cuando el cuidador no completó ese campo --
 * los 4 son opcionales (ver `shiftHandoverValidation.ts`).
 */
export interface ShiftHandover {
  id: string;
  shiftId: string;
  resumen: string | null;
  comida: string | null;
  animo: string | null;
  pendientes: string | null;
  createdBy: string;
  createdAt: string;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos guardar el traspaso de turno. Intentá de nuevo.';

/**
 * Valida cada fila cruda que devolvería la RPC antes de confiar en su forma
 * -- mismo criterio que `shiftsService.ts`/`medicationsService.ts`: nunca
 * asumimos que una respuesta externa (aunque venga de nuestra propia DB)
 * tiene el shape esperado.
 */
const shiftHandoverRowSchema = z.object({
  id: z.string(),
  shift_id: z.string(),
  resumen: z.string().nullable(),
  comida: z.string().nullable(),
  animo: z.string().nullable(),
  pendientes: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

function normalizeUnexpectedError(context: string, _err: unknown): ShiftHandoversServiceError {
  // Never surface the raw error -- it may wrap a network response or other
  // sensitive request/response data. Log only a non-sensitive marker.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[shiftHandoversService] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
}

function mapShiftHandoverRow(row: z.infer<typeof shiftHandoverRowSchema>): ShiftHandover {
  return {
    id: row.id,
    shiftId: row.shift_id,
    resumen: row.resumen,
    comida: row.comida,
    animo: row.animo,
    pendientes: row.pendientes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export interface CreateShiftHandoverInput {
  shiftId: string;
  /** `undefined`/string vacío tras `trim()` se guardan como "campo no completado". */
  resumen?: string | null;
  comida?: string | null;
  animo?: string | null;
  pendientes?: string | null;
}

/**
 * Registra el traspaso de cierre de un turno (F5, PGM-36): resumen, comida,
 * ánimo y pendientes para el próximo cuidador.
 *
 * BLOQUEANTE TÉCNICO (ver NOTES del agente): igual que `medications`
 * (PGM-30/32), los 4 campos de `shift_handovers` son `bytea` cifrados -- TODOS,
 * no solo algunos (ver nota de diseño en
 * `supabase/migrations/20260914160000_shift_handovers.sql`). `extensions.encrypt_text`
 * no es invocable desde un `.insert()` normal de supabase-js, así que hace
 * falta una RPC `security definer` que cifre server-side.
 *
 * TODO(PGM-backend): RPC pendiente -- `create_shift_handover` todavía NO
 * existe (es trabajo de Backend, issue futura, mismo patrón que
 * PGM-30 -> PGM-32 para medications). Esta función ya deja el punto de
 * integración real (`supabase.rpc('create_shift_handover', ...)`) armado con
 * el shape de parámetros esperado -- hasta que la RPC exista, cualquier
 * llamada real falla con un error de Postgres ("function does not exist"),
 * que este service normaliza como cualquier otro error de RPC (nunca lo
 * propaga crudo). NO se implementa un `.insert()` directo como fallback: eso
 * escribiría los 4 campos en texto plano sobre columnas pensadas para
 * guardar únicamente `bytea` cifrado, violando el requisito de RGPD de esta
 * feature.
 *
 * Valida el largo de cada campo y exige al menos uno no vacío ANTES de
 * llamar a la RPC (falla rápido, mismo criterio que `createMedication`).
 */
export async function createShiftHandover(
  input: CreateShiftHandoverInput
): Promise<ShiftHandoversResult<ShiftHandover>> {
  const trimmedFields = shiftHandoverFieldsSchema.safeParse({
    resumen: input.resumen?.trim() ?? '',
    comida: input.comida?.trim() ?? '',
    animo: input.animo?.trim() ?? '',
    pendientes: input.pendientes?.trim() ?? '',
  });

  if (!trimmedFields.success) {
    return {
      data: null,
      error: {
        code: 'field_too_long',
        message: `Cada campo puede tener como máximo ${MAX_SHIFT_HANDOVER_FIELD_LENGTH} caracteres.`,
      },
    };
  }

  const fields = trimmedFields.data;

  // Doble chequeo explícito además del schema -- `.max()` de Zod ya cubre
  // esto, pero `isValidShiftHandoverField` es la función pura que también
  // usa la UI (`ShiftHandoverFormScreen`) para el mensaje de validación en
  // vivo, mismo criterio que `createMedication`/`recordMedicationTaken`
  // reusando `isValidMedicationNote`.
  const allFieldsValid = [fields.resumen, fields.comida, fields.animo, fields.pendientes].every(
    isValidShiftHandoverField
  );
  if (!allFieldsValid) {
    return {
      data: null,
      error: {
        code: 'field_too_long',
        message: 'Algún campo es demasiado largo. Achicalo e intentá de nuevo.',
      },
    };
  }

  if (!hasAnyShiftHandoverContent(fields)) {
    return {
      data: null,
      error: {
        code: 'empty_handover',
        message: 'Completá al menos un campo antes de guardar el traspaso.',
      },
    };
  }

  try {
    const { data, error } = await supabase.rpc('create_shift_handover', {
      p_shift_id: input.shiftId,
      p_resumen: fields.resumen.length > 0 ? fields.resumen : null,
      p_comida: fields.comida.length > 0 ? fields.comida : null,
      p_animo: fields.animo.length > 0 ? fields.animo : null,
      p_pendientes: fields.pendientes.length > 0 ? fields.pendientes : null,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    // Igual que `create_medication`/`create_medication_log`: si la RPC está
    // definida como `returns table (...)`, postgrest-js la devuelve como un
    // array de una fila (nunca como objeto suelto).
    const rawRow = Array.isArray(data) ? data[0] : data;
    const parsed = shiftHandoverRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[shiftHandoversService] create_shift_handover response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapShiftHandoverRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createShiftHandover', err) };
  }
}
