# Templates gallery — marketing skin

/ and /templates read as two different products. The homepage is a bespoke
`--wb-*` skin (`font-display`/`font-code`, paper cards, butter/syrup accents,
pill `WbButton`, `SectionHead` kickers, sticky `NavBar` + `Footer`); the public
template surfaces are plain app chrome (`text-muted-foreground`, square
`Button`, `rounded-md border` cards) with no nav and no footer at all.

Unify the two **public** template routes with the homepage without dragging the
marketing tone into the app, since `TemplateGallery` is shared with the
workspace Templates tab and the New-from-template dialog.

## Scope

- In: `/templates`, `/t/:id`, and a `skin` seam on `TemplateGallery`.
- Out: the workspace Templates tab and the New-from-template dialog keep app
  chrome. They are inside the product, not in front of it.

## Tasks

- [x] `NavBar` / `Footer`: make the `#features` entry reachable from a route
      that is not `/` (router has a `basename`, so a raw `<a href="/#...">` is
      wrong); add a `signInTo` prop so `/templates` keeps its `returnTo`
- [x] `HomePage`: scroll to `location.hash` on mount so `/#features` lands
- [x] New `app/home/marketing-page.tsx` — `NavBar` + children + `Footer` on
      `--wb-bg`, resolving `workspacePath` itself
- [x] `TemplateGallery`: `skin?: "app" | "marketing"`, default `"app"`; one
      query/facet/paging implementation, presentation only branches
- [x] Marketing card: paper surface, display title, butter chips, whole card
      clickable with a hover-revealed affordance
- [x] `/templates`: `SectionHead` + `RulerBackdrop` header, CTA folded into the
      nav
- [x] `/t/:id`: two-column preview + detail, `WbButton` actions, not-found
      state inside the same chrome
- [x] Tests: keep `public-templates.test.tsx` green, pin `skin` default to
      `"app"` so the workspace tab cannot regress
- [x] `pnpm verify:fast`; watch the frontend chunk gate for home-chunk bleed
      into the lazy templates routes
- [x] Manual pass in `pnpm dev`: `/`, `/templates`, `/t/:id`, light + dark

## Review

Both public template routes now mount the landing page's chrome and the
gallery grid speaks its visual language. The in-app mounts are untouched:
`skin` defaults to `"app"` and only `public-templates.tsx` passes
`"marketing"`, pinned by a test.

Two things the plan did not anticipate, both found by measuring rather than
by reading:

**The chunk gate really did trip** (223 against a 222 cap), exactly the risk
the plan flagged. Six second-importer hoists — `marketing-page`, `footer`,
`section-head`, `theme-toggle`, `wb-button`, `document-type-meta`. The
obvious fix, a `manualChunks` group for the chrome, was tried and is *worse*:
naming those modules as one chunk co-located `waffle-logo` with them and
swallowed the app entry, so `Layout`, `sheet-view`, `docs-detail` and ~80
other chunks ended up importing a 44 kB `marketing-chrome` — the whole app
downloading the marketing nav to get one SVG. Reverted to Rollup's own
per-module hoist and took a documented count bump instead (222 → 228), with
a note in `vite.config.ts` recording why the grouping is not there, so the
next person does not re-derive it.

**Swapping `<a href="#features">` for `Link to="/#features"`** was needed for
the fragment to resolve off the landing page, but it silently cost a
behaviour: `Link` changes no location when the hash is already current, so
clicking Features while parked on `/#features` stopped scrolling. Caught in
the browser, not by a test. `hash-scroll.ts` now covers both the arrival case
and the same-hash click.

Not verified by eye: the workspace Templates tab and the New-from-template
dialog. Both are behind a session, and the property that protects them — the
`"app"` default — is asserted in `template-gallery.test.tsx` instead.
