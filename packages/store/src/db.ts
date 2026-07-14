import Database from 'better-sqlite3';
import path from 'node:path';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function openDb(dataRoot: string): DB {
  return openDatabase(path.join(dataRoot, 'jarvis.db'));
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      stream_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      estimate_hours REAL,
      deadline TEXT,
      status TEXT NOT NULL,
      spent_hours REAL NOT NULL DEFAULT 0,
      waiting_since TEXT
    );
    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      task_id TEXT,
      hours REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_time_logs_date ON time_logs(date);
  `);
}
