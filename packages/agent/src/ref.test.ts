import { describe, it, expect } from 'vitest';
import { parseIssueRef, issueBranchName } from './ref';

describe('parseIssueRef', () => {
  it('parses owner/repo#number', () => {
    expect(parseIssueRef('kyle-park-io/jarvis-sandbox#3')).toEqual({
      owner: 'kyle-park-io',
      repo: 'jarvis-sandbox',
      number: 3,
    });
  });

  it('throws on a malformed ref', () => {
    expect(() => parseIssueRef('nope')).toThrow(/owner\/repo#number/);
    expect(() => parseIssueRef('a/b#x')).toThrow();
    expect(() => parseIssueRef('a/b')).toThrow();
  });
});

describe('issueBranchName', () => {
  it('names the branch jarvis/issue-<n>', () => {
    expect(issueBranchName(7)).toBe('jarvis/issue-7');
  });
});
