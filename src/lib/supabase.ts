import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ??
  '';

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined) ??
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] URL o anon key no configurados. Definí EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY en .env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
