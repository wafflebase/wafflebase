import {
  FileInput,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
} from "lucide-react";
import type { ComponentType } from "react";
import { SectionHead } from "./primitives/section-head";

type Format = {
  Icon: ComponentType<{ className?: string }>;
  format: string;
  target?: string;
};

const IMPORTS: Format[] = [
  { Icon: FileSpreadsheet, format: "XLSX", target: "Sheets" },
  { Icon: FileText, format: "DOCX", target: "Docs" },
  { Icon: Presentation, format: "PPTX", target: "Slides" },
];

const EXPORTS: Format[] = [
  { Icon: FileText, format: "DOCX" },
  { Icon: Presentation, format: "PPTX" },
  { Icon: FileType, format: "PDF" },
];

const CARD_SHADOW =
  "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)";

export function InteropSection() {
  return (
    <section className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8">
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          kicker="No lock-in"
          title="Bring your files — and take them with you."
          sub="Import what you already have and export what you make. Wafflebase speaks the formats your team already uses, so your data is never trapped."
        />

        <div className="max-w-[760px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          <InteropCard
            Glyph={FileInput}
            title="Import"
            caption="Open existing files directly"
            formats={IMPORTS}
          />
          <InteropCard
            Glyph={FileOutput}
            title="Export"
            caption="Download in standard formats"
            formats={EXPORTS}
          />
        </div>
      </div>
    </section>
  );
}

type InteropCardProps = {
  Glyph: ComponentType<{ className?: string }>;
  title: string;
  caption: string;
  formats: Format[];
};

function InteropCard({ Glyph, title, caption, formats }: InteropCardProps) {
  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] p-6 md:p-7"
      style={{ boxShadow: CARD_SHADOW }}
    >
      <div className="flex items-center gap-3">
        <div
          className="inline-flex items-center justify-center size-9 rounded-lg"
          style={{
            background: "color-mix(in srgb, var(--wb-butter) 35%, transparent)",
            border: "1px solid color-mix(in srgb, var(--wb-syrup) 25%, transparent)",
          }}
        >
          <Glyph className="size-[18px] text-[color:var(--wb-syrup-deep)]" />
        </div>
        <div>
          <h3 className="font-body font-semibold text-[16px] text-[color:var(--wb-ink)] m-0">
            {title}
          </h3>
          <p className="font-body text-[12.5px] text-[color:var(--wb-sub)] m-0">
            {caption}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {formats.map(({ Icon, format, target }) => (
          <li
            key={format}
            className="flex items-center gap-2.5 rounded-lg border border-[color:var(--wb-rule)] px-3 py-2"
            style={{
              background: "color-mix(in srgb, var(--wb-rule) 14%, var(--wb-paper))",
            }}
          >
            <Icon className="size-4 shrink-0 text-[color:var(--wb-syrup-deep)]" />
            <span className="font-code text-[13px] font-medium text-[color:var(--wb-ink)]">
              {format}
            </span>
            {target ? (
              <>
                <span className="font-code text-[12px] text-[color:var(--wb-sub)]">
                  →
                </span>
                <span className="font-body text-[13px] text-[color:var(--wb-sub)]">
                  {target}
                </span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
