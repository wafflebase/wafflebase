---
title: agentic-office-workflow
target-version: 0.6.8
---

# Agentic Office Workflow

## Summary

`packages/cli/skills/` ships 17 skill files and a `SKILL.md` describing them as
"self-contained instructions for AI agents", and the CLI speaks `--format json`
with a `schema` subcommand. **Nothing measures how far that surface actually
gets an agent.** Every claim about it today — in the README, in the skills, in
conversation — is an assertion with no run behind it.

This document proposes answering the question by measurement: a
`wafflebase-office-agent` (system prompt + command scope) and a
`wafflebase-office-bench` (27 graded tasks), plus the capability audit produced
while preparing them, which found that a large part of what the backend can do
has no way to be called from a terminal.

Tracking issue: [#998](https://github.com/wafflebase/wafflebase/issues/998).
Original proposal by @ggyuchive (v1, 2026-08-29).

Precedent: `scripts/agent/eval/` already measures the code-review panel against
CodeRabbit — freeze past PRs, replay the real panel K times, score on fixed
criteria, keep run data outside the repo. This is that method pointed at office
work instead of review. See [agentic-dev-loop.md](agentic-dev-loop.md) for how
the review side fits together and
[eval-harness-usage.md](eval-harness-usage.md) for how its numbers are kept
honest.

### Goals

- Replace "the CLI is agent-ready" with a number that can be reproduced.
- Separate three things a single success rate confuses: the agent's skill, the
  CLI's coverage, and the host's own abilities.
- Produce a roadmap for the CLI as a by-product — the scoring items an agent
  cannot satisfy *are* the gap list.
- Test one claim: that office specialization lowers the minimum viable model
  class rather than raising the ceiling.

### Non-Goals

- **Building a model loop.** The host CLI (Claude Code, Codex) is one already.
- Beating Claude for Microsoft 365 on quality.
- LLM-judged scoring. Grading inspects stored document state, so the same run
  always yields the same score.
- Generating tasks with an LLM. The 27 tasks are hand-written (see
  [Task set](#task-set)).

## Proposal Details

### 1. What gets built, and what is borrowed

| Piece | Owns | Deliberately does not own |
| --- | --- | --- |
| `wafflebase-office-agent` | System prompt, the command scope exposed to the agent, host exec flags | The model loop — borrowed from the host via `--bare --restricted --system-prompt` |
| `wafflebase-office-bench` | 27 tasks + fixtures, expected end-state, scoring, run metrics | Any design that favours `office-agent` — it must score vanilla Claude Code on the same basis |

```
host CLI (Claude Code / Codex)  ── owns the model loop
        │  system prompt · tool allowlist · model
        ▼
wafflebase-office-agent   NEW    ── prompt + command scope; where bench
        │                            conclusions get written down as code
        │  Bash(wafflebase *) — the only permitted surface
        ▼
wafflebase CLI  v0.6.7           ── what the agent actually holds
        │
        ▼
/api/v1                          ── the public contract
        │
        ▼
wafflebase backend               ── Yorkie · formula engine · document store
```

`wafflebase-office-bench` sits beside this, supplying fixtures, grading state,
and recording turns / tokens / per-command call counts. It must remain neutral:
it has to score `office-agent` and an unconfigured Claude Code on identical
terms.

### 2. Why office work is auto-gradable here

Coding agents work because the compiler is a free grader. Office agents usually
have no equivalent — there is no way to tell whether an edited deck is *right*.
Wafflebase happens to have four things that together supply one:

| | |
| --- | --- |
| **Formula engine** | ANTLR4 recalculation is the compiler analog. A stored cell value is ground truth, and a wrong edit surfaces immediately. |
| **Yorkie CRDT** | Checkpoint and undo already exist at the infrastructure level, so rolling back a wrecked fixture needs no new machinery. |
| **`/api/v1`** | Fixture creation, seeding, isolation and read-back are all API-driven — the precondition for repeating a run hundreds of times. |
| **Document-type breadth** | sheet · doc · slides · note · board · pdf · image in one workspace, so cross-type tasks are constructible *and* gradable. |

That last point is also the structural difference from Claude for Microsoft 365,
which attaches to Excel / Word / PowerPoint app by app. Here one agent spans the
set, and aggregating in a sheet → writing a report doc → building a deck is one
session. The 9 `hard` tasks are exactly that shape, which is what makes them
worth measuring.

### 3. Capability audit

Measured against `main` at CLI **v0.6.7** (the original proposal audited
v0.6.6). Method: the routes actually declared in `packages/backend/src/api/v1/*`
and the JWT-only web controllers, against the command tree actually registered
in `packages/cli/src/commands/*`.

None of this is a new feature. The endpoints exist and the web editor exercises
them daily; what is missing is a way to call them without a browser.

#### What the CLI has today

```
docs    list create get rename delete content(read) export import
notes   list create get rename delete content(read) export import
slides  list create get rename delete content(read) export import
sheets  cells{get,set,delete,batch}  tabs{list,create,rename}  import export
files   upload download list get rename delete
ctx     list switch          api-keys create list revoke
login logout status schema
```

#### A — endpoint exists under `/api/v1`, no CLI command (~37)

Closes in the CLI layer alone. The cheapest group, and the first place to spend
time.

| Area | Items | Endpoint (`.../tabs/:tabId/`) |
| --- | --- | --- |
| Style / formatting | 8 | `range-styles` · `sheet-style` · `column-styles` · `row-styles` (GET/PUT each) |
| Structure display | 6 | `freeze` · `hidden` · `merges` (GET/PUT each) |
| Dimensions | 4 | `column-widths` · `row-heights` (GET/PUT each) |
| Rules | 4 | `conditional-formats` · `data-validations` (GET/PUT each) |
| Analysis | 4 | `filter` · `pivot` (GET/PUT each) |
| Rows / columns | 4 | `POST clear` · `insert` · `delete` · `move` |
| Charts | 2 | `charts` (GET/PUT) |
| Content **write** | 2–3 | `PUT .../content` accepts doc · slides · note, but the CLI's `content` is read-only in all three (`docs.ts:188`, `notes.ts:146`, `slides.ts:151`) |
| Workspace images | 3 | `POST` / `DELETE .../images/:imageId` · `GET .../images/:imageId` |

#### A′ — backend has it, but outside `/api/v1` and JWT-only (7)

| Area | Items | Evidence |
| --- | --- | --- |
| Folders | 5 | `folder.controller.ts:22-23` — bare `@Controller()` + `@UseGuards(JwtAuthGuard)` |
| Document copy | 1 | `document.controller.ts:296` — `POST documents/:id/copy` |
| Move to folder | 1 | `document.controller.ts:230,310` |

**An API-key caller cannot reach these at all.** A `wafflebase login` JWT
session can, because `jwt.strategy.ts:21` also accepts a Bearer header. So the
group does not close by adding a command: it needs `CombinedAuthGuard` or an
`/api/v1` folder surface, and a decision about whether agent-facing automation
is expected to work under an API key at all.

#### B — not in the backend either (18)

No command can close these.

| Area | Items | Evidence |
| --- | --- | --- |
| Comments | 6 | No comment controller under `/api/v1`; comments live in the Yorkie CRDT and never pass through the backend |
| Slide granular editing | 5 | No add / duplicate / delete / move-slide or list-layouts endpoint — only the whole-document `PUT content` |
| Tab rearrange | 3 | `tabs.controller.ts` declares `@Get` · `@Post` · `@Patch(':tabId')` (rename) only — there is no DELETE |
| Sheet floating images | 2 | `/api/v1` has workspace image upload/read only; no per-worksheet image endpoint |
| Board | 2 | `docs-content.controller.ts:94` rejects any type that is not `doc` / `slides` / `note` |

#### C — host-dependent (2)

PDF and image **content** extraction. Wafflebase serves bytes, not meaning, so
the agent leans on the host's own file reading. Those tasks measure the host,
not wafflebase, and must be reported separately.

#### Reading the totals

This recount lands near **64** against the proposal's 57; the counting basis
differs (workspace images and board are added here, get/set pairs counted
uniformly). The total is not the point. The composition is:

| Class | Items | What closing it costs |
| --- | --- | --- |
| A | ~37 | CLI commands only |
| A′ | 7 | Backend auth/surface change **and** a CLI command |
| B | 18 | New backend endpoints first |
| C | 2 | Nothing — separate it from the score |

"Fill in the missing commands" therefore covers roughly **37**, not 57. The
largest single correction against the original audit is tab rearrange, which
moves from A to B.

**While gap A is open, the bench ceiling is held down.** However good
`office-agent` gets, it cannot perform an action that has no command, so scores
taken before and after filling commands in are not comparable. Every
measurement records the CLI version alongside it.

### 4. Task set

27 tasks — easy 9 / medium 9 / hard 9 — across 5 personas (Sales Ops,
Accountant, PM, Marketing, Developer) and 7 document types. `easy` is a single
document and a single action; `medium` is structure, formatting and generation;
`hard` is a cross-document workflow.

Persona × complexity is borrowed from RAG test-set generation. Ragas' test-set
generator takes a list of `Persona(name, role_description)` together with a
complexity distribution (single-hop / multi-hop, 0.5 / 0.5 by default) and
builds questions from both. The mapping is near one-to-one: the five personas
are Ragas' `Persona`, easy/medium/hard 9/9/9 is the complexity distribution, and
single-hop vs multi-hop is single-document vs cross-document workflow.

Why the split matters:

- **Persona** — accounting and marketing ask entirely different things of the
  same workspace. Without personas the task author drifts toward what they
  personally know, and an agent good at only that one thing scores full marks.
  A side effect: a role makes the prompt read like real work, so the bench
  measures whether the job got done rather than whether tool syntax was
  memorized.
- **Difficulty** — one aggregate score hides *what* broke. Failing at `easy`
  means basic read/write is broken; failing only at `hard` means individual
  actions work but cannot be chained. The remedies are completely different.
  This matters most when sweeping models, since the question is precisely at
  which tier a small model collapses.

What is deliberately changed from Ragas: tasks are **hand-written**, not
LLM-generated. Office work does not end at reading — it mutates document state,
so the expected answer is not a string but "what state must the document be in
afterwards". That is hard to generate, and once written by hand it can be graded
by state inspection with **no LLM in the loop**. The trade is scale for scoring
reliability: 27 is small, but there is nothing to argue about in what a score
means.

Prompts state what is wanted, never how. The word `wafflebase` does not appear
in them.

Scores are reported in two branches — CLI-reachable items only (the agent's
skill) and the whole set (that skill minus what the CLI cannot reach). Each
scoring item is tagged with whether it is CLI-reachable, which is what makes the
split possible.

### 5. Hypothesis

The claim is **not** "a specialized harness beats a general one". On frontier
models the difference is expected to be small — a strong model absorbs the
exploration cost.

> Office specialization does not raise peak performance; it shifts the curve
> left. It lowers the minimum model class at which office work is viable. The
> value is cost, not quality.

The falsifier is built in: if `office-agent` wins on every model including the
strongest, that reads as a too-weak baseline or as tuning to these 27 tasks —
not as a result.

### 6. Method

One variable moves at a time. The baseline is vanilla Claude Code with no
configuration, handed only the wafflebase CLI — which is what a user gets today,
and is not a soft target: the bench prompt already supplies folder contents,
document ids, how to find the CLI, and the answer format.

| Condition | Fixed | Varied | Question it answers |
| --- | --- | --- | --- |
| Baseline | — | — | What an unconfigured host gets today |
| Prompt | tool surface = CLI | system prompt | What the prompt alone is worth — the cleanest single variable |
| Command scope | model, prompt | all / curated / minimal | Does narrowing the documented command set improve selection, or block it |
| CLI version | model, prompt | before ↔ after closing gap A | Does closing gap A beat improving the agent — i.e. where to spend time |
| Model | best config | opus / sonnet / haiku | Does the curve actually shift left |

Success rate is not the only metric. **Turns, tokens, and per-command call
counts are recorded too.** Equal success at a third of the tokens is a win, and
whether 30 cells went through 30 `set` calls or one `batch` shows up nowhere
else.

### Risks and Mitigation

| Risk | Mitigation |
| --- | --- |
| **Zero runs so far.** The bench has never been executed; every performance claim here is a hypothesis, not evidence. | No number is quoted anywhere until a run exists. This document states the hypothesis as a hypothesis. |
| **Bench isolation.** The agent runs with `--dangerously-skip-permissions` from the bench root, where `CLAUDE.md` is auto-loaded (the subject reads the scoring design) and `tasks/*/manifest.yaml` held 45 expected answers. Whether they were opened is unconfirmed, because there are no run records. | Move fixtures and manifests to a temp directory outside the agent's working root. Must be closed **before** the first number is taken. |
| **Tuning to 27 tasks.** A bench this small is easy to overfit, especially once it also drives the CLI roadmap. | Keep the two score branches separate, and treat a win on every model as a red flag rather than a result (see [Hypothesis](#5-hypothesis)). |
| **Class C contaminates the score.** PDF/image extraction measures the host. | Tag those scoring items and report them apart from the wafflebase score. |
| **Audit drift.** The gap list is a snapshot; it was already one release stale when written. | Re-derive it against the current tag before quoting it as a roadmap, and record the CLI version with every measurement. |

## Open Questions

1. **Where does the bench prototype live?** The proposal states both pieces are
   yet to be built, and also that the bench is built-but-never-run with a known
   isolation bug and 45 stored answers. If a prototype exists outside this
   repository it should be named, so the work starts from it.
2. **Package boundary.** Do `office-agent` and `office-bench` live in this
   monorepo (`packages/`, or `scripts/agent/` beside the existing eval harness),
   or outside it? The eval harness keeps run data outside the repo; the same
   question applies to fixtures.
3. **Do agents authenticate with an API key or a session?** Gap A′ is only a gap
   under an API key. The answer decides whether folder and copy support is a
   guard change or a non-issue.
