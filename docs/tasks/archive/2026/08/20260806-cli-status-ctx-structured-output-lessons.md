# Lessons — CLI `status` / `ctx list` structured output (#635)

## The global `--format` flag is overloaded on purpose

The obvious fix for "`--format bogus` is silently accepted" is
`commander`'s `.choices(['json','table','csv'])` on the global option in
`createProgram()`. That would have broken `docs content --format md`,
`docs export out.pdf --format pdf`, `slides export --format pptx`, and
`notes export --format md`: those commands deliberately **do not**
redeclare `--format` and instead reuse the global one, validating the
value themselves (`parseContentFormat`, `detectExportFormat`). Two
source comments in `commands/docs.ts` spell this out. Validation has to
stay per-command; the shared helper is `parseOutputFormat()` for
commands that actually render through `output()`.

## `wafflebase schema` already declared the intended shapes

`src/schema/registry.ts` had `ctx.list` documented as
`array of { id, name, active }` and `status` as `{ user, server,
workspace, session }` long before either command emitted JSON — the
registry was the spec and the implementation had drifted from it. Worth
checking the registry first when fixing any CLI output: it says what
agents were promised.

## Adding a `default:` throw to a shared formatter needs a call-site audit

Giving `format()` a validating `default:` branch is only safe if every
`output()` caller is inside a `try/catch` that routes to `outputError`.
`commands/schema.ts` was the one exception out of 31 call sites, and
`bin.ts` has no top-level handler — so `wafflebase schema --format
bogus` went from printing a literal `undefined` (exit 0) to dumping a
Node stack trace. Self-review caught it; the smoke test that found it
was two commands long. Widening a shared helper's failure mode is a
call-site audit, not a local change.

The same applies to widening what a shared *renderer* accepts:
teaching `formatTable` to render a single object reached
`schema --format table`, which passes `{ commands: [...] }` and started
printing `[object Object]`. `formatCsv` had already solved that by
JSON-serializing non-scalars; the new path had to do the same.

## Flat payloads over nested for CLI output

`formatTable` and `formatCsv` operate on records of scalars; a nested
`{ user: { username, email } }` renders as `[object Object]` in a table
and a JSON blob in CSV. Since the non-JSON formats are now the *human*
path (JSON being the default), `status` emits a flat record.

## A conflicting PR stops receiving `pull_request` CI, which stalls the loop

Round 4's fix commit (`033e14fc2`) was pushed on 2026-08-10 and then
nothing happened for five days: no CI run, no panel round, and
`agent:fixing` latched on the PR. The cause was not the fixer. Between
round 4's commit (2026-08-06) and that push, `main` merged #694
(dropped `quiet` from `output()`/`outputError()`) and #729 (added
`--format yaml`), which made the branch conflict. GitHub could no
longer compute the PR's merge ref, so the push produced **no**
`pull_request: synchronize` workflow run at all — `gh api
.../commits/033e14fc2/check-runs` returns an empty list and the branch's
last `CI` run is still the one created on 2026-08-06. The `@claude
rerun` earlier that day worked only because it *re-ran an existing*
workflow run rather than dispatching a new one.

The lesson for a long-lived agent branch: a merge conflict is not just a
merge problem, it silently removes the branch from CI, and every stage
of the pipeline that keys off CI stops with it. Merge `main` into the
branch on a cadence rather than waiting for the loop to complain.

## `--format` guards must be re-applied to call sites `main` adds

This branch converted every `output()` call site to narrow the raw flag
through `parseOutputFormat()` *before* the request, because `format()`
now throws — after a mutation, that throw turns a completed write into
exit 1 / `INVALID_FORMAT` with the response body discarded. While the
branch sat, `main` added six new call sites that predate the rule:
`tabs create`/`tabs rename` (#708) and the whole `files` namespace
(#703, `list`/`get`/`rename`/`delete`). Merging cleanly left all six
passing `opts.format` straight to `output()` — no conflict marker, no
type error, and the PR's own point regressed on exactly the commands
`main` had just shipped.

Textual conflict resolution is not enough for a change whose thesis is
"every call site does X". After the merge, re-run the audit that
justified the change (`grep -rn "output(.*opts\.format" packages/cli/src`
here) and treat any survivor as a conflict the merge did not report.

## A shared serializer has two audiences; a safety transform belongs to one

Round 2 asked for CSV formula neutralization, and it went in where the
CSV is built — `formatCsv`. That looked like the single chokepoint, and
for the `--format csv` render path it is. But `formatCsv` has a second
caller the diff never touched: `sheets export --file-format csv`, whose
output is the *input* of `sheets import`. Every exported `=SUM(B2:B100)`
came back as the literal text `'=SUM(B2:B100)`, silently corrupting the
round trip the repo documents in `skills/recipe-csv-pipeline.md`.

Display safety and data interchange want opposite answers from the same
function. The fix is not a default that happens to suit the current
callers but an explicit, **required** `neutralizeFormulas` option: the
next call site added has to state which audience it serves instead of
inheriting one. Before adding a transform to a formatter, list its
callers and ask which of them writes bytes something else will read
back.

## A neutralizer reading position 0 depends on the quoter for the rest

`neutralizeFormula` looks at position 0. That is only sound while a
value cannot *become* the start of a record, and the quoting predicate
allowed exactly that: it covered `,`, `"` and `\n` but not `\r`. A cell
holding `ok\r=HYPERLINK(...)` was emitted unquoted, and an importer
honouring a bare CR as a record terminator starts the next record with
an unneutralized formula. The original test even pinned the bare form
(`expect(lines[6]).toBe("'\r=cmd")`), so the gap was recorded as
intended behaviour.

Two lessons: a defence that inspects one position depends on every
other layer preserving the framing it assumed, and a test that pins a
serializer's exact bytes is also pinning its escaping — read it as a
security assertion, not a formatting one.

## A hard version contract has to name itself when it breaks

The loopback nonce makes the CLI depend on a backend new enough to echo
`state`. Against an older one, the CLI refused its own genuine redirect
and — correctly, since a forged hit must not end the wait — did nothing
else, so login hung for the full 30 seconds and failed with a bare
"Login timed out". Correct security, undiagnosable behaviour.

Refusing silently is what turns a compatibility break into a support
ticket. Each refusal is now reported on stderr as it happens, answered
in the browser tab, and repeated in the timeout error, with "no `state`
at all" (server too old) distinguished from "`state` mismatch" (a
callback that is not ours). The security property is unchanged: the
wait still never settles on a refused callback. Making the timeout
injectable (`{ timeoutMs }`) is what made this testable at all — a
30-second constant is untestable, and untestable diagnostics rot.

## Test the wiring, not just the helper it calls

The nonce chain is query param → stored state → loopback `state`.
Every test covered a link in the middle: `parseCliNonce` in isolation,
`createState` handed a nonce directly, the controller's redirect built
from a hand-made state. The entry point — `GitHubAuthGuard.canActivate`
reading `req.query.nonce` — had no test, so changing it to
`req.query.state` kept all of them green while disabling the whole
protection (verified by making exactly that edit). When a security
property is a chain, pin the link that reads the untrusted input.

## Work accepted mid-review grew this PR past its own issue

Round 2 asked for the OAuth nonce, the CSV formula guard and the
`cells batch` restructure; all three landed here, in a PR whose issue
(#635) is about routing two commands through `output()`. From round 5
onward the design-fit check flagged that bundle as scope creep. The
description is accurate — the PR is larger than its issue — and it has
no fix left inside this branch, because unbundling now means dropping
work earlier rounds required and later rounds extended.

The lesson is at the other end: a change requested mid-review that sits
outside the PR's thesis should be taken as its own issue and its own
PR, not folded into the open one. Each PR's diff then stays answerable
against a single stated outcome.

## A wiring lesson learned on one side of a chain has another side

Round 5 produced "Test the wiring, not just the helper it calls" — the
backend guard reading `req.query.nonce` had no test, so renaming the key
kept every helper test green while disabling the protection. The lesson
was written and the backend got `github-auth.guard.spec.ts`.

Round 6 found the identical gap at the other end of the same chain. The
CLI's `login` action generates the nonce, hands it to
`startCallbackServer`, and interpolates it into `?…&nonce=…`; every CLI
test drove `createLoginNonce`, `nonceMatches` and `startCallbackServer`
directly, handing the nonce in. Two different nonces, or `nonce=`
spelled as `state=`, would leave all of them green and refuse every real
login for the full 30-second timeout.

A cross-package contract has two entry points, and fixing the one the
review named is half the work. When a lesson is "pin the link that reads
the untrusted input", ask immediately which *other* component writes it.

The new `login-command.test.ts` drives the registered action with the
browser stubbed by the `open` mock, which reads the port and nonce out
of the URL the action built and hits the real loopback server. Both
mutations were confirmed to fail it. Racing the run against the
server's own "Refused a login callback" line matters: without it a
broken nonce surfaces as an opaque 30-second hang instead of a named
cause.

## A doc's universal claim is a claim about code that has to be checked

§8.1 was written as "every command that renders a structured result
routes it through `output()`", with an exception list. It was true of
everything the change touched and false of `docs`/`slides`/`notes`
`import`, which emit `{ id, title }` through a bare `JSON.stringify` and
ignore `--format`. The exception list made the omission worse — it reads
as exhaustive.

Routing the importers is not a call-site swap: they render through an
injected `ImportIO`, the seam that makes their stdin/TTY/confirm
branches testable, so it is a change to that seam and belongs in its own
PR. The doc now names the gap as a gap rather than quietly widening the
exception list to cover it. When writing "every X does Y", grep for X
first — and if the answer is "all but three", say which three.

## A timer armed during setup outlives every path that fails setup

`startCallbackServer` armed the login's wait timeout before it tried to
listen, and the only handle that cleared it was the `close()` handed back
when the promise *resolved*. Every rejection path therefore leaked it.
The symptom is badly delayed: the command prints its real error, appears
to be done, and three minutes later dies on an unhandled rejection from a
promise nobody on that path ever awaited.

Raising the timeout from 30 s to 180 s in the same change made a latent
leak six times more visible, which is the general shape: a constant that
looks like a tuning knob is load-bearing when a resource's lifetime is
keyed to it.

The fix is not "clear it on the error paths too" — that is a rule every
future path has to remember. Arm the timer where the thing it bounds
begins: there is nothing to wait for until the server is listening, so
that is the only place it should exist.

## Refusing a request and stranding the user are separate decisions

The web OAuth `state` check was correct and its failure mode was a
thrown `BadRequestException`, which put the user on the *backend* origin
looking at raw Nest JSON with no link back. The security property (issue
no session) and the presentation (where the browser ends up) are
independent, and only the first was designed.

What made it more than cosmetic is that the failure needs no attacker:
the state cookie lives ten minutes, which a first-time GitHub sign-up
with 2FA can outlast, and because the cookie has one fixed name and path,
opening a second login tab overwrites the first tab's secret. Both are
ordinary user behavior.

When adding a precondition to a redirect-based flow, ask what the browser
renders when it fails — and check whether the consumer on the other side
has any path for that outcome. Here it had none: the frontend's only
OAuth entry point was a `<Link>`, and the login page read no `?error=`.

## Test the reader of a contract, not just the writer

`GitHubAuthGuard` attaches the OAuth state as `req.__oauthState` and
`GitHubStrategy.authenticate` reads it back out. The guard spec asserted
the write; nothing asserted the read. That key is the single hinge both
login paths pass through, so a spelling mismatch would have sent every
login to GitHub stateless and had the new callback reject every one of
them — with a completely green backend suite.

The same shape appeared in the confirmation page: `renderConfirmPage`
re-encodes `port` and `nonce` into the Continue href, which is the only
way those survive the confirmation hop, and the test that rendered the
page passed no nonce while the test that passed one never rendered HTML.
Confirmed by mutation both times: renaming the key, and dropping the
`nonce` line, each fail exactly one new test and nothing else.

Where two components agree on a string key, the test that matters is the
one that would fail if only one side changed.

## The schema registry is an interface, so treat drift as a build error

`sheets export --raw` shipped in commander, in `cli.md`, and in the
published docs — but not in `schema/registry.ts`, which is what an agent
reads to learn what it may pass. Pinning the one missing flag would have
fixed the instance; instead the test walks commander's own option list
for the command and asserts each flag appears in the registry, so the
next flag added to it fails locally rather than shipping unreachable.

Prefer a test that expresses the invariant over one that pins today's
answer, when the invariant is cheap to state.

## One review check failed after a full-length run without a verdict

In round 8 the security check ran its full ~14 minutes and produced no
findings and no verdict; its summary read "every credential in the pool
(3) was retired". That round's blocking set was therefore worked
through from the other checks' output. Recorded because run duration
alone did not distinguish that outcome from a completed review — a
short run (~9 s) had been the only previous signal of an
infrastructure failure, and here the summary was the only thing that
said so.

## A double-submit cookie is only as good as who else can write it

The browser OAuth `state` was a random secret in a cookie plus its
SHA-256 in the URL, compared in constant time — and still defeatable,
because the cookie's name carried no `__Host-` prefix. Any sibling host
under the registrable domain (a staging box, a takeover-able CNAME, an
XSS on a marketing subdomain) can send `Set-Cookie: name=…;
Domain=example.com`, which lands on the real origin. Owning both halves
of the pair, the attacker supplies the matching `state` and the check
confirms their own login instead of the victim's. An HMAC over the
secret would not have helped: an attacker can mint a legitimate pair by
starting their own login.

The cryptography was never the weak part. When a check rests on "only
this browser holds the secret", the question is which origins the
browser will let write it — and the answer has to be applied to *every*
cookie of that kind. The same round shipped the prefix on the state
cookie first and left `wafflebase_cli_confirm`, which proves a consent
click the same way, unprefixed; both now derive their name from one
helper so a deployment cannot harden half of them.

## A justification for a flag is a claim, and claims get tested

`sheets export --raw` was documented — in command help, the schema
registry, two skill files, the published CLI docs and the agent
round-trip charter — as the way to make `sheets export` → `sheets
import` preserve formulas, and nothing did that: an export writes one
row per cell (`ref,value,formula,style`) while the importer read a
positional grid. Six documents agreed with each other and none agreed
with the code, so the claim survived every round until a reviewer read
the import call site.

Prose describing a pipeline is worth a test at whichever end is
cheapest to pin. Repeating a rationale across files does not make it
true; it only makes the correction six edits wide.

## Query-string keys are untrusted input, including as object keys

`LOGIN_ERRORS[error]` indexed a message map with whatever `?error=`
carried, so `?error=constructor` returned `Object.prototype.constructor`
— a function handed to React as a child — and `??` could not catch it,
because a function is not nullish. An own-property lookup is the fix,
and the same shape applies anywhere a URL parameter, a header or a CRDT
key indexes a plain object.

## Two sessions can work the same review round

Round 9 was picked up twice in parallel. The other session pushed
first, closing the same four findings — with a *better* answer on
`--raw`, teaching the importer the export's record shape rather than
correcting the prose around it. The duplicate work was dropped rather
than merged (its docs would have contradicted the shipped importer),
leaving only what the other pass had not covered: the CLI confirm
cookie, the equal-length comparison test and these notes.

Before starting a review round, check whether the PR's head has already
moved past the commit the findings were filed against; and when it has,
re-read the remote work before pushing, because "my change is done" and
"my change is still needed" are different questions.