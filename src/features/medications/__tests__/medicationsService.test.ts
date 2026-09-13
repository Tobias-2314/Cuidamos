jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { getMedicationsForFamily, recordMedicationTaken } from '../medicationsService';

const mockedRpc = supabase.rpc as jest.Mock;

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
});
