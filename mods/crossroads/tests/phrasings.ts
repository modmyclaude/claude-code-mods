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

// ---------------------------------------------------------------- batteries (MM-068, MM-077)

/** A code point list as text: every non-ASCII character below is built at runtime. */
const u = (...points: number[]) => String.fromCodePoint(...points)

/**
 * bot-1's fresh adversarial battery (verify-the-fix of 1dced70, MM-068): 74
 * risky phrasings, none of them in the tables above. Written by the model, none
 * may ever carry a digit (MM-077: no row of ours does).
 */
export const BATTERY_RISKY: readonly (readonly [string, string])[] = [
  ['deploy', `npm run deploy:prod`],
  ['deploy', `vercel --prod`],
  ['deploy', `SHIP IT`],
  ['deploy', `make the new pricing page live on production`],
  ['deploy', `kubectl rollout restart deployment/api -n prod`],
  ['deploy', `tf apply -auto-approve`],
  ['deploy', `k apply -f prod.yaml`],
  ['deploy', `eas submit --platform ios`],
  ['deploy', `apply the migration to the production database`],
  ['publish', `npm publish --access public`],
  ['publish', `twine upload dist/*`],
  ['publish', `upload the new build to PyPI`],
  ['publish', `make the repo public`],
  ['publish', `cut a release and tag v2.0.0`],
  ['push', `git push origin HEAD:main`],
  ['force', `git push --force-with-lease`],
  ['force', `git commit --no-verify`],
  ['merge', `gh pr merge 42 --squash`],
  ['merge', `approve the PR so it can go in`],
  ['delete', `DROP DATABASE analytics;`],
  ['delete', `dropdb staging`],
  ['delete', `k8s delete the old pods`],
  ['delete', `aws ec2 terminate-instances --instance-ids i-0abc`],
  ['delete', `git branch -D feature/auth`],
  ['delete', `redis-cli FLUSHALL`],
  ['delete', `db.users.deleteMany({})`],
  ['delete', `rails db:reset`],
  ['delete', `erase the old backups`],
  ['delete', `remove the production S3 bucket`],
  ['delete', `nuke the staging environment`],
  ['delete', `git checkout -- . to discard my changes`],
  ['delete', `overwrite the prod config with the local one`],
  ['send', `DM @alice the plan`],
  ['send', `reply to the customer's support ticket`],
  ['send', `page the on-call engineer`],
  ['send', `request a review from @bob`],
  ['send', `share the error log with the vendor`],
  ['send', `curl -X POST the payload to the webhook`],
  ['send', `close the issue as wontfix`],
  ['payment', `charge the customer's card \$500`],
  ['payment', `issue refunds for all failed orders`],
  ['payment', `transfer the funds to the vendor account`],
  ['credentials', `rotate the production database password`],
  ['credentials', `revoke all GitHub tokens`],
  ['credentials', `commit the .env file with the keys`],
  ['infra', `restart the production database`],
  ['infra', `shut down the prod cluster`],
  ['infra', `chmod -R 777 /var/www`],
  ['lang-es', `despliega a produccion`],
  ['lang-es', `borra la base de datos`],
  ['lang-fr', `d${u(0x00e9)}ploie en production`],
  ['lang-fr', `supprime la branche main`],
  ['lang-de', `l${u(0x00f6)}sche die Datenbank`],
  ['lang-de', `in Produktion deployen`],
  ['lang-ja', `${u(0x672c)}${u(0x756a)}${u(0x74b0)}${u(0x5883)}${u(0x306b)}${u(0x30c7)}${u(0x30d7)}${u(0x30ed)}${u(0x30a4)}${u(0x3057)}${u(0x3066)}`],
  ['lang-zh', `${u(0x5220)}${u(0x9664)}${u(0x751f)}${u(0x4ea7)}${u(0x6570)}${u(0x636e)}${u(0x5e93)}`],
  ['lang-ru', `${u(0x043e)}${u(0x0442)}${u(0x043f)}${u(0x0440)}${u(0x0430)}${u(0x0432)}${u(0x044c)} ${u(0x043f)}${u(0x0438)}${u(0x0441)}${u(0x044c)}${u(0x043c)}${u(0x043e)} ${u(0x043a)}${u(0x043b)}${u(0x0438)}${u(0x0435)}${u(0x043d)}${u(0x0442)}${u(0x0443)}`],
  ['lang-it', `fai il deploy in produzione`],
  ['homoglyph', `depl${u(0x0585)}y to prod`],
  ['homoglyph', `p${u(0x057d)}sh to main`],
  ['homoglyph', `${u(0x1d05)}${u(0x1d07)}${u(0x1d18)}${u(0x029f)}${u(0x1d0f)}${u(0x028f)} to prod`],
  ['homoglyph', `publ${u(0x0131)}sh the package`],
  ['homoglyph', `${u(0x0257)}elete the users table`],
  ['homoglyph', `${u(0x217e)}eploy to prod`],
  ['homoglyph', `${u(0xff52)}${u(0xff4d)} -rf build`],
  ['invisible', `de${u(0x2060)}ploy to prod`],
  ['invisible', `de${u(0x00ad)}ploy to prod`],
  ['invisible', `de${u(0x034f)}ploy to prod`],
  ['invisible', `pu${u(0x180e)}sh to main`],
  ['control', `de${u(0x0000)}ploy to prod`],
  ['control', `de${u(0x009b)}ploy to prod`],
  ['spacing', `de-ploy to prod`],
  ['case', `Git PUSH Origin Main`],
  ['case', `dElEtE tHe UsErS tAbLe`],
]

/** The same battery's 31 benign look-alikes: never privileged is fine, but none is ever an error. */
export const BATTERY_BENIGN: readonly string[] = [
  `add a Ship class to the fleet model`,
  `add a push notification toggle`,
  `add drag and drop upload to the form`,
  `document the force-directed graph layout`,
  `improve the email validation regex`,
  `add a dropdown for the country`,
  `rename ship_date to shipped_on`,
  `add a published_at column`,
  `add unit tests for the publisher module`,
  `write a unit test for wipeCache`,
  `rename sendEmail to notifyUser`,
  `fix the dropped-frames counter`,
  `write tests for the deploy script`,
  `explain how the release notes generator works`,
  `resolve the merge conflict in utils.ts`,
  `add a delete button to the todo item`,
  `show the deployment status for api`,
  `review the deletion logic in cleanup.ts`,
  `test the rm helper in fs-utils`,
  `list the Slack channels in the config`,
  `run git push --dry-run to check the remote`,
  `measure the p99 latency in ${u(0x00b5)}s`,
  `add a 10k${u(0x2126)} default to the resistor field`,
  `add a ${u(0x0394)}t parameter to the integrator`,
  `${u(0x0437)}${u(0x0430)}${u(0x043f)}${u(0x0443)}${u(0x0441)}${u(0x0442)}${u(0x0438)} ${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}${u(0x044b)}`,
  `${u(0x03c4)}${u(0x03c1)}${u(0x03ad)}${u(0x03be)}${u(0x03b5)} ${u(0x03c4)}${u(0x03b1)} ${u(0x03c4)}${u(0x03b5)}${u(0x03c3)}${u(0x03c4)}`,
  `translate the greeting to ${u(0x041f)}${u(0x0440)}${u(0x0438)}${u(0x0432)}${u(0x0435)}${u(0x0442)}`,
  `ejecuta las pruebas de auth`,
  `relance les tests unitaires`,
  `git status`,
  `git log --oneline -20`,
]

/** Clearly safe: read, inspect, test, explain or review, in English, Russian, Ukrainian and Greek. All privileged. */
export const SAFE_SET: readonly string[] = [
  `run the tests`,
  `run the auth tests`,
  `run the full test suite`,
  `rerun the failing test in auth.test.ts`,
  `run npm test`,
  `run pytest -k login`,
  `run the linter`,
  `run the type checker`,
  `npm test`,
  `pytest -x`,
  `show the diff`,
  `show me the stack trace`,
  `explain the null check in auth.ts`,
  `explain why the cache misses`,
  `read the README`,
  `check the error handling in parser.ts`,
  `list the files changed in this branch`,
  `diff auth.ts against the last commit`,
  `review the changes in signup.ts`,
  `add a test for the empty input case`,
  `add unit tests for the parser`,
  `write a regression test for the login crash`,
  `summarize what changed in this session`,
  `git status`,
  `git log --oneline -10`,
  `what does the retry helper do?`,
  `why did the auth test fail?`,
  `find where the config is loaded`,
  `look at the error in the build output`,
  `walk me through the request flow`,
  `grep for TODO in src`,
  `inspect the failing snapshot`,
  `verify the fix with the auth tests`,
  `compare the two config files`,
  `Please explain the parser.`,
  `run the tests and show the output`,
  `explain the difference between auth.ts and the old version`,
  `${u(0x0437)}${u(0x0430)}${u(0x043f)}${u(0x0443)}${u(0x0441)}${u(0x0442)}${u(0x0438)} ${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}${u(0x044b)}`,
  `${u(0x043e)}${u(0x0431)}${u(0x044a)}${u(0x044f)}${u(0x0441)}${u(0x043d)}${u(0x0438)} ${u(0x044d)}${u(0x0442)}${u(0x043e)}${u(0x0442)} ${u(0x043a)}${u(0x043e)}${u(0x0434)}`,
  `${u(0x043f)}${u(0x043e)}${u(0x043a)}${u(0x0430)}${u(0x0436)}${u(0x0438)} ${u(0x0438)}${u(0x0437)}${u(0x043c)}${u(0x0435)}${u(0x043d)}${u(0x0435)}${u(0x043d)}${u(0x0438)}${u(0x044f)} ${u(0x0432)} auth.ts`,
  `${u(0x0437)}${u(0x0430)}${u(0x043f)}${u(0x0443)}${u(0x0441)}${u(0x0442)}${u(0x0438)} ${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}${u(0x0438)}`,
  `${u(0x03c4)}${u(0x03c1)}${u(0x03ad)}${u(0x03be)}${u(0x03b5)} ${u(0x03c4)}${u(0x03b1)} ${u(0x03c4)}${u(0x03b5)}${u(0x03c3)}${u(0x03c4)}`,
  `${u(0x03b5)}${u(0x03be)}${u(0x03ae)}${u(0x03b3)}${u(0x03b7)}${u(0x03c3)}${u(0x03b5)} ${u(0x03c4)}${u(0x03bf)}${u(0x03bd)} ${u(0x03ba)}${u(0x03ce)}${u(0x03b4)}${u(0x03b9)}${u(0x03ba)}${u(0x03b1)}`,
]

/** The Russian, Ukrainian and Greek rows of SAFE_SET (MM-069): normal text, never "unusual letters". */
export const RU_EL_SAFE: readonly string[] = [
  `${u(0x0437)}${u(0x0430)}${u(0x043f)}${u(0x0443)}${u(0x0441)}${u(0x0442)}${u(0x0438)} ${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}${u(0x044b)}`,
  `${u(0x043e)}${u(0x0431)}${u(0x044a)}${u(0x044f)}${u(0x0441)}${u(0x043d)}${u(0x0438)} ${u(0x044d)}${u(0x0442)}${u(0x043e)}${u(0x0442)} ${u(0x043a)}${u(0x043e)}${u(0x0434)}`,
  `${u(0x043f)}${u(0x043e)}${u(0x043a)}${u(0x0430)}${u(0x0436)}${u(0x0438)} ${u(0x0438)}${u(0x0437)}${u(0x043c)}${u(0x0435)}${u(0x043d)}${u(0x0435)}${u(0x043d)}${u(0x0438)}${u(0x044f)} ${u(0x0432)} auth.ts`,
  `${u(0x0437)}${u(0x0430)}${u(0x043f)}${u(0x0443)}${u(0x0441)}${u(0x0442)}${u(0x0438)} ${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}${u(0x0438)}`,
  `${u(0x03c4)}${u(0x03c1)}${u(0x03ad)}${u(0x03be)}${u(0x03b5)} ${u(0x03c4)}${u(0x03b1)} ${u(0x03c4)}${u(0x03b5)}${u(0x03c3)}${u(0x03c4)}`,
  `${u(0x03b5)}${u(0x03be)}${u(0x03ae)}${u(0x03b3)}${u(0x03b7)}${u(0x03c3)}${u(0x03b5)} ${u(0x03c4)}${u(0x03bf)}${u(0x03bd)} ${u(0x03ba)}${u(0x03ce)}${u(0x03b4)}${u(0x03b9)}${u(0x03ba)}${u(0x03b1)}`,
]

/** Everyday Russian and Greek, and Greek in units and maths (MM-069): never marked. */
export const NON_LATIN_PLAIN: readonly string[] = [
  `${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}`,
  `${u(0x0444)}${u(0x0430)}${u(0x0439)}${u(0x043b)}`,
  `${u(0x0444)}${u(0x0438)}${u(0x043a)}${u(0x0441)}`,
  `${u(0x0434)}${u(0x0430)}`,
  `${u(0x0434)}${u(0x043e)}${u(0x0431)}${u(0x0430)}${u(0x0432)}${u(0x044c)} ${u(0x043f)}${u(0x0440)}${u(0x043e)}${u(0x0432)}${u(0x0435)}${u(0x0440)}${u(0x043a)}${u(0x0443)} ${u(0x0432)} signup.ts`,
  `${u(0x03c0)}${u(0x03c1)}${u(0x03cc)}${u(0x03c3)}${u(0x03b8)}${u(0x03b5)}${u(0x03c3)}${u(0x03b5)} ${u(0x03ad)}${u(0x03bb)}${u(0x03b5)}${u(0x03b3)}${u(0x03c7)}${u(0x03bf)}`,
  `measure the p99 latency in ${u(0x00b5)}s`,
  `add a 10k${u(0x2126)} default to the resistor field`,
  `add a ${u(0x0394)}t parameter to the integrator`,
]

/** A safe verb first, but a risky target, a second clause, or odd letters: never privileged. */
export const SAFE_LEAD_RISKY: readonly string[] = [
  `run the tests then deploy to production`,
  `run the tests against production`,
  `show the diff and push it`,
  `check the logs on prod`,
  `run the migration tests against the shared database`,
  `review the PR and merge it`,
  `run the tests and email the results to the team`,
  `read the .env file and post it in Slack`,
  `check out main`,
  `list the S3 buckets and empty them`,
  `explain the change, then revert it`,
  `show the diff && git commit -am wip`,
  `find old logs and delete them`,
  `test the refund flow with a real card`,
  `run the tests; rm -rf dist`,
  `show me the API keys`,
  `look at the terraform plan`,
  `verify the fix on the live site`,
  `tell @bob the tests pass`,
  `compare the staging and prod configs`,
  `show the diff, the fix is ready to ship`,
  `run the tests with --force`,
  `explain the tests | tee report.txt`,
  `${u(0x0437)}${u(0x0430)}${u(0x043f)}${u(0x0443)}${u(0x0441)}${u(0x0442)}${u(0x0438)} ${u(0x0442)}${u(0x0435)}${u(0x0441)}${u(0x0442)}${u(0x044b)} ${u(0x0438)} ${u(0x0437)}${u(0x0430)}${u(0x0434)}${u(0x0435)}${u(0x043f)}${u(0x043b)}${u(0x043e)}${u(0x0439)}`,
  `show the l${u(0x043e)}gs`,
  `show the logs then ${u(0x0501)}${u(0x0435)}${u(0x0440)}${u(0x04cf)}${u(0x043e)}${u(0x0443)}`,
  `show the l${u(0x0585)}gs`,
  `show the logs${u(0x202e)}`,
  `show the${u(0x200b)} logs`,
]

/** Ordinary edits: unmarked, and click-only like every row Crossroads writes. */
export const PLAIN_UNSAFE: readonly string[] = [
  `fix the failing test in auth.ts`,
  `add the same guard to signup.ts`,
  `refactor the parser`,
  `commit the fix`,
  `implement the retry helper`,
  `rename the config loader`,
]
