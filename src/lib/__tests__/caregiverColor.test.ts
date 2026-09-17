import { getCaregiverColor } from '../caregiverColor';
import { caregiverPalette, colors } from '../../theme/tokens';

describe('getCaregiverColor', () => {
  test('returns the brand color for the current user', () => {
    // Arrange & Act
    const color = getCaregiverColor('user-1', true);

    // Assert
    expect(color).toBe(colors.brand);
  });

  test('returns a stable palette color for the same non-current-user id', () => {
    // Arrange & Act
    const first = getCaregiverColor('user-abc-123', false);
    const second = getCaregiverColor('user-abc-123', false);

    // Assert
    expect(first).toBe(second);
    expect(caregiverPalette as readonly string[]).toContain(first);
  });

  test('is likely to assign different colors to different user ids', () => {
    // Arrange & Act
    const colorsForUsers = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'].map((id) =>
      getCaregiverColor(id, false)
    );

    // Assert -- not all 5 collapse into the same single color
    expect(new Set(colorsForUsers).size).toBeGreaterThan(1);
  });
});
