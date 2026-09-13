import { StatusBar } from 'expo-status-bar';

import { LoginScreen } from '../src/features/auth/LoginScreen';

export default function Index() {
  return (
    <>
      <LoginScreen />
      <StatusBar style="auto" />
    </>
  );
}
