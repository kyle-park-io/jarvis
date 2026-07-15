import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { githubConnector, parseMcpJson } from '@jarvis/connectors';
import type { Connector, GithubRepoEntry } from '@jarvis/connectors';

const DEFAULT_URL = 'https://api.githubcopilot.com/mcp/';

/** Safety cap on pages fetched per repo (100/page → up to 1000 issues). */
const MAX_PAGES = 10;

/** Split "owner/name" into parts; throws on a malformed value. */
export function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo.split('/');
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || owner === '' || name === undefined || name === '') {
    throw new Error(`Invalid GitHub repo "${repo}" (expected "owner/name")`);
  }
  return { owner, repo: name };
}

/** Build the list_issues arguments for one entry (open issues, first page). */
export function buildListIssuesArgs(entry: GithubRepoEntry): Record<string, unknown> {
  const { owner, repo } = parseRepo(entry.repo);
  // Default to open issues: a closing issue simply stops being returned and is
  // then removed by source-authoritative reconciliation (rather than shown as done).
  return { owner, repo, state: entry.state ?? 'open', perPage: 100 };
}

/** One list_issues page: its raw issue objects and Relay cursor info. */
export function readPage(rawResult: unknown): { issues: unknown[]; hasNextPage: boolean; endCursor?: string } {
  const parsed = parseMcpJson(rawResult);
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as { issues?: unknown }).issues)) {
    throw new Error('Unexpected list_issues page shape (expected { issues: [...] })');
  }
  const obj = parsed as { issues: unknown[]; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
  const pageInfo = obj.pageInfo ?? {};
  const result: { issues: unknown[]; hasNextPage: boolean; endCursor?: string } = {
    issues: obj.issues,
    hasNextPage: pageInfo.hasNextPage === true,
  };
  if (typeof pageInfo.endCursor === 'string') result.endCursor = pageInfo.endCursor;
  return result;
}

/**
 * Walk list_issues' cursor pages via the injected `callPage`, concatenating
 * every page's issues, and return them as one synthesized MCP text tool-result
 * the connector can parse unchanged. Stops when the server reports no next page
 * or after `maxPages` (a safety bound against an unbounded/looping cursor).
 */
export async function paginateIssues(
  callPage: (after: string | undefined) => Promise<unknown>,
  maxPages: number = MAX_PAGES,
): Promise<unknown> {
  const all: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const { issues, hasNextPage, endCursor } = readPage(await callPage(after));
    all.push(...issues);
    if (!hasNextPage || endCursor === undefined) break;
    after = endCursor;
  }
  return { content: [{ type: 'text', text: JSON.stringify({ issues: all }) }] };
}

export interface GithubMcp {
  connector: Connector;
  close: () => Promise<void>;
}

/**
 * Build the live `github` connector backed by the remote GitHub MCP server.
 * Returns undefined when there is no token or no configured repos (fail-safe:
 * Jarvis runs folder-only). The MCP client connects lazily on the first pull,
 * so commands that never pull (help/log) touch no network.
 */
export function createGithubConnector(params: {
  token: string | undefined;
  entries: GithubRepoEntry[];
  url?: string;
}): GithubMcp | undefined {
  if (params.token === undefined || params.token === '' || params.entries.length === 0) {
    return undefined;
  }
  const url = params.url ?? DEFAULT_URL;
  const token = params.token;
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;

  const ensureClient = async (): Promise<Client> => {
    if (client) return client;
    if (!connecting) {
      connecting = (async () => {
        const c = new Client({ name: 'jarvis', version: '0.1.0' });
        const transport = new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        await c.connect(transport);
        client = c;
        return c;
      })();
    }
    return connecting;
  };

  const connector = githubConnector({
    entries: params.entries,
    callTool: async (entry) => {
      const c = await ensureClient();
      const args = buildListIssuesArgs(entry);
      return paginateIssues((after) =>
        c.callTool({ name: 'list_issues', arguments: after !== undefined ? { ...args, after } : args }),
      );
    },
  });

  return {
    connector,
    close: async () => {
      if (client) await client.close();
    },
  };
}
