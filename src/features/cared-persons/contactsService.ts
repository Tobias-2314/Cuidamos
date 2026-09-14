import { z } from 'zod';

import { supabase } from '../../lib/supabase';

/**
 * Normalized error shape returned by every function in this module — mismo
 * patrón que `caredPersonsService.ts`/`medicationsService.ts`/`familyService.ts`.
 * Nunca carga el payload crudo de Supabase, solo un `code` estable y un
 * `message` user-facing.
 */
export interface ContactsServiceError {
  code: string;
  message: string;
}

export type ContactsResult<T> =
  | { data: T; error: null }
  | { data: null; error: ContactsServiceError };

export interface MedicalContact {
  id: string;
  caredPersonId: string;
  fullName: string;
  specialty: string | null;
  phone: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface EmergencyContact {
  id: string;
  caredPersonId: string;
  fullName: string;
  relationship: string | null;
  /** NOT NULL en la tabla (a diferencia de `medical_contacts.phone`) -- ver migración PGM-21. */
  phone: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

/**
 * `medical_contacts`/`emergency_contacts` NO están cifradas (ver
 * `supabase/migrations/20260913220000_cared_persons.sql`, sección "NOTA DE
 * ALCANCE") -- no son datos de salud según la lista canónica de PGM-3, son
 * datos de contacto (nombre/teléfono/especialidad/relación). Por eso este
 * módulo usa `.select()`/`.insert()` DIRECTOS de supabase-js, sin ninguna RPC
 * intermedia -- a diferencia de `medicationsService.ts`/`caredPersonsService.ts`,
 * que sí necesitan RPC porque escriben/leen columnas `bytea` cifradas.
 */
const medicalContactRowSchema = z.object({
  id: z.string(),
  cared_person_id: z.string(),
  full_name: z.string(),
  specialty: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

const emergencyContactRowSchema = z.object({
  id: z.string(),
  cared_person_id: z.string(),
  full_name: z.string(),
  relationship: z.string().nullable(),
  phone: z.string(),
  notes: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

const CONTACT_SELECT_COLUMNS =
  'id, cared_person_id, full_name, specialty, phone, notes, created_by, created_at';
const EMERGENCY_CONTACT_SELECT_COLUMNS =
  'id, cared_person_id, full_name, relationship, phone, notes, created_by, created_at';

function normalizeUnexpectedError(context: string, _err: unknown): ContactsServiceError {
  // Never surface the raw error — it may wrap a network response or other
  // sensitive request/response data. Log only a non-sensitive marker.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[contactsService] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
}

function mapMedicalContactRow(row: z.infer<typeof medicalContactRowSchema>): MedicalContact {
  return {
    id: row.id,
    caredPersonId: row.cared_person_id,
    fullName: row.full_name,
    specialty: row.specialty,
    phone: row.phone,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapEmergencyContactRow(row: z.infer<typeof emergencyContactRowSchema>): EmergencyContact {
  return {
    id: row.id,
    caredPersonId: row.cared_person_id,
    fullName: row.full_name,
    relationship: row.relationship,
    phone: row.phone,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Resuelve el usuario actual para poblar `created_by` en los inserts directos
 * de este módulo -- a diferencia de las RPC (`create_medication`,
 * `create_cared_person`), que fijan `created_by`/`consent_given_at`
 * server-side, un `.insert()` directo de supabase-js necesita que el cliente
 * mande el valor explícitamente (la columna no tiene default). Mismo patrón
 * que `familyService.createFamily`.
 */
async function resolveCurrentUserId(): Promise<ContactsResult<string>> {
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
 * Trae los médicos/contactos médicos de una `cared_person`, ordenados por
 * fecha de alta (más antiguos primero -- no hay todavía UI de reordenar).
 */
export async function getMedicalContactsForCaredPerson(
  caredPersonId: string
): Promise<ContactsResult<MedicalContact[]>> {
  try {
    const { data, error } = await supabase
      .from('medical_contacts')
      .select(CONTACT_SELECT_COLUMNS)
      .eq('cared_person_id', caredPersonId)
      .order('created_at', { ascending: true });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedRows: MedicalContact[] = [];
    for (const rawRow of data ?? []) {
      const parsed = medicalContactRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedRows.push(mapMedicalContactRow(parsed.data));
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[contactsService] dropped a medical_contact row that failed validation');
      }
    }

    return { data: parsedRows, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getMedicalContactsForCaredPerson', err) };
  }
}

/**
 * Trae los contactos de emergencia de una `cared_person`, ordenados por fecha
 * de alta.
 */
export async function getEmergencyContactsForCaredPerson(
  caredPersonId: string
): Promise<ContactsResult<EmergencyContact[]>> {
  try {
    const { data, error } = await supabase
      .from('emergency_contacts')
      .select(EMERGENCY_CONTACT_SELECT_COLUMNS)
      .eq('cared_person_id', caredPersonId)
      .order('created_at', { ascending: true });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedRows: EmergencyContact[] = [];
    for (const rawRow of data ?? []) {
      const parsed = emergencyContactRowSchema.safeParse(rawRow);
      if (parsed.success) {
        parsedRows.push(mapEmergencyContactRow(parsed.data));
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn('[contactsService] dropped an emergency_contact row that failed validation');
      }
    }

    return { data: parsedRows, error: null };
  } catch (err: unknown) {
    return {
      data: null,
      error: normalizeUnexpectedError('getEmergencyContactsForCaredPerson', err),
    };
  }
}

export interface CreateMedicalContactInput {
  caredPersonId: string;
  fullName: string;
  /** `null`/omitido/string vacío se guardan como "sin especialidad". */
  specialty?: string | null;
  /** `null`/omitido/string vacío se guardan como "sin teléfono" (columna nullable). */
  phone?: string | null;
  notes?: string | null;
}

/**
 * Da de alta un médico/contacto médico (PGM-23). Campos mínimos: nombre --
 * el resto (especialidad, teléfono, notas) es opcional, `medical_contacts.phone`
 * es nullable a diferencia de `emergency_contacts.phone` (ver comentario de
 * columna en la migración PGM-21).
 */
export async function createMedicalContact(
  input: CreateMedicalContactInput
): Promise<ContactsResult<MedicalContact>> {
  const trimmedFullName = input.fullName.trim();

  if (trimmedFullName.length === 0) {
    return {
      data: null,
      error: { code: 'invalid_full_name', message: 'Ingresá el nombre del médico.' },
    };
  }

  try {
    const userResult = await resolveCurrentUserId();
    if (userResult.error) {
      return { data: null, error: userResult.error };
    }

    const trimmedSpecialty = input.specialty?.trim() ?? '';
    const trimmedPhone = input.phone?.trim() ?? '';
    const trimmedNotes = input.notes?.trim() ?? '';

    const { data, error } = await supabase
      .from('medical_contacts')
      .insert({
        cared_person_id: input.caredPersonId,
        full_name: trimmedFullName,
        specialty: trimmedSpecialty.length > 0 ? trimmedSpecialty : null,
        phone: trimmedPhone.length > 0 ? trimmedPhone : null,
        notes: trimmedNotes.length > 0 ? trimmedNotes : null,
        created_by: userResult.data,
      })
      .select(CONTACT_SELECT_COLUMNS)
      .single();

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsed = medicalContactRowSchema.safeParse(data);
    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[contactsService] createMedicalContact response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapMedicalContactRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createMedicalContact', err) };
  }
}

export interface CreateEmergencyContactInput {
  caredPersonId: string;
  fullName: string;
  relationship?: string | null;
  /** Requerido (NOT NULL en la tabla) -- se valida no vacío ANTES de llamar a Supabase. */
  phone: string;
  notes?: string | null;
}

/**
 * Da de alta un contacto de emergencia (PGM-23). Campos mínimos: nombre +
 * teléfono -- `emergency_contacts.phone` es NOT NULL en la tabla (a
 * diferencia de `medical_contacts.phone`), así que se valida acá también en
 * el cliente, mismo criterio de "fallar rápido" que `createMedication`.
 */
export async function createEmergencyContact(
  input: CreateEmergencyContactInput
): Promise<ContactsResult<EmergencyContact>> {
  const trimmedFullName = input.fullName.trim();

  if (trimmedFullName.length === 0) {
    return {
      data: null,
      error: { code: 'invalid_full_name', message: 'Ingresá el nombre del contacto.' },
    };
  }

  const trimmedPhone = input.phone.trim();

  if (trimmedPhone.length === 0) {
    return {
      data: null,
      error: {
        code: 'invalid_phone',
        message: 'Ingresá el teléfono del contacto de emergencia.',
      },
    };
  }

  try {
    const userResult = await resolveCurrentUserId();
    if (userResult.error) {
      return { data: null, error: userResult.error };
    }

    const trimmedRelationship = input.relationship?.trim() ?? '';
    const trimmedNotes = input.notes?.trim() ?? '';

    const { data, error } = await supabase
      .from('emergency_contacts')
      .insert({
        cared_person_id: input.caredPersonId,
        full_name: trimmedFullName,
        relationship: trimmedRelationship.length > 0 ? trimmedRelationship : null,
        phone: trimmedPhone,
        notes: trimmedNotes.length > 0 ? trimmedNotes : null,
        created_by: userResult.data,
      })
      .select(EMERGENCY_CONTACT_SELECT_COLUMNS)
      .single();

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsed = emergencyContactRowSchema.safeParse(data);
    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[contactsService] createEmergencyContact response failed validation');
      }
      return {
        data: null,
        error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: mapEmergencyContactRow(parsed.data), error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createEmergencyContact', err) };
  }
}
