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
 * Lo único que HOY existe sobre el cuidador logueado (PGM-20 -- ver NOTES del
 * agente para el detalle completo del gap de producto):
 * - `email`: viene de la sesión de Supabase Auth, no hay que persistir nada.
 * - `role`: `family_members.role` ('admin' | 'cuidador'), ya resuelto vía
 *   `getCurrentUserRoleInFamily` (PGM-19). `null` cuando el usuario todavía
 *   no tiene familia.
 *
 * NO incluye `name` ni `relationToCaredPerson` -- no existe ninguna
 * tabla/columna donde persistirlos todavía. Ver `updateCareProfile` más
 * abajo y las NOTES del agente para la migración de Backend que hace falta.
 */
export interface CareProfile {
  email: string;
  role: FamilyMemberRole | null;
}

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

/**
 * Mensaje explícito de "todavía no se puede guardar esto" -- a propósito
 * distinto del genérico de error de red/DB, para que la UI pueda explicarle
 * al usuario POR QUÉ no se guardó (no es un bug transitorio, es una feature
 * incompleta del lado de Backend) en vez de sugerirle "reintentar".
 */
const NOT_PERSISTABLE_MESSAGE =
  'Todavía no podemos guardar tu nombre ni tu relación con la persona cuidada -- esta ' +
  'parte del perfil está en desarrollo. Por ahora podés seguir usando la app con tu email.';

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

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error) {
      return { data: null, error: familyResult.error };
    }

    if (!familyResult.data) {
      return { data: { email, role: null }, error: null };
    }

    const roleResult = await getCurrentUserRoleInFamily(familyResult.data);
    if (roleResult.error) {
      return { data: null, error: roleResult.error };
    }

    return { data: { email, role: roleResult.data }, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getCurrentUserCareProfile', err) };
  }
}

export interface UpdateCareProfileInput {
  name: string;
  relation: string;
}

/**
 * "Guarda" el nombre y la relación con la persona cuidada -- EN LOS HECHOS,
 * TODAVÍA NO GUARDA NADA. Ver NOTES del agente (Frontend, PGM-20) para el
 * detalle completo: revisando `supabase/migrations/` completo no existe
 * ninguna tabla `profiles` ni ninguna columna de nombre/relación para un
 * cuidador -- la tabla `profiles` que mencionaba la descripción original de
 * PGM-5 (F1) nunca se construyó.
 *
 * TODO(PGM-backend): falta una migración de Backend antes de que esta
 * función pueda hacer algo real. Mismo criterio que
 * `shiftHandoversService.createShiftHandover` (PGM-36) documentando el
 * bloqueante técnico, PERO con una diferencia importante: `create_shift_handover`
 * SÍ deja el `supabase.rpc(...)` real armado porque el nombre de esa RPC y su
 * shape de parámetros ya estaban decididos (ver `shift_handovers.sql`). Acá
 * NO hay ninguna tabla/columna/RPC decidida todavía -- inventar un nombre
 * (ej. `profiles`, `family_members.display_name`) sería asumir una decisión
 * de Backend que no se tomó, y un `.update()`/`.upsert()` contra algo que no
 * existe rompería en runtime con un error de Postgres poco claro para quien
 * lea los logs. Por eso el punto de integración real queda COMENTADO acá
 * abajo en vez de descomentado-pero-roto:
 *
 * ```ts
 * // const { data: userData } = await supabase.auth.getUser();
 * // const familyResult = await getCurrentUserFamilyId();
 * // const { error } = await supabase
 * //   .from('profiles') // o la tabla/columna que decida Backend
 * //   .upsert({
 * //     user_id: userData.user.id,
 * //     family_id: familyResult.data,
 * //     display_name: fields.name,
 * //     relation_to_cared_person: fields.relation,
 * //   });
 * ```
 *
 * Mientras tanto, esta función SÍ valida el input (mismo criterio de "falla
 * rápido" que el resto del repo) y devuelve un error explícito y distinto
 * del genérico (`code: 'not_implemented'`) para que la UI pueda explicarle
 * al usuario que esto está en desarrollo, no que hubo una falla transitoria.
 */
export async function updateCareProfile(
  input: UpdateCareProfileInput
): Promise<CareProfileResult<never>> {
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

  return {
    data: null,
    error: { code: 'not_implemented', message: NOT_PERSISTABLE_MESSAGE },
  };
}
