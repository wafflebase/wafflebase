---
title: agent-runner
target-version: 0.7.0
---

# Agent Runner

## Summary

Let a workspace put a Claude agent to work in chat and on documents **without
Wafflebase ever holding a Claude credential**. A member creates a **bot
member** (see [chat.md § Bot Members](chat.md#bot-members)), pairs it to a
host they control with a one-time code, and that host answers the bot's
mentions with the **unmodified Claude Code binary** and the Wafflebase plugin
([claude-plugin.md](claude-plugin.md)). There are two hosts, one protocol:

- **Listen mode** — `/wafflebase:listen` in the member's own interactive
  Claude Code session. For a personal bot: no second machine, no second
  secret, and the member watches (and approves) every write. Ships first.
- **Runner** — `wafflebase agent run`, a headless daemon on a laptop, team
  server or CI. For an always-on or team bot.

The Claude credential — the member's own Claude Code login, a
`claude setup-token` OAuth token or an API key — never leaves that host.

```
 Wafflebase (knows only the bot's API key)     Runner (member-controlled host)
 ─────────────────────────────────────────     ───────────────────────────────
 Bob: "@deck-bot turn this sheet into a deck"  [document card]
   │ AgentTask(hop=0, invoker=Bob)
   │                        ◀── GET …/bots/me/events  (SSE, outbound, API key)
   ├── task.created ───────▶  1. claim task (lease 60 s, heartbeat)
   │ ◀── "Working on it…" ──   2. post a status message within seconds
   │                           3. build the prompt: trigger message, thread,
   │                              referenced document cards
   │                           4. claude -p --output-format stream-json
   │                              + wafflebase plugin (headless profile)
   │                              CLAUDE_CODE_OAUTH_TOKEN | ANTHROPIC_API_KEY
   │                              CLI calls carry the bot key + task id
   │ ◀── edit status ───────   5. progress per tool call
   │ ◀── answer + new card ─   6. complete; release lease
```

This is the shape of a self-hosted GitHub Actions runner and of the Claude
Code GitHub Action: the product hands out work and records results; the
member's own host runs the model with the member's own credential.

## Background

### Why not store the setup token in workspace settings

The first idea was a workspace settings field where an admin pastes a
`claude setup-token` output and the backend runs the agent with it. Anthropic's
terms rule that out
([Legal and compliance § Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)):

> Anthropic does not permit third-party developers to offer Claude.ai login
> into their own applications, or to route requests through Free, Pro, Max,
> or Ultra plan credentials on behalf of their users. Moreover, developers may
> not collect, store, or intermediate Claude.ai credentials or session tokens.

The same page carves out what this design relies on:

> This does not restrict how customers provision and manage their own API keys
> or third-party inference provider credentials … for use by the customer's
> own authorized users … Nor does it prevent an end user from signing in to the
> unmodified Claude Code binary with their own Claude subscription.

And, separately: "Advertised usage limits for Pro, Max, and Ultra plans assume
ordinary, individual usage." That sentence shapes the invocation policy below
— a subscription token must not serve a whole team.

### What already exists

| Need | Where it is today |
| --- | --- |
| Agent identity | Bot members are designed in [chat.md](chat.md#bot-members) (`User.kind = "bot"`, own API keys, cannot sign in), rollout P3, not built |
| Conversation surface | Chat P1/P2 shipped: channels, DMs, threads, document cards, editor chat panel, `chat_mention` notifications |
| Real-time fan-out | `LISTEN/NOTIFY` → SSE (`packages/backend/src/chat/chat-bus.ts`, `chat-stream.controller.ts`) |
| Job lease pattern | Webhook outbox + `SKIP LOCKED` lease worker (`packages/backend/src/webhook/webhook-delivery.worker.ts`) |
| Document tools | `wafflebase` CLI over `/api/v1`; writes made with an API key are attributed via `runAsApiWriter` (`packages/backend/src/webhook/api-writer-context.ts`) |
| Agent workflows | `plugins/wafflebase/` skills + `PreToolUse` guard + `SessionStart` hook |

Missing: chat over `/api/v1` (the chat controller is JWT-only), CLI chat verbs,
a push channel to a bot (chat.md lists push as a later design), and anything
that runs a model.

### Prior art

| Product | Credential | Identity | Lesson taken |
| --- | --- | --- | --- |
| Linear Agents | vendor's own | installed app, `actor=app`, not a seat | the human stays accountable; acknowledge within 10 s; typed session activity |
| Claude Code GitHub Action | repo secret: API key or `CLAUDE_CODE_OAUTH_TOKEN` | GitHub App | `@claude` in a thread → unmodified Claude Code runs on the repo's own runner |
| GitHub self-hosted runners | runner registration token | runner | outbound long-poll, so a runner behind NAT works |
| Zed ACP | the external agent's own | external process | bring the whole agent, not just a key |
| Slack Claude Tag | Anthropic-hosted | one Claude per channel | admin-scoped channels, spend caps, audit of who asked |
| Liveblocks / Yjs "AI as a peer" | BYOK | room peer | agent writes rate-limited and attributable as a unit |

## Goals

- A member can make a bot and have it answering mentions without copying a
  long-lived secret or reading a design doc: the bot dialog hands them the
  one command to run, and the bot row turns live when a host connects.
- A bot's credential never displaces the member's own CLI identity on the
  same machine.
- Teammates `@mention` a bot in any channel, thread or DM it belongs to, and
  are told before they try whether the bot is available to them.
- The bot reads and edits documents through the same CLI and plugin a human
  Claude Code user has, so there is one tool surface to maintain.
- Wafflebase stores no Claude credential, runs no model, and pays for no
  tokens.
- Bots can talk to each other in a visible thread, and can never loop.
- A bot can never read, through a task, what its invoker could not.

## Non-Goals

- A Wafflebase-hosted runner. Hosting would mean storing the member's token,
  which the terms forbid.
- A built-in model loop in the backend (BYOK provider key, issue #696's
  OpenAI-compatible seam). A separate design; it can reuse the task model
  below.
- A remote MCP connector for claude.ai — still deferred per
  [claude-plugin.md](claude-plugin.md).
- Agents in document comments. Comments live inside the Yorkie document; the
  first surface is chat, where messages are in Postgres and mentions are
  server-authored. Comment mentions can feed the same task queue later.
- Suggestion-mode edits (propose → accept). Phase 4 or later.
- Bots across workspaces (chat.md: a bot belongs to exactly one).

## Proposal Details

### 1. Bot members (chat.md P3)

Built as specified in [chat.md § Bot Members](chat.md#bot-members), plus two
fields this design needs:

```prisma
model User {
  // …chat.md fields: kind, botOwnerId, botWorkspaceId…
  botInvokers String? // "owner" | "members"; null for people
}
```

- **`botInvokers`** — who may create tasks for the bot.
  - `owner` (default): only `botOwnerId`. The only setting allowed with a
    subscription token.
  - `members`: any member of the bot's workspace. Requires an API key or a
    cloud-provider credential on the host (§ 7).
- The `/api/v1` chat mirror and CLI chat verbs from chat.md P3 ship here:
  `wafflebase chat channels|history|thread|post|edit|inbox`.
- **CLI parity** (PRODUCT.md: agents and people edit the same thing):
  `wafflebase bots create|list|rename|delete|pair-code`, so a bot can be made
  from the terminal the member is already in. Settings → Bots is the same
  flow and the audit view.

**Creation flow** (Settings → Bots → *New bot*, or `wafflebase bots create`).
The policy question is asked here, where the choice is made, not discovered
later at a terminal refusal:

```
 New bot
 ─────────────────────────────────────────────────────────────
 Name    [ deck-bot              ]    Avatar [◐]

 Who will mention this bot?
 (•) Just me        Runs on your own Claude Code login or setup token.
 ( ) Any member     Needs an Anthropic API key or a Bedrock / Vertex /
                    Foundry credential on the host — a personal Claude
                    subscription can't serve a team.

                                           [ Cancel ]  [ Create ]
```

Create opens the **connect** step (§ 4) instead of a shown-once key:

```
 Connect deck-bot
 ─────────────────────────────────────────────────────────────
 In Claude Code (Just me):   /wafflebase:listen 4F2K-9QXD
 Or on a server:             wafflebase agent pair 4F2K-9QXD
                             wafflebase agent run deck-bot
 Code expires in 10:00 · single use · [ New code ]

 ○ Waiting for a host…            ← turns into ● Connected (MacBook)
                                                      [ Done ]
```

Until phase 4 ships team-bot controls (§ 11), *Any member* is shown but
disabled, labelled *Available with team bots*, so the choice is visible
before it is possible.

Each bot row in Settings → Bots shows: name, *Just me* / *Any member*,
owner, and host status — *Not connected*, *● Listening (host, since)*,
*Offline (last seen)* — from the bot's event-stream connections (§ 3).

### 2. Agent tasks

A task is one invocation of one bot. It is created by the backend, never by
the runner, at the point where a `chat_mention` for a bot (or a DM to a bot)
is written:

```prisma
model AgentTask {
  id              String   @id @default(uuid())
  workspaceId     String
  botId           Int      // User.id of the bot
  invokerId       Int      // User.id of the author of the trigger message
  triggerMessageId String  // ChatMessage
  channelId       String
  threadRootId    String?  // the thread the bot answers in
  hop             Int      // 0 when a person invoked; +1 per bot→bot step
  status          String   // queued | claimed | done | failed | cancelled
  leaseOwner      String?  // runner instance id
  leaseExpiresAt  DateTime?
  attempts        Int      @default(0)
  createdAt       DateTime @default(now())
  finishedAt      DateTime?
  @@index([botId, status, createdAt])
}

model ChatMessage {
  // …existing fields…
  agentTaskId String? // set on messages a bot posts while working a task
}
```

**Creation rules** (all server-side, in the same transaction as the message):

1. The trigger's author must satisfy the bot's `botInvokers`. If not, no task;
   the bot's mention chip renders with a "not available to you" note.
2. If the author is a bot, the trigger message must carry an `agentTaskId`;
   the new task's `hop` is that task's `hop + 1`. A bot message without a task
   (posted by a script with the bot key) creates no task.
3. `hop > MAX_AGENT_HOPS` (3) → no task; the backend posts a system line in
   the thread: "Stopped: agents replied to each other 3 times."
4. Single flight: at most one `queued | claimed` task per (bot, thread). A
   second mention while one is open is appended to the open task's context
   instead of creating a task.
5. Per-bot rate limit: the existing `UserThrottlerGuard` bucket keyed by the
   bot, plus a per-workspace cap on tasks per hour.

The invoker of a bot→bot task stays the **original human** (copied from the
parent task), so authority narrowing (§ 8) and audit always name a person.

### 3. Bot event stream and leases

```
GET  /api/v1/workspaces/:wid/bots/me/events?after=<cursor>   SSE
POST /api/v1/workspaces/:wid/bots/me/tasks/claim             → task | 204
POST /api/v1/workspaces/:wid/bots/me/tasks/:id/heartbeat     extend lease
POST /api/v1/workspaces/:wid/bots/me/tasks/:id/complete      { status }
```

- Authenticated by the bot's API key; `me` resolves to the key's bot.
- The stream carries thin events — `task.created`, `task.cancelled`,
  `task.context_appended` — and a cursor for resume after reconnect. Content
  is fetched with the normal chat reads.
- Claiming uses `FOR UPDATE SKIP LOCKED`, the webhook worker's pattern, so
  several runner replicas for one bot each get distinct tasks. Lease 60 s,
  extended by heartbeat; an expired lease returns the task to `queued`
  (`attempts + 1`, at most 2 retries, then `failed` with a thread notice).
- Outbound SSE rather than webhooks: the runner needs no public HTTPS
  endpoint, so it works from a laptop behind NAT. This is also the push
  channel chat.md defers ("a push channel is a later design").
- `task.cancelled` fires when a person replies "stop" to the bot in the
  thread or presses Stop on the bot's status message.

### 4. Pairing a host — bots and people

A long-lived key never passes through a clipboard or a shell `export`. The
connect step shows a **pairing code** instead, the way GitHub hands a
self-hosted runner a registration token. One mechanism serves both
principals:

```
POST /workspaces/:wid/bots/:id/pairing-codes        JWT (bot owner / ws owner)
POST /workspaces/:wid/pairing-codes                 JWT (the member, for themself)
     → { code: "4F2K-9QXD", expiresAt }             10 min, single use
POST /auth/pair  { code, hostName }                 unauthenticated, throttled
     → { principal: bot|person, id, workspaceId, server, apiKey }
                                                    mints a fresh key per host
```

**People** get the same flow for machines where a browser login is awkward
(a server, a container, a teammate's CI): Settings → API keys → *Connect a
machine* shows a code, and `wafflebase login --pair <code>` stores the
minted key in a CLI profile named after the workspace and makes it the
default profile. No key is ever displayed. People pairing ships in the
**same phase as bot pairing** (phase 2) — it is the same endpoint, and until
it exists the shown-once *Create API key* dialog is the only way to put a
person's key on a machine. Once it ships, that dialog stays for scripts that
need a raw key, and the docs, the setup skill and the dialog itself point to
*Connect a machine* instead. A profile key ranks below a browser
session in `resolveConfig`, so on a machine that also has a session,
`wafflebase status` reports `auth: "session"` and the pairing says so when it
finishes.

- For a bot, `wafflebase agent pair <code>` (and `/wafflebase:listen <code>`,
  which calls it) exchanges the code and writes `~/.wafflebase/agents/<bot>.json`
  (mode 0600): server, workspace, bot id, key. The workspace comes with the
  code, so no command takes `--workspace` and the user never copies an id.
- **This file is the only place a bot key lives on the host.** It is not a
  CLI profile and not `WAFFLEBASE_API_KEY`: `resolveConfig` puts an env key
  ahead of the login session (`packages/cli/src/config/config.ts`), so an
  exported bot key would silently turn the member's own Claude Code sessions
  in that shell into the bot. Bot credentials are read only by `agent`
  commands and by CLI calls that name a bot explicitly (`--as-bot <name>`).
- Each pairing mints its own key, labelled with `hostName`, so Settings →
  Bots lists hosts and revoking one host leaves the others running.
  *New code* never revokes anything.
- The SessionStart hook reports the identity it found, and says so when it
  is a bot (`/auth/me` returns `kind`), so an env key belonging to a bot is
  visible at the start of every session rather than discovered in the
  attribution later.

### 5. Listen mode — `/wafflebase:listen`

A plugin command that turns the member's current interactive Claude Code
session into the host for one of **their own** bots:

1. `/wafflebase:listen <code>` pairs (first time) or
   `/wafflebase:listen deck-bot` reuses the stored pairing.
2. The command refuses a bot whose `botInvokers` is `members`: the session
   runs on the member's own Claude login, which may only serve the member
   (§ 7).
3. It loops on `wafflebase agent next --wait 240`: the call waits on the bot
   event stream (§ 3) for at most 240 s — under the Bash tool's 10-minute
   ceiling — and prints either one claimed task or `{ "task": null }`, on
   which the command simply waits again. A bounded wait also gives Esc a
   point to land between calls.
4. Claude handles the task with the plugin's ordinary skills. CLI calls run
   with `--as-bot deck-bot`, so writes and replies are attributed to the bot
   and carry the task header (§ 8). `--as-bot` picks a credential, which the
   plugin guard otherwise always asks about; listen mode writes
   `~/.wafflebase/agents/listening.json` (bot name, Claude session id) on
   start and removes it on stop, and the guard treats `--as-bot` naming
   **that** bot, in **that** session, like the same command without the
   flag. Any other `--as-bot` still always asks. The row lives in the
   generated guard table and is drift-tested like the rest.
5. The interactive guard stays in force: the member is present, so a write
   still asks unless they opted into auto-approve. That is the point of
   listen mode — a human-in-the-loop bot, before a headless one.
6. `wafflebase agent complete`, then back to step 3. Esc or `/wafflebase:stop`
   ends the loop and releases any claimed task.

Listen mode is an **attended** bot, not an always-on one, and the product
says so where people look: the bot row reads *● Listening in Claude Code —
offline when that session ends*, and teammates' mention chips show the
same state. Limits, stated in the command's own output: while listening the session
is dedicated to the bot (Esc to talk to Claude, re-run to resume), tasks run
one at a time, they share the session's context (each task starts with a short "new task"
boundary and the thread it came from), and the bot goes *Offline* when the
session closes. Anything always-on is the runner.

### 6. The runner — `wafflebase agent run`

A CLI subcommand, so it reuses the CLI's config, HTTP client and error
envelope:

```bash
wafflebase agent pair 4F2K-9QXD               # once per host
claude setup-token | wafflebase agent credential set deck-bot
                                               # or: --anthropic-api-key-stdin
wafflebase agent run deck-bot --concurrency 2
```

`agent credential set` reads the Claude credential from stdin (never an
argument, never the shell history) into the bot's agent file, beside the
bot key, mode 0600. `agent run` passes it to each Claude Code child as
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` and nowhere else, so it
never changes the Claude identity of the operator's own shell. A CI runner
that injects secrets as environment variables may still set them; the
banner names which source won.

It starts with a one-line banner that restates the policy check it just ran,
so the operator sees the decision rather than only a refusal:

```
deck-bot · Just me · subscription token (agent file) · OK — listening on acme (2 slots)
```

Per task:

1. **Claim**, then post a status message ("Working on it…") as the bot,
   with `agentTaskId` set — within a few seconds of the mention.
2. **Prompt**: trigger message, the thread so far (bounded), and the
   referenced document cards (id, type, title, anchor). Document *content* is
   not inlined; the agent reads it with targeted CLI reads, as the plugin's
   skills already teach.
3. **Run** Claude Code headless in a fresh per-task working directory:
   `claude -p --output-format stream-json` with the Wafflebase plugin and
   `--allowedTools` limited to the `wafflebase` CLI. Environment for the
   child process only: the bot key from the agent file, `WAFFLEBASE_AGENT_TASK=<task id>`, the Claude
   credential, and `WAFFLEBASE_AGENT_HEADLESS=1`. Do not pass `--bare`: per
   the authentication docs, bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`
   (verify in phase 3; the GitHub Action runs headless with that token).
4. **Stream** `stream-json` events into edits of the status message (tool
   name + target, throttled to one edit per few seconds).
5. **Finish**: post the answer as a thread reply (document URLs become cards
   on their own), mark the status message done, `complete` the task.
6. **Resume**: the runner keeps a local `threadRootId → Claude session id`
   map and passes `--resume` on follow-ups, so a thread is one conversation.
7. **Cancel**: on `task.cancelled`, SIGTERM the child, post "Stopped".

The runner holds no workspace state beyond that session map; losing the host
loses only conversational memory.

### 7. Credential and invocation policy

| Bot `botInvokers` | Host credential | Allowed |
| --- | --- | --- |
| `owner` | listen mode: the owner's own Claude Code login | Yes — the owner using their own subscription, interactively |
| `owner` | owner's `CLAUDE_CODE_OAUTH_TOKEN` | Yes — the owner using their own subscription |
| `owner` | API key / Bedrock / Vertex / Foundry | Yes |
| `members` | team API key / Bedrock / Vertex / Foundry | Yes — the customer's own key for its own authorized users |
| `members` | a person's `CLAUDE_CODE_OAUTH_TOKEN` | **No** — one subscription serving a team |

Enforcement is layered, and honest about what each layer can know:

- **Server (authoritative for invocation):** task creation checks
  `botInvokers` (§ 2 rule 1). A subscription-backed owner-only bot cannot be
  made to work for someone else no matter what the runner does.
- **Runner (guard for the credential):** at start it reads the bot's
  `botInvokers`; if it is `members` and `CLAUDE_CODE_OAUTH_TOKEN` is the only
  credential, it refuses to start and explains why. The server cannot see the
  runner's environment, so this protects honest operators, not against a
  modified runner.
- **Creation flow:** the *Who will mention this bot?* question (§ 1) states
  the credential each answer needs before the bot exists, and the runner's
  start banner (§ 6) restates the result. Switching an existing bot to *Any
  member* repeats the one-line rule, names the cost owner ("every member's
  request is billed to this host's API key"), and tells the owner that a
  host paired with a subscription token will refuse to start until it is
  given an API key.
- **Listen mode** refuses *Any member* bots outright (§ 5).

### 8. Authority: the bot never sees more than its invoker

Documents: every workspace member can open every document in the workspace
today (the schema has no per-document ACL inside a workspace), so a bot with
member authority reads nothing its invoker could not.

Chat is the gap. A bot is a member of the channels it was added to; a private
channel it belongs to may exclude the invoker. Without narrowing, Bob could
ask the bot in `#general` to "summarize #exec", and the bot would.

So every CLI call the agent makes carries `X-Wafflebase-Agent-Task: <id>`
(from `WAFFLEBASE_AGENT_TASK`), and when a bot key presents a task id the
backend **intersects** the bot's chat read authority with the task invoker's:
a channel is readable only if both are members. Posting is limited to the
task's own channel. A bot key calling chat reads **without** a task header is
refused — the agent cannot opt out by dropping the header. Document reads and
writes are unchanged (equal authority already).

Prompt injection: document and chat content are data, never instructions —
already a core skill rule in the plugin. The headless profile adds: no local
file reads outside the task directory, no network tools, and the plugin's
destructive commands are denied outright rather than asked.

### 9. Edits and attribution

- Writes go through the bot's API key, so `runAsApiWriter` attributes them to
  the bot, and webhook events name the bot as actor.
- Headless profile of the plugin guard (`WAFFLEBASE_AGENT_HEADLESS=1`):
  - reads and ordinary writes: allow (there is no one to ask);
  - destructive commands (delete, trash, whole-document replace without the
    backup copy, share-link and key changes): deny;
  - credential and local-file commands: deny.
- Undo in v1 is the editor's revision history panel (all five CRDT types),
  plus the plugin's existing rule of a backup copy before any whole-document
  replace. Neither the CLI nor `/api/v1` can create or restore a revision
  today ([claude-plugin.md](claude-plugin.md) lists it under Future work), so
  "snapshot before the first write, link Restore in the answer" waits for that
  API and lands in phase 4. Suggestion mode is later still.

### 10. Agent-to-agent

Two bots in one thread talk only through visible thread messages: bot A's
reply mentions bot B → a task for B with `hop + 1` and the same human invoker.
There is no back channel. The hop cap, single flight per (bot, thread) and
the "bot messages without a task trigger nothing" rule together make a loop
impossible: every bot→bot step consumes a hop, and only task-bound messages
can spend one.

### 11. Operating bots: spend, audit, pause

A team bot spends someone's money on someone else's request, so three
people need to see it:

| Who | Sees | Where |
| --- | --- | --- |
| Invoker | Their own tasks: bot, status, duration | The bot's status message; their notifications |
| Bot owner | Every task of their bots: invoker, duration, outcome, host | Settings → Bots → bot detail |
| Workspace owner | Every task in the workspace, plus caps | Settings → Bots → *Activity* |

- The task log is the `AgentTask` table itself (invoker, bot, host,
  timestamps, outcome). Hosts may report token usage on `complete`; it is
  shown as *reported by host*, because a subscription-backed host has no
  per-request bill and the server cannot verify either.
- **Caps**: per-workspace tasks per hour and per bot per day, set by the
  workspace owner; a capped mention gets a system line naming the cap, not
  silence.
- **Pause all bots** (workspace owner, `Workspace.botsPaused`): task
  creation stops with a system line in the thread, every bot stream
  receives `bots.paused` and hosts stop claiming. The kill switch for a
  runaway or a cost spike, without revoking a single key.
- Settings gains a **Bots** entry in the section index once bots ship.
- Host status (*● Listening*, *Offline*) is text, not only a glyph or a
  colour, and changes are announced through an `aria-live="polite"` region
  on the bot row.
- Out of scope here and noted as a gap: an instance-wide switch above the
  workspace (*Pause all bots* is per workspace); an operator can stop the
  backend's task creation with an env flag (`AGENT_TASKS_ENABLED=false`)
  until a UI for it is designed.

## Phases

1. **Bot members + chat API** (chat.md P3 subset): `User.kind/botOwnerId/
   botWorkspaceId/botInvokers`, Settings → Bots with the creation flow,
   login refusal, lifecycle, `/api/v1` chat mirror, CLI chat verbs and
   `wafflebase bots`, Bot / via API labels, `/auth/me` returning `kind`.
2. **Agent tasks + pairing**: `AgentTask`, `ChatMessage.agentTaskId`,
   creation rules, bot event stream, claim/lease/heartbeat, cancel, system
   notices, pairing codes for bots **and people** (`/auth/pair`,
   `wafflebase agent pair`, `wafflebase login --pair`, Settings → API keys →
   *Connect a machine*), `wafflebase agent next|complete`, host status on the
   bot row, task-header authority narrowing.
3. **Listen mode**: `/wafflebase:listen`, `--as-bot`, SessionStart bot
   identity line, and the docs-site page "Put a bot to work" — written with
   the first host, not after it.
4. **Runner + team bots**: `wafflebase agent run`, `agent credential set`,
   plugin headless profile, start banner, status message streaming, session
   resume, credential guard; *Any member* bots become selectable only in
   this phase, and they ship **with** their controls: per-workspace task
   caps, the task log (§ 11) and *Pause all bots*. The docs page gains the
   server section.
5. **Hardening**: Docker image for team servers, comment mentions feeding the
   same queue, revision snapshot before the first write once `/api/v1`
   exposes revisions.

Each phase is shippable alone: phase 1 lets a person script a bot with the
CLI and pull its inbox; phase 2 lets any agent framework consume the stream;
phase 3 is a personal bot with a human watching; phase 4 is always-on.

## Alternatives Considered

| Option | Verdict |
| --- | --- |
| Store a setup token in workspace settings, run the agent in the backend | Rejected — the terms forbid collecting, storing or intermediating Claude.ai credentials |
| Built-in backend agent with a workspace API key (BYOK, #696's seam) | Complementary, not a replacement — needs the backend to own a model loop (a non-goal in notes.md and agentic-office-workflow.md today) and a secret store; can reuse `AgentTask` and § 8 later |
| Push tasks over workspace webhooks | Rejected for v1 — needs a public HTTPS endpoint; webhooks.md already excludes private-channel and DM events from workspace webhooks |
| Hand the bot key over as a shown-once secret exported as `WAFFLEBASE_API_KEY` | Rejected — an env key overrides the login session, so the member's own sessions would become the bot; and a long-lived secret on a clipboard is the riskiest step in the flow. Pairing code + agent-only file instead (§ 4) |
| Only the headless runner, no listen mode | Rejected for the first host — a personal bot would need a second process and a setup token; listen mode reuses the session the member already has and keeps a human approving writes |
| Runner as a new package with its own HTTP client | Rejected — duplicates the CLI's auth and envelope; a subcommand is less code |
| Remote MCP connector so each person's Claude acts directly | Deferred — no in-product chat UX, and needs an OAuth 2.1 server; orthogonal to this design |
| Agent SDK in the runner instead of the Claude Code binary | Possible later; the binary path reuses the plugin as-is, and its subscription sign-in is the case the terms explicitly allow |

## Risks

- **Policy drift.** The terms can change; the credential table (§ 7) is the
  single place to update, and the runner guard is one function.
- **Self-declared runner.** The server cannot verify which credential a
  runner uses; only invocation is enforced server-side. Documented, not
  hidden.
- **Runner offline.** Tasks wait `queued`; after 2 minutes unclaimed the
  backend posts "deck-bot's runner is offline" once in the thread, and the
  mention chip shows the bot as offline (last stream connection time).
- **Cost surprise on `members` bots.** The team key pays for every member's
  request; *Any member* bots ship only together with caps, the task log and
  *Pause all bots* (§ 11, phase 4).
- **Listen mode mixes contexts.** Tasks share one session; a long thread can
  crowd out the next task. The task boundary line helps; the honest answer
  for heavy use is the runner, and the command says so.
- **Pairing code interception.** 10-minute single-use codes, shown only to
  the bot owner, exchanged over the same TLS as everything else; the
  exchange endpoint is throttled per IP and per bot.
- **Headless guard over-allows.** The headless profile is a second table in
  the plugin guard, generated and drift-tested like the first.

## Open Questions

1. Should status-message streaming edit one message or post activity as
   collapsed sub-messages (Linear-style typed activity)? Default: one edited
   message.
2. Should a bot be addable to private channels by any channel member, or only
   by the bot owner? Default: bot owner or workspace owner only, because
   adding a bot widens what its owner's runner can read.
3. While listening, the session is dedicated to the bot between bounded
   waits; the member presses Esc to talk to Claude and re-runs
   `/wafflebase:listen` to resume. Should listen mode instead run the wait as
   a background task that wakes the session? Default: the bounded loop —
   simple and visible; revisit once the plugin can rely on background tasks.
4. Does phase 1 need the full chat.md P3 (search included), or only bots +
   API mirror + CLI verbs? Default: the latter; search is independent.
