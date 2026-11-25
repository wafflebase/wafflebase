# Chat review hardening + P2 joins

Source: Impeccable critique of 2026-11-25
(`.impeccable/critique/2026-11-24T22-54-45Z__packages-frontend-src-app-chat.md`,
29/40) plus a functional review of `packages/backend/src/chat` and
`packages/frontend/src/components/chat`. The user asked for every P1 and P2
item, worked by parallel agents and landed as **one PR** on branch
`chat-review-hardening`.

Each workstream runs in its own worktree branched from this commit, writes a
failing test before each fix, keeps `pnpm verify:fast` green, and commits on
its own branch; the branches are merged here.

## Shared contracts (decided up front so parallel streams agree)

- **Document links.** In-app document URLs keep today's routes (`/s/:id`,
  `/d/:id`, `/p/:id`, `/n/:id`, `/b/:id`, `/f/:id`, check `App.tsx`). Two
  optional query params:
  - `?chat=<channelId>`: the editor opens its chat panel on that channel.
  - `?at=<anchor>`: base64url of compact JSON, per chat.md § Document Cards
    and Anchors (sheet `{tabId,rowId,colId,rowSpan,colSpan}`, doc
    `{blockId,excerpt?}`, slides `{slideId}`).
  - Parse/build lives in `packages/frontend/src/components/chat/document-link.ts`
    (stream D owns it; stream F extends the anchor half).
- **Message DTO** gains `refs: ChatDocumentRefDto[]`
  (`{ documentId, type, title, anchor | null }`), resolved server-side on
  post/edit from URLs in the body (stream D).
- **Post body** gains optional `clientId` (uuid). Server dedupes on
  `(channelId, authorId, clientId)` and returns the existing message
  (stream A).
- **Stream event** `channel` `{ workspaceId, channelId }` = a channel's
  metadata (name, topic, archivedAt) changed; client refetches the channel
  list (stream A).
- **Chat panel API** (stream E):
  `useChatPanel(): { open(opts?: { channelId?: string; draft?: string }), close(), isOpen }`
  from `packages/frontend/src/components/chat/chat-panel-context.tsx`, backed by
  a `useRightPanels` hook that makes chat, comments and history share the
  right slot as chat.md § Chat panel says.

## Wave 1 (parallel)

### A. Live reliability
- [x] Stream recovers after EventSource `CLOSED` (refresh auth, recreate with backoff). No polling fallback: the reopened stream's `ready` catch-up replaces it (see chat.md § P2 as built)
- [x] `channel` stream event on rename / topic / archive / unarchive; peers' composer reflects archive
- [x] Non-member previewing a public channel receives `message`/`update` for it
- [x] `clientId` idempotent post; retry and reload-recovered pending sends reuse it
- [x] No Retry on 400/404/409 (show the reason); 429 says to slow down

### B. Privacy and correctness
- [x] Edit refreshes or drops `chat_mention`/`chat_thread_reply` previews; mentions added by an edit notify
- [x] DM restore starts a returning member at the channel tail
- [x] Drafts keyed by user (like pending sends)
- [x] Leave / workspace removal delete the user's chat notification rows for channels they can no longer read
- [x] Mention of someone who cannot read the channel is flattened to text; autocomplete offers only readers in private channels/DMs
- [x] Composer length checked after mention expansion
- [x] Deleting a reply decrements the root's `replyCount`; replying to a deleted root refused
- [x] Mention count no longer matches plain `[x](id)` text

### C. UI finish
- [x] Loading state: header skeleton + disabled composer labelled "Message" until the channel resolves
- [x] Thread load error has Retry; archived channel thread shows the read-only line
- [x] Touch: visible message actions (not long-press only); Browse dialog buttons get coarse-pointer size
- [x] "Jump to… ⌘K" entry in the channel list + Mod+/ shortcut sheet
- [x] a11y: single Thread landmark, switcher `aria-controls` only when list exists, mention plural uses `mentionCount`
- [x] Heading hierarchy: date divider is not a heading; one `h1`
- [x] Thread load beyond 500 replies is not silently dropped

### D. Document cards + Files
- [x] `ChatDocumentRef` model + migration; refs resolved on post/edit (live doc, same workspace)
- [x] Card rendering in messages (type icon hue, title, anchor label)
- [x] Files list in the channel header (`GET …/channels/:cid/files`)

### E. Editor chat panel
- [x] `useRightPanels` shared slot state, adopted by every document detail page
- [x] Chat panel (conversation + composer, channel switcher, "Open in Chat"), `?chat=` support
- [x] Mobile: Chat in the header overflow, opens as a bottom sheet

## Wave 2

### F. Send to chat + anchors
- [x] "Send to chat" in sheets / docs / slides context menus → channel picker → posts a card with the anchor
- [x] Editors apply `?at=` once loaded

## Integration
- [x] Merge stream branches, resolve conflicts
- [ ] `pnpm verify:fast`, `pnpm verify:self`
- [ ] `/self-review` rounds
- [x] Update `docs/design/chat.md` (P2 as built), backend README
- [ ] PR with Before → After for mobile chat

## Review
