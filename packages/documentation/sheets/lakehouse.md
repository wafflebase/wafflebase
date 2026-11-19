---
title: Read lakehouse tables
description: Read an Apache Iceberg or Delta Lake table from object storage into a read-only tab, and look at earlier versions with time travel.
type: how-to
---

# Read lakehouse tables

Read an Apache Iceberg or Delta Lake table from object storage into a read-only tab, and look at earlier versions with time travel.

A lakehouse tab has no query box. It shows the whole table its connection points at, as soon as you open it.

::: info Before you start
- Connections are shared with the workspace. Every member reads with the credentials you save, so use read-only storage credentials.
- A saved lakehouse connection can't be edited or deleted in the app.
- Reads stop at 10,000 rows, and a read stops after 30 seconds by default.
:::

## Add a lakehouse tab

1. Open the sheet. At the end of the tab bar, click the arrow next to **+** (**More tab types**) and select **Connect lakehouse table…**.
2. In **Select lakehouse**, click a connection and click **Select**, or double-click it.
3. To add a connection instead, click **New connection** and follow [Set up a connection](#set-up-a-connection).

A new tab named after the connection opens, marked with a warehouse icon. The status line reads **Loading rows…**, then something like `1204 rows in 812ms`.

## Set up a connection

1. In **New lakehouse connection**, enter a **Name**.
2. Choose the **Table format**: **Apache Iceberg** or **Delta Lake**.
3. Choose the **Storage** and fill in its fields. See [Storage options](#storage-options).
4. Enter the table path. For Iceberg it's labeled **Iceberg metadata file (.metadata.json)**; for Delta, **Delta table root**. See [Write the table path](#write-the-table-path).
5. Click **Test connection**. A message says `Connected`, or why it couldn't connect.
6. Click **Save**.

The new tab opens and reads the table.

![New lakehouse connection dialog set to Apache Iceberg on S3-compatible storage](/images/sheets/lakehouse-connection.png)

### Storage options

| Storage | Fields |
|---|---|
| **Amazon S3** | **Bucket**, **Region** (default `us-east-1`), **Access key**, **Secret key**, **Session token (optional)** |
| **S3-compatible** | **Bucket**, **Region**, **Endpoint** (an `http://` or `https://` URL with no path), **Access key**, **Secret key**, **Session token (optional)** |
| **Google Cloud Storage** | **Bucket**, **Access key**, **Secret key**. Use GCS interoperability (HMAC) keys |
| **Azure Blob / ADLS** | **Container**, **Custom endpoint (optional)**, and either **Connection string (optional)** alone, or **Account name** with **Account key** or **SAS token (optional)** |
| **Local filesystem (server-configured)** | The table path only, as an absolute server path |

Amazon S3, S3-compatible, and Google Cloud Storage need both an access key and a secret key. Until both are filled in, **Save** stays unavailable and the key fields show an error.

::: info Server settings
**Local filesystem** works only when the server operator turns it on, inside one allowed folder. Custom endpoints must also be on the operator's allowlist. See [Optional features](/developers/self-hosting/optional-features).
:::

### Write the table path

- **Iceberg**: point at a metadata file. The path must end in `.metadata.json`.
- **Delta**: point at the table root, not its `_delta_log` folder.
- With a **Bucket** or **Container** set, use a path relative to it, such as `orders/metadata/v3.metadata.json`.
- With no bucket, use a full URI: `s3://…` for S3 and S3-compatible, `gs://…` or `gcs://…` for Google Cloud Storage, `az://…` for Azure.
- For local storage, use an absolute path such as `/data/orders`, or a `file:///` URI.

Paths can't contain `*`, `?`, `[]`, `{}`, or `..`.

## Look at an earlier version

1. Open the lakehouse tab.
2. Drag the **Time travel** slider above the grid. The label shows the commit's date and time in your time zone and, for Delta, the operation that made it, such as `WRITE`.
3. Release the slider. The grid reloads the table as it was at that commit.
4. To return to the current table, click **Latest**.

The commit you pick is saved on the tab, so collaborators who open it see the same version. Click **Latest** to clear it for everyone. The rows themselves are not saved: each person's tab reads the table again when they open it.

For Iceberg, the newest stop is labeled **Latest in configured metadata**: it's the newest snapshot in the metadata file you entered, which may be older than the live table. Delta stops are table versions; Iceberg stops are snapshots. The slider lists the 1,000 most recent commits.

## Use the results in a sheet

The grid is read-only: you can select and copy cells, but not edit, sort, or filter them. To build on the data, copy cells with `⌘+C` / `Ctrl+C` and paste them into a sheet tab.

A formula in another tab can't read a lakehouse tab. A reference such as `=Orders!A1` returns an empty value.

## Known limitations

- A read that hits 10,000 rows shows `10000 rows (truncated)`, and the grid holds only the first 10,000 rows.
- Each tab reads the one table its connection names. You can't browse a catalog for other tables.
- To change a connection's details, create a new connection.
- The slider is unavailable while the history loads, and on read-only views such as a viewer share link.
- If a pinned commit is older than the loaded history, the slider is replaced by a note such as `Snapshot 41… · outside loaded history`. The tab still reads that commit.

## Related

- [Connect a database](/sheets/connect-a-database) to run SQL against PostgreSQL.
- [Optional features](/developers/self-hosting/optional-features) for the server settings behind local paths and custom endpoints.
- [Troubleshooting](/start/troubleshooting#local-lakehouse-paths-are-disabled-on-this-server) if saving fails with `Local lakehouse paths are disabled on this server`.
