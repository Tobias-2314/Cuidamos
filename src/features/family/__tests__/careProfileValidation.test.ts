import {
  careProfileFieldsSchema,
  isValidCareProfileField,
  MAX_CARE_PROFILE_FIELD_LENGTH,
} from '../careProfileValidation';

describe('isValidCareProfileField', () => {
  test('returns false for an empty field', () => {
    // Arrange
    const field = '';

    // Act
    const result = isValidCareProfileField(field);

    // Assert
    expect(result).toBe(false);
  });

  test('returns true for a field exactly at the max length', () => {
    // Arrange
    const field = 'a'.repeat(MAX_CARE_PROFILE_FIELD_LENGTH);

    // Act
    const result = isValidCareProfileField(field);

    // Assert
    expect(result).toBe(true);
  });

  test('returns false for a field longer than the max length', () => {
    // Arrange
    const field = 'a'.repeat(MAX_CARE_PROFILE_FIELD_LENGTH + 1);

    // Act
    const result = isValidCareProfileField(field);

    // Assert
    expect(result).toBe(false);
  });
});

describe('careProfileFieldsSchema', () => {
  test('accepts non-empty name and relation at or under the max length', () => {
    // Arrange
    const fields = { name: 'María López', relation: 'Hija' };

    // Act
    const result = careProfileFieldsSchema.safeParse(fields);

    // Assert
    expect(result.success).toBe(true);
  });

  test('rejects an empty name', () => {
    // Arrange
    const fields = { name: '   ', relation: 'Hija' };

    // Act
    const result = careProfileFieldsSchema.safeParse(fields);

    // Assert
    expect(result.success).toBe(false);
  });

  test('rejects a relation over the max length', () => {
    // Arrange
    const fields = { name: 'María López', relation: 'a'.repeat(MAX_CARE_PROFILE_FIELD_LENGTH + 1) };

    // Act
    const result = careProfileFieldsSchema.safeParse(fields);

    // Assert
    expect(result.success).toBe(false);
  });
});
