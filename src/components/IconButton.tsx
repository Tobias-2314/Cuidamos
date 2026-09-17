import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from '../theme/tokens';

export type IconButtonVariant = 'solid' | 'light';

interface IconButtonProps {
  icon: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: number;
}

/**
 * Botón circular de solo ícono -- calco de los patrones ad hoc del Figma
 * (`w-9 h-9 rounded-full bg-brand text-white` / `bg-brand-light text-brand`)
 * que se repiten en varias pantallas (agregar turno, editar perfil, etc.)
 * pero no pasan por el `Btn` con label.
 */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'light',
  size = 36,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: variant === 'solid' ? colors.brand : colors.brandLight,
        },
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
