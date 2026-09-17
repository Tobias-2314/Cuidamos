import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { formatTakenAtDateTime } from './medicationFormatting';
import { getMedicationLogsForFamily, type MedicationLogEntry } from './medicationsService';
import { getMedicationTakenByLabel } from './medicationTakenByLabel';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { supabase } from '../../lib/supabase';
import { colors, fontFamily, radii } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { AppHeader } from '../../components/AppHeader';
import { EmptyState } from '../../components/EmptyState';
import { IconCheck, IconClip } from '../../components/icons';

/**
 * PGM-33 -- Historial de tomas visible por TODOS los cuidadores de la familia (no solo
 * quien las registró). Reduce la fricción/incertidumbre de WhatsApp ("¿le diste ya la
 * pastilla de las 5?") mostrando quién dio qué y cuándo, en un único lugar.
 *
 * Mismo criterio de `phase` explícito que el resto de las pantallas de medicación
 * (`MedicationsScreen`, `MedicationFormScreen`):
 * - 'loading': resolviendo family_id y/o trayendo el historial.
 * - 'no-family': gap de producto compartido (ver NOTES).
 * - 'error': falló la resolución de familia o la carga del historial.
 * - 'ready': historial cargado (0 o más tomas -- lista vacía es un 'ready' con estado
 *   vacío, no un error).
 */
type Phase = 'loading' | 'no-family' | 'error' | 'ready';

export function MedicationHistoryScreen() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [logs, setLogs] = useState<MedicationLogEntry[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadHistoryForFamily = useCallback(async (resolvedFamilyId: string) => {
    setPhase('loading');
    setErrorMessage(null);

    const result = await getMedicationLogsForFamily(resolvedFamilyId);

    if (result.error) {
      setErrorMessage(result.error.message);
      setPhase('error');
      return;
    }

    setLogs(result.data);
    setPhase('ready');
  }, []);

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

    setFamilyId(familyResult.data);
    await loadHistoryForFamily(familyResult.data);
  }, [loadHistoryForFamily]);

  // `useFocusEffect`, mismo criterio que `MedicationsScreen`: al volver de marcar una
  // toma nueva (u otra pestaña) el historial se re-consulta solo, sin depender de que
  // el caller pase ningún dato de vuelta.
  useFocusEffect(
    useCallback(() => {
      resolveUserAndFamily();
    }, [resolveUserAndFamily])
  );

  const handleRetry = useCallback(() => {
    if (familyId) {
      loadHistoryForFamily(familyId);
    } else {
      resolveUserAndFamily();
    }
  }, [familyId, loadHistoryForFamily, resolveUserAndFamily]);

  return (
    <View style={styles.screen}>
      <AppHeader title="Historial de tomas" onBack={() => router.back()} />
      <View style={styles.container}>
        <Text style={styles.disclaimer}>
          Esto no reemplaza el criterio médico. Ante dudas, consultá con el profesional de
          salud a cargo.
        </Text>

        {phase === 'loading' ? (
          <View style={styles.centerContent}>
            <ActivityIndicator />
            <Text style={styles.helperText}>Cargando historial…</Text>
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
          </View>
        ) : null}

        {phase === 'ready' && logs.length === 0 ? (
          <EmptyState
            icon={<IconClip size="lg" color={colors.brand} />}
            title="Sin historial todavía"
            desc="Las tomas de medicamentos registradas van a aparecer acá para que toda la familia pueda seguirlas."
          />
        ) : null}

        {phase === 'ready' && logs.length > 0 ? (
          <FlatList
            data={logs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <HistoryRow entry={item} currentUserId={currentUserId} />}
            contentContainerStyle={styles.listContent}
          />
        ) : null}
      </View>
    </View>
  );
}

interface HistoryRowProps {
  entry: MedicationLogEntry;
  currentUserId: string | null;
}

function HistoryRow({ entry, currentUserId }: HistoryRowProps) {
  const takenByLabel = getMedicationTakenByLabel(entry.takenBy, currentUserId);
  const takenAtLabel = formatTakenAtDateTime(entry.takenAt);
  const summary = entry.note
    ? `${entry.medicationName}, dado por ${takenByLabel} el ${takenAtLabel}. Nota: ${entry.note}`
    : `${entry.medicationName}, dado por ${takenByLabel} el ${takenAtLabel}`;

  return (
    <Card style={styles.row}>
      <View style={styles.rowMain} accessible accessibilityLabel={summary}>
        <View style={styles.rowIconBadge}>
          <IconCheck size="sm" color={colors.ok} />
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowHeader}>
            <Text style={styles.medicationName}>{entry.medicationName}</Text>
          </View>
          <View style={styles.rowByRow}>
            <Avatar name={takenByLabel} size="sm" />
            <Text style={styles.takenBy}>{takenByLabel}</Text>
            <Text style={styles.takenAt}>· {takenAtLabel}</Text>
          </View>
          {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
        </View>
        <Badge label="Tomada" variant="ok" />
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
  disclaimer: {
    fontSize: 12,
    color: colors.ink3,
    fontFamily: fontFamily.regular,
    fontStyle: 'italic',
    marginBottom: 16,
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
    fontFamily: fontFamily.regular,
    color: colors.ink3,
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
    gap: 10,
  },
  row: {
    padding: 14,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIconBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.card,
    backgroundColor: colors.okBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  rowByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  medicationName: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  takenAt: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
  },
  takenBy: {
    fontSize: 12,
    color: colors.ink3,
    fontFamily: fontFamily.regular,
  },
  note: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
