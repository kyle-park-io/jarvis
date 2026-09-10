// Guards the one piece of text on a pull request that nothing else checks.
//
// This repo squash-merges with squash_merge_commit_title=COMMIT_OR_PR_TITLE, so for a PR carrying
// more than one commit the *pull request title* becomes the commit subject on main. Branch commits
// are reviewed; the title is reviewed by nothing.
//
// The title arrives through PR_TITLE and is never interpolated into a shell command -- a title
// holding a backtick or $(...) would otherwise run on the runner. See .github/workflows/ci.yml.

const TYPES = [
  'build', 'chore', 'ci', 'docs', 'feat',
  'fix', 'perf', 'refactor', 'revert', 'style', 'test',
];

const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9._/-]+\\))?!?: \\S`);

// Hangul, kana and CJK ideographs -- deliberately not "non-ASCII". This repo's own subjects use
// em dashes and arrows (feat: Phase 2 execution — jarvis do → draft PR), and those read fine in
// an English history; a Korean subject sitting among English ones does not.
const CJK = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿㐀-䶿]/;

/**
 * @param {string} title
 * @returns {string | null} why the title is unusable as a commit subject, or null if it is fine.
 */
export function checkPrTitle(title) {
  const t = title.trim();
  if (t === '') return 'the title is empty';
  if (CJK.test(t)) return 'the title contains Korean/CJK text (commit subjects are English)';
  if (!CONVENTIONAL.test(t)) {
    return `the title is not a Conventional Commits subject (expected "<type>[(scope)]: <subject>", type one of ${TYPES.join(', ')})`;
  }
  return null;
}

// The rule is a regex nobody reads again, and a broken one fails open -- it would pass everything
// and look healthy. These run on every invocation so that cannot happen quietly.
const FIXTURES = [
  ['feat: Phase 2 execution — jarvis do → draft PR (local claude)', true],
  ['chore(release): v0.2.0', true],
  ['fix(cli)!: drop the positional argument', true],
  ['chore(jarvis): draft for #12', true],
  ['Phase 2 실행 경로 정리', false],
  ['update the readme', false],
  ['feat:no space after the colon', false],
  ['', false],
];

for (const [title, shouldPass] of FIXTURES) {
  if ((checkPrTitle(title) === null) !== shouldPass) {
    console.error(`check-pr-title is broken: fixture ${JSON.stringify(title)} should ${shouldPass ? 'pass' : 'fail'} and does not.`);
    process.exit(2);
  }
}

const title = process.env.PR_TITLE ?? '';
const reason = checkPrTitle(title);

if (reason !== null) {
  console.error(`PR title rejected: ${reason}`);
  console.error(`  got: ${JSON.stringify(title)}`);
  console.error('');
  console.error('On a squash merge this title becomes the commit subject on main. Edit the pull');
  console.error('request title -- the branch commits are not the problem.');
  process.exit(1);
}

console.log(`PR title OK: ${title}`);
