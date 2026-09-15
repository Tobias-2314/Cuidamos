jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { getCurrentUserCareProfile, updateCareProfile } from '../careProfileService';

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

    test('returns the email with role: null when the user has no family yet', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'cuidador@example.com' } },
        error: null,
      });
      mockedFrom.mockImplementation(() => makeQueryBuilder({ data: null, error: null }));

      // Act
      const result = await getCurrentUserCareProfile();

      // Assert
      expect(result).toEqual({ data: { email: 'cuidador@example.com', role: null }, error: null });
    });

    test('returns the email with the role from family_members when the user has a family', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'cuidador@example.com' } },
        error: null,
      });
      // Orden real de llamadas dentro de getCurrentUserCareProfile: primero
      // getCurrentUserFamilyId (select family_id), después
      // getCurrentUserRoleInFamily (select role).
      let callCount = 0;
      mockedFrom.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return makeQueryBuilder({ data: { family_id: 'family-1' }, error: null });
        }
        return makeQueryBuilder({ data: { role: 'admin' }, error: null });
      });

      // Act
      const result = await getCurrentUserCareProfile();

      // Assert
      expect(result).toEqual({
        data: { email: 'cuidador@example.com', role: 'admin' },
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

    // NO existe todavía ninguna tabla/columna donde persistir nombre/relación (ver el
    // comentario de `updateCareProfile` y las NOTES del agente) -- por diseño, esta
    // función nunca intenta un `.update()`/`.upsert()` contra algo inventado, siempre
    // devuelve `not_implemented` para input válido.
    test('returns not_implemented for valid input without attempting to persist anything', async () => {
      // Act
      const result = await updateCareProfile({ name: 'María López', relation: 'Hija' });

      // Assert
      expect(result).toEqual({
        data: null,
        error: { code: 'not_implemented', message: expect.any(String) },
      });
      expect(mockedGetUser).not.toHaveBeenCalled();
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });
});
