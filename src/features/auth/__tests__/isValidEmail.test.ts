import { isValidEmail } from '../isValidEmail';

describe('isValidEmail', () => {
  test('returns true for a well-formed email', () => {
    // Arrange
    const email = 'user@example.com';

    // Act
    const result = isValidEmail(email);

    // Assert
    expect(result).toBe(true);
  });

  test('returns false for an empty string', () => {
    // Arrange
    const email = '';

    // Act
    const result = isValidEmail(email);

    // Assert
    expect(result).toBe(false);
  });

  test('returns false for a string with no @', () => {
    // Arrange
    const email = 'not-an-email';

    // Act
    const result = isValidEmail(email);

    // Assert
    expect(result).toBe(false);
  });

  test('returns true after trimming surrounding whitespace', () => {
    // Arrange
    const email = '  user@example.com  ';

    // Act
    const result = isValidEmail(email);

    // Assert
    expect(result).toBe(true);
  });

  test('returns false for whitespace-only input', () => {
    // Arrange
    const email = '   ';

    // Act
    const result = isValidEmail(email);

    // Assert
    expect(result).toBe(false);
  });
});
