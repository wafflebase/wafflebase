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
| `POST agent/tasks/:taskId/reply` `{ body }` | `ChatMessageDto` posted **as the bot** in the task's channel/thread, `agentTaskId` set |
| `POST agent/tasks/:taskId/complete` `{ status: 'done' \| 'failed' }` | 204 |

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
| `bots list` | session/key | read-only |
| `bots create <name>` | session | write, never auto-approve |
| `bots delete <name-or-id>` | session | destructive |
| `bots pair-code <name-or-id>` | session | write, never auto-approve |
| `agent pair <code> [--host-name <n>]` | none (posts to `<server>/auth/pair`) | write, never auto-approve |
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

- [ ] Foundation: schema + migration + `prisma generate`; `pnpm backend test` still green
- [ ] Parallel: backend-bots, backend-tasks, cli-plugin, frontend (tests first in each)
- [ ] Integrate: `pnpm verify:fast`; backend e2e on a scratch DB
      (`wafflebase_bots_e2e`, never the dev DB); CLI → backend smoke
- [ ] Review: authority/security lens + cross-package contract lens; fix
- [ ] agent-runner.md "MVP as built"; docs page; `pnpm verify:self`; PR

## Review

(to fill in)
