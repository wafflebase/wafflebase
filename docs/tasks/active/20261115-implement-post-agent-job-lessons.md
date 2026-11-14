# Run agent-implement's post-agent steps in their own job — Lessons

- Staging a copy of the scripts before the agent does not protect a step after
  it in the same job: the agent can change the job's environment and git
  configuration as well as the files. The boundary is a fresh runner.
- A guard written as a rule over every job finds the cases nobody listed. Keep
  what it finds that is out of scope as an exact list that fails when an entry
  goes stale, so it can only shrink.
- Splitting on shell operators inside quoted text turns prose into commands.
  Read quoted strings as one word before splitting a script.
