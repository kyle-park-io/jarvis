import type { Task } from '@jarvis/core';
import type { Connector, ConnectorId } from './types';

interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

/**
 * Extract and JSON-parse the payload of a standard MCP tool result
 * (`{ content: [{ type: 'text', text }], isError }`). Throws on an error
 * result or when there is no text content.
 */
export function parseMcpJson(raw: unknown): unknown {
  const result = raw as McpToolResult;
  if (result.isError === true) {
    throw new Error('MCP tool returned an error result');
  }
  const text = result.content?.find((block) => block.type === 'text')?.text;
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
