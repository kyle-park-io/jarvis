import { describe, it, expect } from 'vitest';
import { parseIssueRef, issueBranchName, issuePrTitle } from './ref';

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

describe('issuePrTitle', () => {
  it('is a Conventional Commits subject, so it survives a squash merge as-is', () => {
    expect(issuePrTitle(12)).toBe('chore(jarvis): draft for #12');
    expect(issuePrTitle(12)).toMatch(/^chore\(jarvis\): \S/);
  });

  it('depends on nothing but the issue number', () => {
    // The issue title is external text; keeping it out of the subject is the point.
    expect(issuePrTitle(1)).not.toMatch(/[^\x20-\x7E]/);
  });
});
