# Lakehouse Tables

A **Lakehouse** tab reads an open-table-format table sitting in object storage —
Apache Iceberg or Delta Lake — straight into a read-only grid, without a
database server in between. It also gives you a **time-travel slider** over the
table's own commit history, so you can look at the table as it was at an earlier
commit.

Lakehouse connections live alongside database connections; see
[External Datasources](./datasources) for the SQL side of the feature.

## Create a Lakehouse Tab

1. Click the **+** at the end of the tab bar and choose **New Lakehouse**.
2. The **Select Lakehouse** dialog lists the Lakehouse connections your
   workspace already has. Click one to select it and click **Select**
   (double-clicking a connection does both), or click **New Connection** to set
   one up.

The new tab is named after the connection and carries a warehouse icon.

## Set Up a Connection

**New Lakehouse Connection** asks for:

- **Name** — a label for the connection.
- **Table format** — **Apache Iceberg** or **Delta Lake**.
- **Storage** — where the table lives (see below).
- **Bucket** (labelled **Container** for Azure) and, for the S3 backends,
  **Region** (defaults to `us-east-1`).
- **Endpoint** — required for S3-compatible storage, optional for Azure.
- The table path itself, labelled **Iceberg metadata file (.metadata.json)** or
  **Delta table root** depending on the format you picked.
- Credentials for the storage backend.

Click **Test Connection** to check it without saving, then **Save**.

### Storage backends

| Storage | What it needs |
|---------|---------------|
| Amazon S3 | Bucket, Region, **Access key** + **Secret key**, optional **Session token** |
| S3-compatible | Bucket, Region, an **Endpoint** (`http://` or `https://`, host only — no path), **Access key** + **Secret key**, optional **Session token** |
| Google Cloud Storage | Bucket, **Access key** + **Secret key** — these are GCS *interoperability* HMAC keys, not a Google OAuth token |
| Azure Blob / ADLS | Container, an optional **Custom endpoint**, and either a **Connection string** on its own or an **Account name** with an **Account key** *or* a **SAS token** |
| Local filesystem (server-configured) | Just an absolute path — see below |

Access key and secret key always travel together: the dialog refuses a change
that supplies one without the other. When you reopen a saved connection, the
credential boxes read *"Leave blank to keep existing"* — leaving them empty
keeps what's stored.

::: warning
**Local filesystem** only works if the operator has switched it on. The dialog
says so directly — *"Local paths must be enabled and scoped by the Wafflebase
server"* — and a server that has not enabled it answers *"Local lakehouse paths
are disabled on this server."* When it is enabled, the path must sit inside the
one root directory the operator configured.

**Custom endpoints are allowlisted too.** An S3-compatible endpoint, an Azure
custom endpoint, or any other non-default endpoint must be an exact match for
something the operator has permitted, or saving fails with *"… is not allowed by
the server."*
:::

### Writing the table path

The path rules differ by format and by whether you filled in a bucket:

- **Iceberg** wants a metadata file — the path must end in `.metadata.json`.
- **Delta** wants the table root, *not* its `_delta_log` directory.
- With a **bucket / container** set, give a path relative to it
  (`orders/metadata/v3.metadata.json`).
- With **no** bucket, give a fully-qualified URI — `s3://…` for the S3
  backends, `gcs://…` or `gs://…` for Google Cloud Storage, `az://…` for Azure.
- For **local** storage, give an absolute server path (`/data/orders`) or a
  `file:///` URI.

Paths can't contain glob characters (`*`, `?`, `[]`, `{}`), parent-directory
segments (`..`), or control characters.

## Reading the Table

There's no SQL editor and no **Execute** button — a Lakehouse tab reads the
table it points at as soon as you open it, and again whenever the time-travel
point changes. The first row of the grid holds the column names and each
following row is a record.

The header shows the read's status on the right: **Loading rows…** while it
runs, then something like `1204 rows in 812ms`.

::: tip
Reads are capped at **10,000 rows**. Past that the status line reads
`10000 rows (truncated) in …ms` — the grid holds the first 10,000 rows and
nothing tells you what was left behind, so treat a truncated read as a partial
view of the table. A read that takes too long is cut off by a server timeout,
30 seconds by default.
:::

The grid is **read-only**. You can select and copy cells (**⌘/Ctrl+C**), but you
can't edit, sort, or filter them. Like a datasource tab, a Lakehouse tab
**can't be referenced from a formula** in another tab — cross-sheet references
resolve only against regular sheet tabs, so `Lakehouse1!A1` comes back empty
rather than reporting an error. To build on the numbers, copy the results into a
sheet tab.

## Time Travel

The **Time travel** slider above the grid walks the table's own commit history,
newest on the right.

- Drag it and the label shows the commit you've landed on — the commit time in
  your local timezone, and for Delta the operation that made it (for example
  `2026-08-14, 09:31:02 · WRITE`). Releasing the slider re-reads the table at
  that commit.
- The rightmost stop is the live table, labelled **Latest**. The button beside
  the slider jumps back to it from anywhere.
- For **Delta Lake** the stops are table versions; for **Apache Iceberg** they
  are snapshots. Because an Iceberg connection points at one specific
  `.metadata.json` file, "latest" means the newest snapshot recorded in *that*
  file — which is why the label reads **Latest in configured metadata** rather
  than plain **Latest** for Iceberg tables.
- History is capped at the **1,000** most recent commits.

The slider is disabled while the history is still loading, and on a read-only
view such as a share link.

### What gets saved

The **commit you pick is saved into the document**, on the tab, and it is
shared: a collaborator opening that tab sees the same historical commit you
pinned, and reads the table there. Clicking **Latest** clears it again.

The **rows are not**. Nothing the table returns is written into the document —
each person's grid is filled by their own read, and closing and reopening the
tab reads again.

If somebody pins a commit your history listing doesn't contain — an old commit
that has since aged out of the 1,000 — the slider is replaced by a note reading
`Snapshot 41… · outside loaded history`, and the read still runs against that
commit.

## Connections Are Shared With the Workspace

A saved Lakehouse connection belongs to the **workspace**, not to the person who
created it — exactly like a database datasource. Every workspace member can pick
it for a tab and read through it, and every read runs against the credentials
stored with the connection, whoever triggered it. Workspace membership is the
only check: there is no per-connection or per-document permission on top of it.

The credentials themselves are encrypted before they are stored and are never
returned to the browser.

::: warning
Point a Lakehouse connection at **least-privilege, read-only storage
credentials**. Everyone in the workspace shares them, so they should reach only
the data you're willing to show all of them.
:::

## Good to Know

- Wafflebase reads the table directly from its metadata; it never sends SQL you
  wrote, and the connection has no query field.
- Connections are created from the **Select Lakehouse** dialog. There is
  currently no screen in the app for editing or deleting a Lakehouse connection
  once it has been saved.
- The tab reads the one table its connection names. Browsing a catalog for
  other tables is not available in the app.
