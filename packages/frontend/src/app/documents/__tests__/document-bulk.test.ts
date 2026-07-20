import { describe, it, expect } from "vitest";
import {
  DOC_DRAG_MIME,
  encodeDocDrag,
  decodeDocDrag,
  isDocDrag,
  allManageable,
} from "../document-bulk";

// Minimal DataTransfer stub (jsdom's is incomplete for setData/getData).
function fakeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => (store[k] = v),
    getData: (k: string) => store[k] ?? "",
    get types() {
      return Object.keys(store);
    },
    effectAllowed: "none",
  } as unknown as DataTransfer;
}

describe("doc drag payload", () => {
  it("round-trips ids through the custom MIME type", () => {
    const dt = fakeDataTransfer();
    encodeDocDrag(dt, ["a", "b"]);
    expect(isDocDrag(dt)).toBe(true);
    expect(decodeDocDrag(dt)).toEqual(["a", "b"]);
  });

  it("does NOT claim OS-file drags", () => {
    const dt = fakeDataTransfer();
    (dt as { setData: (k: string, v: string) => void }).setData("Files", "x");
    expect(isDocDrag(dt)).toBe(false);
    expect(decodeDocDrag(dt)).toBeNull();
  });

  it("returns null on malformed payload", () => {
    const dt = fakeDataTransfer();
    (dt as { setData: (k: string, v: string) => void }).setData(
      DOC_DRAG_MIME,
      "not json",
    );
    expect(decodeDocDrag(dt)).toBeNull();
  });
});

describe("allManageable", () => {
  const docs = [
    { id: "a", canManage: true },
    { id: "b", canManage: true },
    { id: "c", canManage: false },
  ];
  it("true only when every selected doc is manageable", () => {
    expect(allManageable(["a", "b"], docs)).toBe(true);
    expect(allManageable(["a", "c"], docs)).toBe(false);
  });
  it("false on empty selection", () => {
    expect(allManageable([], docs)).toBe(false);
  });
});
