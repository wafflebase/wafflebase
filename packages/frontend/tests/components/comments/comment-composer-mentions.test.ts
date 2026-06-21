// @vitest-environment jsdom
/**
 * Tests for CommentComposer's `@` mention autocomplete.
 *
 * Asserts:
 *   - typing "@" + query opens a member dropdown filtered by username,
 *   - keyboard select (Enter) inserts clean `@username` text,
 *   - submit tokenizes selected mentions into `@[username](userId)`,
 *   - a mention whose text was edited after selection drops to plain text,
 *   - with no `members` prop the composer stays a plain textarea.
 *
 * JSX is avoided (matching the package's tests/**\/*.test.ts runner) by
 * building elements with React.createElement.
 */
import { describe, test, expect, afterEach, vi } from "vitest";
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  CommentComposer,
  type MentionMember,
} from "../../../src/components/comments/components/CommentComposer.tsx";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS: MentionMember[] = [
  { userId: "u1", username: "kim" },
  { userId: "u2", username: "kimchi" },
  { userId: "u3", username: "bob" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
  return host;
}

// React patches the element's own `value` setter to track changes, so a
// plain `ta.value = …` assignment updates React's tracker and the synthetic
// onChange is then deduped away. Calling the prototype setter bypasses the
// instance patch: the DOM value changes without touching React's tracker, so
// the dispatched input event is seen as a real change.
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)!.set!;

function type(ta: HTMLTextAreaElement, value: string) {
  act(() => {
    nativeValueSetter.call(ta, value);
    ta.selectionStart = value.length;
    ta.selectionEnd = value.length;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(ta: HTMLTextAreaElement, init: KeyboardEventInit) {
  act(() => {
    ta.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe("CommentComposer mentions", () => {
  test("typing @ + query opens a dropdown filtered by username", () => {
    const el = render(
      h(CommentComposer, {
        submitLabel: "Comment",
        onSubmit: () => {},
        members: MEMBERS,
      }),
    );
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    type(ta, "@k");
    const options = el.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2); // kim, kimchi (not bob)
  });

  test("Enter selects the active member and inserts clean @username text", () => {
    const el = render(
      h(CommentComposer, {
        submitLabel: "Comment",
        onSubmit: () => {},
        members: MEMBERS,
      }),
    );
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    type(ta, "@k");
    key(ta, { key: "Enter" });
    expect(ta.value).toBe("@kim ");
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  test("submit tokenizes the selected mention", async () => {
    const onSubmit = vi.fn();
    const el = render(
      h(CommentComposer, { submitLabel: "Comment", onSubmit, members: MEMBERS }),
    );
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    type(ta, "@k");
    key(ta, { key: "Enter" });
    await act(async () => {
      (
        el.querySelector("button:last-of-type") as HTMLButtonElement
      ).click();
    });
    expect(onSubmit).toHaveBeenCalledWith("@[kim](u1)");
  });

  test("a mention edited after selection drops to plain text on submit", async () => {
    const onSubmit = vi.fn();
    const el = render(
      h(CommentComposer, { submitLabel: "Comment", onSubmit, members: MEMBERS }),
    );
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    type(ta, "@k");
    key(ta, { key: "Enter" });
    type(ta, "@kimX");
    await act(async () => {
      (
        el.querySelector("button:last-of-type") as HTMLButtonElement
      ).click();
    });
    expect(onSubmit).toHaveBeenCalledWith("@kimX");
  });

  test("edit entry shows de-tokenized text and round-trips on save", async () => {
    const onSubmit = vi.fn();
    const el = render(
      h(CommentComposer, {
        submitLabel: "Save",
        onSubmit,
        members: MEMBERS,
        initialBody: "hey @[kim](u1) look",
      }),
    );
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    // The raw token is never shown to the user.
    expect(ta.value).toBe("hey @kim look");
    // An untouched save re-emits the original token losslessly.
    await act(async () => {
      (el.querySelector("button:last-of-type") as HTMLButtonElement).click();
    });
    expect(onSubmit).toHaveBeenCalledWith("hey @[kim](u1) look");
  });

  test("no dropdown when the members prop is absent", () => {
    const el = render(
      h(CommentComposer, { submitLabel: "Comment", onSubmit: () => {} }),
    );
    const ta = el.querySelector("textarea") as HTMLTextAreaElement;
    type(ta, "@k");
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });
});
