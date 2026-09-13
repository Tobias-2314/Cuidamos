import {
  buildCalendarSections,
  formatShiftTimeRange,
  getMonthRange,
  getWeekRange,
} from '../calendarSections';
import type { Shift } from '../shiftsService';

function makeShift(overrides: Partial<Shift> & { startsAt: string; endsAt: string }): Shift {
  return {
    id: overrides.id ?? `shift-${overrides.startsAt}`,
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

describe('buildCalendarSections', () => {
  test('returns no sections for an empty list', () => {
    // Arrange
    const shifts: Shift[] = [];

    // Act
    const sections = buildCalendarSections(shifts, 'weekly');

    // Assert
    expect(sections).toEqual([]);
  });

  test('groups shifts on the same day into one weekly section', () => {
    // Arrange
    const shifts = [
      makeShift({ id: 'a', startsAt: '2026-09-14T08:00:00', endsAt: '2026-09-14T12:00:00' }),
      makeShift({ id: 'b', startsAt: '2026-09-14T14:00:00', endsAt: '2026-09-14T18:00:00' }),
    ];

    // Act
    const sections = buildCalendarSections(shifts, 'weekly');

    // Assert
    expect(sections).toHaveLength(1);
    expect(sections[0].data.map((s) => s.id)).toEqual(['a', 'b']);
    expect(sections[0].title).toMatch(/^Lunes /);
  });

  test('splits shifts on different days into separate weekly sections, in chronological order', () => {
    // Arrange
    const shifts = [
      makeShift({ id: 'later', startsAt: '2026-09-16T09:00:00', endsAt: '2026-09-16T10:00:00' }),
      makeShift({ id: 'earlier', startsAt: '2026-09-14T09:00:00', endsAt: '2026-09-14T10:00:00' }),
    ];

    // Act
    const sections = buildCalendarSections(shifts, 'weekly');

    // Assert
    expect(sections).toHaveLength(2);
    expect(sections[0].data[0].id).toBe('earlier');
    expect(sections[1].data[0].id).toBe('later');
  });

  test('groups shifts from the same week into one monthly section', () => {
    // Arrange
    const shifts = [
      // Monday and Wednesday of the same week (2026-09-14 is a Monday).
      makeShift({ id: 'mon', startsAt: '2026-09-14T09:00:00', endsAt: '2026-09-14T10:00:00' }),
      makeShift({ id: 'wed', startsAt: '2026-09-16T09:00:00', endsAt: '2026-09-16T10:00:00' }),
    ];

    // Act
    const sections = buildCalendarSections(shifts, 'monthly');

    // Assert
    expect(sections).toHaveLength(1);
    expect(sections[0].data.map((s) => s.id)).toEqual(['mon', 'wed']);
    expect(sections[0].title).toMatch(/^Semana del /);
  });

  test('splits shifts from different weeks into separate monthly sections', () => {
    // Arrange
    const shifts = [
      makeShift({ id: 'week1', startsAt: '2026-09-14T09:00:00', endsAt: '2026-09-14T10:00:00' }),
      makeShift({ id: 'week2', startsAt: '2026-09-22T09:00:00', endsAt: '2026-09-22T10:00:00' }),
    ];

    // Act
    const sections = buildCalendarSections(shifts, 'monthly');

    // Assert
    expect(sections).toHaveLength(2);
  });
});

describe('formatShiftTimeRange', () => {
  test('formats the start and end time as HH:mm - HH:mm', () => {
    // Arrange
    const shift = makeShift({ startsAt: '2026-09-14T08:05:00', endsAt: '2026-09-14T14:30:00' });

    // Act
    const result = formatShiftTimeRange(shift);

    // Assert
    expect(result).toBe('08:05 - 14:30');
  });
});

describe('getWeekRange', () => {
  test('returns Monday 00:00 through the following Monday 00:00', () => {
    // Arrange: 2026-09-16 is a Wednesday.
    const referenceDate = new Date(2026, 8, 16, 15, 30);

    // Act
    const range = getWeekRange(referenceDate);

    // Assert
    expect(range.from).toEqual(new Date(2026, 8, 14, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 8, 21, 0, 0, 0, 0));
  });

  test('handles a Sunday reference date (still the same Mon-Sun week)', () => {
    // Arrange: 2026-09-20 is a Sunday, part of the week starting 2026-09-14.
    const referenceDate = new Date(2026, 8, 20, 9, 0);

    // Act
    const range = getWeekRange(referenceDate);

    // Assert
    expect(range.from).toEqual(new Date(2026, 8, 14, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 8, 21, 0, 0, 0, 0));
  });
});

describe('getMonthRange', () => {
  test('returns the 1st of the month through the 1st of the next month', () => {
    // Arrange
    const referenceDate = new Date(2026, 8, 16);

    // Act
    const range = getMonthRange(referenceDate);

    // Assert
    expect(range.from).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
  });
});
