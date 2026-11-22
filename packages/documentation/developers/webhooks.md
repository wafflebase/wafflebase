---
title: Webhooks
description: Get a signed HTTP request when a document, folder, or member changes in a workspace, and react to it from n8n, a script, or an agent.
type: how-to
---

# Webhooks

Get a signed HTTP request when a document, folder, or member changes in a workspace, and react to it from n8n, a script, or an agent.

A webhook tells you *that* something happened and *where to look*. It does not carry document content. Your receiver fetches what it needs through the [REST API](/developers/api/) or the [CLI](/developers/cli/).

::: info Before you start
- You are an owner of the workspace. Members can see the list of webhooks but not create or change them.
- Your server has webhooks turned on. See [Turn on webhooks](/developers/self-hosting/optional-features#turn-on-webhooks).
- An HTTPS endpoint that answers `2xx`. It can be an n8n or Zapier webhook trigger or your own server.
:::

## Create a webhook

1. Open **Settings** for the workspace and scroll to **Webhooks**.
2. Click **Add webhook**.
3. Enter a **Name**, such as `n8n → #contracts`, and the endpoint **URL**.
4. Pick what the webhook is for. Each choice checks a set of events you can still change:
   - **Post to a team channel**: created, moved, and trashed documents.
   - **Back up or index documents**: content updated, renamed, trashed, restored, and deleted.
   - **Sync members**: members joining and leaving.
   - **Everything**: every event, including ones added later. This is the default.
5. Optional: check **Only documents in some folders** and pick the folders. A document counts when it sits directly in a chosen folder.
6. Click **Save and send test**.

Wafflebase saves the webhook, sends it a signed `webhook.test` event, and shows the result. A failed test does not stop the save, so you can register the endpoint before your receiver exists.

Open a webhook from the list to see its secret, its delivery log, and to turn it off or delete it.

### From the CLI

```bash
wafflebase webhooks create "n8n feed" https://n8n.example.com/webhook/abc \
  --event document.created --event document.moved --event document.trashed
wafflebase webhooks list
wafflebase webhooks reveal-secret <webhook-id>
wafflebase webhooks deliveries <webhook-id> --status failed
```

Run `wafflebase webhooks --help` for every command: `get`, `update`, `delete`, `test`, `rotate-secret`, `enable`, `disable`, and `redeliver`.

## Events

| Event | Sent when |
|-------|-----------|
| `document.created` | A document is created, copied, made from a template, or uploaded. `data.source.kind` is `blank`, `copy`, `template`, or `upload`; `data.source.id` is the copied document or the template |
| `document.renamed` | A document's title changes |
| `document.moved` | A document moves to another folder or workspace. Carries `from_folder` and `to_folder`. A move between workspaces is sent to both, with `from_workspace_id` and `to_workspace_id`; each side sees only its own folder and links (the side the document left gets `to_folder: null` and no `url`) |
| `document.trashed` | A document is moved to the trash |
| `document.restored` | A document is restored from the trash |
| `document.deleted` | A trashed document is deleted for good. The payload still has its title and type |
| `document.content_updated` | A document's content changed. Sent about a minute after editing pauses, and at least every 5 minutes while editing continues |
| `folder.created`, `folder.updated`, `folder.deleted` | A folder is created, renamed or moved, or deleted. Sub-folders and documents affected by a folder delete send nothing of their own |
| `member.joined`, `member.removed` | Someone joins or leaves the workspace. Carries `member: { id, username, email, role, kind }` |
| `webhook.test` | You click **Send test**, create the webhook, or change its URL |

The folder filter applies to document events only. A move matches when either the folder it left or the one it entered is chosen.

## What a request looks like

Every request is a `POST` with a JSON body:

```json
{
  "type": "document.created",
  "timestamp": "2026-11-20T09:12:44.000Z",
  "data": {
    "workspace_id": "6f1c…",
    "actor": { "id": 7, "username": "ada" },
    "document": {
      "id": "e01f…",
      "type": "sheet",
      "title": "Q4 plan",
      "folder": { "id": "a9b2…", "name": "Planning" }
    },
    "source": { "kind": "template", "id": "c3d4…" },
    "url": "https://app.example.com/s/e01f…",
    "api_url": "https://api.example.com/api/v1/workspaces/6f1c…/documents/e01f…"
  }
}
```

- `actor` is who did it. It is `null` on `document.content_updated`.
- `folder` is `null` for a document at the top of the workspace.
- `url` opens the document in the browser; `api_url` is its REST API address. Either is left out when your server does not know its own address.

The request carries these headers:

| Header | Value |
|--------|-------|
| `webhook-id` | The delivery's ID. The same on every retry, so use it to skip duplicates |
| `webhook-timestamp` | Unix seconds when this attempt was signed |
| `webhook-signature` | `v1,<signature>`, or two of them separated by a space while a secret is being rotated |
| `x-wafflebase-event` | The event type |
| `user-agent` | `Wafflebase-Webhooks/<version>` |

## Verify a request

Requests are signed with the [Standard Webhooks](https://www.standardwebhooks.com/) scheme, so any Standard Webhooks library works. Copy the secret from the webhook's page. Without a library, in Node.js:

```js
import crypto from "node:crypto";

// `rawBody` is the request body exactly as received, before JSON parsing.
export function verifyWafflebase(headers, rawBody, secret) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"] ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  // Sign with the bytes after `whsec_`, base64-decoded, not the string itself.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}
```

Answer `2xx` quickly and do slow work afterward. A request that takes longer than 10 seconds counts as failed.

### Rotate the secret

On the webhook's page, click **Rotate secret**. For the next 24 hours, each request is signed with both the new and the old secret, so you can update your receiver without dropping events. You cannot rotate again until that overlap ends.

## When deliveries fail

Only a `2xx` answer counts as delivered. Redirects are not followed.

- A failed delivery is retried after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, and 10 hours. After 8 attempts it is marked failed.
- `429` waits for the `Retry-After` you send, up to an hour.
- `410 Gone` turns the webhook off at once.
- When nothing has been delivered for 3 days, the webhook turns off. Every owner gets a notification after 2 days of failures, at least a day before it turns off, and again when it turns off.

Turning a webhook off, by hand or automatically, stops what it still had waiting to send. Nothing is recorded while it is off.

To turn a webhook back on, open it and click **Re-enable**. Choose whether to also send what was waiting when it was turned off (the default), everything since the failures began, or nothing. Test pings are never sent again.

The delivery log keeps 30 days of requests and responses. Expand a row to see the payload and the first 1 KB of your response, or click **Redeliver** to send it again with the same `webhook-id`.

## Recipes

These examples use the REST API with an API key. See [Make your first API call](/developers/api/quickstart) to create one.

### Post new documents to a team channel

Use an n8n workflow: **Webhook** trigger → **Mattermost** (or **Slack**) node.

1. In Wafflebase, create a webhook with **Post to a team channel**, check **Only documents in some folders**, and pick the folder the channel cares about, such as *Contracts*.
2. Point it at the n8n Webhook trigger's production URL.
3. In the Mattermost node, build the message from the payload:

   ```text
   {{ $json.body.data.actor.username }} added "{{ $json.body.data.document.title }}" to {{ $json.body.data.document.folder.name }}: {{ $json.body.data.url }}
   ```

4. Add an **IF** node on the body's `type` field to word `document.trashed` and `document.moved` differently.

The payload has the title, folder name, link, and who did it, so the workflow needs no extra API call.

### Back up documents when they change

Subscribe to `document.content_updated`, `document.renamed`, and `document.deleted`. On each event, export the document with the CLI and commit it:

```bash
#!/usr/bin/env bash
# Called with the event body on standard input, after verifying the signature.
set -euo pipefail
event=$(cat)
type=$(jq -r .type <<<"$event")
id=$(jq -r .data.document.id <<<"$event")
kind=$(jq -r .data.document.type <<<"$event")

case "$type" in
  document.deleted)
    git rm -q --ignore-unmatch "backup/$id".* ;;
  *)
    case "$kind" in
      doc)   wafflebase docs export "$id" "backup/$id.docx" --force ;;
      note)  wafflebase notes export "$id" "backup/$id.md" --force ;;
      sheet) wafflebase sheets export "$id" "backup/$id.csv" ;;
      *)     exit 0 ;;
    esac
    git add "backup/$id".* ;;
esac
git commit -qm "$type $(jq -r .data.document.title <<<"$event")" || true
```

`content_updated` arrives once per pause in editing, so one burst of typing makes one export.

### Trigger an agent without looping

An agent that reacts to `document.content_updated` and then writes back through the REST API causes another `content_updated` for its own write. Guard on two things:

1. **Its own API key.** `data.api_writers` lists the REST API writes inside the event's window, as `{ api_key_id, user_id, at }`. Find your key's ID with `wafflebase api-keys list`.
2. **A content hash.** Writes by people can land in the same window, so a matching key alone does not mean nothing else changed. Keep a hash of what you last wrote and compare.

```js
import crypto from "node:crypto";

const MY_KEY_ID = process.env.WAFFLEBASE_API_KEY_ID;
const lastWritten = new Map(); // document id -> sha256 of what the agent wrote

async function onContentUpdated(event) {
  const { document, api_writers } = event.data;
  const content = await fetch(`${event.data.api_url}/content`, {
    headers: { Authorization: `Bearer ${process.env.WFB_KEY}` },
  }).then((r) => r.text());
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  const wroteThis = api_writers.some((w) => w.api_key_id === MY_KEY_ID);
  if (wroteThis && lastWritten.get(document.id) === hash) return; // our own write

  const updated = await runAgent(content);
  await fetch(`${event.data.api_url}/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.WFB_KEY}`,
      "Content-Type": "application/json",
    },
    body: updated,
  });
  lastWritten.set(
    document.id,
    crypto.createHash("sha256").update(updated).digest("hex"),
  );
}
```

To act only on documents made from one template, check `document.created`'s `data.source`: `kind` is `template` and `id` is the template's ID.

Each webhook sends at most 1,000 requests an hour, so a loop you miss slows down instead of running forever.

### React to a status column in a sheet

Wafflebase does not say which cells changed. Fetch the range and compare it with what you saw last time:

```js
const seen = new Map(); // row number -> status

async function onRequestsSheetChanged(event) {
  const url = `${event.data.api_url}/tabs/${process.env.TAB_ID}/cells?range=A2:D500`;
  const cells = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WFB_KEY}` },
  }).then((r) => r.json());

  for (const cell of cells) {
    if (!cell.ref.startsWith("D")) continue; // column D holds the status
    const row = cell.ref.slice(1);
    if (cell.value === "Approved" && seen.get(row) !== "Approved") {
      await sendApprovalEmail(row);
    }
    seen.set(row, cell.value);
  }
}
```

Store `seen` somewhere durable so a restart does not resend emails.

## Known limitations

- `document.content_updated` can be late, and it is lost if the server misses the edit. Treat it as a hint to fetch, not a record of every change.
- Events can arrive out of order and more than once. Use `webhook-id` to skip duplicates and `timestamp` to order them.
- A workspace can have at most 10 webhooks.
- There are no events for comments, share links, or chat yet.
- The delivery log is kept for 30 days and is not an audit log.
- Webhooks can only be managed while signed in, from **Settings** or the CLI. API keys cannot create them.

## Related

- [REST API](/developers/api/) to fetch what an event points to.
- [Turn on webhooks](/developers/self-hosting/optional-features#turn-on-webhooks) on your own server.
- [Manage workspaces and members](/collaborate/workspaces), including what removing a member turns off.
