import { router, useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { MedicationFormScreen } from '../../../src/features/medications/MedicationFormScreen';

const Params = z.object({ id: z.string().uuid() });

/**
 * Valida el `id` de la ruta con `safeParse` (no `parse`): un deep link o un `id` mal
 * formado no debe tirar una excepción durante el render y crashear la pantalla -- mismo
 * criterio que el ejemplo de `rules/react-native/patterns.md` para params de ruta.
 */
export default function EditMedication() {
  const parsed = Params.safeParse(useLocalSearchParams());

  if (!parsed.success) {
    router.replace('/medications');
    return null;
  }

  return <MedicationFormScreen mode="edit" medicationId={parsed.data.id} />;
}
