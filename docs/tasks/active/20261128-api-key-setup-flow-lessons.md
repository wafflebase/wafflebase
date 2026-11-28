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
