import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AssigneePicker } from './AssigneePicker';
import { formatShiftTimeRange } from './calendarSections';
import {
  getShiftById,
  listFamilyMembersForFamily,
  reassignShift,
  type FamilyMember,
  type Shift,
} from './shiftsService';
import { supabase } from '../../lib/supabase';
import { colors, fontFamily, radii } from '../../theme/tokens';

interface ShiftReassignScreenProps {
  shiftId: string;
}

/**
 * `phase` -- mismo criterio explícito que el resto del feature. 'loading'
 * mientras se resuelve el turno + los miembros asignables de su familia,
 * 'error' ante cualquier falla (incluida "el turno no existe o no sos
 * miembro de esa familia" -- RLS lo resuelve como un error de fetch, no como
 * un estado distinto: no hay forma de distinguir "no existe" de "no tenés
 * permiso" desde el cliente, y no hace falta -- el mensaje genérico alcanza).
 */
type Phase = 'loading' | 'error' | 'ready';

export function ShiftReassignScreen({ shiftId }: ShiftReassignScreenProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData.user?.id ?? null);

    const shiftResult = await getShiftById(shiftId);
    if (shiftResult.error) {
      setLoadErrorMessage(shiftResult.error.message);
      setPhase('error');
      return;
    }

    const membersResult = await listFamilyMembersForFamily(shiftResult.data.familyId);
    if (membersResult.error) {
      setLoadErrorMessage(membersResult.error.message);
      setPhase('error');
      return;
    }

    setShift(shiftResult.data);
    setMembers(membersResult.data);
    setAssignedTo(shiftResult.data.assignedTo);
    setPhase('ready');
  }, [shiftId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const canSubmit = !isSubmitting && assignedTo !== null;

  async function handleSubmit() {
    if (!canSubmit || assignedTo === null) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const result = await reassignShift(shiftId, assignedTo);

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    // Vuelve al calendario -- `CalendarScreen` recarga sola al volver a
    // tener foco (mismo criterio que el resto de los formularios del repo).
    router.back();
  }

  if (phase === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator />
        <Text style={styles.helperText}>Cargando…</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {loadErrorMessage}
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={loadInitialData}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reasignar turno</Text>
      {shift ? <Text style={styles.subtitle}>{formatShiftTimeRange(shift)}</Text> : null}

      <View style={styles.field}>
        <Text style={styles.label}>Asignar a</Text>
        <AssigneePicker
          members={members}
          currentUserId={currentUserId}
          selectedUserId={assignedTo}
          onSelect={setAssignedTo}
          disabled={isSubmitting}
        />
      </View>

      {submitError ? (
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {submitError}
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          !canSubmit && styles.buttonDisabled,
          pressed && canSubmit && styles.buttonPressed,
        ]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Guardar reasignación"
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>Guardar</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.back()}
        disabled={isSubmitting}
        accessibilityRole="button"
        accessibilityLabel="Cancelar"
      >
        <Text style={styles.secondaryButtonText}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: 24,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    marginBottom: 4,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    marginBottom: 16,
  },
  field: {
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
  },
  helperText: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    marginBottom: 8,
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
  button: {
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: colors.brandMid,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
  },
});
