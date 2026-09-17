import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
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
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { Card } from '../../components/Card';
import { AppHeader } from '../../components/AppHeader';

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
        <Button label="Reintentar" onPress={loadShift} />
      </View>
    );
  }

  const message = validationMessage();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader title="Traspaso de turno" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {shift ? (
          <Card style={styles.shiftCard}>
            <Text style={styles.shiftCardLabel}>Turno que cerrás</Text>
            <Text style={styles.shiftCardTime}>{formatShiftTimeRange(shift)}</Text>
          </Card>
        ) : null}
        <Text style={styles.helperIntro}>
          Dejá una nota rápida para quien siga el cuidado. Todos los campos son opcionales, pero
          completá al menos uno.
        </Text>

        <View style={styles.field}>
          <TextField
            label="Resumen del turno"
            value={resumen}
            onChangeText={setResumen}
            placeholder="Ej. tranquilo, sin incidentes"
            editable={!isSubmitting}
            accessibilityLabel="Resumen del turno"
            multiline
            maxLength={MAX_SHIFT_HANDOVER_FIELD_LENGTH}
            style={styles.inputMultiline}
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Comida"
            value={comida}
            onChangeText={setComida}
            placeholder="Ej. almorzó bien, cenó poco"
            editable={!isSubmitting}
            accessibilityLabel="Qué comió la persona cuidada"
            multiline
            maxLength={MAX_SHIFT_HANDOVER_FIELD_LENGTH}
            style={styles.inputMultiline}
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Ánimo"
            value={animo}
            onChangeText={setAnimo}
            placeholder="Ej. de buen humor, algo cansada"
            editable={!isSubmitting}
            accessibilityLabel="Ánimo o estado de la persona cuidada"
            multiline
            maxLength={MAX_SHIFT_HANDOVER_FIELD_LENGTH}
            style={styles.inputMultiline}
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Pendientes para el próximo turno"
            value={pendientes}
            onChangeText={setPendientes}
            placeholder="Ej. renovar receta, llamar al médico el lunes"
            editable={!isSubmitting}
            accessibilityLabel="Pendientes para el próximo turno"
            multiline
            maxLength={MAX_SHIFT_HANDOVER_FIELD_LENGTH}
            style={styles.inputMultiline}
          />
        </View>

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

        <Button
          label="Guardar traspaso"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isSubmitting}
          accessibilityLabel="Guardar traspaso de turno"
          size="lg"
          full
        />

        <Button
          label="Cancelar"
          onPress={() => router.back()}
          disabled={isSubmitting}
          variant="ghost"
          full
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    padding: 20,
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
  shiftCard: {
    padding: 16,
    marginBottom: 16,
  },
  shiftCardLabel: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    marginBottom: 2,
  },
  shiftCardTime: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.ink,
  },
  helperIntro: {
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamily.regular,
    marginBottom: 16,
  },
  field: {
    marginBottom: 14,
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
});
