import { AuthError } from '@supabase/supabase-js';

import { supabase } from '../../../lib/supabase';
import { getSession, onAuthStateChange, signInWithMagicLink, signOut } from '../authService';

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));

const mockedSignInWithOtp = supabase.auth.signInWithOtp as jest.Mock;
const mockedSignOut = supabase.auth.signOut as jest.Mock;
const mockedGetSession = supabase.auth.getSession as jest.Mock;
const mockedOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signInWithMagicLink', () => {
    test('rejects an invalid email without calling Supabase', async () => {
      // Arrange
      const invalidEmail = 'not-an-email';

      // Act
      const result = await signInWithMagicLink(invalidEmail);

      // Assert
      expect(result.error).toEqual({
        code: 'invalid_email',
        message: expect.any(String),
      });
      expect(result.data).toBeNull();
      expect(mockedSignInWithOtp).not.toHaveBeenCalled();
    });

    test('calls signInWithOtp with the expected params on a valid email', async () => {
      // Arrange
      mockedSignInWithOtp.mockResolvedValue({ data: {}, error: null });

      // Act
      const result = await signInWithMagicLink('  User@Example.com  ', {
        emailRedirectTo: 'cuidamos://auth/callback',
      });

      // Assert
      expect(mockedSignInWithOtp).toHaveBeenCalledTimes(1);
      expect(mockedSignInWithOtp).toHaveBeenCalledWith({
        email: 'User@Example.com',
        options: { emailRedirectTo: 'cuidamos://auth/callback' },
      });
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ email: 'User@Example.com' });
    });

    test('normalizes a Supabase auth error instead of propagating it raw', async () => {
      // Arrange
      const supabaseError = new AuthError('Email rate limit exceeded', 429, 'over_email_send_rate_limit');
      mockedSignInWithOtp.mockResolvedValue({ data: null, error: supabaseError });

      // Act
      const result = await signInWithMagicLink('user@example.com');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({
        code: 'over_email_send_rate_limit',
        message: 'Email rate limit exceeded',
      });
    });

    test('normalizes an unexpected thrown error without leaking its contents', async () => {
      // Arrange
      mockedSignInWithOtp.mockRejectedValue(new Error('ECONNRESET: leaked internal detail'));

      // Act
      const result = await signInWithMagicLink('user@example.com');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('unexpected_error');
      expect(result.error?.message).not.toMatch(/ECONNRESET/);
    });
  });

  describe('signOut', () => {
    test('calls supabase.auth.signOut and returns no error on success', async () => {
      // Arrange
      mockedSignOut.mockResolvedValue({ error: null });

      // Act
      const result = await signOut();

      // Assert
      expect(mockedSignOut).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: null, error: null });
    });

    test('normalizes a Supabase error on sign out', async () => {
      // Arrange
      const supabaseError = new AuthError('Network error', 500, 'unexpected_failure');
      mockedSignOut.mockResolvedValue({ error: supabaseError });

      // Act
      const result = await signOut();

      // Assert
      expect(result.error).toEqual({ code: 'unexpected_failure', message: 'Network error' });
    });
  });

  describe('getSession', () => {
    test('returns the current session', async () => {
      // Arrange
      const fakeSession = { access_token: 'token', user: { id: '1' } };
      mockedGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });

      // Act
      const result = await getSession();

      // Assert
      expect(result.data).toBe(fakeSession);
      expect(result.error).toBeNull();
    });

    test('normalizes an error when reading the session fails', async () => {
      // Arrange
      const supabaseError = new AuthError('Session missing', 400, 'session_not_found');
      mockedGetSession.mockResolvedValue({ data: { session: null }, error: supabaseError });

      // Act
      const result = await getSession();

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: 'session_not_found', message: 'Session missing' });
    });
  });

  describe('onAuthStateChange', () => {
    test('forwards session changes to the callback and exposes unsubscribe', () => {
      // Arrange
      const unsubscribe = jest.fn();
      let registeredCallback: ((event: string, session: unknown) => void) | undefined;
      mockedOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
        registeredCallback = cb;
        return { data: { subscription: { unsubscribe } } };
      });
      const callback = jest.fn();

      // Act
      const subscription = onAuthStateChange(callback);
      registeredCallback?.('SIGNED_IN', { access_token: 'abc' });
      subscription.unsubscribe();

      // Assert
      expect(callback).toHaveBeenCalledWith({ access_token: 'abc' });
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
