import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';

/**
 * Carga las variantes de Nunito usadas por `fontFamily` (`tokens.ts`).
 * `app/_layout.tsx` bloquea el render hasta que esto devuelva `true`.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  return loaded;
}
