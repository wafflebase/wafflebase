/**
 * The one content check publishing performs (docs/design/template-gallery.md).
 *
 * A `datasource` / `lakehouse` tab carries only a *reference* to a connection
 * row — `TabMeta.datasourceId` / `lakehouseSourceId` — and those rows are
 * workspace-scoped. Using a template copies the document into the *user's*
 * workspace, where the reference resolves to nothing and the tab is inert.
 *
 * This is not an access bypass: every datasource route re-derives
 * authorization from the row's own `workspaceId`, so the copy cannot read the
 * publisher's connection. It is a promise the template cannot keep, which is
 * why the honest answer is to refuse to publish it rather than to hand out a
 * document with a dead tab in it.
 *
 * Within a workspace the reference stayed valid, which is why "Make a copy"
 * has never needed this and only the template path does.
 */

/** The tab shape this guard reads. A subset of `TabMeta`. */
interface TabLike {
  name?: unknown;
  type?: unknown;
}

const EXTERNAL_TAB_TYPES = new Set(['datasource', 'lakehouse']);

/**
 * Names of the tabs that would land inert in another workspace, in the
 * document's own tab order.
 *
 * Reads `tabOrder` when it is present so the message lists tabs the way the
 * editor does, and falls back to the map's own keys so a document whose
 * `tabOrder` is missing or stale cannot hide a tab from the check. A tab with
 * no `name` is reported by its id, which is still enough to find it.
 */
export function findExternalDataTabs(
  tabs: unknown,
  tabOrder?: unknown,
): string[] {
  if (!isRecord(tabs)) return [];
  const ordered = Array.isArray(tabOrder)
    ? tabOrder.filter((id): id is string => typeof id === 'string')
    : [];
  const ids = [...ordered, ...Object.keys(tabs)];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const tab = tabs[id];
    if (!isRecord(tab)) continue;
    const { type, name } = tab as TabLike;
    if (typeof type !== 'string' || !EXTERNAL_TAB_TYPES.has(type)) continue;
    names.push(typeof name === 'string' && name.length > 0 ? name : id);
  }
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
