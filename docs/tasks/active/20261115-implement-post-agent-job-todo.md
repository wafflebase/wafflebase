# Run agent-implement's post-agent steps in their own job — Task Tracking

In `agent-implement.yml`, the steps after the agent ran in the agent's own
job, from the workspace the agent had just been able to write: the session
summary, the effort record (with the App token) and the classifier (with the
App token and `ANTHROPIC_API_KEY`). A step after the agent in the same job
inherits whatever the agent could change there, so those steps get a job of
their own. Model: yorkie's `agent-implement.yml` (`finish` job, token
revocation).

## Plan

- [x] A `finish` job, `needs: implement`: sparse checkout of main
      (`scripts/agent`, `scripts/agent-arms`), `persist-credentials: false`,
      its own App token (contents read, pull requests write, issues write),
      the agent's log downloaded as data; the summary, effort record, no-PR
      report and classifier move there. `ANTHROPIC_API_KEY` appears there only
- [x] The implement job keeps only the log upload after the agent
- [x] Two tokens in the implement job: the gates' token (administration read,
      issues write) with `skip-token-revoke`, revoked before the agent; the
      agent's own (contents, pull requests, issues write), which the checkout
      persists and the agent is given
- [x] Guard: after the agent step of any agent job, no step runs workspace
      code, reads a secret, or holds an App token minted before the agent that
      the agent was not given; mutation cases for each. The implement job's
      shape (revocation, the agent's token, the `finish` job) is asserted
- [x] actionlint, the guard suite, `pnpm verify:self`

## Review

- Steps after the agent elsewhere that the new guard finds and that this task
  does not move (an exact list in the guard, which can only shrink): the
  loop-status updates of `agent-fix`, `agent-iterate-ci` and the panel's `fix`
  job, and the panel's no-commit page, read `GITHUB_TOKEN`; `agent-summarize`
  mints its post-only token after its agent (Read and Write only).
- The agent's token no longer carries permissions beyond contents, pull
  requests and issues; a push that touches `.github/workflows/` needs a
  person, as other CI-defining changes do.
- `finish` declares `environment: agent` for the classifier's key, so a
  required reviewer on that environment approves it as well.

## Review round 1

A security review confirmed the move closes what it set out to close. Fixed:

- [x] The implement job's own token inherited the workflow's write scopes and
      reaches the agent's step. The job now declares `contents: read`; every
      write in it goes through an App token
- [x] The revocation was fail-open. It now runs under the agent step's own
      condition with no `continue-on-error`, so a failed revocation skips the
      agent; the no-PR report says when the agent never started
- [x] `finish` ran for a commenter the write-access gate refused. It now keys
      on an `admitted` output written by the step right after that gate
- [x] Guard gaps: a write to `$GITHUB_ENV`/`$GITHUB_PATH` (or
      `exportVariable`/`addPath`) after the agent or in a job that reads its
      output; a secret in workflow- or job-level `env:` of an agent job; a
      module loaded by path from github-script in such a job; the agent step
      given anything but the picked OAuth credential and one App token; an
      agent job whose token can write. Each is a named edit that fails
- [x] Unescaped fields of the execution log in the summary, the effort
      record's stdout and its hidden marker: yorkie's `metrics.mjs` already
      coerces them (`num`, `SAFE_ID`, escaped hidden JSON), and the sync
      replaces this copy, so it is not patched here

Agent jobs whose token can still write are listed in the guard like the
post-agent steps above: `agent-fix`, `agent-iterate-ci`, the panel's `fix`
and `agent-review-reply`.

