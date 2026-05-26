/**
 * Style option data and filtering utilities for the TextStyleGroup block-type
 * dropdown. Kept in a plain `.ts` module so it can be unit-tested without a
 * DOM / JSX environment.
 */

import type { BlockType, HeadingLevel } from "@wafflebase/docs";

/** A single entry in the block-type dropdown. */
export interface StyleOption {
  label: string;
  type: BlockType;
  headingLevel?: HeadingLevel;
  className: string;
  shortcut?: string;
}

/** Full ordered list of block-type options (Google Docs style). */
export const STYLE_OPTIONS: StyleOption[] = [
  {
    label: "Normal text",
    type: "paragraph",
    className: "text-[13px]",
    shortcut: "⌥0",
  },
  {
    label: "Title",
    type: "title",
    className: "text-[22px] leading-tight",
  },
  {
    label: "Subtitle",
    type: "subtitle",
    className: "text-[13px] text-muted-foreground",
  },
  {
    label: "Heading 1",
    type: "heading",
    headingLevel: 1,
    className: "text-[18px] font-bold",
    shortcut: "⌥1",
  },
  {
    label: "Heading 2",
    type: "heading",
    headingLevel: 2,
    className: "text-[16px] font-bold",
    shortcut: "⌥2",
  },
  {
    label: "Heading 3",
    type: "heading",
    headingLevel: 3,
    className: "text-[14px] font-bold",
    shortcut: "⌥3",
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
