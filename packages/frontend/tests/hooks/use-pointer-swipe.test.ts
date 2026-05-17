import test from "node:test";
import assert from "node:assert/strict";
import { attachPointerSwipe } from "../../src/hooks/use-pointer-swipe.ts";

/**
 * `attachPointerSwipe` is the pure-DOM core of the `usePointerSwipe`
 * React hook. We test it directly against a fake element so we can
 * skip JSDOM and React entirely — the frontend test runner is
 * `node:test`, not Vitest, and `.tsx` files are stubbed to no-op by
 * the resolve hook. Mirrors the pattern used by `shape-picker.test.ts`
 * (extract pure logic, test that, leave the JSX/UI for Playwright).
 */

type Handler = (e: unknown) => void;

interface FakeElement {
  addEventListener(type: string, fn: Handler): void;
  removeEventListener(type: string, fn: Handler): void;
  setPointerCapture(): void;
  __handlers: Map<string, Set<Handler>>;
  __fire(type: string, event: PointerLikeEvent): void;
}

interface PointerLikeEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
  cancelable?: boolean;
  preventDefault?: () => void;
}

function makeFakeEl(): FakeElement {
  const handlers = new Map<string, Set<Handler>>();
  return {
    __handlers: handlers,
    addEventListener(type, fn) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type, fn) {
      handlers.get(type)?.delete(fn);
    },
    setPointerCapture() {
      // no-op
    },
    __fire(type, event) {
      const set = handlers.get(type);
      if (!set) return;
      // Coerce to PointerEvent shape; the attach helper only reads a
      // handful of fields, and the cast keeps the test types honest.
      for (const fn of set) fn(event);
    },
  };
}

function ev(
  type: "down" | "move" | "up" | "cancel",
  x: number,
  y: number,
  timeStamp: number,
): PointerLikeEvent {
  const preventDefault = () => {};
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    timeStamp,
    cancelable: true,
    preventDefault,
  };
}

test("attachPointerSwipe — left swipe past threshold fires onSwipeLeft", () => {
  const el = makeFakeEl();
  let left = 0;
  let right = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => left++,
    onSwipeRight: () => right++,
  });

  el.__fire("pointerdown", ev("down", 200, 100, 0));
  el.__fire("pointermove", ev("move", 120, 100, 50)); // dx = -80, locks horizontal
  el.__fire("pointerup", ev("up", 120, 100, 100));

  assert.equal(left, 1);
  assert.equal(right, 0);
  cleanup();
});

test("attachPointerSwipe — right swipe past threshold fires onSwipeRight", () => {
  const el = makeFakeEl();
  let left = 0;
  let right = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => left++,
    onSwipeRight: () => right++,
  });

  el.__fire("pointerdown", ev("down", 100, 100, 0));
  el.__fire("pointermove", ev("move", 200, 100, 50));
  el.__fire("pointerup", ev("up", 200, 100, 100));

  assert.equal(left, 0);
  assert.equal(right, 1);
  cleanup();
});

test("attachPointerSwipe — vertical movement cancels classification", () => {
  const el = makeFakeEl();
  let fired = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => fired++,
    onSwipeRight: () => fired++,
  });

  el.__fire("pointerdown", ev("down", 100, 100, 0));
  el.__fire("pointermove", ev("move", 105, 200, 50)); // |dy|=100 >> |dx|=5
  el.__fire("pointerup", ev("up", 200, 100, 100));    // dx now large but already cancelled

  assert.equal(fired, 0);
  cleanup();
});

test("attachPointerSwipe — horizontal travel below threshold does not fire", () => {
  const el = makeFakeEl();
  let fired = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => fired++,
    onSwipeRight: () => fired++,
  });

  el.__fire("pointerdown", ev("down", 100, 100, 0));
  el.__fire("pointermove", ev("move", 130, 100, 50)); // dx=30 → locks horizontal
  el.__fire("pointerup", ev("up", 130, 100, 100));    // |dx|=30 < default 50px threshold

  assert.equal(fired, 0);
  cleanup();
});

test("attachPointerSwipe — gesture over maxDurationMs is ignored", () => {
  const el = makeFakeEl();
  let left = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => left++,
    onSwipeRight: () => {},
    maxDurationMs: 600,
  });

  el.__fire("pointerdown", ev("down", 200, 100, 0));
  el.__fire("pointermove", ev("move", 120, 100, 100));
  el.__fire("pointerup", ev("up", 120, 100, 1000)); // elapsed 1000 > 600

  assert.equal(left, 0);
  cleanup();
});

test("attachPointerSwipe — pointercancel mid-gesture aborts", () => {
  const el = makeFakeEl();
  let left = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => left++,
    onSwipeRight: () => {},
  });

  el.__fire("pointerdown", ev("down", 200, 100, 0));
  el.__fire("pointermove", ev("move", 120, 100, 50));
  el.__fire("pointercancel", ev("cancel", 120, 100, 60));
  el.__fire("pointerup", ev("up", 120, 100, 100));

  assert.equal(left, 0);
  cleanup();
});

test("attachPointerSwipe — cleanup removes listeners", () => {
  const el = makeFakeEl();
  let fired = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => fired++,
    onSwipeRight: () => fired++,
  });

  cleanup();
  // Both downs and ups should now be no-ops; firing should not throw or
  // invoke the callbacks.
  el.__fire("pointerdown", ev("down", 200, 100, 0));
  el.__fire("pointermove", ev("move", 120, 100, 50));
  el.__fire("pointerup", ev("up", 120, 100, 100));

  assert.equal(fired, 0);
  // Listener sets should be empty after cleanup.
  for (const set of el.__handlers.values()) {
    assert.equal(set.size, 0);
  }
});

test("attachPointerSwipe — events from a different pointerId are ignored mid-gesture", () => {
  const el = makeFakeEl();
  let fired = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => fired++,
    onSwipeRight: () => fired++,
  });

  // First pointer starts a horizontal gesture.
  el.__fire("pointerdown", ev("down", 200, 100, 0));
  el.__fire("pointermove", ev("move", 120, 100, 50));
  // A different pointer's up should NOT close out the gesture.
  el.__fire("pointerup", {
    pointerId: 99,
    clientX: 50,
    clientY: 100,
    timeStamp: 100,
    cancelable: true,
    preventDefault: () => {},
  });
  assert.equal(fired, 0, "second pointer must not close the first's gesture");

  // The real pointer's up should still fire.
  el.__fire("pointerup", ev("up", 120, 100, 110));
  assert.equal(fired, 1);

  cleanup();
});

test("attachPointerSwipe — second pointerdown mid-gesture is ignored", () => {
  // Without the active-pointer guard in onDown, a second finger
  // landing mid-swipe would overwrite startX/startY/pointerId and
  // the first finger's gesture would silently turn into the second
  // finger's half-formed gesture on release.
  const el = makeFakeEl();
  let left = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => left++,
    onSwipeRight: () => {},
  });

  el.__fire("pointerdown", ev("down", 200, 100, 0));
  // Second pointer lands mid-gesture — must be ignored and must NOT
  // reset the tracked start coordinates. If the guard regresses, the
  // start would jump to (50, 100) and the pointer-1 move/up would no
  // longer compute a left-swipe.
  el.__fire("pointerdown", {
    pointerId: 2,
    clientX: 50,
    clientY: 100,
    timeStamp: 30,
    cancelable: true,
    preventDefault: () => {},
  });
  el.__fire("pointermove", ev("move", 120, 100, 50)); // pointer 1, dx = -80
  el.__fire("pointerup", ev("up", 120, 100, 100));

  assert.equal(left, 1);
  cleanup();
});

test("attachPointerSwipe — a fresh pointerdown is accepted after pointercancel", () => {
  // pointercancel must leave the hook ready for the next gesture.
  // Without this, a single browser-cancelled swipe would dead-lock
  // the element until the user navigates away.
  const el = makeFakeEl();
  let left = 0;
  const cleanup = attachPointerSwipe(el as unknown as HTMLElement, {
    onSwipeLeft: () => left++,
    onSwipeRight: () => {},
  });

  el.__fire("pointerdown", ev("down", 200, 100, 0));
  el.__fire("pointermove", ev("move", 120, 100, 50));
  el.__fire("pointercancel", ev("cancel", 120, 100, 60));

  // New gesture — must be accepted, not swallowed by leftover state.
  el.__fire("pointerdown", ev("down", 300, 100, 200));
  el.__fire("pointermove", ev("move", 220, 100, 250));
  el.__fire("pointerup", ev("up", 220, 100, 300));

  assert.equal(left, 1);
  cleanup();
});
