---
title: Connect a database
description: Run a SQL query against a PostgreSQL database and see the results in a read-only tab of your sheet.
type: how-to
---

# Connect a database

Run a SQL query against a PostgreSQL database and see the results in a read-only tab of your sheet.

::: info Before you start
- Connections are shared with the workspace. Every member queries with the credentials you save, so use a read-only account.
- Queries must be a single `SELECT` or `WITH` statement. Results stop at 10,000 rows, and a query stops after 30 seconds.
- Only workspace members can run a query. On a share link you see the saved query but can't run it.
:::

## Add a data source tab

1. Open the sheet. At the end of the tab bar, click the arrow next to **+** (**More tab types**) and select **Connect data source (SQL)…**.
2. In **Select data source**, choose a connection your workspace already has and click **Select**. To add one, click **New connection** and continue below.
3. In **New data source connection**, enter the **Name**, **Host**, **Port** (default `5432`), **Database**, **Username**, and **Password**.
4. Turn on **Enable SSL** if the database requires it.
5. Click **Test connection**. A message confirms `Connected to <host>`, or says why it couldn't connect.
6. Click **Save**.

A new tab named after the connection opens. A database icon marks it as a data source tab.

![New data source connection dialog with host, port, database, and Enable SSL fields](/images/sheets/connect-a-database-dialog.png)

## Run a query

1. Open the data source tab.
2. Type a query in the SQL box, for example:

   ```sql
   SELECT region, SUM(amount) AS revenue
   FROM orders
   GROUP BY region
   ORDER BY revenue DESC
   LIMIT 100
   ```

3. Click **Execute**, or press `⌘+Enter` / `Ctrl+Enter`.

The results fill the grid. The first row holds the column names, and the status line shows the row count and time, such as `42 rows in 118ms`. A result that hit the limit says `(truncated)`.

Results don't refresh on their own. Click **Execute** again for fresh data.

![Data source tab with a SQL query, the Execute button, and a results grid](/images/sheets/connect-a-database-results.png)

## Use the results in a sheet

The results grid is read-only: you can select and copy cells, but not edit, sort, or filter them. Shape the data in SQL instead.

To build on the results:

1. Select the cells in the results grid and press `⌘+C` / `Ctrl+C`.
2. Open a sheet tab, click the first cell, and press `⌘+V` / `Ctrl+V`.

A formula in another tab can't read a data source tab. A reference such as `=Sales!A1` returns an empty value.

## Edit or delete a connection

1. In the workspace sidebar, click **Settings**, then scroll to **Data sources**.
2. Find the connection and open its menu (**⋯**).
3. Select **Test connection**, **Edit**, or **Delete**.

In **Edit data source**, leave **Password** blank to keep the current one, then click **Save changes**. To add a connection from settings, click **New data source**.

::: warning
**Delete** removes the connection right away, with no confirmation, for everyone in the workspace.
:::

## What is saved in the document

- The query text is saved on the tab, so collaborators see it.
- The results are not saved. Each person sees an empty grid until they click **Execute**.
- Only the latest query for a tab is kept.

## Known limitations

- PostgreSQL is the only database you can connect from the app.
- A query that contains a word such as `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, or `ALTER` anywhere, even inside a quoted string, is refused with `Forbidden keyword: …`.
- Running more than one statement is refused with `Multiple statements are not allowed`.
- Conditional formatting and data validation aren't available on data source tabs.

## Related

- [Lakehouse tables](/sheets/lakehouse) to read Iceberg or Delta Lake tables from object storage.
- [Workspaces](/collaborate/workspaces) to see who can use a shared connection.
- [Troubleshooting](/start/troubleshooting#only-select-queries-are-allowed) if a query fails with `Only SELECT queries are allowed`.
