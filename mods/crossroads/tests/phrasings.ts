// The risk table both test files read: the pure rule (logic.test.ts) and the
// engine's guess through the real wiring (crossroads.test.tsx). Every
// non-ASCII character is built at runtime, so none sits raw in this file.

const CYRILLIC_E = String.fromCodePoint(0x0435)
const GREEK_OMICRON = String.fromCodePoint(0x03bf)
const CYRILLIC_ZHE = String.fromCodePoint(0x0436)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const COMBINING_ACUTE = String.fromCodePoint(0x0301)
const RIGHT_QUOTE = String.fromCodePoint(0x2019)
const E_ACUTE = String.fromCodePoint(0x00e9)

/** "ship it" in fullwidth letters (U+FF01..U+FF5E), as NFKC folds back to ASCII. */
function fullwidth(text: string): string {
  return Array.from(text, c => (c === ' ' ? c : String.fromCodePoint(c.codePointAt(0)! + 0xfee0))).join('')
}

/** Lowercase letters in mathematical bold (U+1D41A..), also folded by NFKC. */
function mathBold(text: string): string {
  return Array.from(text, c => (/[a-z]/.test(c) ? String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97) : c)).join('')
}

/** The 26 risky phrasings from the cross-review (R-crossroads-1), each with its note. */
export const REVIEW_RISKY: readonly (readonly [string, string])[] = [
  ['ship it to production', 'deploys'],
  ['redeploy the auth service', 'deploys'],
  ['republish the package', 'publishes'],
  ['unpublish 1.2.3 from npm', 'publishes'],
  ['roll out the change to prod', 'deploys'],
  ['go live with the new pricing page', 'deploys'],
  ['promote staging to production', 'deploys'],
  ['git reset --hard origin/main', 'discards work'],
  ['git clean -fdx', 'discards work'],
  ['wipe the local database and reseed', 'deletes'],
  ['truncate the users table', 'deletes'],
  ['terraform destroy the staging stack', 'deletes'],
  ['terraform apply the plan', 'deploys'],
  ['kubectl apply -f prod.yaml', 'deploys'],
  ['gh pr create --fill', 'sends'],
  ['file an issue upstream about the crash', 'sends'],
  ['open an issue on the repo', 'sends'],
  ['reply to the reviewer on the PR', 'sends'],
  ['comment on the GitHub issue', 'sends'],
  ['message the team on Slack', 'sends'],
  ['post the summary in #eng', 'sends'],
  ['land the PR', 'merges'],
  ['purge the CDN cache', 'deletes'],
  ['rmdir build', 'removes files'],
  [`d${CYRILLIC_E}ploy to prod`, 'deploys'],
  [`de${ZERO_WIDTH_SPACE}ploy to prod`, 'deploys'],
]

/** More disguises of the same words: compatibility forms, marks, lookalikes. */
export const DISGUISED_RISKY: readonly (readonly [string, string])[] = [
  [fullwidth('ship it'), 'deploys'],
  [`${mathBold('deploy')} to prod`, 'deploys'],
  [`de${COMBINING_ACUTE}ploy to prod`, 'deploys'],
  [`git pus${String.fromCodePoint(0x04bb)} origin main`, 'pushes'],
  [`depl${GREEK_OMICRON}y the worker`, 'deploys'],
  // A lookalike the fold table does not know still gets a mark.
  [`run the ${CYRILLIC_ZHE}obs`, 'unusual letters'],
]

/** Safe phrasings that must stay unmarked (the review's 13, then the narrowed rules). */
export const REVIEW_SAFE: readonly string[] = [
  'run the auth tests',
  'add the same guard to signup.ts',
  'explain why the cache misses',
  'show the dropdown component',
  'confirm the config loads',
  'enforce the lint rule in CI',
  'review the PR description for typos',
  'improve the error message',
  'add a relationship field to the user model',
  `don${RIGHT_QUOTE}t retry on 4xx, fix the client`,
  `add a caf${E_ACUTE} menu page`,
  'commit the fix',
  'refactor the parser',
]

export const NARROWED_SAFE: readonly string[] = [
  'add a shipping address form',
  'truncate long labels in the table',
  'comment out the failing test',
  'add a comment referencing issue #42',
  'fix the message the parser prints',
  'ping the health endpoint',
]
