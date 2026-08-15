# Lessons — CLI system exit code (#586)

## What the bug really was

A documented contract with no implementation and no test. The docs were
written alongside the CLI design, the `outputError` helper landed with a
hardcoded `1`, and nothing connected the two. The gap survived because
every test asserted `exitCode === 1` — i.e. the tests encoded the bug.

## Design notes

- **Classify at the throw site, decide at the output site.** Sniffing
  `error.message` for `"fetch failed"` in `outputError` would have been a
  smaller diff but would break the moment undici changes its wording.
  A `SystemError` class carrying `exitCode` keeps the knowledge where the
  failure is actually known.
- **`exitCode` as an error property** composes with the existing `code`
  pass-through in `errorCode()`: one `SystemError` gives both the
  machine-readable `code` in the JSON body and the process exit code.
- **5xx is a system error.** The docs only said "network, auth", but a
  server fault is not a user error by any reading — the docs were
  widened rather than the classification narrowed.
- **`quiet` must classify too.** The quiet branch of `outputError`
  returns early; it is exactly the branch scripts use, so leaving it at a
  hardcoded `1` would have defeated the purpose.

## Descoped, then rebuilt properly

Two security controls were drafted here, removed as out-of-scope, and
then reinstated when review held that shipping the surrounding code
without them was worse than the scope creep. Both were rebuilt against
the objections that got them descoped, which is the useful part:

- **Nonce-bound loopback login callback** (CLI `?nonce=` → stored in
  `CliAuthStore` → echoed on the `127.0.0.1` redirect). The original
  version made a CLI pointed at an older backend hang the full 30s and
  then throw an unclassified timeout. Now the missing-nonce case is
  *named* in the timeout message, and the CLI refuses a callback that
  does not echo its nonce — fail-closed where it counts, with the
  failure legible. (The backend's matching `400` for a nonce-*less*
  request was walked back later; see below.) Refusing without
  settling still matters: a hostile local page must not be able to
  cancel a pending login either. The nonce does travel in the printed
  OAuth URL and the browser argv, so it does not defend against a
  same-user local process — that is the OAuth `state` threat model, not
  a regression.
- **SSRF gate on export image `src`** (`assertFetchableImageUrl`). The
  first version failed on all three counts raised against it, and each
  is now a test: names are *resolved* before the verdict (so an
  attacker-controlled DNS record pointing at loopback is refused), every
  redirect hop is revalidated (`redirect: 'manual'`), address rules run
  only against literals — expanded to eight words, so `::ffff:7f00:1`
  and `::ffff:127.0.0.1` are one address and `fc2.com` is not an IPv6
  range — and the configured server stays reachable regardless of how
  its URL is spelled. What is still open is documented rather than
  implied: rebinding between lookup and connect.

The lesson worth keeping: "this belongs in another PR" is only true if
the other PR exists. A control removed from a diff that ships the code
it was protecting is not deferred, it is deleted.

## What the review panel then found (and what it changed)

- **A gate that fails open is not a gate.** `assertFetchableImageUrl`
  returned — i.e. allowed — when the pre-resolution threw, on the theory
  that "the fetch will report it anyway". But the gate and the fetch
  resolve *independently*, so an attacker-run nameserver that stalls the
  first lookup and answers the second with `127.0.0.1` walked straight
  through, and any resolver hiccup silently disabled the control. It now
  fails closed as `NETWORK_ERROR`, which costs nothing: the exit class
  is the same one the fetch would have produced.
- **Address rules have to reach through the transition ranges.** The
  IPv6 table matched `fc00::/7` and `fe80::/10` but not the prefixes
  that *embed* an IPv4 address — on a host behind a NAT64 gateway,
  `64:ff9b::a9fe:a9fe` is the metadata service. Same for 6to4 and
  Teredo, and on the v4 side for `224.0.0.0/4` and `240.0.0.0/4`.
- **Compare identities, not spellings.** Allowing the configured server
  by *origin string* silently broke dev and self-hosted exports: the
  frontend persists image `src` absolute, so a document says
  `http://localhost:3000/...` while the CLI may be pointed at
  `--server http://127.0.0.1:3000`. The exemption now matches resolved
  address + port, which covers every spelling of the same listener and
  still grants nothing beyond it.
- **A security requirement that breaks published clients has to earn
  it.** `@wafflebase/cli` is on npm, so a `400` for a nonce-less
  `?mode=cli` would break every installed CLI on the next deploy. The
  fail-closed instinct was right but pointed at the wrong end: the
  binding that defends a login is the CLI's own check, and an attacker
  minting a code for a port they control just picks their own nonce, so
  server-side rejection buys nothing it costs. Malformed → `400`,
  absent → serve and warn, hard `400` once old CLIs are out of support.
- **Classification has to follow the network calls out of the package.**
  Every CLI `fetch` was routed through `fetchOrThrow`, but the PDF
  exporter downloads Noto KR fonts from inside `@wafflebase/docs` with a
  raw `fetch` — so an offline export of a Korean document still exited
  `1`. `PdfFonts` now takes a `fetchImpl`, and the CLI injects a
  classifying one. The seam is a *transport* the classifier wraps, not a
  replacement for it: the first version let the test's stub bypass the
  very code under test, and the test passed for the wrong reason.
- **A refactor's motivation is a test.** Rerouting the API-key endpoints
  through `send()` (so a refreshable session is not reported as an auth
  failure just because of which base a call used) shipped with nothing
  exercising `HttpClient`. `test/http-client.test.ts` now pins the
  refresh-and-retry across that base, the session-file persistence, and
  the `encodeURIComponent` on revoke.

## What the second review round found

- **A failure diagnostic is an attack surface when an attacker can set
  it.** The timeout message branched on whether a nonce-less callback
  had arrived, and said "the server predates nonce-bound CLI login —
  re-run with `--allow-unbound-callback`". But the loopback listener is
  reachable by exactly the adversary the nonce exists to stop: a hostile
  page sends one nonce-less `/callback?code=<its own code>`, the CLI
  blames the server and prescribes the flag that disables the binding,
  and the victim's re-run accepts the replayed code — login fixation.
  The refusal itself was correct; the *advice* was the hole. The message
  is now invariant, and the escape hatch is documented only where an
  attacker has no say (`--help`, README). Generalisation: never infer a
  cause from an unauthenticated input and then recommend an action based
  on it.
- **An explicit dispatcher silently outranks the operator's.** Pinning
  each image fetch to its gated addresses meant passing undici an
  `Agent`, which overrides any ambient proxy configuration — so on a
  machine whose only route out is a proxy, every external image in a
  document stopped exporting. Pin and proxy cannot be combined (the pin
  overrides the connector's resolver, and a proxied connector only ever
  resolves the *proxy's* name), so the hop now dispatches through a
  `ProxyAgent` when `http_proxy`/`https_proxy`/`all_proxy` applies. That
  costs nothing the pin was holding: it defends the CLI's own
  connect-time resolution, which a proxied request does not perform. The
  gate is unchanged either way.
- **"Tested" has to mean the wire, not the neighbourhood.** Both
  security controls added in the previous round had thorough tests that
  would still have passed with the control removed. `pinnedAgent` was
  only exercised through IP-literal hosts, where gate-time and
  connect-time resolution coincide; it is now driven against a
  `.invalid` name that cannot resolve, so the request can only land if
  the pin is doing the work. The CLI half of nonce-bound login was never
  driven at all — `runLogin` was module-private, so nothing proved the
  nonce reaches the OAuth URL or that `--allow-unbound-callback` reaches
  the listener. `runLogin` now takes its options and its four
  boundaries (session file, listener, browser, HTTP) as arguments, and
  the flow between them is the code under test.
- **Confirm the proof, not just the pass.** Every test added this round
  was run against a deliberately broken build first: nonce dropped from
  the URL, flag unwired, dispatcher removed, proxy ignored, old timeout
  message restored. Each failed for the reason it names. That step is
  what separates the tests above from the ones this round replaced.
- **An address is not an identity.** The server exemption in the image
  gate matched on resolved address plus port, so any name a document
  author pointed at the API server's address on its port was waved
  through — arbitrary paths on the internal API host, under an
  attacker-chosen `Host`, reaching whatever virtual host is co-located
  there. The same comparison was simultaneously too *narrow*: with
  `--server http://localhost:3000` on a host where `localhost` answers
  only `::1`, a document's own `http://127.0.0.1:3000/images/...` was
  refused. Both are the same mistake — asking DNS a question that is
  really about names. It is now the same name, or loopback-under-either-
  spelling (a *name*-level equivalence, so a foreign name resolving to
  `127.0.0.1` is not covered), or an address literal, which keeps the
  resolved comparison because no resolver can steer a literal.
- **The half of a flow nobody was reviewing is where the hole was.**
  Hardening the CLI login made the *web* login's missing OAuth `state`
  visible: passport-oauth2 with no state and no store installs a
  `NullStore` whose verify always succeeds, so any `?code=` presented to
  the callback minted a session — classic login CSRF. `CliAuthStore` had
  been minting a `csrf` value since day one and nothing ever read it,
  which is how a mitigation the design doc claimed had never existed.
  Generalisation: when a risk table asserts a control, grep for its
  consumer, not for the code that produces it.
- **Fail-closed belongs before the side effects.** The callback created
  the user account and *then* decided whether the callback was
  legitimate. Rejecting it after the write is not rejecting it, so
  state validation now runs first and the test asserts
  `findOrCreateUser` was never called.
- **A repo-scoped read has to be scoped in the module, not the test.**
  The previous round cleared `GIT_*` in `changed-areas.test.mjs`, which
  protected the fixtures from re-initialising the real repository. The
  module under test still spawned `git` with an inherited environment,
  so under `pre-push` (which runs `verify:self`, which imports it) lane
  selection was computed against whatever `GIT_DIR` named. Both halves
  were needed; the repo already shipped `repoScopedEnv()` for exactly
  this. The regression test needed its own lesson too: two throwaway
  repos built from identical content, message and author produce
  identical shas, so the decoy has to differ before it can prove
  anything.
- **State an accepted risk as accepted, not as absent.** The proxy path
  drops the address pin, and the note said that "costs nothing that was
  ever held". It costs something real: the proxy performs the
  connect-time resolution the CLI no longer performs, so a rebinding
  nameserver can still reach the proxy's network. The behaviour is
  right — the proxy protocols carry a name, so there is nothing to pin,
  and refusing to proxy names would break every machine that only
  egresses through one — but the write-up now records the residual risk
  instead of denying it. Same for the printed OAuth URL, which carries
  the login nonce and is therefore a credential while the login is
  pending.
- **An accepted risk that nobody is told about is indistinguishable
  from one nobody found.** The previous round recorded the dropped
  address pin honestly in the design doc and in the source comment, and
  the security lens still called it "silently dropped" — correctly, from
  where an operator stands. Documentation reaches the reviewer; the
  person running `docs export` behind `https_proxy` reads neither file.
  The gap closed with one stderr line on the first proxied hop of a run
  (once per fetcher, not per image), naming the hop and the mitigation
  (`no_proxy`). The trade itself is unchanged: `CONNECT` carries a name,
  so there is nothing to pin, and refusing to proxy names fails every
  external image on exactly the machines that only egress through one.
  Generalisation: when a residual risk survives review, ask who is
  supposed to act on it. If the answer is the operator, the write-up is
  not the delivery mechanism.
- **A warning sink is a constructor option, not a module global.**
  Making the notice fire once needed state. Hanging it off the module
  would have needed an exported `reset()` for tests and would have
  silenced the second export in a long-lived host. A `warn?:` option on
  `ImageFetcherOptions` plus a closure flag inside `createImageFetcher`
  gives both the once-per-run behaviour and a seam the test reads
  directly, with no global to reset and no stderr to capture.
- **Two overlapping branches fixing the same hole is a merge conflict,
  not defence in depth.** The security lens asked for a browser binding
  on the `?mode=cli` OAuth entry. PR #786 already ships that binding —
  a `wafflebase_cli_state` cookie, a framing-proof consent interstitial,
  PKCE, `__Host-` prefixes, a plain-http non-loopback refusal — in the
  same three files this branch touches. Writing a second, weaker version
  here would have bought nothing and guaranteed a conflict in
  `github-auth.guard.ts` and `auth.controller.ts`. The residual on this
  branch is bounded to an attacker who already runs code on the victim's
  machine, because the CLI redirect target is a hardcoded
  `http://127.0.0.1:<port>/callback` with a 60-second single-use code.
  Generalisation: before implementing a review finding, check whether a
  sibling branch already owns that file; the right fix can be to let it
  land.
