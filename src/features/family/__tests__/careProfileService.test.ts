import { supabase } from '../../../lib/supabase';
import { getCurrentUserCareProfile, updateCareProfile } from '../careProfileService';

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const mockedGetUser = supabase.auth.getUser as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;

/**
 * Mock mínimo de un query builder de supabase-js encadenable -- mismo
 * criterio que `familyService.test.ts`/`shiftsService.test.ts`.
 */
function makeQueryBuilder(finalResult: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(finalResult)),
    upsert: jest.fn(() => Promise.resolve(finalResult)),
  };
  return builder;
}

describe('careProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentUserCareProfile', () => {
    test('returns not_authenticated when there is no logged-in user', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Act
      const result = await getCurrentUserCareProfile();

      // Assert
      expect(result).toEqual({
        data: null,
        error: { code: 'not_authenticated', message: expect.any(String) },
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    test('returns email/role: null/name: null when the user has no profile row or family yet', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'cuidador@example.com' } },
        error: null,
      });
      // Orden real de llamadas: 1) .from('profiles'), 2) getCurrentUserFamilyId
      // (.from('family_members') via familyResult). Sin familia -> no hay un
      // tercer llamado a getCurrentUserRoleInFamily.
      mockedFrom.mockImplementation(() => makeQueryBuilder({ data: null, error: null }));

      // Act
      const result = await getCurrentUserCareProfile();

      // Assert
      expect(result).toEqual({
        data: { email: 'cuidador@example.com', role: null, name: null, relationToCaredPerson: null },
        error: null,
      });
    });

    test('returns email/role/name/relation when the user has a profile row and a family', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'cuidador@example.com' } },
        error: null,
      });
      // Orden real de llamadas dentro de getCurrentUserCareProfile: 1) .from('profiles')
      // (display_name/relation_to_cared_person), 2) getCurrentUserFamilyId (family_id),
      // 3) getCurrentUserRoleInFamily (role).
      let callCount = 0;
      mockedFrom.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return makeQueryBuilder({
            data: { display_name: 'María López', relation_to_cared_person: 'Hija' },
            error: null,
          });
        }
        if (callCount === 2) {
          return makeQueryBuilder({ data: { family_id: 'family-1' }, error: null });
        }
        return makeQueryBuilder({ data: { role: 'admin' }, error: null });
      });

      // Act
      const result = await getCurrentUserCareProfile();

      // Assert
      expect(result).toEqual({
        data: {
          email: 'cuidador@example.com',
          role: 'admin',
          name: 'María López',
          relationToCaredPerson: 'Hija',
        },
        error: null,
      });
    });
  });

  describe('updateCareProfile', () => {
    test('rejects an empty name without attempting to persist anything', async () => {
      // Act
      const result = await updateCareProfile({ name: '   ', relation: 'Hija' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_input');
      expect(mockedGetUser).not.toHaveBeenCalled();
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    test('rejects a relation over the max length without attempting to persist anything', async () => {
      // Act
      const result = await updateCareProfile({ name: 'María López', relation: 'a'.repeat(200) });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_input');
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    test('upserts into profiles and returns the persisted profile for valid input', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'cuidador@example.com' } },
        error: null,
      });
      // Orden real de llamadas dentro de updateCareProfile: 1) getCurrentUserFamilyId
      // (family_id), 2) .from('profiles').upsert(...), 3) getCurrentUserRoleInFamily
      // (role) -- solo si hay familia.
      let callCount = 0;
      mockedFrom.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return makeQueryBuilder({ data: { family_id: 'family-1' }, error: null });
        }
        if (callCount === 2) {
          return makeQueryBuilder({ data: null, error: null });
        }
        return makeQueryBuilder({ data: { role: 'admin' }, error: null });
      });

      // Act
      const result = await updateCareProfile({ name: 'María López', relation: 'Hija' });

      // Assert
      expect(result).toEqual({
        data: {
          email: 'cuidador@example.com',
          role: 'admin',
          name: 'María López',
          relationToCaredPerson: 'Hija',
        },
        error: null,
      });
    });

    test('returns not_authenticated for valid input when there is no logged-in user', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Act
      const result = await updateCareProfile({ name: 'María López', relation: 'Hija' });

      // Assert
      expect(result).toEqual({
        data: null,
        error: { code: 'not_authenticated', message: expect.any(String) },
      });
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });
});
