import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { mcpConnector, parseMcpJson } from './mcp';

export interface GithubIssue {
  number: number;
  title: string;
  state: string;
  repository?: string;
  html_url?: string;
}

export function githubIssuesToTasks(issues: GithubIssue[], streamId: string): Task[] {
  return issues.map((issue) => {
    const ref = issue.repository !== undefined ? `${issue.repository}#${issue.number}` : `#${issue.number}`;
    const task: Task = {
      id: `github:${ref}`,
      streamId,
      title: issue.title,
      source: 'github',
      status: issue.state === 'closed' ? 'done' : 'todo',
      spentHours: 0,
    };
    if (issue.html_url !== undefined) task.sourceRef = issue.html_url;
    return task;
  });
}

export function extractIssues(parsed: unknown): GithubIssue[] {
  if (Array.isArray(parsed)) return parsed as GithubIssue[];
  if (parsed !== null && typeof parsed === 'object') {
    const wrapped = parsed as { items?: unknown; issues?: unknown };
    if (Array.isArray(wrapped.items)) return wrapped.items as GithubIssue[];
    if (Array.isArray(wrapped.issues)) return wrapped.issues as GithubIssue[];
  }
  throw new Error('Unexpected GitHub MCP result shape (expected an array, or { items } / { issues })');
}

export interface GithubConnectorOptions {
  /** The stream all pulled GitHub tasks belong to. */
  streamId: string;
  /**
   * Calls the GitHub MCP server's issue-listing tool and resolves its raw
   * result. In the app layer this is wired to a real MCP client, e.g.
   * (pseudo): a `@modelcontextprotocol/sdk` Client over a StdioClient
   * transport spawning the GitHub MCP server with a GITHUB_TOKEN, calling
   * `client.callTool({ name: 'list_issues', arguments: {...} })`.
   */
  callTool: () => Promise<unknown>;
}

export function githubConnector(options: GithubConnectorOptions): Connector {
  return mcpConnector({
    id: 'github',
    callTool: options.callTool,
    map: (raw) => githubIssuesToTasks(extractIssues(parseMcpJson(raw)), options.streamId),
  });
}
