import { describe, it, expect } from 'vitest';
import { parseRepo, buildListIssuesArgs, createGithubConnector, readPage, paginateIssues } from './github-mcp';

/** A list_issues page wrapped as a standard MCP text tool-result. */
function page(issues: unknown[], hasNextPage: boolean, endCursor?: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ issues, totalCount: 999, pageInfo: { hasNextPage, endCursor } }) }],
  };
}

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

describe('readPage', () => {
  it('reads issues + cursor from a list_issues page', () => {
    expect(readPage(page([{ number: 1 }], true, 'CUR'))).toEqual({
      issues: [{ number: 1 }],
      hasNextPage: true,
      endCursor: 'CUR',
    });
  });

  it('reports no next page (and no cursor) when pageInfo says so', () => {
    const r = readPage(page([{ number: 2 }], false));
    expect(r.hasNextPage).toBe(false);
    expect(r.endCursor).toBeUndefined();
  });

  it('throws on an unexpected page shape', () => {
    expect(() => readPage({ content: [{ type: 'text', text: JSON.stringify({ nope: true }) }] })).toThrow(
      /list_issues page shape/,
    );
  });
});

describe('paginateIssues', () => {
  it('threads the cursor, merges every page, and stops when hasNextPage is false', async () => {
    const pages = [page([{ number: 1 }, { number: 2 }], true, 'C1'), page([{ number: 3 }], false)];
    const seen: (string | undefined)[] = [];
    const merged = await paginateIssues(async (after) => {
      seen.push(after);
      return pages[after === 'C1' ? 1 : 0];
    });
    expect(seen).toEqual([undefined, 'C1']);
    const text = (merged as { content: { text: string }[] }).content[0]?.text ?? '';
    expect(JSON.parse(text)).toEqual({ issues: [{ number: 1 }, { number: 2 }, { number: 3 }] });
  });

  it('stops at the page cap to avoid an unbounded loop', async () => {
    let calls = 0;
    const merged = await paginateIssues(async () => {
      calls += 1;
      return page([{ number: calls }], true, `C${calls}`); // always claims another page
    }, 3);
    expect(calls).toBe(3);
    const text = (merged as { content: { text: string }[] }).content[0]?.text ?? '';
    expect(JSON.parse(text).issues).toHaveLength(3);
  });
});
