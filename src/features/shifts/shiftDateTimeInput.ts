/**
 * Parseo de fecha+hora en formato "DD/MM/AAAA HH:MM" para los campos de texto
 * de `ShiftFormScreen` (inicio/fin de turno).
 *
 * No hay ningún date/time picker nativo instalado en este proyecto todavía
 * (`package.json` no tiene `@react-native-community/datetimepicker` ni
 * equivalente) y agregar una dependencia nueva no está pedido por esta issue
 * -- se resuelve con un `TextInput` de texto simple + este parser, mismo
 * criterio KISS/YAGNI que el resto del repo. Lógica pura y testeable, sin
 * dependencias de React Native, mismo criterio que `calendarSections.ts`.
 */
const DATE_TIME_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/;

/**
 * Devuelve el `Date` (hora local) representado por `value`, o `null` si el
 * formato no matchea o la fecha/hora no es válida (ej. 31/02, 25:00) -- un
 * `Date` de JS "normaliza" fechas fuera de rango silenciosamente (31/02 se
 * convierte en 03/03), así que se valida que los campos construidos
 * coincidan exactamente con lo ingresado, en vez de confiar en eso.
 */
export function parseShiftDateTimeInput(value: string): Date | null {
  const match = DATE_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, ddStr, mmStr, yyyyStr, hhStr, minStr] = match;
  const day = Number(ddStr);
  const month = Number(mmStr);
  const year = Number(yyyyStr);
  const hour = Number(hhStr);
  const minute = Number(minStr);

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  const matchesInput =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;

  return matchesInput ? date : null;
}

export const SHIFT_DATE_TIME_FORMAT_HINT = 'DD/MM/AAAA HH:MM';
