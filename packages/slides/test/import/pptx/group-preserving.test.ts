// @vitest-environment jsdom
/**
 * Tests for PPTX group-preserving import (Task 14).
 *
 * `<p:grpSp>` is now imported as a `GroupElement` rather than being
 * flattened. Children are stored in group-local coordinates
 * `(0..group.frame.w × 0..group.frame.h)`.
 *
 * The bbox-equivalence invariant: the world frames of leaves computed
 * by walking the preserved group tree must match the world frames that
 * the old flattening path would have produced, within sub-pixel
 * tolerance.
 */
import { describe, expect, it } from 'vitest';
import { parseSpTree } from '../../../src/import/pptx/shape';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { SlideParseContext } from '../../../src/import/pptx/shape';
import { applyGroupTransform } from '../../../src/model/group';
import type { GroupElement, Element as SlideElement, Frame } from '../../../src/model/element';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function spTree(xml: string): Element {
  return parseXml(
    `<p:spTree xmlns:p="${P}" xmlns:a="${A}">${xml}</p:spTree>`,
  ).documentElement;
}

function makeCtx(report = new ImportReport()): SlideParseContext {
  return {
    archive: { readText: async () => undefined, readBytes: async () => undefined, list: () => [] },
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map(),
    scale: SCALE,
    report,
    idMap: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

/**
 * Recursively collect all leaf frames (non-group elements) from an
 * element tree, computing world frames by chaining group transforms
 * up the ancestor path.
 */
function collectLeafWorldFrames(
  elements: SlideElement[],
  ancestors: GroupElement[] = [],
): Frame[] {
  const frames: Frame[] = [];
  for (const el of elements) {
    if (el.type === 'group') {
      // Recurse into children with this group added as an ancestor.
      frames.push(...collectLeafWorldFrames(el.data.children, [...ancestors, el]));
    } else {
      // Start from the element's local frame and apply ancestor transforms.
      let frame = el.frame;
      for (const ancestor of ancestors) {
        frame = applyGroupTransform(frame, ancestor);
      }
      frames.push(frame);
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Fixture 1: flat group — single rect inside a group with chOff translation
// ---------------------------------------------------------------------------
const FLAT_GROUP_SPREE = `
  <p:grpSp>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="2400000" y="1200000"/>
        <a:ext cx="4800000" cy="2400000"/>
        <a:chOff x="2400000" y="1200000"/>
        <a:chExt cx="4800000" cy="2400000"/>
      </a:xfrm>
    </p:grpSpPr>
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="2" name="rect1"/>
        <p:cNvSpPr/><p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="2800000" y="1600000"/>
          <a:ext cx="2000000" cy="1200000"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  </p:grpSp>`;

// The expected world frame for the rect, computed manually:
//   The group has chOff == off, chExt == ext → identity scaling.
//   Child off (2800000, 1600000), ext (2000000, 1200000) is already in
//   "world" coords since chOff matches off and scale is 1.
const FLAT_GROUP_EXPECTED_WORLD = {
  x: 2800000 * SCALE.sx,
  y: 1600000 * SCALE.sy,
  w: 2000000 * SCALE.sx,
  h: 1200000 * SCALE.sy,
};

describe('parseSpTree — group preservation', () => {
  it('produces a GroupElement (not flat elements) for a <p:grpSp>', async () => {
    const tree = spTree(FLAT_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    expect(elements).toHaveLength(1);
    const group = elements[0];
    expect(group.type).toBe('group');
    if (group.type !== 'group') return;
    expect(group.data.children).toHaveLength(1);
    expect(group.data.children[0].type).toBe('shape');
  });

  it('stores children in group-local coordinates (not slide-root world)', async () => {
    const tree = spTree(FLAT_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());
    const group = elements[0] as GroupElement;

    const child = group.data.children[0];
    // The group frame is the group's own xfrm in world space.
    const gf = group.frame;
    expect(gf.x).toBeCloseTo(2400000 * SCALE.sx, 5);
    expect(gf.y).toBeCloseTo(1200000 * SCALE.sy, 5);
    expect(gf.w).toBeCloseTo(4800000 * SCALE.sx, 5);
    expect(gf.h).toBeCloseTo(2400000 * SCALE.sy, 5);

    // The child's local frame must be inside (0..gf.w × 0..gf.h).
    const cf = child.frame;
    expect(cf.x).toBeGreaterThanOrEqual(-1); // allow sub-pixel rounding
    expect(cf.y).toBeGreaterThanOrEqual(-1);
    expect(cf.x + cf.w).toBeLessThanOrEqual(gf.w + 1);
    expect(cf.y + cf.h).toBeLessThanOrEqual(gf.h + 1);
  });

  it('bbox-equivalence: leaf world frames match old-flat-path world frames', async () => {
    const tree = spTree(FLAT_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const worldFrames = collectLeafWorldFrames(elements);
    expect(worldFrames).toHaveLength(1);
    const wf = worldFrames[0];

    expect(wf.x).toBeCloseTo(FLAT_GROUP_EXPECTED_WORLD.x, 3);
    expect(wf.y).toBeCloseTo(FLAT_GROUP_EXPECTED_WORLD.y, 3);
    expect(wf.w).toBeCloseTo(FLAT_GROUP_EXPECTED_WORLD.w, 3);
    expect(wf.h).toBeCloseTo(FLAT_GROUP_EXPECTED_WORLD.h, 3);
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: scaled group — chExt differs from ext (2× scale down)
// ---------------------------------------------------------------------------
const SCALED_GROUP_SPREE = `
  <p:grpSp>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="1000000" cy="1000000"/>
        <a:chOff x="0" y="0"/>
        <a:chExt cx="2000000" cy="2000000"/>
      </a:xfrm>
    </p:grpSpPr>
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="3" name="scaled-rect"/>
        <p:cNvSpPr/><p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="1000000" y="500000"/>
          <a:ext cx="400000" cy="400000"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  </p:grpSp>`;

// Scale factor: ext/chExt = 0.5 on both axes.
// World: x = 1000000 * 0.5 = 500000, y = 500000 * 0.5 = 250000
//        w = 400000 * 0.5 = 200000, h = 400000 * 0.5 = 200000 (px after SCALE)
const SCALED_GROUP_EXPECTED_WORLD = {
  x: 500000 * SCALE.sx,
  y: 250000 * SCALE.sy,
  w: 200000 * SCALE.sx,
  h: 200000 * SCALE.sy,
};

describe('parseSpTree — scaled group bbox-equivalence', () => {
  it('bbox-equivalence: scaled group child world frames match manually computed values', async () => {
    const tree = spTree(SCALED_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    expect(elements[0].type).toBe('group');
    const worldFrames = collectLeafWorldFrames(elements);
    expect(worldFrames).toHaveLength(1);
    const wf = worldFrames[0];

    expect(wf.x).toBeCloseTo(SCALED_GROUP_EXPECTED_WORLD.x, 3);
    expect(wf.y).toBeCloseTo(SCALED_GROUP_EXPECTED_WORLD.y, 3);
    expect(wf.w).toBeCloseTo(SCALED_GROUP_EXPECTED_WORLD.w, 3);
    expect(wf.h).toBeCloseTo(SCALED_GROUP_EXPECTED_WORLD.h, 3);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3: nested groups
// ---------------------------------------------------------------------------
const NESTED_GROUP_SPREE = `
  <p:grpSp>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="1000000" y="1000000"/>
        <a:ext cx="4000000" cy="2000000"/>
        <a:chOff x="1000000" y="1000000"/>
        <a:chExt cx="4000000" cy="2000000"/>
      </a:xfrm>
    </p:grpSpPr>
    <p:grpSp>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="2000000" y="1500000"/>
          <a:ext cx="1000000" cy="500000"/>
          <a:chOff x="2000000" y="1500000"/>
          <a:chExt cx="1000000" cy="500000"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="4" name="inner-rect"/>
          <p:cNvSpPr/><p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="2100000" y="1550000"/>
            <a:ext cx="800000" cy="400000"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    </p:grpSp>
  </p:grpSp>`;

// Both groups have chOff == off and chExt == ext → both are identity-scale.
// The inner rect (2100000, 1550000, 800000×400000) is in world-px coords
// (no scaling since chExt == ext at both levels).
const NESTED_EXPECTED_WORLD = {
  x: 2100000 * SCALE.sx,
  y: 1550000 * SCALE.sy,
  w: 800000 * SCALE.sx,
  h: 400000 * SCALE.sy,
};

describe('parseSpTree — nested group preservation', () => {
  it('produces a nested GroupElement structure (outer group → inner group → leaf)', async () => {
    const tree = spTree(NESTED_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    expect(elements).toHaveLength(1);
    const outer = elements[0];
    expect(outer.type).toBe('group');
    if (outer.type !== 'group') return;

    // Outer group has one child: the inner group.
    expect(outer.data.children).toHaveLength(1);
    const inner = outer.data.children[0];
    expect(inner.type).toBe('group');
    if (inner.type !== 'group') return;

    // Inner group has one child: the leaf rect.
    expect(inner.data.children).toHaveLength(1);
    expect(inner.data.children[0].type).toBe('shape');
  });

  it('bbox-equivalence: nested group leaf world frames match manually computed values', async () => {
    const tree = spTree(NESTED_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const worldFrames = collectLeafWorldFrames(elements);
    expect(worldFrames).toHaveLength(1);
    const wf = worldFrames[0];

    expect(wf.x).toBeCloseTo(NESTED_EXPECTED_WORLD.x, 3);
    expect(wf.y).toBeCloseTo(NESTED_EXPECTED_WORLD.y, 3);
    expect(wf.w).toBeCloseTo(NESTED_EXPECTED_WORLD.w, 3);
    expect(wf.h).toBeCloseTo(NESTED_EXPECTED_WORLD.h, 3);
  });

  it('inner group children are in inner-group-local coords (not outer-group-local)', async () => {
    const tree = spTree(NESTED_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const outer = elements[0] as GroupElement;
    const inner = outer.data.children[0] as GroupElement;
    const leaf = inner.data.children[0];

    // The inner group's frame is in outer-group-local coords.
    const igf = inner.frame;
    // The leaf's frame is in inner-group-local coords.
    const lf = leaf.frame;
    expect(lf.x).toBeGreaterThanOrEqual(-1);
    expect(lf.y).toBeGreaterThanOrEqual(-1);
    expect(lf.x + lf.w).toBeLessThanOrEqual(igf.w + 1);
    expect(lf.y + lf.h).toBeLessThanOrEqual(igf.h + 1);
  });
});

// ---------------------------------------------------------------------------
// Fixture 4: connector with free endpoints inside a group
// ---------------------------------------------------------------------------
const CONNECTOR_IN_GROUP_SPREE = `
  <p:grpSp>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="1000000" y="1000000"/>
        <a:ext cx="4000000" cy="2000000"/>
        <a:chOff x="1000000" y="1000000"/>
        <a:chExt cx="4000000" cy="2000000"/>
      </a:xfrm>
    </p:grpSpPr>
    <p:cxnSp>
      <p:nvCxnSpPr>
        <p:cNvPr id="5" name="cxn1"/>
        <p:cNvCxnSpPr/>
        <p:nvPr/>
      </p:nvCxnSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="1200000" y="1100000"/>
          <a:ext cx="2000000" cy="1000000"/>
        </a:xfrm>
        <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:cxnSp>
  </p:grpSp>`;

describe('parseSpTree — connector with free endpoints inside group', () => {
  it('connector is preserved inside GroupElement', async () => {
    const tree = spTree(CONNECTOR_IN_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    expect(elements).toHaveLength(1);
    const group = elements[0];
    expect(group.type).toBe('group');
    if (group.type !== 'group') return;

    expect(group.data.children).toHaveLength(1);
    const cxn = group.data.children[0];
    expect(cxn.type).toBe('connector');
  });

  it('connector free endpoint is in group-local coordinates', async () => {
    const tree = spTree(CONNECTOR_IN_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const group = elements[0] as GroupElement;
    const gf = group.frame;
    const cxn = group.data.children[0];
    if (cxn.type !== 'connector') return;

    // free endpoints must be within the group's local bounds (0..w × 0..h).
    if (cxn.start.kind === 'free') {
      expect(cxn.start.x).toBeGreaterThanOrEqual(-1);
      expect(cxn.start.y).toBeGreaterThanOrEqual(-1);
      expect(cxn.start.x).toBeLessThanOrEqual(gf.w + 1);
      expect(cxn.start.y).toBeLessThanOrEqual(gf.h + 1);
    }
    if (cxn.end.kind === 'free') {
      expect(cxn.end.x).toBeGreaterThanOrEqual(-1);
      expect(cxn.end.y).toBeGreaterThanOrEqual(-1);
      expect(cxn.end.x).toBeLessThanOrEqual(gf.w + 1);
      expect(cxn.end.y).toBeLessThanOrEqual(gf.h + 1);
    }
  });

  it('bbox-equivalence: connector world frame matches expected flat-import position', async () => {
    const tree = spTree(CONNECTOR_IN_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const worldFrames = collectLeafWorldFrames(elements);
    expect(worldFrames).toHaveLength(1);
    const wf = worldFrames[0];

    // The group has identity scaling (chOff == off, chExt == ext), so the
    // connector's world frame equals its raw xfrm (same as flat import).
    expect(wf.x).toBeCloseTo(1200000 * SCALE.sx, 3);
    expect(wf.y).toBeCloseTo(1100000 * SCALE.sy, 3);
    expect(wf.w).toBeCloseTo(2000000 * SCALE.sx, 3);
    expect(wf.h).toBeCloseTo(1000000 * SCALE.sy, 3);
  });
});

// ---------------------------------------------------------------------------
// Fixture 5: group with rotation
// ---------------------------------------------------------------------------
const ROTATED_GROUP_SPREE = `
  <p:grpSp>
    <p:grpSpPr>
      <a:xfrm rot="5400000">
        <a:off x="900" y="900"/>
        <a:ext cx="200" cy="200"/>
        <a:chOff x="900" y="900"/>
        <a:chExt cx="200" cy="200"/>
      </a:xfrm>
    </p:grpSpPr>
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="6" name="rotated-child"/>
        <p:cNvSpPr/><p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="1050" y="990"/>
          <a:ext cx="20" cy="20"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  </p:grpSp>`;

describe('parseSpTree — rotated group preservation', () => {
  it('produces a GroupElement with correct rotation on the group frame', async () => {
    const tree = spTree(ROTATED_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    expect(elements[0].type).toBe('group');
    const group = elements[0] as GroupElement;
    expect(group.frame.rotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it('bbox-equivalence: rotated group child world frame center matches expected', async () => {
    const tree = spTree(ROTATED_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const worldFrames = collectLeafWorldFrames(elements);
    expect(worldFrames).toHaveLength(1);
    const wf = worldFrames[0];

    // The child is at local (1050, 990), center (1060, 1000) in the
    // 900..1100 × 900..1100 chOff/chExt space (identity scale since
    // chExt == ext). After the group's 90° rotation around (1000, 1000):
    //   center (1060, 1000) → world (1000, 1060).
    expect(wf.x + wf.w / 2).toBeCloseTo(1000 * SCALE.sx, 3);
    expect(wf.y + wf.h / 2).toBeCloseTo(1060 * SCALE.sy, 3);
  });
});

// ---------------------------------------------------------------------------
// Fixture 6: multiple children in one group
// ---------------------------------------------------------------------------
const MULTI_CHILD_GROUP_SPREE = `
  <p:grpSp>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="6000000" cy="3000000"/>
        <a:chOff x="0" y="0"/>
        <a:chExt cx="6000000" cy="3000000"/>
      </a:xfrm>
    </p:grpSpPr>
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="7" name="child-a"/>
        <p:cNvSpPr/><p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="500000" y="500000"/>
          <a:ext cx="1000000" cy="1000000"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="8" name="child-b"/>
        <p:cNvSpPr/><p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="3000000" y="1000000"/>
          <a:ext cx="2000000" cy="1500000"/>
        </a:xfrm>
        <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  </p:grpSp>`;

describe('parseSpTree — group with multiple children', () => {
  it('preserves all children in the GroupElement', async () => {
    const tree = spTree(MULTI_CHILD_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    expect(elements).toHaveLength(1);
    const group = elements[0] as GroupElement;
    expect(group.type).toBe('group');
    expect(group.data.children).toHaveLength(2);
  });

  it('bbox-equivalence: all leaf world frames match expected values', async () => {
    const tree = spTree(MULTI_CHILD_GROUP_SPREE);
    const elements = await parseSpTree(tree, makeCtx());

    const worldFrames = collectLeafWorldFrames(elements);
    expect(worldFrames).toHaveLength(2);

    // child-a: identity scale group, so world == xfrm
    expect(worldFrames[0].x).toBeCloseTo(500000 * SCALE.sx, 3);
    expect(worldFrames[0].y).toBeCloseTo(500000 * SCALE.sy, 3);
    expect(worldFrames[0].w).toBeCloseTo(1000000 * SCALE.sx, 3);
    expect(worldFrames[0].h).toBeCloseTo(1000000 * SCALE.sy, 3);

    // child-b
    expect(worldFrames[1].x).toBeCloseTo(3000000 * SCALE.sx, 3);
    expect(worldFrames[1].y).toBeCloseTo(1000000 * SCALE.sy, 3);
    expect(worldFrames[1].w).toBeCloseTo(2000000 * SCALE.sx, 3);
    expect(worldFrames[1].h).toBeCloseTo(1500000 * SCALE.sy, 3);
  });
});
