import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AssigneePicker } from './AssigneePicker';
import { getAssignedToLabel } from './assignedToLabel';
import { formatShiftTimeRange } from './calendarSections';
import {
  getShiftById,
  listFamilyMembersForFamily,
  reassignShift,
  type FamilyMember,
  type Shift,
} from './shiftsService';
import { supabase } from '../../lib/supabase';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { AppHeader } from '../../components/AppHeader';

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
        <Button label="Reintentar" onPress={loadInitialData} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AppHeader title="Reasignar turno" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.container}>
        {shift ? (
          <Card style={styles.currentShiftCard}>
            <Text style={styles.currentShiftLabel}>Turno actual</Text>
            <Text style={styles.currentShiftTime}>{formatShiftTimeRange(shift)}</Text>
            <View style={styles.currentShiftAssignee}>
              <Avatar name={getAssignedToLabel(shift.assignedTo, currentUserId)} size="sm" />
              <Text style={styles.currentShiftAssigneeName}>
                {getAssignedToLabel(shift.assignedTo, currentUserId)}
              </Text>
            </View>
          </Card>
        ) : null}

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

        <Button
          label="Guardar"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isSubmitting}
          accessibilityLabel="Guardar reasignación"
          size="lg"
          full
        />

        <Button
          label="Cancelar"
          onPress={() => router.back()}
          disabled={isSubmitting}
          variant="ghost"
          full
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flexGrow: 1,
    padding: 20,
  },
  currentShiftCard: {
    padding: 16,
    marginBottom: 20,
  },
  currentShiftLabel: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    marginBottom: 2,
  },
  currentShiftTime: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
  },
  currentShiftAssignee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  currentShiftAssigneeName: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
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
});
