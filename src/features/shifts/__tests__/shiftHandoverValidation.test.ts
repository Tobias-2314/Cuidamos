import {
  hasAnyShiftHandoverContent,
  isValidShiftHandoverField,
  MAX_SHIFT_HANDOVER_FIELD_LENGTH,
  shiftHandoverFieldsSchema,
} from '../shiftHandoverValidation';

describe('isValidShiftHandoverField', () => {
  test('returns true for an empty field', () => {
    // Arrange
    const field = '';

    // Act
    const result = isValidShiftHandoverField(field);

    // Assert
    expect(result).toBe(true);
  });

  test('returns true for a field exactly at the max length', () => {
    // Arrange
    const field = 'a'.repeat(MAX_SHIFT_HANDOVER_FIELD_LENGTH);

    // Act
    const result = isValidShiftHandoverField(field);

    // Assert
    expect(result).toBe(true);
  });

  test('returns false for a field longer than the max length', () => {
    // Arrange
    const field = 'a'.repeat(MAX_SHIFT_HANDOVER_FIELD_LENGTH + 1);

    // Act
    const result = isValidShiftHandoverField(field);

    // Assert
    expect(result).toBe(false);
  });
});

describe('hasAnyShiftHandoverContent', () => {
  test('returns false when all 4 fields are empty', () => {
    // Arrange
    const fields = { resumen: '', comida: '', animo: '', pendientes: '' };

    // Act
    const result = hasAnyShiftHandoverContent(fields);

    // Assert
    expect(result).toBe(false);
  });

  test('returns true when only one field has content', () => {
    // Arrange
    const fields = { resumen: '', comida: '', animo: 'tranquilo', pendientes: '' };

    // Act
    const result = hasAnyShiftHandoverContent(fields);

    // Assert
    expect(result).toBe(true);
  });

  test('returns true when all 4 fields have content', () => {
    // Arrange
    const fields = {
      resumen: 'sin incidentes',
      comida: 'almorzó bien',
      animo: 'de buen humor',
      pendientes: 'renovar receta',
    };

    // Act
    const result = hasAnyShiftHandoverContent(fields);

    // Assert
    expect(result).toBe(true);
  });
});

describe('shiftHandoverFieldsSchema', () => {
  test('accepts 4 fields at or under the max length', () => {
    // Arrange
    const fields = {
      resumen: 'sin incidentes',
      comida: '',
      animo: '',
      pendientes: 'a'.repeat(MAX_SHIFT_HANDOVER_FIELD_LENGTH),
    };

    // Act
    const result = shiftHandoverFieldsSchema.safeParse(fields);

    // Assert
    expect(result.success).toBe(true);
  });

  test('rejects a field over the max length', () => {
    // Arrange
    const fields = {
      resumen: 'a'.repeat(MAX_SHIFT_HANDOVER_FIELD_LENGTH + 1),
      comida: '',
      animo: '',
      pendientes: '',
    };

    // Act
    const result = shiftHandoverFieldsSchema.safeParse(fields);

    // Assert
    expect(result.success).toBe(false);
  });
});
