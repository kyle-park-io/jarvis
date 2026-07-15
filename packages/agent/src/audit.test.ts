import { describe, it, expect } from 'vitest';
import { auditLine } from './audit';

describe('auditLine', () => {
  it('is a single tab-separated line ending in newline, with a truncated one-line summary', () => {
    const line = auditLine({
      time: '2026-07-16T00:00:00Z',
      ref: 'o/r#3',
      branch: 'jarvis/issue-3',
      prUrl: 'https://github.com/o/r/pull/9',
      sessionId: 'sess',
      numTurns: 4,
      summary: 'Added\na hello function',
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2); // content + trailing newline
    expect(line).toContain('\t');
    expect(line).toContain('o/r#3');
    expect(line).toContain('Added a hello function'); // newline collapsed
  });
});
