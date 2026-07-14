import type { Task } from '@jarvis/core';

export type ConnectorId = 'folder' | 'calendar' | 'gmail' | 'github';

/**
 * A source of tasks. `folder` reads local files; later connectors
 * (calendar/gmail/github) will be backed by MCP servers — same contract.
 */
export interface Connector {
  id: ConnectorId;
  /**
   * Read the current set of tasks from this source. It MUST throw on failure
   * (auth / network / read errors). An empty array means the source genuinely
   * has zero tasks — reconciliation (syncSourceTasks) will then DELETE all
   * previously-synced tasks of this source, so never return [] on a failed fetch.
   */
  pull(): Promise<Task[]>;
}
