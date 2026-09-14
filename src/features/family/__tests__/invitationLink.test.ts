import { buildInvitationLink, buildInvitationShareMessage } from '../invitationLink';

describe('invitationLink', () => {
  describe('buildInvitationLink', () => {
    test('builds a cuidamos:// deep link with the token in the path', () => {
      // Arrange
      const token = '11111111-1111-1111-1111-111111111111';

      // Act
      const link = buildInvitationLink(token);

      // Assert
      expect(link).toBe('cuidamos://join/11111111-1111-1111-1111-111111111111');
    });
  });

  describe('buildInvitationShareMessage', () => {
    test('includes the deep link built from the same token', () => {
      // Arrange
      const token = '22222222-2222-2222-2222-222222222222';

      // Act
      const message = buildInvitationShareMessage(token);

      // Assert
      expect(message).toContain(buildInvitationLink(token));
    });
  });
});
