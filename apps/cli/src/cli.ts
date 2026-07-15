import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runDailyPlan } from '@jarvis/scheduler';
import type { Connector } from '@jarvis/connectors';
import { openDb, addTimeLog } from '@jarvis/store';
import { formatAlerts } from './render';

export interface CliDeps {
  dataRoot: string;
  connectors: Connector[];
  today: string;
  out: (text: string) => void;
  committedHoursProvider?: (date: string) => Promise<number>;
  runAuth?: (provider: string) => Promise<number>;
}

const HELP = `jarvis — personal task planner

Usage:
  jarvis today             Show today's plan
  jarvis plan [--date=D]   Show the plan for a date (default: today)
  jarvis alerts            Show today's alerts
  jarvis log <stream> <hours> [--date=D]   Log hours worked on a stream
  jarvis auth google       Authorize Google (Calendar) once
  jarvis help              Show this help
`;

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const command = argv[0];
  switch (command) {
    case 'today':
      return showPlan(deps, deps.today);
    case 'plan': {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { date: { type: 'string' } },
        allowPositionals: true,
      });
      return showPlan(deps, values.date ?? deps.today);
    }
    case 'alerts': {
      const committedHoursToday = deps.committedHoursProvider
        ? await deps.committedHoursProvider(deps.today)
        : undefined;
      const result = await runDailyPlan({
        dataRoot: deps.dataRoot,
        connectors: deps.connectors,
        date: deps.today,
        committedHoursToday,
      });
      deps.out(formatAlerts(result.alerts));
      return 0;
    }
    case 'log': {
      const { values, positionals } = parseArgs({
        args: argv.slice(1),
        options: { date: { type: 'string' } },
        allowPositionals: true,
      });
      const streamId = positionals[0];
      const hoursArg = positionals[1];
      if (streamId === undefined || hoursArg === undefined) {
        deps.out('Usage: jarvis log <stream> <hours> [--date=YYYY-MM-DD]\n');
        return 1;
      }
      const hours = Number(hoursArg);
      if (!Number.isFinite(hours) || hours <= 0) {
        deps.out(`Invalid hours: ${hoursArg}\n`);
        return 1;
      }
      const date = values.date ?? deps.today;
      const db = openDb(deps.dataRoot);
      try {
        addTimeLog(db, { date, streamId, hours });
      } finally {
        db.close();
      }
      deps.out(`Logged ${hours}h to ${streamId} on ${date}.\n`);
      return 0;
    }
    case 'auth': {
      const provider = argv[1];
      if (provider === undefined || deps.runAuth === undefined) {
        deps.out('Usage: jarvis auth google\n');
        return 1;
      }
      return deps.runAuth(provider);
    }
    case undefined:
    case 'help':
      deps.out(HELP);
      return 0;
    default:
      deps.out(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

async function showPlan(deps: CliDeps, date: string): Promise<number> {
  const committedHoursToday = deps.committedHoursProvider ? await deps.committedHoursProvider(date) : undefined;
  const result = await runDailyPlan({
    dataRoot: deps.dataRoot,
    connectors: deps.connectors,
    date,
    committedHoursToday,
  });
  deps.out(fs.readFileSync(result.planPath, 'utf8'));
  return 0;
}
