import type { AnimCategory, AnimEffect, AnimDirection } from '../../model/element';

/**
 * Maps a PPTX animation preset (`presetClass` + `presetID`) to our
 * `AnimCategory` / `AnimEffect` / `AnimDirection` model values.
 *
 * Source: ECMA-376 §19.5 (DrawingML Animations), PowerPoint's published
 * `presetClass` / `presetID` table, and empirical PPTX inspection.
 *
 * Preset class strings:
 *   'entr'      → entrance animations
 *   'exit'      → exit animations
 *   'emph'      → emphasis animations
 *   'path'      → motion paths     → return null (preserve raw)
 *   'mediacall' → media triggers   → return null
 *   'verb'      → OLE verbs        → return null
 *
 * Preset IDs (selected — others within a known class also return null so
 * the caller can preserve the raw preset for round-trip):
 *
 *   entr:
 *     1  → appear
 *     2  → flyIn       (with subtype → direction)
 *     3  → flyIn       (blinds-like; mapped to flyIn for simplicity)
 *     8  → spin
 *     10 → fadeIn
 *     23 → zoomIn
 *
 *   exit:
 *     1  → disappear
 *     2  → flyOut      (with subtype → direction)
 *     10 → fadeOut
 *     23 → zoomOut
 *
 *   emph:
 *     6  → grow        (OOXML "Grow/Shrink" emphasis, presetID 6)
 *     18 → pulse       (OOXML "Pulse" emphasis, presetID 18)
 *
 * FlyIn / FlyOut presetSubtype → direction:
 *   The subtype encodes the SOURCE side the element flies in FROM (or flies
 *   out TO). Our `AnimDirection` names the starting/departing side so that
 *   the renderer's `offset()` helper can translate it to an x/y offset.
 *   Mapping (OOXML bit flags, decimal):
 *     1  → right   (from left  / flies left  → across right)
 *     2  → left    (from right / flies right → across left)
 *     4  → up      (from bottom / flies upward → source is bottom)
 *     8  → down    (from top   / flies downward → source is top)
 *   Diagonal and combined values are not mapped; unknown subtypes default to
 *   'left' (a safe centre-stage entry direction).
 */

type PresetResult = {
  category: AnimCategory;
  effect: AnimEffect;
  direction?: AnimDirection;
};

/** Known class→category pairs. Classes outside this set → null. */
const CLASS_TO_CATEGORY: Record<string, AnimCategory> = {
  entr: 'entrance',
  exit: 'exit',
  emph: 'emphasis',
};

/** `${presetClass}:${presetID}` → effect (without direction). */
const PRESET_EFFECT: Record<string, AnimEffect> = {
  // Entrance
  'entr:1': 'appear',
  'entr:2': 'flyIn',
  'entr:3': 'flyIn',  // blinds variant — closest mapping
  'entr:8': 'spin',
  'entr:10': 'fadeIn',
  'entr:23': 'zoomIn',
  // Exit
  'exit:1': 'disappear',
  'exit:2': 'flyOut',
  'exit:10': 'fadeOut',
  'exit:23': 'zoomOut',
  // Emphasis
  'emph:6': 'grow',   // OOXML "Grow/Shrink"
  'emph:18': 'pulse', // OOXML "Pulse"
};

/**
 * OOXML presetSubtype → `AnimDirection` for fly effects.
 * The subtype is a direction bitmask encoding the SOURCE side.
 * Unknown values are handled in `mapPreset` with a `'left'` default.
 */
const SUBTYPE_TO_DIRECTION: Record<number, AnimDirection> = {
  1: 'right', // enters from the right (OOXML subtype 1)
  2: 'left',  // enters from the left  (OOXML subtype 2)
  4: 'up',    // enters from the top   (OOXML subtype 4)
  8: 'down',  // enters from the bottom (OOXML subtype 8)
};

const FLY_EFFECTS = new Set<AnimEffect>(['flyIn', 'flyOut']);

/**
 * Map a PPTX animation preset triple to our `AnimCategory` / `AnimEffect` /
 * `AnimDirection` model.
 *
 * Returns `null` for:
 * - Unknown `presetClass` values (`'path'`, `'mediacall'`, `'verb'`, etc.)
 * - Known class but unmapped `presetID` (caller should preserve raw preset)
 */
export function mapPreset(
  presetClass: string,
  presetID: number,
  presetSubtype?: number,
): PresetResult | null {
  const category = CLASS_TO_CATEGORY[presetClass];
  if (category === undefined) return null;

  const key = `${presetClass}:${presetID}`;
  const effect = PRESET_EFFECT[key];
  if (effect === undefined) return null;

  const result: PresetResult = { category, effect };

  if (FLY_EFFECTS.has(effect)) {
    const direction =
      presetSubtype !== undefined
        ? (SUBTYPE_TO_DIRECTION[presetSubtype] ?? 'left')
        : 'left';
    result.direction = direction;
  }

  return result;
}
