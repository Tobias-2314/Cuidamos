import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

export type BadgeVariant = 'default' | 'ok' | 'warn' | 'error' | 'brand';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const VARIANT_STYLES: Record<BadgeVariant, { backgroundColor: string; textColor: string }> = {
  default: { backgroundColor: colors.surface2, textColor: colors.ink2 },
  ok: { backgroundColor: colors.okBg, textColor: colors.ok },
  warn: { backgroundColor: colors.warnBg, textColor: colors.warn },
  error: { backgroundColor: colors.errorBg, textColor: colors.error },
  brand: { backgroundColor: colors.brandLight, textColor: colors.brand },
};

/** Calco del `Badge` del prototipo de Figma Make -- pastilla chica de estado/rol. */
export function Badge({ label, variant = 'default' }: BadgeProps) {
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <View style={[styles.badge, { backgroundColor: variantStyle.backgroundColor }]}>
      <Text style={[styles.label, { color: variantStyle.textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  label: {
    fontSize: 12,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
  },
});
