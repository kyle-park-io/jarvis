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
  type GithubConnectorOptions,
} from './github';
