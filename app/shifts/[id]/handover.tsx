import { router, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { ShiftHandoverFormScreen } from '../../../src/features/shifts/ShiftHandoverFormScreen';

const Params = z.object({ id: z.string().uuid() });

/**
 * Valida el `id` de la ruta con `safeParse` (no `parse`) -- mismo criterio
 * que `app/shifts/[id]/reassign.tsx`: un `id` mal formado no debe tirar una
 * excepción durante el render y crashear la pantalla, redirige en cambio.
 */
export default function ShiftHandover() {
  const parsed = Params.safeParse(useLocalSearchParams());

  if (!parsed.success) {
    router.replace('/calendar');
    return null;
  }

  return <ShiftHandoverFormScreen shiftId={parsed.data.id} />;
}
