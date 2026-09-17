import { z } from 'zod';

import { supabase } from '../../lib/supabase';
import {
  normalizeUnexpectedError as normalizeUnexpectedServiceError,
  type ServiceError,
  type ServiceResult,
} from '../../lib/serviceResult';

/**
 * Normalized error shape returned by every function in this module — mismo
 * shape compartido que el resto de los `*Service.ts` (ver
 * `lib/serviceResult.ts`). Nunca expone el payload crudo de Supabase, solo
 * un `code` estable y un `message` user-facing.
 */
export type CaredPersonsServiceError = ServiceError;

export type CaredPersonsResult<T> = ServiceResult<T>;

export interface CaredPerson {
  id: string;
  familyId: string;
  fullName: string;
  /** `YYYY-MM-DD` o `null` si no se cargó. */
  birthDate: string | null;
  /** Dato de salud (RGPD art. 9) -- ya descifrado por la RPC. */
  conditionNotes: string | null;
  /** Timestamp del consentimiento explícito (PGM-24) -- siempre presente. */
  consentGivenAt: string;
  createdBy: string;
  createdAt: string;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

/**
 * Valida la fila cruda que devuelve `create_cared_person` antes de confiar en
 * su forma -- mismo criterio que `medicationsService.ts` (nunca asumimos que
 * una respuesta externa, aunque venga de nuestra propia DB, tiene el shape
 * esperado).
 */
const caredPersonRowSchema = z.object({
  id: z.string(),
  family_id: z.string(),
  full_name: z.string(),
  birth_date: z.string().nullable(),
  condition_notes: z.string().nullable(),
  consent_given_at: z.string(),
  created_by: z.string(),
  created_at: z.string(),
});

function normalizeUnexpectedError(context: string, err: unknown): CaredPersonsServiceError {
  return normalizeUnexpectedServiceError('caredPersonsService', context, err, GENERIC_ERROR_MESSAGE);
}

function mapCaredPersonRow(row: z.infer<typeof caredPersonRowSchema>): CaredPerson {
  return {
    id: row.id,
    familyId: row.family_id,
    fullName: row.full_name,
    birthDate: row.birth_date,
    conditionNotes: row.condition_notes,
    consentGivenAt: row.consent_given_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export interface CreateCaredPersonInput {
  familyId: string;
  fullName: string;
  /** `YYYY-MM-DD`. `null`/omitido: sin fecha de nacimiento cargada. */
  birthDate?: string | null;
  /**
   * Dato de salud (RGPD art. 9). `null`/omitido/string vacío se guardan como
   * "sin notas de condición".
   */
  conditionNotes?: string | null;
}

/**
 * Da de alta el perfil de la persona cuidada (PGM-22). `condition_notes` se
 * cifra server-side -- igual que `createMedication` en
 * `medicationsService.ts`, `extensions.encrypt_text` no es invocable desde un
 * `.insert()` normal de supabase-js, así que esta función llama a la RPC
 * `create_cared_person`
 * (supabase/migrations/20260914130000_cared_persons_write_rpc.sql),
 * `security invoker` -- sigue sujeta a `cared_persons_insert_member`
 * (PGM-21): un `familyId` de otra familia devuelve `insufficient_privilege`,
 * nunca crea el registro.
 *
 * IMPORTANTE -- consentimiento (RGPD art. 9, PGM-24): esta función NO recibe
 * ni manda ningún parámetro de consentimiento. La RPC fija
 * `consent_given_at = now()` internamente en el momento del INSERT. El
 * caller (`CaredPersonFormScreen`) es responsable de solo invocar esta
 * función después de que el usuario tildó el checkbox de consentimiento
 * explícito en la UI -- pero el valor persistido siempre es el instante real
 * de la llamada, nunca algo que este módulo o la UI puedan falsear.
 *
 * Valida `fullName` no vacío ANTES de llamar a la RPC (falla rápido, sin
 * round-trip de red para un error que ya sabemos que va a pasar) -- mismo
 * criterio que `createMedication`.
 */
export async function createCaredPerson(
  input: CreateCaredPersonInput
): Promise<CaredPersonsResult<CaredPerson>> {
  const trimmedFullName = input.fullName.trim();

  if (trimmedFullName.length === 0) {
    return {
      data: null,
      error: { code: 'invalid_full_name', message: 'Ingresá el nombre de la persona cuidada.' },
    };
  }

  const trimmedConditionNotes = input.conditionNotes?.trim() ?? '';

  try {
    const { data, error } = await supabase.rpc('create_cared_person', {
      p_family_id: input.familyId,
      p_full_name: trimmedFullName,
      p_birth_date: input.birthDate ?? null,
      p_condition_notes: trimmedConditionNotes.length > 0 ? trimmedConditionNotes : null,
    });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    // `returns table (...)`: postgrest-js siempre lo devuelve como array.
    const rawRow = Array.isArray(data) ? data[0] : data;
    const parsed = caredPersonRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[caredPersonsService] create_cared_person response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapCaredPersonRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createCaredPerson', err) };
  }
}
