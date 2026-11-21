# Workspace Chat P1 — Lessons

Plan: [20261120-chat-p1-todo.md](20261120-chat-p1-todo.md) · Design: [chat.md](../../design/chat.md)

## Design phase

- Workspace membership already grants access to every document in the
  workspace, so Lark's "grant access when a link is shared" step has nothing to
  do here. An early flow mockup proposed a "3 people can't open this" warning;
  checking the access model before designing the flow would have caught it.
- A builder-check review of the design caught three gaps that would have
  stalled implementation: a column the delivery path depended on (`lastSeq`)
  was missing from the model, the per-user stream had no `:workspaceId` for
  `WorkspaceScopeGuard`, and document URLs carry no workspace. Run the check
  before handing a design over, not after.

## Self-review rounds

_(log each `/self-review` round here)_
