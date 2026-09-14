import {
  formatMedicationSubtitle,
  formatTakenAtDateTime,
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

describe('formatTakenAtDateTime', () => {
  test('formats an ISO timestamp as DD/MM HH:MM', () => {
    // Arrange
    const takenAtIso = '2026-09-13T08:05:00.000Z';
    const date = new Date(takenAtIso);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    // Act
    const result = formatTakenAtDateTime(takenAtIso);

    // Assert
    expect(result).toBe(`${day}/${month} ${hours}:${minutes}`);
  });

  test('distinguishes two takings on different days at the same time', () => {
    // Arrange
    const firstDay = '2026-09-13T08:00:00.000Z';
    const secondDay = '2026-09-14T08:00:00.000Z';

    // Act
    const firstLabel = formatTakenAtDateTime(firstDay);
    const secondLabel = formatTakenAtDateTime(secondDay);

    // Assert
    expect(firstLabel).not.toBe(secondLabel);
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
