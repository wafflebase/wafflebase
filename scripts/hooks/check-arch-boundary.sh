#!/bin/sh
# Claude Code hook: PostToolUse(Write)
# After a new file is created in frontend/ or backend/,
# runs the relevant architecture lint to detect boundary violations.
#
# Blocking — exits 2 on violation so the agent is forced to fix it.
# The file is already on disk, but exit 2 signals an error to Claude Code,
# prompting the agent to correct the violation before proceeding.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}
    catch{console.log('')}
  });
")

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REL_PATH="${FILE_PATH#"$REPO_ROOT"/}"

case "$REL_PATH" in
  packages/frontend/src/*)
    RESULT=$(cd "$REPO_ROOT" && pnpm frontend lint:arch 2>&1) || {
      echo "[check-arch-boundary] Architecture violation detected in frontend:" >&2
      echo "$RESULT" >&2
      echo "" >&2
      echo "Frontend layer rules: types/lib → api → hooks → components/ui → app" >&2
      echo "See: packages/frontend/eslint.arch.config.js" >&2
      echo "Fix the violation before proceeding." >&2
      exit 2
    }
    ;;
  packages/backend/src/*)
    RESULT=$(cd "$REPO_ROOT" && pnpm backend lint:arch 2>&1) || {
      echo "[check-arch-boundary] Architecture violation detected in backend:" >&2
      echo "$RESULT" >&2
      echo "" >&2
      echo "Backend layer rules: database → auth/user/document → controllers" >&2
      echo "See: packages/backend/eslint.arch.config.mjs" >&2
      echo "Fix the violation before proceeding." >&2
      exit 2
    }
    ;;
esac

exit 0
