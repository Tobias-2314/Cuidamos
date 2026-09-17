import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MotiView } from 'moti';

import { colors, radii, shadow } from '../theme/tokens';

interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Posición dentro de una lista de Cards -- escalona la animación de
   * entrada (cada una aparece un poco después que la anterior) en vez de
   * que todas salten a la vez. Omitir en cards sueltas (sin lista).
   */
  index?: number;
}

const STAGGER_STEP_MS = 60;
const MAX_STAGGER_DELAY_MS = 240;

/**
 * Calco del `Card` del prototipo de Figma Make (`bg-surface border
 * border-border rounded-2xl`), con una sombra suave (el prototipo, siendo
 * web, no la necesitaba para leerse como "elevado" -- acá sí) y una entrada
 * de fade+slide con Moti: motion con propósito (orienta que el contenido
 * recién llegó), no decorativo.
 */
export function Card({ children, style, index = 0 }: CardProps) {
  const delay = Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_DELAY_MS);

  return (
    <MotiView
      style={[styles.card, style]}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 250, delay }}
    >
      {children}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    ...shadow.md,
  },
});
