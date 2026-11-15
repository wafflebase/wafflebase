/**
 * The tab a spreadsheet editor should show: `current` while it still exists,
 * otherwise the first tab in `tabOrder` that has tab metadata, otherwise
 * `null`.
 *
 * The selected tab can disappear under the editor — a peer deletes it, or a
 * revision restore (the homepage demo's daily reset among them) replaces the
 * root without it — and an id that no longer resolves leaves the store
 * reading a worksheet that is not there.
 */
export function resolveActiveTabId(
  tabOrder: readonly string[] | undefined,
  tabs: Readonly<Record<string, unknown>> | undefined,
  current: string | null,
): string | null {
  if (current && tabs?.[current]) return current;
  return (tabOrder ?? []).find((id) => tabs?.[id]) ?? null;
}
