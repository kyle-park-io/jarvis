#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { toISODate, isExecutionAllowed } from '@jarvis/core';
import { resolveDataRoot, loadConfig, type GithubRepoConfig } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import type { Connector } from '@jarvis/connectors';
import { parseIssueRef, executeIssue } from '@jarvis/agent';
import { runCli } from './cli';
import { createGithubConnector } from './github-mcp';
import { createCalendarProvider } from './calendar-mcp';
import { runGoogleAuth } from './auth-command';

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
  let githubRepos: GithubRepoConfig[] = [];
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

  const calendar = createCalendarProvider({ dataRoot, env: process.env });

  // A calendar hiccup must never break the daily plan: fall back to 0 + warn.
  const committedHoursProvider = calendar
    ? async (date: string): Promise<number> => {
        try {
          return await calendar.committedHours(date);
        } catch (error) {
          process.stderr.write(
            `Calendar unavailable, assuming 0 committed hours: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          return 0;
        }
      }
    : undefined;

  try {
    return await runCli(process.argv.slice(2), {
      dataRoot,
      connectors,
      today: toISODate(new Date()),
      out: (text) => process.stdout.write(text),
      committedHoursProvider,
      runAuth: async (provider) =>
        provider === 'google'
          ? runGoogleAuth({ dataRoot, env: process.env, out: (t) => process.stdout.write(t) })
          : (process.stdout.write(`Unknown auth provider: ${provider}\n`), 1),
      runDo: async (ref) => {
        let parsed;
        try {
          parsed = parseIssueRef(ref);
        } catch (error) {
          process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
          return 1;
        }
        const slug = `${parsed.owner}/${parsed.repo}`;

        // A missing/unreadable config must not crash `do`; fall back to an
        // empty allowlist so an unconfigured repo is refused, fail-safe.
        let allowed: string[] = [];
        try {
          allowed = loadConfig(dataRoot).execution?.repos ?? [];
        } catch {
          allowed = [];
        }
        if (!isExecutionAllowed(slug, allowed)) {
          process.stdout.write(`Execution not allowed for ${slug}. Add it to config.yaml under execution.repos.\n`);
          return 1;
        }

        // Fetch the issue via gh (execution subsystem is CLI-driven).
        const view = spawnSync(
          'gh',
          ['issue', 'view', String(parsed.number), '--repo', slug, '--json', 'title,body'],
          { encoding: 'utf8' },
        );
        if (view.status !== 0) {
          process.stdout.write(`Could not read ${slug}#${parsed.number}: ${(view.stderr || '').trim()}\n`);
          return 1;
        }
        const issue = JSON.parse(view.stdout) as { title: string; body: string | null };

        process.stdout.write(`Working on ${slug}#${parsed.number} (isolated clone + local claude)...\n`);
        const result = await executeIssue({
          owner: parsed.owner,
          repo: parsed.repo,
          number: parsed.number,
          title: issue.title,
          body: issue.body ?? '',
          workRoot: path.join(dataRoot, 'work'),
          auditPath: path.join(dataRoot, 'audit.log'),
        });
        if (!result.changed) {
          process.stdout.write(`Agent made no changes: ${result.resultSummary}\n`);
          return 0;
        }
        process.stdout.write(`Draft PR: ${result.prUrl}\n`);
        return 0;
      },
    });
  } finally {
    if (github) {
      try {
        await github.close();
      } catch {
        // Closing the MCP client must never mask the command's own result.
      }
    }
    if (calendar) {
      try {
        await calendar.close();
      } catch {
        // Closing the MCP client must never mask the command's own result.
      }
    }
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
