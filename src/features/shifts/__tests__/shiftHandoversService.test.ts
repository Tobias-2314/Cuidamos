jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import { MAX_SHIFT_HANDOVER_FIELD_LENGTH } from '../shiftHandoverValidation';
import { createShiftHandover } from '../shiftHandoversService';

const mockedRpc = supabase.rpc as jest.Mock;

describe('shiftHandoversService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createShiftHandover', () => {
    const rawHandoverRow = {
      id: 'handover-1',
      shift_id: 'shift-1',
      resumen: 'sin incidentes',
      comida: null,
      animo: null,
      pendientes: null,
      created_by: 'user-1',
      created_at: '2026-09-15T20:00:00.000Z',
    };

    test('calls the create_shift_handover RPC with trimmed, encrypted-at-rest fields', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [rawHandoverRow], error: null });

      // Act
      const result = await createShiftHandover({
        shiftId: 'shift-1',
        resumen: '  sin incidentes  ',
        comida: '   ',
        animo: null,
        pendientes: undefined,
      });

      // Assert
      expect(mockedRpc).toHaveBeenCalledWith('create_shift_handover', {
        p_shift_id: 'shift-1',
        p_resumen: 'sin incidentes',
        p_comida: null,
        p_animo: null,
        p_pendientes: null,
      });
      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        id: 'handover-1',
        shiftId: 'shift-1',
        resumen: 'sin incidentes',
        comida: null,
        animo: null,
        pendientes: null,
        createdBy: 'user-1',
        createdAt: '2026-09-15T20:00:00.000Z',
      });
    });

    test('rejects a fully empty handover before calling Supabase', async () => {
      // Act
      const result = await createShiftHandover({ shiftId: 'shift-1' });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('empty_handover');
    });

    test('rejects a field over the max length before calling Supabase', async () => {
      // Arrange
      const tooLongField = 'a'.repeat(MAX_SHIFT_HANDOVER_FIELD_LENGTH + 1);

      // Act
      const result = await createShiftHandover({ shiftId: 'shift-1', resumen: tooLongField });

      // Assert
      expect(mockedRpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('field_too_long');
    });

    test('normalizes a Supabase error instead of propagating it raw', async () => {
      // Arrange -- e.g. the RPC not existing yet (PGM-backend pending), or an RLS violation
      mockedRpc.mockResolvedValue({
        data: null,
        error: { code: '42883', message: 'function create_shift_handover(...) does not exist' },
      });

      // Act
      const result = await createShiftHandover({ shiftId: 'shift-1', resumen: 'sin incidentes' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error).toEqual({ code: '42883', message: expect.any(String) });
      expect(result.error?.message).not.toMatch(/does not exist/);
    });

    test('treats an invalid RPC response shape as an error instead of trusting it', async () => {
      // Arrange
      mockedRpc.mockResolvedValue({ data: [{ unexpected: 'shape' }], error: null });

      // Act
      const result = await createShiftHandover({ shiftId: 'shift-1', resumen: 'sin incidentes' });

      // Assert
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('invalid_response');
    });
  });
});
