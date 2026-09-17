import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  name: string;
  color?: string;
  size?: AvatarSize;
}

const SIZE_PX: Record<AvatarSize, number> = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

const FONT_SIZE: Record<AvatarSize, number> = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/** Calco del `Avatar` del prototipo de Figma Make -- círculo con iniciales sobre un color sólido. */
export function Avatar({ name, color = colors.brand, size = 'md' }: AvatarProps) {
  const px = SIZE_PX[size];

  return (
    <View
      style={[
        styles.circle,
        { width: px, height: px, borderRadius: px / 2, backgroundColor: color },
      ]}
    >
      <Text style={[styles.initials, { fontSize: FONT_SIZE[size] }]}>{getInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: colors.white,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
  },
});
