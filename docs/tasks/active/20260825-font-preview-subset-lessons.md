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
