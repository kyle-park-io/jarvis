export interface IssuePrompt {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
}

/** The task prompt handed to the local `claude` CLI, in the repo worktree. */
export function buildTaskPrompt(issue: IssuePrompt): string {
  return [
    `You are working in a clone of ${issue.owner}/${issue.repo} to address issue #${issue.number}.`,
    '',
    `Title: ${issue.title}`,
    '',
    'Body:',
    issue.body.trim() === '' ? '(no description)' : issue.body,
    '',
    'Make the smallest code change that addresses this issue. Follow the existing code style.',
    'Do NOT commit, push, or open a pull request — that is handled for you afterward.',
    'When done, briefly summarize what you changed.',
  ].join('\n');
}
