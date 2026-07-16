# Viewing PDFs

Wafflebase stores and displays **PDF files** alongside your sheets, docs,
slides, and notes. A PDF is a *view-only* document type — you upload the
original file, read it in the browser, and collaborate through comments and
presence, but the PDF's contents are never edited.

## Upload a PDF

1. Open your workspace
2. Click the **New** dropdown button
3. Select **Upload PDF**
4. Choose a `.pdf` file from your computer

The file uploads and opens in the viewer. It appears in your workspace document
list with a PDF badge, and its title defaults to the file name (which you can
rename).

## Read a PDF

The viewer renders every page in a single continuous scroll and fits each page
to the width of your window. Resizing the window — or collapsing the sidebar —
reflows the pages to match. A progress bar shows while the file downloads on
first open.

- **Scroll** to move through the pages
- Pages render as you reach them, so large files stay responsive

::: tip
PDFs are read-only. To make changes, edit the source elsewhere and upload a new
version.
:::

## Rename a PDF

Click the title in the header to rename the document. The change is reflected in
your workspace list right away.

## Comment on a PDF

Even though the PDF itself can't be edited, you and your teammates can hold a
discussion pinned to specific regions of a page.

### Add a comment

1. Click **Add comment** in the header
2. Drag a rectangle over the part of the page you want to comment on
3. Type your comment in the composer that appears and post it

The comment is anchored to that page and region, so it stays put as everyone
scrolls.

### The comments panel

Click **Show comments** in the header to open the side panel. It lists every
thread, labeled by page. Select a thread to:

- **Reply** to continue the discussion
- **Resolve** (or reopen) it once it's addressed
- **Edit** or **Delete** your own comments

## Collaborate in Real Time

PDF documents carry the same live collaboration as the rest of Wafflebase — the
file bytes stay static, but comments and presence sync instantly:

- **Presence** — avatars in the header show who else is viewing, and follow each
  person to the page they're currently reading
- **Comments** — new threads and replies appear for everyone without a refresh

### Share a PDF

Click **Share** in the header to create a link. Recipients can open and read the
PDF — and, with an edit link, comment on it — without signing in. Viewing is
open to anyone with a valid link; commenting requires an edit link or workspace
membership. See [Collaboration & Sharing](/guide/collaboration) for the full
sharing flow.

## Good to Know

- PDFs are **view-only** — there is no in-app annotation or re-export; comments
  live *over* the file and never change its bytes
- The original file is stored intact and served only to people with permission
  to read the document
- Self-hosting? PDF uploads need blob storage configured — see
  [Self-Hosting](/developers/self-hosting)
