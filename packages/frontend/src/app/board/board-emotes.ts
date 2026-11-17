/**
 * Emote picker (FigJam-style reactions, key `E`): a small row of emoji at
 * the local pointer. Picking one plays a burst at that point locally and
 * sends it to peers as `presence.emote` (see `board-peer-layer.ts`). The
 * picker stays open so a user can send several; Esc, `E` again, or a
 * click elsewhere closes it.
 */

export const BOARD_EMOTES = ["👍", "❤️", "😂", "🎉", "🤔", "👀"] as const;

export interface EmotePickerDeps {
  container: HTMLElement;
  /** `at` is the container-relative point the picker was opened at. */
  onPick: (emoji: string, at: { x: number; y: number }) => void;
}

export interface EmotePicker {
  isOpen(): boolean;
  open(at: { x: number; y: number }): void;
  close(): void;
  dispose(): void;
}

export function createEmotePicker(deps: EmotePickerDeps): EmotePicker {
  const root = document.createElement("div");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Emotes");
  root.dataset.boardEmotePicker = "";
  root.style.cssText = [
    "position:absolute", "left:0", "top:0", "z-index:6", "display:none",
    "gap:2px", "padding:4px", "border-radius:999px", "background:#fff",
    "box-shadow:0 2px 10px rgb(0 0 0 / 0.2)", "border:1px solid rgb(0 0 0 / 0.08)",
  ].join(";");
  let anchor = { x: 0, y: 0 };
  let open = false;

  BOARD_EMOTES.forEach((emoji, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = emoji;
    b.setAttribute("aria-label", `Send ${emoji}`);
    b.title = `${emoji} (${i + 1})`;
    b.style.cssText = [
      "width:32px", "height:32px", "border:0", "border-radius:50%",
      "background:transparent", "font-size:18px", "line-height:1", "cursor:pointer",
      "padding:0",
    ].join(";");
    b.addEventListener("mouseenter", () => (b.style.background = "rgb(0 0 0 / 0.06)"));
    b.addEventListener("mouseleave", () => (b.style.background = "transparent"));
    // Keep focus where it was: a focused button would make the slides
    // editor ignore every shortcut until the next canvas click.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      deps.onPick(emoji, anchor);
    });
    root.appendChild(b);
  });
  root.addEventListener("pointerdown", (e) => e.stopPropagation());
  deps.container.appendChild(root);

  const onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && root.contains(e.target)) return;
    close();
  };
  const close = () => {
    if (!open) return;
    open = false;
    root.style.display = "none";
    document.removeEventListener("pointerdown", onOutside, true);
  };

  return {
    isOpen: () => open,
    open(at) {
      anchor = at;
      // Centred above the pointer, so the burst rises out of the picker.
      root.style.transform = `translate(calc(${at.x}px - 50%), ${at.y - 52}px)`;
      root.style.display = "flex";
      if (!open) document.addEventListener("pointerdown", onOutside, true);
      open = true;
    },
    close,
    dispose() {
      close();
      root.remove();
    },
  };
}
