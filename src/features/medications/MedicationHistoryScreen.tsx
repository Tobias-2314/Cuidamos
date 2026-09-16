import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { formatTakenAtDateTime } from './medicationFormatting';
import { getMedicationLogsForFamily, type MedicationLogEntry } from './medicationsService';
import { getMedicationTakenByLabel } from './medicationTakenByLabel';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { supabase } from '../../lib/supabase';
import { colors, fontFamily, radii } from '../../theme/tokens';

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
    <View style={styles.container}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Volver a medicación"
        style={styles.backButton}
      >
        <Text style={styles.backButtonText}>{'‹ Medicación'}</Text>
      </Pressable>

      <Text style={styles.title}>Historial de tomas</Text>
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
        </View>
      ) : null}

      {phase === 'ready' && logs.length === 0 ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>Todavía no se registró ninguna toma.</Text>
        </View>
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
    <View style={styles.row} accessible accessibilityLabel={summary}>
      <View style={styles.rowHeader}>
        <Text style={styles.medicationName}>{entry.medicationName}</Text>
        <Text style={styles.takenAt}>{takenAtLabel}</Text>
      </View>
      <Text style={styles.takenBy}>{takenByLabel}</Text>
      {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backButtonText: {
    color: colors.brand,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.ink3,
    fontFamily: fontFamily.regular,
    fontStyle: 'italic',
    marginTop: 4,
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
  retryButton: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
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
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  medicationName: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  takenAt: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
  },
  takenBy: {
    fontSize: 14,
    color: colors.brand,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
  },
  note: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
    fontStyle: 'italic',
  },
});
