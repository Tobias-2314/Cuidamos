import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getAssignedToLabel } from './assignedToLabel';
import {
  formatShiftTimeRange,
  getWeekDays,
  getWeekRange,
  isSameDay,
  SHIFT_STATUS_LABELS_ES,
  WEEKDAY_LABELS_ES,
  type CalendarView,
} from './calendarSections';
import { LatestShiftHandoverCard } from './LatestShiftHandoverCard';
import { getCurrentUserFamilyId, getShiftsForFamily, type Shift } from './shiftsService';
import { supabase } from '../../lib/supabase';
import { getCaregiverColor } from '../../lib/caregiverColor';
import { colors, fontFamily, radii } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconClock, IconPlus } from '../../components/icons';

/**
 * `phase` tracks the top-level state of the screen, following the same
 * explicit-states approach as `LoginScreen.tsx` (PGM-17):
 * - 'loading': resolving the user's family_id and/or fetching shifts.
 * - 'no-family': the user is authenticated but not a member of any family
 *   yet. PGM-18 closed the gap flagged in PGM-26 (no family creation screen
 *   existed) — this state now offers a CTA into `/family/create`.
 * - 'error': something failed (auth, family lookup, or shifts fetch).
 * - 'ready': shifts loaded (may be an empty list — rendered per-day, not a
 *   blanket error).
 */
type Phase = 'loading' | 'no-family' | 'error' | 'ready';

function formatMonthLabel(date: Date): string {
  const label = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function CalendarScreen() {
  const router = useRouter();
  const [view, setView] = useState<CalendarView>('weekly');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadShiftsForFamily = useCallback(
    async (resolvedFamilyId: string, resolvedView: CalendarView, resolvedReferenceDate: Date) => {
      setPhase('loading');
      setErrorMessage(null);

      const range =
        resolvedView === 'weekly'
          ? getWeekRange(resolvedReferenceDate)
          : { from: resolvedReferenceDate, to: resolvedReferenceDate };
      const result = await getShiftsForFamily(resolvedFamilyId, range);

      if (result.error) {
        setErrorMessage(result.error.message);
        setPhase('error');
        return;
      }

      setShifts(result.data);
      setPhase('ready');
    },
    []
  );

  const resolveUserAndFamily = useCallback(async () => {
    setPhase('loading');
    setErrorMessage(null);
    setFamilyId(null);

    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData.user?.id ?? null);

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error) {
      setErrorMessage(familyResult.error.message);
      setPhase('error');
      return;
    }

    if (!familyResult.data) {
      setPhase('no-family');
      return;
    }

    // Setting familyId triggers the shifts-fetching effect below — it owns
    // the 'loading' -> 'ready'/'error' transition for the actual fetch.
    setFamilyId(familyResult.data);
  }, []);

  // Resolve the current user + their family once on mount.
  useEffect(() => {
    resolveUserAndFamily();
  }, [resolveUserAndFamily]);

  // Re-fetch shifts whenever the view or the visible range changes, as long
  // as we already know the family_id.
  useEffect(() => {
    if (!familyId) {
      return;
    }
    loadShiftsForFamily(familyId, view, referenceDate);
  }, [familyId, view, referenceDate, loadShiftsForFamily]);

  const handleRetry = useCallback(() => {
    if (familyId) {
      loadShiftsForFamily(familyId, view, referenceDate);
    } else {
      resolveUserAndFamily();
    }
  }, [familyId, view, referenceDate, loadShiftsForFamily, resolveUserAndFamily]);

  function handleStep(direction: -1 | 1) {
    setReferenceDate((current) => {
      const next = new Date(current);
      if (view === 'weekly') {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setMonth(next.getMonth() + direction);
      }
      return next;
    });
    setSelectedDayIndex(0);
  }

  const weekDays = view === 'weekly' ? getWeekDays(getWeekRange(referenceDate)) : [];
  const shiftsByDay = weekDays.map((day) =>
    shifts.filter((shift) => isSameDay(new Date(shift.startsAt), day))
  );
  const selectedDayShifts = shiftsByDay[selectedDayIndex] ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerTitle}>Turnos</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/shifts/coverage')}
              accessibilityRole="button"
              accessibilityLabel="Ver reparto de turnos del mes"
            >
              <Text style={styles.coverageLink}>Cobertura</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/shifts/new')}
              accessibilityRole="button"
              accessibilityLabel="Asignar turno nuevo"
              style={styles.addButton}
            >
              <IconPlus size="sm" color={colors.white} />
            </Pressable>
          </View>
        </View>

        <View style={styles.viewToggleRow}>
          <ViewToggleButton label="Semana" active={view === 'weekly'} onPress={() => setView('weekly')} />
          <ViewToggleButton label="Mes" active={view === 'monthly'} onPress={() => setView('monthly')} />
        </View>

        {view === 'weekly' ? (
          <>
            <View style={styles.monthNavRow}>
              <Pressable
                onPress={() => handleStep(-1)}
                accessibilityRole="button"
                accessibilityLabel="Semana anterior"
              >
                <IconChevronLeft size="sm" color={colors.ink2} />
              </Pressable>
              <Text style={styles.monthLabel}>{formatMonthLabel(referenceDate)}</Text>
              <Pressable
                onPress={() => handleStep(1)}
                accessibilityRole="button"
                accessibilityLabel="Semana siguiente"
              >
                <IconChevronRight size="sm" color={colors.ink2} />
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayPickerRow}
            >
              {weekDays.map((day, index) => (
                <DayPill
                  key={day.toISOString()}
                  date={day}
                  isSelected={index === selectedDayIndex}
                  hasShift={shiftsByDay[index]?.length > 0}
                  onPress={() => setSelectedDayIndex(index)}
                />
              ))}
            </ScrollView>
          </>
        ) : (
          <View style={styles.monthNavRow}>
            <Pressable
              onPress={() => handleStep(-1)}
              accessibilityRole="button"
              accessibilityLabel="Mes anterior"
            >
              <IconChevronLeft size="sm" color={colors.ink2} />
            </Pressable>
            <Text style={styles.monthLabel}>{formatMonthLabel(referenceDate)}</Text>
            <Pressable
              onPress={() => handleStep(1)}
              accessibilityRole="button"
              accessibilityLabel="Mes siguiente"
            >
              <IconChevronRight size="sm" color={colors.ink2} />
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {familyId ? (
          <LatestShiftHandoverCard familyId={familyId} currentUserId={currentUserId} />
        ) : null}

        {phase === 'loading' ? (
          <View style={styles.loadingStack}>
            <Skeleton height={112} />
            <Skeleton height={112} />
          </View>
        ) : null}

        {phase === 'error' ? (
          <View style={styles.centerContent}>
            <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {errorMessage}
            </Text>
            <Button label="Reintentar" onPress={handleRetry} />
          </View>
        ) : null}

        {phase === 'no-family' ? (
          <EmptyState
            icon={<IconCalendar size="lg" color={colors.brand} />}
            title="Todavía no formás parte de ninguna familia."
            desc="Creá una familia para empezar a coordinar turnos, o pedile a quien te invitó el link de invitación."
            action={<Button label="Crear familia" onPress={() => router.push('/family/create')} full />}
          />
        ) : null}

        {phase === 'ready' && view === 'weekly' ? (
          <View style={styles.weeklyReady}>
            <Text style={styles.selectedDayLabel}>
              {WEEKDAY_LABELS_ES[weekDays[selectedDayIndex]?.getDay() ?? 0]}
            </Text>

            {selectedDayShifts.length > 0 ? (
              <View style={styles.dayCardStack}>
                {selectedDayShifts.map((shift, index) => (
                  <ShiftDayCard
                    key={shift.id}
                    shift={shift}
                    index={index}
                    currentUserId={currentUserId}
                    onReassignPress={() => router.push(`/shifts/${shift.id}/reassign`)}
                    onHandoverPress={() => router.push(`/shifts/${shift.id}/handover`)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.noShiftToday}>
                <Text style={styles.noShiftTodayText}>Sin turno para este día</Text>
              </View>
            )}

            <View style={styles.weekListSection}>
              <Text style={styles.weekListTitle}>Esta semana</Text>
              <View style={styles.weekListStack}>
                {weekDays.map((day, index) =>
                  index === selectedDayIndex ? null : (
                    <WeekListRow
                      key={day.toISOString()}
                      date={day}
                      dayShifts={shiftsByDay[index] ?? []}
                      currentUserId={currentUserId}
                      onPress={() => setSelectedDayIndex(index)}
                    />
                  )
                )}
              </View>
            </View>
          </View>
        ) : null}

        {phase === 'ready' && view === 'monthly' ? (
          <MonthlyShiftsList shifts={shifts} currentUserId={currentUserId} router={router} />
        ) : null}
      </ScrollView>
    </View>
  );
}

interface ViewToggleButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function ViewToggleButton({ label, active, onPress }: ViewToggleButtonProps) {
  return (
    <Pressable
      style={[styles.toggleButton, active && styles.toggleButtonActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver ${label.toLowerCase()}`}
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.toggleButtonText, active && styles.toggleButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

interface DayPillProps {
  date: Date;
  isSelected: boolean;
  hasShift: boolean;
  onPress: () => void;
}

/** Pastilla de día del selector semanal -- calco del día del `CalendarScreen` de Figma. */
function DayPill({ date, isSelected, hasShift, onPress }: DayPillProps) {
  const weekdayAbbrev = WEEKDAY_LABELS_ES[date.getDay()].slice(0, 3);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${WEEKDAY_LABELS_ES[date.getDay()]} ${date.getDate()}`}
      accessibilityState={{ selected: isSelected }}
      style={[styles.dayPill, isSelected && styles.dayPillActive]}
    >
      <Text style={[styles.dayPillWeekday, isSelected && styles.dayPillTextActive]}>{weekdayAbbrev}</Text>
      <Text style={[styles.dayPillNumber, isSelected && styles.dayPillTextActive]}>{date.getDate()}</Text>
      <View
        style={[
          styles.dayPillDot,
          hasShift && styles.dayPillDotFilled,
          isSelected && styles.dayPillDotSelected,
        ]}
      />
    </Pressable>
  );
}

interface ShiftDayCardProps {
  shift: Shift;
  index?: number;
  currentUserId: string | null;
  onReassignPress: () => void;
  onHandoverPress: () => void;
}

/** Tarjeta del turno del día seleccionado -- calco de la `Card` de datos del Figma. */
function ShiftDayCard({ shift, index, currentUserId, onReassignPress, onHandoverPress }: ShiftDayCardProps) {
  const assigneeLabel = getAssignedToLabel(shift.assignedTo, currentUserId);
  const avatarColor = getCaregiverColor(shift.assignedTo, shift.assignedTo === currentUserId);

  return (
    <Card style={styles.dayCard} index={index}>
      <View style={styles.dayCardHeader}>
        <Avatar name={assigneeLabel} color={avatarColor} />
        <View style={styles.dayCardHeaderText}>
          <Text style={styles.dayCardName}>{assigneeLabel}</Text>
          {shift.caredPersonName ? (
            <Text style={styles.dayCardCaredPerson}>{shift.caredPersonName}</Text>
          ) : null}
        </View>
        <Badge label={SHIFT_STATUS_LABELS_ES[shift.status]} variant="brand" />
      </View>

      <View style={styles.dayCardTimeRow}>
        <IconClock size="sm" color={colors.ink2} />
        <Text style={styles.dayCardTime}>{formatShiftTimeRange(shift)}</Text>
      </View>

      <View style={styles.dayCardActions}>
        <Button label="Reasignar" onPress={onReassignPress} variant="secondary" size="sm" />
        <Button label="Cerrar turno" onPress={onHandoverPress} variant="secondary" size="sm" />
      </View>
    </Card>
  );
}

interface WeekListRowProps {
  date: Date;
  dayShifts: Shift[];
  currentUserId: string | null;
  onPress: () => void;
}

/** Fila compacta de "esta semana" -- calco del listado del Figma, un turno por fila. */
function WeekListRow({ date, dayShifts, currentUserId, onPress }: WeekListRowProps) {
  const firstShift = dayShifts[0];
  const weekdayAbbrev = WEEKDAY_LABELS_ES[date.getDay()].slice(0, 3);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver ${WEEKDAY_LABELS_ES[date.getDay()]} ${date.getDate()}`}
      style={styles.weekRow}
    >
      <Text style={styles.weekRowDay}>{weekdayAbbrev}</Text>
      {firstShift ? (
        <>
          <View
            style={[
              styles.weekRowDot,
              {
                backgroundColor: getCaregiverColor(
                  firstShift.assignedTo,
                  firstShift.assignedTo === currentUserId
                ),
              },
            ]}
          />
          <Avatar
            name={getAssignedToLabel(firstShift.assignedTo, currentUserId)}
            color={getCaregiverColor(firstShift.assignedTo, firstShift.assignedTo === currentUserId)}
            size="sm"
          />
          <Text style={styles.weekRowName} numberOfLines={1}>
            {getAssignedToLabel(firstShift.assignedTo, currentUserId)}
          </Text>
          <Text style={styles.weekRowTime}>{formatShiftTimeRange(firstShift)}</Text>
        </>
      ) : (
        <Text style={styles.weekRowEmpty}>Sin turno</Text>
      )}
    </Pressable>
  );
}

interface MonthlyShiftsListProps {
  shifts: Shift[];
  currentUserId: string | null;
  router: ReturnType<typeof useRouter>;
}

/**
 * Vista mensual -- el prototipo de Figma Make no tiene una pantalla de mes
 * (su `CalendarScreen` es 100% semanal), así que acá no hay una referencia
 * de diseño que calcar. Se mantiene como una lista simple agrupada por
 * semana, reusando los mismos componentes (`Card`, `Badge`) para que no
 * desentone visualmente con el resto de la pantalla.
 */
function MonthlyShiftsList({ shifts, currentUserId, router }: MonthlyShiftsListProps) {
  if (shifts.length === 0) {
    return (
      <View style={styles.centerContent}>
        <Text style={styles.noShiftTodayText}>No hay turnos este mes.</Text>
      </View>
    );
  }

  const sorted = [...shifts].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  return (
    <View style={styles.dayCardStack}>
      {sorted.map((shift, index) => (
        <Card key={shift.id} style={styles.dayCard} index={index}>
          <View style={styles.dayCardHeader}>
            <Avatar
              name={getAssignedToLabel(shift.assignedTo, currentUserId)}
              color={getCaregiverColor(shift.assignedTo, shift.assignedTo === currentUserId)}
            />
            <View style={styles.dayCardHeaderText}>
              <Text style={styles.dayCardName}>
                {getAssignedToLabel(shift.assignedTo, currentUserId)}
              </Text>
              <Text style={styles.dayCardCaredPerson}>{formatShiftTimeRange(shift)}</Text>
            </View>
            <Badge label={SHIFT_STATUS_LABELS_ES[shift.status]} variant="brand" />
          </View>
          <View style={styles.dayCardActions}>
            <Button
              label="Reasignar"
              onPress={() => router.push(`/shifts/${shift.id}/reassign`)}
              variant="secondary"
              size="sm"
            />
            <Button
              label="Cerrar turno"
              onPress={() => router.push(`/shifts/${shift.id}/handover`)}
              variant="secondary"
              size="sm"
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 20,
    gap: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coverageLink: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.brand,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.brand,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: colors.brand,
  },
  toggleButtonText: {
    color: colors.brand,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
  },
  toggleButtonTextActive: {
    color: colors.white,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monthLabel: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
  },
  dayPickerRow: {
    gap: 4,
  },
  dayPill: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.xl,
    minWidth: 52,
  },
  dayPillActive: {
    backgroundColor: colors.brand,
  },
  dayPillWeekday: {
    fontSize: 12,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink3,
  },
  dayPillNumber: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 2,
  },
  dayPillTextActive: {
    color: colors.white,
  },
  dayPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 6,
  },
  dayPillDotFilled: {
    backgroundColor: colors.brand,
  },
  dayPillDotSelected: {
    backgroundColor: colors.white,
  },
  content: {
    padding: 20,
    gap: 12,
    paddingBottom: 40,
  },
  loadingStack: {
    gap: 12,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  errorText: {
    fontSize: 15,
    color: colors.error,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    textAlign: 'center',
  },
  weeklyReady: {
    gap: 12,
  },
  selectedDayLabel: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink3,
  },
  dayCardStack: {
    gap: 12,
  },
  dayCard: {
    padding: 16,
  },
  dayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  dayCardHeaderText: {
    flex: 1,
  },
  dayCardName: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
  },
  dayCardCaredPerson: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
  },
  dayCardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  dayCardTime: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink2,
  },
  dayCardActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  noShiftToday: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  noShiftTodayText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
  },
  weekListSection: {
    marginTop: 8,
  },
  weekListTitle: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink2,
    marginBottom: 12,
  },
  weekListStack: {
    gap: 8,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekRowDay: {
    fontSize: 14,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink2,
    width: 32,
  },
  weekRowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand,
  },
  weekRowName: {
    flex: 1,
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink,
  },
  weekRowTime: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
  },
  weekRowEmpty: {
    flex: 1,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
  },
});
