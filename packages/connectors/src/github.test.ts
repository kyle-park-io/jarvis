import { describe, it, expect } from 'vitest';
import { githubIssuesToTasks, extractIssues, githubConnector, type GithubIssue } from './github';

describe('githubIssuesToTasks', () => {
  it('maps an open issue with a repo and url', () => {
    const issues: GithubIssue[] = [
      { number: 42, title: 'Fix bug', state: 'open', repository: 'kyle/repo', html_url: 'https://x/42' },
    ];
    expect(githubIssuesToTasks(issues, 'mantle')).toEqual([
      {
        id: 'github:kyle/repo#42',
        streamId: 'mantle',
        title: 'Fix bug',
        source: 'github',
        status: 'todo',
        spentHours: 0,
        sourceRef: 'https://x/42',
      },
    ]);
  });

  it('maps a closed issue with no repo/url to a done task without sourceRef', () => {
    const tasks = githubIssuesToTasks([{ number: 7, title: 'Old', state: 'closed' }], 's');
    expect(tasks[0]).toEqual({
      id: 'github:#7',
      streamId: 's',
      title: 'Old',
      source: 'github',
      status: 'done',
      spentHours: 0,
    });
  });
});

describe('extractIssues', () => {
  it('accepts a bare array', () => {
    expect(extractIssues([{ number: 1 }])).toEqual([{ number: 1 }]);
  });
  it('accepts { items } and { issues } wrappers', () => {
    expect(extractIssues({ items: [{ number: 2 }] })).toEqual([{ number: 2 }]);
    expect(extractIssues({ issues: [{ number: 3 }] })).toEqual([{ number: 3 }]);
  });
  it('throws on an unexpected shape', () => {
    expect(() => extractIssues(null)).toThrow();
    expect(() => extractIssues('nope')).toThrow();
    expect(() => extractIssues({})).toThrow();
  });
});

describe('githubConnector', () => {
  it('pulls issues from an MCP-shaped tool result into tasks', async () => {
    const toolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify([{ number: 5, title: 'Review PR', state: 'open', repository: 'a/b' }]),
        },
      ],
    };
    const connector = githubConnector({ streamId: 'mantle', callTool: async () => toolResult });
    expect(connector.id).toBe('github');
    const tasks = await connector.pull();
    expect(tasks).toEqual([
      {
        id: 'github:a/b#5',
        streamId: 'mantle',
        title: 'Review PR',
        source: 'github',
        status: 'todo',
        spentHours: 0,
      },
    ]);
  });
});
