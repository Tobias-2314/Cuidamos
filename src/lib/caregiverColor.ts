import { caregiverPalette, colors } from '../theme/tokens';

/**
 * Color estable para distinguir cuidadores en avatares/turnos. "Vos"
 * (`isCurrentUser`) siempre es `colors.brand` -- convención ya establecida
 * en toda la app. Cualquier otro usuario recibe un color determinístico de
 * `caregiverPalette` según un hash de su `userId`: mismo cuidador, mismo
 * color siempre, sin necesidad de guardar una preferencia en la base.
 */
export function getCaregiverColor(userId: string, isCurrentUser: boolean): string {
  if (isCurrentUser) {
    return colors.brand;
  }

  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }

  return caregiverPalette[hash % caregiverPalette.length];
}
