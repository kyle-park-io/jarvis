import type { Task } from '@jarvis/core';

export type ConnectorId = 'folder' | 'calendar' | 'gmail' | 'github';

/**
 * A source of tasks. `folder` reads local files; later connectors
 * (calendar/gmail/github) will be backed by MCP servers — same contract.
 */
export interface Connector {
  id: ConnectorId;
  /** Read the current set of tasks from this source. */
  pull(): Promise<Task[]>;
}
