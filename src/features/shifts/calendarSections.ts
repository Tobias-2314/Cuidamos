import type { Shift, ShiftStatus } from './shiftsService';

export type CalendarView = 'weekly' | 'monthly';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface CalendarSection {
  key: string;
  title: string;
  data: Shift[];
}

const WEEKDAY_LABELS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

export const SHIFT_STATUS_LABELS_ES: Record<ShiftStatus, string> = {
  scheduled: 'Agendado',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Lunes de la semana que contiene `date` (semana Lunes-Domingo). */
function startOfWeek(date: Date): Date {
  const day = date.getDay(); // 0 (domingo) .. 6 (sábado)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(date), diffToMonday);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatShortDate(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Rango [lunes 00:00, lunes siguiente 00:00) de la semana de `referenceDate`. */
export function getWeekRange(referenceDate: Date): DateRange {
  const from = startOfWeek(referenceDate);
  return { from, to: addDays(from, 7) };
}

/** Rango [1º del mes, 1º del mes siguiente) de `referenceDate`. */
export function getMonthRange(referenceDate: Date): DateRange {
  const from = startOfMonth(referenceDate);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to };
}

export function getRangeForView(view: CalendarView, referenceDate: Date): DateRange {
  return view === 'weekly' ? getWeekRange(referenceDate) : getMonthRange(referenceDate);
}

/**
 * Formatea el rango horario de un turno, ej. "08:00 - 14:30".
 *
 * Toma solo `startsAt`/`endsAt` (`Pick<Shift, ...>`, no el `Shift` completo) — PGM-37
 * (`LatestShiftHandoverCard`) reusa esta función para el rango horario del turno de un
 * traspaso, que no trae un `Shift` completo (viene resuelto por la RPC de lectura junto
 * con los campos del traspaso). Todo caller existente que ya pasaba un `Shift` sigue
 * funcionando sin cambios (`Shift` satisface este tipo más chico estructuralmente).
 */
export function formatShiftTimeRange(shift: Pick<Shift, 'startsAt' | 'endsAt'>): string {
  return `${formatTime(new Date(shift.startsAt))} - ${formatTime(new Date(shift.endsAt))}`;
}

/**
 * Agrupa una lista plana de turnos en secciones para un `SectionList`:
 * - `weekly`: una sección por día (solo los días que efectivamente tienen
 *   turnos, en orden cronológico).
 * - `monthly`: una sección por semana (el lunes de esa semana identifica la
 *   sección), también solo las semanas con turnos.
 *
 * Lógica pura y testeable, sin dependencias de red ni de React Native —
 * mismo criterio que `isValidEmail.ts` (PGM-17): esta función es la unidad
 * de trabajo real de la pantalla de calendario, separada del componente
 * visual para poder testearla con Jest simple.
 */
export function buildCalendarSections(shifts: readonly Shift[], view: CalendarView): CalendarSection[] {
  const sorted = [...shifts].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  const sectionsByKey = new Map<string, CalendarSection>();

  for (const shift of sorted) {
    const startDate = new Date(shift.startsAt);
    const sectionStart = view === 'weekly' ? startOfDay(startDate) : startOfWeek(startDate);
    const key = dateKey(sectionStart);
    const title =
      view === 'weekly'
        ? `${WEEKDAY_LABELS_ES[sectionStart.getDay()]} ${formatShortDate(sectionStart)}`
        : `Semana del ${formatShortDate(sectionStart)}`;

    const existing = sectionsByKey.get(key);
    if (existing) {
      existing.data.push(shift);
    } else {
      sectionsByKey.set(key, { key, title, data: [shift] });
    }
  }

  // Insertion order into the Map follows `sorted`, so this is already
  // chronological — no extra sort needed.
  return Array.from(sectionsByKey.values());
}
