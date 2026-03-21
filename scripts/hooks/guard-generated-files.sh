#!/bin/sh
# Claude Code hook: PreToolUse(Edit|Write)
# Blocks direct editing of ANTLR-generated files.
# Formula.g4 is allowed (it's the grammar source).
#
# Exit 0 = allow, Exit 2 = block (STDERR fed to Claude as context)

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}
    catch{console.log('')}
  });
")

# Normalize to relative path from repo root
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REL_PATH="${FILE_PATH#"$REPO_ROOT"/}"

# Check if file is under packages/sheets/antlr/ but NOT a .g4 file
case "$REL_PATH" in
  packages/sheets/antlr/*)
    case "$REL_PATH" in
      *.g4) exit 0 ;;  # Grammar source — editing is allowed
    esac
    echo "BLOCKED: $REL_PATH is an ANTLR-generated file. Do not edit directly." >&2
    echo "" >&2
    echo "To modify the formula grammar:" >&2
    echo "  1. Edit packages/sheets/antlr/Formula.g4" >&2
    echo "  2. Run: pnpm sheets build:formula" >&2
    echo "  3. Commit the regenerated files" >&2
    exit 2
    ;;
esac

exit 0
