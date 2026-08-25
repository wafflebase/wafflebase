# Lessons — subsetting font previews (#963)

## Attribute selectors match the whole attribute name

`findFontLink` queries `link[data-wafflebase-font]`. That selector matches
the attribute *exactly*, so a link carrying only `data-wafflebase-font-preview`
is invisible to it — which is precisely the property the split path needs.
Naming the marker as a prefix-extension of the existing one reads like it
would collide; it does not.

## A subset must cover the row, not the label

`MoreFontsDialog`'s row `<button>` sets `style={{ fontFamily }}`, so the
group-name span ("Sans-serif", "Handwriting") inherits it. Subsetting only
the label leaves the group text without `-` or `r` in that face, and the
browser silently paints it from the fallback — two faces on one line.
Reading the *row element's* `textContent` sidesteps the whole class of bug:
whatever the row paints in that family is what gets requested.

## Never assume weight 400 exists

`css2?family=Sunflower:wght@400` answers HTTP 400 with an HTML error page,
not CSS. A preview link that asks for a weight the family does not ship
therefore never resolves, and the row stays in a fallback face permanently —
a *worse* outcome than the full load it replaced. Weight has to come from
the entry's `weights`.

## An inert package that starts publishing a built entry needs `needs` edges

CI failed this branch on `verify:entropy` with `Could not parse knip output as
JSON` — a message that names no package, in a lane no frontend change should
be able to break. The cause was one commit earlier and elsewhere: #966 moved
`@wafflebase/design-editor`'s `exports["."]` from source to its built entry, so
knip — which *executes* `packages/design-sandbox/vite.config.ts` to discover
its plugins — could no longer resolve it in an unbuilt checkout.

The build did exist, folded into `design-editor:check`'s command. That is what
hid it: a step inside one lane's `cmd` cannot be a `needs` edge for another, so
every *consumer* of the output (entropy via `anyPkg`, `design-sandbox:check`)
ran without it. The fix is a `design-editor:build` lane the consumers name. The
general rule: when a package's `exports` starts pointing at `dist/`, its build
belongs in the lane graph rather than in a sibling lane's command line — and
`pnpm verify:fast` needs the same build for the same reason, which is why it was
red on a clean clone too.
