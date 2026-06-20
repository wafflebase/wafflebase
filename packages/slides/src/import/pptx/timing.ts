/**
 * Parse a PPTX `<p:timing>` element into a flat `SlideAnimation[]`.
 *
 * OOXML `<p:timing>` holds a SMIL-like time-node tree. This module
 * flattens the `mainSeq` path into our per-slide animation sequence,
 * mapping known presets via `mapPreset` and PRESERVING unmapped ones
 * (pptxPreset round-trip). Trigger sequences (interactiveSeq) and
 * media nodes (audio/video) are dropped with report counters.
 *
 * Tree shape navigated:
 *   p:timing > p:tnLst > p:par > p:cTn(nodeType="tmRoot") > p:childTnLst
 *     > p:seq(nodeType="mainSeq") > p:cTn > p:childTnLst
 *       > p:par (click group) > p:cTn > p:childTnLst
 *         > p:par (effect) > p:cTn[presetClass,presetID,presetSubtype,nodeType,dur]
 *             > p:childTnLst > p:anim | p:animEffect | p:animScale | …
 *                 > p:cBhvr > p:tgtEl > p:spTgt[spid]
 *
 * Easing convention:
 *   accel > 0 && decel > 0  → easeInOut
 *   accel > 0 only          → easeIn
 *   decel > 0 only          → easeOut
 *   neither                 → linear
 * (These match the OOXML `<p:cTn accel decel>` hundredths-of-percent attrs.)
 *
 * Start condition resolution (in priority order):
 *   1. cTn nodeType: clickEffect → onClick, withEffect → withPrev, afterEffect → afterPrev
 *   2. stCondLst cond evt: onNext / delay=indefinite → onClick, onEnd → afterPrev
 *   3. stCondLst cond delay=0 (and no onClick evt) → withPrev
 *   4. Default: onClick (first effect of a click group), withPrev (subsequent)
 */

import type { AnimCategory, AnimEasing, AnimEffect, AnimStart } from '../../model/element';
import type { SlideAnimation } from '../../model/presentation';
import { generateId } from '../../model/element';
import { mapPreset } from './anim-preset-map';
import type { ImportReport } from './report';
import { attr, attrInt, child, children } from './xml';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseTiming(
  timingEl: Element | undefined,
  ctx: { spidToElementId: Map<string, string>; report: ImportReport },
): SlideAnimation[] {
  if (!timingEl) return [];

  const report = ctx.report;

  // Detect and drop media nodes anywhere in the timing tree.
  dropMediaNodes(timingEl, report);

  // Walk: tnLst > par > cTn(tmRoot) > childTnLst
  const tnLst = child(timingEl, 'tnLst');
  if (!tnLst) return [];
  const rootPar = child(tnLst, 'par');
  if (!rootPar) return [];
  const rootCTn = child(rootPar, 'cTn');
  if (!rootCTn) return [];
  const rootChildTnLst = child(rootCTn, 'childTnLst');
  if (!rootChildTnLst) return [];

  // Find mainSeq and interactiveSeq among seq children of rootChildTnLst.
  let mainSeqEl: Element | undefined;
  for (const seqEl of children(rootChildTnLst, 'seq')) {
    const cTn = child(seqEl, 'cTn');
    if (!cTn) continue;
    const nodeType = attr(cTn, 'nodeType');
    if (nodeType === 'mainSeq') {
      mainSeqEl = seqEl;
    } else if (nodeType === 'interactiveSeq') {
      report.animationTriggersDropped += 1;
    }
  }

  if (!mainSeqEl) return [];

  // mainSeq > cTn > childTnLst  contains the click-group pars.
  const mainCTn = child(mainSeqEl, 'cTn');
  if (!mainCTn) return [];
  const mainChildTnLst = child(mainCTn, 'childTnLst');
  if (!mainChildTnLst) return [];

  const result: SlideAnimation[] = [];

  // Each direct child par = one "click group".
  for (const clickGroupPar of children(mainChildTnLst, 'par')) {
    const clickGroupCTn = child(clickGroupPar, 'cTn');
    if (!clickGroupCTn) continue;
    const clickGroupChildTnLst = child(clickGroupCTn, 'childTnLst');
    if (!clickGroupChildTnLst) continue;

    // Each child par = one effect entry.
    let firstInGroup = true;
    for (const effectPar of children(clickGroupChildTnLst, 'par')) {
      const anim = parseEffectPar(effectPar, firstInGroup, ctx);
      if (anim !== null) {
        result.push(anim);
      }
      firstInGroup = false;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Drop audio/video nodes anywhere in the timing tree, bumping the counter. */
function dropMediaNodes(timingEl: Element, report: ImportReport): void {
  const allNodes = timingEl.getElementsByTagName('*');
  for (let i = 0; i < allNodes.length; i++) {
    const ln = allNodes[i].localName;
    if (ln === 'audio' || ln === 'video') {
      report.animationMediaDropped += 1;
    }
  }
}

/**
 * Parse one effect `<p:par>` and return a `SlideAnimation`, or `null` if
 * the target is unresolvable (missing spid) — in which case the counter is
 * bumped by this function.
 */
function parseEffectPar(
  effectPar: Element,
  isFirstInGroup: boolean,
  ctx: { spidToElementId: Map<string, string>; report: ImportReport },
): SlideAnimation | null {
  const report = ctx.report;
  const cTn = child(effectPar, 'cTn');
  if (!cTn) return null;

  // --- Preset attributes ---
  const presetClass = attr(cTn, 'presetClass') ?? '';
  const presetID = attrInt(cTn, 'presetID') ?? 0;
  const presetSubtype = attrInt(cTn, 'presetSubtype');
  const nodeType = attr(cTn, 'nodeType') ?? '';

  // --- Duration ---
  const durRaw = attr(cTn, 'dur');
  const durationMs =
    durRaw === 'indefinite' || durRaw === undefined ? 500 : (parseInt(durRaw, 10) || 500);

  // --- Easing ---
  const accel = attrInt(cTn, 'accel') ?? 0;
  const decel = attrInt(cTn, 'decel') ?? 0;
  let easing: AnimEasing | undefined;
  if (accel > 0 && decel > 0) {
    easing = 'easeInOut';
  } else if (accel > 0) {
    easing = 'easeIn';
  } else if (decel > 0) {
    easing = 'easeOut';
  } else {
    easing = 'linear';
  }

  // --- Start condition ---
  const start = resolveStart(cTn, nodeType, isFirstInGroup);

  // --- Delay ---
  const delayMs = resolveDelay(cTn);

  // --- Target element resolution ---
  // Scan descendants for spTgt.
  const spTgt = findSpTgt(effectPar);
  if (!spTgt) {
    report.animationTargetsMissing += 1;
    return null;
  }
  const spid = attr(spTgt, 'spid');
  if (!spid) {
    report.animationTargetsMissing += 1;
    return null;
  }
  const elementId = ctx.spidToElementId.get(spid);
  if (!elementId) {
    report.animationTargetsMissing += 1;
    return null;
  }

  // --- byParagraph ---
  const txEl = findTxEl(effectPar);
  const byParagraph = txEl ? hasParagraphBuild(txEl) : undefined;

  // --- motionPath (for animMotion) ---
  const motionPath = findMotionPath(effectPar);

  // --- Preset mapping ---
  const mapped = mapPreset(presetClass, presetID, presetSubtype);

  const id = generateId();

  if (mapped !== null) {
    // Known preset — build a full SlideAnimation.
    const anim: SlideAnimation = {
      id,
      elementId,
      category: mapped.category,
      effect: mapped.effect,
      start,
      durationMs,
    };
    if (mapped.direction !== undefined) anim.direction = mapped.direction;
    if (delayMs !== undefined && delayMs > 0) anim.delayMs = delayMs;
    if (easing !== undefined) anim.easing = easing;
    if (byParagraph) anim.byParagraph = true;
    if (motionPath !== undefined) anim.motionPath = motionPath;
    return anim;
  }

  // Unknown/unmapped preset — preserve for round-trip.
  report.animationPresetsUnmapped += 1;
  const category = fallbackCategory(presetClass);
  const anim: SlideAnimation = {
    id,
    elementId,
    category,
    effect: 'appear' as AnimEffect,
    start,
    durationMs,
    pptxPreset: {
      class: presetClass,
      id: presetID,
      ...(presetSubtype !== undefined && { subtype: presetSubtype }),
    },
  };
  if (delayMs !== undefined && delayMs > 0) anim.delayMs = delayMs;
  if (easing !== undefined) anim.easing = easing;
  if (byParagraph) anim.byParagraph = true;
  if (motionPath !== undefined) anim.motionPath = motionPath;
  return anim;
}

/**
 * Resolve the `AnimStart` value from a `<p:cTn>` node.
 *
 * Priority:
 *   1. `nodeType` attribute: clickEffect → onClick, withEffect → withPrev, afterEffect → afterPrev
 *   2. `<p:stCondLst><p:cond>` evt/delay attributes for fallback
 *   3. Default to onClick for the first in a click group, withPrev for subsequent
 */
function resolveStart(cTn: Element, nodeType: string, isFirstInGroup: boolean): AnimStart {
  if (nodeType === 'clickEffect') return 'onClick';
  if (nodeType === 'withEffect') return 'withPrev';
  if (nodeType === 'afterEffect') return 'afterPrev';

  // Inspect stCondLst for the condition.
  const stCondLst = child(cTn, 'stCondLst');
  if (stCondLst) {
    for (const cond of children(stCondLst, 'cond')) {
      const evt = attr(cond, 'evt');
      const delay = attr(cond, 'delay');
      if (evt === 'onNext' || delay === 'indefinite') return 'onClick';
      if (evt === 'onEnd') return 'afterPrev';
      if (delay === '0' && !evt) return 'withPrev';
      // delay=0 with no evt is also withPrev
      if (delay === '0') return 'withPrev';
    }
  }

  // Default fallback.
  return isFirstInGroup ? 'onClick' : 'withPrev';
}

/**
 * Extract the delay in ms from `<p:stCondLst><p:cond delay="N">`.
 * Returns undefined if absent or not a finite integer. "indefinite" → undefined.
 */
function resolveDelay(cTn: Element): number | undefined {
  const stCondLst = child(cTn, 'stCondLst');
  if (!stCondLst) return undefined;
  for (const cond of children(stCondLst, 'cond')) {
    const delay = attr(cond, 'delay');
    if (delay === undefined || delay === 'indefinite') continue;
    const ms = parseInt(delay, 10);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

/** Find the first `<p:spTgt>` descendant inside an effect par. */
function findSpTgt(effectPar: Element): Element | undefined {
  const all = effectPar.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 'spTgt') return all[i];
  }
  return undefined;
}

/** Find the first `<p:txEl>` descendant inside an effect par. */
function findTxEl(effectPar: Element): Element | undefined {
  const all = effectPar.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 'txEl') return all[i];
  }
  return undefined;
}

/**
 * True if the txEl element contains a `<p:pRg>` (paragraph range) or any
 * other build-by-paragraph indicator.
 */
function hasParagraphBuild(txEl: Element): boolean {
  const all = txEl.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const ln = all[i].localName;
    if (ln === 'pRg' || ln === 'whole') return true;
  }
  return false;
}

/** Find `<p:animMotion path>` in an effect par for motionPath preservation. */
function findMotionPath(effectPar: Element): string | undefined {
  const all = effectPar.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 'animMotion') {
      const p = attr(all[i], 'path');
      if (p !== undefined) return p;
    }
  }
  return undefined;
}

/** Best-guess `AnimCategory` from a presetClass string for unmapped presets. */
function fallbackCategory(presetClass: string): AnimCategory {
  if (presetClass === 'entr') return 'entrance';
  if (presetClass === 'exit') return 'exit';
  if (presetClass === 'emph') return 'emphasis';
  return 'entrance';
}
