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

import {
  createMedication,
  getCaredPersonsForFamily,
  getMedicationsForFamily,
  updateMedication,
} from './medicationsService';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';

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
        <Pressable
          style={styles.retryButton}
          onPress={loadInitialData}
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
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
        <Pressable
          style={styles.retryButton}
          onPress={() => router.push('/family/create')}
          accessibilityRole="button"
          accessibilityLabel="Crear familia"
        >
          <Text style={styles.retryButtonText}>Crear familia</Text>
        </Pressable>
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
        <Pressable
          style={styles.retryButton}
          onPress={() => router.push('/cared-person/new')}
          accessibilityRole="button"
          accessibilityLabel="Cargar persona cuidada"
        >
          <Text style={styles.retryButtonText}>Cargar persona cuidada</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'not-found') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyTitle}>No encontramos ese medicamento.</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver a la lista"
        >
          <Text style={styles.retryButtonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {mode === 'create' ? 'Nuevo medicamento' : 'Editar medicamento'}
        </Text>
        <Text style={styles.disclaimer}>
          Esto no reemplaza el criterio médico. Ante dudas, consultá con el profesional de
          salud a cargo.
        </Text>

        <FormField
          label="Nombre"
          value={name}
          onChangeText={setName}
          placeholder="Ej. Enalapril"
          editable={!isSubmitting}
          accessibilityLabel="Nombre del medicamento"
        />

        <FormField
          label="Dosis"
          value={dose}
          onChangeText={setDose}
          placeholder="Ej. 10mg"
          editable={!isSubmitting}
          accessibilityLabel="Dosis del medicamento"
        />

        <FormField
          label="Horario (opcional)"
          value={schedule}
          onChangeText={setSchedule}
          placeholder="Ej. cada 8 horas, 08:00 y 20:00"
          editable={!isSubmitting}
          accessibilityLabel="Horario del medicamento"
        />

        <FormField
          label="Instrucciones (opcional)"
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Ej. tomar con el estómago lleno"
          editable={!isSubmitting}
          accessibilityLabel="Instrucciones del medicamento"
          multiline
        />

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
          accessibilityLabel={mode === 'create' ? 'Guardar medicamento' : 'Guardar cambios'}
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'create' ? 'Guardar medicamento' : 'Guardar cambios'}
            </Text>
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

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable: boolean;
  accessibilityLabel: string;
  multiline?: boolean;
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  editable,
  accessibilityLabel,
  multiline,
}: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#999"
        editable={editable}
        multiline={multiline}
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
    backgroundColor: '#fff',
    padding: 24,
    gap: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  disclaimer: {
    fontSize: 12,
    color: '#777',
    fontStyle: 'italic',
    marginBottom: 16,
  },
  field: {
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#b3261e',
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#a8c3b6',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#2f6f4f',
    fontSize: 15,
    fontWeight: '600',
  },
});
