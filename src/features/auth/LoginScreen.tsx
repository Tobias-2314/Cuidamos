import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useRouter } from 'expo-router';

import { signInWithGoogle, signInWithMagicLink } from './authService';
import { isValidEmail } from './isValidEmail';
import { colors, radii, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { Divider } from '../../components/Divider';

/**
 * Corazón del prototipo de Figma Make (mismo path SVG que `IHeart` en
 * `App.tsx`). El prototipo no le fija color explícito sobre el fondo
 * `bg-brand` -- heredaría el texto oscuro del body y quedaría casi
 * invisible. Cada otro uso de un ícono sobre `bg-brand` sólido en ese mismo
 * archivo sí fija `text-white`, así que replicamos esa convención acá en vez
 * del olvido puntual del prototipo.
 */
function HeartLogo() {
  return (
    <View style={styles.logoBadge}>
      <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
        <Path
          d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
          stroke={colors.white}
          strokeWidth={1.85}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/**
 * `phase` tracks which screen the user sees:
 * - 'form': the email input (covers the `idle`, `loading` and `error`
 *   states from the issue — `isSubmitting`/`formError` distinguish them).
 * - 'sent': the "revisá tu email" confirmation, with its own
 *   resend affordance (`isResending`/`resendError`).
 */
type Phase = 'form' | 'sent';

/**
 * Pantalla de entrada de la app (alta + login del cuidador).
 *
 * Cuidamos usa magic link por email: no hay contraseña ni un flujo
 * separado de "registro" — Supabase crea la cuenta automáticamente la
 * primera vez que un email pide un link. Por eso esta es la única
 * pantalla de auth.
 */
export function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('form');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const canSubmit = !isSubmitting && isValidEmail(email);

  async function handleSendMagicLink() {
    if (!isValidEmail(email) || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const result = await signInWithMagicLink(email);

    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error.message);
      return;
    }

    setSentToEmail(result.data.email);
    setPhase('sent');
  }

  async function handleGoogleSignIn() {
    if (isGoogleSubmitting) {
      return;
    }

    setIsGoogleSubmitting(true);
    setGoogleError(null);

    const result = await signInWithGoogle();

    setIsGoogleSubmitting(false);

    if (result.error) {
      // Cancelar el picker de Google no es un error real -- no lo mostramos.
      if (result.error.code !== 'oauth_cancelled') {
        setGoogleError(result.error.message);
      }
      return;
    }

    router.replace('/calendar');
  }

  async function handleResend() {
    if (!sentToEmail || isResending) {
      return;
    }

    setIsResending(true);
    setResendError(null);

    const result = await signInWithMagicLink(sentToEmail);

    setIsResending(false);

    if (result.error) {
      setResendError(result.error.message);
      return;
    }
  }

  function handleEditEmail() {
    setPhase('form');
    setFormError(null);
    setResendError(null);
  }

  function handleChangeEmail(value: string) {
    setEmail(value);
    if (formError) {
      setFormError(null);
    }
  }

  if (phase === 'sent' && sentToEmail) {
    return (
      <View style={styles.container}>
        <SentConfirmation
          email={sentToEmail}
          isResending={isResending}
          resendError={resendError}
          onResend={handleResend}
          onEditEmail={handleEditEmail}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.centeredGroup}>
          <View style={styles.header}>
            <HeartLogo />
            <View>
              <Text style={styles.title}>Cuidamos</Text>
              <Text style={styles.subtitle}>Coordiná el cuidado en familia</Text>
            </View>
          </View>

          <View style={styles.form}>
            <TextField
              label="Tu email"
              value={email}
              onChangeText={handleChangeEmail}
              placeholder="nombre@ejemplo.com"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
              returnKeyType="send"
              onSubmitEditing={handleSendMagicLink}
              accessibilityHint="Ingresá el email con el que querés entrar a Cuidamos"
              hint="Te vamos a mandar un link para entrar. No necesitás contraseña."
              error={formError}
            />

            <Button
              label="Enviar link mágico"
              onPress={handleSendMagicLink}
              disabled={!canSubmit}
              loading={isSubmitting}
              size="lg"
              full
            />
          </View>

          <View style={styles.googleSection}>
            <Divider label="o" />

            {googleError ? (
              <Text
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {googleError}
              </Text>
            ) : null}

            <Button
              label="Continuar con Google"
              onPress={handleGoogleSignIn}
              variant="outline"
              loading={isGoogleSubmitting}
              size="lg"
              full
            />
          </View>
        </View>

        <Text style={styles.legalText}>
          Al continuar aceptás nuestros Términos y Política de Privacidad
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface SentConfirmationProps {
  email: string;
  isResending: boolean;
  resendError: string | null;
  onResend: () => void;
  onEditEmail: () => void;
}

function SentConfirmation({
  email,
  isResending,
  resendError,
  onResend,
  onEditEmail,
}: SentConfirmationProps) {
  return (
    <View>
      <Text style={styles.title}>Revisá tu email</Text>
      <Text style={styles.sentBody}>
        Te enviamos un link a <Text style={styles.sentEmail}>{email}</Text>. Abrí el correo y
        tocá el enlace para entrar a Cuidamos.
      </Text>
      <Text style={styles.helperText}>¿No te llegó? Revisá también la carpeta de spam.</Text>

      {resendError ? (
        <Text
          style={styles.errorText}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {resendError}
        </Text>
      ) : null}

      <View style={styles.sentActions}>
        <Button
          label="Reenviar el link"
          onPress={onResend}
          disabled={isResending}
          loading={isResending}
          size="lg"
          full
        />
        <Button label="Usar otro email" onPress={onEditEmail} variant="ghost" full />
      </View>
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
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: 24,
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: colors.surface,
  },
  centeredGroup: {
    flex: 1,
    justifyContent: 'center',
    gap: 32,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: radii.badge,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  legalText: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 30,
    fontFamily: fontFamily.extraBold,
    fontWeight: '800',
    textAlign: 'center',
    color: colors.ink,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    color: colors.ink2,
    marginTop: 4,
  },
  form: {
    gap: 12,
  },
  googleSection: {
    gap: 12,
  },
  helperText: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    fontFamily: fontFamily.medium,
    fontWeight: '500',
    marginBottom: 12,
  },
  sentActions: {
    gap: 8,
    marginTop: 8,
  },
  sentBody: {
    fontSize: 16,
    color: colors.ink,
    fontFamily: fontFamily.regular,
    textAlign: 'center',
    marginBottom: 12,
  },
  sentEmail: {
    fontFamily: fontFamily.bold,
    fontWeight: '700',
  },
});
