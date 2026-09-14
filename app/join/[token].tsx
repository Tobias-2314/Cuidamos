import { router, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { AcceptInvitationScreen } from '../../src/features/family/AcceptInvitationScreen';

const Params = z.object({ token: z.string().uuid() });

/**
 * Valida el `token` de la ruta con `safeParse` (no `parse`): un deep link
 * mal formado (ej. link viejo/manipulado) no debe tirar una excepción
 * durante el render y crashear la pantalla -- mismo criterio que
 * `app/medications/[id]/edit.tsx` (PGM-31) y `rules/react-native/patterns.md`.
 *
 * Alcanzable tanto por deep link (`cuidamos://join/<token>`, ver
 * `invitationLink.ts`) como por navegación interna de Expo Router.
 */
export default function Join() {
  const parsed = Params.safeParse(useLocalSearchParams());

  if (!parsed.success) {
    router.replace('/');
    return null;
  }

  return <AcceptInvitationScreen token={parsed.data.token} />;
}
