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
