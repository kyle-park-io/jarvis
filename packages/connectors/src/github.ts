import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { parseMcpJson } from './mcp';

/** One issue as returned in a list_issues GraphQL `nodes` array. */
export interface GithubIssue {
  number: number;
  title: string;
  /** GraphQL IssueState — 'OPEN' | 'CLOSED' (uppercase); compared case-insensitively. */
  state: string;
  /** Web URL of the issue (GraphQL `url`). */
  url?: string;
  /** "owner/name" — the server does not include it per-issue; the connector injects it. */
  repository?: string;
}

export function githubIssuesToTasks(issues: GithubIssue[], streamId: string): Task[] {
  return issues.map((issue) => {
    const ref = issue.repository !== undefined ? `${issue.repository}#${issue.number}` : `#${issue.number}`;
    const task: Task = {
      id: `github:${ref}`,
      streamId,
      title: issue.title,
      source: 'github',
      status: issue.state.toUpperCase() === 'CLOSED' ? 'done' : 'todo',
      spentHours: 0,
    };
    if (issue.url !== undefined) task.sourceRef = issue.url;
    return task;
  });
}

function toGithubIssue(raw: unknown): GithubIssue {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`Malformed GitHub issue (not an object): ${JSON.stringify(raw)}`);
  }
  const issue = raw as { number?: unknown; title?: unknown; state?: unknown; url?: unknown };
  if (typeof issue.number !== 'number' || typeof issue.title !== 'string' || typeof issue.state !== 'string') {
    throw new Error(`Malformed GitHub issue (missing number/title/state): ${JSON.stringify(raw)}`);
  }
  const result: GithubIssue = { number: issue.number, title: issue.title, state: issue.state };
  if (typeof issue.url === 'string') result.url = issue.url;
  return result;
}

/**
 * Extract the issue nodes from a list_issues result. The GitHub MCP server
 * returns `{ repository: { issues: { nodes: [...] } } }` (GraphQL-shaped). A
 * bare array or `{ nodes }` / `{ issues: [...] }` is accepted as a fallback.
 */
export function extractIssues(parsed: unknown): GithubIssue[] {
  return findIssueNodes(parsed).map(toGithubIssue);
}

function findIssueNodes(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as { repository?: unknown; issues?: unknown; nodes?: unknown };
    if (obj.repository !== null && typeof obj.repository === 'object') {
      const repo = obj.repository as { issues?: unknown };
      if (repo.issues !== null && typeof repo.issues === 'object') {
        const issues = repo.issues as { nodes?: unknown };
        if (Array.isArray(issues.nodes)) return issues.nodes;
      }
    }
    if (Array.isArray(obj.nodes)) return obj.nodes;
    if (Array.isArray(obj.issues)) return obj.issues;
  }
  throw new Error('Unexpected GitHub MCP result shape (expected { repository: { issues: { nodes } } } or an array)');
}

export interface GithubRepoEntry {
  /** "owner/name" — disambiguates task ids and (in the app layer) selects the repo to query. */
  repo: string;
  /** The stream all issues from this repo belong to. */
  streamId: string;
  /** Issue-state filter passed to the app-layer callTool (default handled there). */
  state?: string;
}

export interface GithubConnectorOptions {
  entries: GithubRepoEntry[];
  /**
   * Calls the GitHub MCP server's `list_issues` for one entry and resolves the
   * raw MCP tool-result. Wired to a real MCP client in the app layer. MUST
   * reject on failure (auth/network) — never resolve empty on error.
   */
  callTool: (entry: GithubRepoEntry) => Promise<unknown>;
}

/**
 * One aggregating `github` Connector. Reconciliation is source-authoritative
 * per source, so ALL github tasks must come from a single connector: this loops
 * every configured repo→stream entry, tags each repo's issues with that repo
 * (for stable `github:owner/name#N` ids), maps them into the entry's stream, and
 * concatenates. Any entry's rejection rejects the whole pull (never returns []).
 */
export function githubConnector(options: GithubConnectorOptions): Connector {
  return {
    id: 'github',
    pull: async () => {
      const tasks: Task[] = [];
      for (const entry of options.entries) {
        const parsed = parseMcpJson(await options.callTool(entry));
        const issues = extractIssues(parsed).map((issue) => ({
          ...issue,
          repository: issue.repository ?? entry.repo,
        }));
        tasks.push(...githubIssuesToTasks(issues, entry.streamId));
      }
      return tasks;
    },
  };
}
