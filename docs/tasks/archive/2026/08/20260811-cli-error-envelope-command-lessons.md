# Lessons — CLI error envelope: single line + `command` field

Issue: #661

## Notes

- Every `outputError` call site already lives inside a commander action
  declared as `async function (this: Command, …)`, so the command object was
  in scope at all ~40 of them — threading `this` needed no signature
  plumbing through helper modules.
- The last-resort catch in `runCli` has only the root `program`, which does
  not know which subcommand ran. Commander's `preAction` lifecycle hook,
  registered on the root, fires for subcommand actions and hands over the
  acting `Command` — that is what lets the entrypoint's envelope carry
  `command` too, instead of dropping the field exactly where an unhandled
  rejection makes attribution most valuable.
- Re-emitting a backend body through the envelope is lossy unless you look
  past `error.message`. There is no global exception filter in the backend —
  only `docs-content.controller.ts` hand-builds `{ error: { code, message } }`
  — so most failures arrive in Nest's default `{ statusCode, message, error }`
  shape, where `error` is a bare reason phrase and the real text is top-level
  (and can be a `message[]` from `ValidationPipe`). `backendErrorEnvelope`
  reads `error.message` → `message` → `error`-as-string, so converting a path
  that used to print the body verbatim never costs the server's reason.
- A converted failure path needs a test that *drives* it, not just a builder
  test. `login`'s three `failFromBackend` call sites were the only new
  emitter with no coverage at all: the login test stubbed every backend call
  to `200`, so nothing ever reached the envelope. The gap also hid a real
  question — `failFromBackend` is typed `Promise<never>` but the call sites
  `await` it and the code below continues to `exchangeRes.json()`, so
  "does it actually stop?" is only answerable by running it. Spying
  `process.exit` to throw makes both the exit code and the halt observable.
- The dotted name (`docs.content`) is the commander `parent` chain minus the
  root program. Aliases resolve for free: `name()` returns the canonical
  name, so `wafflebase doc content` still reports `docs.content` — the same
  string the `schema` command uses.

## Review round: OAuth/CLI login hardening follow-ups

- A rewritten predicate is only rewritten if the old test is *removed*.
  `secureCookies` was reworked so `__Host-` follows `GITHUB_CALLBACK_URL`'s
  scheme, but the original `if (NODE_ENV === 'production') return true;`
  stayed in front of it. The new rule was then unreachable in exactly the
  configuration the shipped image ships: `NODE_ENV=production` plus an
  `http://` callback, where `Secure` cookies are discarded and every login
  dead-ends. When replacing a condition, delete the one being replaced and
  check the ordering, not just the new branch.
- A `Secure` cookie on a plain-http origin is not a stricter cookie, it is
  no cookie. Two of these bugs in one file (login cookies and session
  cookies) came from reading `secure: true` as "safer by default" instead of
  "only meaningful over TLS".
- Fixing one cookie in a chain fixes nothing. Making only the login cookie
  scheme-aware would have moved the dead end from the callback to the
  session that the callback hands out. Follow the whole path a login walks
  before deciding a cookie fix is complete.
- Redaction rules are per-route, so they need a *grep for the credential's
  other carriers*, not a fix for the reported one. The share-token
  redaction shipped with `share-links/*/resolve` and missed
  `invites/*/accept`, which is worse: it is a mutation, so it logs at `info`
  on success, not only at `warn` on failure.
- One key, one purpose. `JWT_SECRET` signed both session tokens and the
  OAuth state binding, and the binding is *published* — an unauthenticated
  `GET /auth/github` returns the MAC's input in `Set-Cookie` and its output
  in `state`. HKDF with a fixed label separates the two without a new env
  var or any deployment action, because the derivation is deterministic and
  the bindings live five minutes. Be honest in the comment about what it
  does not buy: derivation is not entropy, and a weak secret is still
  testable through it.
- A double-submit token should name what it authorized. The CLI consent
  token was a bare random value, so it proved "some consent page was shown"
  rather than "the page naming port 9876" — and the port is the only thing
  the person was asked to read. Signing the displayed parameters into the
  token costs one HMAC and makes the claim match the defence.
- "Separate names so two flows can coexist" is an argument that recurses.
  It was written for browser-vs-CLI and left two logins of the *same* flow
  colliding on one cookie value. The fix is not a third name — a name the
  callback can derive is a name a crafted start can plant — but a bounded
  ring of values inside the one cookie, spending the matched one.
- A single-use link needs an *exit*, not just a refusal. `/launch/<token>`
  returned a bare 404 on its second visit, which is correct security and a
  dead end for the human who lost the race to a prefetch. `410` plus the
  remedy costs nothing and leaks nothing.
