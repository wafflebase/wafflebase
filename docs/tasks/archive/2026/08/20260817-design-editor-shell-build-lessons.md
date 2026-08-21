# Lessons — the shell build (PR 11a, #879)

## `plugin-react` does not transform a virtual module, and the id extension does not help

Measured against a live Vite 6.4.3: a virtual module served with a `.tsx` id reaches
`vite:import-analysis` with its JSX intact and 500s, while the same source in a real file under
`node_modules` is transformed normally. That is why the scene entry is a real file whose URL the
server substitutes per request, rather than a generated module — a shape that would have looked
tidier and did not work.

## A document served as static bytes misses the preamble, and the symptom is silence

`plugin-react` injects its fast-refresh preamble through `transformIndexHtml`. Serving
`scene.html` as bytes skips that hook: React mounts, renders nothing, and logs one line about a
missing preamble. Routing the document through `transformIndexHtml` is the fix; noticing it at
all needed a browser, which is the argument for `verify:frame` existing at the next step.

## Two Reacts was a plausible risk that measurement removed

11a recorded that `react` imported from inside our package would find OUR copy and break hooks
in the components under review, and planned a peer dependency plus `resolve.dedupe`. Probed with
two marked React copies: Vite's optimizer pre-bundles `react` once from the project root and
both our entry and the consumer's components import that chunk. Neither mitigation was needed —
and the same reasoning did NOT transfer to `design-sandbox` later, where the root differs and
`dedupe` genuinely matters. A measurement is about one boundary, not the class of them.
