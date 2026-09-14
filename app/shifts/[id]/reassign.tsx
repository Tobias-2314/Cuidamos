import { router, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { ShiftReassignScreen } from '../../../src/features/shifts/ShiftReassignScreen';

const Params = z.object({ id: z.string().uuid() });

/**
 * Valida el `id` de la ruta con `safeParse` (no `parse`) -- mismo criterio
 * que `app/medications/[id]/edit.tsx`: un `id` mal formado no debe tirar una
 * excepción durante el render y crashear la pantalla, redirige en cambio.
 */
export default function ReassignShift() {
  const parsed = Params.safeParse(useLocalSearchParams());

  if (!parsed.success) {
    router.replace('/calendar');
    return null;
  }

  return <ShiftReassignScreen shiftId={parsed.data.id} />;
}
