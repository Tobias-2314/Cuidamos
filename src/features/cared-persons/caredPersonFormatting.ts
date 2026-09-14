/**
 * Formato esperado del campo "fecha de nacimiento" del formulario de alta:
 * `AAAA-MM-DD` (ISO 8601, sin hora). No hay date picker nativo en las
 * dependencias del proyecto todavía -- se pide como texto libre validado,
 * mismo criterio pragmático que el resto de los campos "texto libre" de este
 * repo (ej. `schedule` en medicamentos).
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida una fecha de nacimiento ya recortada (`trim()`). Un string vacío es
 * válido (equivale a "sin fecha cargada", el campo es opcional) -- quien
 * quiera validar "hay contenido" debe chequear el largo por separado.
 *
 * Rechaza fechas con formato correcto pero futuras (una persona cuidada no
 * puede haber nacido en el futuro) o inválidas en el calendario (ej.
 * "2026-02-30"), además del chequeo de formato.
 *
 * Lógica pura y testeable, sin dependencias de red ni de React Native --
 * mismo criterio que `medicationFormatting.ts` (PGM-31/32).
 */
export function isValidBirthDateInput(trimmedBirthDate: string): boolean {
  if (trimmedBirthDate.length === 0) {
    return true;
  }

  if (!ISO_DATE_PATTERN.test(trimmedBirthDate)) {
    return false;
  }

  const parsed = new Date(`${trimmedBirthDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  // `Date` normaliza días fuera de rango (ej. 30 de febrero pasa a marzo) en
  // vez de fallar -- comparamos contra el string original para detectar eso.
  const normalizedBack = parsed.toISOString().slice(0, 10);
  if (normalizedBack !== trimmedBirthDate) {
    return false;
  }

  return parsed.getTime() <= Date.now();
}
