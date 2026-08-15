# Lessons — CLI upstream error envelope (#655)

- A cast is not a check. All six sites read
  `res.data as { error?: { code?: string } }` and then tested only for
  truthiness; TypeScript happily described a shape the runtime never
  verified. When a value crosses a network boundary, the guard has to
  do the narrowing — the cast just hides that it hasn't.
- The pass-through path is the interesting one: forwarding a body
  verbatim is only safe once you have established it is the documented
  envelope. Otherwise the failure is silent and *well-formed*, which is
  strictly worse than an obviously wrong string.
- Six copies of a five-line guard drifted (one site had dropped the
  `message` field from its cast, one was collapsed onto a single line).
  Centralizing next to `outputError` keeps the envelope contract in one
  file with the code that produces it.
- Fixing "the sites that match this grep" is not the same as fixing the
  rule. The `?? { error: { code: 'HTTP_ERROR' } }` spelling in the
  import/upload/download paths is the *same* defect written differently —
  it only substitutes the envelope when the body is null — so the first
  pass left five sites bypassing the guard it had just centralized. The
  second spelling was found by grepping for the promised code
  (`HTTP_ERROR`), not for the original expression.
- …and a *third* spelling was still out there: the ~25 sites that wrote
  `throw new Error("HTTP <status>")`. Those look like they predate the
  envelope contract and so feel out of scope, but they flatten a real
  backend envelope — the client's own 401 `SESSION_EXPIRED` most of all —
  to `{code: "ERROR"}`, which means the code an agent branches on depended
  on which subcommand it ran. For a cross-cutting output contract, the
  scope is "every site that can emit it," not "every site whose spelling
  matched the bug report."
- Introducing a code agents may branch on is an API change. The first
  pass added `HTTP_ERROR` without touching `packages/cli/README.md` or
  `docs/design/cli.md`'s error matrix, both of which still said everything
  untyped reports `ERROR`. A contract nobody documented is a contract
  nobody can rely on.
- "Verbatim" was the wrong word to leave in the spec once the code
  stopped being verbatim. Bounding the forwarded envelope
  (`safeEnvelope`) is right — it is upstream text going into an agent's
  stderr — but the todo's acceptance criterion, the README and the design
  doc all still promised a byte-for-byte pass-through, so the shipped
  behavior contradicted every line of text describing it. When a guard
  grows a policy, the policy is part of the contract: say what survives
  (the `code`) and what is bounded (everything else).
- Adding `encodeURIComponent` to *one* new URL builder advertises the
  hole in the other fifteen. `apiKeysUrl()` encoded its workspace while
  `base` and every `/documents/${docId}/tabs/${tabId}` interpolation next
  to it did not — and `fetch` resolves `..`, so a document id taken from
  argv could walk the request out of the workspace base and reissue the
  command's method with the session's bearer token. Encoding is not the
  whole fix either: `encodeURIComponent('..') === '..'`, and the URL
  parser resolves a dot segment however it is spelled (`%2e%2e` decodes
  back), so a bare `.`/`..` id has to be refused rather than encoded.
- …and then the same mistake was made one layer out: the browser client
  got the `seg()` primitive applied to `documents.ts` **only**, while
  workspaces / folders / share-links / datasources / files / analytics /
  Miro / the sheet image upload still interpolated route-param ids raw.
  Three lenses flagged it independently. A half-applied guard is worse
  than an absent one, because the new module plus the design doc read as
  "the client is covered". The rule for a client-wide invariant: enumerate
  the call sites with a grep that finds *interpolation*, not the ones the
  original bug report happened to name, and pin them with a test that
  drives every id-bearing route.
- An address allow-list that runs once is not a guard on the request, it
  is a guard on the *string*. `fetch` follows redirects itself, so a
  public host the check allowed could answer `302 Location:
  http://169.254.169.254/…` and the export followed it with nothing in
  between. Owning the hop (`redirect: 'manual'` + re-check per
  `Location`) is the only version that holds. Same class of error one
  line up: an exact-match hostname set missed `localhost.`, which the
  WHATWG parser preserves and every resolver treats as `localhost` —
  normalize before you compare.
- A security guard with no escape hatch becomes an availability bug for
  someone. Refusing every non-public image origin is right by default,
  but a self-hosted install may genuinely serve blobs from an internal
  MinIO; the fix is not to weaken the default but to let the *operator*
  (never the document) name the exception — and to say so in the refusal
  message, so the person who hits it can act on it without reading the
  source.
- A guard that reads the URL is not a guard on the destination. The
  address check refused `http://169.254.169.254/…` and nothing else,
  while `http://169.254.169.254.nip.io/…` — a public name at wildcard
  DNS that answers with the literal it embeds — walked straight through,
  as would `metadata.google.internal` or any single-label intranet name.
  The code comment admitted the gap, but the README and the design doc
  advertised the guard as the thing that stops an export aiming at the
  metadata endpoint, and a guard that *reads* as covering a named attack
  is worse than none: nobody audits what the docs say is handled. A name
  is only as safe as what it resolves to, so ask the resolver
  (`assertResolvedHostIsPublic`), and ask the one `fetch` will dial
  through. What stays open (DNS rebinding) belongs in the doc as what
  stays open, not as a comment nobody reads.
- Fail closed on the check, not on the network. An unresolvable host
  cannot be connected to anyway, so refusing it costs no working case and
  removes the branch where the guard is silently skipped. Hosts the
  operator already exempted are never resolved at all — a decision the
  operator made is not the resolver's to revisit, and a local `--server`
  has to keep working with no DNS in the picture.
- A stub that ignores an argument cannot test that the argument is
  passed. Every redirect test handed back a synthetic 302 no matter what
  init it was given, so deleting `redirect: 'manual'` — the single option
  the whole per-hop guard rests on — left the suite green while real
  `fetch` auto-followed to the metadata endpoint with no check in
  between. When behaviour depends on *how* a collaborator is called,
  assert the call, not just the outcome the stub would produce either
  way.
- `redirect: 'manual'` means two different things by environment: the
  Fetch Standard's opaque-redirect filtering (status 0, no headers) is a
  browser rule, while Node's undici hands back the real 3xx — verified
  on the supported runtime rather than assumed from the spec. Both facts
  belong in the code: the loop relies on the undici behaviour, and names
  the browser one instead of reporting it as `Image fetch failed: 0`.
- A throw added to a shared primitive is only a crash where nothing
  catches it. `seg()`'s dot-segment refusal was flagged as unmounting the
  React tree through `fileUrl()` during render — but the one route that
  passes a URL-bar id first runs it through `fetchDocument()`, whose own
  `seg()` throw becomes a rejected query and redirects before that layout
  mounts, and the other call site is handed a server-resolved id. Trace
  the path to the render, not just the shape of the call.
