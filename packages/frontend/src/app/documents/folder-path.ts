import type { Folder } from "@/types/documents";

/** Returns the folder chain from root down to `folderId` (inclusive). Empty at root. */
export function folderPath(
  folders: Folder[],
  folderId: string | null,
): Folder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const f = byId.get(cursor)!;
    chain.unshift(f);
    cursor = f.parentId;
  }
  return chain;
}
