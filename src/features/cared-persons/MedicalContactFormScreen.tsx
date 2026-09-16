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

import { resolveCaredPersonContext } from './caredPersonContext';
import { createMedicalContact } from './contactsService';
import { colors, radii, fontFamily } from '../../theme/tokens';

/**
 * `phase` sigue el mismo criterio de estados explícitos que
 * `MedicationFormScreen`/`CaredPersonFormScreen`:
 * - 'loading': resolviendo familia + cared_person.
 * - 'no-family': mismo gap de producto que el resto de las pantallas.
 * - 'no-cared-person': la familia existe pero todavía no cargó el perfil de
 *   la persona cuidada -- un médico siempre pertenece a una `cared_person`.
 * - 'error': falló la carga de familia/cared_persons.
 * - 'ready': el formulario está visible y se puede enviar.
 */
type Phase = 'loading' | 'no-family' | 'no-cared-person' | 'error' | 'ready';

export function MedicalContactFormScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [caredPersonId, setCaredPersonId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

    const context = await resolveCaredPersonContext();

    if (context.status === 'error') {
      setLoadErrorMessage(context.message);
      setPhase('error');
      return;
    }

    if (context.status === 'no-family' || context.status === 'no-cared-person') {
      setPhase(context.status);
      return;
    }

    setCaredPersonId(context.caredPersonId);
    setPhase('ready');
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const canSubmit = !isSubmitting && fullName.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const trimmedSpecialty = specialty.trim();
    const trimmedPhone = phone.trim();
    const trimmedNotes = notes.trim();

    const result = await createMedicalContact({
      // `caredPersonId` está garantizado en 'ready' (ver `loadInitialData` -- la fase solo
      // llega a 'ready' después de resolverlo).
      caredPersonId: caredPersonId as string,
      fullName,
      specialty: trimmedSpecialty.length > 0 ? trimmedSpecialty : null,
      phone: trimmedPhone.length > 0 ? trimmedPhone : null,
      notes: trimmedNotes.length > 0 ? trimmedNotes : null,
    });

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    // Vuelve a la ficha -- `CaredPersonProfileScreen` recarga sola al volver a tener foco
    // (mismo criterio que `MedicationsScreen`/`MedicationFormScreen`).
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

  if (phase === 'no-family') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
        <Text style={styles.helperText}>
          Creá una familia para empezar a cargar la ficha de la persona cuidada.
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

  if (phase === 'no-cared-person') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no hay ninguna persona cuidada cargada.</Text>
        <Text style={styles.helperText}>
          Un médico siempre pertenece a una persona cuidada. Cargá su perfil primero.
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => router.push('/cared-person/new')}
          accessibilityRole="button"
          accessibilityLabel="Cargar persona cuidada"
        >
          <Text style={styles.retryButtonText}>Cargar persona cuidada</Text>
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
        <Text style={styles.title}>Nuevo médico</Text>
        <Text style={styles.subtitle}>
          Nombre y teléfono alcanzan para empezar -- el resto es opcional.
        </Text>

        <FormField
          label="Nombre completo"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Ej. Dr. Juan Pérez"
          editable={!isSubmitting}
          accessibilityLabel="Nombre completo del médico"
        />

        <FormField
          label="Especialidad (opcional)"
          value={specialty}
          onChangeText={setSpecialty}
          placeholder="Ej. Cardiología"
          editable={!isSubmitting}
          accessibilityLabel="Especialidad del médico"
        />

        <FormField
          label="Teléfono (opcional)"
          value={phone}
          onChangeText={setPhone}
          placeholder="Ej. 11 5555-5555"
          editable={!isSubmitting}
          accessibilityLabel="Teléfono del médico"
          keyboardType="phone-pad"
        />

        <FormField
          label="Notas (opcional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Ej. atiende lunes y miércoles por la mañana"
          editable={!isSubmitting}
          accessibilityLabel="Notas sobre el médico"
          multiline
        />

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
          accessibilityLabel="Guardar médico"
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Guardar médico</Text>
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
  keyboardType?: 'default' | 'phone-pad';
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
  accessibilityLabel,
  multiline,
  keyboardType,
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
        keyboardType={keyboardType}
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
