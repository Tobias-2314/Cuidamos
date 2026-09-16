import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { formatMedicationSubtitle, formatTakenAtTime, MAX_MEDICATION_NOTE_LENGTH } from './medicationFormatting';
import {
  getMedicationsForFamily,
  recordMedicationTaken,
  type Medication,
} from './medicationsService';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { colors, fontFamily, radii } from '../../theme/tokens';

/**
 * Cuánto tiempo se muestra la confirmación visual ("¡Dado a las HH:MM!")
 * antes de volver la fila a su estado normal — deja registrar una segunda
 * toma del mismo medicamento (ej. otra dosis más tarde) sin recargar la
 * pantalla.
 */
const CONFIRMATION_VISIBLE_MS = 2500;

/**
 * `phase` sigue el mismo criterio explícito de estados que `CalendarScreen`
 * (PGM-26): 'loading' / 'no-family' (gap de producto compartido — ver
 * NOTES) / 'error' / 'ready'.
 */
type Phase = 'loading' | 'no-family' | 'error' | 'ready';

export function MedicationsScreen() {
  const router = useRouter();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMedicationsForFamily = useCallback(async (resolvedFamilyId: string) => {
    setPhase('loading');
    setErrorMessage(null);

    const result = await getMedicationsForFamily(resolvedFamilyId);

    if (result.error) {
      setErrorMessage(result.error.message);
      setPhase('error');
      return;
    }

    setMedications(result.data);
    setPhase('ready');
  }, []);

  const resolveFamilyAndLoad = useCallback(async () => {
    setPhase('loading');
    setErrorMessage(null);
    setFamilyId(null);

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
    await loadMedicationsForFamily(familyResult.data);
  }, [loadMedicationsForFamily]);

  // `useFocusEffect` (no un `useEffect` con `[]`) a propósito: PGM-31 agrega alta/edición en
  // otra pantalla (`MedicationFormScreen`) -- al volver acá con `router.back()` después de
  // guardar, esta pantalla necesita recargar la lista sin depender de que el caller le pase
  // ningún dato de vuelta. Se re-ejecuta en cada foco, incluido el montaje inicial.
  useFocusEffect(
    useCallback(() => {
      resolveFamilyAndLoad();
    }, [resolveFamilyAndLoad])
  );

  const handleRetry = useCallback(() => {
    if (familyId) {
      loadMedicationsForFamily(familyId);
    } else {
      resolveFamilyAndLoad();
    }
  }, [familyId, loadMedicationsForFamily, resolveFamilyAndLoad]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Medicación</Text>
        <View style={styles.headerActions}>
          {phase === 'ready' ? (
            <Pressable
              style={styles.inviteButton}
              onPress={() => router.push('/family/invite')}
              accessibilityRole="button"
              accessibilityLabel="Invitar a un cuidador"
            >
              <Text style={styles.inviteButtonText}>Invitar</Text>
            </Pressable>
          ) : null}
          {phase === 'ready' ? (
            <Pressable
              style={styles.inviteButton}
              onPress={() => router.push('/medications/history')}
              accessibilityRole="button"
              accessibilityLabel="Ver historial de tomas"
            >
              <Text style={styles.inviteButtonText}>Historial</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.newButton}
            onPress={() => router.push('/medications/new')}
            accessibilityRole="button"
            accessibilityLabel="Agregar medicamento"
          >
            <Text style={styles.newButtonText}>+ Nuevo</Text>
          </Pressable>
        </View>
      </View>

      {phase === 'loading' ? (
        <View style={styles.centerContent}>
          <ActivityIndicator />
          <Text style={styles.helperText}>Cargando medicamentos…</Text>
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
            Creá una familia para empezar a cargar medicamentos, o pedile a quien te invitó el
            link de invitación.
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

      {phase === 'ready' && medications.length === 0 ? (
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>Todavía no hay medicamentos cargados.</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => router.push('/medications/new')}
            accessibilityRole="button"
            accessibilityLabel="Agregar el primer medicamento"
          >
            <Text style={styles.retryButtonText}>Agregar medicamento</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'ready' && medications.length > 0 ? (
        <FlatList
          data={medications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MedicationRow medication={item} />}
          contentContainerStyle={styles.listContent}
        />
      ) : null}
    </View>
  );
}

/**
 * `rowPhase` es el estado LOCAL de una fila — independiente del `phase` de
 * la pantalla, porque cada medicamento se marca por separado:
 * - 'idle': botones normales ("Marcar como dado" / "+ nota").
 * - 'note-open': el campo de nota corta está abierto, esperando texto y
 *   confirmación explícita — es el único paso extra de tap que agrega una
 *   nota (ver criterio "<3 tap": el camino SIN nota nunca pasa por acá).
 * - 'saving': el request está en curso, botones deshabilitados.
 * - 'done': confirmación visual breve (revierte sola a 'idle' — ver
 *   `CONFIRMATION_VISIBLE_MS`).
 * - 'error': el request falló, se puede reintentar.
 */
type RowPhase = 'idle' | 'note-open' | 'saving' | 'done' | 'error';

interface MedicationRowProps {
  medication: Medication;
}

function MedicationRow({ medication }: MedicationRowProps) {
  const router = useRouter();
  const [rowPhase, setRowPhase] = useState<RowPhase>('idle');
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTakenAtLabel, setLastTakenAtLabel] = useState<string | null>(null);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpia el timer de auto-revert si la fila se desmonta con la
  // confirmación todavía visible (ej. se recarga la lista).
  useEffect(() => {
    return () => {
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
      }
    };
  }, []);

  async function submit(noteToSend: string | null) {
    setRowPhase('saving');
    setErrorMessage(null);

    const result = await recordMedicationTaken(medication.id, { note: noteToSend });

    if (result.error) {
      setErrorMessage(result.error.message);
      setRowPhase('error');
      return;
    }

    setNote('');
    setLastTakenAtLabel(formatTakenAtTime(result.data.takenAt));
    setRowPhase('done');
    revertTimerRef.current = setTimeout(() => {
      setRowPhase('idle');
    }, CONFIRMATION_VISIBLE_MS);
  }

  // Camino de 1 tap: marca "dado" ahora mismo, sin nota.
  function handleMarkAsTaken() {
    submit(null);
  }

  function handleOpenNote() {
    setRowPhase('note-open');
  }

  function handleCancelNote() {
    setNote('');
    setRowPhase('idle');
  }

  // Camino con nota: abrir el campo (1 tap) + confirmar (1 tap más) — sigue
  // dentro del criterio "<3 tap" para quien elige agregar contexto.
  function handleConfirmWithNote() {
    submit(note);
  }

  function handleRetryRow() {
    setRowPhase('idle');
  }

  return (
    <View style={styles.medicationRow}>
      <View style={styles.medicationHeaderRow}>
        <View style={styles.medicationInfo}>
          <Text style={styles.medicationName}>{medication.name}</Text>
          <Text style={styles.medicationSubtitle}>{formatMedicationSubtitle(medication)}</Text>
        </View>
        <Pressable
          style={styles.editButton}
          onPress={() => router.push(`/medications/${medication.id}/edit`)}
          accessibilityRole="button"
          accessibilityLabel={`Editar ${medication.name}`}
        >
          <Text style={styles.editButtonText}>Editar</Text>
        </Pressable>
      </View>

      {rowPhase === 'idle' ? (
        <View style={styles.actionsRow}>
          <Pressable
            style={styles.markButton}
            onPress={handleMarkAsTaken}
            accessibilityRole="button"
            accessibilityLabel={`Marcar ${medication.name} como dado ahora`}
          >
            <Text style={styles.markButtonText}>Marcar como dado</Text>
          </Pressable>
          <Pressable
            style={styles.noteToggle}
            onPress={handleOpenNote}
            accessibilityRole="button"
            accessibilityLabel={`Agregar nota antes de marcar ${medication.name} como dado`}
          >
            <Text style={styles.noteToggleText}>+ nota</Text>
          </Pressable>
        </View>
      ) : null}

      {rowPhase === 'note-open' ? (
        <View style={styles.noteForm}>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="Nota corta (opcional)"
            placeholderTextColor={colors.ink3}
            maxLength={MAX_MEDICATION_NOTE_LENGTH}
            autoFocus
            accessibilityLabel={`Nota corta para la toma de ${medication.name}`}
          />
          <View style={styles.noteFormActions}>
            <Pressable
              style={styles.noteCancelButton}
              onPress={handleCancelNote}
              accessibilityRole="button"
              accessibilityLabel="Cancelar nota"
            >
              <Text style={styles.noteCancelButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={styles.markButton}
              onPress={handleConfirmWithNote}
              accessibilityRole="button"
              accessibilityLabel={`Confirmar ${medication.name} como dado con nota`}
            >
              <Text style={styles.markButtonText}>Confirmar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {rowPhase === 'saving' ? (
        <View style={styles.actionsRow}>
          <View style={[styles.markButton, styles.markButtonDisabled]}>
            <ActivityIndicator color={colors.white} size="small" />
          </View>
        </View>
      ) : null}

      {rowPhase === 'done' ? (
        <Text
          style={styles.confirmationText}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {`✓ Dado a las ${lastTakenAtLabel}`}
        </Text>
      ) : null}

      {rowPhase === 'error' ? (
        <View style={styles.actionsRow}>
          <Text
            style={styles.rowErrorText}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {errorMessage}
          </Text>
          <Pressable
            style={styles.markButton}
            onPress={handleRetryRow}
            accessibilityRole="button"
            accessibilityLabel="Reintentar"
          >
            <Text style={styles.markButtonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  newButton: {
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
  },
  inviteButton: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  inviteButtonText: {
    color: colors.brand,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
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
  medicationRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  medicationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  medicationInfo: {
    flex: 1,
    gap: 2,
  },
  medicationName: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  medicationSubtitle: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
  },
  editButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  editButtonText: {
    color: colors.brand,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  markButton: {
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markButtonDisabled: {
    backgroundColor: colors.brandMid,
    paddingHorizontal: 24,
  },
  markButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
  },
  noteToggle: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  noteToggleText: {
    color: colors.brand,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
  },
  noteForm: {
    gap: 8,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  noteFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  noteCancelButton: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  noteCancelButtonText: {
    color: colors.ink3,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
  },
  confirmationText: {
    color: colors.brand,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    fontSize: 14,
  },
  rowErrorText: {
    color: colors.error,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    flexShrink: 1,
  },
});
