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

import {
  getCurrentUserCareProfile,
  updateCareProfile,
  type CareProfile,
} from './careProfileService';
import { isValidCareProfileField, MAX_CARE_PROFILE_FIELD_LENGTH } from './careProfileValidation';
import { colors, fontFamily, radii } from '../../theme/tokens';

/**
 * `phase` -- mismo criterio explícito que el resto del repo (ver
 * `ShiftHandoverFormScreen`/`InviteFamilyScreen`): 'loading' mientras se
 * resuelve email + rol del usuario actual, 'error' ante cualquier falla de
 * esa carga, 'ready' cuando la pantalla ya se puede mostrar/completar.
 */
type Phase = 'loading' | 'error' | 'ready';

function roleLabel(role: CareProfile['role']): string {
  if (role === 'admin') {
    return 'Admin';
  }
  if (role === 'cuidador') {
    return 'Cuidador';
  }
  return 'Sin familia todavía';
}

/**
 * Perfil de cuidador (F1, PGM-20) -- "nombre y relación con el mayor
 * cuidado". Persiste en `profiles` (migración
 * `20260916150000_profiles.sql`) vía `careProfileService.ts`.
 */
export function CareProfileScreen() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<CareProfile | null>(null);

  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

    const result = await getCurrentUserCareProfile();
    if (result.error) {
      setLoadErrorMessage(result.error.message);
      setPhase('error');
      return;
    }

    setProfile(result.data);
    setName(result.data.name ?? '');
    setRelation(result.data.relationToCaredPerson ?? '');
    setPhase('ready');
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const trimmedName = name.trim();
  const trimmedRelation = relation.trim();

  const nameIsValid = isValidCareProfileField(trimmedName);
  const relationIsValid = isValidCareProfileField(trimmedRelation);
  const canSubmit = !isSubmitting && nameIsValid && relationIsValid;

  function validationMessage(): string | null {
    if (trimmedName.length === 0 || trimmedRelation.length === 0) {
      return null;
    }
    if (!nameIsValid || !relationIsValid) {
      return `Cada campo puede tener como máximo ${MAX_CARE_PROFILE_FIELD_LENGTH} caracteres.`;
    }
    return null;
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const result = await updateCareProfile({ name: trimmedName, relation: trimmedRelation });

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    setProfile(result.data);
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
          onPress={loadProfile}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  const message = validationMessage();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Mi perfil de cuidador</Text>

        <View style={styles.accountBox}>
          <Text style={styles.accountLabel}>Email</Text>
          <Text style={styles.accountValue}>{profile?.email}</Text>
          <Text style={styles.accountLabel}>Rol en la familia</Text>
          <Text style={styles.accountValue}>{roleLabel(profile?.role ?? null)}</Text>
        </View>

        <Text style={styles.subtitle}>Nombre y relación con la persona cuidada.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Ej. María López"
            placeholderTextColor={colors.ink3}
            editable={!isSubmitting}
            maxLength={MAX_CARE_PROFILE_FIELD_LENGTH}
            accessibilityLabel="Nombre"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Relación con la persona cuidada</Text>
          <TextInput
            style={styles.input}
            value={relation}
            onChangeText={setRelation}
            placeholder="Ej. Hija, hijo, cónyuge, cuidador contratado"
            placeholderTextColor={colors.ink3}
            editable={!isSubmitting}
            maxLength={MAX_CARE_PROFILE_FIELD_LENGTH}
            accessibilityLabel="Relación con la persona cuidada"
          />
        </View>

        {message ? (
          <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}

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
          accessibilityLabel="Guardar perfil"
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Guardar</Text>
          )}
        </Pressable>
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
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    marginBottom: 16,
  },
  accountBox: {
    padding: 16,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    gap: 2,
    marginBottom: 20,
  },
  accountLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink3,
    marginTop: 8,
  },
  accountValue: {
    fontSize: 15,
    color: colors.ink,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
  },
  field: {
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink2,
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
});
