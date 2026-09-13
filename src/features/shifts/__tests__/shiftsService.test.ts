jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { getCurrentUserFamilyId, getShiftsForFamily } from '../shiftsService';

const mockedGetUser = supabase.auth.getUser as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;

/**
 * Minimal stand-in for the Supabase query builder: every chainable method
 * (`select`, `eq`, `limit`, ...) returns the same builder, and the terminal
 * method of the chain used by `shiftsService` (`maybeSingle`, `order`, `in`)
 * resolves with `finalResult`.
 */
function makeQueryBuilder(finalResult: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(finalResult)),
    order: jest.fn(() => Promise.resolve(finalResult)),
    in: jest.fn(() => Promise.resolve(finalResult)),
  };
  return builder;
}

describe('shiftsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentUserFamilyId', () => {
    test('returns the family_id of the current user\'s first membership row', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockImplementation(() =>
        makeQueryBuilder({ data: { family_id: 'family-1' }, error: null })
      );

      // Act
      const result = await getCurrentUserFamilyId();

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('family_members');
      expect(result).toEqual({ data: 'family-1', error: null });
    });

    test('returns data: null (no error) when the user has no family yet', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockImplementation(() => makeQueryBuilder({ data: null, error: null }));

      // Act
      const result = await getCurrentUserFamilyId();

      // Assert
      expect(result).toEqual({ data: null, error: null });
    });

    test('returns a not_authenticated error when there is no logged-in user', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Act
      const result = await getCurrentUserFamilyId();

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('not_authenticated');
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockImplementation(() =>
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await getCurrentUserFamilyId();

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('getShiftsForFamily', () => {
    const range = { from: new Date('2026-09-14T00:00:00Z'), to: new Date('2026-09-21T00:00:00Z') };

    test('maps rows and resolves the cared person name', async () => {
      // Arrange
      const rawShiftRow = {
        id: 's1',
        family_id: 'family-1',
        cared_person_id: 'cp-1',
        assigned_to: 'user-2',
        starts_at: '2026-09-14T08:00:00.000Z',
        ends_at: '2026-09-14T12:00:00.000Z',
        status: 'scheduled',
        created_by: 'user-1',
        created_at: '2026-09-01T00:00:00.000Z',
      };
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'shifts') {
          return makeQueryBuilder({ data: [rawShiftRow], error: null });
        }
        if (table === 'cared_persons') {
          return makeQueryBuilder({ data: [{ id: 'cp-1', full_name: 'Abuela' }], error: null });
        }
        throw new Error(`unexpected table: ${table}`);
      });

      // Act
      const result = await getShiftsForFamily('family-1', range);

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          id: 's1',
          familyId: 'family-1',
          caredPersonId: 'cp-1',
          caredPersonName: 'Abuela',
          assignedTo: 'user-2',
          startsAt: '2026-09-14T08:00:00.000Z',
          endsAt: '2026-09-14T12:00:00.000Z',
          status: 'scheduled',
          createdBy: 'user-1',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ]);
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockImplementation(() =>
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await getShiftsForFamily('family-1', range);

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('drops a row that fails validation instead of throwing', async () => {
      // Arrange: missing required `status` field.
      const invalidRow = {
        id: 's1',
        family_id: 'family-1',
        cared_person_id: null,
        assigned_to: 'user-2',
        starts_at: '2026-09-14T08:00:00.000Z',
        ends_at: '2026-09-14T12:00:00.000Z',
        created_by: 'user-1',
        created_at: '2026-09-01T00:00:00.000Z',
      };
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'shifts') {
          return makeQueryBuilder({ data: [invalidRow], error: null });
        }
        return makeQueryBuilder({ data: [], error: null });
      });

      // Act
      const result = await getShiftsForFamily('family-1', range);

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });
  });
});
