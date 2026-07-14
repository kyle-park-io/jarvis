import { describe, it, expect } from 'vitest';
import { formatAlerts } from './render';
import type { Alert } from '@jarvis/core';

describe('formatAlerts', () => {
  it('renders a friendly line when there are no alerts', () => {
    expect(formatAlerts([])).toBe('No alerts.\n');
  });

  it('renders one line per alert as [severity] type: message', () => {
    const alerts: Alert[] = [
      { type: 'falling_behind', severity: 'warn', streamId: 's1', message: 'Work is behind pace.' },
      { type: 'deadline_risk', severity: 'critical', taskId: 't1', message: '"Ship" is due in 1d.' },
    ];
    expect(formatAlerts(alerts)).toBe(
      '[warn] falling_behind: Work is behind pace.\n[critical] deadline_risk: "Ship" is due in 1d.\n',
    );
  });
});
