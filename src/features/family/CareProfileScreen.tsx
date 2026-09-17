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

import {
  getCurrentUserCareProfile,
  updateCareProfile,
  type CareProfile,
} from './careProfileService';
import { isValidCareProfileField, MAX_CARE_PROFILE_FIELD_LENGTH } from './careProfileValidation';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { AppHeader } from '../../components/AppHeader';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Divider } from '../../components/Divider';

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
        <Button label="Reintentar" onPress={loadProfile} />
      </View>
    );
  }

  const message = validationMessage();
  const displayName = profile?.name ?? profile?.email ?? '';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppHeader title="Mi perfil" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.profileHeader}>
          <Avatar name={displayName} size="xl" />
          <Text style={styles.profileName}>{displayName}</Text>
          <Badge label={roleLabel(profile?.role ?? null)} variant="brand" />
        </View>

        <Divider />

        <View style={styles.field}>
          <TextField
            label="Nombre"
            value={name}
            onChangeText={setName}
            placeholder="Ej. María López"
            editable={!isSubmitting}
            maxLength={MAX_CARE_PROFILE_FIELD_LENGTH}
            accessibilityLabel="Nombre"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Correo electrónico"
            value={profile?.email ?? ''}
            editable={false}
            hint="El correo no puede modificarse"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Relación con la persona cuidada"
            value={relation}
            onChangeText={setRelation}
            placeholder="Ej. Hija, hijo, cónyuge, cuidador contratado"
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

        <Button
          label="Guardar"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isSubmitting}
          accessibilityLabel="Guardar perfil"
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
  profileHeader: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 8,
  },
  profileName: {
    fontSize: 20,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
  },
  field: {
    marginBottom: 14,
    marginTop: 20,
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
