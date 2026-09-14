import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { createFamilyInvitation, getCurrentUserRoleInFamily, type FamilyInvitation } from './familyService';
import { buildInvitationLink, buildInvitationShareMessage } from './invitationLink';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';

/**
 * `phase` sigue el mismo criterio de estados explícitos que el resto del
 * repo:
 * - 'loading': resolviendo familia + rol del usuario actual.
 * - 'no-family': el usuario no tiene familia todavía -- se lo manda a
 *   crear una (`/family/create`), no tiene sentido invitar sin familia.
 * - 'not-admin': tiene familia pero no es admin -- solo un admin puede
 *   generar invitaciones (`family_invitations_insert_admin`, PGM-19). No
 *   intentamos la RPC igual para "ver qué pasa": se lo explicamos antes.
 * - 'error': falló la carga inicial.
 * - 'ready': puede generar invitaciones.
 */
type Phase = 'loading' | 'no-family' | 'not-admin' | 'error' | 'ready';

export function InviteFamilyScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<FamilyInvitation | null>(null);

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);
    setInvitation(null);

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

    const roleResult = await getCurrentUserRoleInFamily(familyResult.data);
    if (roleResult.error) {
      setLoadErrorMessage(roleResult.error.message);
      setPhase('error');
      return;
    }

    if (roleResult.data !== 'admin') {
      setPhase('not-admin');
      return;
    }

    setPhase('ready');
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  async function handleGenerateInvitation() {
    setIsGenerating(true);
    setGenerateError(null);

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error || !familyResult.data) {
      setIsGenerating(false);
      setGenerateError(familyResult.error?.message ?? 'No pudimos encontrar tu familia.');
      return;
    }

    const result = await createFamilyInvitation(familyResult.data);

    setIsGenerating(false);

    if (result.error) {
      setGenerateError(result.error.message);
      return;
    }

    setInvitation(result.data);
  }

  async function handleShare() {
    if (!invitation) {
      return;
    }

    try {
      await Share.share({ message: buildInvitationShareMessage(invitation.token) });
    } catch {
      // `Share.share` puede rechazar si el usuario cancela el share sheet --
      // no es un error a mostrarle, simplemente no pasó nada.
    }
  }

  const expiresAtLabel = invitation
    ? new Date(invitation.expiresAt).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null;

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
        <Text style={styles.helperText}>Creá una familia antes de invitar a otros cuidadores.</Text>
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

  if (phase === 'not-admin') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Solo un admin de la familia puede invitar.</Text>
        <Text style={styles.helperText}>
          Pedile a quien creó la familia que te comparta el link de invitación, o que te dé el
          rol de admin.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Invitar a un cuidador</Text>
      <Text style={styles.subtitle}>
        Generá un link de invitación y compartilo por WhatsApp, email o donde prefieras. Vence
        a los 7 días.
      </Text>

      {generateError ? (
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {generateError}
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          isGenerating && styles.buttonDisabled,
          pressed && !isGenerating && styles.buttonPressed,
        ]}
        onPress={handleGenerateInvitation}
        disabled={isGenerating}
        accessibilityRole="button"
        accessibilityLabel="Generar invitación"
        accessibilityState={{ busy: isGenerating }}
      >
        {isGenerating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {invitation ? 'Generar otra invitación' : 'Generar invitación'}
          </Text>
        )}
      </Pressable>

      {invitation ? (
        <View style={styles.invitationBox}>
          <Text style={styles.invitationLabel}>Link de invitación</Text>
          <Text style={styles.invitationLink} selectable>
            {buildInvitationLink(invitation.token)}
          </Text>
          <Text style={styles.helperText}>Vence el {expiresAtLabel}.</Text>

          <Pressable
            style={styles.secondaryButton}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Compartir invitación"
          >
            <Text style={styles.secondaryButtonText}>Compartir</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 20,
  },
  helperText: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#b3261e',
    fontWeight: '500',
    marginBottom: 8,
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
  button: {
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#a8c3b6',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  invitationBox: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#f7f9f8',
    gap: 6,
  },
  invitationLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  invitationLink: {
    fontSize: 15,
    color: '#111',
    fontWeight: '500',
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
