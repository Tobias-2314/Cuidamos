import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

interface SectionHeaderProps {
  title: string;
  action?: ReactNode;
}

/** Calco del `SectionHeader` del prototipo de Figma Make -- título chico en mayúsculas + acción opcional. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 13,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
