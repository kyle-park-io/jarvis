import { describe, it, expect } from 'vitest';
import { githubIssuesToTasks, extractIssues, githubConnector, type GithubRepoEntry } from './github';

/** Wrap a JSON value as a standard MCP text tool-result. */
function mcpResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** A list_issues payload with the given nodes. */
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

  it('treats state case-insensitively and omits sourceRef when there is no url', () => {
    const [task] = githubIssuesToTasks([{ number: 1, title: 'x', state: 'closed', repository: 'o/r' }], 's');
    expect(task?.status).toBe('done');
    expect(task && 'sourceRef' in task).toBe(false);
  });

  it('falls back to a bare #number id when repository is absent', () => {
    const [task] = githubIssuesToTasks([{ number: 5, title: 'x', state: 'OPEN' }], 's');
    expect(task?.id).toBe('github:#5');
  });
});

describe('extractIssues', () => {
  it('digs nodes out of { repository: { issues: { nodes } } }', () => {
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

  it('pulls every entry, tags ids with the entry repo, and concatenates', async () => {
    const byRepo: Record<string, unknown> = {
      'o/a': mcpResult(listIssues([{ number: 1, title: 'A1', state: 'OPEN', url: 'ua1' }])),
      'o/b': mcpResult(listIssues([{ number: 9, title: 'B9', state: 'OPEN', url: 'ub9' }])),
    };
    const connector = githubConnector({ entries, callTool: async (e) => byRepo[e.repo] });
    const tasks = await connector.pull();
    expect(connector.id).toBe('github');
    expect(tasks.map((t) => [t.id, t.streamId])).toEqual([
      ['github:o/a#1', 'work'],
      ['github:o/b#9', 'personal'],
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
