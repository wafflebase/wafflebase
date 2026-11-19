---
title: Getting started
description: Sign in, build a small contact list in a sheet, share it with a link, and watch a second person edit it live.
type: tutorial
---

# Getting started

In this tutorial you sign in, build a contact list in a sheet, share it with a link, and watch a second person edit it live. It takes about 10 minutes.

::: info Before you start
- You need a GitHub account. Some deployments also offer Google sign-in.
- Use a desktop browser. A second browser window, such as a private window, plays your collaborator.
:::

## 1. Sign in

1. Go to [wafflebase.io](https://wafflebase.io) and click **Sign in**.
2. Click **Continue with GitHub**, or **Continue with Google** if the page offers it.
3. Approve the request on the provider's page.

Wafflebase opens your workspace on its documents list. Your first sign-in creates the workspace for you.

## 2. Create a sheet

1. Click **New** in the top right of the documents list.
2. Select **New sheet**.
3. Click the title **New Sheet** in the header, type `Team contacts`, and press `Enter`.

The sheet opens with one tab, **Sheet1**. The sheet's new name also appears in the documents list.

## 3. Add your data

1. Click cell **A1**.
2. Type the data below. Press `Tab` to move right and `Enter` to move to the next row.

   | | A | B | C |
   |---|---|---|---|
   | 1 | Name | Email | Role |
   | 2 | Alice | alice@example.com | Engineer |
   | 3 | Bob | bob@example.com | Designer |
   | 4 | Carol | carol@example.com | Manager |

3. If the emails look cramped, point at the border between column headers **B** and **C**, then drag it to the right.
4. Select cells **A1** to **C1** and click **Bold** in the toolbar.

Your changes save as you type. The header shows **Saving…** and then **Saved**.

![Team contacts sheet with a bold header row and three contacts in columns A to C](/images/start/getting-started-contact-list.png)

## 4. Share the sheet

1. Click **Share** in the top right of the header.
2. Under **Permission**, select **Editor**. You can choose it because you created the sheet.
3. Leave **Expiration** set to **No limit**.
4. Click **Create link**.

The link is copied to your clipboard and listed under **Active links**. Anyone with the link can open the sheet without signing in.

![Share document dialog with Permission set to Editor and one link under Active links](/images/start/getting-started-share-dialog.png)

## 5. Edit together

1. Open a private browser window and paste the link into its address bar.
2. In the private window, click cell **A5**, type `Dave`, and press `Enter`.
3. Switch back to your first window.

`Dave` appears in cell **A5**. The other window's selected cell, now **A6**, shows a colored outline labeled **Anonymous**, because that visitor isn't signed in. The label fades after a few seconds; point at the outline to show it again. Their avatar also appears in the header.

![Team contacts sheet with Dave in A5, a collaborator's colored outline on A6, and their avatar in the header](/images/start/getting-started-edit-together.png)

To stop sharing, open **Share** again and click the trash icon (**Revoke link**) next to the link.

### On a phone

The same steps work on a phone. To edit a cell, double-tap it and type in the bar at the bottom of the screen, then tap the check mark (**Confirm editing**). See [Use Wafflebase on a phone](/start/phone).

## Next steps

- [Build a budget](/sheets/build-a-budget): add formulas, number formats, and totals to a sheet
- [Share a document](/collaborate/share): choose between viewer and editor links, and set an expiration
- [Concepts](/start/concepts): learn how workspaces, share links, and folders fit together
- Try another editor: [Docs](/docs-editor/), [Slides](/slides/), [Notes](/notes/), or [Board](/board/)
