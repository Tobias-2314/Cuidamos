import { z } from 'zod';

/**
 * Largo máximo de "nombre" y "relación con la persona cuidada" (PGM-20).
 * Mismo espíritu que `MAX_SHIFT_HANDOVER_FIELD_LENGTH`
 * (`shiftHandoverValidation.ts`, PGM-36): un límite chico y razonable para un
 * campo de texto corto, no hay ningún requisito de producto que pida algo
 * distinto.
 */
export const MAX_CARE_PROFILE_FIELD_LENGTH = 80;

/**
 * A diferencia de `isValidShiftHandoverField` (donde un campo vacío es
 * válido porque los 4 campos son opcionales), acá "nombre" y "relación" SON
 * el contenido del formulario -- un campo vacío no tiene sentido como
 * perfil guardado, así que se exige no-vacío además del largo máximo.
 *
 * Lógica pura y testeable, sin dependencias de red ni de React Native --
 * mismo criterio que `isValidShiftHandoverField`/`isValidMedicationNote`.
 */
export function isValidCareProfileField(trimmedValue: string): boolean {
  return trimmedValue.length > 0 && trimmedValue.length <= MAX_CARE_PROFILE_FIELD_LENGTH;
}

/**
 * Schema Zod de los 2 campos del perfil, ya recortados (`trim()`) antes de
 * validar -- usado por `careProfileService.updateCareProfile` para validar
 * el shape del input ANTES de intentar guardar nada (falla rápido, mismo
 * criterio que el resto de los services del repo).
 */
export const careProfileFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ingresá tu nombre.')
    .max(MAX_CARE_PROFILE_FIELD_LENGTH, `El nombre puede tener como máximo ${MAX_CARE_PROFILE_FIELD_LENGTH} caracteres.`),
  relation: z
    .string()
    .trim()
    .min(1, 'Ingresá tu relación con la persona cuidada.')
    .max(
      MAX_CARE_PROFILE_FIELD_LENGTH,
      `La relación puede tener como máximo ${MAX_CARE_PROFILE_FIELD_LENGTH} caracteres.`
    ),
});

export type CareProfileFields = z.infer<typeof careProfileFieldsSchema>;
