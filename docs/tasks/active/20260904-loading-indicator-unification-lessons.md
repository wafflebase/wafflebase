# Lessons — loading indicator unification

## The dev server on :5173 was not this checkout

The first "fix verified" measurement came back **identical to the bug** —
same 63px, same `Loading...` label — after a full page reload. The reflex
reading is "HMR is stale". It was not:

```
lsof -nP -iTCP:5173 -sTCP:LISTEN     → node … pid 53178
lsof -a -p 53178 -d cwd -Fn          → /Users/hackerwins/Development/wafflebase/waffleslides/…
```

A *different clone* of the repo was serving :5173. Every browser measurement
in this task — the original diagnosis included — was taken against
`waffleslides`, not the working tree.

The diagnosis survived only because that checkout happened to carry the same
pre-fix code. That was luck, not method.

**Rule:** before treating a browser measurement as evidence about *your*
edit, confirm the server is serving *your* directory:

```bash
lsof -a -p "$(lsof -nP -iTCP:<port> -sTCP:LISTEN -t)" -d cwd -Fn
```

Do it once, at the start, not after a confusing result. This repo has at
least three sibling clones (`wafflebase`, `wafflesheets`, `waffleslides`),
so a stray dev server is the expected case, not an edge case.

## A second dev server hits CORS, so prove the CSS instead

Starting a server on `:5199` from the right checkout did not finish the job:
the backend's `FRONTEND_URL` is `http://localhost:5173`, so `GET /auth/me`
from `:5199` is refused and the app redirects to `/login` before any editor
mounts. Reconfiguring the backend to test a CSS class would have been a large
detour for a small claim.

What worked: build the *layout condition* out of real DOM on whatever page
does render, against the app's real stylesheet — a 1016px `relative flex
flex-1 min-w-0` box, the same markup inside, measured with the old class list
and then the new one.

```
before: width  62px, off-centre by 477px
after:  width 1016px, off-centre by   0px
```

The 62px reproduced the 63px measured in the real editor, which is what makes
the probe trustworthy rather than merely suggestive. **A synthetic probe is
evidence when it reproduces the measured number**; without that anchor it is
just a second opinion.

## jsdom cannot see this class of bug, so the test has to say so

The regression is purely geometric and the unit lane runs in jsdom, where
every `getBoundingClientRect()` is a zero rect. Asserting the class contract
(`w-full`, `flex-1`) is the only thing the fast lane can do — so the test
carries a comment naming the real measurement it stands in for. A contract
test with no record of the geometry it protects reads like style policing and
gets deleted by the next person who tidies up.

## The scan found call sites the manual audit missed

The audit table for this task was assembled by reading files and listed 9
places spelling the label `Loading...`. The test that scans `src` found
**12** — `components/datasource-selector.tsx` and
`components/lakehouse-selector.tsx` were never opened, because the audit
started from the document-type views and those two are shared selectors.

Where a rule can be expressed as a scan over the tree, write the scan and let
it produce the list. A hand-built inventory of "everywhere X happens" is a
sample, and it is never labelled as one.
