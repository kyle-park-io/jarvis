import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runDailyPlan } from '@jarvis/scheduler';
import type { Connector } from '@jarvis/connectors';
import { formatAlerts } from './render';

export interface CliDeps {
  dataRoot: string;
  connectors: Connector[];
  today: string;
  out: (text: string) => void;
}

const HELP = `jarvis — personal task planner

Usage:
  jarvis today             Show today's plan
  jarvis plan [--date=D]   Show the plan for a date (default: today)
  jarvis alerts            Show today's alerts
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
      const result = await runDailyPlan({ dataRoot: deps.dataRoot, connectors: deps.connectors, date: deps.today });
      deps.out(formatAlerts(result.alerts));
      return 0;
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
  const result = await runDailyPlan({ dataRoot: deps.dataRoot, connectors: deps.connectors, date });
  deps.out(fs.readFileSync(result.planPath, 'utf8'));
  return 0;
}
