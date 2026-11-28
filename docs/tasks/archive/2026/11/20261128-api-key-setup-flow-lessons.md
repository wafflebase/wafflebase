# API Key Setup Flow — Lessons

Paired with [20261128-api-key-setup-flow-todo.md](20261128-api-key-setup-flow-todo.md).

## Mock the API instead of borrowing a session for a render check

The memory recipe for screenshotting a second Vite needs the backend CORS
shim plus a session cookie. For a settings page the cheaper route is to
fulfill every `localhost:3000` request from fixtures in a Playwright route:
no cookie, no real data, and the fixtures can carry long values (a full key,
a UUID) that expose layout bugs a short-lived real account would not.

**Rule:** for a render check of one screen, fixture the API; borrow a real
session only when the behavior under test is the server's.

## A copy block must show what it copies

`overflow-x-auto` on the CLI setup block looked fine at desktop width and
hid the key and server at 400px. A user who cannot see a line cannot check
it before pasting it into a shell. **Rule:** command snippets in dialogs wrap
(`whitespace-pre-wrap` + `overflow-wrap:anywhere`); check them at phone
width with real-length values.

## A fix can open the next dead end

Round 1 made the reveal dialog hand out `export WAFFLEBASE_API_KEY …`. Round
2 found that the setup skill then sends exactly those users to `ctx list`,
which needs a browser session. The new path was tested in the dialog and
never walked one step further.

**Rule:** after adding a handoff, follow the user through the next surface
it sends them to (here: the setup skill) before calling the journey fixed.

## Guidance copy is a design decision too

Round 2 added "keep the key in a password manager or your shell profile" to
the reveal dialog to reassure. Round 3 found the second half teaches the
pattern the agent-runner design bans: an exported key in a profile beats the
browser session on that machine indefinitely. One reassuring clause undid a
design principle.

**Rule:** before writing advice into UI copy, check it against the
credential-precedence rules and the design docs the same way code is
checked; "helpful" copy can carry the bug.
