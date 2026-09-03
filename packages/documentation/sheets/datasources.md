# External Datasources

A **datasource** connects a spreadsheet to external data. You write a SQL query
and its results appear in a read-only tab, right next to your regular editable
sheets.

There are two kinds of connection: a **PostgreSQL** database, and a
**Lakehouse** table held in object storage. Most of this page describes
PostgreSQL; see [Lakehouse tables](#lakehouse-tables) for the other.

## Connect a database

1. Click the **+** at the end of the tab bar. The menu offers **New Sheet**,
   **New DataSource**, and **New Lakehouse** — choose **New DataSource**.
2. The **Select DataSource** dialog lists the connections your workspace
   already has. Pick one to reuse it, or create a new connection and fill in
   its details:
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

## Lakehouse tables

The third entry in the **+** menu, **New Lakehouse**, reads a table sitting in
object storage instead of connecting to a database server. Choose the **table
format** — **Apache Iceberg** or **Delta Lake** — and the **storage** that holds
it: Amazon S3, an S3-compatible service, Google Cloud Storage, Azure Blob /
ADLS, or a local filesystem path the server has been configured to allow.

Lakehouse sources are shared with the workspace on exactly the same terms as
database connections, so the section below applies to them too.

## Connections are shared with the workspace

A saved connection belongs to the **workspace**, not to the person who created
it. Every member of the workspace can:

- choose the connection when creating a datasource tab,
- run queries through it — whoever presses **Execute**, the query runs against
  the username and password stored with the connection,
- change its connection details, or delete it.

Query **results**, by contrast, are never shared. Only the SQL text is saved
into the document, so a collaborator who opens a datasource tab sees the saved
query and an empty grid until they run it themselves.

::: warning
Point a datasource at a **least-privilege, read-only database account**.
Everyone in the workspace shares the credentials you save, so the account should
be able to reach only the data you are willing to show all of them.

Wafflebase accepts a single `SELECT` (or `WITH`) statement and rejects
statements such as `INSERT`, `UPDATE`, `DELETE`, and `DROP`. That check runs in
Wafflebase, though — a read-only database account is what actually guarantees a
query cannot change your data.
:::

## Good to know

- Database connections are **PostgreSQL**; Lakehouse sources read Apache
  Iceberg and Delta Lake tables.
- Only the latest query for a tab is saved.
