import { describe, it, expect } from 'vitest';
import { parseRepo, buildListIssuesArgs, createGithubConnector } from './github-mcp';

describe('parseRepo', () => {
  it('splits "owner/name"', () => {
    expect(parseRepo('octo/hello')).toEqual({ owner: 'octo', repo: 'hello' });
  });

  it('throws on a malformed repo', () => {
    expect(() => parseRepo('nope')).toThrow(/expected "owner\/name"/);
    expect(() => parseRepo('a/b/c')).toThrow();
    expect(() => parseRepo('/b')).toThrow();
    expect(() => parseRepo('a/')).toThrow();
  });
});

describe('buildListIssuesArgs', () => {
  it('defaults state to open and caps the page size', () => {
    expect(buildListIssuesArgs({ repo: 'octo/hello', streamId: 's' })).toEqual({
      owner: 'octo',
      repo: 'hello',
      state: 'open',
      perPage: 100,
    });
  });

  it('passes an explicit state through', () => {
    expect(buildListIssuesArgs({ repo: 'octo/hello', streamId: 's', state: 'all' }).state).toBe('all');
  });
});

describe('createGithubConnector (gating)', () => {
  const entries = [{ repo: 'octo/hello', streamId: 'personal' }];

  it('returns undefined without a token', () => {
    expect(createGithubConnector({ token: undefined, entries })).toBeUndefined();
    expect(createGithubConnector({ token: '', entries })).toBeUndefined();
  });

  it('returns undefined with no entries', () => {
    expect(createGithubConnector({ token: 'ghp_x', entries: [] })).toBeUndefined();
  });

  it('returns a github connector when token + entries are present, and close() is safe before any connect', async () => {
    const gh = createGithubConnector({ token: 'ghp_x', entries });
    expect(gh?.connector.id).toBe('github');
    await expect(gh?.close()).resolves.toBeUndefined();
  });
});
