import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radii, fontFamily } from '../theme/tokens';

interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
}

/**
 * Input compartido -- radio (`radii.xl`), fondo `surface2` y tipografía
 * calcados del componente `Field`/`Input` del prototipo de Figma Make
 * (`App.tsx`). Reemplaza el bloque label+TextInput+hint/error que cada
 * pantalla repetía con sus propios estilos.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, style, ...inputProps },
  ref
) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[styles.input, style]}
        placeholderTextColor={colors.ink3}
        accessibilityLabel={label}
        {...inputProps}
      />
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    fontWeight: '600',
    color: colors.ink2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    backgroundColor: colors.surface2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  hint: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
  },
  error: {
    fontSize: 14,
    fontFamily: fontFamily.medium,
    fontWeight: '500',
    color: colors.error,
  },
});
