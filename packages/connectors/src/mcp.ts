import type { Task } from '@jarvis/core';
import type { Connector, ConnectorId } from './types';

/**
 * Extract and JSON-parse the payload of a standard MCP tool result
 * (`{ content: [{ type: 'text', text }], isError }`). Throws on an error
 * result or when there is no text content.
 */
export function parseMcpJson(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('MCP tool result is not an object');
  }
  const result = raw as { content?: unknown; isError?: unknown };
  if (result.isError === true) {
    throw new Error('MCP tool returned an error result');
  }
  const blocks: unknown[] = Array.isArray(result.content) ? result.content : [];
  let text: string | undefined;
  for (const block of blocks) {
    if (block !== null && typeof block === 'object') {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') {
        text = b.text;
        break;
      }
    }
  }
  if (text === undefined) {
    throw new Error('MCP tool result has no text content');
  }
  return JSON.parse(text);
}

export interface McpConnectorOptions {
  id: ConnectorId;
  /** Perform the MCP tool call and resolve its raw result. MUST reject on failure. */
  callTool: () => Promise<unknown>;
  /** Pure mapper from the raw tool result to tasks. */
  map: (raw: unknown) => Task[];
}

/**
 * A Connector backed by an MCP tool call. `callTool` is injected (wired to a
 * real MCP client in the app layer); `map` is a pure transform. Because
 * `pull` awaits `callTool` directly, a rejection propagates — it never
 * returns [] on failure, satisfying the connector failure contract.
 */
export function mcpConnector(options: McpConnectorOptions): Connector {
  return {
    id: options.id,
    pull: async () => options.map(await options.callTool()),
  };
}
