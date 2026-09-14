import { isValidBirthDateInput } from '../caredPersonFormatting';

describe('isValidBirthDateInput', () => {
  test('accepts an empty string (no date loaded)', () => {
    expect(isValidBirthDateInput('')).toBe(true);
  });

  test('accepts a well-formed past date', () => {
    expect(isValidBirthDateInput('1945-03-20')).toBe(true);
  });

  test('rejects a malformed string', () => {
    expect(isValidBirthDateInput('20/03/1945')).toBe(false);
  });

  test('rejects a calendar-invalid date', () => {
    expect(isValidBirthDateInput('2026-02-30')).toBe(false);
  });

  test('rejects a future date', () => {
    const futureYear = new Date().getUTCFullYear() + 5;
    expect(isValidBirthDateInput(`${futureYear}-01-01`)).toBe(false);
  });
});
