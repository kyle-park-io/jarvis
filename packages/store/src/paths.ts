import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveDataRoot(override?: string): string {
  return override ?? process.env.JARVIS_HOME ?? path.join(os.homedir(), 'jarvis');
}

export function ensureDataRoot(root: string): void {
  fs.mkdirSync(path.join(root, 'plans'), { recursive: true });
}
