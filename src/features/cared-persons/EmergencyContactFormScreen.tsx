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
import { createEmergencyContact } from './contactsService';
import { colors, radii, fontFamily } from '../../theme/tokens';

/**
 * `phase` sigue el mismo criterio que `MedicalContactFormScreen` -- ver ese
 * archivo para el detalle de cada estado.
 */
type Phase = 'loading' | 'no-family' | 'no-cared-person' | 'error' | 'ready';

export function EmergencyContactFormScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [caredPersonId, setCaredPersonId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [relationship, setRelationship] = useState('');
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

  // `emergency_contacts.phone` es NOT NULL en la tabla (a diferencia de
  // `medical_contacts.phone`) -- se valida acá también en el cliente, mismo
  // criterio que `contactsService.createEmergencyContact`.
  const trimmedPhone = phone.trim();
  const canSubmit = !isSubmitting && fullName.trim().length > 0 && trimmedPhone.length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const trimmedRelationship = relationship.trim();
    const trimmedNotes = notes.trim();

    const result = await createEmergencyContact({
      // `caredPersonId` está garantizado en 'ready' (ver `loadInitialData` -- la fase solo
      // llega a 'ready' después de resolverlo).
      caredPersonId: caredPersonId as string,
      fullName,
      relationship: trimmedRelationship.length > 0 ? trimmedRelationship : null,
      phone: trimmedPhone,
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
          Un contacto de emergencia siempre pertenece a una persona cuidada. Cargá su perfil
          primero.
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
        <Text style={styles.title}>Nuevo contacto de emergencia</Text>
        <Text style={styles.subtitle}>Nombre y teléfono son obligatorios.</Text>

        <FormField
          label="Nombre completo"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Ej. María López"
          editable={!isSubmitting}
          accessibilityLabel="Nombre completo del contacto de emergencia"
        />

        <FormField
          label="Relación (opcional)"
          value={relationship}
          onChangeText={setRelationship}
          placeholder="Ej. Hija, vecino, cuidador"
          editable={!isSubmitting}
          accessibilityLabel="Relación con la persona cuidada"
        />

        <FormField
          label="Teléfono"
          value={phone}
          onChangeText={setPhone}
          placeholder="Ej. 11 5555-5555"
          editable={!isSubmitting}
          accessibilityLabel="Teléfono del contacto de emergencia"
          keyboardType="phone-pad"
        />

        <FormField
          label="Notas (opcional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Ej. solo llamar en horario de mañana"
          editable={!isSubmitting}
          accessibilityLabel="Notas sobre el contacto de emergencia"
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
          accessibilityLabel="Guardar contacto de emergencia"
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Guardar contacto</Text>
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
