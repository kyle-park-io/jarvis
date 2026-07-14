import { describe, it, expect } from 'vitest';
import { parseMcpJson, mcpConnector } from './mcp';
import type { Task } from '@jarvis/core';

describe('parseMcpJson', () => {
  it('parses the JSON in the first text content block', () => {
    const raw = { content: [{ type: 'text', text: '[{"n":1}]' }] };
    expect(parseMcpJson(raw)).toEqual([{ n: 1 }]);
  });

  it('throws when the result is flagged as an error', () => {
    const raw = { isError: true, content: [{ type: 'text', text: 'boom' }] };
    expect(() => parseMcpJson(raw)).toThrow();
  });

  it('throws when there is no text content', () => {
    expect(() => parseMcpJson({ content: [{ type: 'image' }] })).toThrow();
    expect(() => parseMcpJson({})).toThrow();
  });
});

describe('mcpConnector', () => {
  it('maps the raw result of callTool into tasks', async () => {
    const task: Task = { id: 't', streamId: 's', title: 'T', source: 'github', status: 'todo', spentHours: 0 };
    const connector = mcpConnector({
      id: 'github',
      callTool: async () => ({ raw: true }),
      map: (raw) => {
        expect(raw).toEqual({ raw: true });
        return [task];
      },
    });
    expect(connector.id).toBe('github');
    expect(await connector.pull()).toEqual([task]);
  });

  it('propagates a callTool rejection (never returns [] on failure)', async () => {
    const connector = mcpConnector({
      id: 'github',
      callTool: async () => {
        throw new Error('auth failed');
      },
      map: () => [],
    });
    await expect(connector.pull()).rejects.toThrow('auth failed');
  });
});
