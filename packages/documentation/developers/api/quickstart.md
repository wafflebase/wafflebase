---
title: Make your first API call
description: Create an API key, list your documents, and write cells into a new sheet with curl.
type: tutorial
---

# Make your first API call

In this tutorial you create an API key, list your documents, and write a small sales table into a new sheet with `curl`. It takes about 10 minutes.

::: info Before you start
- You need to be a member of a Wafflebase workspace.
- You need `curl` and [`jq`](https://jqlang.org/) in a terminal.
- On a self-hosted server, replace `https://api.wafflebase.io` with your API origin.
:::

## 1. Create an API key

1. Open your workspace in the browser and click **Settings** in the sidebar.
2. In the **API keys** section, click **Create API key**.
3. Enter a name, such as `Quickstart`, and click **Create**.
4. In the **API key created** dialog, click the copy icon (**Copy API key**), then click **Done**.

The key starts with `wfb_` and is shown only once. If you lose it, revoke it and create another.

![The API key created dialog showing a new wfb_ key with its copy button](/images/developers/api-quickstart-key-created.png)

### On a phone

The **Settings** page stacks its sections. **Create API key** sits under the **API keys** heading instead of beside it.

![The API keys section on a phone with Create API key under the heading](/images/developers/api-quickstart-key-created-mobile.png)

## 2. Set up your shell

1. Note your workspace slug. It is the part after `/w/` in the address bar, for example `acme` in `/w/acme/settings`.
2. Set three variables in your terminal:

   ```bash
   export WFB_API=https://api.wafflebase.io/api/v1
   export WFB_KEY=wfb_paste_your_key_here
   export WS=acme
   ```

Every command below uses these variables.

## 3. List your documents

1. Run:

   ```bash
   curl -s -H "Authorization: Bearer $WFB_KEY" \
     "$WFB_API/workspaces/$WS/documents" | jq '.[] | {id, title, type}'
   ```

You see one object per document in the workspace. An empty workspace prints nothing.

If you get `401`, check that `WFB_KEY` holds the whole key. If you get `403 API key is not scoped to this workspace`, the key was created in a different workspace than `WS`.

## 4. Create a sheet and write cells

1. Create a sheet and keep its ID:

   ```bash
   DOC=$(curl -s -X POST \
     -H "Authorization: Bearer $WFB_KEY" \
     -H "Content-Type: application/json" \
     -d '{"title": "Q1 Sales"}' \
     "$WFB_API/workspaces/$WS/documents" | jq -r .id)
   echo $DOC
   ```

2. Write a header row, three rows of data, and a total in one request:

   ```bash
   curl -s -X PATCH \
     -H "Authorization: Bearer $WFB_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "cells": {
         "A1": {"value": "Rep", "style": {"b": true}},
         "B1": {"value": "Revenue", "style": {"b": true}},
         "A2": "Alice", "B2": "12500",
         "A3": "Bob",   "B3": "9800",
         "A4": "Carol", "B4": "14200",
         "A5": {"value": "Total", "style": {"b": true}},
         "B5": "=SUM(B2:B4)"
       }
     }' \
     "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/cells"
   ```

The response is `{"updated":10}`. The first write to a new sheet creates its one tab, with the ID `tab-1`. A plain string is stored as a value, and a string that starts with `=` is stored as a formula.

## 5. Read the cells back

1. List the sheet's tabs:

   ```bash
   curl -s -H "Authorization: Bearer $WFB_KEY" \
     "$WFB_API/workspaces/$WS/documents/$DOC/tabs"
   ```

   You see `[{"id":"tab-1","name":"Sheet1","type":"sheet"}]`.

2. Read the range you wrote:

   ```bash
   curl -s -H "Authorization: Bearer $WFB_KEY" \
     "$WFB_API/workspaces/$WS/documents/$DOC/tabs/tab-1/cells?range=A1:B5" \
     | jq '.[] | {ref, value, formula}'
   ```

   Each cell comes back with its `ref`, `value`, `formula`, and `style`. The API stores formulas but does not evaluate them, so `B5` comes back with `formula` `=SUM(B2:B4)` and an empty `value`.

3. Open the workspace in your browser and open **Q1 Sales**.

The sheet shows the table you wrote, with a bold header row and a **Total** row. Opening the sheet does not recalculate formulas written through the API, so the **Total** cell stays blank until you edit one of the cells it sums, such as `B2`. Then it shows `36500`.

![The Q1 Sales sheet written through the API, with a bold header row and a Total row](/images/developers/api-quickstart-sheet.png)

## What you learned

- An API key acts as you, in one workspace.
- `PATCH .../cells` writes many cells at once, with values, formulas, and styles.
- The API stores formulas; the editor calculates their results.

## Next steps

- [Sheets](/developers/api/sheets) for every cell, tab, and row endpoint.
- [REST API overview](/developers/api/) for scopes, errors, and rate limits.
- [Document content](/developers/api/content) to write docs, notes, and decks.
- [Use the CLI](/developers/cli/sheets#import-and-export-csv-or-json) to load a CSV file into a sheet in one command.
