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
