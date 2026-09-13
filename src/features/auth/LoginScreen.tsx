import { useState } from 'react';
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

import { signInWithMagicLink } from './authService';
import { isValidEmail } from './isValidEmail';

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
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('form');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Cuidamos</Text>
        <Text style={styles.subtitle}>
          Coordiná el cuidado de tu familia, todo en un solo lugar.
        </Text>

        <View style={styles.form}>
          <Text style={styles.label} nativeID="emailLabel">
            Tu email
          </Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={handleChangeEmail}
            placeholder="nombre@ejemplo.com"
            placeholderTextColor="#999"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
            returnKeyType="send"
            onSubmitEditing={handleSendMagicLink}
            accessibilityLabel="Tu email"
            accessibilityLabelledBy="emailLabel"
            accessibilityHint="Ingresá el email con el que querés entrar a Cuidamos"
          />
          <Text style={styles.helperText}>
            Te vamos a mandar un link para entrar. No necesitás contraseña.
          </Text>

          {formError ? (
            <Text
              style={styles.errorText}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {formError}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={handleSendMagicLink}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Enviar link mágico"
            accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Enviar link mágico</Text>
            )}
          </Pressable>
        </View>
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

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onResend}
        disabled={isResending}
        accessibilityRole="button"
        accessibilityLabel="Reenviar el link"
        accessibilityState={{ busy: isResending }}
      >
        {isResending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Reenviar el link</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={onEditEmail}
        accessibilityRole="button"
        accessibilityLabel="Usar otro email"
      >
        <Text style={styles.secondaryButtonText}>Usar otro email</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#fff',
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#555',
    marginBottom: 32,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  helperText: {
    fontSize: 13,
    color: '#777',
  },
  errorText: {
    fontSize: 14,
    color: '#b3261e',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
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
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#2f6f4f',
    fontSize: 15,
    fontWeight: '600',
  },
  sentBody: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 12,
  },
  sentEmail: {
    fontWeight: '700',
  },
});
