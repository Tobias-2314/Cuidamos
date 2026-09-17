import { supabase } from '../../../lib/supabase';
import {
  createEmergencyContact,
  createMedicalContact,
  getEmergencyContactsForCaredPerson,
  getMedicalContactsForCaredPerson,
} from '../contactsService';

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
 * criterio que `familyService.test.ts`/`medicationsService.test.ts`: cada
 * método chainable devuelve el mismo builder, y además es "thenable" para
 * cubrir tanto el camino `await supabase.from(...).select(...).eq(...)`
 * (sin terminal explícito) como el camino con `.single()`.
 */
function makeQueryBuilder(finalResult: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(finalResult)),
  };
  (builder as unknown as { then: PromiseLike<typeof finalResult>['then'] }).then = (resolve) =>
    Promise.resolve(finalResult).then(resolve as never);
  return builder;
}

describe('contactsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMedicalContactsForCaredPerson', () => {
    test('queries medical_contacts by cared_person_id and maps rows', async () => {
      // Arrange
      const chain = makeQueryBuilder({
        data: [
          {
            id: 'mc-1',
            cared_person_id: 'cp-1',
            full_name: 'Dr. Juan Pérez',
            specialty: 'Cardiología',
            phone: '1155555555',
            notes: null,
            created_by: 'user-1',
            created_at: '2026-09-14T00:00:00.000Z',
          },
        ],
        error: null,
      });
      mockedFrom.mockReturnValue(chain);

      // Act
      const result = await getMedicalContactsForCaredPerson('cp-1');

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('medical_contacts');
      expect(chain.eq).toHaveBeenCalledWith('cared_person_id', 'cp-1');
      expect(result).toEqual({
        data: [
          {
            id: 'mc-1',
            caredPersonId: 'cp-1',
            fullName: 'Dr. Juan Pérez',
            specialty: 'Cardiología',
            phone: '1155555555',
            notes: null,
            createdBy: 'user-1',
            createdAt: '2026-09-14T00:00:00.000Z',
          },
        ],
        error: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockReturnValue(
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await getMedicalContactsForCaredPerson('cp-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('drops a row that fails validation instead of throwing', async () => {
      // Arrange: missing required `full_name` field.
      mockedFrom.mockReturnValue(makeQueryBuilder({ data: [{ id: 'mc-1' }], error: null }));

      // Act
      const result = await getMedicalContactsForCaredPerson('cp-1');

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });
  });

  describe('getEmergencyContactsForCaredPerson', () => {
    test('queries emergency_contacts by cared_person_id and maps rows', async () => {
      // Arrange
      const chain = makeQueryBuilder({
        data: [
          {
            id: 'ec-1',
            cared_person_id: 'cp-1',
            full_name: 'María López',
            relationship: 'Hija',
            phone: '1144444444',
            notes: 'Llamar de mañana',
            created_by: 'user-1',
            created_at: '2026-09-14T00:00:00.000Z',
          },
        ],
        error: null,
      });
      mockedFrom.mockReturnValue(chain);

      // Act
      const result = await getEmergencyContactsForCaredPerson('cp-1');

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('emergency_contacts');
      expect(result).toEqual({
        data: [
          {
            id: 'ec-1',
            caredPersonId: 'cp-1',
            fullName: 'María López',
            relationship: 'Hija',
            phone: '1144444444',
            notes: 'Llamar de mañana',
            createdBy: 'user-1',
            createdAt: '2026-09-14T00:00:00.000Z',
          },
        ],
        error: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockReturnValue(
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await getEmergencyContactsForCaredPerson('cp-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('createMedicalContact', () => {
    test('rejects an empty full name before calling Supabase', async () => {
      // Act
      const result = await createMedicalContact({ caredPersonId: 'cp-1', fullName: '   ' });

      // Assert
      expect(mockedGetUser).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_full_name');
    });

    test('resolves the current user, trims inputs, and maps the response', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const chain = makeQueryBuilder({
        data: {
          id: 'mc-1',
          cared_person_id: 'cp-1',
          full_name: 'Dr. Juan Pérez',
          specialty: 'Cardiología',
          phone: null,
          notes: null,
          created_by: 'user-1',
          created_at: '2026-09-14T00:00:00.000Z',
        },
        error: null,
      });
      mockedFrom.mockReturnValue(chain);

      // Act
      const result = await createMedicalContact({
        caredPersonId: 'cp-1',
        fullName: '  Dr. Juan Pérez  ',
        specialty: '  Cardiología  ',
        phone: '   ',
      });

      // Assert
      expect(chain.insert).toHaveBeenCalledWith({
        cared_person_id: 'cp-1',
        full_name: 'Dr. Juan Pérez',
        specialty: 'Cardiología',
        phone: null,
        notes: null,
        created_by: 'user-1',
      });
      expect(result).toEqual({
        data: {
          id: 'mc-1',
          caredPersonId: 'cp-1',
          fullName: 'Dr. Juan Pérez',
          specialty: 'Cardiología',
          phone: null,
          notes: null,
          createdBy: 'user-1',
          createdAt: '2026-09-14T00:00:00.000Z',
        },
        error: null,
      });
    });

    test('returns not_authenticated without calling Supabase insert when there is no session', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: null }, error: null });

      // Act
      const result = await createMedicalContact({ caredPersonId: 'cp-1', fullName: 'Dr. Pérez' });

      // Assert
      expect(mockedFrom).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('not_authenticated');
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockReturnValue(
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await createMedicalContact({ caredPersonId: 'cp-1', fullName: 'Dr. Pérez' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('createEmergencyContact', () => {
    test('rejects an empty full name before calling Supabase', async () => {
      // Act
      const result = await createEmergencyContact({
        caredPersonId: 'cp-1',
        fullName: '   ',
        phone: '1144444444',
      });

      // Assert
      expect(mockedGetUser).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_full_name');
    });

    test('rejects an empty phone before calling Supabase (NOT NULL in the table)', async () => {
      // Act
      const result = await createEmergencyContact({
        caredPersonId: 'cp-1',
        fullName: 'María López',
        phone: '   ',
      });

      // Assert
      expect(mockedGetUser).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_phone');
    });

    test('resolves the current user, trims inputs, and maps the response', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const chain = makeQueryBuilder({
        data: {
          id: 'ec-1',
          cared_person_id: 'cp-1',
          full_name: 'María López',
          relationship: 'Hija',
          phone: '1144444444',
          notes: null,
          created_by: 'user-1',
          created_at: '2026-09-14T00:00:00.000Z',
        },
        error: null,
      });
      mockedFrom.mockReturnValue(chain);

      // Act
      const result = await createEmergencyContact({
        caredPersonId: 'cp-1',
        fullName: '  María López  ',
        relationship: '  Hija  ',
        phone: '  1144444444  ',
      });

      // Assert
      expect(chain.insert).toHaveBeenCalledWith({
        cared_person_id: 'cp-1',
        full_name: 'María López',
        relationship: 'Hija',
        phone: '1144444444',
        notes: null,
        created_by: 'user-1',
      });
      expect(result).toEqual({
        data: {
          id: 'ec-1',
          caredPersonId: 'cp-1',
          fullName: 'María López',
          relationship: 'Hija',
          phone: '1144444444',
          notes: null,
          createdBy: 'user-1',
          createdAt: '2026-09-14T00:00:00.000Z',
        },
        error: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      mockedFrom.mockReturnValue(
        makeQueryBuilder({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await createEmergencyContact({
        caredPersonId: 'cp-1',
        fullName: 'María López',
        phone: '1144444444',
      });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });
});
