jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  acceptFamilyInvitation,
  createFamily,
  createFamilyInvitation,
  getCurrentUserRoleInFamily,
} from '../familyService';

const mockedGetUser = supabase.auth.getUser as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

/**
 * Mock mínimo de un query builder de supabase-js encadenable, mismo criterio
 * que `shiftsService.test.ts`/`medicationsService.test.ts`: cada método
 * chainable (`insert`, `select`, `eq`) devuelve el mismo builder, y además es
 * "thenable" (`.then`) para cubrir el caso de `familyService.createFamily`
 * que hace `await supabase.from(...).insert(...)` SIN un terminal explícito
 * (`.select()`/`.single()`) -- el builder real de supabase-js es awaitable
 * directamente.
 */
function makeQueryBuilder(finalResult: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {
    insert: jest.fn(() => builder),
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(finalResult)),
    maybeSingle: jest.fn(() => Promise.resolve(finalResult)),
  };
  // `.then` no puede tiparse como jest.Mock sin romper la forma de un thenable real.
  (builder as unknown as { then: PromiseLike<typeof finalResult>['then'] }).then = (resolve) =>
    Promise.resolve(finalResult).then(resolve as never);
  return builder;
}

describe('familyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createFamily', () => {
    test('rejects an empty name before calling Supabase', async () => {
      // Act
      const result = await createFamily('   ');

      // Assert
      expect(result).toEqual({
        data: null,
        error: { code: 'invalid_name', message: expect.any(String) },
      });
      expect(mockedGetUser).not.toHaveBeenCalled();
    });

    test('creates the family and self-inserts the creator as admin', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const familiesBuilder = makeQueryBuilder({
        data: { id: 'family-1', name: 'Familia García' },
        error: null,
      });
      const membersBuilder = makeQueryBuilder({ data: null, error: null });
      mockedFrom.mockImplementation((table: string) =>
        table === 'families' ? familiesBuilder : membersBuilder
      );

      // Act
      const result = await createFamily('Familia García');

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('families');
      expect(familiesBuilder.insert).toHaveBeenCalledWith({
        name: 'Familia García',
        created_by: 'user-1',
      });
      expect(mockedFrom).toHaveBeenCalledWith('family_members');
      expect(membersBuilder.insert).toHaveBeenCalledWith({
        family_id: 'family-1',
        user_id: 'user-1',
        role: 'admin',
      });
      expect(result).toEqual({ data: { id: 'family-1', name: 'Familia García' }, error: null });
    });

    test('normalizes an error instead of propagating it raw when the family_members insert fails', async () => {
      // Arrange -- families insert succeeds, family_members insert fails (known risk,
      // see NOTES/comment on createFamily about the non-atomic two-insert flow).
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const familiesBuilder = makeQueryBuilder({
        data: { id: 'family-1', name: 'Familia García' },
        error: null,
      });
      const membersBuilder = makeQueryBuilder({
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      });
      mockedFrom.mockImplementation((table: string) =>
        table === 'families' ? familiesBuilder : membersBuilder
      );

      // Act
      const result = await createFamily('Familia García');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('returns not_authenticated when there is no logged-in user', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Act
      const result = await createFamily('Familia García');

      // Assert
      expect(result).toEqual({
        data: null,
        error: { code: 'not_authenticated', message: expect.any(String) },
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentUserRoleInFamily', () => {
    test('returns the role from the caller\'s own family_members row', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockImplementation(() => makeQueryBuilder({ data: { role: 'admin' }, error: null }));

      // Act
      const result = await getCurrentUserRoleInFamily('family-1');

      // Assert
      expect(result).toEqual({ data: 'admin', error: null });
    });

    test('returns data: null (no error) when the user has no row for that family', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockImplementation(() => makeQueryBuilder({ data: null, error: null }));

      // Act
      const result = await getCurrentUserRoleInFamily('family-1');

      // Assert
      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('createFamilyInvitation', () => {
    test('calls the create_family_invitation RPC and maps the response', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: [{ token: 'token-1', expires_at: '2026-09-21T00:00:00.000Z' }],
        error: null,
      });

      // Act
      const result = await createFamilyInvitation('family-1', 'someone@example.com');

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('create_family_invitation', {
        p_family_id: 'family-1',
        p_invited_email: 'someone@example.com',
      });
      expect(result).toEqual({
        data: { token: 'token-1', expiresAt: '2026-09-21T00:00:00.000Z' },
        error: null,
      });
    });

    test('normalizes an RLS error instead of propagating it raw', async () => {
      // Arrange -- e.g. a non-admin caller, rejected by family_invitations_insert_admin.
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      });

      // Act
      const result = await createFamilyInvitation('family-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('acceptFamilyInvitation', () => {
    test('calls the accept_family_invitation RPC and maps the response', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: [{ family_id: 'family-1', role: 'cuidador' }],
        error: null,
      });

      // Act
      const result = await acceptFamilyInvitation('token-1');

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('accept_family_invitation', { p_token: 'token-1' });
      expect(result).toEqual({ data: { familyId: 'family-1', role: 'cuidador' }, error: null });
    });

    // A diferencia del resto del módulo, esta función propaga el mensaje de la RPC tal
    // cual -- son mensajes ya pensados para el usuario final (ver comentario en
    // `familyService.ts`), no un detalle interno a esconder.
    test('propagates the RPC error message as-is instead of a generic message', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'Esta invitación ya fue utilizada' },
      });

      // Act
      const result = await acceptFamilyInvitation('token-1');

      // Assert
      expect(result).toEqual({
        data: null,
        error: { code: 'P0001', message: 'Esta invitación ya fue utilizada' },
      });
    });
  });
});
