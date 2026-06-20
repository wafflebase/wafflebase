// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTiming } from '../../../src/import/pptx/timing';
import { ImportReport } from '../../../src/import/pptx/report';
import { parseXml } from '../../../src/import/pptx/xml';

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

/**
 * Build a minimal <p:timing> element wrapping the given mainSeq content.
 *
 * Structure produced:
 *   <p:timing>
 *     <p:tnLst>
 *       <p:par>
 *         <p:cTn nodeType="tmRoot">
 *           <p:childTnLst>
 *             <p:seq>              ← nodeType="mainSeq"
 *               <p:cTn nodeType="mainSeq">
 *                 <p:childTnLst>
 *                   ${mainSeqContent}
 *                 </p:childTnLst>
 *               </p:cTn>
 *             </p:seq>
 *             ${extraSeqs}
 *           </p:childTnLst>
 *         </p:cTn>
 *       </p:par>
 *     </p:tnLst>
 *   </p:timing>
 */
function buildTiming(mainSeqContent: string, extraSeqs = ''): Element {
  const xml = `<p:timing ${P_NS}>
    <p:tnLst>
      <p:par>
        <p:cTn nodeType="tmRoot">
          <p:childTnLst>
            <p:seq>
              <p:cTn nodeType="mainSeq">
                <p:childTnLst>
                  ${mainSeqContent}
                </p:childTnLst>
              </p:cTn>
            </p:seq>
            ${extraSeqs}
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
  </p:timing>`;
  const doc = parseXml(xml);
  return doc.documentElement;
}

/**
 * Build one click-group par containing one effect par.
 * spid defaults to '3'; nodeType defaults to 'clickEffect'.
 */
function clickGroup(opts: {
  presetClass?: string;
  presetID?: number;
  presetSubtype?: number;
  nodeType?: string;
  dur?: string | number;
  delay?: string | number;
  spid?: string;
  accel?: number;
  decel?: number;
  withTxEl?: boolean;
  withMotionPath?: string;
}): string {
  const {
    presetClass = 'entr',
    presetID = 10,
    presetSubtype,
    nodeType = 'clickEffect',
    dur = 500,
    delay,
    spid = '3',
    accel,
    decel,
    withTxEl = false,
    withMotionPath,
  } = opts;

  const presetSubtypeAttr = presetSubtype !== undefined ? ` presetSubtype="${presetSubtype}"` : '';
  const accelAttr = accel !== undefined ? ` accel="${accel}"` : '';
  const decelAttr = decel !== undefined ? ` decel="${decel}"` : '';
  const delayAttr = delay !== undefined ? `delay="${delay}"` : 'delay="0"';
  const stCond =
    nodeType === 'clickEffect'
      ? `<p:stCondLst><p:cond evt="onNext" delay="indefinite"/></p:stCondLst>`
      : `<p:stCondLst><p:cond ${delayAttr}/></p:stCondLst>`;

  const txElContent = withTxEl
    ? `<p:txEl><p:pRg st="0" end="0"/></p:txEl>`
    : '';
  const animMotionContent = withMotionPath
    ? `<p:animMotion path="${withMotionPath}"><p:cBhvr><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animMotion>`
    : '';

  return `<p:par>
    <p:cTn>
      <p:childTnLst>
        <p:par>
          <p:cTn nodeType="${nodeType}" presetClass="${presetClass}" presetID="${presetID}"${presetSubtypeAttr} dur="${dur}"${accelAttr}${decelAttr}>
            ${stCond}
            <p:childTnLst>
              ${animMotionContent || `<p:animEffect>`}
              <p:cBhvr>
                <p:tgtEl>
                  <p:spTgt spid="${spid}">
                    ${txElContent}
                  </p:spTgt>
                </p:tgtEl>
              </p:cBhvr>
              ${animMotionContent ? '' : `</p:animEffect>`}
            </p:childTnLst>
          </p:cTn>
        </p:par>
      </p:childTnLst>
    </p:cTn>
  </p:par>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseTiming', () => {
  it('returns [] when timingEl is undefined', () => {
    const report = new ImportReport();
    const result = parseTiming(undefined, { spidToElementId: new Map(), report });
    expect(result).toEqual([]);
    expect(report.animationPresetsUnmapped).toBe(0);
    expect(report.animationTargetsMissing).toBe(0);
  });

  it('flattens a mapped entrance clickEffect → SlideAnimation with correct fields', () => {
    const timingEl = buildTiming(
      clickGroup({ presetClass: 'entr', presetID: 10, dur: 500, spid: '3' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims).toHaveLength(1);
    expect(anims[0]).toMatchObject({
      elementId: 'e3',
      category: 'entrance',
      effect: 'fadeIn',
      start: 'onClick',
      durationMs: 500,
    });
    expect(anims[0].id).toBeTruthy();
    expect(report.animationPresetsUnmapped).toBe(0);
    expect(report.animationTargetsMissing).toBe(0);
  });

  it('preserves an unmapped presetID and bumps animationPresetsUnmapped', () => {
    const timingEl = buildTiming(
      // presetID 9999 is not in the map
      clickGroup({ presetClass: 'entr', presetID: 9999, spid: '3' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims).toHaveLength(1);
    expect(anims[0].pptxPreset).toBeDefined();
    expect(anims[0].pptxPreset).toEqual({ class: 'entr', id: 9999 });
    expect(anims[0].effect).toBe('appear');
    expect(anims[0].category).toBe('entrance');
    expect(report.animationPresetsUnmapped).toBe(1);
  });

  it('bumps animationPresetsUnmapped counter for each unmapped effect', () => {
    const twoEffects = [
      clickGroup({ presetClass: 'entr', presetID: 9999, spid: '3' }),
      clickGroup({ presetClass: 'exit', presetID: 8888, spid: '3', nodeType: 'withEffect' }),
    ].join('\n');
    const timingEl = buildTiming(twoEffects);
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    parseTiming(timingEl, ctx);

    expect(report.animationPresetsUnmapped).toBe(2);
  });

  it('skips effects with unresolvable spid and bumps animationTargetsMissing', () => {
    const timingEl = buildTiming(
      // spid '99' is NOT in the map
      clickGroup({ spid: '99' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims).toHaveLength(0);
    expect(report.animationTargetsMissing).toBe(1);
  });

  it('drops interactiveSeq triggers and bumps animationTriggersDropped', () => {
    const interactiveSeq = `
      <p:seq>
        <p:cTn nodeType="interactiveSeq">
          <p:childTnLst/>
        </p:cTn>
      </p:seq>`;
    const timingEl = buildTiming('', interactiveSeq);
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map(), report };

    parseTiming(timingEl, ctx);

    expect(report.animationTriggersDropped).toBeGreaterThanOrEqual(1);
  });

  it('does not emit animations from interactiveSeq', () => {
    // mainSeq is empty; only interactiveSeq present.
    const interactiveSeq = `
      <p:seq>
        <p:cTn nodeType="interactiveSeq">
          <p:childTnLst>
            <p:par>
              <p:cTn>
                <p:childTnLst>
                  <p:par>
                    <p:cTn nodeType="clickEffect" presetClass="entr" presetID="10" dur="500">
                      <p:stCondLst><p:cond evt="onNext" delay="indefinite"/></p:stCondLst>
                      <p:childTnLst>
                        <p:animEffect>
                          <p:cBhvr><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr>
                        </p:animEffect>
                      </p:childTnLst>
                    </p:cTn>
                  </p:par>
                </p:childTnLst>
              </p:cTn>
            </p:par>
          </p:childTnLst>
        </p:cTn>
      </p:seq>`;
    const timingEl = buildTiming('', interactiveSeq);
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    // No animations from trigger sequences.
    expect(anims).toHaveLength(0);
  });

  it('maps exit fadeOut (exit:10) correctly', () => {
    const timingEl = buildTiming(
      clickGroup({ presetClass: 'exit', presetID: 10, spid: '5' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['5', 'e5']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims).toHaveLength(1);
    expect(anims[0]).toMatchObject({
      elementId: 'e5',
      category: 'exit',
      effect: 'fadeOut',
      start: 'onClick',
    });
  });

  it('maps flyIn (entr:2, subtype 4) → direction up', () => {
    const timingEl = buildTiming(
      clickGroup({ presetClass: 'entr', presetID: 2, presetSubtype: 4, spid: '3' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims[0]).toMatchObject({ effect: 'flyIn', direction: 'up' });
  });

  it('resolves withEffect nodeType → start withPrev', () => {
    // Two effects in one click group: first is onClick, second is withEffect.
    const twoEffects = [
      clickGroup({ spid: '3', nodeType: 'clickEffect', presetID: 10 }),
      clickGroup({ spid: '3', nodeType: 'withEffect', presetID: 10 }),
    ].join('\n');
    const timingEl = buildTiming(twoEffects);
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims).toHaveLength(2);
    expect(anims[0].start).toBe('onClick');
    expect(anims[1].start).toBe('withPrev');
  });

  it('resolves afterEffect nodeType → start afterPrev', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', nodeType: 'afterEffect', presetID: 10 }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims[0].start).toBe('afterPrev');
  });

  it('easing: accel+decel → easeInOut', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', accel: 10000, decel: 10000, presetID: 10 }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };

    const anims = parseTiming(timingEl, ctx);

    expect(anims[0].easing).toBe('easeInOut');
  });

  it('easing: accel only → easeIn', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', accel: 10000, presetID: 10 }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].easing).toBe('easeIn');
  });

  it('easing: decel only → easeOut', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', decel: 10000, presetID: 10 }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].easing).toBe('easeOut');
  });

  it('easing: neither accel nor decel → easing field absent (undefined)', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', presetID: 10 }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].easing).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(anims[0], 'easing')).toBe(false);
  });

  it('generates a unique id for each animation', () => {
    const twoEffects = [
      clickGroup({ spid: '3', nodeType: 'clickEffect', presetID: 10 }),
      clickGroup({ spid: '3', nodeType: 'withEffect', presetID: 10 }),
    ].join('\n');
    const timingEl = buildTiming(twoEffects);
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].id).not.toBe(anims[1].id);
  });

  it('pptxPreset includes subtype when present', () => {
    const timingEl = buildTiming(
      clickGroup({ presetClass: 'entr', presetID: 9999, presetSubtype: 4, spid: '3' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].pptxPreset).toEqual({ class: 'entr', id: 9999, subtype: 4 });
  });

  it('returns [] when timingEl has no mainSeq', () => {
    // A timing element with no seq at all.
    const xml = `<p:timing ${P_NS}><p:tnLst><p:par><p:cTn nodeType="tmRoot"><p:childTnLst/></p:cTn></p:par></p:tnLst></p:timing>`;
    const doc = parseXml(xml);
    const timingEl = doc.documentElement;
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map(), report };
    expect(parseTiming(timingEl, ctx)).toEqual([]);
  });

  it('handles indefinite dur → durationMs 500 fallback', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', presetID: 10, dur: 'indefinite' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].durationMs).toBe(500);
  });

  it('sets byParagraph true when txEl with pRg is present in spTgt', () => {
    const timingEl = buildTiming(
      clickGroup({ spid: '3', presetID: 10, withTxEl: true }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims[0].byParagraph).toBe(true);
  });

  it('unmapped animMotion effect preserves motionPath on SlideAnimation', () => {
    // presetID 9999 is unmapped; withMotionPath supplies a <p:animMotion path="..."> node
    const timingEl = buildTiming(
      clickGroup({ presetClass: 'entr', presetID: 9999, spid: '3', withMotionPath: 'M0,0 L1,1' }),
    );
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map([['3', 'e3']]), report };
    const anims = parseTiming(timingEl, ctx);
    expect(anims).toHaveLength(1);
    expect(anims[0].motionPath).toBe('M0,0 L1,1');
  });

  it('audio/video node in timing tree bumps animationMediaDropped', () => {
    // Wrap audio and video nodes inside the timing element's tree.
    const timingWithMedia = `<p:timing ${P_NS}>
      <p:tnLst>
        <p:par>
          <p:cTn nodeType="tmRoot">
            <p:childTnLst>
              <p:seq>
                <p:cTn nodeType="mainSeq">
                  <p:childTnLst/>
                </p:cTn>
              </p:seq>
              <p:audio/>
              <p:video/>
            </p:childTnLst>
          </p:cTn>
        </p:par>
      </p:tnLst>
    </p:timing>`;
    const doc = parseXml(timingWithMedia);
    const timingEl = doc.documentElement;
    const report = new ImportReport();
    const ctx = { spidToElementId: new Map<string, string>(), report };
    parseTiming(timingEl, ctx);
    expect(report.animationMediaDropped).toBe(2);
  });

  it('easing: no accel/decel → field absent; accel only → easeIn; decel only → easeOut; both → easeInOut', () => {
    const spidMap = new Map([['3', 'e3']]);

    // No accel/decel → easing absent
    const noEasingEl = buildTiming(clickGroup({ spid: '3', presetID: 10 }));
    const r0 = new ImportReport();
    const a0 = parseTiming(noEasingEl, { spidToElementId: spidMap, report: r0 });
    expect(a0[0].easing).toBeUndefined();

    // accel only → easeIn
    const accelOnlyEl = buildTiming(clickGroup({ spid: '3', presetID: 10, accel: 10000 }));
    const r1 = new ImportReport();
    const a1 = parseTiming(accelOnlyEl, { spidToElementId: spidMap, report: r1 });
    expect(a1[0].easing).toBe('easeIn');

    // decel only → easeOut
    const decelOnlyEl = buildTiming(clickGroup({ spid: '3', presetID: 10, decel: 10000 }));
    const r2 = new ImportReport();
    const a2 = parseTiming(decelOnlyEl, { spidToElementId: spidMap, report: r2 });
    expect(a2[0].easing).toBe('easeOut');

    // both → easeInOut
    const bothEl = buildTiming(clickGroup({ spid: '3', presetID: 10, accel: 10000, decel: 10000 }));
    const r3 = new ImportReport();
    const a3 = parseTiming(bothEl, { spidToElementId: spidMap, report: r3 });
    expect(a3[0].easing).toBe('easeInOut');
  });

  it('whole build does NOT set byParagraph; pRg build sets byParagraph true', () => {
    // Build a timing with <p:txEl><p:whole/></p:txEl> — should NOT set byParagraph.
    const wholeXml = `<p:par>
      <p:cTn>
        <p:childTnLst>
          <p:par>
            <p:cTn nodeType="clickEffect" presetClass="entr" presetID="10" dur="500">
              <p:stCondLst><p:cond evt="onNext" delay="indefinite"/></p:stCondLst>
              <p:childTnLst>
                <p:animEffect>
                  <p:cBhvr>
                    <p:tgtEl>
                      <p:spTgt spid="3">
                        <p:txEl><p:whole/></p:txEl>
                      </p:spTgt>
                    </p:tgtEl>
                  </p:cBhvr>
                </p:animEffect>
              </p:childTnLst>
            </p:cTn>
          </p:par>
        </p:childTnLst>
      </p:cTn>
    </p:par>`;
    const timingWholeEl = buildTiming(wholeXml);
    const spidMap = new Map([['3', 'e3']]);
    const rWhole = new ImportReport();
    const animsWhole = parseTiming(timingWholeEl, { spidToElementId: spidMap, report: rWhole });
    expect(animsWhole).toHaveLength(1);
    expect(animsWhole[0].byParagraph).toBeFalsy();

    // pRg build (existing withTxEl helper) → byParagraph true
    const timingPRgEl = buildTiming(clickGroup({ spid: '3', presetID: 10, withTxEl: true }));
    const rPRg = new ImportReport();
    const animsPRg = parseTiming(timingPRgEl, { spidToElementId: spidMap, report: rPRg });
    expect(animsPRg[0].byParagraph).toBe(true);
  });

  it('summary() reports animation counters when non-zero', () => {
    const report = new ImportReport();
    report.animationPresetsUnmapped = 2;
    report.animationTargetsMissing = 1;
    report.animationTriggersDropped = 3;
    report.animationMediaDropped = 1;
    const summary = report.summary();
    expect(summary).toContain('2 animation preset(s) unmapped');
    expect(summary).toContain('1 animation target(s) missing');
    expect(summary).toContain('3 animation trigger(s) dropped');
    expect(summary).toContain('1 animation media node(s) dropped');
  });
});
