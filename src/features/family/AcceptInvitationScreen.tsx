import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getSession } from '../auth/authService';
import { acceptFamilyInvitation } from './familyService';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconAlert, IconCheck, IconLink } from '../../components/icons';

interface AcceptInvitationScreenProps {
  token: string;
}

/**
 * `phase` sigue el mismo criterio de estados explícitos que el resto del
 * repo:
 * - 'loading': verificando sesión y llamando a `accept_family_invitation`.
 * - 'not-authenticated': no hay sesión activa -- `accept_family_invitation`
 *   depende de `auth.uid()`, así que sin sesión no hay a quién unir a la
 *   familia. Ver NOTES del agente: no existe un flujo de "recordar el token
 *   y reintentar después de loguearse", se le pide al usuario loguearse y
 *   volver a abrir el link.
 * - 'error': el token es inválido/expirado/ya usado, o falló la llamada --
 *   el mensaje viene tal cual de la RPC (ver `acceptFamilyInvitation`).
 * - 'success': se unió a la familia correctamente.
 */
type Phase = 'loading' | 'not-authenticated' | 'error' | 'success';

export function AcceptInvitationScreen({ token }: AcceptInvitationScreenProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const acceptInvitation = useCallback(async () => {
    setPhase('loading');
    setErrorMessage(null);

    const sessionResult = await getSession();
    if (sessionResult.error || !sessionResult.data) {
      setPhase('not-authenticated');
      return;
    }

    const result = await acceptFamilyInvitation(token);

    if (result.error) {
      setErrorMessage(result.error.message);
      setPhase('error');
      return;
    }

    setRole(result.data.role);
    setPhase('success');
  }, [token]);

  useEffect(() => {
    acceptInvitation();
  }, [acceptInvitation]);

  if (phase === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.loadingBadge}>
          <IconLink size="lg" color={colors.brand} />
        </View>
        <ActivityIndicator />
        <Text style={styles.loadingTitle}>Verificando invitación</Text>
        <Text style={styles.helperText}>Un momento…</Text>
      </View>
    );
  }

  if (phase === 'not-authenticated') {
    return (
      <EmptyState
        icon={<IconAlert size="lg" color={colors.brand} />}
        title="Iniciá sesión primero."
        desc="Necesitás una cuenta en Cuidamos para aceptar esta invitación. Iniciá sesión y volvé a abrir el link."
        action={<Button label="Ir a iniciar sesión" onPress={() => router.replace('/')} full />}
      />
    );
  }

  if (phase === 'error') {
    return (
      <EmptyState
        icon={<IconAlert size="lg" color={colors.error} />}
        title="Enlace inválido"
        desc={errorMessage ?? 'Este enlace de invitación ya fue usado o expiró.'}
        action={<Button label="Reintentar" onPress={acceptInvitation} full />}
      />
    );
  }

  return (
    <EmptyState
      icon={<IconCheck size="lg" color={colors.ok} />}
      title={`¡Listo! Ya formás parte de la familia${role ? ` como ${role}` : ''}.`}
      desc="Ya podés coordinar turnos y medicación con el resto de la familia."
      action={<Button label="Ir al calendario" onPress={() => router.replace('/calendar')} full />}
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
  },
  loadingBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loadingTitle: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
  },
  helperText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    textAlign: 'center',
  },
});
