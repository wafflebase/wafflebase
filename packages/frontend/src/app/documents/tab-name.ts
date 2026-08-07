// Tab-name helpers now live in `@wafflebase/sheets` so the backend REST layer
// (tab create/rename) can share the exact same naming/uniqueness rules. This
// file is kept as a thin re-export to preserve existing frontend import sites.
export {
  normalizeTabName,
  isTabNameTaken,
  getUniqueTabName,
  getNextDefaultSheetName,
  buildTabNameNormalizationPatches,
  generateTabId,
  type TabNamePatch,
} from "@wafflebase/sheets";
