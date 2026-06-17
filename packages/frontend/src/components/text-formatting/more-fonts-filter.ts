/**
 * Pure filtering for the "More fonts…" dialog — kept out of the React
 * component so the search / category / script logic is unit-testable
 * without a DOM. The dialog renders `filterFonts(...)`'s result.
 */
import type { FontEntry, FontGroup } from "./font-catalog";

/** Script axis the dialog can narrow by. "All" disables the filter. */
export type FontScriptFilter = "All" | "Korean" | "Latin";

/** Category axis: "All" or one of the picker groups. */
export type FontCategoryFilter = "All" | FontGroup;

export interface FontFilterOptions {
  /** Free-text query matched (case-insensitively) against family + label. */
  query: string;
  category: FontCategoryFilter;
  script: FontScriptFilter;
}

function matchesScript(entry: FontEntry, script: FontScriptFilter): boolean {
  if (script === "All") return true;
  if (script === "Korean") {
    // Web fonts carry explicit subsets; system Korean faces (맑은 고딕,
    // 바탕) have none, so fall back to the group classification.
    return entry.scripts?.includes("korean") ?? entry.group === "Korean";
  }
  // Latin: web fonts list it explicitly; system faces have no subsets and
  // are Latin-capable, so treat a missing subset list as Latin.
  return entry.scripts ? entry.scripts.includes("latin") : true;
}

/**
 * Filter `catalog` by category, script, and a free-text query. Order is
 * preserved from the input catalog (already grouped/curated), so the
 * dialog shows families in their authored order.
 */
export function filterFonts(
  catalog: readonly FontEntry[],
  { query, category, script }: FontFilterOptions,
): FontEntry[] {
  const q = query.trim().toLowerCase();
  return catalog.filter((entry) => {
    if (category !== "All" && entry.group !== category) return false;
    if (!matchesScript(entry, script)) return false;
    if (
      q &&
      !entry.family.toLowerCase().includes(q) &&
      !entry.label.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}
