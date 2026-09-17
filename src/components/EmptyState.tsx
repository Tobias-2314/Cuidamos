import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  desc: string;
  action?: ReactNode;
}

/** Calco del `EmptyState` del prototipo de Figma Make -- ícono circular + título + descripción + acción opcional. */
export function EmptyState({ icon, title, desc, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconBadge}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{desc}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 32,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  action: {
    alignSelf: 'stretch',
  },
});
