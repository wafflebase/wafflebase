# Lessons — sidebar nav drift

## A shell rendered outside the layout is a second copy of the layout

`app/Layout.tsx` is not the app's only shell. The six editor routes sit outside
it and mount their own `AppSidebar`, so anything "the layout provides" is
really provided seven times. Templates shipped into one of them and looked
complete in review, because the workspace routes — the ones a reviewer opens —
were the ones that got it.

**Rule:** when adding a global chrome element (nav entry, header control,
badge), grep for the component it mounts on (`AppSidebar`, `SiteHeader`) rather
than editing the file that looks like the shell. If there is more than one
mount, extract before adding.

## Widening an API module's imports breaks partial `vi.mock` factories

The hook imports `fetchAnalyticsEnabled` from `@/api/workspaces`. Three test
files mock that module with an object literal listing only the members they
knew about, so the new import resolved to `undefined` and the component threw
during render — in tests that have nothing to do with navigation.

**Rule:** a new import in a widely-mounted component is a test-surface change.
After adding one, grep for `vi.mock("<module>"` and check each factory, rather
than waiting for the failure to point at an unrelated test file.

## A new fetch in a shared component is a design-sandbox change

The design editor's scenes answer network calls from a fixture table, and an
unmocked URL is a hard, named scene failure — not a fallback. The canvas scenes
(`sheet-editor`, `docs-editor`, `slides-editor`, `notes-editor`) render their
pages' own `AppSidebar`, so `shell.ts`'s `SHELL_FIXTURES` never applies to
them; they carry their own table in `canvas.ts`. Giving the sidebar a new
request broke all four, and no `verify:*` lane would have said so — the table
is read only when the editor runs.

**Rule:** after adding a `fetch` to anything a page mounts, grep
`packages/design-sandbox/src/scenes/fixtures/` for the URL. If it is absent
from the table a scene actually uses, add it — and fix the header comment,
which enumerates the calls and is the only record of why each is there.

## Pick a regression marker that cannot match a lookalike

The first version of the single-source guard searched for `title: "Data
Sources"`, which also matched `Layout`'s route → document-title table. Keying
on `icon: IconDatabase` fixed that but was worse: a copied list that *omits*
Data Sources — exactly the drift shape being fixed, since every drifted copy
here was a short list — slips through, while an unrelated "Connect data source"
button trips it. The guard that holds asserts the edge instead: every file
rendering `<AppSidebar` must reference `useWorkspaceNavItems`.

**Rule:** guard the relationship (mount → shared source), not a literal copied
between the two. A literal marker inherits the drift it is meant to catch,
because the drifted copy is the one that dropped it.

## A test that reads react-query state before it settles tests nothing

The first draft asserted the nav list synchronously after `renderHook`, so it
read the hook's `= false` default rather than the mocked answer. Both the
"analytics disabled" and the "fallback stays three entries" tests passed with
their mock resolving the opposite value — the mock was decoration.

**Rule:** for an async-gated result, await the state that gates it
(`waitFor(() => expect(client.getQueryData(key)).toBe(...))`) before asserting,
and prove the test fails when the behavior is inverted. A test that passes
under both mock values is not testing the mock.
