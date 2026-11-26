import {
  createElement,
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { MentionMember } from "@/components/comments/components/CommentComposer";
import {
  applySelectedMentions,
  detectMentionQuery,
  type MentionRef,
} from "@/components/comments/mentions";
import { MentionListbox } from "./mention-listbox";

const MAX_MENTION_RESULTS = 8;

export interface MentionAutocompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Called with the new text on every edit, including a picked mention. */
  onChange: (value: string) => void;
  /** Who can be mentioned. Empty or missing turns the autocomplete off. */
  members?: MentionMember[];
  /**
   * The textarea's own key handling. It runs only for keys the open list
   * did not consume, and never for a keystroke that belongs to an IME
   * composition, so an Enter that commits Korean or Japanese input never
   * reaches it.
   */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Mentions already in the text, so an edited message keeps its tokens. */
  initialMentions?: MentionRef[];
}

export interface MentionAutocomplete {
  /**
   * Spread onto the textarea. Carries `onChange`, `onKeyDown` and the
   * composition handlers, plus the combobox semantics (`role`,
   * `aria-autocomplete`, `aria-expanded`, `aria-controls`,
   * `aria-activedescendant`) while there is anyone to mention.
   */
  inputProps: {
    role?: "combobox";
    "aria-autocomplete"?: "list";
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
    "aria-activedescendant"?: string;
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: (e: CompositionEvent<HTMLTextAreaElement>) => void;
  };
  /**
   * The suggestion list and its polite result-count announcement. Render it
   * inside a `relative` box around the textarea; the list opens above it.
   */
  listbox: ReactNode;
  isOpen: boolean;
  /** True while an IME composition is in progress. */
  isComposing: () => boolean;
  /** Turns picked `@name`s in `text` into canonical `@[username](userId)` tokens. */
  applyMentions: (text: string) => string;
  /** The mentions picked so far, to snapshot before clearing. */
  mentions: () => MentionRef[];
  /** Replaces the picked mentions (a reset passes nothing). Closes the list. */
  reset: (mentions?: MentionRef[]) => void;
}

/**
 * `@` member autocomplete for a plain textarea, shared by the chat composer
 * and anything else that writes a chat body (the message edit box).
 *
 * Typing `@` and a few letters opens a list of matching members; ↑/↓ move,
 * Enter or Tab picks, Esc closes, and the textarea keeps focus throughout,
 * pointing at the active option with `aria-activedescendant`. A pick inserts
 * a readable `@username `; `applyMentions` rewrites those into canonical
 * `@[username](userId)` tokens when the body is sent.
 *
 * ```tsx
 * const ref = useRef<HTMLTextAreaElement>(null);
 * const m = useMentionAutocomplete({ textareaRef: ref, onChange: setText,
 *   members, onKeyDown, initialMentions: mentionsOf(message.body) });
 * <div className="relative">
 *   <Textarea ref={ref} value={text} {...m.inputProps} />{m.listbox}
 * </div>
 * // on save: applyMentions → m.applyMentions(text)
 * ```
 */
export function useMentionAutocomplete({
  textareaRef,
  onChange,
  members,
  onKeyDown,
  initialMentions,
}: MentionAutocompleteOptions): MentionAutocomplete {
  const id = useId();
  const listboxId = `${id}-mentions`;
  const optionId = useCallback(
    (i: number) => `${id}-mention-${i}`,
    [id],
  );
  const composingRef = useRef(false);
  const selectedRef = useRef<MentionRef[]>(initialMentions ?? []);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(
    null,
  );
  const [activeIndex, setActiveIndex] = useState(0);
  // Stable, so a caller can run it from an effect keyed on what changed.
  const reset = useCallback((mentions: MentionRef[] = []) => {
    selectedRef.current = [...mentions];
    setQuery(null);
  }, []);

  const enabled = !!members && members.length > 0;
  const results =
    enabled && query
      ? members!
          .filter((m) =>
            m.username.toLowerCase().includes(query.query.toLowerCase()),
          )
          .slice(0, MAX_MENTION_RESULTS)
      : [];
  const isOpen = query !== null && results.length > 0;
  const safeIndex = Math.min(activeIndex, results.length - 1);

  const refresh = (value: string, caret: number) => {
    if (!enabled || composingRef.current) {
      setQuery(null);
      return;
    }
    setQuery(detectMentionQuery(value, caret));
    setActiveIndex(0);
  };

  const select = (member: MentionMember) => {
    const ta = textareaRef.current;
    if (!ta || !query) return;
    const value = ta.value;
    const queryEnd = query.start + 1 + query.query.length;
    const before = value.slice(0, query.start);
    const insertion = `@${member.username} `;
    onChange(before + insertion + value.slice(queryEnd));
    if (!selectedRef.current.some((m) => m.username === member.username)) {
      selectedRef.current.push({
        userId: member.userId,
        username: member.username,
      });
    }
    setQuery(null);
    const caret = before.length + insertion.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An Enter that commits an IME composition belongs to the IME. Safari
    // reports it only through keyCode 229, and fires compositionend before
    // keydown, so all three signals are checked.
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        select(results[safeIndex]);
        return;
      }
      if (e.key === "Escape") {
        // Closing the list is the whole of this Esc; the edit box must not
        // also read it as "cancel".
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const inputProps: MentionAutocomplete["inputProps"] = {
    ...(enabled && {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": isOpen,
      "aria-controls": isOpen ? listboxId : undefined,
      "aria-activedescendant": isOpen ? optionId(safeIndex) : undefined,
    }),
    onChange: (e) => {
      const value = e.target.value;
      onChange(value);
      refresh(value, e.target.selectionStart ?? value.length);
    },
    onKeyDown: handleKeyDown,
    onCompositionStart: () => {
      composingRef.current = true;
      setQuery(null);
    },
    onCompositionEnd: (e) => {
      composingRef.current = false;
      const ta = e.currentTarget;
      refresh(ta.value, ta.selectionStart ?? ta.value.length);
    },
  };

  return {
    inputProps,
    listbox: enabled
      ? createElement(MentionListbox, {
          id: listboxId,
          optionId,
          open: isOpen,
          members: results,
          activeIndex: safeIndex,
          onPick: select,
        })
      : null,
    isOpen,
    isComposing: () => composingRef.current,
    applyMentions: (text) => applySelectedMentions(text, selectedRef.current),
    mentions: () => [...selectedRef.current],
    reset,
  };
}
