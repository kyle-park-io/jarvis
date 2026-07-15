#!/usr/bin/env node
import path from 'node:path';
import { toISODate } from '@jarvis/core';
import { resolveDataRoot, loadConfig } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import type { Connector } from '@jarvis/connectors';
import { runCli } from './cli';
import { createGithubConnector } from './github-mcp';

const dataRoot = resolveDataRoot();

// Load secrets from `<dataRoot>/.env` if present (Node 22+ native, no
// dependency). Secrets live next to the data (config.yaml, tasks.db), outside
// this code repo, so the path is identical in dev and when installed globally.
// Optional — values can also come straight from the process environment.
// (JARVIS_HOME itself must be an exported env var, since it locates this file.)
try {
  process.loadEnvFile(path.join(dataRoot, '.env'));
} catch {
  // No .env in the data directory — that's fine.
}

async function main(): Promise<number> {
  const connectors: Connector[] = [folderConnector(path.join(dataRoot, 'streams'))];

  // Register the live GitHub connector only when config + token are present.
  // A missing/unreadable config must not break commands like `help`/`log`, so
  // load defensively here; `plan`/`alerts` re-load and surface real errors.
  let githubRepos: { repo: string; stream: string; state?: string }[] = [];
  try {
    githubRepos = loadConfig(dataRoot).github?.repos ?? [];
  } catch {
    githubRepos = [];
  }
  const github = createGithubConnector({
    token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
    entries: githubRepos.map((r) => ({ repo: r.repo, streamId: r.stream, state: r.state })),
  });
  if (github) connectors.push(github.connector);

  try {
    return await runCli(process.argv.slice(2), {
      dataRoot,
      connectors,
      today: toISODate(new Date()),
      out: (text) => process.stdout.write(text),
    });
  } finally {
    if (github) await github.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
