import { describe, it, expect } from 'vitest';
import { VERSION, gmailConnector, calendarCommittedHours, eventsToCommittedHours } from './index';

describe('@jarvis/connectors', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('re-exports the Gmail and Calendar entry points', () => {
    expect(typeof gmailConnector).toBe('function');
    expect(typeof calendarCommittedHours).toBe('function');
    expect(eventsToCommittedHours([], '2026-07-14')).toBe(0);
  });
});
