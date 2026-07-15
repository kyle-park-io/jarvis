/** Whether Jarvis may execute against `repo` ("owner/name"), i.e. it is on the allowlist. */
export function isExecutionAllowed(repo: string, allowedRepos: readonly string[]): boolean {
  return allowedRepos.includes(repo);
}
