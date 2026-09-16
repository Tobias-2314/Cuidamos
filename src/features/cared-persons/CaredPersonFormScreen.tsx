import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { createCaredPerson } from './caredPersonsService';
import { isValidBirthDateInput } from './caredPersonFormatting';
import { getCaredPersonsForFamily } from '../medications/medicationsService';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { colors, radii, fontFamily } from '../../theme/tokens';

/**
 * `phase` sigue el mismo criterio de estados explícitos que el resto de las
 * pantallas del repo (`MedicationFormScreen`, `CreateFamilyScreen`):
 * - 'loading': resolviendo familia (+ si ya tiene una cared_person cargada).
 * - 'no-family': mismo gap de producto que el resto de las pantallas (no hay
 *   familia todavía) -- se ofrece ir a crear una.
 * - 'already-exists': la familia YA tiene una persona cuidada. v1 asume una
 *   sola cared_person por familia (mismo criterio que
 *   `getCaredPersonsForFamily`/`MedicationFormScreen`) -- no tiene sentido
 *   mostrar el formulario de alta de nuevo. Desde PGM-23 ya existe la
 *   pantalla de "ficha" (`/cared-person`), así que este estado redirige ahí
 *   con `router.replace` en vez de mostrar el dead-end informativo que había
 *   antes (ver NOTES del agente).
 * - 'error': falló la carga de familia/cared_persons.
 * - 'ready': el formulario de alta está visible.
 */
type Phase = 'loading' | 'no-family' | 'already-exists' | 'error' | 'ready';

export function CaredPersonFormScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

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

    // v1 asume una sola persona cuidada por familia -- reusa
    // `getCaredPersonsForFamily` (medicationsService.ts, PGM-31) en vez de
    // duplicar esa consulta acá (ver NOTES del agente para el criterio
    // completo).
    const caredPersonsResult = await getCaredPersonsForFamily(familyResult.data);
    if (caredPersonsResult.error) {
      setLoadErrorMessage(caredPersonsResult.error.message);
      setPhase('error');
      return;
    }

    if (caredPersonsResult.data.length > 0) {
      setPhase('already-exists');
      router.replace('/cared-person');
      return;
    }

    setFamilyId(familyResult.data);
    setPhase('ready');
  }, [router]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const trimmedBirthDate = birthDate.trim();
  const birthDateError =
    trimmedBirthDate.length > 0 && !isValidBirthDateInput(trimmedBirthDate)
      ? 'Formato inválido. Usá AAAA-MM-DD (ej. 1945-03-20).'
      : null;

  const canSubmit =
    !isSubmitting && fullName.trim().length > 0 && consentAccepted && birthDateError === null;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const trimmedConditionNotes = conditionNotes.trim();

    const result = await createCaredPerson({
      // `familyId` está garantizado en 'ready' (ver `loadInitialData` -- la
      // fase solo llega a 'ready' después de resolverlo).
      familyId: familyId as string,
      fullName,
      birthDate: trimmedBirthDate.length > 0 ? trimmedBirthDate : null,
      conditionNotes: trimmedConditionNotes.length > 0 ? trimmedConditionNotes : null,
    });

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    // Camino feliz: vuelve a la pantalla que abrió el formulario (mismo
    // criterio que `MedicationFormScreen`) -- no hay todavía una pantalla de
    // "ficha" (PGM-23) a la que navegar en su lugar.
    router.back();
  }

  if (phase === 'loading' || phase === 'already-exists') {
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

  if (phase === 'no-family') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
        <Text style={styles.helperText}>
          Creá una familia para empezar a cargar el perfil de la persona cuidada, o pedile a
          quien te invitó el link de invitación.
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
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Persona cuidada</Text>
        <Text style={styles.subtitle}>
          Cargá el perfil de la persona a la que tu familia cuida. Vas a poder agregar médicos y
          contactos de emergencia más adelante.
        </Text>
        <Text style={styles.disclaimer}>
          Las notas de condición son solo para coordinar el cuidado entre la familia -- esto no
          reemplaza el criterio médico. Ante dudas, consultá con el profesional de salud a
          cargo.
        </Text>

        <FormField
          label="Nombre completo"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Ej. María García"
          editable={!isSubmitting}
          accessibilityLabel="Nombre completo de la persona cuidada"
        />

        <FormField
          label="Fecha de nacimiento (opcional)"
          value={birthDate}
          onChangeText={setBirthDate}
          placeholder="AAAA-MM-DD"
          editable={!isSubmitting}
          accessibilityLabel="Fecha de nacimiento de la persona cuidada"
        />
        {birthDateError ? <Text style={styles.fieldErrorText}>{birthDateError}</Text> : null}

        <FormField
          label="Notas de condición (opcional)"
          value={conditionNotes}
          onChangeText={setConditionNotes}
          placeholder="Ej. movilidad reducida, requiere acompañamiento para caminar"
          editable={!isSubmitting}
          accessibilityLabel="Notas de condición de la persona cuidada"
          multiline
        />

        <Pressable
          style={styles.consentRow}
          onPress={() => setConsentAccepted((prev) => !prev)}
          disabled={isSubmitting}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consentAccepted, disabled: isSubmitting }}
          accessibilityLabel="Doy mi consentimiento explícito para tratar los datos de esta persona cuidada"
        >
          <View style={[styles.checkbox, consentAccepted && styles.checkboxChecked]}>
            {consentAccepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.consentText}>
            Doy mi consentimiento explícito para tratar los datos de esta persona cuidada,
            incluidos los datos de salud que se carguen en su perfil (RGPD art. 9).
          </Text>
        </Pressable>

        {submitError ? (
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
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
          accessibilityLabel="Guardar persona cuidada"
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable: boolean;
  accessibilityLabel: string;
  multiline?: boolean;
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
  accessibilityLabel,
  multiline,
}: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        editable={editable}
        multiline={multiline}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    padding: 24,
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
  title: {
    fontSize: 22,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    marginBottom: 4,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
    marginBottom: 8,
  },
  disclaimer: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  field: {
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  fieldErrorText: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.error,
    marginTop: -10,
    marginBottom: 14,
  },
  helperText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    fontFamily: fontFamily.medium,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink,
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
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.brand,
  },
  checkboxMark: {
    color: colors.white,
    fontSize: 14,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
  },
  consentText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    lineHeight: 18,
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
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
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
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
  },
});
