---
title: Use and publish templates
description: Start a new document from a template, publish your own document as a template, and submit it to the public gallery.
type: how-to
---

# Use and publish templates

A template is a document that others can copy to start their own, without ever changing the original.

Any document type can be a template. Using one gives you a new document in your workspace with the template's content.

## Browse templates

Open the gallery in one of three ways:

- In the sidebar, click **Templates**. The **This workspace** tab lists templates published in your workspace, and **Public gallery** lists public ones.
- Go to `/templates` to see the public gallery. You don't need to be signed in.
- On the documents list, click **New** > **New from template**.

Each gallery has **Search templates**, filters for document type and category, and a sort menu with **Most used** and **Newest**. Click **Load more** at the bottom for more results.

![Workspace Templates page on the This workspace tab with search, filters, and three template cards](/images/collaborate/templates-gallery.png)

## Start a document from a template

1. On the documents list, open the folder you want the document in.
2. Click **New** > **New from template**.
3. Choose **This workspace** or **Public gallery**.
4. Click **Use** on a template.

The new document opens. It's named after the template and is in the current workspace and folder. An empty board also has a **Start from a template** link that opens the board templates.

### Use a template from its page

1. Open a template link, or click **Open** on a card in the sidebar's **Templates** page.
2. To look inside first, click **Preview**.
3. Under **Workspace**, choose where the new document goes.
4. Click **Use this template**.

If you aren't signed in, the button says **Sign in to use this template** and brings you back afterward.

You get your own document, with you as its author. If the workspace already has a document with that name, a number such as `(2)` is added. Comments, share links, and version history aren't copied.

## Publish a document as a template

::: info Before you start
- You need to be the document's author or a workspace owner.
- A sheet with a database or lakehouse tab can't be published.
:::

1. Open the document and click **Share** in the header.
2. In the **Template** section, enter a **Description**, for example *Monthly budget with a summary tab*.
3. Choose **Listed in this workspace** or **Anyone with the link**.
4. Click **Publish as template**.

The template link is copied to your clipboard. The card uses the document's title and a picture of the document as it looks now.

![Share dialog Template section with a Description, the visibility menu, and Publish as template](/images/collaborate/templates-publish.png)

## Edit a template's card

1. Open the document and click **Share**.
2. In the **Template** section, change **Description**, **Visibility**, **Category**, or **Tags** (separated by commas, up to 10).
3. Click **Save**.

The picture doesn't update as you edit the document. To refresh it, click **Update preview**.

Others in the workspace see the template's name, how many times it was used, and a copy button, but can't change it.

## Unpublish a template

1. Open the document and click **Share**.
2. In the **Template** section, click the trash icon (**Unpublish template**).

The card and its link stop working. Your document isn't changed, and documents people already made from it are theirs to keep.

## Choose who can find a template

| Visibility | Who can find and use it |
|---|---|
| **Anyone with the link** | Only people you send the link to. It isn't listed anywhere. |
| **This workspace** | Every member, on the workspace's **Templates** page, plus anyone with the link. |
| Public | Everyone, in the public gallery. Only a reviewer can make a template public. |

If someone opens a template they're not allowed to see, they get **Template not found**, the same as for a link that doesn't exist.

## Submit a template to the public gallery

1. Publish the document as a template first.
2. In the Share dialog's **Template** section, under **Public gallery**, click **Submit for review**.

Your username and profile picture will appear on the card, and you allow anyone to copy and change the content. Until a reviewer decides, your template keeps working as before, and you can't change its title, description, category, or picture.

The **Template** section shows the result, with any note from the reviewer, and you get a notification:

- **Approved**: the template appears in the public gallery.
- **Not accepted into the public gallery**: it keeps its earlier visibility. Fix what the note says and click **Submit again**.
- **Removed from the gallery by a reviewer**: the template stops working for everyone else and can't be edited, resubmitted, or unpublished. Your document isn't affected.

Editing a public template's document, or its title, description, category, or picture, sends it back for review.

Public templates need template review set up on your deployment. If it isn't, **Submit for review** shows an error. See [Optional features](/developers/self-hosting/optional-features) if you run your own server.

## Report a public template

1. Open the template's page while signed in.
2. Select a reason from **Report this template**.
3. Click **Send report**.

A reviewer looks at the report. Reporting doesn't hide the template.

## Related

- [Share a document](/collaborate/share) to give access to the original instead of a copy.
- [Folders](/collaborate/folders) to choose where new documents land.
- [Run a retro](/board/run-a-retro) to try a board template.
