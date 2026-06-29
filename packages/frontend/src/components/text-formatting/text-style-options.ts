/**
 * Style option data and filtering utilities for the TextStyleGroup block-type
 * dropdown. Kept in a plain `.ts` module so it can be unit-tested without a
 * DOM / JSX environment.
 */

import type { BlockType, HeadingLevel, StyleId } from "@wafflebase/docs";

/** A single entry in the block-type dropdown. */
export interface StyleOption {
  label: string;
  type: BlockType;
  headingLevel?: HeadingLevel;
  /** The named style this option applies/redefines. */
  styleId: StyleId;
  className: string;
  shortcut?: string;
}

/**
 * Full ordered list of block-type options (Google Docs style). Preview
 * classNames mirror the refreshed built-in look — non-bold headings with a
 * size + grayscale hierarchy (see `model/named-styles.ts`).
 */
export const STYLE_OPTIONS: StyleOption[] = [
  {
    label: "Normal text",
    type: "paragraph",
    styleId: "normal",
    className: "text-[13px]",
    shortcut: "⌥0",
  },
  {
    label: "Title",
    type: "title",
    styleId: "title",
    className: "text-[22px] leading-tight",
  },
  {
    label: "Subtitle",
    type: "subtitle",
    styleId: "subtitle",
    className: "text-[13px] text-muted-foreground",
  },
  {
    label: "Heading 1",
    type: "heading",
    headingLevel: 1,
    styleId: "heading-1",
    className: "text-[18px]",
    shortcut: "⌥1",
  },
  {
    label: "Heading 2",
    type: "heading",
    headingLevel: 2,
    styleId: "heading-2",
    className: "text-[15px]",
    shortcut: "⌥2",
  },
  {
    label: "Heading 3",
    type: "heading",
    headingLevel: 3,
    styleId: "heading-3",
    className: "text-[14px] text-muted-foreground",
    shortcut: "⌥3",
  },
  {
    label: "Heading 4",
    type: "heading",
    headingLevel: 4,
    styleId: "heading-4",
    className: "text-[13px] text-muted-foreground",
    shortcut: "⌥4",
  },
  {
    label: "Heading 5",
    type: "heading",
    headingLevel: 5,
    styleId: "heading-5",
    className: "text-[12px] text-muted-foreground",
    shortcut: "⌥5",
  },
  {
    label: "Heading 6",
    type: "heading",
    headingLevel: 6,
    styleId: "heading-6",
    className: "text-[12px] italic text-muted-foreground",
    shortcut: "⌥6",
  },
];

/**
 * Return the subset of `STYLE_OPTIONS` whose `type` is in `allowedBlockTypes`.
 * When `allowedBlockTypes` is undefined the full list is returned unchanged.
 */
export function getFilteredStyleOptions(
  allowedBlockTypes?: ReadonlyArray<BlockType>
): StyleOption[] {
  if (!allowedBlockTypes) return STYLE_OPTIONS;
  return STYLE_OPTIONS.filter((opt) => allowedBlockTypes.includes(opt.type));
}

export function getBlockLabel(
  type: BlockType,
  headingLevel?: HeadingLevel
): string {
  if (type === "title") return "Title";
  if (type === "subtitle") return "Subtitle";
  if (type === "heading" && headingLevel) return `Heading ${headingLevel}`;
  return "Normal text";
}

/**
 * Map a block type (+ heading level) to the named `StyleId` that governs it.
 * Mirrors `blockStyleId` in `@wafflebase/docs` for non-block inputs the
 * toolbar deals in (paragraph / list-item / title / subtitle / heading).
 */
export function blockTypeToStyleId(
  type: BlockType,
  headingLevel?: HeadingLevel
): StyleId {
  if (type === "title") return "title";
  if (type === "subtitle") return "subtitle";
  if (type === "heading") return `heading-${headingLevel ?? 1}` as StyleId;
  return "normal";
}
