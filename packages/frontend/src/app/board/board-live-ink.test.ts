import { describe, expect, it, vi } from "vitest";
import type { BoardLiveStroke } from "@/types/board-document";
import {
  LIVE_STROKE_WINDOW,
  StrokeAccumulator,
  createLiveStrokePublisher,
  createLiveStrokeReceiver,
  cssColor,
  decodeLivePoints,
  encodeLivePoints,
  isLiveStroke,
  liveStyle,
  strokeWindow,
} from "./board-live-ink";
import { DEFAULT_INK_STATE } from "./board-ink";

const pts = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ x: (from + i) * 1.5, y: Math.sin(from + i) * 10 }));

/** A manual clock + timer queue, like `board-cursor-publish.test.ts`. */
function fakeTimers() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => t,
    setTimer: (cb: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: t + ms, cb });
      return seq;
    },
    clearTimer: (h: unknown) => {
      timers.delete(h as number);
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at;
        timers.delete(due[0]);
        due[1].cb();
      }
      t = end;
    },
  };
}

describe("live point codec", () => {
  it("round-trips world points to a tenth of a unit", () => {
    const p = [
      { x: 12345.67, y: -20.04 },
      { x: 12346.1, y: -19.5 },
    ];
    const back = decodeLivePoints(encodeLivePoints(p));
    back.forEach((q, i) => {
      expect(q.x).toBeCloseTo(p[i].x, 1);
      expect(q.y).toBeCloseTo(p[i].y, 1);
    });
  });

  it("decodes malformed input to nothing", () => {
    for (const bad of [undefined, 3, "", "1,2;x", "1;2", "1,2,3"]) {
      expect(decodeLivePoints(bad)).toEqual([]);
    }
  });
});

describe("strokeWindow + StrokeAccumulator", () => {
  it("a window is at most 64 points and says where it starts", () => {
    expect(strokeWindow(pts(10))).toEqual({ base: 0, points: pts(10) });
    const w = strokeWindow(pts(200));
    expect(w.base).toBe(200 - LIVE_STROKE_WINDOW);
    expect(w.points).toHaveLength(LIVE_STROKE_WINDOW);
  });

  it("splices overlapping windows into the whole stroke, even with writes missed", () => {
    const all = pts(300);
    const acc = new StrokeAccumulator();
    // A peer that only sees every few writes still ends with every point.
    for (const n of [5, 40, 90, 140, 190, 240, 300]) {
      const w = strokeWindow(all.slice(0, n));
      acc.apply(1, w.base, w.points);
    }
    expect(acc.points).toEqual(all);
  });

  it("bridges a gap larger than a window, and restarts on a new stroke id", () => {
    const acc = new StrokeAccumulator();
    acc.apply(1, 0, pts(10));
    const late = strokeWindow(pts(200));
    acc.apply(1, late.base, late.points);
    expect(acc.points).toHaveLength(10 + LIVE_STROKE_WINDOW);
    acc.apply(2, 3, pts(4, 100));
    expect(acc.points).toEqual(pts(4, 100));
  });

  it("follows a Shift-held line whose end keeps moving", () => {
    const acc = new StrokeAccumulator();
    acc.apply(1, 0, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    acc.apply(1, 0, [{ x: 0, y: 0 }, { x: 20, y: 5 }]);
    expect(acc.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 5 }]);
  });
});

describe("createLiveStrokePublisher", () => {
  const setup = (audience = true) => {
    const t = fakeTimers();
    const sent: (BoardLiveStroke | null)[] = [];
    let open = audience;
    const pub = createLiveStrokePublisher({
      ...t,
      shouldPublish: () => open,
      publish: (s) => sent.push(s),
      style: () => liveStyle(DEFAULT_INK_STATE),
    });
    return { t, sent, pub, setOpen: (v: boolean) => (open = v) };
  };

  it("throttles to one write per 40 ms and clears on the stroke's end", () => {
    const { t, sent, pub } = setup();
    pub.progress(pts(1));
    for (let i = 2; i <= 20; i++) {
      t.advance(5);
      pub.progress(pts(i));
    }
    t.advance(200);
    // 1 immediate + ~95 ms / 40 ms throttled; the last value always lands.
    expect(sent.length).toBeLessThanOrEqual(5);
    const last = sent[sent.length - 1]!;
    expect(decodeLivePoints(last.points)).toHaveLength(20);
    expect(last).toMatchObject({ tool: "marker", color: "#1E1E1E", width: 4, alpha: 1, base: 0 });
    pub.progress(null);
    t.advance(200);
    expect(sent[sent.length - 1]).toBeNull();
  });

  it("each payload is bounded by the window", () => {
    const { t, sent, pub } = setup();
    pub.progress(pts(500));
    t.advance(200);
    const s = sent[sent.length - 1]!;
    expect(decodeLivePoints(s.points)).toHaveLength(LIVE_STROKE_WINDOW);
    expect(s.base).toBe(500 - LIVE_STROKE_WINDOW);
  });

  it("numbers strokes and writes nothing without an audience until resend", () => {
    const { t, sent, pub, setOpen } = setup(false);
    pub.progress(pts(3));
    t.advance(200);
    expect(sent).toEqual([]);
    setOpen(true);
    pub.resend();
    t.advance(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.id).toBe(1);
    pub.progress(null);
    pub.progress(pts(2));
    t.advance(200);
    expect(sent[sent.length - 1]!.id).toBe(2);
  });
});

describe("createLiveStrokeReceiver", () => {
  it("paints a peer's stroke under its client id and removes it when cleared", () => {
    const set = vi.fn();
    const r = createLiveStrokeReceiver({ setPeerStroke: set });
    const stroke: BoardLiveStroke = {
      id: 1,
      tool: "highlighter",
      color: "#FFC53D",
      width: 20,
      alpha: 0.35,
      base: 0,
      points: encodeLivePoints(pts(3)),
    };
    r.update([{ clientID: "a", presence: { stroke } }]);
    expect(set).toHaveBeenLastCalledWith("a", {
      points: decodeLivePoints(stroke.points),
      color: "rgba(255, 197, 61, 0.35)",
      width: 20,
      cap: "round",
    });
    r.update([{ clientID: "a", presence: { stroke: null } }]);
    expect(set).toHaveBeenLastCalledWith("a", null);
    // A departed peer is cleared too.
    r.update([{ clientID: "b", presence: { stroke: { ...stroke } } }]);
    r.update([]);
    expect(set).toHaveBeenLastCalledWith("b", null);
  });

  it("ignores malformed presence", () => {
    const set = vi.fn();
    const r = createLiveStrokeReceiver({ setPeerStroke: set });
    r.update([{ clientID: "a", presence: { stroke: { id: "x" } as never } }]);
    expect(set).not.toHaveBeenCalled();
    expect(isLiveStroke({ id: 1, base: 0, color: "#000", width: 9999, alpha: 1, points: "" })).toBe(false);
  });
});

describe("cssColor", () => {
  it("keeps an opaque hex and spells out alpha", () => {
    expect(cssColor("#1E1E1E", 1)).toBe("#1E1E1E");
    expect(cssColor("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });
});
