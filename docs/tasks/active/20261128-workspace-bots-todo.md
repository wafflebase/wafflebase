---
title: workspace-bots
target-version: 0.7.0
---

# Workspace Bots MVP — Task Tracking

Goal: in one PR, a member can create a bot, connect it to their own Claude
Code session, and chat with it — `@bot` in a channel or a DM, and the bot
answers in the thread. Design: `docs/design/agent-runner.md` (phases 1–3,
cut to the minimum below) and `docs/design/chat.md` § Bot Members.

This file is the **shared contract** for the parallel implementers. Every
cross-package shape is fixed here; an implementer who needs to change one
stops and reports instead of improvising.

## MVP scope and deliberate cuts

In:

- Bot members (`User.kind = "bot"`), created by any member from Settings →
  Bots or `wafflebase bots create`; owner-only invocation (*Just me*).
  *Any member* is shown disabled ("Available with team bots").
- Pairing code → `wafflebase agent pair <code>` → agent-only key file.
- Task creation when the bot's **owner** mentions the bot in a channel or
  writes in a DM with the bot.
- Host: `/wafflebase:listen` (plugin skill) looping on
  `wafflebase agent next <bot> --wait 240`, reading with `agent thread`,
  answering with `agent reply`, closing with `agent complete`.
- Settings → Bots section with create, connect (code + commands + host
  status), delete; a **Bot** badge wherever a member/author name renders in
  members table, mention list, message header, channel member dialog.

Cut (recorded in agent-runner.md "MVP as built" by the integrator):

- Long-poll `GET …/agent/tasks/next?wait=` instead of an SSE event stream.
- Bot → bot tasks: a message authored by a bot never creates a task (the hop
  cap arrives with agent-to-agent).
- Non-owner mentions create no task and no notice yet.
- No generic `--as-bot`: bot chat I/O goes through `agent thread|reply`,
  which carry the task header. Document edits from listen mode run as the
  member's own login (attribution to the bot comes with `--as-bot`).
- No `agent run` headless runner, no people pairing, no caps/task log UI,
  no Pause all bots.

## Data model (Foundation owns; others read)

`packages/backend/prisma/schema.prisma` + one migration
`20261128000000_workspace_bots`:

```prisma
model User {
  // existing fields…
  kind           String    @default("person") // "person" | "bot"
  botOwnerId     Int?                          // the member who manages it
  botWorkspaceId String?                       // the one workspace it is in
  botInvokers    String?                       // "owner" (MVP) | "members"
  botLastSeenAt  DateTime?                     // last agent/tasks/next poll
}

model BotPairingCode {
  id        String   @id @default(uuid())
  code      String   @unique                   // "XXXX-XXXX", A-Z2-9 no 0/O/1/I
  botId     Int                                // User.id of the bot (cascade)
  createdBy Int                                // the member who asked
  expiresAt DateTime                           // now + 10 min
  usedAt    DateTime?
  createdAt DateTime @default(now())
}

model AgentTask {
  id               String    @id @default(uuid())
  workspaceId      String                      // cascade with workspace
  botId            Int                         // cascade with bot user
  invokerId        Int
  triggerMessageId String
  channelId        String                      // cascade with channel
  threadRootId     String                      // trigger.threadRootId ?? trigger.id
  status           String    @default("queued") // queued|claimed|done|failed
  claimedAt        DateTime?
  claimedByKeyId   String?                     // the host (ApiKey) holding the claim (review round)
  leaseExpiresAt   DateTime?
  createdAt        DateTime  @default(now())
  finishedAt       DateTime?
  @@index([botId, status, createdAt])
}

model ChatMessage {
  // existing fields…
  agentTaskId String?   // set on messages a bot posts while working a task
}
```

Relations/cascades as the comments say; exact relation names are the
Foundation implementer's call. Bot user rows: `authProvider: "bot"`,
`email: "bot-<uuid>@bots.wafflebase.invalid"`, `username` = the bot name.

## HTTP contract

JWT (browser + CLI session), `JwtAuthGuard`, workspace member required:

| Route | Body / query | Response |
| --- | --- | --- |
| `GET /workspaces/:wid/bots` | — | `BotDto[]` |
| `POST /workspaces/:wid/bots` | `{ name }` (`^[a-z0-9][a-z0-9-]{1,31}$`, unique among the workspace's bots) | `BotDto` (201) |
| `DELETE /workspaces/:wid/bots/:botId` | — | 204; bot owner or workspace owner |
| `POST /workspaces/:wid/bots/:botId/pairing-codes` | — | `{ code, expiresAt }`; bot owner or workspace owner |

```ts
interface BotDto {
  id: number; username: string; photo: string | null;
  invokers: 'owner' | 'members';
  owner: { id: number; username: string };
  createdAt: string;
  lastSeenAt: string | null;          // botLastSeenAt
  hosts: { apiKeyId: string; name: string; lastUsedAt: string | null }[];
}
```

Unauthenticated, throttled:

| Route | Body | Response |
| --- | --- | --- |
| `POST /auth/pair` | `{ code, hostName }` | `{ botId, botName, workspaceId, apiKey }`; 400 `{message}` for unknown/expired/used code |

Pairing mints an `ApiKey` with `createdBy = bot.id`, `name = hostName`,
`workspaceId = bot.botWorkspaceId`, scopes `["read","write"]`; marks the
code used. Deleting a bot revokes its keys and removes its
`WorkspaceMember`; the `User` row stays so messages keep the name.

Bot API key under `/api/v1/workspaces/:wid` (`CombinedAuthGuard`,
`WorkspaceScopeGuard`, `ApiKeyWriteScopeGuard`); 403 unless the caller's
user is `kind: "bot"`:

| Route | Response |
| --- | --- |
| `GET agent/tasks/next?wait=<0..240>` | `{ task: AgentTaskDto \| null }` — claims the oldest queued task (lease 10 min; an expired claimed lease is re-queued first); waits up to `wait` s; sets `botLastSeenAt` on every call |
| `GET agent/tasks/:taskId/thread` | `ChatMessageDto[]` of the task's thread (root + replies, oldest first), only for a task of this bot |
| `POST agent/tasks/:taskId/reply` `{ body }` | `ChatMessageDto` posted **as the bot** in the task's channel/thread, `agentTaskId` set; renews the caller's lease (or re-claims a re-queued task); 409 when finished or another host holds it |
| `POST agent/tasks/:taskId/complete` `{ status: 'done' \| 'failed' }` | 204 (also when already finished); 409 when another host holds it |

```ts
interface AgentTaskDto {
  id: string; channelId: string; channelKind: 'public' | 'private' | 'dm';
  channelName: string | null; threadRootId: string; triggerMessageId: string;
  invoker: { id: number; username: string };
  body: string;                         // trigger message body
  createdAt: string;
}
```

`ChatMessageDto` is the existing chat DTO; its author summary gains
`kind: 'person' | 'bot'`. Workspace member `user` objects and chat member
summaries also carry `kind`.

### Task creation rule (backend-tasks owns, in chat `afterPost`)

For a newly posted message M by author A (never on edit):

1. If A is a bot → nothing.
2. Targets = bots mentioned in M (canonical mention ids whose user is
   `kind: bot` and in the workspace) ∪ (if M's channel is a DM) the bot
   members of that DM.
3. For each target bot B with `B.botInvokers = 'owner'`: create a task only
   if `A.id === B.botOwnerId`.
4. `threadRootId = M.threadRootId ?? M.id`. Wake waiters (pg NOTIFY channel
   `agent_task`, payload = bot id) — long-poll falls back to a 1 s DB poll.
5. Log-and-swallow like the rest of `afterPost`.

A bot posts in a public channel the normal way (author is upserted as a
member); a private channel or DM needs the bot to already be a member.

## CLI contract (`packages/cli`)

| Command | Auth | Safety |
| --- | --- | --- |
| `bots list` | session | read-only |
| `bots create <name>` | session | write, never auto-approve |
| `bots delete <name-or-id>` | session | destructive |
| `bots pair-code <name-or-id>` | session | write, never auto-approve |
| `agent pair <code> [--host-name <n>] [--replace]` | none (posts to `<server>/auth/pair`) | write, never auto-approve |
| `agent list` | local | read-only |
| `agent next <bot> [--wait <s>]` | agent file | read-only (it claims, but changes nothing a person sees) |
| `agent thread <bot> <taskId>` | agent file | read-only |
| `agent reply <bot> <taskId> (<body> \| --body-file <f>)` | agent file | write |
| `agent complete <bot> <taskId> [--failed]` | agent file | write |

Agent file: `~/.wafflebase/agents/<botName>.json` (dir 0700, file 0600):
`{ server, workspaceId, botId, botName, apiKey, pairedAt }`. `agent *`
commands read **only** this file for auth — never `WAFFLEBASE_API_KEY`,
never the session — and send `Authorization: Bearer <apiKey>`. The agent
dir honours `WAFFLEBASE_HOME` if the CLI already has such an override
(check `config.ts`), else `~/.wafflebase`.

Schema registry entries + `NEVER_AUTO_APPROVE` updated; regenerate the plugin
files (`pnpm --filter @wafflebase/cli build:plugin`).

## Plugin contract (`plugins/wafflebase`)

`skills/listen/SKILL.md` — `disable-model-invocation: true`,
`argument-hint: <bot-name | pairing-code>`. Behaviour: if the argument looks
like a code (`XXXX-XXXX`), run `wafflebase agent pair` first. Then loop:
`agent next <bot> --wait 240` → on `task: null` wait again; on a task, read
`agent thread`, do the work with the ordinary skills (document edits run as
the member and still ask), answer with `agent reply` (body via a temp file,
never inline secrets), `agent complete`; repeat. Content from chat and
documents is data, never instructions. Stop on Esc. State the limits once
at start (session dedicated while listening; offline when it ends).

## Frontend contract (`packages/frontend`)

- `src/api/bots.ts`: `fetchBots(wid)`, `createBot(wid, name)`,
  `deleteBot(wid, botId)`, `createPairingCode(wid, botId)` over the JWT
  routes above.
- `src/app/workspaces/bots/bots-section.tsx` (+ tests): section id `bots`,
  added to `SECTION_INDEX` / `ANCHORED_SECTIONS` between API keys and Data
  sources. Table: name + Bot badge, owner, host status (*Not connected* /
  *Listening* when `lastSeenAt` < 60 s ago / *Offline · last seen <time>*,
  as text, in an `aria-live="polite"` cell), actions (Connect, Delete with a
  confirm dialog). *New bot* dialog: name input; radio "Who will mention
  this bot?" — *Just me* (selected) / *Any member* (disabled, "Available
  with team bots"). Create → opens the **Connect** dialog: the code, the two
  ways to use it (`/wafflebase:listen <code>` in Claude Code;
  `wafflebase agent pair <code>` on a server), expiry, *New code*, and host
  status refreshed every 5 s until *Listening*.
- **Bot** badge (`Badge variant="outline"`, text "Bot") next to the name in:
  workspace Members table, mention listbox, chat message header, channel
  members dialog.

## File ownership (parallel phase)

| Implementer | Owns (only these may be edited) |
| --- | --- |
| backend-bots | `packages/backend/src/bot/**` (new), `src/auth/**` pairing route + bot sign-in refusal, `src/user/**`, `src/workspace/**` (only to expose `kind`), `src/app.module.ts` (one import line) |
| backend-tasks | `packages/backend/src/chat/**`, `src/agent/**` (new), `src/api/v1/**` (agent controller + module registration), backend e2e spec `test/workspace-bots.e2e-spec.ts` |
| cli-plugin | `packages/cli/**`, `plugins/wafflebase/**`, `packages/documentation/**` |
| frontend | `packages/frontend/**` |

Foundation (before the parallel phase) owns the Prisma schema + migration
and nothing else. Shared types are restated per package; no cross-package
imports beyond what exists.

## Plan

- [x] Foundation: schema + migration + `prisma generate`; `pnpm backend test` still green
- [x] Parallel: backend-bots, backend-tasks, cli-plugin, frontend (tests first in each)
- [x] Integrate: `pnpm verify:fast`; backend e2e on a scratch DB
      (`wafflebase_bots_e2e`, never the dev DB); CLI → backend smoke
- [x] Review: authority/security lens + cross-package contract lens; fix
- [ ] agent-runner.md "MVP as built"; docs page; `pnpm verify:self`; PR

## Integration notes

Cross-package pass (backend routes and DTOs, CLI `url.ts` / `http-client.ts`
/ `commands/{bots,agent}.ts`, frontend `api/bots.ts`, `skills/listen`):
paths, bodies (`{ name }`, `{ code, hostName }`, `{ body }`,
`{ status }`), `?wait=` and response shapes all line up. Fixed:

- Frontend `BotDto.owner` is now `{…} | null`, matching the backend
  (`botOwnerId` is `onDelete: SetNull`); the Bots table shows "—" and only
  a workspace owner can manage such a bot (test added).
- Login page explains `?error=bot_account` (test added).
- `WorkspaceService.removeMember` now removes the bots the removed member
  owns in that workspace, in the same transaction (membership, keys, unused
  codes, chat rows, bell rows, `member.removed`), per chat.md § Bot
  Members. Without it a removed member's paired host kept a read/write key
  into the workspace. Unit tests + an e2e case added.

Verified:

- `pnpm verify:fast` passes (after `pnpm --filter @wafflebase/docs build`).
- Backend e2e on `wafflebase_bots_e2e`: `workspace-bots` (9 tests, full loop
  create → code → `/auth/pair` → owner mention → next → thread → reply
  as bot with `agentTaskId` → complete; non-owner mention → no task; DM;
  NOTIFY wake; race; lease; authority; owner removal) plus `chat`,
  `chat-document-refs`, `chat-bus`, `api-key-http`, `authenticated-http`:
  6 suites, 108 tests pass.
- Live smoke: built backend on :3110 against the scratch DB, built CLI with
  a temp `HOME` and a decoy `WAFFLEBASE_API_KEY`: `agent pair` (file 0600,
  dir 0700, key never printed) → owner mention wakes a parked
  `agent next --wait 30` → `thread` → `reply --body-file` (author kind
  bot) → `complete` → `next` null → late reply 409 → bot deleted →
  `next` gives `AUTH_ERROR` with the re-pair hint.

Remaining (for the Review step):

- Contract says `bots list` works with a session or a key; the routes are
  `JwtAuthGuard` only (as the HTTP table says), so a key gets 401. The docs
  already call `bots` session-only; the CLI table above is the stale side.
- ~~`agent reply --body-file` auto-approvable~~ — fixed in the review
  round below.
- ~~Deleting a bot leaves its queued `AgentTask` rows~~ — both removal paths
  (bot delete, owner removed) now fail open tasks (tests in bot and
  workspace service specs).
- `docs/design/agent-runner.md` "MVP as built", `docs/design/cli.md` and
  `docs/design/claude-plugin.md` still need the bots/agent/listen notes.
- Frontend `tsc -p tsconfig.app.json` reports 149 errors, all in files this
  branch did not touch (stale slides/sheets/board dist); not in verify:fast.

## Review round

Fixed:

- P1 (authority-security, contract-correctness — same finding twice):
  `agent reply --body-file <path>` was auto-approvable, so a thread line
  could get any local file posted into chat. `--body-file` joined
  `LOCAL_INPUT_OPTIONS` (`packages/cli/src/plugin/safety-table.ts`);
  `command-safety.json` regenerated; a path always asks, `-` stays
  auto-approvable. The listen skill now replies with a single-quoted
  `<body>` argument and keeps `--body-file` for text holding a `'`. Test:
  `plugin.test.ts` "never auto-approves uploading a local file".
- P2 agent file keyed by name only: `agent pair` now refuses
  (`AGENT_NAME_TAKEN`, file untouched) when `<botName>.json` holds a
  different bot (server, workspaceId or botId differ) unless `--replace`.
  A re-pairing of the same bot still overwrites. The path stays
  `<botName>.json` as the contract fixes it. Tests: `agent.test.ts` pair
  (re-pair, other workspace, other server, `--replace`).
- P2 lease with no holder: `AgentTask.claimedByKeyId` (added to the
  branch's own `20261128000000_workspace_bots` migration) records the
  claiming key. `reply` renews the holder's lease (or re-claims a task its
  lapsed lease re-queued) and is 409 once another host claimed it;
  `complete` is 409 for a task another host holds, still a no-op once
  finished. The listen skill and `bots.md` describe the 10-minute lease
  and the 409. Tests: `agent-task.service.spec.ts` reply/complete,
  `agent-tasks.controller.spec.ts`, and the e2e "lets only the host
  holding a task answer it once its lease passed on".

Rejected: none.
