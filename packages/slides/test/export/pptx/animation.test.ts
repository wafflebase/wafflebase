import { describe, it, expect } from 'vitest';
import { transitionToXml, animationsToTimingXml } from '../../../src/export/pptx/animation.js';
import type { SlideAnimation, SlideTransition } from '../../../src/model/presentation.js';

// ---------------------------------------------------------------------------
// transitionToXml
// ---------------------------------------------------------------------------

describe('transitionToXml', () => {
  it('emits a <p:transition> element', () => {
    const t: SlideTransition = { type: 'fade', durationMs: 500 };
    const xml = transitionToXml(t);
    expect(xml).toContain('<p:transition');
    expect(xml).toContain('</p:transition>');
  });

  it('emits <p:fade/> child for fade type', () => {
    const xml = transitionToXml({ type: 'fade', durationMs: 500 });
    expect(xml).toContain('<p:fade/>');
  });

  it('emits <p:cut/> for none type', () => {
    const xml = transitionToXml({ type: 'none', durationMs: 500 });
    expect(xml).toContain('<p:cut/>');
  });

  it('emits <p:wipe/> for wipe type', () => {
    const xml = transitionToXml({ type: 'wipe', durationMs: 500 });
    expect(xml).toContain('<p:wipe');
  });

  it('includes direction for push/wipe', () => {
    const xml = transitionToXml({ type: 'push', durationMs: 500, direction: 'left' });
    expect(xml).toContain('dir="l"');
  });

  it('encodes slow duration as spd="slow"', () => {
    const xml = transitionToXml({ type: 'fade', durationMs: 1000 });
    expect(xml).toContain('spd="slow"');
  });

  it('encodes fast duration as spd="fast"', () => {
    const xml = transitionToXml({ type: 'fade', durationMs: 250 });
    expect(xml).toContain('spd="fast"');
  });

  it('omits spd attribute for default med (500ms)', () => {
    // med is the OOXML default — omitting it keeps the output compact
    const xml = transitionToXml({ type: 'fade', durationMs: 500 });
    expect(xml).not.toContain('spd=');
  });

  it('emits <p:dissolve/> for dissolve type', () => {
    const xml = transitionToXml({ type: 'dissolve', durationMs: 500 });
    expect(xml).toContain('<p:dissolve/>');
  });

  it('emits <p:cube/> for cube type', () => {
    const xml = transitionToXml({ type: 'cube', durationMs: 500 });
    expect(xml).toContain('<p:cube/>');
  });

  it('emits <p:flip/> for flip type', () => {
    const xml = transitionToXml({ type: 'flip', durationMs: 500 });
    expect(xml).toContain('<p:flip/>');
  });

  it('approximates slide type to <p:push>', () => {
    // 'slide' has no single OOXML tag; push is the closest directional effect
    const xml = transitionToXml({ type: 'slide', durationMs: 500 });
    expect(xml).toContain('<p:push');
  });

  it('includes direction for wipe right', () => {
    const xml = transitionToXml({ type: 'wipe', durationMs: 500, direction: 'right' });
    expect(xml).toContain('dir="r"');
  });
});

// ---------------------------------------------------------------------------
// animationsToTimingXml
// ---------------------------------------------------------------------------

describe('animationsToTimingXml', () => {
  it('returns empty string for no animations', () => {
    expect(animationsToTimingXml([])).toBe('');
  });

  it('emits <p:timing> for a single animation', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 2]]));
    expect(xml).toContain('<p:timing>');
    expect(xml).toContain('</p:timing>');
  });

  it('includes tnLst and the tmRoot par', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'fadeIn',
      start: 'onClick',
      durationMs: 400,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 3]]));
    expect(xml).toContain('<p:tnLst>');
    expect(xml).toContain('nodeType="tmRoot"');
    expect(xml).toContain('nodeType="mainSeq"');
  });

  it('emits spTgt with the correct spid', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'el-abc',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
    };
    const xml = animationsToTimingXml([anim], new Map([['el-abc', 42]]));
    expect(xml).toContain('spid="42"');
  });

  it('skips animations whose element is not in the spid map', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'missing',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
    };
    // missing element → empty result
    expect(animationsToTimingXml([anim], new Map())).toBe('');
  });

  it('emits nodeType="clickEffect" for onClick', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 2]]));
    expect(xml).toContain('nodeType="clickEffect"');
  });

  it('emits nodeType="withEffect" for withPrev', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'withPrev',
      durationMs: 500,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 2]]));
    expect(xml).toContain('nodeType="withEffect"');
  });

  it('emits nodeType="afterEffect" for afterPrev', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'afterPrev',
      durationMs: 500,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 2]]));
    expect(xml).toContain('nodeType="afterEffect"');
  });

  it('emits correct presetClass and presetID for known effect (flyIn)', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'flyIn',
      start: 'onClick',
      durationMs: 500,
      direction: 'left',
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 5]]));
    expect(xml).toContain('presetClass="entr"');
    expect(xml).toContain('presetID="2"');
    // direction 'left' → subtype 2
    expect(xml).toContain('presetSubtype="2"');
  });

  it('round-trips a preserved pptxPreset (unknown preset)', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',  // fallback effect for unmapped presets
      start: 'onClick',
      durationMs: 600,
      pptxPreset: { class: 'entr', id: 99, subtype: 7 },
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 10]]));
    // Should write back the preserved preset class/id/subtype
    expect(xml).toContain('presetClass="entr"');
    expect(xml).toContain('presetID="99"');
    expect(xml).toContain('presetSubtype="7"');
  });

  it('emits motionPath in animMotion element', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 1000,
      motionPath: 'M 0 0 L 1 1 Z',
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 7]]));
    expect(xml).toContain('<p:animMotion');
    expect(xml).toContain('path="M 0 0 L 1 1 Z"');
  });

  it('emits pRg txEl when byParagraph is true', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'fadeIn',
      start: 'onClick',
      durationMs: 500,
      byParagraph: true,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 4]]));
    expect(xml).toContain('<p:pRg');
    expect(xml).toContain('<p:txEl>');
  });

  it('emits dur attribute with animation duration', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'exit',
      effect: 'fadeOut',
      start: 'onClick',
      durationMs: 800,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 6]]));
    expect(xml).toContain('dur="800"');
  });

  it('groups onClick animations into separate click groups', () => {
    const anims: SlideAnimation[] = [
      { id: 'a1', elementId: 'e1', category: 'entrance', effect: 'appear', start: 'onClick', durationMs: 500 },
      { id: 'a2', elementId: 'e2', category: 'entrance', effect: 'fadeIn', start: 'onClick', durationMs: 500 },
    ];
    const xml = animationsToTimingXml(anims, new Map([['e1', 1], ['e2', 2]]));
    // Two click groups → two par blocks inside mainSeq's childTnLst
    // Just verify both spids appear
    expect(xml).toContain('spid="1"');
    expect(xml).toContain('spid="2"');
  });

  it('works without elementIdToSpid map (zero-arg guard)', () => {
    // Providing no map skips all animations → ''
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
    };
    expect(animationsToTimingXml([anim])).toBe('');
  });

  it('escapes special chars in motionPath attribute', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 1000,
      motionPath: 'M 0 0 L 1&1 Z "end"',
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 7]]));
    expect(xml).toContain('path="M 0 0 L 1&amp;1 Z &quot;end&quot;"');
    expect(xml).not.toContain('path="M 0 0 L 1&1 Z "end""');
  });

  it('emits exactly one delay attribute with correct value when delayMs set', () => {
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
      delayMs: 500,
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 2]]));
    // Must contain delay="500" and must NOT also emit delay="0"
    expect(xml).toContain('delay="500"');
    expect((xml.match(/delay=/g) ?? []).length).toBe(1);
  });

  it('escapes special chars in pptxPreset.class attribute', () => {
    // pptxPreset.class may contain arbitrary strings from an imported PPTX;
    // ensure they are XML-attribute-escaped.
    const anim: SlideAnimation = {
      id: 'a1',
      elementId: 'e1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 500,
      pptxPreset: { class: 'entr"&bad', id: 1, subtype: 0 },
    };
    const xml = animationsToTimingXml([anim], new Map([['e1', 2]]));
    // Raw " and & must not appear inside the attribute value
    expect(xml).toContain('presetClass="entr&quot;&amp;bad"');
    expect(xml).not.toContain('presetClass="entr"&bad"');
  });
});
