import { describe, it, expect } from 'vitest';
import {
  weekdayOf,
  weekStart,
  isSameWeek,
  daysUntil,
  countRemainingWorkdays,
  workdaysInWeek,
  workdaysElapsed,
} from './dates';

const MON_FRI = [1, 2, 3, 4, 5];

describe('dates', () => {
  it('weekdayOf: 2026-07-14 is a Tuesday (2)', () => {
    expect(weekdayOf('2026-07-14')).toBe(2);
  });

  it('weekStart: Monday of the week containing 2026-07-14 is 2026-07-13', () => {
    expect(weekStart('2026-07-14')).toBe('2026-07-13');
    expect(weekStart('2026-07-13')).toBe('2026-07-13'); // Monday maps to itself
    expect(weekStart('2026-07-19')).toBe('2026-07-13'); // Sunday still same week
  });

  it('isSameWeek respects Mon–Sun boundaries', () => {
    expect(isSameWeek('2026-07-13', '2026-07-19')).toBe(true);
    expect(isSameWeek('2026-07-19', '2026-07-20')).toBe(false);
  });

  it('daysUntil returns signed integer day difference', () => {
    expect(daysUntil('2026-07-14', '2026-07-16')).toBe(2);
    expect(daysUntil('2026-07-14', '2026-07-14')).toBe(0);
    expect(daysUntil('2026-07-14', '2026-07-13')).toBe(-1);
  });

  it('countRemainingWorkdays: Tue 07-14, Mon–Fri -> Tue,Wed,Thu,Fri = 4', () => {
    expect(countRemainingWorkdays('2026-07-14', MON_FRI)).toBe(4);
  });

  it('countRemainingWorkdays: Sun 07-19, Mon–Fri = 0', () => {
    expect(countRemainingWorkdays('2026-07-19', MON_FRI)).toBe(0);
  });

  it('workdaysInWeek: Mon–Fri = 5', () => {
    expect(workdaysInWeek('2026-07-14', MON_FRI)).toBe(5);
  });

  it('workdaysElapsed: Tue 07-14, Mon–Fri -> Mon,Tue = 2', () => {
    expect(workdaysElapsed('2026-07-14', MON_FRI)).toBe(2);
  });
});
