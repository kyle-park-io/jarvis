import type { Alert } from '@jarvis/core';

export function formatAlerts(alerts: Alert[]): string {
  if (alerts.length === 0) return 'No alerts.\n';
  return alerts.map((a) => `[${a.severity}] ${a.type}: ${a.message}`).join('\n') + '\n';
}
