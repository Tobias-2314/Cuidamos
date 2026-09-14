import { getCaredPersonsForFamily } from '../medications/medicationsService';
import { getCurrentUserFamilyId } from '../shifts/shiftsService';

/**
 * Resuelve "¿a qué `cared_person` le corresponde esto?" para pantallas que
 * cuelgan de la ficha (PGM-23): médicos/contactos de emergencia, y la ficha
 * misma. Mismo criterio v1 (una sola familia, una sola cared_person) ya
 * usado -- de forma duplicada -- en `CaredPersonFormScreen`/
 * `MedicationFormScreen`. Se extrae acá como helper NUEVO porque esta issue
 * agrega un tercer y cuarto call-site (`MedicalContactFormScreen`,
 * `EmergencyContactFormScreen`, además de la ficha) -- no se retrofiteó en
 * los dos screens existentes para no tocar código ya testeado fuera del
 * alcance de esta issue (ver NOTES del agente).
 */
export type CaredPersonContextResult =
  | { status: 'no-family' }
  | { status: 'no-cared-person' }
  | { status: 'error'; message: string }
  | { status: 'ready'; caredPersonId: string; caredPersonFullName: string };

export async function resolveCaredPersonContext(): Promise<CaredPersonContextResult> {
  const familyResult = await getCurrentUserFamilyId();
  if (familyResult.error) {
    return { status: 'error', message: familyResult.error.message };
  }

  if (!familyResult.data) {
    return { status: 'no-family' };
  }

  // v1 asume una sola persona cuidada por familia -- mismo criterio que
  // `medicationsService.ts`/`MedicationFormScreen`.
  const caredPersonsResult = await getCaredPersonsForFamily(familyResult.data);
  if (caredPersonsResult.error) {
    return { status: 'error', message: caredPersonsResult.error.message };
  }

  const firstCaredPerson = caredPersonsResult.data[0] ?? null;
  if (!firstCaredPerson) {
    return { status: 'no-cared-person' };
  }

  return {
    status: 'ready',
    caredPersonId: firstCaredPerson.id,
    caredPersonFullName: firstCaredPerson.fullName,
  };
}
