import { describe, it, expect } from 'vitest';
import { githubIssuesToTasks, extractIssues, githubConnector, type GithubRepoEntry } from './github';

/** Wrap a JSON value as a standard MCP text tool-result. */
function mcpResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** The real remote-server list_issues payload shape. */
function realListIssues(issues: unknown[]) {
  return { issues, totalCount: issues.length, pageInfo: { hasNextPage: false } };
}

/** The GraphQL-shaped list_issues variant (accepted as a fallback). */
function listIssues(nodes: unknown[]) {
  return { repository: { issues: { nodes } } };
}

describe('githubIssuesToTasks', () => {
  it('maps issues to tasks with a repo-qualified id and open/closed status', () => {
    const tasks = githubIssuesToTasks(
      [
        { number: 12, title: 'Fix bug', state: 'OPEN', url: 'https://github.com/o/r/issues/12', repository: 'o/r' },
        { number: 7, title: 'Old', state: 'CLOSED', url: 'https://github.com/o/r/issues/7', repository: 'o/r' },
      ],
      'personal',
    );
    expect(tasks).toEqual([
      { id: 'github:o/r#12', streamId: 'personal', title: 'Fix bug', source: 'github', status: 'todo', spentHours: 0, sourceRef: 'https://github.com/o/r/issues/12' },
      { id: 'github:o/r#7', streamId: 'personal', title: 'Old', source: 'github', status: 'done', spentHours: 0, sourceRef: 'https://github.com/o/r/issues/7' },
    ]);
  });

  it('treats state case-insensitively and synthesizes a canonical issue URL when the server omits url', () => {
    const [task] = githubIssuesToTasks([{ number: 1, title: 'x', state: 'closed', repository: 'o/r' }], 's');
    expect(task?.status).toBe('done');
    expect(task?.sourceRef).toBe('https://github.com/o/r/issues/1');
  });

  it('falls back to a bare #number id (and no sourceRef) when repository is absent', () => {
    const [task] = githubIssuesToTasks([{ number: 5, title: 'x', state: 'OPEN' }], 's');
    expect(task?.id).toBe('github:#5');
    expect(task && 'sourceRef' in task).toBe(false);
  });
});

describe('extractIssues', () => {
  it('extracts the real remote-server shape { issues, totalCount, pageInfo }', () => {
    const issues = extractIssues(realListIssues([{ number: 3, title: 'c', state: 'OPEN' }]));
    expect(issues).toEqual([{ number: 3, title: 'c', state: 'OPEN' }]);
  });

  it('digs nodes out of the GraphQL variant { repository: { issues: { nodes } } }', () => {
    const issues = extractIssues(listIssues([{ number: 1, title: 'a', state: 'OPEN', url: 'u' }]));
    expect(issues).toEqual([{ number: 1, title: 'a', state: 'OPEN', url: 'u' }]);
  });

  it('accepts a bare array as a fallback', () => {
    expect(extractIssues([{ number: 2, title: 'b', state: 'CLOSED' }])).toEqual([
      { number: 2, title: 'b', state: 'CLOSED' },
    ]);
  });

  it('throws on an unexpected shape', () => {
    expect(() => extractIssues({ nope: true })).toThrow(/Unexpected GitHub MCP result shape/);
  });

  it('throws on a malformed issue node (missing number/title/state)', () => {
    expect(() => extractIssues(listIssues([{ title: 'no number', state: 'OPEN' }]))).toThrow(/Malformed GitHub issue/);
  });
});

describe('githubConnector (aggregating)', () => {
  const entries: GithubRepoEntry[] = [
    { repo: 'o/a', streamId: 'work' },
    { repo: 'o/b', streamId: 'personal' },
  ];

  it('pulls every entry, tags ids with the entry repo, concatenates, and synthesizes sourceRefs', async () => {
    const byRepo: Record<string, unknown> = {
      'o/a': mcpResult(realListIssues([{ number: 1, title: 'A1', state: 'OPEN' }])),
      'o/b': mcpResult(realListIssues([{ number: 9, title: 'B9', state: 'OPEN' }])),
    };
    const connector = githubConnector({ entries, callTool: async (e) => byRepo[e.repo] });
    const tasks = await connector.pull();
    expect(connector.id).toBe('github');
    expect(tasks.map((t) => [t.id, t.streamId, t.sourceRef])).toEqual([
      ['github:o/a#1', 'work', 'https://github.com/o/a/issues/1'],
      ['github:o/b#9', 'personal', 'https://github.com/o/b/issues/9'],
    ]);
  });

  it('rejects the whole pull if any entry fails (never returns [])', async () => {
    const connector = githubConnector({
      entries,
      callTool: async (e) => {
        if (e.repo === 'o/b') throw new Error('network');
        return mcpResult(listIssues([]));
      },
    });
    await expect(connector.pull()).rejects.toThrow('network');
  });
});
