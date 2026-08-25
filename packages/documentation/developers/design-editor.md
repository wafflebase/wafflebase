# Design Editor

Change how Wafflebase looks — colours, spacing, a button's hover state — by
clicking on it, and turn what you changed into a pull request. The editor renders
the **real** application against real component source, so what you see is what
the committed code does.

You do not have to be able to write code to use it. You do need Node and a copy of
the repository; everything after that is two commands.

::: tip Nothing leaves your machine until you say so
The editor runs entirely on your computer. It has no backend, no database, and no
network access — the pages it renders answer their own data requests from
fixtures. Nothing is sent anywhere until you open a pull request, and that uses
the GitHub credentials already on your machine.
:::

## Before you start

| You need | How to check | If you do not have it |
|---|---|---|
| **Node 22 or newer** | `node --version` | Install the LTS build from [nodejs.org](https://nodejs.org) |
| **Git** | `git --version` | Install from [git-scm.com](https://git-scm.com) |
| **A name AND an address on your commits** | `git config --get user.name && git config --get user.email` — it must print two lines | `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`. Git needs **both**; one without the other still cannot commit. |
| A copy of the repository | — | `git clone https://github.com/wafflebase/wafflebase.git` |

Nothing else. You do **not** need pnpm, Docker, a database, or the GitHub CLI —
the steps below either prepare them or work without them.

## Step 1 — Open the editor

```bash
cd wafflebase
pnpm design
```

If you do not have pnpm yet, run `node scripts/design.mjs` instead. It is the same
thing, and it prepares pnpm for you.

The first run installs dependencies. Measured on a clone with nothing installed:
**about two minutes** to a working editor — longer on a slow connection, and
seconds on every run after that. It prints what it is doing and then opens your
browser:

```
✓ dependencies installed
✓ editor shell built
✓ the design editor is at http://localhost:5173/__design-editor/
```

Every later run skips whatever is already done and goes straight to the editor.
If the browser does not open by itself, click the printed address.

::: details The port may not be 5173
If something else is already using it, Vite takes the next free port and the
command prints the real one. Always use the address it printed.
:::

## Step 2 — Change something

The editor has three panes.

**Left — what you are looking at.** Two modes:

- **Components** — one piece of the design system on its own: a button, a card, a
  menu. Grouped into *Primitives* (things that stand alone) and *App components*
  (things that need data, which the editor invents for them).
- **Scenes** — a whole page of the real app: the documents list, the login screen,
  the settings page.

**Centre — the thing itself.** Drag the empty background to move it, `Ctrl`/`⌘` and
scroll to zoom around the pointer. The buttons above it switch a component's
variant and interaction state, so you can sit and look at a hover style without
holding the mouse still.

**Right — what you can change.**

- **Layout** shows the structure of what is on screen. Click a row to select that
  piece; a small editor appears beside it for spacing, size and alignment.
- **Bindings** is where colours live. Every colour is a *token* — a name like
  `primary` — and this pane says which token each part uses. Change the token, or
  change what the token itself resolves to, and everything using it follows.

Every change previews immediately. Nothing is written to any file yet.

## Step 3 — Save to code

The **Save to Code** button in the header shows how many changes are staged.
Pressing it opens a review with the component **as it is now beside how it will
be**, and under that the exact lines that will change in each file.

Nothing is written until you approve it. Once you do, the changes are in the
repository's files on your computer — and still nowhere else. See
[Where the changes went](#where-the-changes-went) if you want to look at them.

::: warning Leave the editor running
The next step reads the editor's record of what you changed, which lives in the
running server. If you close it, the pull request is still possible but its
description will be less precise. See [If the editor is closed](#if-the-editor-is-closed).
:::

## Where the changes went

Two places answer this, and both are in the editor's header.

**The write log** (the scroll icon, with a count beside it) lists everything written
this session, newest first — what each change was, and **which files it landed in**.
That is the durable record; the toast that appears at save time says the same thing
and then disappears.

**The ⓘ button** reports `Editing`, which is the folder the editor writes to. If you
have more than one copy of the repository — a second clone, or a git worktree —
this is the one that matters. Looking at `git diff` in a *different* copy shows
nothing, and nothing is wrong.

From a terminal in that folder, `git diff` shows the change itself. A colour
usually lands in `packages/core/src/tokens/` (that is where the design tokens
live); a change scoped to one component lands in that component's own file.

## Step 4 — Open a pull request

In a second terminal, in the same folder:

```bash
pnpm design-pr
```

It prints what it is about to do — the branch it will create, the files it will
commit, the title — and then does it. Add `--dry-run` to see that plan without
changing anything.

**It commits only the files the editor changed.** If you had other work in
progress, it is listed and left alone.

What happens next depends on what you have installed. You do not have to know
which case you are in; the command works it out and says so.

### If you have the GitHub CLI and write access

The branch is pushed and the pull request is opened. The command prints its
address and opens it in your browser. Done.

### If you have the GitHub CLI but no write access

Most people are here — you can read a repository you do not own. The command
creates your own copy (a *fork*), pushes there, and opens the pull request against
the original. You are asked to confirm the fork the first time.

### If you do not have the GitHub CLI

You still get a pull request. The command pushes your branch and opens GitHub's
"compare" page in your browser, which is a form with everything already filled in
— press the green button to create it.

This is the path that needs nothing but a browser. If you would rather have the
first case, install the [GitHub CLI](https://cli.github.com) and run
`gh auth login` once.

### If you have no `origin` to push to

The command stops and tells you. This happens when the repository was copied
rather than cloned. Clone it instead:

```bash
git clone https://github.com/wafflebase/wafflebase.git
```

## Writing a better description

The generated description lists what changed, taken from the editor's own record
of your edits — accurate, and a little dry.

If you have [Claude Code](https://claude.com/claude-code) installed, ask it to
open the pull request instead:

> Open a PR for my design changes

It reads the same record, looks at the resulting diff, and writes a title and
description a reviewer can act on — then hands them to the same command. You can
also pass your own:

```bash
pnpm design-pr --title "Soften the primary button's hover" --body-file notes.md
```

## If the editor is closed

The editor keeps its record of your edits in memory, so closing it loses the list
of *which* edits you made — the changed files themselves are safe on disk.

`pnpm design-pr` still works. It falls back to looking at every changed file in
the folder and says so in its output and in the pull request, so nobody mistakes
the wider list for the editor's own record. If that matters, reopen the editor
before you save.

## What it will never do

These are guarantees, not conventions:

- It never commits on `main` — it always creates a branch.
- It never commits a file the editor did not change.
- It never force-pushes and never overwrites an existing branch.
- It never stores or asks for a password or a token. `git` and `gh` run as you,
  with the credentials already on your machine.

## Troubleshooting

| What you see | What it means |
|---|---|
| `Node 22 or newer is required` | Install the LTS build from [nodejs.org](https://nodejs.org) and run the command again. |
| `Nothing has changed` | The editor has written nothing yet. Make a change, press **Save to Code**, approve it, then try again. |
| The page is blank, or a component says it needs app context | Some pieces of a design system cannot be shown on their own — a menu item needs its menu. Open the whole component instead of its part. |
| A change previews but the page looks unchanged | The editor is showing a different scene from the one you are thinking of. Check the name above the centre pane. |
| `git does not know who you are yet` | Git is missing `user.name`, `user.email`, or both — the message names which. Run the `git config --global` commands it prints for the ones it names, then try again. Nothing was changed. |
| `The push was refused` | You do not have write access and the GitHub CLI is not available to make you a fork. Install the [GitHub CLI](https://cli.github.com), or fork the repository on GitHub first and clone your fork. |
| You saved, but `git diff` shows nothing | You are almost certainly looking at a different copy of the repository. Press ⓘ in the editor's header and read `Editing` — that is the folder it writes to. |

## Using it on your own project

The editor is a Vite plugin, `@wafflebase/design-editor`, and the setup in this
repository is one example of a consumer. Standing it up on another project is a
developer task — see
[`design-sandbox-bringup`](https://github.com/wafflebase/wafflebase/blob/main/.claude/skills/design-sandbox-bringup/SKILL.md)
for what it takes.

It has been installed into a project outside this repository and run there, so
the claim is measured rather than intended. What that took, and the three defects
it found, are in
[`design-editor-packaging.md`](https://github.com/wafflebase/wafflebase/blob/main/docs/design/design-editor/design-editor-packaging.md).
The package is **not published to npm** — a consumer installs it from a tarball
(`npm pack`) or a workspace.
