import { z } from 'zod';

/**
 * Lightweight client-side check used only to enable/disable the submit
 * button as the user types (immediate feedback). The authoritative
 * validation — the one that actually decides whether Supabase gets
 * called — lives in `authService.signInWithMagicLink`, which re-validates
 * the email independently before sending the magic link.
 */
const quickEmailSchema = z.string().trim().min(1).email();

export function isValidEmail(value: string): boolean {
  return quickEmailSchema.safeParse(value).success;
}
