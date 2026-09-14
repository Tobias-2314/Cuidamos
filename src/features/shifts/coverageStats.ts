import type { FamilyMember, Shift } from './shiftsService';

/**
 * Reparto agregado de un cuidador para un rango de turnos ya filtrado (ver
 * `buildCoverageStats`): cuántos turnos tiene asignados y cuántas horas
 * suman.
 */
export interface CoverageStat {
  userId: string;
  shiftCount: number;
  totalHours: number;
}

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Turnos que cuentan para "horas cubiertas" (criterio de producto, ver NOTES
 * del agente que implementó PGM-28): se cuentan TODOS los turnos no
 * cancelados del mes (`scheduled`, `in_progress`, `completed`) -- el panel
 * muestra el reparto del calendario planificado, no un registro retroactivo
 * de asistencia. `cancelled` se excluye porque ese turno nunca se llegó a
 * cubrir.
 */
function countsForCoverage(shift: Shift): boolean {
  return shift.status !== 'cancelled';
}

/** Duración de un turno en horas (fraccionarias). Nunca negativa. */
function shiftHours(shift: Shift): number {
  const durationMs = new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime();
  return durationMs > 0 ? durationMs / MS_PER_HOUR : 0;
}

/**
 * Agrega una lista de turnos (ya traída para un rango, ej. con
 * `getShiftsForFamily(familyId, getMonthRange(referenceDate))`) por
 * cuidador: horas totales cubiertas + cantidad de turnos.
 *
 * Devuelve una fila por cada miembro de `members` -- incluidos los que no
 * cubrieron NINGÚN turno en el rango (0 horas, 0 turnos es una fila visible
 * a propósito: criterio de producto #4, "es visible el reparto entre
 * cuidadores" incluye mostrar que alguien no cubrió nada, no solo repartir
 * crédito entre los que sí cubrieron algo).
 *
 * Si un turno está asignado a un `assigned_to` que ya no aparece en
 * `members` (ej. alguien que dejó la familia pero sus turnos pasados siguen
 * asignados), igual se cuenta -- no se pierde información, solo no tendrá
 * una fila "vacía" preexistente antes de sumar su turno.
 *
 * Orden: de mayor a menor horas cubiertas (empate -> más turnos primero,
 * empate final -> orden estable de `members`) para que el desbalance de
 * reparto sea visible de un vistazo, sin tener que leer números.
 *
 * Lógica pura, sin dependencias de React Native -- mismo criterio que
 * `calendarSections.ts` / `shiftDateTimeInput.ts`: es la unidad de trabajo
 * real de la pantalla de reparto, separada del componente visual para poder
 * testearla con Jest simple.
 */
export function buildCoverageStats(
  shifts: readonly Shift[],
  members: readonly FamilyMember[]
): CoverageStat[] {
  const statsByUserId = new Map<string, CoverageStat>();

  for (const member of members) {
    statsByUserId.set(member.userId, { userId: member.userId, shiftCount: 0, totalHours: 0 });
  }

  for (const shift of shifts) {
    if (!countsForCoverage(shift)) {
      continue;
    }

    const existing = statsByUserId.get(shift.assignedTo);
    const base = existing ?? { userId: shift.assignedTo, shiftCount: 0, totalHours: 0 };
    statsByUserId.set(shift.assignedTo, {
      userId: base.userId,
      shiftCount: base.shiftCount + 1,
      totalHours: base.totalHours + shiftHours(shift),
    });
  }

  return Array.from(statsByUserId.values()).sort((a, b) => {
    if (b.totalHours !== a.totalHours) {
      return b.totalHours - a.totalHours;
    }
    return b.shiftCount - a.shiftCount;
  });
}

const MONTH_LABELS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** Formatea un mes como "Septiembre 2026", para el header de `CoverageScreen`. */
export function formatMonthLabel(referenceDate: Date): string {
  return `${MONTH_LABELS_ES[referenceDate.getMonth()]} ${referenceDate.getFullYear()}`;
}

/**
 * Ancho proporcional (0-100) de la barra visual de `stat` respecto del
 * cuidador con más horas del grupo -- para que el desbalance se vea de un
 * vistazo (criterio #2 del alcance de PGM-28), sin agregar una librería de
 * gráficos nueva (YAGNI): el caller renderiza esto como el `width` de un
 * `View`.
 *
 * Si nadie cubrió ninguna hora todavía (`maxHours === 0`), devuelve 0 para
 * todos en vez de dividir por cero.
 */
export function coverageBarWidthPercent(stat: CoverageStat, allStats: readonly CoverageStat[]): number {
  const maxHours = allStats.reduce((max, s) => Math.max(max, s.totalHours), 0);
  if (maxHours <= 0) {
    return 0;
  }
  return (stat.totalHours / maxHours) * 100;
}
