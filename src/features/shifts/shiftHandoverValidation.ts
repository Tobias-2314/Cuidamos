import { z } from 'zod';

/**
 * Largo máximo de cada uno de los 4 campos del traspaso de turno (PGM-36).
 * Criterio de producto no negociable: "Traspaso de turno < 30 segundos:
 * máximo 4 campos, escritura mínima" (docs/product-vision.md) -- un límite
 * chico a propósito, mismo espíritu que `MAX_MEDICATION_NOTE_LENGTH`
 * (`medicationFormatting.ts`, PGM-32), pero un poco más generoso porque acá
 * cada campo reemplaza lo que hoy se escribe como nota libre de WhatsApp
 * (ej. "comió bien, durmió toda la tarde, quedó pendiente llamar al médico
 * el lunes"), no una nota de 1-tap como la de medicación.
 */
export const MAX_SHIFT_HANDOVER_FIELD_LENGTH = 280;

/**
 * Valida el largo de un campo ya recortado (`trim()`). Un campo vacío es
 * válido (equivale a "no completado") -- los 4 campos son opcionales a nivel
 * de UI y de DB (ver nota de diseño en
 * `supabase/migrations/20260914160000_shift_handovers.sql`), quien quiera
 * validar "hay contenido" debe chequear el largo por separado.
 *
 * Lógica pura y testeable, sin dependencias de red ni de React Native --
 * mismo criterio que `isValidMedicationNote` (`medicationFormatting.ts`).
 */
export function isValidShiftHandoverField(trimmedValue: string): boolean {
  return trimmedValue.length <= MAX_SHIFT_HANDOVER_FIELD_LENGTH;
}

/**
 * Schema Zod de los 4 campos del traspaso, ya recortados (`trim()`) antes de
 * validar -- usado por `shiftHandoversService.createShiftHandover` para
 * validar la forma del input ANTES de llamar a la RPC (falla rápido, mismo
 * criterio que el resto de los services del repo). Un string vacío se
 * interpreta como "campo no completado", igual que `isValidShiftHandoverField`.
 */
export const shiftHandoverFieldsSchema = z.object({
  resumen: z.string().max(MAX_SHIFT_HANDOVER_FIELD_LENGTH),
  comida: z.string().max(MAX_SHIFT_HANDOVER_FIELD_LENGTH),
  animo: z.string().max(MAX_SHIFT_HANDOVER_FIELD_LENGTH),
  pendientes: z.string().max(MAX_SHIFT_HANDOVER_FIELD_LENGTH),
});

export type ShiftHandoverFields = z.infer<typeof shiftHandoverFieldsSchema>;

/**
 * Un traspaso completamente vacío (los 4 campos en blanco) no aporta ninguna
 * información al siguiente cuidador -- DECISIÓN DE PRODUCTO tomada en esta
 * issue (PGM-36, Frontend/UI), documentada acá porque la migración PGM-35
 * dejó esto explícitamente sin decidir a nivel de DB (ver nota de diseño en
 * `shift_handovers.sql`: "no hay una decisión de producto confirmada... queda
 * para que la issue de RPC/UI... decida"). Se exige al menos un campo no
 * vacío antes de habilitar el submit -- ver NOTES del agente para que el
 * Tech Lead la revise si no es el criterio deseado.
 */
export function hasAnyShiftHandoverContent(fields: ShiftHandoverFields): boolean {
  return (
    fields.resumen.length > 0 ||
    fields.comida.length > 0 ||
    fields.animo.length > 0 ||
    fields.pendientes.length > 0
  );
}
