export const VERSION = '0.1.0';

export type { Connector, ConnectorId } from './types';
export { parseStreamLine, parseStreamFile } from './parse';
export { folderConnector, pullFolderTasks } from './folder';
export { parseMcpJson, mcpConnector, type McpConnectorOptions } from './mcp';
export {
  githubConnector,
  githubIssuesToTasks,
  extractIssues,
  type GithubIssue,
  type GithubRepoEntry,
  type GithubConnectorOptions,
} from './github';
export {
  gmailConnector,
  gmailThreadsToTasks,
  extractThreads,
  type GmailThread,
  type GmailConnectorOptions,
} from './gmail';
export {
  calendarCommittedHours,
  eventsToCommittedHours,
  extractEvents,
  type EventDateTime,
  type CalendarEvent,
  type CalendarCommittedHoursOptions,
} from './calendar';
