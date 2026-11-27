# Run agent-implement's post-agent steps in their own job — Lessons

- Staging a copy of the scripts before the agent does not protect a step after
  it in the same job: the agent can change the job's environment and git
  configuration as well as the files. The boundary is a fresh runner.
- A guard written as a rule over every job finds the cases nobody listed. Keep
  what it finds that is out of scope as an exact list that fails when an entry
  goes stale, so it can only shrink.
- Splitting on shell operators inside quoted text turns prose into commands.
  Read quoted strings as one word before splitting a script.
- A safety step marked `continue-on-error` is a step whose failure the job
  proceeds past. A revocation that guards what follows has to fail the job.
- When a later job takes over steps that used to run in the same job, it also
  takes over their conditions. Carry the gate across as an output written
  only after the gate passed.
- The job's own token reaches an action's environment whether or not a step
  names it. Declare a job's permissions, even when every step brings its own.
