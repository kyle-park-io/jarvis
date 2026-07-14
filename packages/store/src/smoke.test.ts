import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { VERSION } from './index';

describe('@jarvis/store', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('can open an in-memory SQLite database (native module built)', () => {
    const db = new Database(':memory:');
    const row = db.prepare('SELECT 1 + 1 AS n').get() as { n: number };
    expect(row.n).toBe(2);
    db.close();
  });
});
