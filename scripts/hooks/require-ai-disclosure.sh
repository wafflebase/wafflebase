#!/bin/sh
# Claude Code hook: PreToolUse(Bash)
# Enforces an AI-disclosure trailer on commits made during an AUTONOMOUS agent
# run, so provenance is mechanical rather than prose. Gated on the
# WAFFLEBASE_AGENT_AUTONOMOUS env var that the agent workflows set — human and
# interactive-agent sessions (var unset) are unaffected, matching the "same
# workflow as a human" contract while adding a disclosure gate on top.
#
# Only inline `-m` / `--message` commits are checked (the trailer must appear on
# the command line). `-F`/`--file`, `--amend --no-edit`, interactive rebases,
# etc. pass through — their message isn't on the command line to inspect, and the
# PR-body disclosure gate in mark-ready.mjs is the authoritative backstop.
#
# Exit 0 = allow, Exit 2 = block (STDERR fed to Claude as context)

# No-op outside autonomous runs.
[ "$WAFFLEBASE_AGENT_AUTONOMOUS" = "true" ] || exit 0

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "
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
    case "$COMMAND" in
      *" -m "*|*" --message"*)
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
