import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

interface DividerProps {
  /** Texto opcional en el medio (ej. "o"). Sin esto es solo la línea. */
  label?: string;
}

/** Calco del `Divider` del prototipo de Figma Make -- línea de 1px en `border`. */
export function Divider({ label }: DividerProps) {
  if (!label) {
    return <View style={styles.line} />;
  }

  return (
    <View style={styles.row}>
      <View style={styles.line} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
  },
});
