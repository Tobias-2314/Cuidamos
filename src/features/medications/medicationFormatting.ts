import type { Medication } from './medicationsService';

/**
 * Largo máximo de la nota corta opcional (PGM-32). Un límite chico a
 * propósito: el criterio de producto es "nota corta", no un campo de texto
 * libre extenso — y una nota más larga tomaría más tiempo de tipear, en
 * contra del objetivo de "marcar como dado en <3 tap" para una acción de
 * alta frecuencia.
 */
export const MAX_MEDICATION_NOTE_LENGTH = 140;

/**
 * Valida el largo de una nota corta ya recortada (`trim()`). Una nota vacía
 * es válida (equivale a "sin nota") — quien quiera validar "hay contenido"
 * debe chequear el largo por separado.
 *
 * Lógica pura y testeable, sin dependencias de red ni de React Native —
 * mismo criterio que `isValidEmail.ts` (PGM-17) / `calendarSections.ts`
 * (PGM-26).
 */
export function isValidMedicationNote(trimmedNote: string): boolean {
  return trimmedNote.length <= MAX_MEDICATION_NOTE_LENGTH;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Formatea una hora real de toma (`taken_at` ISO) como "HH:MM". */
export function formatTakenAtTime(takenAtIso: string): string {
  const date = new Date(takenAtIso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Formatea una hora real de toma (`taken_at` ISO) como "DD/MM HH:MM" (PGM-33).
 *
 * A diferencia de `formatTakenAtTime` (usada en la confirmación inline de
 * `MedicationsScreen`, donde "hoy" está implícito porque la toma acaba de pasar), el
 * historial de PGM-33 lista tomas de días distintos -- mostrar solo la hora sería
 * ambiguo ("08:00" ¿de cuándo?). Se agrega la fecha corta, sin año: alcanza para
 * distinguir entre días dentro del historial reciente, sin la verbosidad de un
 * datetime completo.
 */
export function formatTakenAtDateTime(takenAtIso: string): string {
  const date = new Date(takenAtIso);
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  return `${day}/${month} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Subtítulo de una fila de medicamento: dosis y, si existe, horario libre.
 * Ej. "500mg · cada 8 horas" o solo "500mg" cuando no hay `schedule`.
 */
export function formatMedicationSubtitle(medication: Pick<Medication, 'dose' | 'schedule'>): string {
  return medication.schedule ? `${medication.dose} · ${medication.schedule}` : medication.dose;
}
