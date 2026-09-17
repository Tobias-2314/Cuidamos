import { StyleSheet, type DimensionValue } from 'react-native';
import { MotiView } from 'moti';

import { colors, radii } from '../theme/tokens';

interface SkeletonProps {
  height: number;
  width?: DimensionValue;
}

/**
 * Calco del `Skeleton` del prototipo de Figma Make (`bg-border-2 rounded-xl
 * animate-pulse`) -- acá el pulso es una animación real de Moti en vez de la
 * animación CSS del prototipo.
 */
export function Skeleton({ height, width = '100%' }: SkeletonProps) {
  return (
    <MotiView
      style={[styles.block, { height, width }]}
      from={{ opacity: 0.5 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: 800, loop: true }}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.border2,
    borderRadius: radii.xl,
  },
});
