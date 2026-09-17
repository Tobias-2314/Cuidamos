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

import {
  createMedication,
  getCaredPersonsForFamily,
  getMedicationsForFamily,
  updateMedication,
} from './medicationsService';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';
import { colors, fontFamily } from '../../theme/tokens';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { AppHeader } from '../../components/AppHeader';

export type MedicationFormMode = 'create' | 'edit';

interface MedicationFormScreenProps {
  mode: MedicationFormMode;
  /** Requerido cuando `mode === 'edit'`. Ignorado en modo 'create'. */
  medicationId?: string;
}

/**
 * `phase` sigue el mismo criterio de estados explícitos que `MedicationsScreen`/
 * `CalendarScreen` (PGM-26/PGM-31), con dos estados extra propios de este formulario:
 * - 'loading': resolviendo familia (+ cared_person en 'create', + el medicamento a editar
 *   en 'edit').
 * - 'no-family': mismo gap de producto que el resto de las pantallas (no hay UI de
 *   creación/selección de familia todavía).
 * - 'no-cared-person': solo en modo 'create' -- la familia existe pero todavía no tiene
 *   ninguna `cared_person` cargada, así que no hay a quién asignarle el medicamento. Desde
 *   PGM-22 (`CaredPersonFormScreen`, ruta `/cared-person/new`) ya existe una pantalla de alta
 *   a la que este estado redirige -- antes de esa issue no había ninguna UI para esto.
 * - 'not-found': solo en modo 'edit' -- el `medicationId` de la ruta no corresponde a
 *   ningún medicamento de la familia del usuario (borrado, o de otra familia).
 * - 'error': falló la carga de familia/cared_persons/medicamento.
 * - 'ready': el formulario está visible y se puede enviar.
 */
type Phase = 'loading' | 'no-family' | 'no-cared-person' | 'not-found' | 'error' | 'ready';

export function MedicationFormScreen({ mode, medicationId }: MedicationFormScreenProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [caredPersonId, setCaredPersonId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [schedule, setSchedule] = useState('');
  const [instructions, setInstructions] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadForCreate = useCallback(async (familyId: string) => {
    const caredPersonsResult = await getCaredPersonsForFamily(familyId);
    if (caredPersonsResult.error) {
      setLoadErrorMessage(caredPersonsResult.error.message);
      setPhase('error');
      return;
    }

    // v1 asume una sola persona cuidada por familia -- mismo criterio que
    // `medicationsService.ts` (ver comentario de `getCaredPersonsForFamily`).
    const firstCaredPerson = caredPersonsResult.data[0] ?? null;
    if (!firstCaredPerson) {
      setPhase('no-cared-person');
      return;
    }

    setCaredPersonId(firstCaredPerson.id);
    setPhase('ready');
  }, []);

  const loadForEdit = useCallback(
    async (familyId: string) => {
      if (!medicationId) {
        setPhase('not-found');
        return;
      }

      // No existe un `getMedicationById` separado -- editar busca el medicamento dentro de
      // la lista de la familia por id (ver comentario en `medicationsService.ts`).
      const medicationsResult = await getMedicationsForFamily(familyId);
      if (medicationsResult.error) {
        setLoadErrorMessage(medicationsResult.error.message);
        setPhase('error');
        return;
      }

      const medication = medicationsResult.data.find((item) => item.id === medicationId);
      if (!medication) {
        setPhase('not-found');
        return;
      }

      setCaredPersonId(medication.caredPersonId);
      setName(medication.name);
      setDose(medication.dose);
      setSchedule(medication.schedule ?? '');
      setInstructions(medication.instructions ?? '');
      setPhase('ready');
    },
    [medicationId]
  );

  const loadInitialData = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);

    const familyResult = await getCurrentUserFamilyId();
    if (familyResult.error) {
      setLoadErrorMessage(familyResult.error.message);
      setPhase('error');
      return;
    }

    if (!familyResult.data) {
      setPhase('no-family');
      return;
    }

    if (mode === 'create') {
      await loadForCreate(familyResult.data);
    } else {
      await loadForEdit(familyResult.data);
    }
  }, [mode, loadForCreate, loadForEdit]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const canSubmit = !isSubmitting && name.trim().length > 0 && dose.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const trimmedInstructions = instructions.trim();
    const trimmedSchedule = schedule.trim();

    const result =
      mode === 'create'
        ? await createMedication({
            // `caredPersonId` está garantizado en 'ready' para modo 'create' (ver
            // `loadForCreate` -- la fase solo llega a 'ready' después de resolverlo).
            caredPersonId: caredPersonId as string,
            name,
            dose,
            instructions: trimmedInstructions.length > 0 ? trimmedInstructions : null,
            schedule: trimmedSchedule.length > 0 ? trimmedSchedule : null,
          })
        : await updateMedication(medicationId as string, {
            name,
            dose,
            instructions: trimmedInstructions.length > 0 ? trimmedInstructions : null,
            schedule: trimmedSchedule.length > 0 ? trimmedSchedule : null,
          });

    setIsSubmitting(false);

    if (result.error) {
      setSubmitError(result.error.message);
      return;
    }

    // Vuelve a la lista -- `MedicationsScreen` recarga sola al volver a tener foco (ver
    // `useFocusEffect` en ese componente), así que no hace falta pasarle ningún dato acá.
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
        <Button label="Reintentar" onPress={loadInitialData} />
      </View>
    );
  }

  if (phase === 'no-family') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no formás parte de ninguna familia.</Text>
        <Text style={styles.helperText}>
          Creá una familia para empezar a cargar medicamentos, o pedile a quien te invitó el
          link de invitación.
        </Text>
        <Button label="Crear familia" onPress={() => router.push('/family/create')} />
      </View>
    );
  }

  if (phase === 'no-cared-person') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>Todavía no hay ninguna persona cuidada cargada.</Text>
        <Text style={styles.helperText}>
          Un medicamento siempre pertenece a una persona cuidada. Cargá su perfil primero.
        </Text>
        <Button
          label="Cargar persona cuidada"
          onPress={() => router.push('/cared-person/new')}
        />
      </View>
    );
  }

  if (phase === 'not-found') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>No encontramos ese medicamento.</Text>
        <Button label="Volver" onPress={() => router.back()} accessibilityLabel="Volver a la lista" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        title={mode === 'create' ? 'Agregar medicamento' : 'Editar medicamento'}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.disclaimer}>
          Esto no reemplaza el criterio médico. Ante dudas, consultá con el profesional de
          salud a cargo.
        </Text>

        <View style={styles.field}>
          <TextField
            label="Nombre"
            value={name}
            onChangeText={setName}
            placeholder="Ej. Enalapril"
            editable={!isSubmitting}
            accessibilityLabel="Nombre del medicamento"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Dosis"
            value={dose}
            onChangeText={setDose}
            placeholder="Ej. 10mg"
            editable={!isSubmitting}
            accessibilityLabel="Dosis del medicamento"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Horario (opcional)"
            value={schedule}
            onChangeText={setSchedule}
            placeholder="Ej. cada 8 horas, 08:00 y 20:00"
            editable={!isSubmitting}
            accessibilityLabel="Horario del medicamento"
          />
        </View>

        <View style={styles.field}>
          <TextField
            label="Instrucciones (opcional)"
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Ej. tomar con el estómago lleno"
            editable={!isSubmitting}
            accessibilityLabel="Instrucciones del medicamento"
            multiline
            style={styles.inputMultiline}
          />
        </View>

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
          label={mode === 'create' ? 'Guardar medicamento' : 'Guardar cambios'}
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isSubmitting}
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
  disclaimer: {
    fontSize: 12,
    color: colors.ink3,
    fontFamily: fontFamily.regular,
    fontStyle: 'italic',
    marginTop: 12,
    marginBottom: 16,
  },
  field: {
    marginBottom: 14,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.ink3,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.ink,
    textAlign: 'center',
  },
});
