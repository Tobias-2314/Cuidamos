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
    // PKCE en vez de implicit flow -- recomendado por Supabase para apps
    // nativas: el redirect de Google vuelve con un `?code=` en vez de un
    // `#access_token` en el fragment, que expo-linking parsea directo.
    flowType: 'pkce',
    // El intercambio del `code` lo hacemos a mano en `authService.signInWithGoogle`
    // (única vez, en la pestaña original). Si el cliente auto-detecta el `code`
    // en la URL cuando el popup de OAuth recarga la app en web, consume el
    // `code_verifier` él solo y el canje manual de después falla con "PKCE
    // code verifier not found in storage" -- ya fue usado y borrado.
    detectSessionInUrl: false,
  },
});
