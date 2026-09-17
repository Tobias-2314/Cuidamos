import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';

import { colors, radii, fontFamily } from '../theme/tokens';

function triggerPressHaptic() {
  // expo-haptics no tiene sentido (ni feedback real) en el preview web.
  if (Platform.OS === 'web') {
    return;
  }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
    // Dispositivo sin soporte de haptics -- degradar en silencio, el botón
    // sigue funcionando perfecto solo con el feedback visual.
  });
}

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  /** Ícono opcional antes del label -- calco de `icon` en el `Btn` de Figma. */
  icon?: ReactNode;
}

const SIZE_STYLES: Record<
  ButtonSize,
  { paddingHorizontal: number; paddingVertical: number; fontSize: number }
> = {
  sm: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 14 },
  md: { paddingHorizontal: 20, paddingVertical: 14, fontSize: 16 },
  lg: { paddingHorizontal: 24, paddingVertical: 16, fontSize: 18 },
};

const VARIANT_STYLES: Record<
  ButtonVariant,
  { backgroundColor: string; textColor: string; borderColor?: string; borderWidth?: number }
> = {
  primary: { backgroundColor: colors.brand, textColor: colors.white },
  secondary: { backgroundColor: colors.brandLight, textColor: colors.brand },
  outline: {
    backgroundColor: 'transparent',
    textColor: colors.brand,
    borderColor: colors.brand,
    borderWidth: 2,
  },
  ghost: { backgroundColor: 'transparent', textColor: colors.ink2 },
  danger: {
    backgroundColor: colors.errorBg,
    textColor: colors.error,
    borderColor: colors.errorMid,
    borderWidth: 1,
  },
};

/**
 * Botón compartido -- radios (`radii.xl`), tamaños y variantes calcados del
 * componente `Btn` del prototipo de Figma Make (`App.tsx`). El
 * `active:scale-[.97] transition-all` de Figma se traduce acá en una
 * animación real de Moti al presionar, en vez de un mero cambio de opacidad.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  full = false,
  disabled = false,
  loading = false,
  accessibilityLabel,
  icon,
}: ButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const sizeStyle = SIZE_STYLES[size];
  const variantStyle = VARIANT_STYLES[variant];
  const isDisabled = disabled || loading;

  return (
    <MotiView
      animate={{ scale: isPressed ? 0.97 : 1 }}
      transition={{ type: 'timing', duration: 100 }}
      style={full ? styles.full : undefined}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          setIsPressed(true);
          if (!isDisabled) {
            triggerPressHaptic();
          }
        }}
        onPressOut={() => setIsPressed(false)}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={[
          styles.base,
          {
            paddingHorizontal: sizeStyle.paddingHorizontal,
            paddingVertical: sizeStyle.paddingVertical,
            backgroundColor: variantStyle.backgroundColor,
            borderColor: variantStyle.borderColor,
            borderWidth: variantStyle.borderWidth ?? 0,
          },
          isDisabled && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={variantStyle.textColor} />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text
              style={[styles.label, { color: variantStyle.textColor, fontSize: sizeStyle.fontSize }]}
            >
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  full: {
    width: '100%',
  },
  base: {
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
  },
});
