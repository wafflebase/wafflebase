---
title: chat
target-version: 0.7.0
---

# Workspace Chat

## Summary

Wafflebase teams still keep a second app open for conversation, and every
exchange about a document crosses between the two: paste a link in Slack, open
it in Wafflebase, comment, go back to Slack to say you commented. This design
adds workspace chat — channels, direct messages, threads — so a team can get
through a working day without Slack, and so the hop between a conversation and
a document stops being a switch between apps.

The shape follows the prior-art survey below:

- **Two surfaces, one conversation.** A full **Chat page** in the sidebar
  (beside Documents) for reading and triage, and a **Chat panel** docked on the
  right of every editor for talking while working. Both show the same channel
  state — read position, draft, unread counts — so opening a document from a
  message keeps the conversation beside it instead of replacing it.
- **Documents stay the centre.** Chat is a workspace feature added to the
  existing shell, not a new shell that documents live inside.
- **Postgres, not Yorkie, holds messages.** Chat is an append-mostly log that
  needs pagination, search and server-side authority; a CRDT document is the
  wrong store for it (see [Storage](#storage-postgres-not-yorkie)).
  Real-time delivery uses Postgres `LISTEN/NOTIFY`, which is instant across
  replicas with no new infrastructure.
- **Agents are members of the workspace.** An agent gets its own **bot
  member** — a user row of kind `bot` with its own API keys — so it can be
  DM'd, added to channels and `@`-mentioned like a colleague, and it reads
  what was addressed to it through the CLI. Everything a person does in chat is
  reachable through `/api/v1` and the `wafflebase` CLI.

### Goals

- A workspace member can spend a working day in Wafflebase without Slack:
  public channels, private channels, 1:1 and small-group DMs, threads, edit and
  delete own messages, `@user` mentions, unread state, and search.
- From a message, open a document **at the place it points to** (a sheet range,
  a doc block, a slide) with the same channel open beside it.
- From a document, send a selection to a channel as a card that carries the
  location ("Send to chat").
- One inbox: chat mentions land in the existing header bell next to comment
  mentions.
- Agents are **bot members**: created in workspace settings, listed with a
  **Bot** label, DM-able, addable to channels and mentionable. A bot posts and
  reads through `/api/v1` and the CLI with its own key, and pulls the mentions
  and DMs addressed to it (`wafflebase chat inbox`).
- Works on a phone (below 768px) with the existing mobile conventions.

### Non-Goals

- Calls, huddles, screen sharing.
- Typing indicators and online/away presence. (Easy to add later over the same
  stream; not needed to replace Slack for a day.)
- File upload into chat. A file is uploaded as a document (the existing
  generic-file spine) and shared as a card.
- Rich text / markdown formatting beyond line breaks, links and mentions.
- Guests: share-link and anonymous users get no chat. Chat is for workspace
  members.
- Per-document auto-created channels (Quip / Nextcloud style). Comments already
  own "conversation inside the document".
- **Pushing** work to an agent (outbound webhooks on mention). Bots *pull*
  their inbox; a push channel is a later design.
- Bots in more than one workspace. A bot belongs to exactly one.
- Email / push notifications, notification preferences, retention policies,
  Slack import.

### Anti-goals

These would make the feature a failure even if it worked:

- **A second inbox.** If users have to check the bell *and* a chat activity
  tab to know what needs them, chat added work instead of removing it.
- **Documents become guests.** An app shell rebuilt around chat (Lark/Teams
  left rail) contradicts "one suite, not six apps".
- **The hop survives.** If opening a document from a message replaces the
  conversation, we have rebuilt Slack + Wafflebase inside one tab.

## Prior Art

| Product | Where chat lives | What happens when you open a document |
| --- | --- | --- |
| Slack | Sidebar channel list; conversation is the main area | Canvases can open in a split view beside the conversation (re-introduced December 2025 after a brief removal) |
| Lark / Feishu | First item in a left app rail | The doc opens; documents shared in a chat accumulate as tabs at the top of that chat; a doc can open its chat in a sidebar (`toggleChat`). Sharing a link in chat grants the chat's members access |
| Microsoft Teams | Left app bar → Chat / Teams | Office files edit inside Teams with a "Conversation" pane toggled on the right |

The common lesson: the value is not the messenger but the joins — permission
and location carried across the chat↔document boundary, and notifications
from documents arriving in the conversation.

## Approaches Considered

### Layout

| | Layout | For | Against |
| --- | --- | --- | --- |
| A | **Chat page** — sidebar item, conversation fills the main area (Slack) | Familiar; room for channel list, threads, search; fits the current sidebar and router | Opening a document replaces the conversation — the hop survives |
| B | **Chat-first shell** — left app rail, shared docs as tabs in each channel (Lark, Teams) | Strongest "Slack replacement" feel; per-channel document collection | Rebuilds the app shell; documents become guests; even Lark cannot show chat and doc side by side |
| C | **Chat panel** — header toggle, docked right panel in editors (Teams conversation pane) | Never leave the document; reuses the comments/history panel slot | Too narrow for triage, search, long threads; alone it cannot replace Slack |

**Chosen: A + C sharing one conversation state.** A carries the working day; C
removes the hop. From B we take only the per-channel document collection, as a
**Files** list in the channel header. B is rejected for shell cost and product
fit.

### Storage

| | Store | For | Against |
| --- | --- | --- | --- |
| 1 | **Postgres** tables + `LISTEN/NOTIFY` fan-out to an SSE stream | Pagination, search, server-side authority over mentions, retention later; instant across replicas; no new infra (`pg` already a backend dependency) | New stream endpoint; `LISTEN` needs a direct (non-transaction-pooled) connection |
| 2 | One **Yorkie document per channel** | Real-time and presence for free; auth webhook already gates by docKey | Whole history loads on attach; the 10 MB document cap is hit by node count, which a busy channel reaches; no server-side search; mentions would be client-reported like comments |
| 3 | Postgres + the existing **notification hub** (in-process + 60 s poll) | Zero new delivery code | A message from another replica can take a minute — unusable for chat |

**Chosen: 1.**

## Proposal Details

### Surfaces

#### Chat page — `/w/:workspaceId/chat/:channelId?`

A new sidebar item **Chat**, after Documents, with a total unread badge. The
page has its own second column:

```
┌ sidebar ┬ channel list ──────┬ conversation ───────────────────────────┐
│ Docs    │ Search             │ # q4-planning   Files (4)   Members  ⋯ │
│ Chat ●3 │ Channels           │ ─────────────────────────────────────── │
│ …       │  # general         │ Minji  10:02                            │
│         │  # q4-planning  2  │   Can you check these numbers?          │
│         │ Direct messages    │   ┌────────────────────────────────┐    │
│         │  Minji          ●  │   │ ▦ Q4 budget · Sheet1!C3:E7     │    │
│         │  report-agent      │   └────────────────────────────────┘    │
│         │ + New channel      │   2 replies · last 10:15                │
│         │                    │ [ Message #q4-planning              ]   │
└─────────┴────────────────────┴─────────────────────────────────────────┘
```

- **Channel list**: Channels (public + private the user belongs to), then
  Direct messages. Unread channels bold with a count; channels with a mention
  or an unread DM show the count in the badge style, others a dot.
- **Threads** open in a right column of the Chat page (and as a full view on
  mobile). A thread reply can optionally be "also sent to channel".
- **Files** in the channel header lists every document card posted in the
  channel, newest first (the part taken from Lark's chat tabs).
- **Search** is scoped to channels the user is a member of.

#### Chat panel — in every editor

A `HeaderPanelToggle` beside comments and version history opens the chat panel
in the existing right-hand docked slot (1px rule, no shadow, per DESIGN.md).

- **Which channel it shows**, in order: the channel the user came from (opening
  a card carries `?chat=<channelId>`); else the channel this document was most
  recently shared in, among channels the user belongs to; else the user's last
  opened channel. A channel switcher sits in the panel header.
- **Which editors**: every document detail page — sheet, doc, slides, note,
  board, and the pdf / image / file viewers — through one shared hook rather
  than per-page wiring.
- **Slot sharing**: opening chat closes comments and history; opening either
  of those closes chat. Comments and history keep today's behavior with each
  other (both may be open on desktop; `useOnePanelOnMobile` collapses them on
  mobile). This is a new piece of shared state, a `useRightPanels` hook, which
  the detail pages adopt in place of their separate booleans.
- The panel shows the conversation and composer only; channel list, search and
  Files live on the Chat page, reached by an "Open in Chat" link.
- Hidden while a revision preview is open (the same rule as comments, since
  "Send to chat" reads the live selection).

#### Shared conversation state

The page and the panel are two views of one client-side model:

- Messages per channel in the React Query cache (`['chat', channelId,
  'messages']`), so switching surfaces renders instantly.
- **Drafts** per channel in a small store persisted to `sessionStorage`, so a
  half-written message survives opening a document.
- **Read position** is server state (`lastReadSeq` per member), advanced
  when the newest message has been visible in either surface.

### User Journeys

1. **Morning triage.** Sidebar Chat badge → channel list → read channels in
   order → reply in threads. Mentions from both chat and document comments are
   in the bell.
2. **Chat → document.** Click a document card → the editor opens at the anchor
   (range selected, block scrolled into view, slide selected) with the chat
   panel open on the same channel → reply from the panel.
3. **Document → chat.** Select a range / text / slide → context menu **Send to
   chat** → channel picker (recent channels first) → optional message → posts
   a card carrying the anchor.
4. **Agent at work.** A member DMs `@report-agent` or mentions it in a
   channel → the agent, polling `wafflebase chat inbox`, picks the request up
   → posts its result as a message with a document card, under its own name
   and a **Bot** label → a person replies in the thread → the agent reads the
   thread and follows up.
5. **Phone.** Chat page becomes list → conversation → thread as full-screen
   steps. In an editor, Chat sits in the header `⋮` menu (per
   `header-placement.ts`) and opens as a bottom sheet.

### Data Model (Prisma)

```prisma
model ChatChannel {
  id          String    @id @default(uuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  kind        String    // "public" | "private" | "dm"
  name        String?   // null for dm
  topic       String?
  createdBy   Int?
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  lastSeq     BigInt    @default(0) // last allocated ChatMessage.seq
  dmKey       String?   @unique     // dm only: workspaceId + sorted member ids
  lastMessageAt DateTime?
  members     ChatChannelMember[]
  messages    ChatMessage[]

  @@unique([workspaceId, name])
  @@index([workspaceId, kind])
}

model ChatChannelMember {
  channelId         String
  channel           ChatChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  userId            Int
  user              User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastReadSeq       BigInt      @default(0) // unread = top-level seq > this
  joinedAt          DateTime    @default(now())

  @@id([channelId, userId])
  @@index([userId])
}

model ChatMessage {
  id           String      @id @default(uuid())
  channelId    String
  channel      ChatChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  seq          BigInt      // per-channel monotonic, the pagination and "after" cursor
  authorId     Int?
  author       User?       @relation(fields: [authorId], references: [id], onDelete: SetNull)
  apiKeyId     String?     // set when posted with an API key
  body         String      // plain text; mentions as @[username](userId)
  threadRootId String?     // null = top-level
  alsoInChannel Boolean    @default(false)
  replyCount   Int         @default(0)
  lastReplyAt  DateTime?
  editedAt     DateTime?
  deletedAt    DateTime?   // soft delete; body cleared
  createdAt    DateTime    @default(now())
  refs         ChatDocumentRef[]

  @@unique([channelId, seq])
  @@index([threadRootId, seq])
}

model ChatDocumentRef {
  messageId  String
  message    ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  documentId String
  document   Document    @relation(fields: [documentId], references: [id], onDelete: Cascade)
  anchor     Json?       // per-type, see Anchors
  createdAt  DateTime    @default(now())

  @@id([messageId, documentId])
  @@index([documentId, createdAt])
}
```

- **DMs** are `kind: "dm"` channels with a fixed member set (1:1 up to 8
  people), deduplicated by member set through the unique `dmKey`: opening a DM
  with the same people returns the existing channel, including when two
  people open it at once (the loser of the unique-index race reads the
  winner's row).
- **Public** channels are visible to and joinable by every workspace member;
  **private** channels only by invitation from a member.
- `seq` is allocated inside the insert transaction (`lastSeq + 1` on the
  channel row, locked), so ordering is total per channel and survives clock
  skew between replicas.
- Removing a workspace member (`WorkspaceService.removeMember`) deletes their
  `ChatChannelMember` rows; their messages stay, attributed to them.

### Authorization

Every chat route requires authentication and **workspace membership**, checked
the way `/api/v1` checks it (`WorkspaceScopeGuard`). On top of that:

- Read/post in a channel: public → any workspace member (posting auto-joins);
  private and dm → channel members only. A channel the caller cannot see is a
  `404`, not `403`, matching the rest of the backend.
- Edit/delete: author only. Archive a channel: its creator or a workspace
  owner.
- Document cards resolve **only for documents in the same workspace that are
  live** (not trashed). Because document access in Wafflebase is workspace
  membership, every member of a channel can open every card in it; there is
  no permission-granting step at send time. Links to other workspaces or to
  share links render as plain links.
- Mentions are authorized server-side (unlike comment mentions, which are
  client-reported because comments live in the CRDT). See
  [Notifications](#notifications) for exactly who is notified.
- `GET /chat/stream` is per user and spans all of the user's workspaces, so
  it has no `:workspaceId` for `WorkspaceScopeGuard` to read. It needs only
  `JwtAuthGuard`: fan-out is keyed on `ChatChannelMember` rows, which already
  imply workspace membership because `removeMember` deletes them.

### Storage: Postgres, not Yorkie

Recorded so the question is not reopened: a Yorkie document per channel loads
its full history on attach, accumulates CRDT nodes per message toward the
10 MB cap, cannot be searched server-side, and would leave mentions
client-reported. Chat needs none of what CRDTs give (concurrent edits to the
same message do not happen) and all of what a table gives.

### Delivery

```
POST message ──► tx: insert ChatMessage + bump channel.lastSeq/lastMessageAt
                 └─ pg_notify('chat', '{"c":channelId,"s":seq,"t":threadRootId,"a":authorId}')
every replica: one dedicated pg Client LISTEN chat
                 └─► ChatHub: for each connected user who is a member of c → SSE event
client: GET /chat/stream (EventSource)
                 └─► visible channel: GET messages?after=<seq>  ; others: unread++
```

- The NOTIFY payload carries ids only (NOTIFY has an 8000-byte limit and the
  stream should carry no content, the same choice the notification stream
  made). The client fetches what it shows.
- Membership for fan-out is cached per replica and invalidated by a second
  NOTIFY on membership changes.
- **Catch-up**: on (re)connect the client re-reads unread counts and fetches
  `after=<lastSeenSeq>` for the open channel, so a dropped connection or a
  missed NOTIFY self-corrects.
- Heartbeat every 25 s, `X-Accel-Buffering: no`, as in the notification
  stream.
- The `LISTEN` connection must be direct; transaction-mode poolers
  (PgBouncer) drop it. `CHAT_LISTEN_DATABASE_URL` (optional, defaults to
  `DATABASE_URL`) lets a deployment point it past the pooler.

### Notifications

The bell stays the single inbox (anti-goal: no second inbox):

- New `Notification.type` `chat_mention`, created server-side for each
  mentioned user who is a workspace member and either a channel member, or
  (public channels only) not yet a member — that user's notification opens the
  channel in a read-only preview with a **Join** button. A mentioned user who
  cannot read the channel (private / dm non-member, or not a workspace member)
  is left as text and notified of nothing. Mentions inside a group DM do
  notify. `dedupeKey` = message id.
- New `chat_thread_reply` for replies in a thread the user started or replied
  to, deduped per thread per hour so a busy thread is one row.
- A DM message *without* a mention creates no notification; it drives the
  sidebar badge, which is what Slack users expect.
- `notificationHref` routes both types to `/w/:workspaceId/chat/:channelId`
  with the message (and thread) focused.

### Document Cards and Anchors

When a message body contains a Wafflebase document URL (`/s/:id`, `/d/:id`,
`/p/:id`, `/n/:id`, `/b/:id`, `/f/:id`), the server takes the id from the path
and **looks the document up** — the URL carries no workspace — then stores a
`ChatDocumentRef` only if the document is live and its `workspaceId` equals
the channel's.
The card shows the type icon (DESIGN.md `type-*` hue), title, and anchor label.

Anchors ride in the URL as `?at=<encoded anchor>` and are stored parsed:

| Type | Anchor | Stable under concurrent edits via |
| --- | --- | --- |
| sheet | `{ tabId, rowId, colId, rowSpan, colSpan }` | axis IDs (as comment anchors and axis-ID selection) |
| doc | `{ blockId, excerpt? }` | block ids; `excerpt` is a ≤200-char snapshot of the selected text shown on the card, not a live range |
| slides | `{ slideId }` | slide ids |
| others | none (document-level) | — |

Opening a card navigates to the editor with `?at=…&chat=<channelId>`; the
editor applies the anchor once loaded and opens the chat panel on that
channel. "Send to chat" builds the same URL from the live selection; a docs
text selection is reduced to its first block plus an excerpt, because a
CRDT-stable text range (the docs comments' `posRange`) needs per-editor
resolution that v1 does not take on. Comment-thread deep links (deferred in
[notifications.md](notifications.md)) are not covered by this format.

### REST, API v1 and CLI

Web routes (JWT) under `/workspaces/:wid/chat/…`, mirrored on `/api/v1`
(JWT or API key, `write` scope for mutations via `ApiKeyWriteScopeGuard`):

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `…/chat/channels` | Channels the caller can see, with unread counts |
| `POST` | `…/chat/channels` | Create public/private channel, or open a DM (`{ kind: 'dm', userIds }`) |
| `PATCH` | `…/chat/channels/:cid` | Rename, topic, archive |
| `POST` | `…/chat/channels/:cid/members` | Join (public) / invite (private) |
| `DELETE` | `…/chat/channels/:cid/members/:uid` | Leave / remove |
| `GET` | `…/chat/channels/:cid/messages` | `?before=<seq>` / `?after=<seq>`, `?thread=<id>`, page size 50 |
| `POST` | `…/chat/channels/:cid/messages` | `{ body, threadRootId?, alsoInChannel? }` |
| `PATCH` / `DELETE` | `…/chat/messages/:mid` | Edit / delete own |
| `POST` | `…/chat/channels/:cid/read` | `{ seq }` advance read position (never moves backwards) |
| `GET` | `…/chat/search` | `?q=` over the caller's channels |
| `GET` | `/chat/stream` | SSE (web only) |

CLI: `wafflebase chat channels`, `chat read <channel> [--thread <id>]
[--since <seq>]`, `chat post <channel> <text> [--thread <id>]`, `chat dm
<user…> <text>`, and `chat inbox [--since <cursor>]` — the mentions, DM
messages and replies in followed threads addressed to the caller since the
cursor, which is how a bot finds work. A message whose author is a bot shows a
**Bot** label. A *person's* message posted with one of their own API keys
(scripts, not bots) stores `apiKeyId` and shows a smaller **via API** label,
so the two are not confused.
The Claude Code plugin's guard table gains these verbs (posting asks, like
other writes).

Posting is throttled per user (`UserThrottlerGuard`, e.g. 30 messages / 10 s)
in addition to the global per-IP bucket.

### Bot Members

A bot is a `User` row, so channel membership, DMs, mentions, document access,
authorship and notifications all work without a parallel principal:

```prisma
model User {
  // …existing fields…
  kind        String    @default("person") // "person" | "bot"
  botOwnerId  Int?      // the member who manages it; null for people
  botWorkspaceId String? // the one workspace it belongs to; null for people
}
```

- **Creation** (workspace settings → Bots, any member): name and avatar →
  backend creates the `User` (`kind: "bot"`, `authProvider: "bot"`, email
  `bot-<uuid>@bots.wafflebase.invalid`), a `WorkspaceMember` with role
  `member`, and an API key whose `createdBy` is the bot — shown once, like
  any key. More keys can be minted from the bot's settings row.
- **It can never sign in.** The `.invalid` TLD cannot be verified by any OAuth
  provider, so `findOrCreateUser` (which matches on email) can never land on
  it; the OAuth strategies also refuse any `kind: "bot"` row outright.
- **Authority** equals an ordinary member's in that one workspace — the same
  authority a member's own key already carries. It cannot be made an owner,
  invited elsewhere, or mint invites.
- **Lifecycle.** Managed (rename, keys, delete) by its `botOwnerId` and by
  workspace owners. Removing the bot's owner from the workspace removes the bot
  too (membership + keys), extending `removeMember`'s "a key dies with the
  membership that justified it" to the identity the key belongs to. A deleted
  bot's messages stay, attributed by name.
- **Where it shows.** Member lists put bots in their own **Bots** group; the
  mention autocomplete and DM picker include them with the **Bot** label.
  Bots create no `workspace_member_joined` notification.
- **Inbox.** A bot's mentions create ordinary `chat_mention` rows; `chat
  inbox` reads them together with DM messages, so the pull needs no new table.
- Beyond chat, the same bot identity is what its API writes to documents are
  attributed to — an agent's edits and comments carry the bot's name instead
  of its creator's.

REST: `POST/GET /workspaces/:wid/bots`, `PATCH/DELETE /workspaces/:wid/bots/:id`,
`POST /workspaces/:wid/bots/:id/api-keys` (JWT; owner of the bot or workspace
owner for everything except create).

### Message Body

Plain text. Rendered with line breaks, autolinked URLs (document URLs become
cards), and `@[username](userId)` mention chips reusing
`components/comments/mentions.ts` and the member autocomplete from
[comments-mentions.md](comments-mentions.md). No HTML, no markdown in v1; body
capped at 4,000 characters.

### Search

`pg_trgm` GIN index on `ChatMessage.body`, `ILIKE` queries restricted to
channel ids the caller belongs to. Full-text search (`tsvector`) is not used
because the stock configurations do not segment Korean.

### Frontend Structure

```
packages/frontend/src/app/chat/          # Chat page route, channel list, thread column
packages/frontend/src/components/chat/   # shared: conversation view, composer,
                                         # message, document card, panel, stream hook,
                                         # draft store
```

The conversation view and composer are one component tree used by both the page
and the panel; only the chrome around them differs.

### Rollout

1. **P1 — Chat page.** Schema + migrations, web routes, `LISTEN/NOTIFY` hub +
   SSE, channels / DMs / threads / edit / delete / unread, mentions into the
   bell, mobile list → conversation. Document URLs render as plain links.
2. **P2 — The joins.** Document cards + `ChatDocumentRef` + Files list, anchors,
   editor chat panel, "Send to chat" in the sheets/docs/slides context menus,
   mobile bottom sheet.
3. **P3 — Agents and search.** Bot members (model, settings UI, login
   refusal, lifecycle), `/api/v1` mirror, CLI verbs incl. `chat inbox`, Bot /
   via API labels, plugin guard table, `pg_trgm` search.

### Testing

- Backend unit: authorization matrix (public/private/dm × member/non-member ×
  workspace member/not), `seq` allocation under concurrent inserts, mention →
  notification rules, ref parsing rejects other-workspace and trashed
  documents, a bot row is refused by every OAuth strategy, removing a bot's
  owner removes the bot and revokes its keys.
- Backend integration (DB lane): two `ChatHub` instances on one database
  receive each other's NOTIFY — the multi-replica claim, asserted.
- Frontend: shared state survives page → panel → page (draft, scroll, read
  position); anchor application per editor type.
- Browser lane: send-to-chat round trip in sheets.

## Risks and Mitigation

- **LISTEN connection loss.** The hub reconnects with backoff; clients catch up
  by `after=<seq>` on reconnect, so loss costs latency, not messages.
- **Pooled databases.** A transaction-mode pooler silently breaks `LISTEN`.
  Log a startup check that a self-NOTIFY round-trips; document
  `CHAT_LISTEN_DATABASE_URL`.
- **Fan-out cost.** Each replica checks membership per event; cached per
  channel and bounded by connected users. Large deployments would move to a
  bus, out of scope here.
- **Noise.** Thread-reply notifications are deduped hourly; a DM or channel
  message reaches the bell only when it mentions you.
- **Content injection.** Bodies are plain text rendered as text nodes; only
  server-verified refs become cards, so a crafted URL cannot spoof a card for a
  document the server did not resolve.
- **Spam via API keys.** Per-user throttle applies to API-key callers and bots
  too; revoking a key or deleting the bot stops the agent immediately.
- **A bot as a login backdoor.** A bot row must never become a session. Two
  independent locks: an email no provider can verify, and a `kind` check in
  every OAuth strategy. Both get a test.
- **Orphaned bots.** A bot outliving its owner would hold workspace authority
  nobody answers for; removal with the owner (owners can re-home first) closes
  that.
- **Scope creep toward Slack parity.** Non-goals above are the line; P1–P3
  ship without them.

## Open Questions

- Should the chat panel replace comments in the slot, or should comments
  become a tab inside the panel? (Current proposal: mutually exclusive slots.)
- Channel retention and export for self-hosted compliance needs — deferred
  until a deployment asks.
