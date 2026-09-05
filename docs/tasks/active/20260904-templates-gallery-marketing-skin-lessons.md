# Lessons — templates gallery marketing skin

## A `manualChunks` group can be worse than the chunks it removes

Six tiny hoisted chunks look like a bundling mistake worth correcting. They
were not. Grouping the marketing chrome under `manualChunks` pulled a shared
leaf (`waffle-logo`, which `components/app-sidebar` imports) into the named
chunk, and with it the app entry — turning a 6 × ~1 kB deferral into a 44 kB
chunk that ~80 route chunks imported eagerly.

The tell was cheap and I nearly skipped it: after the "fix", `marketing-page`
should have been imported by two chunks. It was imported by everything.
**Check the import edges of a chunk you just created**, not only the count:

```bash
# $1 is the chunk you just created, e.g. marketing-page-ByPaM1fb.js
node -e "const fs=require('fs'),d='packages/frontend/dist/assets/',t=process.argv[1];
for(const f of fs.readdirSync(d).filter(n=>n.endsWith('.js')))
  if(f!==t && fs.readFileSync(d+f,'utf8').includes(t)) console.log(f)" "$1"
```

A chunk count going down is not evidence the download shape improved.

## Replacing an anchor with a router `Link` silently drops a behaviour

`<a href="#features">` scrolls on *every* click. `<Link to="/#features">`
scrolls on none — it only changes location, and if the hash is already
current, nothing re-renders and no effect fires. The cross-route case (the
one the change was *for*) worked immediately, which is exactly why the
regression was easy to miss: the new path was green and the old one was not
retested.

When swapping a native element for a framework one, enumerate what the native
element did for free and check each in the browser. Here it was two cases
(arrive-with-hash, click-at-same-hash) and only the first was on the plan.

## Pin the default, not the opt-in

`TemplateGallery` is shared by one public and two in-app surfaces. The test
worth writing was not "the marketing skin looks right" — it was
"`skin` defaults to `app`", because that is the property whose loss would
leak marketing chrome into the product, and it is invisible in review.
