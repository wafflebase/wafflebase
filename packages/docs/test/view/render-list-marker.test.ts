// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderListMarker } from '../../src/view/paint-layout';
import type { Block } from '../../src/model/types';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types';

interface FontCall {
  font?: string;
  fillStyle?: string;
  text?: string;
}

/**
 * Stand-in for `CanvasRenderingContext2D` that records the font /
 * fillStyle / fillText calls `renderListMarker` makes. Avoids depending
 * on jsdom's partial Canvas implementation (which lacks fillText) and
 * keeps the assertion surface tight — we only care which axes the
 * renderer picked up.
 */
function makeRecordingCtx(): {
  ctx: CanvasRenderingContext2D;
  calls: FontCall[];
} {
  const calls: FontCall[] = [];
  let pendingFont: string | undefined;
  let pendingFill: string | undefined;
  const ctx = {
    set font(v: string) { pendingFont = v; },
    get font() { return pendingFont ?? ''; },
    set fillStyle(v: string) { pendingFill = v; },
    get fillStyle() { return pendingFill ?? ''; },
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillText(text: string) {
      calls.push({ font: pendingFont, fillStyle: pendingFill, text });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function listItem(opts: {
  marker?: Block['marker'];
  inline?: Partial<Block['inlines'][number]['style']>;
}): Block {
  return {
    id: 'b1',
    type: 'list-item',
    inlines: [{ text: 'x', style: opts.inline ?? {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
    listKind: 'unordered',
    listLevel: 0,
    ...(opts.marker ? { marker: opts.marker } : {}),
  };
}

describe('renderListMarker', () => {
  it('uses block.marker for fontSize, fontFamily, and color when set', () => {
    const { ctx, calls } = makeRecordingCtx();
    const block = listItem({
      marker: { fontSize: 18, fontFamily: 'Arial', color: '#FF9900' },
      inline: { fontSize: 11, fontFamily: 'Noto Sans KR', color: '#000000' },
    });
    renderListMarker(ctx, block, 0, 24, 10, '●');
    expect(calls).toHaveLength(1);
    // buildFont now routes the family through resolveFontFamily, which
    // splices a Korean-capable fallback before the trailing generic so
    // Hangul markers render correctly even with a Latin face.
    expect(calls[0].font).toBe("24px 'Arial', 'Noto Sans KR', sans-serif");
    expect(calls[0].fillStyle).toBe('#FF9900');
    expect(calls[0].text).toBe('●');
  });

  it('falls back to inlines[0].style when block.marker is undefined', () => {
    const { ctx, calls } = makeRecordingCtx();
    const block = listItem({
      inline: { fontSize: 18, fontFamily: 'Noto Sans KR', color: '#1155cc' },
    });
    renderListMarker(ctx, block, 0, 24, 10, '●');
    // Noto Sans KR is itself Korean-capable; resolveFontFamily must NOT
    // double-append it. The chain ends in the generic sans-serif token.
    expect(calls[0].font).toBe("24px 'Noto Sans KR', sans-serif");
    expect(calls[0].fillStyle).toBe('#1155cc');
  });

  it('fills missing marker axes from the first inline (color only)', () => {
    const { ctx, calls } = makeRecordingCtx();
    const block = listItem({
      marker: { color: '#FF9900' },
      inline: { fontSize: 20, fontFamily: 'Arial' },
    });
    renderListMarker(ctx, block, 0, 24, 10, '●');
    // pt → px: 20 * 96 / 72 = 26.6666… → "26.666…px '<family chain>'"
    expect(calls[0].font).toMatch(
      /^\d+(?:\.\d+)?px 'Arial', 'Noto Sans KR', sans-serif$/,
    );
    expect(calls[0].fillStyle).toBe('#FF9900');
  });
});
