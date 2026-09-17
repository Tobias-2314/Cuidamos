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
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { AppHeader } from '../../components/AppHeader';
import { IconChevronLeft, IconChevronRight } from '../../components/icons';

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
    <View style={styles.screen}>
      <AppHeader title="Cobertura de turnos" onBack={() => router.back()} />
      <View style={styles.container}>
        <Text style={styles.subtitle}>Cuánto cubrió cada cuidador este mes.</Text>

        <View style={styles.navRow}>
          <Pressable
            onPress={() => handleStep(-1)}
            accessibilityRole="button"
            accessibilityLabel="Mes anterior"
            style={styles.navButton}
          >
            <IconChevronLeft size="sm" color={colors.ink2} />
          </Pressable>
          <Text style={styles.navLabel}>{formatMonthLabel(referenceDate)}</Text>
          <Pressable
            onPress={() => handleStep(1)}
            accessibilityRole="button"
            accessibilityLabel="Mes siguiente"
            style={styles.navButton}
          >
            <IconChevronRight size="sm" color={colors.ink2} />
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
          <Button label="Reintentar" onPress={handleRetry} />
        </View>
      ) : null}

      {phase === 'no-family' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
          <Button label="Crear familia" onPress={() => router.push('/family/create')} />
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
    <Card style={styles.row}>
      <View style={styles.rowHeader}>
        <Avatar name={label} size="sm" />
        <View style={styles.rowHeaderText} accessible accessibilityLabel={summary}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowStats}>
            {formatHours(stat.totalHours)} · {shiftsLabel}
          </Text>
        </View>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${barWidthPercent}%` }]} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
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
  navLabel: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
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
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: colors.error,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 24,
    gap: 16,
  },
  row: {
    padding: 14,
    gap: 10,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowHeaderText: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
  },
  rowStats: {
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
  },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brandLight,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: colors.brand,
  },
});
