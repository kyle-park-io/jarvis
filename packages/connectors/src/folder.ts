import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { parseStreamFile } from './parse';

export function pullFolderTasks(streamsDir: string): Task[] {
  if (!fs.existsSync(streamsDir)) return [];
  const tasks: Task[] = [];
  for (const entry of fs.readdirSync(streamsDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const streamId = entry.slice(0, -3);
    const content = fs.readFileSync(path.join(streamsDir, entry), 'utf8');
    tasks.push(...parseStreamFile(streamId, content));
  }
  return tasks;
}

export function folderConnector(streamsDir: string): Connector {
  return {
    id: 'folder',
    pull: async () => pullFolderTasks(streamsDir),
  };
}
