import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { formatShiftTimeRange } from './calendarSections';
import {
  isValidShiftHandoverField,
  MAX_SHIFT_HANDOVER_FIELD_LENGTH,
} from './shiftHandoverValidation';
import { createShiftHandover } from './shiftHandoversService';
import { getShiftById, type Shift } from './shiftsService';
import { colors, fontFamily, radii } from '../../theme/tokens';

interface ShiftHandoverFormScreenProps {
  shiftId: string;
}

/**
 * `phase` -- mismo criterio explícito que `ShiftReassignScreen` (PGM-29):
 * 'loading' mientras se resuelve el turno que se está cerrando, 'error' ante
 * cualquier falla de carga (incluida "el turno no existe o no sos miembro de
 * esa familia" -- RLS lo resuelve como un error de fetch, no un estado
 * distinto), 'ready' cuando el formulario ya se puede completar.
 */
type Phase = 'loading' | 'error' | 'ready';

/**
 * Formulario de cierre de turno (F5, PGM-36) -- "diario de guardia" corto
 * entre cuidadores. Criterio de producto no negociable: "Traspaso de turno
 * < 30 segundos: máximo 4 campos, escritura mínima" (docs/product-vision.md).
 * Los 4 campos son EXACTAMENTE los del modelo de datos de PGM-35: resumen
 * del turno, qué comió la persona cuidada, ánimo/estado, pendientes para el
 * próximo turno -- todos opcionales (ver `shiftHandoverValidation.ts`), pero
 * se exige al menos uno completado antes de habilitar "Guardar" (decisión de
 * producto documentada en esa misma validación).
 *
 * Llama a `createShiftHandover` (`shiftHandoversService.ts`), que a su vez invoca
 * la RPC `create_shift_handover` (`supabase/migrations/20260916140000_shift_handovers_rpc.sql`).
 */
export function ShiftHandoverFormScreen({ shiftId }: ShiftHandoverFormScreenProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);

  const [resumen, setResumen] = useState('');
  const [comida, setComida] = useState('');
  const [animo, setAnimo] = useState('');
  const [pendientes, setPendientes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadShift = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

    const shiftResult = await getShiftById(shiftId);
    if (shiftResult.error) {
      setLoadErrorMessage(shiftResult.error.message);
      setPhase('error');
      return;
    }

    setShift(shiftResult.data);
    setPhase('ready');
  }, [shiftId]);

  useEffect(() => {
    loadShift();
  }, [loadShift]);

  const trimmedFields = {
    resumen: resumen.trim(),
    comida: comida.trim(),
    animo: animo.trim(),
    pendientes: pendientes.trim(),
  };

  const allFieldsValid = Object.values(trimmedFields).every(isValidShiftHandoverField);
  const hasAnyContent = Object.values(trimmedFields).some((value) => value.length > 0);

  const canSubmit = !isSubmitting && allFieldsValid && hasAnyContent;

  function validationMessage(): string | null {
    if (!allFieldsValid) {
      return `Algún campo supera los ${MAX_SHIFT_HANDOVER_FIELD_LENGTH} caracteres. Achicalo para continuar.`;
    }
    if (!hasAnyContent) {
      return 'Completá al menos un campo para poder guardar el traspaso.';
    }
    return null;
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const result = await createShiftHandover({
      shiftId,
      resumen: trimmedFields.resumen.length > 0 ? trimmedFields.resumen : null,
      comida: trimmedFields.comida.length > 0 ? trimmedFields.comida : null,
      animo: trimmedFields.animo.length > 0 ? trimmedFields.animo : null,
      pendientes: trimmedFields.pendientes.length > 0 ? trimmedFields.pendientes : null,
    });

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    // Vuelve al calendario -- `CalendarScreen` recarga sola al volver a
    // tener foco (mismo criterio que el resto de los formularios del repo).
    router.back();
  }

  if (phase === 'loading') {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator />
        <Text style={styles.helperText}>Cargando…</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {loadErrorMessage}
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={loadShift}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  const message = validationMessage();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Cerrar turno</Text>
        {shift ? <Text style={styles.subtitle}>{formatShiftTimeRange(shift)}</Text> : null}
        <Text style={styles.helperIntro}>
          Dejá una nota rápida para quien siga el cuidado. Todos los campos son opcionales, pero
          completá al menos uno.
        </Text>

        <HandoverField
          label="Resumen del turno"
          value={resumen}
          onChangeText={setResumen}
          placeholder="Ej. tranquilo, sin incidentes"
          editable={!isSubmitting}
          accessibilityLabel="Resumen del turno"
        />

        <HandoverField
          label="Comida"
          value={comida}
          onChangeText={setComida}
          placeholder="Ej. almorzó bien, cenó poco"
          editable={!isSubmitting}
          accessibilityLabel="Qué comió la persona cuidada"
        />

        <HandoverField
          label="Ánimo"
          value={animo}
          onChangeText={setAnimo}
          placeholder="Ej. de buen humor, algo cansada"
          editable={!isSubmitting}
          accessibilityLabel="Ánimo o estado de la persona cuidada"
        />

        <HandoverField
          label="Pendientes para el próximo turno"
          value={pendientes}
          onChangeText={setPendientes}
          placeholder="Ej. renovar receta, llamar al médico el lunes"
          editable={!isSubmitting}
          accessibilityLabel="Pendientes para el próximo turno"
        />

        {message ? (
          <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}

        {submitError ? (
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {submitError}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            !canSubmit && styles.buttonDisabled,
            pressed && canSubmit && styles.buttonPressed,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Guardar traspaso de turno"
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Guardar traspaso</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.back()}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Cancelar"
        >
          <Text style={styles.secondaryButtonText}>Cancelar</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface HandoverFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable: boolean;
  accessibilityLabel: string;
}

function HandoverField({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
  accessibilityLabel,
}: HandoverFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        editable={editable}
        multiline
        maxLength={MAX_SHIFT_HANDOVER_FIELD_LENGTH}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    padding: 24,
    gap: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    marginBottom: 4,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    marginBottom: 4,
  },
  helperIntro: {
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    marginBottom: 16,
  },
  field: {
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    fontFamily: fontFamily.regular,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    marginBottom: 8,
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: colors.brandMid,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
  },
});
