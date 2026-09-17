import { supabase } from '../../../lib/supabase';
import { createCaredPerson } from '../caredPersonsService';

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

const mockedRpc = supabase.rpc as jest.Mock;

describe('caredPersonsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCaredPerson', () => {
    const rawCaredPersonRow = {
      id: 'cp-1',
      family_id: 'family-1',
      full_name: 'Persona cuidada A',
      birth_date: '1945-03-20',
      condition_notes: null,
      consent_given_at: '2026-09-14T10:00:00.000Z',
      created_by: 'user-1',
      created_at: '2026-09-14T10:00:00.000Z',
    };

    test('rejects an empty full name before calling the RPC', async () => {
      // Act
      const result = await createCaredPerson({ familyId: 'family-1', fullName: '   ' });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_full_name');
    });

    test('trims inputs, sends null for blank optional fields, and maps the response', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawCaredPersonRow], error: null });

      // Act
      const result = await createCaredPerson({
        familyId: 'family-1',
        fullName: '  Persona cuidada A  ',
        birthDate: '1945-03-20',
        conditionNotes: '   ',
      });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('create_cared_person', {
        p_family_id: 'family-1',
        p_full_name: 'Persona cuidada A',
        p_birth_date: '1945-03-20',
        p_condition_notes: null,
      });
      expect(result).toEqual({
        data: {
          id: 'cp-1',
          familyId: 'family-1',
          fullName: 'Persona cuidada A',
          birthDate: '1945-03-20',
          conditionNotes: null,
          consentGivenAt: '2026-09-14T10:00:00.000Z',
          createdBy: 'user-1',
          createdAt: '2026-09-14T10:00:00.000Z',
        },
        error: null,
      });
    });

    test('never sends a consent timestamp -- the RPC fixes it internally', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawCaredPersonRow], error: null });

      // Act
      await createCaredPerson({ familyId: 'family-1', fullName: 'Persona cuidada A' });

      // Assert
      const [, params] = mockedRpc.mock.calls[0];
      expect(params).not.toHaveProperty('p_consent_given_at');
      expect(params).not.toHaveProperty('consent_given_at');
    });

    test('omits birthDate/conditionNotes as null when not provided', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawCaredPersonRow], error: null });

      // Act
      await createCaredPerson({ familyId: 'family-1', fullName: 'Persona cuidada A' });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('create_cared_person', {
        p_family_id: 'family-1',
        p_full_name: 'Persona cuidada A',
        p_birth_date: null,
        p_condition_notes: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      });

      // Act
      const result = await createCaredPerson({ familyId: 'family-1', fullName: 'Persona cuidada A' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('drops a malformed response instead of throwing', async () => {
      // Arrange: missing required `consent_given_at` field.
      const invalidRow = { ...rawCaredPersonRow, consent_given_at: undefined };
      mockedRpc.mockResolvedValue({ data: [invalidRow], error: null });

      // Act
      const result = await createCaredPerson({ familyId: 'family-1', fullName: 'Persona cuidada A' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_response');
    });
  });
});
