import fs from 'node:fs';
import path from 'node:path';
import type { Allocation, Alert } from '@jarvis/core';

export function renderPlan(
  allocation: Allocation,
  alerts: Alert[],
  streamNames: Record<string, string>,
): string {
  const out: string[] = [];
  out.push(`# Plan — ${allocation.date}`);
  out.push('');
  out.push(`Capacity: ${allocation.capacityHours}h${allocation.overcommitted ? ' (overcommitted)' : ''}`);
  out.push('');
  for (const line of allocation.lines) {
    out.push(`## ${streamNames[line.streamId] ?? line.streamId} — ${line.targetHours}h`);
    for (const t of line.tasks) {
      out.push(`- [ ] ${t.title}`);
    }
    out.push('');
  }
  if (alerts.length > 0) {
    out.push('## Alerts');
    for (const a of alerts) {
      out.push(`- **${a.severity}** (${a.type}): ${a.message}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function writePlan(
  dataRoot: string,
  allocation: Allocation,
  alerts: Alert[],
  streamNames: Record<string, string>,
): string {
  const file = path.join(dataRoot, 'plans', `${allocation.date}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderPlan(allocation, alerts, streamNames), 'utf8');
  return file;
}
