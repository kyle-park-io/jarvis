import { describe, it, expect } from 'vitest';
import { buildTaskPrompt } from './prompt';

describe('buildTaskPrompt', () => {
  it('includes the issue and forbids git operations', () => {
    const p = buildTaskPrompt({ owner: 'o', repo: 'r', number: 3, title: 'Add hello()', body: 'Please add it.' });
    expect(p).toContain('o/r');
    expect(p).toContain('#3');
    expect(p).toContain('Add hello()');
    expect(p).toContain('Please add it.');
    expect(p).toMatch(/do not commit/i);
  });

  it('handles an empty body', () => {
    expect(buildTaskPrompt({ owner: 'o', repo: 'r', number: 1, title: 't', body: '' })).toContain('(no description)');
  });
});
