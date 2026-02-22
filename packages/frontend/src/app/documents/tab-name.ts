import type { TabMeta } from "../../types/worksheet";

const SHEET_NAME_PREFIX = "Sheet";
const DATASOURCE_NAME_PREFIX = "DataSource";

export type TabNamePatch = {
  tabId: string;
  name: string;
};

/**
 * Trims surrounding whitespace from a tab name.
 */
export function normalizeTabName(name: string): string {
  return name.trim();
}

function tabNameKey(name: string): string {
  return normalizeTabName(name).toUpperCase();
}

/**
 * Returns true when a normalized tab name already exists.
 */
export function isTabNameTaken(
  tabs: Record<string, TabMeta>,
  name: string,
  excludeTabId?: string,
): boolean {
  const key = tabNameKey(name);
  if (!key) return false;

  for (const [tabId, tab] of Object.entries(tabs)) {
    if (excludeTabId && tabId === excludeTabId) continue;
    if (tabNameKey(tab.name) === key) {
      return true;
    }
  }
  return false;
}

/**
 * Returns a unique tab name, adding a numeric suffix when needed.
 */
export function getUniqueTabName(
  tabs: Record<string, TabMeta>,
  preferredName: string,
  fallbackName: string,
  excludeTabId?: string,
): string {
  const baseName = normalizeTabName(preferredName) || fallbackName;
  if (!isTabNameTaken(tabs, baseName, excludeTabId)) {
    return baseName;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${baseName} (${suffix})`;
    if (!isTabNameTaken(tabs, candidate, excludeTabId)) {
      return candidate;
    }
    suffix += 1;
  }
}

/**
 * Returns the next available default sheet name (Sheet1, Sheet2, ...).
 */
export function getNextDefaultSheetName(tabs: Record<string, TabMeta>): string {
  let index = 1;
  while (isTabNameTaken(tabs, `${SHEET_NAME_PREFIX}${index}`)) {
    index += 1;
  }
  return `${SHEET_NAME_PREFIX}${index}`;
}

/**
 * Builds rename patches to normalize duplicate or blank tab names.
 */
export function buildTabNameNormalizationPatches(
  tabOrder: string[],
  tabs: Record<string, TabMeta>,
): TabNamePatch[] {
  const orderedTabIds: string[] = [];
  const seenTabIds = new Set<string>();

  for (const tabId of tabOrder) {
    if (!tabs[tabId] || seenTabIds.has(tabId)) continue;
    orderedTabIds.push(tabId);
    seenTabIds.add(tabId);
  }

  for (const tabId of Object.keys(tabs).sort()) {
    if (seenTabIds.has(tabId)) continue;
    orderedTabIds.push(tabId);
  }

  const patches: TabNamePatch[] = [];
  const seenNames = new Set<string>();

  for (const tabId of orderedTabIds) {
    const tab = tabs[tabId];
    if (!tab) continue;

    const fallbackName =
      tab.type === "datasource" ? DATASOURCE_NAME_PREFIX : SHEET_NAME_PREFIX;
    const baseName = normalizeTabName(tab.name) || fallbackName;

    let candidate = baseName;
    if (seenNames.has(tabNameKey(candidate))) {
      let suffix = 2;
      while (true) {
        const maybe = `${baseName} (${suffix})`;
        if (!seenNames.has(tabNameKey(maybe))) {
          candidate = maybe;
          break;
        }
        suffix += 1;
      }
    }

    seenNames.add(tabNameKey(candidate));
    if (candidate !== tab.name) {
      patches.push({ tabId, name: candidate });
    }
  }

  return patches;
}
