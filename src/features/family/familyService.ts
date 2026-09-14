import { z } from 'zod';

import { supabase } from '../../lib/supabase';

/**
 * Normalized error shape returned by every function in this module — mismo
 * patrón que `authService.ts` / `shiftsService.ts` / `medicationsService.ts`.
 * Nunca carga el payload crudo de Supabase, solo un `code` estable y un
 * `message` pensado para mostrarse al usuario.
 *
 * EXCEPCIÓN documentada: `acceptFamilyInvitation` es la única función de este
 * módulo que SÍ propaga `error.message` tal cual viene de la RPC en vez de un
 * mensaje genérico — ver el comentario en esa función para el porqué.
 */
export interface FamilyServiceError {
  code: string;
  message: string;
}

export type FamilyResult<T> = { data: T; error: null } | { data: null; error: FamilyServiceError };

export type FamilyMemberRole = 'admin' | 'cuidador';

export interface Family {
  id: string;
  name: string;
}

export interface FamilyInvitation {
  token: string;
  expiresAt: string;
}

export interface AcceptedInvitation {
  familyId: string;
  role: FamilyMemberRole;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

const familyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const roleSchema = z.enum(['admin', 'cuidador']);

const invitationRowSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
});

const acceptInvitationRowSchema = z.object({
  family_id: z.string(),
  role: roleSchema,
});

function normalizeUnexpectedError(context: string, _err: unknown): FamilyServiceError {
  // Nunca exponemos el error crudo -- puede envolver una respuesta de red u
  // otro dato sensible. Solo logueamos un marcador no sensible.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[familyService] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
}

/**
 * Crea una familia nueva y auto-inserta al usuario actual como su admin.
 *
 * Son DOS inserts separados, no una única RPC transaccional -- así lo definió
 * el backend (PGM-15): `families_insert_own` y
 * `family_members_insert_self_as_creator` ya alcanzan vía `.insert()` directo,
 * sin necesidad de una RPC intermedia (a diferencia de `medications`, que sí
 * necesita RPC por los campos cifrados).
 *
 * RIESGO CONOCIDO (ver NOTES del agente): si el primer insert (`families`)
 * tiene éxito pero el segundo (`family_members`) falla (ej. error de red
 * entre ambos requests), la familia queda creada pero el usuario no queda
 * como miembro -- `getCurrentUserFamilyId()` seguiría devolviendo `null` y no
 * hay forma de "reintentar solo el segundo paso" ni de limpiar la familia
 * huérfana desde el cliente. No es una operación atómica porque el backend no
 * expuso una RPC para esto; documentado para que el Tech Lead decida si vale
 * la pena una RPC `security invoker` que envuelva ambos inserts en una
 * transacción.
 */
export async function createFamily(name: string): Promise<FamilyResult<Family>> {
  const trimmedName = name.trim();

  if (trimmedName.length === 0) {
    return {
      data: null,
      error: { code: 'invalid_name', message: 'Ingresá un nombre para la familia.' },
    };
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.id) {
      return {
        data: null,
        error: { code: 'not_authenticated', message: 'Iniciá sesión para crear una familia.' },
      };
    }

    const userId = userData.user.id;

    const { data: familyRow, error: familyError } = await supabase
      .from('families')
      .insert({ name: trimmedName, created_by: userId })
      .select('id, name')
      .single();

    if (familyError) {
      return {
        data: null,
        error: { code: familyError.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    const parsedFamily = familyRowSchema.safeParse(familyRow);
    if (!parsedFamily.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[familyService] create_family response failed validation');
      }
      return { data: null, error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE } };
    }

    const { error: memberError } = await supabase
      .from('family_members')
      .insert({ family_id: parsedFamily.data.id, user_id: userId, role: 'admin' });

    if (memberError) {
      // Ver RIESGO CONOCIDO en el comentario de esta función -- la familia ya
      // quedó creada, pero reportamos error porque el usuario no quedó como
      // miembro (para él, el flujo no funcionó).
      return {
        data: null,
        error: { code: memberError.code || 'db_error', message: GENERIC_ERROR_MESSAGE },
      };
    }

    return { data: { id: parsedFamily.data.id, name: parsedFamily.data.name }, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createFamily', err) };
  }
}

/**
 * Devuelve el rol del usuario actual dentro de `familyId`, o `null` si no es
 * miembro. Usa `family_members_select_own` (PGM-15): la policy ya restringe
 * la lectura a la propia fila del usuario, así que este filtro por
 * `family_id` es solo para acotar la consulta, no un control de acceso
 * adicional.
 */
export async function getCurrentUserRoleInFamily(
  familyId: string
): Promise<FamilyResult<FamilyMemberRole | null>> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.id) {
      return {
        data: null,
        error: { code: 'not_authenticated', message: 'Iniciá sesión para continuar.' },
      };
    }

    const { data, error } = await supabase
      .from('family_members')
      .select('role')
      .eq('family_id', familyId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (error) {
      return { data: null, error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE } };
    }

    if (!data) {
      return { data: null, error: null };
    }

    const parsedRole = roleSchema.safeParse((data as { role?: unknown }).role);
    if (!parsedRole.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[familyService] dropped a family_members row with an unexpected role');
      }
      return { data: null, error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE } };
    }

    return { data: parsedRole.data, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getCurrentUserRoleInFamily', err) };
  }
}

/**
 * Genera una invitación para `familyId` vía la RPC `create_family_invitation`
 * (PGM-19). Solo funciona si quien llama es admin/creador de la familia --
 * `family_invitations_insert_admin` lo hace cumplir server-side, esta función
 * no duplica ese chequeo en el cliente (ver contexto de la issue).
 *
 * `invitedEmail` es puramente informativo (el backend NO envía el email) --
 * ver NOTES del agente sobre el alcance de "invitar por link/email".
 */
export async function createFamilyInvitation(
  familyId: string,
  invitedEmail?: string | null
): Promise<FamilyResult<FamilyInvitation>> {
  try {
    const { data, error } = await supabase.rpc('create_family_invitation', {
      p_family_id: familyId,
      p_invited_email: invitedEmail?.trim() ? invitedEmail.trim() : null,
    });

    if (error) {
      return { data: null, error: { code: error.code || 'db_error', message: GENERIC_ERROR_MESSAGE } };
    }

    // `returns table (...)`: postgrest-js siempre lo devuelve como array.
    const rawRow = Array.isArray(data) ? data[0] : data;
    const parsed = invitationRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[familyService] create_family_invitation response failed validation');
      }
      return { data: null, error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE } };
    }

    return {
      data: { token: parsed.data.token, expiresAt: parsed.data.expires_at },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('createFamilyInvitation', err) };
  }
}

/**
 * Acepta una invitación vía la RPC `accept_family_invitation` (PGM-19).
 *
 * A DIFERENCIA del resto de este módulo, esta función propaga
 * `error.message` TAL CUAL viene de la RPC en vez del mensaje genérico --
 * `accept_family_invitation()` fue diseñada explícitamente en el backend para
 * devolver mensajes legibles en español ("Esta invitación ya fue utilizada",
 * "Esta invitación expiró el %", "Ya sos miembro de esta familia", "La
 * invitación no existe o el token es inválido"), ver comentario de esa
 * función en la migración. Usarlos tal cual es lo pedido explícitamente por
 * el contexto de la issue.
 */
export async function acceptFamilyInvitation(token: string): Promise<FamilyResult<AcceptedInvitation>> {
  try {
    const { data, error } = await supabase.rpc('accept_family_invitation', { p_token: token });

    if (error) {
      return {
        data: null,
        error: { code: error.code || 'invitation_error', message: error.message || GENERIC_ERROR_MESSAGE },
      };
    }

    const rawRow = Array.isArray(data) ? data[0] : data;
    const parsed = acceptInvitationRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[familyService] accept_family_invitation response failed validation');
      }
      return { data: null, error: { code: 'invalid_response', message: GENERIC_ERROR_MESSAGE } };
    }

    return {
      data: { familyId: parsed.data.family_id, role: parsed.data.role },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('acceptFamilyInvitation', err) };
  }
}
