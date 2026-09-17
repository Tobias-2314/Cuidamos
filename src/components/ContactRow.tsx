import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';
import { IconChevronRight, IconPerson, IconPhone } from './icons';

interface ContactRowProps {
  name: string;
  sub: string;
  phone?: string | null;
  onPress?: () => void;
}

/** Calco del `ContactRow` del prototipo de Figma Make -- fila de contacto tappable con ícono de llamar. */
export function ContactRow({ name, sub, phone, onPress }: ContactRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${sub}`}
      style={styles.row}
    >
      <View style={styles.avatarBadge}>
        <IconPerson size="sm" color={colors.brand} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {phone ? (
        <Pressable
          onPress={() => Linking.openURL(`tel:${phone}`)}
          accessibilityRole="button"
          accessibilityLabel={`Llamar a ${name}`}
          hitSlop={8}
        >
          <IconPhone size="sm" color={colors.brand} />
        </Pressable>
      ) : null}
      <IconChevronRight size="sm" color={colors.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatarBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink,
  },
  sub: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink2,
  },
});
