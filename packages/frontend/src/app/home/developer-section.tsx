import type { ReactNode } from "react";

const API = "/api/v1/workspaces/:wid/documents/:did";

const restApiCode = `# Read cells (with optional range)
curl ${API}/\\
  tabs/:tid/cells?range=A1:C10 \\
  -H "Authorization: Bearer wfb_..."

# Write a cell
curl -X PUT ${API}/\\
  tabs/:tid/cells/B2 \\
  -d '{"value": "Hello"}'

# Set a formula
curl -X PUT ${API}/\\
  tabs/:tid/cells/C1 \\
  -d '{"formula": "=SUM(A1:B1)"}'`;

const cliCode = `# List documents
$ wafflebase document list
[
  {"id": "abc-123",
   "title": "Q1 Report"}
]

# Read cells (range or single)
$ wafflebase cell get abc-123 A1:C10
$ wafflebase cell get abc-123 A1

# Write a cell value
$ wafflebase cell set abc-123 A1 "Revenue"

# Write a formula
$ wafflebase cell set abc-123 B2 \\
    "=SUM(A1:A10)" --formula`;

type Token = { type: "comment" | "string" | "flag" | "cmd" | "method" | "prompt" | "text"; value: string };

const COMMANDS = new Set(["curl", "wafflebase", "echo"]);
const METHODS = new Set(["GET", "PUT", "PATCH", "DELETE", "POST"]);

function tokenizeLine(line: string): Token[] {
  const trimmed = line.trimStart();

  // Comment lines
  if (trimmed.startsWith("#")) {
    return [{ type: "comment", value: line }];
  }

  const tokens: Token[] = [];
  let i = 0;

  // Prompt ($)
  if (trimmed.startsWith("$")) {
    const indent = line.length - trimmed.length;
    if (indent > 0) tokens.push({ type: "text", value: line.slice(0, indent) });
    tokens.push({ type: "prompt", value: "$ " });
    i = indent + 2;
  }

  let buf = "";
  while (i < line.length) {
    const ch = line[i];

    // Strings
    if (ch === '"' || ch === "'") {
      if (buf) { pushWord(buf, tokens); buf = ""; }
      const quote = ch;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\" && j + 1 < line.length) j++;
        j++;
      }
      tokens.push({ type: "string", value: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Whitespace boundary
    if (ch === " " || ch === "\t") {
      if (buf) { pushWord(buf, tokens); buf = ""; }
      tokens.push({ type: "text", value: ch });
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  if (buf) pushWord(buf, tokens);

  return tokens;
}

function pushWord(word: string, tokens: Token[]) {
  if (word.startsWith("--") || /^-[a-zA-Z]$/.test(word)) {
    tokens.push({ type: "flag", value: word });
  } else if (COMMANDS.has(word)) {
    tokens.push({ type: "cmd", value: word });
  } else if (METHODS.has(word)) {
    tokens.push({ type: "method", value: word });
  } else {
    tokens.push({ type: "text", value: word });
  }
}

const TOKEN_CLASSES: Record<Token["type"], string> = {
  comment: "text-homepage-dark-muted italic",
  string: "text-green-400",
  flag: "text-sky-400",
  cmd: "text-homepage-dark-heading font-semibold",
  method: "text-violet-400 font-semibold",
  prompt: "text-homepage-dark-muted",
  text: "text-homepage-dark-text",
};

function highlightCode(code: string): ReactNode[] {
  return code.split("\n").map((line, li) => {
    const tokens = tokenizeLine(line);
    return (
      <span key={li}>
        {li > 0 && "\n"}
        {tokens.map((t, ti) => (
          <span key={ti} className={TOKEN_CLASSES[t.type]}>
            {t.value}
          </span>
        ))}
      </span>
    );
  });
}

export function DeveloperSection() {
  return (
    <section id="developers" className="bg-homepage-dark-bg py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-dark-heading mb-2">
        Built for Developers
      </h2>
      <p className="text-center text-base text-homepage-dark-subtext mb-12">
        Automate your spreadsheets with REST API and CLI
      </p>
      <div className="max-w-[960px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-homepage-dark-card rounded-xl p-6 overflow-x-auto hover:ring-1 hover:ring-homepage-dark-muted/30 transition-shadow">
          <div className="text-xs text-homepage-dark-muted font-semibold uppercase tracking-wider mb-3">
            REST API
          </div>
          <pre className="text-sm font-mono leading-7 whitespace-pre">
            {highlightCode(restApiCode)}
          </pre>
          <a href="/docs/api/rest-api" className="inline-block mt-4 text-sm text-homepage-dark-link hover:text-homepage-dark-heading no-underline">
            View full API documentation →
          </a>
        </div>
        <div className="bg-homepage-dark-card rounded-xl p-6 overflow-x-auto hover:ring-1 hover:ring-homepage-dark-muted/30 transition-shadow">
          <div className="text-xs text-homepage-dark-muted font-semibold uppercase tracking-wider mb-3">
            CLI
          </div>
          <pre className="text-sm font-mono leading-7 whitespace-pre">
            {highlightCode(cliCode)}
          </pre>
          <a href="/docs/api/cli" className="inline-block mt-4 text-sm text-homepage-dark-link hover:text-homepage-dark-heading no-underline">
            View CLI documentation →
          </a>
        </div>
      </div>
    </section>
  );
}
