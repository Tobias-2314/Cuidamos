import { z } from 'zod';

import { supabase } from '../../lib/supabase';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { getCurrentUserRoleInFamily, type FamilyMemberRole } from './familyService';
import { careProfileFieldsSchema } from './careProfileValidation';

/**
 * Normalized error shape returned by every function in this module -- mismo
 * patrón que `familyService.ts`/`shiftHandoversService.ts`. Nunca lleva el
 * error crudo de Supabase, solo un `code` estable y un `message` pensado
 * para mostrarse al usuario.
 */
export interface CareProfileServiceError {
  code: string;
  message: string;
}

export type CareProfileResult<T> =
  | { data: T; error: null }
  | { data: null; error: CareProfileServiceError };

/**
 * Perfil de cuidador (PGM-20 + migración de Backend
 * 20260916150000_profiles.sql):
 * - `email`: viene de la sesión de Supabase Auth, no se persiste en `profiles`.
 * - `role`: `family_members.role` ('admin' | 'cuidador'), resuelto vía
 *   `getCurrentUserRoleInFamily` (PGM-19). `null` cuando el usuario todavía
 *   no tiene familia.
 * - `name` / `relationToCaredPerson`: `profiles.display_name` /
 *   `profiles.relation_to_cared_person`. `null` cuando el usuario todavía no
 *   guardó su perfil (no existe fila en `profiles`) o dejó ese campo vacío.
 */
export interface CareProfile {
  email: string;
  role: FamilyMemberRole | null;
  name: string | null;
  relationToCaredPerson: string | null;
}

const profileRowSchema = z.object({
  display_name: z.string().nullable(),
  relation_to_cared_person: z.string().nullable(),
});

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

function normalizeUnexpectedError(context: string, _err: unknown): CareProfileServiceError {
  // Nunca exponemos el error crudo -- puede envolver una respuesta de red u
  // otro dato sensible. Solo logueamos un marcador no sensible.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[careProfileService] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
}

/**
 * Trae lo que hoy se puede mostrar en "mi perfil de cuidador": email (de la
 * sesión) + rol dentro de la familia actual (si tiene una). No requiere
 * ninguna tabla nueva -- reutiliza `getCurrentUserFamilyId`
 * (`shiftsService.ts`, PGM-26) y `getCurrentUserRoleInFamily`
 * (`familyService.ts`, PGM-15), mismo criterio de reuso que
 * `InviteFamilyScreen` ya aplica para resolver familia + rol del usuario
 * actual.
 */
export async function getCurrentUserCareProfile(): Promise<CareProfileResult<CareProfile>> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      return {
        data: null,
        error: { code: 'not_authenticated', message: 'Iniciá sesión para ver tu perfil.' },
      };
    }

    const email = userData.user.email;
    const userId = userData.user.id;

    // `profiles` es dueño-only (ver 20260916150000_profiles.sql) -- `.maybeSingle()`
    // porque un usuario que todavía no guardó su perfil simplemente no tiene fila
    // (no es un error, es el estado inicial de cualquier cuenta nueva).
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('display_name, relation_to_cared_person')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      return { data: null, error: normalizeUnexpectedError('getCurrentUserCareProfile:profile', profileError) };
    }

    let name: string | null = null;
    let relationToCaredPerson: string | null = null;
    if (profileRow) {
      const parsedProfile = profileRowSchema.safeParse(profileRow);
      if (parsedProfile.success) {
        name = parsedProfile.data.display_name;
        relationToCaredPerson = parsedProfile.data.relation_to_cared_person;
      }
    }

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error) {
      return { data: null, error: familyResult.error };
    }

    if (!familyResult.data) {
      return { data: { email, role: null, name, relationToCaredPerson }, error: null };
    }

    const roleResult = await getCurrentUserRoleInFamily(familyResult.data);
    if (roleResult.error) {
      return { data: null, error: roleResult.error };
    }

    return { data: { email, role: roleResult.data, name, relationToCaredPerson }, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getCurrentUserCareProfile', err) };
  }
}

export interface UpdateCareProfileInput {
  name: string;
  relation: string;
}

/**
 * Guarda (upsert) el nombre y la relación con la persona cuidada en `profiles`
 * (PGM-20 + migración de Backend 20260916150000_profiles.sql). `display_name`/
 * `relation_to_cared_person` NO son datos de salud del art. 9 -- se guardan en
 * texto plano, sin cifrar (a diferencia de condition_notes/medications/
 * shift_handovers), consistente con el diseño de esa tabla.
 *
 * `family_id` se resuelve y guarda junto con el perfil (puede ser `null` si el
 * usuario todavía no tiene familia -- `profiles.family_id` es nullable a
 * propósito, ver esa migración). RLS (`profiles_insert_own`/`profiles_update_own`)
 * ya garantiza que un usuario solo puede escribir su propia fila -- esta función
 * no necesita, ni intenta, validar eso por su cuenta.
 */
export async function updateCareProfile(
  input: UpdateCareProfileInput
): Promise<CareProfileResult<CareProfile>> {
  const parsed = careProfileFieldsSchema.safeParse({ name: input.name, relation: input.relation });

  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? GENERIC_ERROR_MESSAGE,
      },
    };
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      return {
        data: null,
        error: { code: 'not_authenticated', message: 'Iniciá sesión para guardar tu perfil.' },
      };
    }

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error) {
      return { data: null, error: familyResult.error };
    }

    const { error: upsertError } = await supabase.from('profiles').upsert({
      user_id: userData.user.id,
      family_id: familyResult.data,
      display_name: parsed.data.name,
      relation_to_cared_person: parsed.data.relation,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) {
      return {
        data: null,
        error: { code: upsertError.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    let role: FamilyMemberRole | null = null;
    if (familyResult.data) {
      const roleResult = await getCurrentUserRoleInFamily(familyResult.data);
      if (roleResult.error) {
        return { data: null, error: roleResult.error };
      }
      role = roleResult.data;
    }

    return {
      data: {
        email: userData.user.email,
        role,
        name: parsed.data.name,
        relationToCaredPerson: parsed.data.relation,
      },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('updateCareProfile', err) };
  }
}
