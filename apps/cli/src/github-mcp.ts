import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { githubConnector } from '@jarvis/connectors';
import type { Connector, GithubRepoEntry } from '@jarvis/connectors';

const DEFAULT_URL = 'https://api.githubcopilot.com/mcp/';

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
  return { owner, repo, state: entry.state ?? 'open', perPage: 100 };
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
      return c.callTool({ name: 'list_issues', arguments: buildListIssuesArgs(entry) });
    },
  });

  return {
    connector,
    close: async () => {
      if (client) await client.close();
    },
  };
}
