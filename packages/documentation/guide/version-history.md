# Version History

Wafflebase keeps a history of every sheet, document, presentation, note, and
board as you work. You can look back at an earlier version, open it read-only,
and roll the document back to it — and rolling back is itself reversible.

History is kept for the five editable document types. PDFs, images, and other
uploaded files are stored as they were uploaded and have no version history.

## Open the panel

Click the **history** icon in the editor header. It is a toggle, not a menu
item: clicking it again closes the panel, which docks on the right side of the
editor.

The panel is available when you are signed in and opening the document from
your workspace. It is not part of a share link — someone reading or editing
through a shared URL has no history panel and no way to restore.

::: warning Presentations need a wide window
Under 768 pixels wide — so most phones — a presentation opens in a mobile
layout that has no history icon and no panel. The history is still being kept;
you just cannot reach it until you open the deck on a wider screen. Sheets,
documents, notes, and boards keep the icon at every width.
:::

## What the list shows

Versions are grouped under a heading per day — the weekday and full date,
written the way your browser's language settings write dates — newest first,
with the time beside each entry.

Most entries are named **Automatic**. Wafflebase does not decide when those are
taken — the server records one each time it snapshots the document, so the
timeline follows editing activity rather than the clock. A quiet week produces
no entries; an afternoon of heavy editing produces several.

The entries that are not automatic are the ones a person created: versions you
named, and the **Before restore** versions that a restore creates. Those carry
their author, and **By you** appears under any of them that you created
yourself. An automatic version has no author to show.

If the document is new enough to have no versions yet, the panel says **No
versions yet** rather than showing an empty list.

## Name the current version

To mark a moment you will want to find again, type a label into **Name current
version** at the top of the panel and click **Save**. The new entry appears in
the list immediately.

Naming applies to the document **as it is right now**. There is no way to
rename a version after the fact — an entry in the list offers **Preview** and
**Restore** and nothing else — so name the state you are in before you move on
from it.

## Preview a version

**Preview** opens that version read-only over your editor, with a banner
reading *Viewing … from …*. Nothing is changed by looking.

While a preview is open the editing toolbar is removed rather than dimmed, and
keyboard shortcuts do not reach the live document — so an absent-minded
**⌘+Z** / **Ctrl+Z** cannot undo real work behind the preview. The history panel stays
beside it and stays clickable: select another entry to page straight to it.
Click **Back to current version** to leave.

What a preview shows depends on the document type:

| Type | In a preview |
|------|--------------|
| **Sheet** | The first tab only. The tab bar is covered, so you cannot switch tabs inside a preview, and a note above the grid says that charts and images are not drawn. |
| **Document** | The paginated document, read-only. The comments panel closes while the preview is open and reopens when you leave. |
| **Presentation** | One slide at a time — use the **‹ / ›** control in the banner to move through the deck. |
| **Note** | The rendered markdown, without the source pane. |
| **Board** | The whole board, framed to fit its content. There is no panning or zooming inside a board preview. |

A sheet whose tabs are all external (a datasource or lakehouse connection) has
nothing to draw, and says so: those rows live in the connected database, not in
the document.

## Restore a version

**Restore** rolls the document back. Before it does anything else, Wafflebase
saves the state you are leaving as a version called **Before restore**, so a
restore is always reversible — if the version you picked was the wrong one,
restore **Before restore**. If that safety version cannot be saved, the restore
does not run at all.

A restore replaces the whole document, not just the part a preview happened to
show: every tab of a sheet, every slide of a deck. Your undo history is
discarded at the same time, because it describes a document that no longer
exists — **⌘+Z** / **Ctrl+Z** will not walk a restore back, and **Before
restore** is what you use instead.

::: warning Comments come back with the version
[Comments](/guide/collaboration#comments-mentions) live inside the document, so
they are part of the version being restored. Any comment added after that
version was created is removed along with the rest of the newer content. The
confirmation dialog says so before you commit.
:::

::: warning Only one of the two Restore buttons asks you to confirm
**Restore** in the version list opens a confirmation dialog first, so you can
back out. **Restore this version** inside an open preview does **not** — it
restores immediately, on the reasoning that the preview you are looking at is
itself the confirmation. If you previewed a version to check it and then decide
against restoring it, leave with **Back to current version** rather than
expecting a dialog to catch you.
:::

Only one restore runs at a time. If a collaborator's restore — or your own,
started from a preview — is already in flight, the buttons are disabled and a
second attempt is refused with *A restore is already in progress* rather than
queued. Everything that fails says so in the panel; a restore never fails
quietly.

## Limits

- **The panel shows the 50 most recent versions.** There is no paging and no
  "load older": on a long-lived document, versions past the 50th are not
  reachable from the panel at all.
- **Versions cannot be deleted or renamed** from the panel.
- **Signed-in only.** History is absent from share links entirely, for viewers
  and editors alike.
- **No history for PDFs, images, or other uploaded files.**
- **Presentations have no history panel below 768 pixels wide.**
