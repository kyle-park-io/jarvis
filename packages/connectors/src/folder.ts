import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { parseStreamFile } from './parse';

export function pullFolderTasks(streamsDir: string): Task[] {
  if (!fs.existsSync(streamsDir)) return [];
  const tasks: Task[] = [];
  for (const entry of fs.readdirSync(streamsDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.length <= 3) continue;
    const streamId = entry.name.slice(0, -3);
    const content = fs.readFileSync(path.join(streamsDir, entry.name), 'utf8');
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
