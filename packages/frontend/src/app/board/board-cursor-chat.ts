/**
 * Cursor chat (FigJam's `/`): a small input bubble at the local pointer.
 * What the user types travels in `presence.chat` and is drawn beside
 * their cursor on every peer's screen (`board-peer-layer.ts`).
 *
 * Lifetime: Esc, or Enter on an empty input, closes it and clears the
 * message at once. Enter with text closes the input but leaves the
 * message up. Either way the message fades `fadeMs` after the last edit,
 * so a forgotten bubble never sticks to a cursor.
 */

export const CHAT_FADE_MS = 4000;
export const CHAT_MAX_LENGTH = 140;

export interface CursorChatDeps {
  container: HTMLElement;
  /** The message to show peers, or null to clear it. */
  publish: (text: string | null) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  fadeMs?: number;
}

export interface CursorChat {
  isOpen(): boolean;
  /** Open (or move) the input with its tip at a container-relative point. */
  open(at: { x: number; y: number }): void;
  /** Keep the open input next to the pointer. */
  moveTo(at: { x: number; y: number }): void;
  /** Close the input and clear the message. */
  close(): void;
  dispose(): void;
}

export function createCursorChat(deps: CursorChatDeps): CursorChat {
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const fadeMs = deps.fadeMs ?? CHAT_FADE_MS;

  const bubble = document.createElement("div");
  bubble.dataset.boardCursorChat = "";
  bubble.style.cssText = [
    "position:absolute", "left:0", "top:0", "z-index:6", "display:none",
    "padding:4px 8px", "border-radius:4px 12px 12px 12px",
    "background:#1f2937", "box-shadow:0 2px 8px rgb(0 0 0 / 0.25)",
  ].join(";");
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = CHAT_MAX_LENGTH;
  input.placeholder = "Say something";
  input.setAttribute("aria-label", "Cursor chat");
  input.style.cssText = [
    "background:transparent", "border:0", "outline:none", "color:#fff",
    "font:13px/1.35 system-ui,-apple-system,sans-serif", "width:200px",
  ].join(";");
  bubble.appendChild(input);
  deps.container.appendChild(bubble);

  let open = false;
  let message: string | null = null;
  let fade: unknown = null;

  const clearFade = () => {
    if (fade !== null) clearTimer(fade);
    fade = null;
  };
  const armFade = () => {
    clearFade();
    fade = setTimer(() => {
      fade = null;
      hide();
      clearMessage();
    }, fadeMs);
  };
  const clearMessage = () => {
    if (message === null) return;
    message = null;
    deps.publish(null);
  };
  const hide = () => {
    open = false;
    bubble.style.display = "none";
    if (document.activeElement === input) input.blur();
  };
  const place = (at: { x: number; y: number }) => {
    bubble.style.transform = `translate(${at.x + 14}px, ${at.y + 18}px)`;
  };

  const onInput = () => {
    const text = input.value.trim() ? input.value : null;
    if (text === message) return;
    message = text;
    deps.publish(text);
    armFade();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // The input owns its keys: nothing here may reach the board or the
    // slides editor (Delete would delete the selection, letters would
    // arm tools).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      clearFade();
      hide();
      clearMessage();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!input.value.trim()) {
        clearFade();
        hide();
        clearMessage();
      } else {
        // Keep the message up until it fades.
        hide();
      }
    }
  };
  const onBlur = () => {
    if (!open) return;
    hide();
    if (!message) clearFade();
  };
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);
  // Clicks inside the bubble are not canvas clicks.
  bubble.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    isOpen: () => open,
    open(at) {
      place(at);
      clearFade();
      clearMessage();
      input.value = "";
      open = true;
      bubble.style.display = "block";
      input.focus();
    },
    moveTo(at) {
      if (open) place(at);
    },
    close() {
      clearFade();
      hide();
      clearMessage();
    },
    dispose() {
      clearFade();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      bubble.remove();
    },
  };
}
