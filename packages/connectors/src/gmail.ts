import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { mcpConnector, parseMcpJson } from './mcp';

export interface GmailThread {
  id: string;
  subject?: string;
  snippet?: string;
  /** ISO date of the last message — when set, becomes the task's waitingSince. */
  lastMessageDate?: string;
}

export function gmailThreadsToTasks(threads: GmailThread[], streamId: string): Task[] {
  return threads.map((thread) => {
    const title = thread.subject ?? thread.snippet ?? '(no subject)';
    const task: Task = {
      id: `gmail:${thread.id}`,
      streamId,
      title,
      source: 'gmail',
      sourceRef: thread.id,
      status: 'todo',
      spentHours: 0,
    };
    if (thread.lastMessageDate !== undefined) task.waitingSince = thread.lastMessageDate;
    return task;
  });
}

function toGmailThread(raw: unknown): GmailThread {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`Malformed Gmail thread (not an object): ${JSON.stringify(raw)}`);
  }
  const thread = raw as { id?: unknown; subject?: unknown; snippet?: unknown; lastMessageDate?: unknown };
  if (typeof thread.id !== 'string') {
    throw new Error(`Malformed Gmail thread (missing id): ${JSON.stringify(raw)}`);
  }
  const result: GmailThread = { id: thread.id };
  if (typeof thread.subject === 'string') result.subject = thread.subject;
  if (typeof thread.snippet === 'string') result.snippet = thread.snippet;
  if (typeof thread.lastMessageDate === 'string') result.lastMessageDate = thread.lastMessageDate;
  return result;
}

export function extractThreads(parsed: unknown): GmailThread[] {
  let rawArray: unknown[];
  if (Array.isArray(parsed)) {
    rawArray = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    const wrapped = parsed as { threads?: unknown };
    if (Array.isArray(wrapped.threads)) {
      rawArray = wrapped.threads;
    } else {
      throw new Error('Unexpected Gmail MCP result shape (expected an array or { threads })');
    }
  } else {
    throw new Error('Unexpected Gmail MCP result shape (expected an array or { threads })');
  }
  return rawArray.map(toGmailThread);
}

export interface GmailConnectorOptions {
  /** The stream all pulled Gmail tasks belong to. */
  streamId: string;
  /**
   * Calls the Gmail MCP server's thread-listing tool (e.g. `search_threads`
   * with a query like `is:unread -in:draft`) and resolves its raw result.
   * Wired to a real MCP client in the app layer. MUST reject on failure.
   */
  callTool: () => Promise<unknown>;
}

export function gmailConnector(options: GmailConnectorOptions): Connector {
  return mcpConnector({
    id: 'gmail',
    callTool: options.callTool,
    map: (raw) => gmailThreadsToTasks(extractThreads(parseMcpJson(raw)), options.streamId),
  });
}
