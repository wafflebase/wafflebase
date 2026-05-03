import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHead } from "./primitives/section-head";

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

type TokenType =
  | "comment"
  | "string"
  | "flag"
  | "cmd"
  | "method"
  | "prompt"
  | "text";

type Token = { type: TokenType; value: string };

const COMMANDS = new Set(["curl", "wafflebase", "echo"]);
const METHODS = new Set(["GET", "PUT", "PATCH", "DELETE", "POST"]);

function tokenizeLine(line: string): Token[] {
  const trimmed = line.trimStart();

  if (trimmed.startsWith("#")) {
    return [{ type: "comment", value: line }];
  }

  const tokens: Token[] = [];
  let i = 0;

  if (trimmed.startsWith("$")) {
    const indent = line.length - trimmed.length;
    if (indent > 0) tokens.push({ type: "text", value: line.slice(0, indent) });
    tokens.push({ type: "prompt", value: "$ " });
    i = indent + 2;
  }

  let buf = "";
  while (i < line.length) {
    const ch = line[i];

    if (ch === '"' || ch === "'") {
      if (buf) {
        pushWord(buf, tokens);
        buf = "";
      }
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

    if (ch === " " || ch === "\t") {
      if (buf) {
        pushWord(buf, tokens);
        buf = "";
      }
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

const TOKEN_CLASSES: Record<TokenType, string> = {
  comment:
    "italic text-[color:color-mix(in_srgb,var(--wb-terminal-fg)_38%,transparent)]",
  string: "text-[color:var(--wb-butter)]",
  flag: "text-[color:var(--wb-leaf)]",
  cmd: "text-[color:var(--wb-berry)] font-semibold",
  method: "text-[color:var(--wb-berry)] font-semibold",
  prompt:
    "text-[color:color-mix(in_srgb,var(--wb-terminal-fg)_55%,transparent)]",
  text: "text-[color:color-mix(in_srgb,var(--wb-terminal-fg)_90%,transparent)]",
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

type TabKey = "rest" | "cli";

const TABS: {
  key: TabKey;
  label: string;
  file: string;
  href: string;
  hrefLabel: string;
  code: string;
}[] = [
  {
    key: "rest",
    label: "REST API",
    file: "rest-api.sh",
    href: "/docs/developers/rest-api",
    hrefLabel: "View full API documentation →",
    code: restApiCode,
  },
  {
    key: "cli",
    label: "CLI",
    file: "wafflebase.sh",
    href: "/docs/developers/cli",
    hrefLabel: "View CLI documentation →",
    code: cliCode,
  },
];

export function DeveloperSection() {
  const [tab, setTab] = useState<TabKey>("rest");
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <section
      id="developers"
      className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8"
    >
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          kicker="Developers"
          title="Built for Developers"
          sub="Automate your workflow with REST API and CLI."
        />

        <div
          className="max-w-[880px] mx-auto rounded-2xl overflow-hidden bg-[color:var(--wb-terminal-bg)]"
          style={{
            boxShadow:
              "0 30px 60px -30px color-mix(in srgb, var(--wb-syrup-deep) 30%, transparent)",
          }}
        >
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Developer integration examples"
            className="flex items-center px-2 border-b"
            style={{
              background:
                "color-mix(in srgb, var(--wb-terminal-bg) 90%, var(--wb-syrup-deep))",
              borderBottomColor:
                "color-mix(in srgb, var(--wb-terminal-fg) 10%, transparent)",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`dev-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`dev-panel-${t.key}`}
                tabIndex={tab === t.key ? 0 : -1}
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-3.5 -mb-px font-code text-[13px] border-b-2 cursor-pointer transition-colors",
                  tab === t.key
                    ? "text-[color:var(--wb-butter)] border-[color:var(--wb-butter)]"
                    : "text-[color:color-mix(in_srgb,var(--wb-terminal-fg)_55%,transparent)] border-transparent hover:text-[color:var(--wb-terminal-fg)]",
                )}
              >
                {t.label}
                <span
                  className="hidden sm:inline-block font-code text-[11px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background:
                      "color-mix(in srgb, var(--wb-terminal-fg) 8%, transparent)",
                    color:
                      "color-mix(in srgb, var(--wb-terminal-fg) 50%, transparent)",
                  }}
                >
                  {t.file}
                </span>
              </button>
            ))}
            <span className="flex-1" />
          </div>

          {/* Code body */}
          <pre
            role="tabpanel"
            id={`dev-panel-${active.key}`}
            aria-labelledby={`dev-tab-${active.key}`}
            className="m-0 px-6 md:px-8 py-7 overflow-x-auto font-code text-[14px] leading-7 whitespace-pre"
          >
            {highlightCode(active.code)}
          </pre>

          {/* Footer link */}
          <div
            className="px-6 md:px-8 py-4 border-t"
            style={{
              borderTopColor:
                "color-mix(in srgb, var(--wb-terminal-fg) 10%, transparent)",
            }}
          >
            <a
              href={active.href}
              className="font-body text-[14px] no-underline transition-colors text-[color:color-mix(in_srgb,var(--wb-terminal-fg)_70%,transparent)] hover:text-[color:var(--wb-butter)]"
            >
              {active.hrefLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
