import { describe, it, expect } from 'vitest';
import { githubIssuesToTasks, extractIssues, githubConnector, type GithubIssue } from './github';

describe('githubIssuesToTasks', () => {
  it('maps an open issue with a repo and url', () => {
    const issues: GithubIssue[] = [
      { number: 42, title: 'Fix bug', state: 'open', repository: 'kyle/repo', html_url: 'https://x/42' },
    ];
    expect(githubIssuesToTasks(issues, 'mantle')).toStrictEqual([
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
    expect(tasks[0]).toStrictEqual({
      id: 'github:#7',
      streamId: 's',
      title: 'Old',
      source: 'github',
      status: 'done',
      spentHours: 0,
    });
    expect(Object.keys(tasks[0] ?? {})).not.toContain('sourceRef');
  });
});

describe('extractIssues', () => {
  it('accepts a bare array of valid issues', () => {
    const issue = { number: 1, title: 'A', state: 'open' };
    expect(extractIssues([issue])).toEqual([issue]);
  });
  it('accepts { items } and { issues } wrappers', () => {
    const i2 = { number: 2, title: 'B', state: 'open' };
    const i3 = { number: 3, title: 'C', state: 'closed' };
    expect(extractIssues({ items: [i2] })).toEqual([i2]);
    expect(extractIssues({ issues: [i3] })).toEqual([i3]);
  });
  it('throws on an unexpected wrapper shape', () => {
    expect(() => extractIssues(null)).toThrow();
    expect(() => extractIssues('nope')).toThrow();
    expect(() => extractIssues({})).toThrow();
  });
  it('throws on a malformed element (null, or missing number/title)', () => {
    expect(() => extractIssues([null])).toThrow('Malformed');
    expect(() => extractIssues([{ title: 'no number', state: 'open' }])).toThrow('Malformed');
    expect(() => extractIssues([{ number: 1, state: 'open' }])).toThrow('Malformed');
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
