import { describe, it, expect } from 'vitest';
import { allocate, type AllocateInput, type WorkStream } from './index';

const MON_FRI = [1, 2, 3, 4, 5];

describe('scenario: morning briefing', () => {
  it('produces a ranked, budget-respecting plan for three streams', () => {
    const streams: WorkStream[] = [
      { id: 'alpha', name: 'Alpha', weeklyBudgetHours: 25, weight: 0.5, workdays: MON_FRI, active: true },
      { id: 'beta', name: 'Beta', weeklyBudgetHours: 15, weight: 0.3, workdays: MON_FRI, active: true },
      { id: 'gamma', name: 'Gamma', weeklyBudgetHours: 8, weight: 0.2, workdays: MON_FRI, active: true },
    ];
    const input: AllocateInput = {
      date: '2026-07-14', // Tuesday, 4 remaining workdays
      streams,
      tasks: [],
      weekLogs: [],
      committedHoursToday: 3,
      dailyCapacityHours: 8,
      deadlineHorizonDays: 5,
    };

    const { allocation } = allocate(input);

    expect(allocation.capacityHours).toBe(5); // 8 - 3
    // base paces: 25/4=6.25, 15/4=3.75, 8/4=2.0 -> total 12 > 5 -> overcommit, scaled by 5/12
    expect(allocation.overcommitted).toBe(true);
    expect(allocation.lines.map((l) => l.streamId)).toEqual(['alpha', 'beta', 'gamma']);
    const total = allocation.lines.reduce((s, l) => s + l.targetHours, 0);
    expect(total).toBeCloseTo(5, 1);
  });
});
