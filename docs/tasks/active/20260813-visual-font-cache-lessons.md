# Lessons: replaying Google Fonts in the visual lane

## Read the whole failure population before believing "intermittent"

The report was one failing run. Pulling the `verify-browser` conclusion for
the last 80 CI runs turned "a flake" into "11 of 64, all one cause, on a
rotating cast of families" — which is what made it obvious the fix belonged
at the network boundary and not in the font-waiting code that three previous
passes had already been sharpened against. A single log would have sent me
back into `waitForFontsReady()` for a fourth time.

## Three failed fixes in the same function means the layer is wrong

`20260811-visual-inter-font-race-todo.md` records three rounds of fixing the
*wait*: add families, assert positively, refetch the stylesheet. Each was
correct and none could work, because a face whose fetch failed is in
`status: "error"` and no amount of waiting or same-URL refetching recovers a
negatively-cached response. The wait was never the defect; the dependency
was. When consecutive fixes to one function keep revealing new failure modes,
the question to ask is what that function is being asked to compensate for.

## Prefer removing an input over hardening against it

The gate was already as strict as it could usefully be. The fix was not a
better gate but fewer inputs: intercept the requests and answer them from
disk. Cost was ~170 KB and no baseline churn, because the fixtures are the
bytes the baselines were recorded against.

## Record fixtures in the environment that will replay them

The `css2` response varies by User-Agent: 19156 bytes recorded on macOS,
18891 in the Docker image CI uses. Recording locally would have committed a
stylesheet CI's Chromium never asked for. Any record/replay fixture wants to
be captured by the same client that replays it.

## Writing the README found the bug the tests did not

`save()` pruned every file it had not just written — correct for stale font
bodies, wrong the moment the directory got a `README.md`. The unit test
covered the prune and passed, because the test only ever put font bodies in
the directory. Adding documentation to a directory some code enumerates is
worth treating as a change to that code's input.

## Exercising the maintenance path found what the tests could not

Re-running `visual:record` to confirm a fix caught the flake live: Google
served a `css2` naming a Fraunces `woff2` that 404s (confirmed with `curl`),
then served the working one again minutes later. Two things fell out of one
accidental run — the failure was upstream serving a broken *stylesheet*, not
a flaky connection, so no client-side waiting could ever have fixed it; and
the record path wrote bodies as they arrived, so that failed pass left a new
`css2` under an old index. A run that reports failure should leave nothing
behind. Write-at-the-end, not write-as-you-go.

## Verify the negative case, not just the positive one

`verify-browser:docker` passing proves the cache is *usable*, not that it is
*used* — the network was up, so a broken interception would still have gone
green. Re-running with both hosts blackholed is what actually proves the
claim:

```bash
docker run --rm -v "$PWD:/workspace" \
  --add-host fonts.googleapis.com:0.0.0.0 \
  --add-host fonts.gstatic.com:0.0.0.0 \
  ...
```

Both, not one: the stylesheet and the font binaries come from different
hosts, and blocking only `googleapis` would leave the `woff2` fetches — the
requests that actually failed in CI — still going out. For any change whose
value is "X is no longer needed", the test to run is the one with X removed,
and "X" has to mean all of it.
