import { describe, it, expect } from 'vitest';
import { allocate, round1, type AllocateInput } from './allocate';
import type { WorkStream } from './model';

const MON_FRI = [1, 2, 3, 4, 5];

function stream(partial: Partial<WorkStream> & { id: string }): WorkStream {
  return {
    name: partial.id,
    weeklyBudgetHours: 10,
    weight: 0.5,
    workdays: MON_FRI,
    active: true,
    ...partial,
  };
}

function baseInput(over: Partial<AllocateInput> = {}): AllocateInput {
  return {
    date: '2026-07-14', // Tuesday -> 4 remaining workdays (Tue..Fri)
    streams: [],
    tasks: [],
    weekLogs: [],
    committedHoursToday: 0,
    dailyCapacityHours: 8,
    deadlineHorizonDays: 5,
    ...over,
  };
}

describe('round1', () => {
  it('rounds to one decimal', () => {
    expect(round1(2.4999)).toBe(2.5);
    expect(round1(1 / 3)).toBe(0.3);
  });
});

describe('allocate', () => {
  it('splits remaining weekly budget over remaining workdays (base pace)', () => {
    const res = allocate(baseInput({ streams: [stream({ id: 's1', weeklyBudgetHours: 20 })] }));
    // 20h budget, 0 logged, 4 remaining workdays -> 5.0h today
    expect(res.allocation.lines).toEqual([
      { streamId: 's1', targetHours: 5, tasks: [] },
    ]);
    expect(res.allocation.overcommitted).toBe(false);
    expect(res.alerts.map((a) => a.type)).not.toContain('overcommit');
  });

  it('subtracts already-logged hours (self-correcting pace)', () => {
    const res = allocate(
      baseInput({
        streams: [stream({ id: 's1', weeklyBudgetHours: 20 })],
        weekLogs: [{ date: '2026-07-13', streamId: 's1', hours: 8 }],
      }),
    );
    // remaining 12h over 4 days -> 3.0h
    expect(res.allocation.lines[0]?.targetHours).toBe(3);
  });

  it('computes capacity as dailyCapacity minus committed calendar hours', () => {
    const res = allocate(
      baseInput({
        streams: [stream({ id: 's1', weeklyBudgetHours: 20 })],
        committedHoursToday: 3,
      }),
    );
    expect(res.allocation.capacityHours).toBe(5);
  });

  it('drops inactive streams and omits zero-target lines', () => {
    const res = allocate(
      baseInput({
        streams: [
          stream({ id: 's1', weeklyBudgetHours: 20 }),
          stream({ id: 's2', active: false, weeklyBudgetHours: 20 }),
          stream({ id: 's3', weeklyBudgetHours: 0 }),
        ],
      }),
    );
    expect(res.allocation.lines.map((l) => l.streamId)).toEqual(['s1']);
  });

  it('sorts lines by target descending', () => {
    const res = allocate(
      baseInput({
        dailyCapacityHours: 100,
        streams: [
          stream({ id: 'small', weeklyBudgetHours: 4 }),
          stream({ id: 'big', weeklyBudgetHours: 40 }),
        ],
      }),
    );
    expect(res.allocation.lines.map((l) => l.streamId)).toEqual(['big', 'small']);
  });

  it('scales down proportionally and raises overcommit when targets exceed capacity', () => {
    const res = allocate(
      baseInput({
        dailyCapacityHours: 3,
        streams: [
          stream({ id: 's1', weeklyBudgetHours: 20 }), // base 5
          stream({ id: 's2', weeklyBudgetHours: 20 }), // base 5 -> total 10, capacity 3 -> scale 0.3
        ],
      }),
    );
    expect(res.allocation.overcommitted).toBe(true);
    expect(res.allocation.lines[0]?.targetHours).toBe(1.5);
    expect(res.allocation.lines[1]?.targetHours).toBe(1.5);
    expect(res.alerts.map((a) => a.type)).toContain('overcommit');
  });

  it('lets deadline pressure raise a stream above its base pace', () => {
    const res = allocate(
      baseInput({
        dailyCapacityHours: 100,
        streams: [stream({ id: 's1', weeklyBudgetHours: 20 })], // base 5
        tasks: [
          {
            id: 't1',
            streamId: 's1',
            title: 'ship',
            source: 'manual',
            status: 'todo',
            spentHours: 0,
            estimateHours: 16,
            deadline: '2026-07-15', // due in 1 day -> pressure 8
          },
        ],
      }),
    );
    // max(basePace 5, pressure 8) = 8, capped by remaining weekly 20
    expect(res.allocation.lines[0]?.targetHours).toBe(8);
    expect(res.allocation.lines[0]?.tasks.map((t) => t.id)).toEqual(['t1']);
  });
});
