import type { PlaceholderType } from './element';

/**
 * User-facing ghost-text shown inside an empty layout placeholder.
 * Mirrors the "Click to add title" affordance found in Google Slides,
 * PowerPoint, and Keynote — without it, a fresh slide from a non-blank
 * layout looks indistinguishable from a blank slide.
 *
 * The `Record<PlaceholderType, string>` type is intentionally exhaustive
 * so adding a new `PlaceholderType` member fails to compile here until
 * a hint is supplied. Single seam ready for future i18n.
 */
const PLACEHOLDER_HINTS: Record<PlaceholderType, string> = {
  title: 'Click to add title',
  subtitle: 'Click to add subtitle',
  body: 'Click to add text',
  caption: 'Click to add caption',
  'big-number': 'Click to add number',
};

export function placeholderHintFor(type: PlaceholderType): string {
  return PLACEHOLDER_HINTS[type];
}
