#!/bin/sh
# Claude Code hook: PreToolUse(Bash)
# Enforces an AI-disclosure trailer on commits made during an AUTONOMOUS agent
# run, so provenance is mechanical rather than prose. Gated on the
# WAFFLEBASE_AGENT_AUTONOMOUS env var, which only the local `/spec-to-pr` front
# half exports, so this hook is LOCAL-ONLY. The shared agent workflows (yorkie's
# core) do not set it: in CI the disclosure that counts is the PR body's, which
# their report jobs write (`disclose-pr.mjs`) and the ready gate checks
# (`mark-ready.mjs`). Human and interactive-agent sessions (var unset) are
# unaffected, matching the "same workflow as a human" contract while adding a
# disclosure gate on top.
#
# Only inline message commits (`-m`, `-am`, `--message`) are checked (the trailer
# must appear on the command line). `-F`/`--file`, `--amend --no-edit`, interactive
# rebases, etc. pass through — their message isn't on the command line to inspect,
# and `spec-to-pr.mjs handoff`, which refuses a branch with any commit missing
# the trailer, is the backstop. This hook only moves that refusal to commit time,
# before a history has to be rewritten to satisfy it.
#
# Exit 0 = allow, Exit 2 = block (STDERR fed to Claude as context)

# No-op outside autonomous runs.
[ "$WAFFLEBASE_AGENT_AUTONOMOUS" = "true" ] || exit 0

INPUT=$(cat)
# printf, not echo: POSIX `sh`/dash `echo` interprets backslashes, which would
# corrupt JSON containing them before it reaches node.
COMMAND=$(printf '%s\n' "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.command||'')}
    catch{console.log('')}
  });
")

DISCLOSURE="Assisted-by: Claude Code (autonomous)"

case "$COMMAND" in
  *"git commit"*)
    # Only enforce when the message is supplied inline on the command line.
    # Matches -m, -am (add-all + message); --message. Not --amend (no " -am ").
    case "$COMMAND" in
      *" -m "*|*" -am "*|*" --message"*)
        case "$COMMAND" in
          *"$DISCLOSURE"*) exit 0 ;;  # trailer already present
        esac
        echo "BLOCKED: autonomous commits must disclose AI authorship." >&2
        echo "" >&2
        echo "Add this trailer to the commit message (blank line before it):" >&2
        echo "" >&2
        echo "  $DISCLOSURE" >&2
        echo "" >&2
        echo "e.g. git commit -m \"Subject\" -m \"Body explaining why\" -m \"$DISCLOSURE\"" >&2
        exit 2
        ;;
    esac
    ;;
esac

exit 0
