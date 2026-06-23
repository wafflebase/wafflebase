/**
 * Serialize slide transitions and object animations to OOXML.
 *
 * Inverse of `src/import/pptx/transition-map.ts` and
 * `src/import/pptx/timing.ts`.
 *
 * Model fidelity:
 * - `SlideTransition` stores an abstract type + optional direction + durationMs.
 *   No raw OOXML node is preserved by the importer, so we emit the closest
 *   OOXML `<p:transition>` child element. The `spd` attribute encodes
 *   durationMs in three discrete buckets (slow/med/fast).
 * - `SlideAnimation` preserves `pptxPreset` for unmapped OOXML presets and
 *   `motionPath` for `<p:animMotion>` paths. Known presets are round-tripped
 *   via the same presetClass/presetID table the importer uses.
 *
 * Approximations (documented):
 * - Transition durationMs is bucketed to slow(1000)/med(500)/fast(250); any
 *   non-standard value rounds to the nearest bucket.
 * - The `'slide'` transition type has no single OOXML tag — it is emitted
 *   as `<p:push>` (the closest directional effect).
 * - `'dissolve'` is emitted as `<p:dissolve>` (OOXML has a dissolve element).
 * - For animations, click-group wrapping mirrors the importer's reading order:
 *   each `onClick` starts a new click group; `withPrev`/`afterPrev` continue
 *   the current group.
 * - `byParagraph` emits a `<p:txEl><p:pRg st="0" end="9999"/></p:txEl>`
 *   as a best-effort range to trigger by-paragraph behaviour.
 * - `motionPath` is round-tripped verbatim into `<p:animMotion path="...">`.
 */

import type { AnimCategory, AnimDirection, AnimEffect, AnimEasing, AnimStart } from '../../model/element.js';
import type { SlideAnimation, SlideTransition } from '../../model/presentation.js';
import { escapeXmlAttr } from './xml.js';

// ---------------------------------------------------------------------------
// Transition serialization
// ---------------------------------------------------------------------------

/**
 * Maps `SlideTransition['type']` to the OOXML child element local name.
 * `'none'` emits `<p:cut/>` (instant cut), `'slide'` approximates to `<p:push>`.
 */
const TYPE_TO_TAG: Record<SlideTransition['type'], string> = {
  none: 'cut',
  fade: 'fade',
  dissolve: 'dissolve',
  slide: 'push',   // approximation; closest OOXML directional effect
  flip: 'flip',
  cube: 'cube',
  wipe: 'wipe',
  push: 'push',
};

/** Milliseconds → OOXML `spd` attribute (three-bucket). */
function msToSpd(ms: number): string {
  if (ms <= 375) return 'fast';   // ≤375 ms → fast (midpoint 250–500)
  if (ms <= 750) return 'med';    // ≤750 ms → med  (midpoint 500–1000)
  return 'slow';
}

/** `AnimDirection` → OOXML `dir` attribute (l/r/u/d). */
const DIR_TO_ATTR: Record<AnimDirection, string> = {
  left: 'l',
  right: 'r',
  up: 'u',
  down: 'd',
};

/**
 * Serialize a `SlideTransition` to a `<p:transition>` XML string.
 *
 * The OOXML `spd` attribute encodes duration in three buckets.
 * Directional transitions (`push`, `wipe`) include a child element with
 * a `dir` attribute when a direction is specified.
 */
export function transitionToXml(t: SlideTransition): string {
  const spd = msToSpd(t.durationMs);
  const spdAttr = spd !== 'med' ? ` spd="${spd}"` : '';  // med is the default, omit for brevity

  const tag = TYPE_TO_TAG[t.type];

  // Direction attribute for push/wipe types.
  const dirAttr =
    (t.type === 'push' || t.type === 'wipe' || t.type === 'slide') && t.direction
      ? ` dir="${DIR_TO_ATTR[t.direction]}"`
      : '';

  // 'none' / 'cut' and 'fade' / 'dissolve' have no direction; their child is self-closing.
  const child = `<p:${tag}${dirAttr}/>`;

  return `<p:transition${spdAttr}>${child}</p:transition>`;
}

// ---------------------------------------------------------------------------
// Animation (timing) serialization
// ---------------------------------------------------------------------------

/**
 * OOXML `presetClass` strings per `AnimCategory`.
 */
const CATEGORY_TO_CLASS: Record<AnimCategory, string> = {
  entrance: 'entr',
  exit: 'exit',
  emphasis: 'emph',
};

/**
 * `AnimEffect` → OOXML `{ presetClass, presetID }`.
 * Mirrors the PRESET_EFFECT table in `src/import/pptx/anim-preset-map.ts`.
 */
const EFFECT_TO_PRESET: Record<AnimEffect, { cls: string; id: number }> = {
  // Entrance
  appear:     { cls: 'entr', id: 1  },
  flyIn:      { cls: 'entr', id: 2  },
  spin:       { cls: 'entr', id: 8  },
  fadeIn:     { cls: 'entr', id: 10 },
  zoomIn:     { cls: 'entr', id: 23 },
  // Exit
  disappear:  { cls: 'exit', id: 1  },
  flyOut:     { cls: 'exit', id: 2  },
  fadeOut:    { cls: 'exit', id: 10 },
  zoomOut:    { cls: 'exit', id: 23 },
  // Emphasis
  grow:       { cls: 'emph', id: 6  },
  pulse:      { cls: 'emph', id: 18 },
};

/** `AnimDirection` → OOXML fly subtype (bitmask). Inverse of SUBTYPE_TO_DIRECTION. */
const DIR_TO_SUBTYPE: Record<AnimDirection, number> = {
  right: 1,
  left:  2,
  up:    4,
  down:  8,
};

const FLY_EFFECTS = new Set<AnimEffect>(['flyIn', 'flyOut']);

/** `AnimStart` → OOXML `nodeType` attribute. */
const START_TO_NODE_TYPE: Record<AnimStart, string> = {
  onClick:   'clickEffect',
  withPrev:  'withEffect',
  afterPrev: 'afterEffect',
};

/**
 * `AnimEasing` → OOXML `accel`/`decel` hundredths-of-percent values.
 * Absent easing (model default = easeInOut) emits both accel=50000 decel=50000.
 */
function easingAttrs(easing: AnimEasing | undefined): string {
  switch (easing) {
    case 'easeIn':    return ' accel="100000"';
    case 'easeOut':   return ' decel="100000"';
    case 'linear':    return '';
    case 'easeInOut':
    default:
      return ' accel="50000" decel="50000"';
  }
}

/**
 * Emit a single effect `<p:par>` block for one `SlideAnimation`.
 *
 * @param anim   - the animation model object
 * @param spid   - the integer shape ID for the element (from `elementIdToSpid`)
 */
function effectParXml(anim: SlideAnimation, spid: number): string {
  const nodeType = START_TO_NODE_TYPE[anim.start];
  const easing = easingAttrs(anim.easing);

  let presetClass: string;
  let presetID: number;
  let presetSubtype: number | undefined;

  if (anim.pptxPreset) {
    // Preserved unknown preset — write back the raw class/id/subtype.
    presetClass = anim.pptxPreset.class;
    presetID = anim.pptxPreset.id;
    presetSubtype = anim.pptxPreset.subtype;
  } else {
    const preset = EFFECT_TO_PRESET[anim.effect];
    presetClass = preset?.cls ?? CATEGORY_TO_CLASS[anim.category];
    presetID = preset?.id ?? 1;
    if (FLY_EFFECTS.has(anim.effect) && anim.direction !== undefined) {
      presetSubtype = DIR_TO_SUBTYPE[anim.direction];
    }
  }

  const subtypeAttr = presetSubtype !== undefined ? ` presetSubtype="${presetSubtype}"` : '';

  // Build target element — spTgt with optional txEl for byParagraph.
  const tgtEl = anim.byParagraph
    ? `<p:tgtEl><p:spTgt spid="${spid}"><p:txEl><p:pRg st="0" end="9999"/></p:txEl></p:spTgt></p:tgtEl>`
    : `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;

  // Build the innermost behavior element — use animEffect for known presets,
  // animMotion for motion paths, otherwise a plain anim.
  let behaviorEl: string;
  if (anim.motionPath !== undefined) {
    behaviorEl =
      `<p:animMotion path="${escapeXmlAttr(anim.motionPath)}">` +
      `<p:cBhvr>${tgtEl}</p:cBhvr>` +
      `</p:animMotion>`;
  } else {
    behaviorEl =
      `<p:animEffect transition="in">` +
      `<p:cBhvr>${tgtEl}</p:cBhvr>` +
      `</p:animEffect>`;
  }

  const cTn =
    `<p:cTn id="0" dur="${anim.durationMs}" nodeType="${nodeType}"` +
    ` presetClass="${presetClass}" presetID="${presetID}"${subtypeAttr}${easing}>` +
    `<p:stCondLst><p:cond evt="onNext" delay="${anim.delayMs ?? 0}"/></p:stCondLst>` +
    `<p:childTnLst>${behaviorEl}</p:childTnLst>` +
    `</p:cTn>`;

  return `<p:par>${cTn}</p:par>`;
}

/**
 * Group animations into click groups.
 * A new click group starts whenever `anim.start === 'onClick'`.
 */
function groupByClick(anims: SlideAnimation[]): SlideAnimation[][] {
  const groups: SlideAnimation[][] = [];
  for (const anim of anims) {
    if (anim.start === 'onClick' || groups.length === 0) {
      groups.push([anim]);
    } else {
      groups[groups.length - 1].push(anim);
    }
  }
  return groups;
}

/**
 * Serialize an array of `SlideAnimation` objects to a `<p:timing>` XML string.
 *
 * Returns `''` for an empty array (no timing element in the slide XML).
 *
 * @param anims           - ordered animation list for the slide
 * @param elementIdToSpid - map from model element id → OOXML integer shape id;
 *                          elements not in the map are skipped (report-worthy
 *                          in the caller, not here)
 */
export function animationsToTimingXml(
  anims: SlideAnimation[],
  elementIdToSpid?: Map<string, number>,
): string {
  if (anims.length === 0) return '';

  const idToSpid = elementIdToSpid ?? new Map<string, number>();

  const groups = groupByClick(anims);

  const clickGroupXmls: string[] = [];
  for (const group of groups) {
    const effectPars: string[] = [];
    for (const anim of group) {
      const spid = idToSpid.get(anim.elementId);
      if (spid === undefined) continue; // element not on slide — skip
      effectPars.push(effectParXml(anim, spid));
    }
    if (effectPars.length === 0) continue;

    const clickGroupCTn =
      `<p:cTn id="0" nodeType="mainSeq">` +
      `<p:childTnLst>${effectPars.join('')}</p:childTnLst>` +
      `</p:cTn>`;
    clickGroupXmls.push(`<p:par>${clickGroupCTn}</p:par>`);
  }

  if (clickGroupXmls.length === 0) return '';

  const mainSeq =
    `<p:seq nodeType="mainSeq">` +
    `<p:cTn id="0">` +
    `<p:childTnLst>${clickGroupXmls.join('')}</p:childTnLst>` +
    `</p:cTn>` +
    `</p:seq>`;

  const tmRoot =
    `<p:par>` +
    `<p:cTn id="0" nodeType="tmRoot">` +
    `<p:childTnLst>${mainSeq}</p:childTnLst>` +
    `</p:cTn>` +
    `</p:par>`;

  return `<p:timing><p:tnLst>${tmRoot}</p:tnLst></p:timing>`;
}
