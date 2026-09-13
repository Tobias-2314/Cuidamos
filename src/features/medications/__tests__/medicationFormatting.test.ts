import {
  formatMedicationSubtitle,
  formatTakenAtTime,
  isValidMedicationNote,
  MAX_MEDICATION_NOTE_LENGTH,
} from '../medicationFormatting';

describe('isValidMedicationNote', () => {
  test('returns true for an empty note', () => {
    // Arrange
    const note = '';

    // Act
    const result = isValidMedicationNote(note);

    // Assert
    expect(result).toBe(true);
  });

  test('returns true for a note exactly at the max length', () => {
    // Arrange
    const note = 'a'.repeat(MAX_MEDICATION_NOTE_LENGTH);

    // Act
    const result = isValidMedicationNote(note);

    // Assert
    expect(result).toBe(true);
  });

  test('returns false for a note longer than the max length', () => {
    // Arrange
    const note = 'a'.repeat(MAX_MEDICATION_NOTE_LENGTH + 1);

    // Act
    const result = isValidMedicationNote(note);

    // Assert
    expect(result).toBe(false);
  });
});

describe('formatTakenAtTime', () => {
  test('formats an ISO timestamp as HH:MM', () => {
    // Arrange
    const takenAtIso = '2026-09-13T08:05:00.000Z';

    // Act
    const result = formatTakenAtTime(takenAtIso);

    // Assert
    expect(result).toBe(
      `${new Date(takenAtIso).getHours().toString().padStart(2, '0')}:${new Date(takenAtIso)
        .getMinutes()
        .toString()
        .padStart(2, '0')}`
    );
  });
});

describe('formatMedicationSubtitle', () => {
  test('joins dose and schedule when schedule is present', () => {
    // Arrange
    const medication = { dose: '500mg', schedule: 'cada 8 horas' };

    // Act
    const result = formatMedicationSubtitle(medication);

    // Assert
    expect(result).toBe('500mg · cada 8 horas');
  });

  test('falls back to just the dose when there is no schedule', () => {
    // Arrange
    const medication = { dose: '500mg', schedule: null };

    // Act
    const result = formatMedicationSubtitle(medication);

    // Assert
    expect(result).toBe('500mg');
  });
});
