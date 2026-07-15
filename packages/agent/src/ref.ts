export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse "owner/repo#number"; throws on a malformed ref. */
export function parseIssueRef(ref: string): IssueRef {
  const match = /^([^/]+)\/([^#/]+)#(\d+)$/.exec(ref.trim());
  if (match === null) {
    throw new Error(`Invalid issue reference "${ref}" (expected "owner/repo#number")`);
  }
  const [, owner, repo, num] = match;
  if (owner === undefined || repo === undefined || num === undefined) {
    throw new Error(`Invalid issue reference "${ref}" (expected "owner/repo#number")`);
  }
  return { owner, repo, number: Number(num) };
}

export function issueBranchName(n: number): string {
  return `jarvis/issue-${n}`;
}
