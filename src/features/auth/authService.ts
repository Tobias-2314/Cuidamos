import { z } from 'zod';
import type { AuthError, Session } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { supabase } from '../../lib/supabase';
import {
  normalizeUnexpectedError as normalizeUnexpectedServiceError,
  type ServiceError,
  type ServiceResult,
} from '../../lib/serviceResult';

// Requisito de expo-web-browser: cierra el tab/overlay de auth en web una
// vez que el redirect vuelve a la app. No-op en iOS/Android.
WebBrowser.maybeCompleteAuthSession();

/**
 * Normalized error shape returned by every function in this module.
 * Never carries tokens or other sensitive Supabase response data —
 * only a stable `code` and a user-facing `message`.
 */
export type AuthServiceError = ServiceError;

export type AuthResult<T> = ServiceResult<T>;

export interface MagicLinkOptions {
  /**
   * Deep link the user lands on after tapping the magic link email.
   * Left undefined to fall back to the Supabase project's configured
   * Site URL. The Frontend issue (PGM-17) is responsible for supplying
   * a concrete deep link once the callback route exists.
   */
  emailRedirectTo?: string;
}

const emailSchema = z
  .string()
  .trim()
  .min(1, 'El email es obligatorio.')
  .email('Ingresá un email válido.');

const GENERIC_ERROR_MESSAGE = 'No pudimos completar la operación. Intentá de nuevo.';

function normalizeAuthError(error: AuthError): AuthServiceError {
  return {
    code: error.code ?? 'auth_error',
    message: error.message || GENERIC_ERROR_MESSAGE,
  };
}

function normalizeUnexpectedError(context: string, error: unknown): AuthServiceError {
  return normalizeUnexpectedServiceError('authService', context, error, GENERIC_ERROR_MESSAGE);
}

/**
 * Sends a magic link to `email`. Validates the email locally before
 * ever calling Supabase, so an invalid address fails fast with a clear
 * message instead of a cryptic API error.
 */
export async function signInWithMagicLink(
  email: string,
  options: MagicLinkOptions = {}
): Promise<AuthResult<{ email: string }>> {
  const parsed = emailSchema.safeParse(email);

  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'invalid_email',
        message: parsed.error.issues[0]?.message ?? 'Ingresá un email válido.',
      },
    };
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo: options.emailRedirectTo,
      },
    });

    if (error) {
      return { data: null, error: normalizeAuthError(error) };
    }

    return { data: { email: parsed.data }, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('signInWithMagicLink', err) };
  }
}

/**
 * Signs in with Google via Supabase OAuth (PKCE flow). Opens the system
 * browser for the Google consent screen and comes back through the app's
 * `cuidamos://` deep link -- same auto-create-on-first-login behavior as
 * `signInWithMagicLink`, Supabase creates the account the first time a
 * given Google account signs in.
 *
 * Requires the Google provider to be configured in Supabase Auth (Google
 * Cloud OAuth client id/secret) -- returns a clear error if it isn't set up
 * yet instead of a cryptic provider error.
 */
export async function signInWithGoogle(): Promise<AuthResult<{ session: Session }>> {
  try {
    const redirectTo = Linking.createURL('/');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      return { data: null, error: normalizeAuthError(error) };
    }

    const authSessionResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (authSessionResult.type !== 'success') {
      // The user closed the browser or cancelled -- not a real error.
      return {
        data: null,
        error: { code: 'oauth_cancelled', message: 'Cancelaste el inicio de sesión con Google.' },
      };
    }

    const { queryParams } = Linking.parse(authSessionResult.url);
    const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
    const oauthError = typeof queryParams?.error_description === 'string'
      ? queryParams.error_description
      : null;

    if (oauthError) {
      return { data: null, error: { code: 'oauth_error', message: GENERIC_ERROR_MESSAGE } };
    }

    if (!code) {
      return { data: null, error: { code: 'oauth_no_code', message: GENERIC_ERROR_MESSAGE } };
    }

    const { data: sessionData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return { data: null, error: normalizeAuthError(exchangeError) };
    }

    if (!sessionData.session) {
      return { data: null, error: { code: 'oauth_no_session', message: GENERIC_ERROR_MESSAGE } };
    }

    return { data: { session: sessionData.session }, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('signInWithGoogle', err) };
  }
}

/** Signs the current user out of the active Supabase session. */
export async function signOut(): Promise<AuthResult<null>> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { data: null, error: normalizeAuthError(error) };
    }

    return { data: null, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('signOut', err) };
  }
}

/** Reads the current session, if any, from local storage/cache. */
export async function getSession(): Promise<AuthResult<Session | null>> {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return { data: null, error: normalizeAuthError(error) };
    }

    return { data: data.session, error: null };
  } catch (err: unknown) {
    return { data: null, error: normalizeUnexpectedError('getSession', err) };
  }
}

export interface AuthSubscription {
  unsubscribe: () => void;
}

/**
 * Subscribes to Supabase Auth state changes (sign in, sign out, token
 * refresh). Returns an object with `unsubscribe()` so callers (e.g. a
 * Frontend hook) can clean up in a `useEffect` return function.
 */
export function onAuthStateChange(
  callback: (session: Session | null) => void
): AuthSubscription {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return { unsubscribe: () => subscription.unsubscribe() };
}
