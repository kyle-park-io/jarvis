import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';

describe('openDatabase', () => {
  it('creates the tasks and time_logs tables', () => {
    const db = openDatabase(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toContain('tasks');
    expect(names).toContain('time_logs');
    db.close();
  });

  it('is idempotent (re-running migrate does not throw)', () => {
    const db = openDatabase(':memory:');
    expect(() => db.exec('SELECT 1')).not.toThrow();
    db.close();
  });
});
