# Templates

Publish a document as a template and other people can start their own copy of
it. Using a template never touches the original: the person who uses it gets a
new document in their own workspace, and edits it from there.

Any document type can be published — sheets, documents, presentations, notes,
boards, and uploaded files alike.

## Publish a document as a template

1. Open the document and click **Share** in the editor header
2. Scroll to the **Template** section at the bottom of the dialog
3. Choose who it is for — **Listed in this workspace** or **Anyone with the
   link**
4. Click **Publish as template**

The template link (`/t/<id>`) is created and copied to your clipboard. A
picture of the document is taken from the open editor and attached to the card;
if that is not possible the card falls back to the document-type icon.

Only the document's **author** or an **owner** of its workspace can publish —
the same authority it takes to create an editor share link, and for the same
reason: a template hands the content to an audience that workspace membership
no longer bounds. Everyone else sees the controls disabled with a note saying
so, and the rule is enforced on the server, not just in the dialog.

A document has at most one listing. Publishing again updates the one that
exists rather than creating a second, and the link stays the same.

::: warning Sheets connected to external data cannot be published
A datasource or lakehouse tab points at a connection that belongs to *your*
workspace, so it would be empty for anyone who used the template. Publishing
refuses such a sheet and names the tabs responsible. This is checked again when
someone uses the template, so connecting a tab after publishing stops the
template working rather than handing out a dead tab.
:::

### Tune the card

Once a listing exists, the same section lets you set its **category** (from a
fixed list) and **tags** (freeform, comma-separated — they are lowercased,
de-duplicated, and capped at ten), change its visibility, and take a fresh
picture with **Update preview**. A thumbnail is a snapshot, not a live render,
so it goes stale as you edit the document; **Update preview** is how you
refresh it, and it is offered only while an editor that can take the picture is
open.

The card's title comes from the document's title at publish time. There is no
description field in the dialog today.

**Unpublish** (the bin icon) removes the card and revokes its preview link. The
document itself is untouched.

## The three tiers

| Visibility | Who can find it |
|-----------|-----------------|
| **Anyone with the link** | Only people you send the link to. The listing appears in no gallery — holding the link is the whole of the access. |
| **This workspace** | Listed in the workspace's **Templates** tab for every member, and usable by anyone holding the link as well. |
| **Public** | Listed in the public gallery for anyone, signed in or not. Reached only through review — see below. |

You can change a listing between the first two at any time from the Share
dialog. **Public** is never something you set yourself.

## Browse templates

- **Workspace → Templates** in the sidebar lists the templates published in
  that workspace, with the public gallery on a second tab. Choosing a card
  opens its template page.
- **/templates** is the public gallery on its own, and it renders for someone
  who has never signed in. Choosing a card opens its template page; only
  *using* one needs an account.
- **New → New from template** on a workspace's documents list opens a picker
  with the same two tabs. This one creates the document immediately, into the
  workspace and folder you are looking at.

Every gallery has a search box, filters for document type and category, and a
sort between **Most used** and **Newest**. Results load a page at a time with
**Load more**.

::: tip
A card shows how many times a template has been used. Uses by the publisher
themselves are not counted.
:::

## Use a template

The template page (`/t/<id>`) shows the title, who shared it, the document
type, the use count, and the picture. **Preview** opens the real read-only
viewer on the actual document, rather than a screenshot.

Click **Use this template** and pick a destination workspace. You get:

- **A new document of your own**, named after the template. If you already have
  a document by that name in the destination, the new one gets a `(2)`, `(3)`
  suffix rather than a "(copy)" — a document started from a *Weekly Report*
  template is a weekly report, not a copy of one.
- **Authored by you**, in the workspace you chose. Started from the **New from
  template** picker instead, it lands in the folder you were viewing.
- **The content only.** Comments, share links, and version history are not
  carried over; the new document starts its own.

If you are not signed in, the button reads **Sign in to use this template** and
brings you back to the same page afterwards.

::: warning A template you may not see reports as missing
Opening a template you are not allowed to see gives you **Template not found**,
the same answer as a link that never existed — whether a workspace has
published a template is itself workspace information. If a colleague's link
does not open for you, ask them which tier it is on rather than assuming the
link is broken.
:::

## The public gallery

The public tier is the only one that goes through review.

**To submit:** open the document's Share dialog and use **Submit for review**
in the **Public gallery** box. Submitting states what it costs you: your
username and profile picture appear on the card, and you grant anyone
permission to copy and modify the content.

Submitting changes nothing anyone else can observe. Your listing keeps working
at the tier it already had, and links you have handed out keep resolving; only
a reviewer's approval moves it to the public tier.

While a submission is pending you cannot change the card's title, category, or
picture — a reviewer is looking at a fixed thing. The listing's own panel shows
where the submission stands, along with whatever note the reviewer left, and
that panel is the durable copy of the decision. (Notifications about approvals,
rejections, and takedowns also reach the bell in the header — see
[Collaboration & Sharing](./collaboration#notifications).)

### Rejection and takedown are different

- A **rejection** says the submission did not make the gallery's bar. Your
  listing keeps working exactly as it did before you submitted, at its existing
  tier. You can act on the reviewer's note and use **Submit again**.
- A **takedown** says the content may not be served at all. The listing stops
  answering for everyone but you, its preview link is revoked, and it cannot be
  used, re-submitted, re-published, edited, or unpublished. Your own document is
  untouched, and you can still copy or share it by other means.

### Once a template is public

A public listing tracks the live document, so editing that document takes the
card out of the gallery and back into the review queue until someone looks
again. Changing the card's title, category, or picture does the same. That is
deliberate: the gallery should only show what a reviewer actually approved.

Anyone signed in can **report** a public template from its page, choosing a
reason. A report is a message to a reviewer and nothing else — it does not hide
the listing or count toward any threshold.

::: warning The public tier depends on deployment configuration
Public templates need the deployment to have designated reviewers and to have a
particular security setting switched on. Where either is missing, **Submit for
review** fails with a message saying which — nothing is left silently pending.
The workspace and link tiers are unaffected and work on every deployment.
:::

Deployments that do designate reviewers give them a queue at `/admin/templates`
listing pending submissions and open reports, where each can be approved,
rejected, or taken down. Closing a report is a separate action from deciding
the listing, so a report can be dismissed without removing anything.
