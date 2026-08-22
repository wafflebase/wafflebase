/**
 * seed-notes.ts — CP4.3's fixture content for the `notes-editor` canvas scene.
 *
 * `initialNotesRoot()` (called by `notes-detail.tsx` itself, unmodified)
 * produces `{ content: new Text() }` — a genuinely empty Yorkie `Text` CRDT,
 * the simplest of the four root shapes (notes is "one Yorkie `Text` at
 * `root.content`", per `docs/design/notes/notes.md`). `Text.edit(from, to,
 * content)` is the CRDT's own insertion API — the same one the CodeMirror
 * binding calls on every keystroke — so seeding through it rather than
 * constructing a replacement object is the natural fit here (unlike docs'
 * Tree, there is no nested schema to get wrong).
 *
 * Exported as a plain function and imported DIRECTLY by `yorkie-offline.tsx`
 * — see that file's `CANVAS_SEEDS` comment for why the dependency runs that
 * direction and not the other way.
 */
import type { Document } from "@yorkie-js/sdk";

const MARKDOWN = [
  "# Scratchpad",
  "",
  "- Follow up with the design team on the sidebar icon set",
  "- Double-check the empty-state copy on the datasources page",
  "- Draft notes for next week's onboarding review",
].join("\n");

/** Registered under docKey `note-fixture` in `yorkie-offline.tsx#CANVAS_SEEDS`. */
export function seedNotesFixture(doc: Document<never, never>): void {
  doc.update((root) => {
    (
      root as unknown as { content: { edit: (from: number, to: number, value: string) => void } }
    ).content.edit(0, 0, MARKDOWN);
  });
}
