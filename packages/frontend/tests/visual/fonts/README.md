# Recorded Google Fonts responses

Test fixtures. `scripts/google-font-cache.mjs` serves these to the visual
lane's Chromium instead of letting it reach `fonts.googleapis.com` /
`fonts.gstatic.com`, which is what stopped `verify-browser` failing ~17% of
the time on a font fetch that had nothing to do with the branch under test.

`index.json` maps request URL → body file + `Content-Type`. Both the URL set
and the bytes are exactly what Google served, which is why adding this
changed no baseline.

## Refreshing

Needed when `packages/frontend/index.html`'s `css2` query changes, or when a
scenario starts painting a family the cache has never seen — the lane will
tell you, by URL, and fail until you do it.

```bash
pnpm frontend test:visual:browser:docker:record   # commit the result
```

In Docker, because the `css2` response varies by User-Agent and CI's Chromium
is the one that has to be able to parse it. Recording refetches everything
rather than honouring what is already here — the `css2` URL does not change
when Google ships a new font version, so trusting the stored copy would make
a refresh a silent no-op. It also prunes bodies the new index no longer
references, so a family that leaves `index.html` leaves here too. No git diff
after a record means upstream has not changed.

## Licensing

Inter, Fraunces and JetBrains Mono are all under the SIL Open Font License
1.1, which permits redistribution of the font files. These are the same
subsetted `woff2` files the app already ships to every visitor via Google
Fonts; nothing here is repackaged or modified.
