import { z } from 'zod';
import type { AuthError, Session } from '@supabase/supabase-js';

import { supabase } from '../../lib/supabase';

/**
 * Normalized error shape returned by every function in this module.
 * Never carries tokens or other sensitive Supabase response data —
 * only a stable `code` and a user-facing `message`.
 */
export interface AuthServiceError {
  code: string;
  message: string;
}

export type AuthResult<T> =
  | { data: T; error: null }
  | { data: null; error: AuthServiceError };

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

function normalizeUnexpectedError(error: unknown): AuthServiceError {
  // Never surface the raw error (it may wrap a network response or,
  // in edge cases, sensitive request/response data). Log only a
  // non-sensitive marker for observability.
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[authService] unexpected error while calling Supabase Auth');
  }

  return {
    code: 'unexpected_error',
    message: GENERIC_ERROR_MESSAGE,
  };
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
    return { data: null, error: normalizeUnexpectedError(err) };
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
    return { data: null, error: normalizeUnexpectedError(err) };
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
    return { data: null, error: normalizeUnexpectedError(err) };
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
