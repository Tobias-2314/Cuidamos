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

import { resolveCaredPersonContext } from './caredPersonContext';
import { createMedicalContact } from './contactsService';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { AppHeader } from '../../components/AppHeader';

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
        <Button label="Reintentar" onPress={loadInitialData} />
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
        <Button label="Crear familia" onPress={() => router.push('/family/create')} />
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
        <Button
          label="Cargar persona cuidada"
          onPress={() => router.push('/cared-person/new')}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader title="Contacto médico" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Nombre y teléfono alcanzan para empezar -- el resto es opcional.
        </Text>

        <View style={styles.field}>
          <TextField
            label="Nombre completo"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Ej. Dr. Juan Pérez"
            editable={!isSubmitting}
            accessibilityLabel="Nombre completo del médico"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Especialidad (opcional)"
            value={specialty}
            onChangeText={setSpecialty}
            placeholder="Ej. Cardiología"
            editable={!isSubmitting}
            accessibilityLabel="Especialidad del médico"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Teléfono (opcional)"
            value={phone}
            onChangeText={setPhone}
            placeholder="Ej. 11 5555-5555"
            editable={!isSubmitting}
            accessibilityLabel="Teléfono del médico"
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Notas (opcional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Ej. atiende lunes y miércoles por la mañana"
            editable={!isSubmitting}
            accessibilityLabel="Notas sobre el médico"
            multiline
            style={styles.inputMultiline}
          />
        </View>

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
          label="Guardar médico"
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
    fontFamily: fontFamily.regular,
    color: colors.ink2,
    marginBottom: 16,
  },
  field: {
    marginBottom: 14,
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
});
