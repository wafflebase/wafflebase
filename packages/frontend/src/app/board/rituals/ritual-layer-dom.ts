import {
  PIN_SIZE,
  RESULT_BADGE,
  VOTE_DOT,
  type RitualLayout,
} from "./ritual-layout";

/**
 * The DOM half of the ritual overlay: reconciles keyed nodes to a
 * {@link RitualLayout}. Nodes are REUSED across renders (only their
 * position changes on a pan), so a pin under the pointer survives the
 * re-render a pointerdown triggers and still receives its click.
 *
 * Everything is `pointer-events: none` except comment pins: stamps and
 * vote dots are hit-tested by the canvas tool handler in screen space, so
 * clicking a stamped sticky still selects the sticky.
 */
export interface RitualLayerDom {
  render(layout: RitualLayout): void;
  showHover(text: string | null, at?: { x: number; y: number }): void;
  dispose(): void;
}

type Pool = Map<string, HTMLElement>;

function sync<T extends { key: string }>(
  parent: HTMLElement,
  pool: Pool,
  items: readonly T[],
  create: (item: T) => HTMLElement,
  update: (el: HTMLElement, item: T) => void,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    seen.add(item.key);
    let el = pool.get(item.key);
    if (!el) {
      el = create(item);
      pool.set(item.key, el);
      parent.appendChild(el);
    }
    update(el, item);
  }
  for (const [key, el] of pool) {
    if (seen.has(key)) continue;
    el.remove();
    pool.delete(key);
  }
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function createRitualLayerDom(
  root: HTMLElement,
  opts: { onPinClick: (threadId: string) => void },
): RitualLayerDom {
  const stampPool: Pool = new Map();
  const dotPool: Pool = new Map();
  const resultPool: Pool = new Map();
  const pinPool: Pool = new Map();

  const hover = document.createElement("div");
  hover.setAttribute("role", "tooltip");
  hover.dataset.boardRitualHover = "";
  hover.className =
    "pointer-events-none absolute left-0 top-0 z-30 hidden max-w-64 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md";
  root.appendChild(hover);

  return {
    render(layout) {
      sync(
        root,
        stampPool,
        layout.stamps,
        () => {
          const el = document.createElement("span");
          el.dataset.boardStamp = "";
          el.className =
            "pointer-events-none absolute left-0 top-0 flex select-none items-center justify-center leading-none drop-shadow";
          return el;
        },
        (el, s) => {
          el.textContent = s.glyph;
          el.style.width = `${s.size}px`;
          el.style.height = `${s.size}px`;
          el.style.fontSize = `${Math.round(s.size * 0.8)}px`;
          place(el, s.x - s.size / 2, s.y - s.size / 2);
        },
      );
      sync(
        root,
        dotPool,
        layout.voteDots,
        () => {
          const el = document.createElement("span");
          el.dataset.boardVoteDot = "";
          el.className =
            "pointer-events-none absolute left-0 top-0 rounded-full border-2 border-white bg-primary shadow";
          el.style.width = `${VOTE_DOT}px`;
          el.style.height = `${VOTE_DOT}px`;
          return el;
        },
        (el, d) => place(el, d.x - VOTE_DOT / 2, d.y - VOTE_DOT / 2),
      );
      sync(
        root,
        resultPool,
        layout.results,
        () => {
          const el = document.createElement("span");
          el.dataset.boardVoteResult = "";
          el.className =
            "pointer-events-none absolute left-0 top-0 flex items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-semibold text-primary-foreground shadow-md";
          el.style.minWidth = `${RESULT_BADGE}px`;
          el.style.height = `${RESULT_BADGE}px`;
          el.style.padding = "0 6px";
          return el;
        },
        (el, r) => {
          el.textContent = String(r.votes);
          el.setAttribute("aria-label", `${r.votes} vote${r.votes === 1 ? "" : "s"}`);
          place(el, r.x - RESULT_BADGE / 2, r.y - RESULT_BADGE / 2);
        },
      );
      sync(
        root,
        pinPool,
        layout.pins,
        (p) => {
          const el = document.createElement("button");
          el.type = "button";
          el.dataset.boardCommentPin = "";
          el.className =
            "pointer-events-auto absolute left-0 top-0 flex items-center justify-center rounded-full rounded-bl-none border-2 border-white text-xs font-semibold shadow-md transition-colors";
          el.style.width = `${PIN_SIZE}px`;
          el.style.height = `${PIN_SIZE}px`;
          // Keep the press away from the canvas tools and the editor
          // underneath; the click alone opens the thread.
          el.addEventListener("pointerdown", (e) => e.stopPropagation());
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = el.dataset.threadId;
            if (id) opts.onPinClick(id);
          });
          if (p.pending) el.tabIndex = -1;
          return el;
        },
        (el, p) => {
          el.textContent = p.label;
          if (p.threadId) el.dataset.threadId = p.threadId;
          else delete el.dataset.threadId;
          el.setAttribute(
            "aria-label",
            p.pending
              ? "New comment"
              : `Comment thread, ${p.count} comment${p.count === 1 ? "" : "s"}${p.orphan ? ", object deleted" : ""}`,
          );
          el.style.background = p.active ? "var(--primary)" : "var(--background)";
          el.style.color = p.active ? "var(--primary-foreground)" : "var(--foreground)";
          el.style.opacity = p.orphan ? "0.7" : "1";
          // The tip (bottom-left corner) sits on the anchor point.
          place(el, p.x, p.y - PIN_SIZE);
        },
      );
    },
    showHover(text, at) {
      if (!text || !at) {
        hover.classList.add("hidden");
        return;
      }
      hover.textContent = text;
      hover.classList.remove("hidden");
      place(hover, at.x + 12, at.y + 12);
    },
    dispose() {
      for (const pool of [stampPool, dotPool, resultPool, pinPool]) {
        for (const el of pool.values()) el.remove();
        pool.clear();
      }
      hover.remove();
    },
  };
}
