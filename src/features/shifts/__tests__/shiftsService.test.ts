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
  createShift,
  getCurrentUserFamilyId,
  getShiftById,
  getShiftsForFamily,
  listFamilyMembersForFamily,
  reassignShift,
} from '../shiftsService';

const mockedGetUser = supabase.auth.getUser as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

/**
 * Minimal stand-in for the Supabase query builder: every chainable method
 * (`select`, `eq`, `limit`, ...) returns the same builder, and the terminal
 * method of the chain used by `shiftsService` (`maybeSingle`, `order`, `in`)
 * resolves with `finalResult`.
 */
function makeQueryBuilder(finalResult: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(finalResult)),
    single: jest.fn(() => Promise.resolve(finalResult)),
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

  describe('listFamilyMembersForFamily', () => {
    test('maps rows returned by the list_family_members RPC', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: [
          { user_id: 'user-1', role: 'admin' },
          { user_id: 'user-2', role: 'cuidador' },
        ],
        error: null,
      });

      // Act
      const result = await listFamilyMembersForFamily('family-1');

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('list_family_members', { p_family_id: 'family-1' });
      expect(result).toEqual({
        data: [
          { userId: 'user-1', role: 'admin' },
          { userId: 'user-2', role: 'cuidador' },
        ],
        error: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      });

      // Act
      const result = await listFamilyMembersForFamily('family-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('drops a row that fails validation instead of throwing', async () => {
      // Arrange: invalid role value.
      mockedRpc.mockResolvedValue({
        data: [{ user_id: 'user-1', role: 'owner' }],
        error: null,
      });

      // Act
      const result = await listFamilyMembersForFamily('family-1');

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });
  });

  describe('getShiftById', () => {
    const rawShiftRow = {
      id: 's1',
      family_id: 'family-1',
      cared_person_id: null,
      assigned_to: 'user-2',
      starts_at: '2026-09-14T08:00:00.000Z',
      ends_at: '2026-09-14T12:00:00.000Z',
      status: 'scheduled',
      created_by: 'user-1',
      created_at: '2026-09-01T00:00:00.000Z',
    };

    test('maps the row returned for a single shift', async () => {
      // Arrange
      mockedFrom.mockImplementation(() => makeQueryBuilder({ data: rawShiftRow, error: null }));

      // Act
      const result = await getShiftById('s1');

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('shifts');
      expect(result).toEqual({
        data: {
          id: 's1',
          familyId: 'family-1',
          caredPersonId: null,
          caredPersonName: null,
          assignedTo: 'user-2',
          startsAt: '2026-09-14T08:00:00.000Z',
          endsAt: '2026-09-14T12:00:00.000Z',
          status: 'scheduled',
          createdBy: 'user-1',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
        error: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockImplementation(() =>
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await getShiftById('missing-id');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('createShift', () => {
    const startsAt = new Date('2026-09-14T08:00:00.000Z');
    const endsAt = new Date('2026-09-14T12:00:00.000Z');

    test('rejects a time range where starts_at is not before ends_at, without calling Supabase', async () => {
      // Act
      const result = await createShift({
        familyId: 'family-1',
        assignedTo: 'user-1',
        startsAt: endsAt,
        endsAt: startsAt,
      });

      // Assert
      expect(mockedFrom).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_time_range');
    });

    test('resolves the current user for created_by and inserts the shift', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const rawShiftRow = {
        id: 's1',
        family_id: 'family-1',
        cared_person_id: null,
        assigned_to: 'user-2',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: 'scheduled',
        created_by: 'user-1',
        created_at: '2026-09-01T00:00:00.000Z',
      };
      let insertPayload: unknown;
      mockedFrom.mockImplementation(() => {
        const builder = makeQueryBuilder({ data: rawShiftRow, error: null });
        builder.insert = jest.fn((payload: unknown) => {
          insertPayload = payload;
          return builder;
        });
        return builder;
      });

      // Act
      const result = await createShift({
        familyId: 'family-1',
        assignedTo: 'user-2',
        startsAt,
        endsAt,
      });

      // Assert
      expect(insertPayload).toEqual({
        family_id: 'family-1',
        cared_person_id: null,
        assigned_to: 'user-2',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        created_by: 'user-1',
      });
      expect(result.error).toBeNull();
      expect(result.data?.assignedTo).toBe('user-2');
    });

    test('returns not_authenticated without inserting when there is no logged-in user', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Act
      const result = await createShift({
        familyId: 'family-1',
        assignedTo: 'user-1',
        startsAt,
        endsAt,
      });

      // Assert
      expect(mockedFrom).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('not_authenticated');
    });

    test('normalizes a Supabase insert error instead of propagating it raw', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockImplementation(() =>
        makeQueryBuilder({ data: null, error: { code: '23514', message: 'check_violation' } })
      );

      // Act
      const result = await createShift({
        familyId: 'family-1',
        assignedTo: 'user-1',
        startsAt,
        endsAt,
      });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '23514', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/check_violation/);
    });
  });

  describe('reassignShift', () => {
    test('updates assigned_to and maps the resulting row', async () => {
      // Arrange
      const rawShiftRow = {
        id: 's1',
        family_id: 'family-1',
        cared_person_id: null,
        assigned_to: 'user-3',
        starts_at: '2026-09-14T08:00:00.000Z',
        ends_at: '2026-09-14T12:00:00.000Z',
        status: 'scheduled',
        created_by: 'user-1',
        created_at: '2026-09-01T00:00:00.000Z',
      };
      let updatePayload: unknown;
      mockedFrom.mockImplementation(() => {
        const builder = makeQueryBuilder({ data: rawShiftRow, error: null });
        builder.update = jest.fn((payload: unknown) => {
          updatePayload = payload;
          return builder;
        });
        return builder;
      });

      // Act
      const result = await reassignShift('s1', 'user-3');

      // Assert
      expect(updatePayload).toEqual({ assigned_to: 'user-3' });
      expect(result.error).toBeNull();
      expect(result.data?.assignedTo).toBe('user-3');
    });

    test('normalizes a Supabase update error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockImplementation(() =>
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await reassignShift('s1', 'user-2');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });
});
