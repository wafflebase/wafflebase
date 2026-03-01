#!/bin/sh
# Claude Code hook: PostToolUse(Bash)
# Reminds agents of the post-task checklist when they run git commit.
# Informational only — exits 0 regardless.
#
# STDOUT is injected into the agent's context after the command runs.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.command||'')}
    catch{console.log('')}
  });
")

case "$COMMAND" in
  *"git commit"*)
    echo "[post-task-checklist] Verify before finalizing:" >&2
    echo "  1. design/ docs updated if architecture changed" >&2
    echo "  2. tasks/active/ todo+lessons files created (non-trivial tasks)" >&2
    echo "  3. pnpm verify:fast passed" >&2
    echo "  4. pnpm tasks:archive && pnpm tasks:index (if task completed)" >&2
    ;;
esac

exit 0
