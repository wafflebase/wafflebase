import { describe, it, expect } from "vitest";
import yorkie from "@yorkie-js/sdk";
import { createWorksheet } from "@wafflebase/sheets";
import { YorkieStore } from "./yorkie-store";
import type { SpreadsheetDocument } from "@/types/worksheet";
import type { UserPresence } from "@/types/users";

const Tab = "tab-1-aaa";

function createDoc() {
  const doc = new yorkie.Document<SpreadsheetDocument, UserPresence>(
    "sheet-snapshot-test",
  );
  doc.update((root) => {
    root.tabs = { [Tab]: { id: Tab, name: "Sheet1", type: "sheet" } };
    root.tabOrder = [Tab];
    root.sheets = { [Tab]: createWorksheet() };
  });
  return doc;
}

/**
 * Fire a synthetic SDK document event. With no server, drive the store's
 * subscription through Yorkie's public `Document.publish`; the store only
 * reads `event.type`.
 */
function emit(
  doc: ReturnType<typeof createDoc>,
  type: "remote-change" | "snapshot",
) {
  (doc as unknown as { publish(events: unknown[]): void }).publish([{ type }]);
}

describe("YorkieStore cell index", () => {
  // A whole-document `snapshot` (a client catching up past the server's
  // snapshot threshold, or a revision restore landing that way) replaces the
  // root without a `remote-change`. The index must be dropped for it too, or
  // every later range read answers from the pre-snapshot cells.
  it.each(["remote-change", "snapshot"] as const)(
    "is rebuilt after a %s event",
    async (type) => {
      const doc = createDoc();
      const store = new YorkieStore(doc, Tab);
      expect(await store.getUsedBounds()).toBeUndefined();

      // Another writer changes the root without going through `store`.
      await new YorkieStore(doc, Tab).set({ r: 3, c: 2 }, { v: "x" });
      emit(doc, type);

      expect(await store.getUsedBounds()).toEqual([
        { r: 3, c: 2 },
        { r: 3, c: 2 },
      ]);
    },
  );
});
