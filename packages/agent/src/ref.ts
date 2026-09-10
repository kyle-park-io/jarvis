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

/**
 * Subject for the draft PR and the commit behind it.
 *
 * Deliberately carries no issue title. Where the target repo squash-merges, this string becomes a
 * commit subject on its main, and the issue title is text nobody on this side wrote -- in a
 * language, length and character set this side does not control. The title goes in the PR body,
 * which is not load-bearing that way. A reviewer who wants a better subject edits it before
 * merging, which is the approval gate anyway.
 */
export function issuePrTitle(n: number): string {
  return `chore(jarvis): draft for #${n}`;
}
