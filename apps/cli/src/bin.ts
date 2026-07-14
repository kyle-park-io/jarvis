#!/usr/bin/env node
import path from 'node:path';
import { toISODate } from '@jarvis/core';
import { resolveDataRoot } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import { runCli } from './cli';

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

runCli(process.argv.slice(2), {
  dataRoot,
  connectors: [folderConnector(path.join(dataRoot, 'streams'))],
  today: toISODate(new Date()),
  out: (text) => process.stdout.write(text),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
