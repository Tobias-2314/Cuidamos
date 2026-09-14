import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getAssignedToLabel } from './assignedToLabel';
import {
  buildCalendarSections,
  formatShiftTimeRange,
  getRangeForView,
  SHIFT_STATUS_LABELS_ES,
  type CalendarView,
} from './calendarSections';
import { getCurrentUserFamilyId, getShiftsForFamily, type Shift } from './shiftsService';
import { supabase } from '../../lib/supabase';

/**
 * `phase` tracks the top-level state of the screen, following the same
 * explicit-states approach as `LoginScreen.tsx` (PGM-17):
 * - 'loading': resolving the user's family_id and/or fetching shifts.
 * - 'no-family': the user is authenticated but not a member of any family
 *   yet. PGM-18 closed the gap flagged in PGM-26 (no family creation screen
 *   existed) — this state now offers a CTA into `/family/create`.
 * - 'error': something failed (auth, family lookup, or shifts fetch).
 * - 'ready': shifts loaded (may be an empty list — rendered as its own
 *   empty state, not an error).
 */
type Phase = 'loading' | 'no-family' | 'error' | 'ready';

function shiftUnitsPerDayLabel(view: CalendarView): string {
  return view === 'weekly' ? 'esta semana' : 'este mes';
}

export function CalendarScreen() {
  const router = useRouter();
  const [view, setView] = useState<CalendarView>('weekly');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadShiftsForFamily = useCallback(
    async (resolvedFamilyId: string, resolvedView: CalendarView, resolvedReferenceDate: Date) => {
      setPhase('loading');
      setErrorMessage(null);

      const range = getRangeForView(resolvedView, resolvedReferenceDate);
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
  }

  const sections = buildCalendarSections(shifts, view);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Calendario de turnos</Text>

      <View style={styles.toggleRow}>
        <ViewToggleButton label="Semana" active={view === 'weekly'} onPress={() => setView('weekly')} />
        <ViewToggleButton label="Mes" active={view === 'monthly'} onPress={() => setView('monthly')} />
      </View>

      {phase === 'ready' || phase === 'error' ? (
        <View style={styles.navRow}>
          <Pressable
            onPress={() => handleStep(-1)}
            accessibilityRole="button"
            accessibilityLabel={view === 'weekly' ? 'Semana anterior' : 'Mes anterior'}
            style={styles.navButton}
          >
            <Text style={styles.navButtonText}>{'‹'}</Text>
          </Pressable>
          <Text style={styles.navLabel}>{view === 'weekly' ? 'Semana' : 'Mes'}</Text>
          <Pressable
            onPress={() => handleStep(1)}
            accessibilityRole="button"
            accessibilityLabel={view === 'weekly' ? 'Semana siguiente' : 'Mes siguiente'}
            style={styles.navButton}
          >
            <Text style={styles.navButtonText}>{'›'}</Text>
          </Pressable>
        </View>
      ) : null}

      {familyId ? (
        <Pressable
          style={styles.assignButton}
          onPress={() => router.push('/shifts/new')}
          accessibilityRole="button"
          accessibilityLabel="Asignar turno nuevo"
        >
          <Text style={styles.assignButtonText}>+ Asignar turno</Text>
        </Pressable>
      ) : null}

      {phase === 'loading' ? (
        <View style={styles.centerContent}>
          <ActivityIndicator />
          <Text style={styles.helperText}>Cargando turnos…</Text>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={styles.centerContent}>
          <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errorMessage}
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Reintentar"
          >
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'no-family' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
          <Text style={styles.helperText}>
            Creá una familia para empezar a coordinar turnos, o pedile a quien te invitó el link
            de invitación.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => router.push('/family/create')}
            accessibilityRole="button"
            accessibilityLabel="Crear familia"
          >
            <Text style={styles.retryButtonText}>Crear familia</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'ready' && sections.length === 0 ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>No hay turnos {shiftUnitsPerDayLabel(view)}.</Text>
        </View>
      ) : null}

      {phase === 'ready' && sections.length > 0 ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <ShiftRow
              shift={item}
              currentUserId={currentUserId}
              onReassignPress={() => router.push(`/shifts/${item.id}/reassign`)}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      ) : null}
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

interface ShiftRowProps {
  shift: Shift;
  currentUserId: string | null;
  onReassignPress: () => void;
}

function ShiftRow({ shift, currentUserId, onReassignPress }: ShiftRowProps) {
  const assigneeLabel = getAssignedToLabel(shift.assignedTo, currentUserId);

  return (
    <View style={styles.shiftRow}>
      <Text style={styles.shiftTime}>{formatShiftTimeRange(shift)}</Text>
      <View style={styles.shiftDetails}>
        <Text style={styles.shiftAssignee}>{assigneeLabel}</Text>
        {shift.caredPersonName ? (
          <Text style={styles.shiftCaredPerson}>{shift.caredPersonName}</Text>
        ) : null}
      </View>
      <View style={styles.statusBadge}>
        <Text style={styles.statusBadgeText}>{SHIFT_STATUS_LABELS_ES[shift.status]}</Text>
      </View>
      <Pressable
        onPress={onReassignPress}
        accessibilityRole="button"
        accessibilityLabel={`Reasignar turno, actualmente asignado a ${assigneeLabel}`}
        style={styles.reassignButton}
      >
        <Text style={styles.reassignButtonText}>Reasignar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f6f4f',
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#2f6f4f',
  },
  toggleButtonText: {
    color: '#2f6f4f',
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    color: '#fff',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 12,
  },
  navButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  navButtonText: {
    fontSize: 20,
    color: '#2f6f4f',
    fontWeight: '700',
  },
  navLabel: {
    fontSize: 14,
    color: '#555',
  },
  assignButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  assignButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  helperText: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#b3261e',
    fontWeight: '500',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    backgroundColor: '#f3f3f3',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 12,
    borderRadius: 6,
  },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 10,
  },
  shiftTime: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    width: 110,
  },
  shiftDetails: {
    flex: 1,
  },
  shiftAssignee: {
    fontSize: 14,
    color: '#222',
  },
  shiftCaredPerson: {
    fontSize: 12,
    color: '#777',
  },
  statusBadge: {
    backgroundColor: '#e6efe9',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    color: '#2f6f4f',
    fontWeight: '600',
  },
  reassignButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reassignButtonText: {
    fontSize: 12,
    color: '#2f6f4f',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
