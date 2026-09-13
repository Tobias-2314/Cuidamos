import { getAssignedToLabel } from '../assignedToLabel';

describe('getAssignedToLabel', () => {
  test('returns "Vos" when the shift is assigned to the current user', () => {
    // Arrange
    const userId = '11111111-1111-1111-1111-111111111111';

    // Act
    const label = getAssignedToLabel(userId, userId);

    // Assert
    expect(label).toBe('Vos');
  });

  test('returns a short, non-identifying label for another caregiver', () => {
    // Arrange
    const assignedTo = '22222222-2222-2222-2222-222222222222';
    const currentUserId = '11111111-1111-1111-1111-111111111111';

    // Act
    const label = getAssignedToLabel(assignedTo, currentUserId);

    // Assert
    expect(label).toContain('2222');
    expect(label).not.toBe('Vos');
  });

  test('falls back to the short-id label when there is no known current user', () => {
    // Arrange
    const assignedTo = '33333333-3333-3333-3333-333333333333';

    // Act
    const label = getAssignedToLabel(assignedTo, null);

    // Assert
    expect(label).not.toBe('Vos');
    expect(label).toContain('3333');
  });
});
