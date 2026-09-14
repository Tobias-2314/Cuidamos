import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getSession } from '../auth/authService';
import { acceptFamilyInvitation } from './familyService';

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
        <ActivityIndicator />
        <Text style={styles.helperText}>Uniéndote a la familia…</Text>
      </View>
    );
  }

  if (phase === 'not-authenticated') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Iniciá sesión primero.</Text>
        <Text style={styles.helperText}>
          Necesitás una cuenta en Cuidamos para aceptar esta invitación. Iniciá sesión y volvé a
          abrir el link.
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="Ir a iniciar sesión"
        >
          <Text style={styles.retryButtonText}>Ir a iniciar sesión</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {errorMessage}
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={acceptInvitation}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.centerContainer}>
      <Text style={styles.emptyTitle} accessibilityRole="alert" accessibilityLiveRegion="polite">
        ¡Listo! Ya formás parte de la familia{role ? ` como ${role}` : ''}.
      </Text>
      <Pressable
        style={styles.retryButton}
        onPress={() => router.replace('/calendar')}
        accessibilityRole="button"
        accessibilityLabel="Ir al calendario"
      >
        <Text style={styles.retryButtonText}>Ir al calendario</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  helperText: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#b3261e',
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
