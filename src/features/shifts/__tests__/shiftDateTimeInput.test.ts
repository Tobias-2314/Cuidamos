import { parseShiftDateTimeInput } from '../shiftDateTimeInput';

describe('parseShiftDateTimeInput', () => {
  test('parses a well-formed DD/MM/AAAA HH:MM value into a local Date', () => {
    // Arrange
    const value = '14/09/2026 08:30';

    // Act
    const result = parseShiftDateTimeInput(value);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(8); // 0-indexed: septiembre
    expect(result?.getDate()).toBe(14);
    expect(result?.getHours()).toBe(8);
    expect(result?.getMinutes()).toBe(30);
  });

  test('trims surrounding whitespace before parsing', () => {
    // Arrange
    const value = '  14/09/2026 08:30  ';

    // Act
    const result = parseShiftDateTimeInput(value);

    // Assert
    expect(result).not.toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(parseShiftDateTimeInput('')).toBeNull();
  });

  test('returns null when the format does not match', () => {
    expect(parseShiftDateTimeInput('2026-09-14 08:30')).toBeNull();
    expect(parseShiftDateTimeInput('14/09/2026')).toBeNull();
    expect(parseShiftDateTimeInput('not a date')).toBeNull();
  });

  test('returns null for a calendar date that does not exist (31/02)', () => {
    // JS's Date would otherwise silently roll this over into 03/03 -- this
    // guards against that silent normalization.
    expect(parseShiftDateTimeInput('31/02/2026 10:00')).toBeNull();
  });

  test('returns null for an out-of-range time (25:00)', () => {
    expect(parseShiftDateTimeInput('14/09/2026 25:00')).toBeNull();
  });
});
