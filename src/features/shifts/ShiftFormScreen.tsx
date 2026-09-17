import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { AssigneePicker } from './AssigneePicker';
import { parseShiftDateTimeInput, SHIFT_DATE_TIME_FORMAT_HINT } from './shiftDateTimeInput';
import {
  createShift,
  getCurrentUserFamilyId,
  listFamilyMembersForFamily,
  type FamilyMember,
} from './shiftsService';
import { supabase } from '../../lib/supabase';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { AppHeader } from '../../components/AppHeader';

/**
 * `phase` sigue el mismo criterio explícito que `CalendarScreen`/
 * `EmergencyContactFormScreen`: 'loading' mientras se resuelve familia +
 * miembros, 'no-family' si el usuario todavía no pertenece a ninguna
 * familia (no se puede crear un turno sin familia), 'error' ante cualquier
 * falla de carga, 'ready' cuando el formulario ya se puede completar.
 */
type Phase = 'loading' | 'no-family' | 'error' | 'ready';

export function ShiftFormScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);

  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [startsAtInput, setStartsAtInput] = useState('');
  const [endsAtInput, setEndsAtInput] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    setCurrentUserId(userId);

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error) {
      setLoadErrorMessage(familyResult.error.message);
      setPhase('error');
      return;
    }

    if (!familyResult.data) {
      setPhase('no-family');
      return;
    }

    const membersResult = await listFamilyMembersForFamily(familyResult.data);
    if (membersResult.error) {
      setLoadErrorMessage(membersResult.error.message);
      setPhase('error');
      return;
    }

    setFamilyId(familyResult.data);
    setMembers(membersResult.data);
    // Por defecto el turno se auto-asigna al usuario actual -- "asignarse un
    // turno" es el caso más común, según el título de la issue.
    setAssignedTo(userId);
    setPhase('ready');
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const startsAtDate = parseShiftDateTimeInput(startsAtInput);
  const endsAtDate = parseShiftDateTimeInput(endsAtInput);
  const hasValidTimeRange =
    startsAtDate !== null && endsAtDate !== null && startsAtDate.getTime() < endsAtDate.getTime();

  const canSubmit =
    !isSubmitting && assignedTo !== null && familyId !== null && hasValidTimeRange;

  function validationMessage(): string | null {
    if (startsAtInput.trim().length === 0 && endsAtInput.trim().length === 0) {
      return null;
    }
    if (startsAtDate === null || endsAtDate === null) {
      return `Ingresá fecha y hora con el formato ${SHIFT_DATE_TIME_FORMAT_HINT}.`;
    }
    if (startsAtDate.getTime() >= endsAtDate.getTime()) {
      return 'El turno tiene que empezar antes de terminar.';
    }
    return null;
  }

  async function handleSubmit() {
    if (!canSubmit || familyId === null || assignedTo === null) {
      return;
    }
    // Garantizado por `canSubmit` (hasValidTimeRange), pero TypeScript no lo
    // infiere a través de la función `validationMessage` -- narrow explícito.
    if (startsAtDate === null || endsAtDate === null) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const result = await createShift({
      familyId,
      assignedTo,
      startsAt: startsAtDate,
      endsAt: endsAtDate,
    });

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

  if (phase === 'no-family') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
        <Text style={styles.helperText}>
          Creá una familia para empezar a coordinar turnos entre cuidadores.
        </Text>
        <Button label="Crear familia" onPress={() => router.push('/family/create')} />
      </View>
    );
  }

  const message = validationMessage();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader title="Nuevo turno" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>Elegí quién cuida y el rango horario del turno.</Text>

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

        <View style={styles.field}>
          <TextField
            label="Inicio"
            value={startsAtInput}
            onChangeText={setStartsAtInput}
            placeholder={SHIFT_DATE_TIME_FORMAT_HINT}
            editable={!isSubmitting}
            accessibilityLabel="Fecha y hora de inicio del turno"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Fin"
            value={endsAtInput}
            onChangeText={setEndsAtInput}
            placeholder={SHIFT_DATE_TIME_FORMAT_HINT}
            editable={!isSubmitting}
            accessibilityLabel="Fecha y hora de fin del turno"
          />
        </View>

        {message ? (
          <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}

        {submitError ? (
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {submitError}
          </Text>
        ) : null}

        <Button
          label="Guardar turno"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isSubmitting}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
  },
  subtitle: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    marginTop: 12,
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
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
    textAlign: 'center',
  },
});
