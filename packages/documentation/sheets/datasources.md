# External Datasources

A **datasource** connects a spreadsheet to an external PostgreSQL database. You
write a SQL query and its results appear in a read-only tab, right next to your
regular editable sheets.

## Connect a database

1. Click the **+** at the end of the tab bar and choose **New DataSource**.
2. In the **Select DataSource** dialog, fill in the connection details:
   - **Name** — a label for the connection
   - **Host** and **Port** (defaults to `5432`)
   - **Database**, **Username**, and **Password**
   - **SSL** — toggle on if your database requires it
3. Click **Test Connection** to confirm the credentials work, then save.

A new tab is added with a database icon to distinguish it from sheet tabs.

## Run a query

The datasource tab has a SQL editor at the top and a results grid below it.

1. Type a `SELECT` query — for example, `SELECT * FROM users LIMIT 100`.
2. Click **Execute**, or press **⌘+Enter** / **Ctrl+Enter**.

The results load into the grid below: the first row holds the column names and
each following row is a record. Re-run the query with **Execute** whenever you
want fresh data — results don't refresh automatically.

::: tip
Queries are capped at 10,000 rows and a 30-second runtime, so add a `LIMIT`
clause when exploring large tables.
:::

## Working with results

- The results grid is **read-only** — it reflects the database, so you can't
  edit, sort, or filter the cells in place. Shape the data with SQL instead.
- Reference query results from other tabs with formulas, just like any sheet,
  to build summaries and dashboards on top of live data.

## Good to know

- Datasources connect to **PostgreSQL** databases.
- The connection belongs to the person who created it. Collaborators can see the
  query and its last results, but run their own connection to execute it.
- Only the latest query for a tab is saved.
