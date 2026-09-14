jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  createMedication,
  deleteMedication,
  getCaredPersonsForFamily,
  getMedicationsForFamily,
  recordMedicationTaken,
  updateMedication,
} from '../medicationsService';

const mockedRpc = supabase.rpc as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;

interface QueryChainMock {
  select: jest.Mock<QueryChainMock, string[]>;
  eq: jest.Mock<QueryChainMock, string[]>;
  delete: jest.Mock<QueryChainMock, string[]>;
  then: (resolve: (value: { data: unknown; error: unknown }) => void) => void;
}

/**
 * Mock mínimo de un query builder de supabase-js encadenable
 * (`.select()`/`.eq()`/`.delete()` devuelven el mismo objeto, que además es
 * "thenable" para que `await` lo resuelva directo) -- usado por
 * `getCaredPersonsForFamily` y `deleteMedication`, que no pasan por `.rpc()`.
 */
function mockFromChain(result: { data: unknown; error: unknown }): QueryChainMock {
  const chain: QueryChainMock = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return chain;
}

describe('medicationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMedicationsForFamily', () => {
    const rawMedicationRow = {
      id: 'med-1',
      cared_person_id: 'cp-1',
      name: 'Enalapril',
      dose: '10mg',
      instructions: null,
      schedule: 'cada 8 horas',
      created_by: 'user-1',
      created_at: '2026-09-01T00:00:00.000Z',
    };

    test('calls the get_medications_for_family RPC and maps rows', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawMedicationRow], error: null });

      // Act
      const result = await getMedicationsForFamily('family-1');

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('get_medications_for_family', {
        p_family_id: 'family-1',
      });
      expect(result).toEqual({
        data: [
          {
            id: 'med-1',
            caredPersonId: 'cp-1',
            name: 'Enalapril',
            dose: '10mg',
            instructions: null,
            schedule: 'cada 8 horas',
            createdBy: 'user-1',
            createdAt: '2026-09-01T00:00:00.000Z',
          },
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
      const result = await getMedicationsForFamily('family-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('drops a row that fails validation instead of throwing', async () => {
      // Arrange: missing required `name` field.
      const invalidRow = { ...rawMedicationRow, name: undefined };
      mockedRpc.mockResolvedValue({ data: [invalidRow], error: null });

      // Act
      const result = await getMedicationsForFamily('family-1');

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });
  });

  describe('recordMedicationTaken', () => {
    const rawLogRow = {
      id: 'log-1',
      medication_id: 'med-1',
      taken_by: 'user-1',
      taken_at: '2026-09-13T08:00:00.000Z',
      note: null,
      created_at: '2026-09-13T08:00:00.000Z',
    };

    test('records a dose with no note in a single call (1-tap path)', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawLogRow], error: null });

      // Act
      const result = await recordMedicationTaken('med-1');

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith(
        'create_medication_log',
        expect.objectContaining({ p_medication_id: 'med-1', p_note: null })
      );
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        id: 'log-1',
        medicationId: 'med-1',
        takenBy: 'user-1',
        takenAt: '2026-09-13T08:00:00.000Z',
        note: null,
        createdAt: '2026-09-13T08:00:00.000Z',
      });
    });

    test('trims and sends a short note', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: [{ ...rawLogRow, note: 'con el desayuno' }],
        error: null,
      });

      // Act
      const result = await recordMedicationTaken('med-1', { note: '  con el desayuno  ' });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith(
        'create_medication_log',
        expect.objectContaining({ p_note: 'con el desayuno' })
      );
      expect(result.data?.note).toBe('con el desayuno');
    });

    test('passes an explicit takenAt as ISO string', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawLogRow], error: null });
      const takenAt = new Date('2026-09-12T10:00:00.000Z');

      // Act
      await recordMedicationTaken('med-1', { takenAt });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith(
        'create_medication_log',
        expect.objectContaining({ p_taken_at: takenAt.toISOString() })
      );
    });

    test('rejects a note over the max length before calling Supabase', async () => {
      // Arrange
      const tooLongNote = 'a'.repeat(141);

      // Act
      const result = await recordMedicationTaken('med-1', { note: tooLongNote });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('note_too_long');
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      });

      // Act
      const result = await recordMedicationTaken('med-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('getCaredPersonsForFamily', () => {
    test('queries cared_persons by family_id and maps rows', async () => {
      // Arrange
      const chain = mockFromChain({
        data: [{ id: 'cp-1', full_name: 'Persona Cuidada' }],
        error: null,
      });
      mockedFrom.mockReturnValue(chain);

      // Act
      const result = await getCaredPersonsForFamily('family-1');

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('cared_persons');
      expect(chain.select).toHaveBeenCalledWith('id, full_name');
      expect(chain.eq).toHaveBeenCalledWith('family_id', 'family-1');
      expect(result).toEqual({
        data: [{ id: 'cp-1', fullName: 'Persona Cuidada' }],
        error: null,
      });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockReturnValue(
        mockFromChain({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await getCaredPersonsForFamily('family-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });

    test('drops a row that fails validation instead of throwing', async () => {
      // Arrange: missing required `full_name` field.
      mockedFrom.mockReturnValue(
        mockFromChain({ data: [{ id: 'cp-1' }], error: null })
      );

      // Act
      const result = await getCaredPersonsForFamily('family-1');

      // Assert
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });
  });

  describe('createMedication', () => {
    const rawMedicationRow = {
      id: 'med-1',
      cared_person_id: 'cp-1',
      name: 'Enalapril',
      dose: '10mg',
      instructions: null,
      schedule: null,
      created_by: 'user-1',
      created_at: '2026-09-14T00:00:00.000Z',
    };

    test('rejects an empty name before calling the RPC', async () => {
      // Act
      const result = await createMedication({ caredPersonId: 'cp-1', name: '  ', dose: '10mg' });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_name');
    });

    test('rejects an empty dose before calling the RPC', async () => {
      // Act
      const result = await createMedication({ caredPersonId: 'cp-1', name: 'Enalapril', dose: ' ' });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_dose');
    });

    test('trims inputs, sends null for blank optional fields, and maps the response', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawMedicationRow], error: null });

      // Act
      const result = await createMedication({
        caredPersonId: 'cp-1',
        name: '  Enalapril  ',
        dose: ' 10mg ',
        instructions: '   ',
        schedule: undefined,
      });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('create_medication', {
        p_cared_person_id: 'cp-1',
        p_name: 'Enalapril',
        p_dose: '10mg',
        p_instructions: null,
        p_schedule: null,
      });
      expect(result).toEqual({
        data: {
          id: 'med-1',
          caredPersonId: 'cp-1',
          name: 'Enalapril',
          dose: '10mg',
          instructions: null,
          schedule: null,
          createdBy: 'user-1',
          createdAt: '2026-09-14T00:00:00.000Z',
        },
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
      const result = await createMedication({ caredPersonId: 'cp-1', name: 'Enalapril', dose: '10mg' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('updateMedication', () => {
    const rawMedicationRow = {
      id: 'med-1',
      cared_person_id: 'cp-1',
      name: 'Enalapril',
      dose: '20mg',
      instructions: null,
      schedule: null,
      created_by: 'user-1',
      created_at: '2026-09-14T00:00:00.000Z',
    };

    test('rejects an empty name before calling the RPC', async () => {
      // Act
      const result = await updateMedication('med-1', { name: '   ' });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.error?.code).toBe('invalid_name');
    });

    test('rejects an empty dose before calling the RPC', async () => {
      // Act
      const result = await updateMedication('med-1', { dose: '' });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.error?.code).toBe('invalid_dose');
    });

    test('sends clear flags when instructions/schedule are explicitly nulled out', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawMedicationRow], error: null });

      // Act
      await updateMedication('med-1', { dose: '20mg', instructions: null, schedule: null });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('update_medication', {
        p_medication_id: 'med-1',
        p_name: null,
        p_dose: '20mg',
        p_instructions: null,
        p_clear_instructions: true,
        p_schedule: null,
        p_clear_schedule: true,
      });
    });

    test('leaves untouched fields as null/false when omitted', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawMedicationRow], error: null });

      // Act
      await updateMedication('med-1', { dose: '20mg' });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('update_medication', {
        p_medication_id: 'med-1',
        p_name: null,
        p_dose: '20mg',
        p_instructions: null,
        p_clear_instructions: false,
        p_schedule: null,
        p_clear_schedule: false,
      });
    });

    test('maps a not-found row (RLS silently affected 0 rows) to a not_found error', async () => {
      // Arrange: `update_medication` returns an empty result set.
      mockedRpc.mockResolvedValue({ data: [], error: null });

      // Act
      const result = await updateMedication('med-1', { dose: '20mg' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('not_found');
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      });

      // Act
      const result = await updateMedication('med-1', { dose: '20mg' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });

  describe('deleteMedication', () => {
    test('deletes by id via a direct .delete() call (no RPC needed)', async () => {
      // Arrange
      const chain = mockFromChain({ data: null, error: null });
      mockedFrom.mockReturnValue(chain);

      // Act
      const result = await deleteMedication('med-1');

      // Assert
      expect(mockedFrom).toHaveBeenCalledWith('medications');
      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('id', 'med-1');
      expect(result).toEqual({ data: null, error: null });
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange
      mockedFrom.mockReturnValue(
        mockFromChain({ data: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );

      // Act
      const result = await deleteMedication('med-1');

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42501', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/insufficient_privilege/);
    });
  });
});
