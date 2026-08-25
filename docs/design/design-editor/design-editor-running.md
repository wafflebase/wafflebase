---
title: design-editor-running
target-version: 0.6.4
---

# Running the Design Editor

The operator's guide: how to boot the editor against wafflebase's own source, what each
URL is, which gates to run before believing it works, and how to reach the original
prototype if you ever need it.

The package READMEs
([`design-editor`](../../../packages/design-editor/README.md),
[`design-sandbox`](../../../packages/design-sandbox/README.md)) describe *what* each package
is. This describes *how to run it*, and is the document to reach for when something boots
but shows the wrong thing.

## Summary

One command:

```bash
pnpm design
```

It checks Node, prepares pnpm, installs and rebuilds the shell only when they are
missing or stale, starts the server and opens the browser at the URL Vite actually
printed. `pnpm design-pr` then turns what you changed into a pull request. Both are
documented for the person *using* the editor in
[the user guide](../../../packages/documentation/developers/design-editor.md); this
document is for the person maintaining it.

**That command exists to close the stale-shell trap**, which cost this project real
time more than once: the editor UI is served from a prebuilt `dist/shell`, not from
source, so
`pnpm --filter @wafflebase/design-sandbox dev` will happily serve yesterday's shell
against today's `App.tsx`. `pnpm design` compares mtimes and rebuilds when it has
to. Reach for the raw command only when you want to control the two halves
separately — and then run
`pnpm --filter @wafflebase/design-editor build` first. The scene half — the frame,
> the fixtures, the consumer's own components — *is* live over HMR, which is what
> makes the staleness easy to miss.

`packages/design-sandbox` is wafflebase's own instance of the editor — the consumer project
that configures `designEditor()` and points it at this repository. There is no separate
"editor app" to start.

## Goals / Non-Goals

**Goals.** Get a developer from a clean checkout to a rendered, editable wafflebase page,
and tell them how to know it is genuinely working rather than merely serving.

**Non-Goals.** Installing the plugin into a *foreign* project — that is the README's `Usage`
section. Nor the design of any of this, which is
[`design-editor-local-plugin.md`](./design-editor-local-plugin.md).

## Proposal Details

### 1. Boot it

```bash
pnpm design
```

That is the whole procedure, and it is the one to use: it installs on the first
run and rebuilds the shell when it is stale, which is the trap below. The two
halves separately, when you want to control them:

```bash
pnpm install                                        # once
pnpm --filter @wafflebase/design-editor build       # NOT optional — see below
pnpm --filter @wafflebase/design-sandbox dev
```

The server prints the line worth reading before the Vite banner:

```text
[design-editor] editing /home/you/wafflebase — open /__design-editor/
  VITE v6.4.3  ready in 551 ms
  ➜  Local:   http://localhost:5173/
```

The first line is the plugin telling you which tree it will **write to**. If that path is
not the repository you meant to edit, stop there.

### 2. The URLs

| URL | What it is |
| --- | --- |
| `/__design-editor/` | The shell — the three-pane editor. **This is the one to open.** |
| `/__design-editor/scene?scene=<id>&frame=<side>&theme=<light\|dark>` | One scene, alone in a frame. What the shell loads in its iframe; useful when a scene misbehaves and you want it without the chrome. |
| `/__design-editor/api/health` | What the plugin resolved: root, scene manifest, providers module, whether a token adapter is configured, and the alias table. |
| `/` | **404, and that is correct.** The dev server serves the editor's namespace, not the wafflebase app. |

`GET /__design-editor/api/health` is the first thing to read when the shell loads but looks wrong — it
answers "is my config actually wired?" before you start debugging a scene:

```bash
curl -s localhost:5173/__design-editor/api/health | jq
```

```json
{
  "ok": true,
  "root": "/home/you/wafflebase",
  "scenes": ".../packages/design-sandbox/scenes.config.json",
  "providers": ".../packages/design-sandbox/src/scenes/providers.tsx",
  "tokens": "configured",
  "aliases": [{ "find": "@", "replacement": "packages/frontend/src" }, "…"]
}
```

### 3. What you should see

Ten of the eleven scenes in `scenes.config.json` mount. Six are **dom** scenes (login,
documents, datasources, analytics, settings, settings-personal) and four are **canvas**
scenes (sheet / docs / slides / notes editors) that mount the real engines against a
detached Yorkie document.

`pdf-viewer` stays `deferred` and will not open: it needs the file's bytes at a blob URL,
which a table of JSON fixtures cannot produce. A deferred scene is shown disabled with its
reason rather than offered as a row that fails when clicked.

**Cold load is slow on WSL2/drvfs — roughly a minute for the first scene.** That is the
dependency optimiser, not a hang. Subsequent loads are fast. If you delete
`packages/design-sandbox/node_modules/.vite`, you pay it again.

### 4. Before believing it works

Serving is not the same as working. Three gates, none of them on CI — they need Chromium
and minutes:

```bash
# The frame against a project that is NOT wafflebase, so a wafflebase-shaped
# assumption fails here rather than in someone else's repo.
pnpm --filter @wafflebase/design-editor verify:consumer   # 57 checks
pnpm --filter @wafflebase/design-editor verify:frame      # 40 checks

# The same, against wafflebase itself: every scene mounts, is stampable, makes no
# unmocked request, and a class edit reaches real source.
pnpm --filter @wafflebase/design-sandbox verify:scenes    # 57 checks, ~15 min
```

Add `--write` to `verify:frame` or `verify:scenes` and they stop short of nothing: Approve
is pressed for real, the class lands in source, the bridge undoes it, and the bytes are
compared back. Both restore the file from a `finally` block, so an interrupted run does not
leave the tree edited.

`verify:scenes` rebuilds `@wafflebase/core` when its `dist` is older than its `src`. It has
to: the scenes resolve `@wafflebase/core/*` to built output, and a stale `dist` fails every
scene with `does not provide an export named …`, which reads as broken scenes rather than a
stale artefact.

### 5. When something is wrong

| Symptom | Cause |
| --- | --- |
| Shell loads, frame says `no scene "<id>" in the scene manifest` | The scene is `deferred`, or its id is not in `scenes.config.json`. |
| Every scene fails with `does not provide an export named …` | Stale `packages/core/dist`. Run `pnpm core build` (or just `verify:scenes`, which now does it). |
| A scene renders but is not clickable | Its file is not declared in the manifest's `components`, so the click has no source anchor. The outline marks which rows the frame can reach. |
| `unmocked request` in the console | The scene reached for data with no fixture. Requests are never allowed to leave the frame — add the fixture rather than letting it out. |
| Scene shows `Loading…` forever | The engine mounted but its document never resolved; check the offline Yorkie shim. |
| Scene renders but every Tailwind class is inert (`text-[28px]` computes to 16px) | The host stylesheet loaded without its compiler. `tailwindcss()` must be in the consumer's Vite plugins, and `@source` must point at wherever the classes live — Tailwind roots its scan at the project being built, not at the imported CSS. |
| Editor UI does not reflect a change you just made to it | The shell is prebuilt; see the note in the Summary. |

### 6. The original prototype

The editor was extracted from a prototype on the branch `feat/design-system`
(`packages/design-sdk`). Everything it implemented is now landed, dropped as a recorded
decision, or superseded — the per-file ledger is in
[`20260819-design-sandbox-scene-half-todo.md`](../../tasks/archive/2026/08/20260819-design-sandbox-scene-half-todo.md).
You should not need the prototype. This section exists because of one fact:

> **`feat/design-system` is local-only. It has never been pushed to any remote, so the
> branch on this machine is the only copy.**

On `main`, `packages/design-sdk` has **no tracked files** — #907 removed the last two, both
generated output. What remains on disk is 134 MB of `node_modules` and nothing else, which
`pnpm` cannot regenerate because the package has no manifest on `main`.

To run it, check the branch out into a worktree so the current one is undisturbed:

```bash
git worktree add ../wafflebase-prototype feat/design-system
cd ../wafflebase-prototype && pnpm install
pnpm --filter @wafflebase/design-sdk dev
```

Its own scripts were `dev`, `build`, `extract`, `smoke`, `verify:bridge`, `verify:frame`
and `poke` — the smoke scripts are what `verify-consumer` / `verify-frame` / `verify-scenes`
replaced.

**Unverified.** The commands above are read from the branch's `package.json`; they have not
been run since the extraction. The branch aliases into `packages/frontend/src` of its own
era, so checking it out as a whole should stay internally consistent — but treat a failure
there as expected rather than as a regression, and do not spend time on it unless you have a
specific reason to need the prototype.

## Risks and Mitigation

**Deleting the prototype branch is irreversible.** It is unpushed and its package is
untracked on `main`, so `git branch -D feat/design-system` destroys the only copy. The
parity ledger is closed, which makes deletion a defensible decision rather than a leap —
but it is still a decision, and this document is the reason it can be made deliberately.

**The editor writes to your working tree.** That is the point of it, and the reason
`verify:frame --write` exists: it proves the write lands and the undo restores. Backups go
to `node_modules/.cache/wafflebase-design-editor/`, never beside your source.
