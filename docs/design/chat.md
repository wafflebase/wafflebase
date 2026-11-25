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
  their inbox; a push channel is a later design — [webhooks.md](webhooks.md)
  builds the delivery engine it would reuse, with the bot as principal.
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

A new sidebar item **Chat**, after Documents, with a badge counting what
needs you: unread in DMs plus mentions in channels — the sum of the numbers
the channel list shows (`channelCount`), so a merely busy channel is a dot
there and adds nothing here. (It first counted every unread message, which
let the badge read 12 over a list of quiet dots.) The page has its own
second column:

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
  defaultKey  String?   @unique     // the default channel (#general): its workspaceId
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
- **The default channel (#general).** Every workspace has one public channel
  whose `defaultKey` holds the workspace id — the same unique-nullable idiom
  as `dmKey`, so "one per workspace" is an index, not a convention. It is
  created in the transaction that creates the workspace
  (`WorkspaceService.create` and the sign-up workspace in `UserService`), and
  `acceptInvite` joins a new member to it in the transaction that creates the
  membership, at the channel tail, then announces the membership so their
  open stream starts receiving it. It cannot be left or archived (both 400);
  it can be renamed, so identity is the key, not the name. A bare `/chat` on
  desktop opens the last channel the caller is still in, else this one. The
  reason is the first run: before it, a fresh workspace opened on an empty
  list, and an admin's first move was to invent the channel everybody needed.
  The `20261121150000_chat_default_channel` migration backfills existing
  workspaces: a public channel already named `general` is adopted (and
  unarchived), otherwise one is created and owned by the first owner; every
  member joins at the tail. A workspace whose `general` is **private** gets
  none — names are unique per workspace, and making that channel public would
  expose its history — and `joinDefaultChannel` treats a missing default as a
  no-op. Reading the channel list repairs the rest (`ensureDefaultChannel`,
  the backfill scoped to one workspace): during a rolling deploy a pod from
  before defaults existed can still create a workspace without #general or
  accept an invite without joining it, so `list` creates or adopts the
  default when it is missing and joins the reader when they are not in it.
  Both are idempotent and yield on conflict, so the common path costs one
  extra row in the result, nothing more.
- `seq` is allocated inside the insert transaction (`lastSeq + 1` on the
  channel row, locked), so ordering is total per channel and survives clock
  skew between replicas.
- Removing a workspace member (`WorkspaceService.removeMember`) deletes their
  `ChatChannelMember` rows; their messages stay, attributed to them. A
  private channel the removal leaves with no members is deleted in the same
  transaction (see *Authorization*); a DM keeps its other participant and a
  public channel stays open to the workspace, so neither is touched.

### Authorization

Every chat route requires authentication and **workspace membership**, checked
the way `/api/v1` checks it (`WorkspaceScopeGuard`). On top of that:

- Read/post in a channel: public → any workspace member (posting auto-joins);
  private and dm → channel members only. A channel the caller cannot see is a
  `404`, not `403`, matching the rest of the backend.
- Edit/delete: author only. Rename, set the topic or archive a channel:
  public → its creator or a workspace owner; private → any of its members.
  Nobody outside a private channel can see it, so a creator-or-owner rule
  would strand a last member who is neither: refused leaving, refused
  archiving, and unreachable by anyone who could help. A DM has no name,
  topic or archive, so nobody manages one. Each channel summary carries the
  caller's `canManage`, computed by the same `chat-access` function `PATCH`
  enforces, so the page offers exactly the controls the server accepts.
- **A private channel is never left empty.** Leaving refuses its last member
  (`409`, archive instead), and a workspace removal that would empty one
  deletes it, messages included, in the removal's transaction. With no member
  left nobody can read, rejoin, archive or delete it, and its name would stay
  reserved forever; the messages are unreadable by anyone, so deleting them
  loses nothing a person could reach. Archiving instead would keep the dead
  name reserved.
- **Channel names are unique across the workspace, private ones included**
  (`@@unique([workspaceId, name])`), as in Slack. Creating or renaming onto a
  name a private channel holds is a `409` with the generic "That channel name
  is taken" — it reveals that the name is reserved, never the channel's
  members, topic or messages, and the UI says so ("Only people you add can
  read it. Its name is still reserved across the workspace.") rather than
  promising a private channel cannot be found.
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
- A public channel's events go to every connected member of its workspace;
  private channels and DMs to their members (see *P2 as built*).
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
| `GET` | `…/chat/channels/:cid/members` | Who is in a public or private channel (Add people marks them "Already here") |
| `POST` | `…/chat/channels/:cid/members` | Join (public) / invite (private) |
| `DELETE` | `…/chat/channels/:cid/members/me` | Leave |
| `DELETE` | `…/chat/channels/:cid/members/:uid` | Remove someone else (`canRemove`: creator or workspace owner; not a DM or the default channel) |
| `GET` | `…/chat/channels/:cid/messages` | `?before=<seq>` / `?after=<seq>`, `?thread=<id>`, page size 50 |
| `POST` | `…/chat/channels/:cid/messages` | `{ body, threadRootId?, alsoInChannel? }` |
| `GET` | `…/chat/messages/:mid` | One message, for a bell deep link that must learn whether it is a thread reply; 404 unless its channel is readable |
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

1. **P1 — Chat page. Shipped** (branch `chat-p1`; plan
   [`20261120-chat-p1-todo.md`](../tasks/active/20261120-chat-p1-todo.md)).
   Schema + migrations, web routes, `LISTEN/NOTIFY` hub + SSE, channels /
   DMs / threads / edit / delete / unread, mentions into the bell, mobile
   list → conversation. Document URLs render as plain links. Deviations from
   this document are listed under *P1 as built* below.
2. **P2 — The joins. Shipped** (branch `chat-review-hardening`; plan
   [`20261125-chat-review-hardening-todo.md`](../tasks/active/20261125-chat-review-hardening-todo.md)),
   together with the fixes a review of P1 found. Document cards +
   `ChatDocumentRef` + Files list, anchors, editor chat panel, "Send to chat"
   in the sheets/docs/slides context menus, mobile bottom sheet. Deviations
   are listed under *P2 as built* below.
3. **P3 — Agents and search.** Bot members (model, settings UI, login
   refusal, lifecycle), `/api/v1` mirror, CLI verbs incl. `chat inbox`, Bot /
   via API labels, plugin guard table, `pg_trgm` search.

#### P1 as built

Where the implementation departs from, or settles, what the sections above
say:

- **Workspace id or slug.** `:wid` in every chat route accepts the workspace
  id or its slug, resolved against the caller's own memberships, so the
  page's slug URLs need no extra lookup. A channel that exists but belongs to
  another workspace than the one named is `404`.
- **Archived = read-only, edits included.** Archiving refuses posting *and*
  editing or deleting an existing message (`409`); reads keep working. The
  archive check is repeated under the channel row lock inside the post
  transaction, so a concurrent archive cannot take one more message.
- **`markRead` is capped.** `POST …/read` moves `lastReadSeq` to
  `GREATEST(current, LEAST(seq, channel.lastSeq))` — never backwards, and never
  past the last allocated `seq`, so a client cannot pre-read messages that do
  not exist yet. Joining or being invited starts the read position at the
  channel tail rather than 0, so old history is not unread. Posting a
  top-level message, or a reply also sent to the channel, reads up to it; a
  thread-only reply leaves an existing read position alone, since replying
  in a thread is not reading the channel.
- **DM membership is fixed.** A DM cannot be joined, left, renamed or
  archived. Leaving is `DELETE …/members/me` (only the caller).
  Re-opening a DM restores member rows a workspace removal deleted.
- **Removing someone else** is `DELETE …/members/:userId`, declared after
  `members/me` and parsed as an integer so `me` still means leave. It is
  authorized by `canRemove`, deliberately stricter than `canManage`: the
  channel's creator or a workspace owner, on public and private channels
  alike, and a workspace owner only by another owner. Archiving is open to
  every member of a private channel so a last member is never stranded, but
  removal evicts a person, and the same rule would let any member evict the
  creator and every owner; refusing it strands nobody, since members can
  still leave or archive. It refuses a DM and the default channel (`400`,
  even for an owner), yourself (`400`, use `members/me`), and a target not
  in the channel (`404`); like leaving, it never empties a private channel
  (`409`) and sends the `mem` bus event that evicts the hub member cache.
  The removed person's open client is not told; it learns on its next
  channel-list fetch, when a private channel answers `404`. Removal from a
  public channel does not stop them rejoining it.
- **Members dialog.** The channel header shows a member count that opens the
  member list (public and private channels, not DMs), with Add people and a
  per-row Remove, confirmed inline on the row. `GET …/members` answers each
  row's `canRemove` for the caller, so Remove appears exactly where the
  server accepts it.
- **Archived channels stay reachable.** The channel list ends in a collapsed
  **Archived** section of archived channels the caller belongs to (collapsed
  state remembered per workspace in the browser; the open channel stays
  visible while collapsed). They carry no unread marks and never count toward
  the Chat badge. Browse channels has a "Show archived channels" toggle; an
  archived public channel opens read-only and offers no Join, since the
  server refuses to join one. Unarchiving is the header's Unarchive action.
- **Unread orientation.** Each channel summary carries the caller's
  `lastReadSeq` (null outside the channel) and the channel's `lastSeq`.
  Opening a channel captures that pair before reading moves it, and what
  was unread at open is exactly the eligible messages in `(lastReadSeq,
  lastSeq]` (top-level or also-sent-to-channel, not deleted, not the
  reader's own — the server's unread rule). A **New messages** divider sits
  above the first of them; when it is out of view the channel opens there
  instead of at the bottom, without marking read until the reader scrolls to
  the end. Because it is a range rather than a count, the divider is right
  on a partial or stale log (it appears once a catch-up brings the messages
  in), a message that arrives while the channel is open is never "new", and
  a deleted message does not shift it. The stream moves a cached `lastSeq`
  on every message, the open channel's included, so a channel left open and
  scrolled up places its divider correctly when reopened. Scrolled away from
  the bottom, a **Jump to latest** pill (it reads "N new messages" once
  others post) returns to the end.
- **`GET …/chat/messages/:mid`.** Added for the bell deep link, which knows
  only a message id and must learn whether it is a thread reply; it is `404`
  unless the message's channel is readable. The stream's `update` handling
  reuses it.
- **Bus payload.** NOTIFY payloads carry a `t` kind discriminator rather than
  the sketch in *Delivery*: `{t:'msg',c,w,s,r,a}` (`r` = thread root),
  `{t:'upd',c,w,id,r}`, `{t:'mem',c}`, plus a self-sent probe that warns when
  the listener sits behind a pooler. Payloads are validated on receipt, since
  any database session can `pg_notify('chat', …)`.
- **Reconnect clears the hub cache and resyncs streams.** `ChatBus.resets$`
  fires on every successful listener connection (the first too, since a
  listener down at boot may already have streams), and `ChatHub` drops every
  cached member set, bumps a generation so a member load in flight across the
  reset is reloaded rather than cached, and sends `ready` down every open
  stream: a `mem` or `msg` sent while the listener was down never arrives. A
  cached set also expires after 60 s (`MEMBER_CACHE_TTL_MS`), because a `mem`
  NOTIFY is best effort and can fail with the listener still up; that bounds
  how long a removed member keeps receiving a channel's ids-only events, and
  every fetch those events prompt re-checks access. The listener's connect and
  `LISTEN` time out at 10 s so a stalled handshake reaches the retry path.
- **`ready` reconciles, it does not only append.** On `ready` the client
  re-reads the open channel's whole loaded range (`after = oldest − 1`, paged,
  merged by id) so edits and deletes missed during a disconnect land without
  dropping the history scrolled back through, invalidates every thread and
  every other cached channel so they refetch when shown, and refreshes the
  channel lists. Catch-up reruns start from the earliest point any request
  asked for, not from a tail a local post may have moved; a channel that
  loaded empty catches up from seq 0; and only the newest refresh of a given
  message may land.
- **Heartbeat is a `ping` event.** Nest's SSE writer has no comment lines, so
  the 25 s keep-alive is a named `ping` event the client ignores. `ready`
  opens every (re)connect.
- **Live edits and deletes.** Edit and delete NOTIFY an ids-only `upd`; the
  stream exposes it as `update { workspaceId, channelId, messageId,
  threadRootId }` and the client refetches that one message and replaces it in
  the channel and thread caches (a `404` marks it deleted). Pages are cached
  with `staleTime: Infinity`, so without this peers kept the old text.
- **Canonical mention tokens.** Post and edit rewrite every
  `@[name](userId)` to the target's real username and flatten a token whose
  id is not a workspace member to plain `@name`, so a body cannot render
  `@ceo` for somebody else's id. A flattened name loses its token syntax
  (`@ [ ] ( )`) and the pass repeats to a fixpoint, so an unresolved token
  cannot lend its brackets to the text around it and re-form one
  (`@[[x](9)](42)`). Deleting a message also deletes the `chat_mention` /
  `chat_thread_reply` rows whose preview quotes it.
- **The last member of a private channel cannot leave it** (`409`): an empty
  private channel is unreadable to everyone, so archiving is the way out —
  and since every private-channel member may archive, that way is always
  open to them. The channel actions menu offers *Rename channel…*, *Edit
  topic…* and *Archive channel…* (confirmed inside its dialog) when
  `canManage`, and *Unarchive channel* on an archived one; an archived
  channel shows a read-only banner above its history. A workspace removal
  that empties a private channel deletes it (see *Authorization*).
- **One stream per session.** `ChatStreamHost` is rendered by
  `PrivateRoute`, not by `AppSidebar`, which has a mount per shell — so
  moving between the list layout and an editor neither reopens the stream nor
  replays its `ready` refetch. The `message` event carries `alsoInChannel`,
  so the client counts an also-sent reply as unread, as the server does.
- **Optimistic send.** A send shows at once as a dimmed pending row and the
  composer clears; a failure leaves the row as "Not sent · Retry · Discard"
  rather than restoring the text. Pending rows live under their own query key
  (`chatKeys.pending(channelId)`), never in the seq-paged message caches, so
  paging, catch-up and `ready` reconciles cannot drop or duplicate them. The
  POST's answer swaps the pending row for the server row in one tick; if the
  stream delivers that row first, the pending row is hidden by matching
  author and body among rows newer than the send. A failed row is never
  hidden that way — a later message with the same words would make one that
  never arrived disappear — so a post whose response alone was lost shows as
  failed beside its copy. Posts queue per channel so quick sends keep their
  order (a hung post is waited on for 15 s, then the queue moves on), and
  unanswered sends are mirrored to `sessionStorage` under the user and the
  channel: once the composer clears, that row is the only copy of the text,
  so it has to survive a reload, and must not reach the next user to sign in
  to the tab. One read back still pending comes back failed.
- **Keyboard and screen readers.** The message scroller is a labelled
  region, not `role="log"`: a log is implicitly live, so a first load or
  "Load older" read whole pages aloud. A separate polite region announces
  only others' messages arriving at the tail. Messages are one roving tab
  stop (↑/↓/Home/End, Enter opens the thread, Esc returns to the composer),
  so each row's hover toolbar no longer sits in the tab order. ↑ in an empty
  composer edits the caller's last message; Esc closes an open thread and
  returns focus to its replies link; Alt+↑/↓ moves between channels
  (Alt+Shift for unread ones); Mod+K opens a channel switcher, owned by the
  Chat page because nothing else binds it outside the editors. The mention
  list is a combobox (`useMentionAutocomplete`), shared by the composer and
  the edit box.
- **Finding and leaving channels.** Public channels the caller has not
  joined are counted in a "Browse channels" row at the foot of Channels, and
  a channel opened as a preview shows as a transient row until the caller
  moves on. Leaving a public channel offers Undo (rejoin); leaving a private
  one asks first, since only an invite brings the caller back.
- **One accent.** Mention chips are neutral; a mention of the reader, and
  its line, take the butter selected wash, so syrup in chat stays for
  "unread / act here". Same-origin links in a message navigate in place
  rather than in a new tab. The tab title carries the Chat badge count and
  the channel, e.g. `(3) #q4-planning · Chat`.
- **Search is not in P1.** `GET …/chat/search` moves with `pg_trgm` to P3.

#### P2 as built

The P2 joins shipped with a pass over P1 that a design critique and a
functional review of it found. Where it departs from, or settles, the
sections above:

- **Public channel events reach the workspace.** `ChatHub` sends a public
  channel's `message` / `update` / `channel` events to every connected
  member of the channel's workspace, not only to its members, so a reader
  previewing a channel they have not joined (where a mention deep link
  lands) sees it live. `canRead` already lets every workspace member read a
  public channel and the events carry ids only, so nothing new is
  disclosed; private channels and DMs still go to their members only. The
  channel's kind and workspace come from its row, never the payload.
  Workspace member sets are cached per replica with the same 60 s TTL and
  `mem` eviction as channel sets. The cost is one small frame per public
  message to every connected workspace member; the client counts unread
  only for channels the reader belongs to. A per-connection "watch" was
  rejected: the watch request can land on another replica than the stream.
- **Channel edits are pushed.** Rename, topic, archive and unarchive send a
  `channel` stream event (`{ workspaceId, channelId }`, bus `{t:'chn'}`)
  after commit, best effort; clients refetch the channel list, so an
  archive turns a peer's composer read-only without a reload.
- **The stream recovers.** When the browser gives up on the EventSource
  (`CLOSED`), the client checks the session through `/auth/me` (which
  refreshes a stale access cookie), then reopens the stream with capped
  backoff (1 s → 30 s), and at once on `online` or the tab becoming visible.
  The new stream's `ready` catches the open channel up. "Stopped" now means
  only that the session ended.
- **Posts are idempotent.** A post may carry `clientId`
  (`[A-Za-z0-9_-]{1,64}`); `(channelId, authorId, clientId)` is unique, and
  a repeat returns the first message with no new `seq`, notify or
  notification. The client mints one per send and reuses it on retry,
  including for sends restored after a reload. Refusals that cannot change
  (400 / 404 / 409) show their reason without Retry; 408 / 429 / network /
  5xx keep it.
- **Edits keep the bell honest.** An edit rewrites the preview of the
  message's `chat_mention` / `chat_thread_reply` rows, deletes mention rows
  for people edited out, and notifies people edited in, with the post's
  recipient rule. Leaving a private channel, or being removed from it or
  from the workspace, deletes the person's chat rows for what they can no
  longer read; leaving a public channel keeps them.
- **Mentions only reach readers.** In a private channel or DM, a token
  naming someone outside the channel is flattened to `@name`, and the
  composer offers only the channel's members. Composer and edit-box length
  are checked on the expanded body, the one the server checks. The mention
  count matches the canonical `@[name](id)` token by regex, not a
  `](id)` substring.
- **A DM restore starts at the tail.** Re-opening a DM restores a returning
  member with `lastReadSeq = lastSeq`: they can scroll the history (a DM's
  membership is fixed), but nothing from while they were gone is unread.
- **Thread bookkeeping.** Deleting a reply recounts the root's `replyCount`
  and `lastReplyAt`; replying to a deleted root is `409`. A thread reads
  back from its newest reply and loads older ones on demand ("Show earlier
  replies") instead of dropping what is past ten pages.
- **Drafts are keyed by user** (`wafflebase:chat-draft:<userId>:<channelId>`),
  as pending sends are.
- **`ChatDocumentRef` carries `channelId`** (no FK; the message cascade
  covers deletes) with an index on `(channelId, createdAt)`, so the Files
  list reads one index range. Links are accepted as root-relative paths or
  absolute URLs on `FRONTEND_URL`'s origin and basename; at most 10 refs per
  message. Title and type are read with the message, so a rename shows and a
  trashed or moved document drops out. A failed ref sync is logged, never a
  failed post. `GET …/channels/:cid/files` returns
  `{ files: [{ documentId, type, title, anchor, messageId, sharedBy,
  sharedAt }], cursor }`, newest share first, one row per document.
- **Anchors carry a `label`.** Chat cannot turn axis or slide ids into
  "Sheet1!C3:E7" without loading the document, so every anchor type has an
  optional `label` (≤80 chars) written by whoever builds the link, and the
  card shows it.
- **The chat panel.** `useRightPanels` holds chat / comments / history for
  sheet, docs, notes, board and the file viewers; slides, which already
  kept one right panel in a `rightPanel` union, gained `"chat"` there. Board
  and PDF comments, which lived in their collab providers, take the page's
  pair, so board comments and history now collapse to one panel on a phone
  as the others do. The panel picks `?chat=` / an explicit request, then the
  channel this document was most recently shared in, then the last opened
  channel, then the default channel; a thread opens in place with Back. It
  is lazy-loaded so editor chunks do not grow. On a phone it sits in the
  header `⋮` menu and opens as a bottom sheet; the file viewers keep their
  free-form header row.
- **Chat page finish.** A loading channel shows a header skeleton and a
  disabled composer labelled "Message"; a thread load error has Retry; a
  coarse pointer gets a visible actions trigger on a tapped row, besides
  long-press; "Jump to… ⌘K" heads the channel list and Mod+/ opens a
  shortcut sheet (the board's `ShortcutsHelpDialog`). The site header's
  "Chat" is the page's one `h1`; day and unread dividers are not headings.

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

- **LISTEN connection loss.** The bus reconnects with backoff and the hub
  sends `ready` to every open stream; clients re-read what they have open, so
  loss costs latency, not messages.
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
