import type { CSSProperties } from "react";
import { WaffleLogo } from "./waffle-logo";

type Pkg = { name: string; role: string };
type Group = { label: string; engine: boolean; packages: Pkg[] };

// The open-source panel's infographic: what is in the one public repository,
// drawn as a ruled file tree. Every row is a real `packages/*` directory, so
// keep this in step with the monorepo rather than with marketing copy.
const GROUPS: Group[] = [
  {
    label: "Editors",
    engine: true,
    packages: [
      { name: "sheets", role: "Spreadsheet engine" },
      { name: "docs", role: "Word processor" },
      { name: "slides", role: "Presentations" },
      { name: "notes", role: "Markdown notes" },
      { name: "board", role: "Infinite canvas" },
    ],
  },
  {
    label: "Server and app",
    engine: false,
    packages: [
      { name: "backend", role: "NestJS API" },
      { name: "frontend", role: "React web app" },
    ],
  },
  {
    label: "Tools",
    engine: false,
    packages: [
      { name: "cli", role: "Terminal and agents" },
      { name: "core", role: "Shared tokens" },
    ],
  },
];

// One pocket of the Facet mark: filled for an editor engine, outlined for
// everything that serves them.
function Pocket({ filled }: { filled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative z-10 size-[7px] shrink-0 rotate-45 rounded-[1.5px] border-[1.5px] border-[color:var(--wb-syrup)]"
      style={{
        background: filled ? "var(--wb-syrup)" : "var(--wb-paper)",
      }}
    />
  );
}

export function RepoMap() {
  return (
    <figure className="m-0 w-full max-w-[360px]">
      <div className="flex items-center gap-2.5 pb-3">
        <WaffleLogo size={22} />
        <span className="font-code text-[13px] text-[color:var(--wb-ink)]">
          wafflebase/wafflebase
        </span>
      </div>
      <ul className="m-0 list-none p-0 pl-[10px]" aria-label="Packages in the repository">
        {GROUPS.map((group, gi) => (
          <li
            key={group.label}
            className="relative pl-5"
            style={
              {
                // The trunk stops at the last group's label, not the page.
                "--trunk": gi === GROUPS.length - 1 ? "14px" : "100%",
              } as CSSProperties
            }
          >
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 w-px bg-[color:var(--wb-rule)]"
              style={{ height: "var(--trunk)" }}
            />
            <span
              aria-hidden="true"
              className="absolute left-0 top-[14px] h-px w-3.5 bg-[color:var(--wb-rule)]"
            />
            <div className="pt-1.5 pb-1 text-[12.5px] font-medium text-[color:var(--wb-sub)]">
              {group.label}
            </div>
            <ul className="m-0 list-none p-0 pb-2">
              {group.packages.map((pkg) => (
                <li
                  key={pkg.name}
                  className="flex items-center gap-3 py-[5px]"
                >
                  <Pocket filled={group.engine} />
                  <span className="font-code w-[68px] shrink-0 text-[13px] text-[color:var(--wb-ink)]">
                    {pkg.name}
                  </span>
                  <span className="truncate text-[13px] text-[color:var(--wb-sub)]">
                    {pkg.role}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">
        The repository holds five editor engines, the backend and web app, the
        CLI, and a shared core package.
      </figcaption>
    </figure>
  );
}
