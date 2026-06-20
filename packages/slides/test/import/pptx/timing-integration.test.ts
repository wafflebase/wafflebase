// @vitest-environment jsdom
/**
 * Integration test: verifies that spid→elementId resolution is wired
 * end-to-end through parseSlide. The shape parser populates ctx.idMap
 * (pptxId → generated element id), and parseSlide converts that to a
 * string-keyed map and passes it to parseTiming. The assertion is that
 * the animation's elementId matches the generated element id for the
 * shape with the given PPTX spid.
 */
import { describe, expect, it } from 'vitest';
import { parseSlide } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import type { PptxArchive } from '../../../src/import/pptx/unzip';

function makeArchive(files: Record<string, string>): PptxArchive {
  return {
    readText: async (path) => files[path],
    readBytes: async () => undefined,
    list: () => [],
  };
}

/**
 * A minimal slide XML with one shape (cNvPr id="3") and a <p:timing>
 * that references spid="3" for a fadeIn entrance animation.
 *
 * The shape has a valid xfrm+prstGeom so parseSpTree creates an element
 * with a generated id. parseTiming then resolves spid=3 → that element id.
 */
const SLIDE_WITH_SHAPE_AND_TIMING = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Shape1"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="100000" y="100000"/>
            <a:ext cx="2000000" cy="1000000"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:timing>
    <p:tnLst>
      <p:par>
        <p:cTn nodeType="tmRoot">
          <p:childTnLst>
            <p:seq>
              <p:cTn nodeType="mainSeq">
                <p:childTnLst>
                  <p:par>
                    <p:cTn>
                      <p:childTnLst>
                        <p:par>
                          <p:cTn nodeType="clickEffect" presetClass="entr" presetID="10" dur="500">
                            <p:stCondLst><p:cond evt="onNext" delay="indefinite"/></p:stCondLst>
                            <p:childTnLst>
                              <p:animEffect>
                                <p:cBhvr>
                                  <p:tgtEl>
                                    <p:spTgt spid="3"/>
                                  </p:tgtEl>
                                </p:cBhvr>
                              </p:animEffect>
                            </p:childTnLst>
                          </p:cTn>
                        </p:par>
                      </p:childTnLst>
                    </p:cTn>
                  </p:par>
                </p:childTnLst>
              </p:cTn>
            </p:seq>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
  </p:timing>
</p:sld>`;

describe('parseSlide — timing spid→elementId integration', () => {
  it('resolves animation spid=3 to the same elementId generated for the shape with cNvPr id=3', async () => {
    const report = new ImportReport();
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': SLIDE_WITH_SHAPE_AND_TIMING }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();

    // Shape element must be present with a generated id.
    expect(slide!.elements).toHaveLength(1);
    const shapeEl = slide!.elements[0];
    expect(shapeEl.type).toBe('shape');
    expect(shapeEl.id).toBeTruthy();

    // Animation must be attached to the slide and resolve to the same element id.
    expect(slide!.animations).toBeDefined();
    expect(slide!.animations).toHaveLength(1);
    const anim = slide!.animations![0];

    // The core assertion: spid=3 resolved to the element's generated id.
    expect(anim.elementId).toBe(shapeEl.id);

    // Spot-check the animation fields so we know timing parsing ran correctly.
    expect(anim.category).toBe('entrance');
    expect(anim.effect).toBe('fadeIn');
    expect(anim.start).toBe('onClick');
    expect(anim.durationMs).toBe(500);

    // No resolution failures.
    expect(report.animationTargetsMissing).toBe(0);
    expect(report.animationPresetsUnmapped).toBe(0);
  });

  it('leaves animations absent when <p:timing> is missing', async () => {
    const SLIDE_NO_TIMING = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="S"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': SLIDE_NO_TIMING }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    // animations field must be absent (not an empty array) when no timing present.
    expect(slide!.animations).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(slide!, 'animations')).toBe(false);
  });

  it('skips an animation targeting a spid not in the element map', async () => {
    // Timing references spid=99 which does not match any shape.
    const SLIDE_MISSING_TARGET = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="S"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:timing>
    <p:tnLst>
      <p:par>
        <p:cTn nodeType="tmRoot">
          <p:childTnLst>
            <p:seq>
              <p:cTn nodeType="mainSeq">
                <p:childTnLst>
                  <p:par>
                    <p:cTn>
                      <p:childTnLst>
                        <p:par>
                          <p:cTn nodeType="clickEffect" presetClass="entr" presetID="10" dur="500">
                            <p:stCondLst><p:cond evt="onNext" delay="indefinite"/></p:stCondLst>
                            <p:childTnLst>
                              <p:animEffect>
                                <p:cBhvr>
                                  <p:tgtEl><p:spTgt spid="99"/></p:tgtEl>
                                </p:cBhvr>
                              </p:animEffect>
                            </p:childTnLst>
                          </p:cTn>
                        </p:par>
                      </p:childTnLst>
                    </p:cTn>
                  </p:par>
                </p:childTnLst>
              </p:cTn>
            </p:seq>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
  </p:timing>
</p:sld>`;

    const report = new ImportReport();
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': SLIDE_MISSING_TARGET }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    // Unresolvable spid → animation is dropped, animations stays absent.
    expect(slide!.animations).toBeUndefined();
    expect(report.animationTargetsMissing).toBe(1);
  });
});
