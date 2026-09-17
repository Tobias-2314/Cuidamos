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

import { createFamily } from './familyService';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { AppHeader } from '../../components/AppHeader';

/**
 * `phase` sigue el mismo criterio de estados explícitos que el resto de las
 * pantallas del repo (`MedicationFormScreen`, `CalendarScreen`):
 * - 'loading': resolviendo si el usuario ya tiene familia.
 * - 'error': falló la resolución inicial.
 * - 'ready': el formulario de alta está visible.
 *
 * No hay un phase 'has-family' explícito: si el usuario YA tiene familia, no
 * tiene sentido mostrarle un formulario para crear otra (v1 asume una sola
 * familia relevante por usuario, mismo criterio que `getCurrentUserFamilyId`)
 * -- se lo redirige directo a la pantalla de invitar (`/family/invite`) desde
 * el `useEffect` de carga, sin pasar por un estado de pantalla intermedio.
 */
type Phase = 'loading' | 'error' | 'ready';

export function CreateFamilyScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);

  const [name, setName] = useState('');
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

    if (familyResult.data) {
      // Ya tiene familia -- no mostramos el formulario, lo mandamos directo a
      // invitar (ver comentario de `Phase` arriba).
      router.replace('/family/invite');
      return;
    }

    setPhase('ready');
  }, [router]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const canSubmit = !isSubmitting && name.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const result = await createFamily(name);

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    // Camino feliz: familia recién creada, el usuario ya quedó como admin --
    // lo llevamos directo a invitar, siguiente paso natural del flujo.
    router.replace('/family/invite');
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
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppHeader title="Crear grupo familiar" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Una familia agrupa a los cuidadores que coordinan el cuidado de la misma persona.
          Vas a quedar como admin y después vas a poder invitar a los demás.
        </Text>

        <View style={styles.field}>
          <TextField
            label="Nombre de la familia"
            value={name}
            onChangeText={setName}
            placeholder="Ej. Familia García"
            editable={!isSubmitting}
            autoFocus
          />
        </View>

        {submitError ? (
          <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {submitError}
          </Text>
        ) : null}

        <Button
          label="Crear familia"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isSubmitting}
          size="lg"
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
    marginTop: 12,
    marginBottom: 20,
  },
  field: {
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
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    marginBottom: 8,
  },
});
