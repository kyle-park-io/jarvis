import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

  it('is idempotent — reopening an existing database re-runs migrate without throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-db-'));
    try {
      openDatabase(path.join(dir, 'jarvis.db')).close();
      const db = openDatabase(path.join(dir, 'jarvis.db')); // migrate runs again on existing tables
      expect(() => db.exec('SELECT 1')).not.toThrow();
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a task row with a NULL id', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db.prepare('INSERT INTO tasks (id, stream_id, title, source, status) VALUES (?, ?, ?, ?, ?)').run(
        null,
        's1',
        'x',
        'manual',
        'todo',
      ),
    ).toThrow();
    db.close();
  });
});
