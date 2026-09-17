import 'react-native-reanimated';

import { Stack } from 'expo-router';

import { useAppFonts } from '../src/theme/useAppFonts';

export default function RootLayout() {
  const fontsLoaded = useAppFonts();

  if (!fontsLoaded) {
    return null;
  }

  return <Stack />;
}
