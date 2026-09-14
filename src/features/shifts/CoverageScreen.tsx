import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getAssignedToLabel } from './assignedToLabel';
import { getMonthRange } from './calendarSections';
import { buildCoverageStats, coverageBarWidthPercent, formatMonthLabel, type CoverageStat } from './coverageStats';
import {
  getCurrentUserFamilyId,
  getShiftsForFamily,
  listFamilyMembersForFamily,
  type FamilyMember,
} from './shiftsService';
import { supabase } from '../../lib/supabase';

/**
 * PGM-28 -- Panel de reparto: es la diferenciación clave del producto (ver
 * criterio de producto #4, citado en la issue), evitar el "siempre cuido yo"
 * de WhatsApp mostrando cuánto cubrió cada cuidador. Mismo criterio de
 * `phase` explícito que `CalendarScreen` (PGM-26):
 * - 'loading': resolviendo family_id y/o trayendo turnos + miembros del mes.
 * - 'no-family': autenticado pero sin familia todavía.
 * - 'error': algo falló (auth, family lookup, turnos o miembros).
 * - 'ready': datos cargados (con 0 o más cuidadores -- 0 turnos es un
 *   'ready' con barras vacías, no un estado de error).
 */
type Phase = 'loading' | 'no-family' | 'error' | 'ready';

export function CoverageScreen() {
  const router = useRouter();
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [stats, setStats] = useState<CoverageStat[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCoverageForFamily = useCallback(
    async (resolvedFamilyId: string, resolvedReferenceDate: Date) => {
      setPhase('loading');
      setErrorMessage(null);

      const range = getMonthRange(resolvedReferenceDate);
      const [shiftsResult, membersResult] = await Promise.all([
        getShiftsForFamily(resolvedFamilyId, range),
        listFamilyMembersForFamily(resolvedFamilyId),
      ]);

      if (shiftsResult.error) {
        setErrorMessage(shiftsResult.error.message);
        setPhase('error');
        return;
      }
      if (membersResult.error) {
        setErrorMessage(membersResult.error.message);
        setPhase('error');
        return;
      }

      const members: FamilyMember[] = membersResult.data;
      setStats(buildCoverageStats(shiftsResult.data, members));
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

    // Setting familyId triggers the coverage-fetching effect below.
    setFamilyId(familyResult.data);
  }, []);

  useEffect(() => {
    resolveUserAndFamily();
  }, [resolveUserAndFamily]);

  useEffect(() => {
    if (!familyId) {
      return;
    }
    loadCoverageForFamily(familyId, referenceDate);
  }, [familyId, referenceDate, loadCoverageForFamily]);

  const handleRetry = useCallback(() => {
    if (familyId) {
      loadCoverageForFamily(familyId, referenceDate);
    } else {
      resolveUserAndFamily();
    }
  }, [familyId, referenceDate, loadCoverageForFamily, resolveUserAndFamily]);

  function handleStep(direction: -1 | 1) {
    setReferenceDate((current) => {
      const next = new Date(current);
      next.setMonth(next.getMonth() + direction);
      return next;
    });
  }

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Volver al calendario"
        style={styles.backButton}
      >
        <Text style={styles.backButtonText}>{'‹ Calendario'}</Text>
      </Pressable>

      <Text style={styles.title}>Reparto de turnos</Text>
      <Text style={styles.subtitle}>Cuánto cubrió cada cuidador este mes.</Text>

      <View style={styles.navRow}>
        <Pressable
          onPress={() => handleStep(-1)}
          accessibilityRole="button"
          accessibilityLabel="Mes anterior"
          style={styles.navButton}
        >
          <Text style={styles.navButtonText}>{'‹'}</Text>
        </Pressable>
        <Text style={styles.navLabel}>{formatMonthLabel(referenceDate)}</Text>
        <Pressable
          onPress={() => handleStep(1)}
          accessibilityRole="button"
          accessibilityLabel="Mes siguiente"
          style={styles.navButton}
        >
          <Text style={styles.navButtonText}>{'›'}</Text>
        </Pressable>
      </View>

      {phase === 'loading' ? (
        <View style={styles.centerContent}>
          <ActivityIndicator />
          <Text style={styles.helperText}>Cargando reparto…</Text>
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

      {phase === 'ready' && stats.length === 0 ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>Todavía no hay cuidadores en esta familia.</Text>
        </View>
      ) : null}

      {phase === 'ready' && stats.length > 0 ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          {stats.map((stat) => (
            <CoverageRow key={stat.userId} stat={stat} allStats={stats} currentUserId={currentUserId} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

interface CoverageRowProps {
  stat: CoverageStat;
  allStats: readonly CoverageStat[];
  currentUserId: string | null;
}

function formatHours(hours: number): string {
  // Una sola decimal alcanza para lo que este panel necesita mostrar (ej.
  // "4.5h") -- YAGNI, no hace falta formateo de duración más elaborado
  // (días/horas/minutos) para un MVP de un mes de turnos.
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

function CoverageRow({ stat, allStats, currentUserId }: CoverageRowProps) {
  const label = getAssignedToLabel(stat.userId, currentUserId);
  const shiftsLabel = stat.shiftCount === 1 ? '1 turno' : `${stat.shiftCount} turnos`;
  const barWidthPercent = coverageBarWidthPercent(stat, allStats);
  const summary = `${label}: ${formatHours(stat.totalHours)} cubiertas en ${shiftsLabel}`;

  return (
    <View style={styles.row} accessible accessibilityLabel={summary}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowStats}>
          {formatHours(stat.totalHours)} · {shiftsLabel}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${barWidthPercent}%` }]} />
      </View>
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
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backButtonText: {
    color: '#2f6f4f',
    fontWeight: '600',
    fontSize: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    color: '#777',
    marginTop: 4,
    marginBottom: 16,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    minWidth: 160,
    textAlign: 'center',
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
    gap: 16,
  },
  row: {
    gap: 6,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  rowStats: {
    fontSize: 13,
    color: '#555',
  },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e6efe9',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#2f6f4f',
  },
});
