import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemSlidesStore } from "@wafflebase/slides";
import { describe, expect, it } from "vitest";

import { asBoardStore, BOARD_UNSUPPORTED } from "./mem-board-store";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YORKIE_BOARD_STORE = path.resolve(HERE, "..", "..", "board", "yorkie-board-store.ts");

/** Method names that call `notSupported()` in the real board store. */
function refusedByTheRealStore(): string[] {
  const src = readFileSync(YORKIE_BOARD_STORE, "utf8");
  const names = new Set<string>();
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("notSupported(")) continue;
    // Walk back to the nearest method signature. The refusing methods are one- or two-liners,
    // so this stays local; anything further away would not be a refusal body.
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const m = lines[j].match(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\s*[(<]/);
      if (m && m[1] !== "notSupported") {
        names.add(m[1]);
        break;
      }
    }
  }
  return [...names].sort();
}

describe("the in-memory board store", () => {
  it("refuses exactly what the real board store refuses", () => {
    // THE POINT OF THIS FILE. `MemSlidesStore` performs all of these happily, and a harness
    // laxer than production hides a constraint rather than exposing it: the explorer would
    // add slides and apply themes to a "board", watch them succeed, and conclude the surface
    // is fine. Re-derived from `yorkie-board-store.ts` so the two cannot drift.
    const real = refusedByTheRealStore();
    expect(real.length, "parsed no refusals out of yorkie-board-store.ts — the pattern has gone stale").toBeGreaterThan(20);
    expect([...BOARD_UNSUPPORTED].sort()).toEqual(real);
  });

  it("throws for a refused method, with the real store's wording", () => {
    const store = asBoardStore(new MemSlidesStore());
    expect(() => store.addSlide("blank")).toThrow(/"addSlide" is not supported on a board/);
    expect(() => store.addTheme({} as never)).toThrow(/not supported on a board/);
  });

  it("passes supported methods straight through", () => {
    // The ~40 supported methods are NOT enumerated anywhere, so this is what catches a proxy
    // that over-refuses. `read` and the element/batch path are the ones the readers depend on.
    const store = asBoardStore(new MemSlidesStore());
    expect(store.read().slides).toEqual([]);
    expect(typeof store.batch).toBe("function");
    expect(store.canUndo()).toBe(false);
  });

  it("binds delegated methods to the inner store, not the proxy", () => {
    // TESTS WHAT THE BINDING ACTUALLY GUARANTEES: `this` inside a delegated call is the inner
    // store. Exercising it through `MemSlidesStore` cannot show this — none of its supported
    // methods internally calls a refused one, so an unbound delegate behaves identically and
    // the mutation survives. A stand-in that reports its own `this` shows it directly.
    const spy = {
      seen: null as unknown,
      ping(this: unknown) {
        (spy as { seen: unknown }).seen = this;
      },
    };
    const wrapped = asBoardStore(spy as never) as unknown as typeof spy;
    wrapped.ping();
    expect(spy.seen, "an unbound delegate would see the proxy, and any internal call would re-enter the trap").toBe(spy);
  });
});
