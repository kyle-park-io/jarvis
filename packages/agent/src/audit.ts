export interface AuditEntry {
  time: string;
  ref: string;
  branch: string;
  prUrl: string;
  sessionId: string;
  numTurns: number;
  summary: string;
}

/** One tab-separated audit line (trailing newline), summary collapsed + truncated. */
export function auditLine(e: AuditEntry): string {
  const summary = e.summary.replace(/\s+/g, ' ').trim().slice(0, 200);
  return [e.time, e.ref, e.branch, e.prUrl, `session=${e.sessionId}`, `turns=${e.numTurns}`, summary].join('\t') + '\n';
}
