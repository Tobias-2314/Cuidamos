import { StyleSheet, View } from 'react-native';

import { Button } from './Button';

interface FormFooterProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondLabel?: string;
  onSecondPress?: () => void;
}

/** Calco del `FormFooter` del prototipo de Figma Make -- botón primario + opcional botón "danger" debajo. */
export function FormFooter({
  label,
  onPress,
  disabled,
  loading,
  secondLabel,
  onSecondPress,
}: FormFooterProps) {
  return (
    <View style={styles.footer}>
      <Button label={label} onPress={onPress ?? (() => {})} disabled={disabled} loading={loading} full size="lg" />
      {secondLabel ? (
        <Button label={secondLabel} onPress={onSecondPress ?? (() => {})} variant="danger" full />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 12,
  },
});
