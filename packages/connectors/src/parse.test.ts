import { describe, it, expect } from 'vitest';
import { parseStreamLine, parseStreamFile } from './parse';

describe('parseStreamLine', () => {
  it('parses a todo with deadline and estimate, stripping the metadata from the title', () => {
    expect(parseStreamLine('trading', '- [ ] Review PR #482 @2026-07-20 ~4h')).toEqual({
      id: 'folder:trading:Review PR #482',
      streamId: 'trading',
      title: 'Review PR #482',
      source: 'folder',
      status: 'todo',
      spentHours: 0,
      deadline: '2026-07-20',
      estimateHours: 4,
    });
  });

  it('parses a done task (checked box), no metadata', () => {
    expect(parseStreamLine('trading', '- [x] Merge hotfix')).toEqual({
      id: 'folder:trading:Merge hotfix',
      streamId: 'trading',
      title: 'Merge hotfix',
      source: 'folder',
      status: 'done',
      spentHours: 0,
    });
  });

  it('treats an uppercase [X] as done', () => {
    expect(parseStreamLine('s', '- [X] done thing')?.status).toBe('done');
  });

  it('parses a fractional estimate', () => {
    expect(parseStreamLine('s', '- [ ] task ~1.5h')?.estimateHours).toBe(1.5);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseStreamLine('s', '   - [ ] Indented task  ')?.title).toBe('Indented task');
  });

  it('returns null for non-task lines', () => {
    expect(parseStreamLine('s', '# Heading')).toBeNull();
    expect(parseStreamLine('s', '')).toBeNull();
    expect(parseStreamLine('s', 'just prose')).toBeNull();
    expect(parseStreamLine('s', '- not a checkbox')).toBeNull();
  });
});

describe('parseStreamFile', () => {
  it('parses only the task lines, in order, ignoring headings and prose', () => {
    const content = ['# Trading', '', '- [ ] First @2026-07-20', 'some prose', '- [x] Second', ''].join('\n');
    const tasks = parseStreamFile('trading', content);
    expect(tasks.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(tasks.map((t) => t.status)).toEqual(['todo', 'done']);
    expect(tasks[0]?.deadline).toBe('2026-07-20');
  });

  it('returns an empty array for a file with no tasks', () => {
    expect(parseStreamFile('s', '# Just a heading\n\nsome notes')).toEqual([]);
  });
});
