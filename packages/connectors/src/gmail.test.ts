import { describe, it, expect } from 'vitest';
import { gmailThreadsToTasks, extractThreads, gmailConnector } from './gmail';

describe('gmailThreadsToTasks', () => {
  it('maps a thread to a gmail task (subject → title, id → gmail:<id>, sourceRef, waitingSince, todo)', () => {
    const tasks = gmailThreadsToTasks(
      [{ id: 't1', subject: 'Reply to Alpha', lastMessageDate: '2026-07-10' }],
      'work',
    );
    expect(tasks).toStrictEqual([
      {
        id: 'gmail:t1',
        streamId: 'work',
        title: 'Reply to Alpha',
        source: 'gmail',
        sourceRef: 't1',
        status: 'todo',
        spentHours: 0,
        waitingSince: '2026-07-10',
      },
    ]);
  });

  it('falls back subject → snippet → placeholder, and omits waitingSince when absent', () => {
    expect(gmailThreadsToTasks([{ id: 'a', snippet: 'hi there' }], 'work')[0]).toStrictEqual({
      id: 'gmail:a',
      streamId: 'work',
      title: 'hi there',
      source: 'gmail',
      sourceRef: 'a',
      status: 'todo',
      spentHours: 0,
    });
    expect(gmailThreadsToTasks([{ id: 'b' }], 'work')[0]?.title).toBe('(no subject)');
  });
});

describe('extractThreads', () => {
  it('accepts a bare array and a { threads } wrapper', () => {
    expect(extractThreads([{ id: 'x', subject: 'S' }])).toStrictEqual([{ id: 'x', subject: 'S' }]);
    expect(extractThreads({ threads: [{ id: 'y' }] })).toStrictEqual([{ id: 'y' }]);
  });

  it('throws on an unexpected shape', () => {
    expect(() => extractThreads({ nope: 1 })).toThrow(/Unexpected Gmail MCP result shape/);
    expect(() => extractThreads(42)).toThrow(/Unexpected Gmail MCP result shape/);
  });

  it('throws on a malformed thread element (not an object / missing id)', () => {
    expect(() => extractThreads([null])).toThrow(/Malformed Gmail thread \(not an object\)/);
    expect(() => extractThreads([{ subject: 'no id' }])).toThrow(/Malformed Gmail thread \(missing id\)/);
  });
});

describe('gmailConnector', () => {
  it('id is gmail and pull maps a standard MCP result to tasks', async () => {
    const connector = gmailConnector({
      streamId: 'work',
      callTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ threads: [{ id: 't9', subject: 'Ping' }] }) }],
      }),
    });
    expect(connector.id).toBe('gmail');
    expect(await connector.pull()).toStrictEqual([
      { id: 'gmail:t9', streamId: 'work', title: 'Ping', source: 'gmail', sourceRef: 't9', status: 'todo', spentHours: 0 },
    ]);
  });

  it('pull rejects (never returns []) when the MCP call fails', async () => {
    const connector = gmailConnector({
      streamId: 'work',
      callTool: async () => {
        throw new Error('network down');
      },
    });
    await expect(connector.pull()).rejects.toThrow('network down');
  });

  it('pull rejects on an MCP error result', async () => {
    const connector = gmailConnector({
      streamId: 'work',
      callTool: async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
    });
    await expect(connector.pull()).rejects.toThrow(/MCP tool returned an error result/);
  });
});
