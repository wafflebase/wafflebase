import { describe, it, expect } from "vitest";
import { folderPath } from "@/app/documents/folder-path";
import type { Folder } from "@/types/documents";

function makeFolder(id: string, name: string, parentId: string | null): Folder {
  return { id, name, parentId, authorID: null, createdAt: "2026-01-01T00:00:00Z" };
}

describe("folderPath", () => {
  const root = makeFolder("root", "Root", null);
  const child = makeFolder("child", "Child", "root");
  const folders = [root, child];

  it("returns an empty chain at the workspace root", () => {
    expect(folderPath(folders, null)).toEqual([]);
  });

  it("returns a 2-level chain from root down to the target folder", () => {
    expect(folderPath(folders, "child")).toEqual([root, child]);
  });

  it("returns an empty chain for an unknown folder id", () => {
    expect(folderPath(folders, "missing")).toEqual([]);
  });

  it("terminates on a cyclic parent chain", () => {
    // a -> b -> a (corrupt data); folderPath must not infinite-loop
    const cyclicFolders = [
      makeFolder("a", "A", "b"),
      makeFolder("b", "B", "a"),
    ];
    const path = folderPath(cyclicFolders, "a");
    expect(path.length).toBeLessThanOrEqual(2);
  });
});
