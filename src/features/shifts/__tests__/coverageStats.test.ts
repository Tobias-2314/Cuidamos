import {
  buildCoverageStats,
  coverageBarWidthPercent,
  formatMonthLabel,
  type CoverageStat,
} from '../coverageStats';
import type { FamilyMember, Shift } from '../shiftsService';

function makeShift(overrides: Partial<Shift> & { startsAt: string; endsAt: string }): Shift {
  return {
    id: overrides.id ?? `shift-${overrides.startsAt}-${overrides.assignedTo ?? 'user-1'}`,
    familyId: 'family-1',
    caredPersonId: null,
    caredPersonName: null,
    assignedTo: 'user-1',
    status: 'scheduled',
    createdBy: 'user-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMember(userId: string, role: FamilyMember['role'] = 'cuidador'): FamilyMember {
  return { userId, role };
}

describe('buildCoverageStats', () => {
  test('returns one zero-hour row per member when there are no shifts', () => {
    // Arrange
    const members = [makeMember('user-1'), makeMember('user-2')];

    // Act
    const stats = buildCoverageStats([], members);

    // Assert
    expect(stats).toEqual([
      { userId: 'user-1', shiftCount: 0, totalHours: 0 },
      { userId: 'user-2', shiftCount: 0, totalHours: 0 },
    ]);
  });

  test('sums hours and counts shifts per assignee', () => {
    // Arrange
    const members = [makeMember('user-1'), makeMember('user-2')];
    const shifts = [
      makeShift({ assignedTo: 'user-1', startsAt: '2026-09-01T08:00:00', endsAt: '2026-09-01T12:00:00' }), // 4h
      makeShift({ assignedTo: 'user-1', startsAt: '2026-09-02T08:00:00', endsAt: '2026-09-02T10:00:00' }), // 2h
      makeShift({ assignedTo: 'user-2', startsAt: '2026-09-03T08:00:00', endsAt: '2026-09-03T09:00:00' }), // 1h
    ];

    // Act
    const stats = buildCoverageStats(shifts, members);

    // Assert
    expect(stats).toEqual([
      { userId: 'user-1', shiftCount: 2, totalHours: 6 },
      { userId: 'user-2', shiftCount: 1, totalHours: 1 },
    ]);
  });

  test('orders results from most to least hours covered', () => {
    // Arrange
    const members = [makeMember('under'), makeMember('over')];
    const shifts = [
      makeShift({ id: 'a', assignedTo: 'under', startsAt: '2026-09-01T08:00:00', endsAt: '2026-09-01T09:00:00' }),
      makeShift({ id: 'b', assignedTo: 'over', startsAt: '2026-09-01T08:00:00', endsAt: '2026-09-01T18:00:00' }),
    ];

    // Act
    const stats = buildCoverageStats(shifts, members);

    // Assert
    expect(stats.map((s) => s.userId)).toEqual(['over', 'under']);
  });

  test('breaks ties in hours by shift count, descending', () => {
    // Arrange: both cover 4h total, but 'many-short' has more shifts.
    const members = [makeMember('many-short'), makeMember('one-long')];
    const shifts = [
      makeShift({ id: 'a', assignedTo: 'many-short', startsAt: '2026-09-01T08:00:00', endsAt: '2026-09-01T10:00:00' }),
      makeShift({ id: 'b', assignedTo: 'many-short', startsAt: '2026-09-02T08:00:00', endsAt: '2026-09-02T10:00:00' }),
      makeShift({ id: 'c', assignedTo: 'one-long', startsAt: '2026-09-01T08:00:00', endsAt: '2026-09-01T12:00:00' }),
    ];

    // Act
    const stats = buildCoverageStats(shifts, members);

    // Assert
    expect(stats.map((s) => s.userId)).toEqual(['many-short', 'one-long']);
  });

  test('excludes cancelled shifts from the totals', () => {
    // Arrange
    const members = [makeMember('user-1')];
    const shifts = [
      makeShift({
        assignedTo: 'user-1',
        status: 'cancelled',
        startsAt: '2026-09-01T08:00:00',
        endsAt: '2026-09-01T18:00:00',
      }),
    ];

    // Act
    const stats = buildCoverageStats(shifts, members);

    // Assert
    expect(stats).toEqual([{ userId: 'user-1', shiftCount: 0, totalHours: 0 }]);
  });

  test('counts scheduled, in_progress and completed shifts', () => {
    // Arrange
    const members = [makeMember('user-1')];
    const shifts = [
      makeShift({
        id: 'scheduled',
        assignedTo: 'user-1',
        status: 'scheduled',
        startsAt: '2026-09-01T08:00:00',
        endsAt: '2026-09-01T09:00:00',
      }),
      makeShift({
        id: 'in_progress',
        assignedTo: 'user-1',
        status: 'in_progress',
        startsAt: '2026-09-02T08:00:00',
        endsAt: '2026-09-02T09:00:00',
      }),
      makeShift({
        id: 'completed',
        assignedTo: 'user-1',
        status: 'completed',
        startsAt: '2026-09-03T08:00:00',
        endsAt: '2026-09-03T09:00:00',
      }),
    ];

    // Act
    const stats = buildCoverageStats(shifts, members);

    // Assert
    expect(stats).toEqual([{ userId: 'user-1', shiftCount: 3, totalHours: 3 }]);
  });

  test('still counts a shift assigned to someone outside the members list', () => {
    // Arrange: e.g. a caregiver who left the family but has a past shift.
    const members = [makeMember('user-1')];
    const shifts = [
      makeShift({ assignedTo: 'former-member', startsAt: '2026-09-01T08:00:00', endsAt: '2026-09-01T10:00:00' }),
    ];

    // Act
    const stats = buildCoverageStats(shifts, members);

    // Assert
    expect(stats).toContainEqual({ userId: 'former-member', shiftCount: 1, totalHours: 2 });
    expect(stats).toContainEqual({ userId: 'user-1', shiftCount: 0, totalHours: 0 });
  });
});

describe('coverageBarWidthPercent', () => {
  test('returns 0 for every stat when nobody covered any hours', () => {
    // Arrange
    const stats: CoverageStat[] = [
      { userId: 'user-1', shiftCount: 0, totalHours: 0 },
      { userId: 'user-2', shiftCount: 0, totalHours: 0 },
    ];

    // Act & Assert
    expect(coverageBarWidthPercent(stats[0], stats)).toBe(0);
    expect(coverageBarWidthPercent(stats[1], stats)).toBe(0);
  });

  test('scales proportionally to the max hours in the group', () => {
    // Arrange
    const stats: CoverageStat[] = [
      { userId: 'over', shiftCount: 1, totalHours: 10 },
      { userId: 'under', shiftCount: 1, totalHours: 2.5 },
    ];

    // Act & Assert
    expect(coverageBarWidthPercent(stats[0], stats)).toBe(100);
    expect(coverageBarWidthPercent(stats[1], stats)).toBe(25);
  });
});

describe('formatMonthLabel', () => {
  test('formats a date as "<Mes> <Año>" in Spanish', () => {
    // Arrange
    const referenceDate = new Date(2026, 8, 16); // 8 = septiembre (0-indexed)

    // Act
    const label = formatMonthLabel(referenceDate);

    // Assert
    expect(label).toBe('Septiembre 2026');
  });
});
