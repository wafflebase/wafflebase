import type { ComponentType } from "react";
import {
  File as FileIcon,
  FileText,
  Frame,
  Image as ImageIcon,
  NotebookPen,
  Presentation,
  Sheet,
} from "lucide-react";
import { IconFileTypePdf } from "@tabler/icons-react";
import type { DocumentType } from "@/types/documents";

/**
 * Single source of truth for each document type's label, icon, and color.
 * The documents list (title cell, filter menu, create menu) and the template
 * gallery's cards all derive from this, so a new type needs one edit, not
 * several.
 *
 * Its own module rather than `document-list-utils.ts`: that file is documented
 * as pure, DOM-free search/sort helpers so it can be unit-tested without a
 * renderer, and icon components would break that promise.
 */
export const TYPE_META: Record<
  DocumentType,
  { label: string; Icon: ComponentType<{ className?: string }>; color: string }
> = {
  sheet: { label: "Sheets", Icon: Sheet, color: "text-green-600" },
  doc: { label: "Docs", Icon: FileText, color: "text-blue-500" },
  note: { label: "Notes", Icon: NotebookPen, color: "text-purple-500" },
  slides: { label: "Slides", Icon: Presentation, color: "text-orange-500" },
  pdf: { label: "PDFs", Icon: IconFileTypePdf, color: "text-red-500" },
  image: { label: "Images", Icon: ImageIcon, color: "text-pink-500" },
  board: { label: "Boards", Icon: Frame, color: "text-fuchsia-600" },
  file: { label: "Files", Icon: FileIcon, color: "text-slate-500" },
};

/** Document types offered in the filter menus, in display order. */
export const TYPE_OPTIONS: ReadonlyArray<DocumentType> = [
  "sheet",
  "doc",
  "note",
  "slides",
  "pdf",
  "image",
  "board",
  "file",
];

/**
 * `TYPE_META` for a type string that came off the wire. A listing stores its
 * document's type as a plain string, so a build that has not learned a newer
 * type must render *something* rather than crash on an undefined lookup.
 *
 * The own-property check is the load-bearing part, and it is the same trap
 * `login-form.tsx` documents for its `?error=` lookup: an object literal
 * answers for its prototype too, so `type: "toString"` or `"constructor"`
 * would return an inherited *function*, `??` would not fire, and destructuring
 * `Icon` off it yields `undefined` — which React throws on when rendered as a
 * component. The value is a plain string from a database column, so the
 * defence belongs here rather than in a claim about what can be stored.
 */
export function typeMeta(type: string) {
  return Object.prototype.hasOwnProperty.call(TYPE_META, type)
    ? TYPE_META[type as DocumentType]
    : TYPE_META.file;
}
