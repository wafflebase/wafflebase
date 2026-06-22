# Slides PPTX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node-safe PPTX (OOXML) writer for `@wafflebase/slides` — the inverse of the existing PPTX importer — and wire it to a `wafflebase slides export` CLI command, achieving a model-equivalence round-trip.

**Architecture:** String-interpolated DrawingML + `jszip`, no DOM/Canvas, mirroring the docs `DocxExporter`. New `packages/slides/src/export/pptx/` directory with one module per concern (inverse of `src/import/pptx/`). Exposed from `@wafflebase/slides/node`; CLI wraps it like `docs export`.

**Tech Stack:** TypeScript, `jszip` ^3.10.1 (already a slides dep), Vitest. Reuses `@wafflebase/docs` `Block`/`Inline` types.

**Design doc:** `docs/design/slides/slides-pptx-export.md`

## Global Constraints

- **No DOM/Canvas** in any exporter module — only `jszip` + string building. Every symbol re-exported from `src/node.ts` must be DOM-free (audit transitive imports).
- **Slide canvas:** `SLIDE_WIDTH = 1920`, `SLIDE_HEIGHT = 1080` (px). Default widescreen EMU: `{ cx: 12_192_000, cy: 6_858_000 }`. `EMU_PER_INCH = 914_400`.
- **Round-trip bar:** `import → export → re-import` deep-equals the first import under `normalize()` (strips generated ids, sorts order-insensitive collections, excludes render-derived + documented importer-lossy fields).
- **ShapeKind → OOXML prst:** identity string mapping except `'pentagonArrow'` → `'homePlate'`. Validate with `PATH_BUILDERS.has(kind)`.
- **XML escaping:** text nodes escape `& < >`; attributes additionally escape `" '`.
- **Commits:** `pnpm --filter @wafflebase/slides test` green before each commit; subject ≤70 chars, body explains why; end with the Co-Authored-By trailer.
- **Naming:** files kebab-case, types PascalCase, functions camelCase. English only.

---

## File Structure

```text
packages/slides/src/export/pptx/
  xml.ts          escapeXmlText, escapeXmlAttr, attr(), tag helpers
  units.ts        pxToEmuX/Y, degToRot60k, pxToEmuStroke, ptToHundredths
  color.ts        themeColorToFill, ROLE_TO_SCHEME, solidFill/lineFill
  text.ts         textBodyToXml (TextBody → <a:txBody>)
  shape.ts        shapeToXml (ShapeElement → <p:sp>), kindToPrst
  freeform.ts     freeformToCustGeom (FreeformPath → <a:custGeom>)
  image.ts        imageToXml (ImageElement → <p:pic>), needs media rId
  table.ts        tableToXml (TableElement → <p:graphicFrame><a:tbl>)
  connector.ts    connectorToXml (ConnectorElement → <p:cxnSp>)
  group.ts        groupToXml (GroupElement → <p:grpSp>), elementToXml dispatch
  effects.ts      effectsToXml (Effects → <a:effectLst>)
  animation.ts    transitionToXml, animationsToTimingXml
  slide.ts        slideToXml, notesSlideToXml
  theme.ts        themeToXml
  master.ts       masterToXml
  layout.ts       layoutToXml
  presentation.ts presentationToXml
  templates.ts    CONTENT_TYPES, ROOT_RELS builders
  zip.ts          PptxWriter (part/rels/media registry)
  index.ts        exportPptx orchestrator + ExportPptxOptions

packages/slides/test/export/pptx/   (one test file per module + round-trip.test.ts)

packages/slides/src/node.ts          MODIFY: re-export exportPptx
packages/slides/src/index.ts         MODIFY: re-export exportPptx (browser)

packages/cli/src/slides/pptx-export.ts   CLI wrapper
packages/cli/src/commands/slides.ts       MODIFY: add `export` command
packages/cli/src/schema/registry.ts       MODIFY: add slides.export
packages/cli/skills/slides-export-pptx.md  new skill
packages/cli/skills/SKILL.md               MODIFY: index row
docs/design/cli.md                         MODIFY: command tree + tables
```

---

### Task 1: XML + units helpers

**Files:**
- Create: `packages/slides/src/export/pptx/xml.ts`
- Create: `packages/slides/src/export/pptx/units.ts`
- Test: `packages/slides/test/export/pptx/units.test.ts`

**Interfaces:**
- Produces:
  - `escapeXmlText(s: string): string`
  - `escapeXmlAttr(s: string): string`
  - `pxToEmuX(px: number): number` — `round(px / 1920 * 12_192_000)`
  - `pxToEmuY(px: number): number` — `round(px / 1080 * 6_858_000)`
  - `pxToEmu(px: number): number` — uniform `round(px / 1920 * 12_192_000)` (for stroke/uniform extents)
  - `degToRot60k(deg: number): number` — `round(deg * 60_000)`
  - `ptToHundredths(pt: number): number` — `round(pt * 100)` (font size `<a:rPr sz>`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/units.test.ts
import { describe, it, expect } from 'vitest';
import { pxToEmuX, pxToEmuY, degToRot60k, ptToHundredths } from '../../../src/export/pptx/units.js';
import { escapeXmlText, escapeXmlAttr } from '../../../src/export/pptx/xml.js';

describe('units', () => {
  it('maps full slide width/height to widescreen EMU', () => {
    expect(pxToEmuX(1920)).toBe(12_192_000);
    expect(pxToEmuY(1080)).toBe(6_858_000);
    expect(pxToEmuX(960)).toBe(6_096_000);
  });
  it('converts degrees to 60000ths', () => {
    expect(degToRot60k(90)).toBe(5_400_000);
    expect(degToRot60k(0)).toBe(0);
  });
  it('converts points to hundredths', () => {
    expect(ptToHundredths(18)).toBe(1800);
  });
});

describe('xml escaping', () => {
  it('escapes text nodes', () => {
    expect(escapeXmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('escapes attributes including quotes', () => {
    expect(escapeXmlAttr(`"x" & 'y'`)).toBe('&quot;x&quot; &amp; &apos;y&apos;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/export/pptx/units.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `xml.ts`**

```ts
// packages/slides/src/export/pptx/xml.ts
export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build an attribute string ` k="v"` (escaped), or '' when value is undefined. */
export function attr(name: string, value: string | number | undefined): string {
  if (value === undefined) return '';
  return ` ${name}="${escapeXmlAttr(String(value))}"`;
}
```

- [ ] **Step 4: Write `units.ts`**

```ts
// packages/slides/src/export/pptx/units.ts
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../model/presentation.js';

const EMU_W = 12_192_000;
const EMU_H = 6_858_000;

export function pxToEmuX(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
export function pxToEmuY(px: number): number {
  return Math.round((px / SLIDE_HEIGHT) * EMU_H);
}
/** Uniform px→EMU using the X factor; for stroke widths and square extents. */
export function pxToEmu(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
export function degToRot60k(deg: number): number {
  return Math.round(deg * 60_000);
}
export function ptToHundredths(pt: number): number {
  return Math.round(pt * 100);
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/export/pptx/units.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/export/pptx/xml.ts packages/slides/src/export/pptx/units.ts packages/slides/test/export/pptx/units.test.ts
git commit -m "Add PPTX export xml/units helpers"
```

---

### Task 2: PptxWriter (zip + part/rels/media registry) + templates

**Files:**
- Create: `packages/slides/src/export/pptx/zip.ts`
- Create: `packages/slides/src/export/pptx/templates.ts`
- Test: `packages/slides/test/export/pptx/zip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class PptxWriter { addPart(path, xml, contentType?); addOverride(partName, contentType); addMedia(bytes, ext): string /*media path like 'media/imageN.ext'*/; addRel(ownerPartPath, type, target): string /*rId*/; build(): Promise<Uint8Array> }`
  - Rel `type` is the OOXML relationship URI; `target` is relative to the owner part's folder.
  - `build()` emits `[Content_Types].xml` (defaults + collected overrides), `_rels/.rels`, every part, and each part's `<folder>/_rels/<name>.rels` when it has rels.
  - `templates.ts`: `contentTypesXml(overrides: string[]): string`, `rootRelsXml(): string`, `REL_TYPES` constant map (slide, slideLayout, slideMaster, theme, image, notesSlide, notesMaster, officeDocument).

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/zip.test.ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { PptxWriter } from '../../../src/export/pptx/zip.js';

describe('PptxWriter', () => {
  it('emits content-types, root rels, parts, and per-part rels', async () => {
    const w = new PptxWriter();
    const rId = w.addRel('ppt/presentation.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', 'slides/slide1.xml');
    w.addPart('ppt/presentation.xml', `<p:presentation xmlns:p="x"/>`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');
    w.addPart('ppt/slides/slide1.xml', `<p:sld xmlns:p="x"/>`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    const bytes = await w.build();
    const zip = await JSZip.loadAsync(bytes);

    expect(rId).toBe('rId1');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('presentationml.slide+xml');
    expect(await zip.file('_rels/.rels')!.async('string')).toContain('presentation.xml');
    const presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
    expect(presRels).toContain('slides/slide1.xml');
    expect(presRels).toContain('Id="rId1"');
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
  });

  it('dedups media and returns stable rel ids per owner', async () => {
    const w = new PptxWriter();
    const p1 = w.addMedia(new Uint8Array([1, 2, 3]), 'png');
    expect(p1).toBe('media/image1.png');
    const r1 = w.addRel('ppt/slides/slide1.xml', 'http://x/image', `../${p1}`);
    const r2 = w.addRel('ppt/slides/slide1.xml', 'http://x/image', `../${p1}`);
    expect([r1, r2]).toEqual(['rId1', 'rId2']); // per-owner counter
    const zip = await JSZip.loadAsync(await w.build());
    expect(zip.file('ppt/media/image1.png')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`PptxWriter` not found).

Run: `pnpm --filter @wafflebase/slides exec vitest run test/export/pptx/zip.test.ts`

- [ ] **Step 3: Write `templates.ts`**

```ts
// packages/slides/src/export/pptx/templates.ts
export const REL_TYPES = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
} as const;

export function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${REL_TYPES.officeDocument}" Target="ppt/presentation.xml"/>
</Relationships>`;
}

export function contentTypesXml(overrides: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Default Extension="webp" ContentType="image/webp"/>
  <Default Extension="bmp" ContentType="image/bmp"/>
${overrides.join('\n')}
</Types>`;
}
```

- [ ] **Step 4: Write `zip.ts`**

```ts
// packages/slides/src/export/pptx/zip.ts
import JSZip from 'jszip';
import { contentTypesXml, rootRelsXml } from './templates.js';

interface Rel { id: string; type: string; target: string; }

export class PptxWriter {
  private parts = new Map<string, string>();
  private overrides: string[] = [];
  private rels = new Map<string, Rel[]>(); // ownerPartPath → rels
  private relCounters = new Map<string, number>();
  private media = new Map<string, Uint8Array>(); // path → bytes
  private mediaSeq = 0;

  addPart(path: string, xml: string, contentType?: string): void {
    this.parts.set(path, xml);
    if (contentType) this.addOverride(`/${path}`, contentType);
  }

  addOverride(partName: string, contentType: string): void {
    this.overrides.push(`  <Override PartName="${partName}" ContentType="${contentType}"/>`);
  }

  addMedia(bytes: Uint8Array, ext: string): string {
    const path = `media/image${++this.mediaSeq}.${ext}`;
    this.media.set(`ppt/${path}`, bytes);
    return path;
  }

  addRel(ownerPartPath: string, type: string, target: string): string {
    const n = (this.relCounters.get(ownerPartPath) ?? 0) + 1;
    this.relCounters.set(ownerPartPath, n);
    const id = `rId${n}`;
    const list = this.rels.get(ownerPartPath) ?? [];
    list.push({ id, type, target });
    this.rels.set(ownerPartPath, list);
    return id;
  }

  async build(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml(this.overrides));
    zip.file('_rels/.rels', rootRelsXml());
    for (const [path, xml] of this.parts) zip.file(path, xml);
    for (const [path, bytes] of this.media) zip.file(path, bytes);
    for (const [owner, list] of this.rels) {
      const relsPath = relsPathFor(owner);
      const body = list
        .map((r) => `  <Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
        .join('\n');
      zip.file(
        relsPath,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${body}
</Relationships>`,
      );
    }
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return new Uint8Array(buf);
  }
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : partPath.slice(0, slash + 1);
  const name = slash === -1 ? partPath : partPath.slice(slash + 1);
  return `${dir}_rels/${name}.rels`;
}
```

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/export/pptx/zip.ts packages/slides/src/export/pptx/templates.ts packages/slides/test/export/pptx/zip.test.ts
git commit -m "Add PptxWriter part/rels/media registry"
```

---

### Task 3: Color serialization

**Files:**
- Create: `packages/slides/src/export/pptx/color.ts`
- Test: `packages/slides/test/export/pptx/color.test.ts`

**Interfaces:**
- Consumes: `attr` from `xml.ts`; `ThemeColor`, `ColorRole` from `../../model/theme.js`.
- Produces:
  - `ROLE_TO_SCHEME: Record<ColorRole, string>` — inverse of importer `SCHEME_TO_ROLE` (canonical OOXML name per role: text→`tx1`, background→`bg1`, textSecondary→`tx2`, backgroundAlt→`bg2`, accent1..6→`accent1..6`, hyperlink→`hlink`, visitedHyperlink→`folHlink`).
  - `colorChildXml(c: ThemeColor): string` — inner `<a:schemeClr>`/`<a:srgbClr>` element incl. `lumMod/lumOff/tint/shade/alpha` children.
  - `solidFillXml(c: ThemeColor): string` — `<a:solidFill>{child}</a:solidFill>`.
  - `colorFromStringOrTheme(c: ThemeColor | string): ThemeColor` — wraps a raw hex string as `{ kind: 'srgb', value }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/color.test.ts
import { describe, it, expect } from 'vitest';
import { solidFillXml, colorChildXml, ROLE_TO_SCHEME } from '../../../src/export/pptx/color.js';

describe('color', () => {
  it('maps every role to a scheme name', () => {
    expect(ROLE_TO_SCHEME.text).toBe('tx1');
    expect(ROLE_TO_SCHEME.background).toBe('bg1');
    expect(ROLE_TO_SCHEME.accent1).toBe('accent1');
    expect(ROLE_TO_SCHEME.hyperlink).toBe('hlink');
  });
  it('emits schemeClr with modifiers', () => {
    const xml = colorChildXml({ kind: 'role', role: 'accent1', lumMod: 75000, alpha: 50000 });
    expect(xml).toContain('<a:schemeClr val="accent1">');
    expect(xml).toContain('<a:lumMod val="75000"/>');
    expect(xml).toContain('<a:alpha val="50000"/>');
  });
  it('emits srgbClr', () => {
    expect(colorChildXml({ kind: 'srgb', value: '#FF0000' })).toBe('<a:srgbClr val="FF0000"/>');
  });
  it('wraps in solidFill', () => {
    expect(solidFillXml({ kind: 'srgb', value: '#00FF00' })).toBe('<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Write `color.ts`**

```ts
// packages/slides/src/export/pptx/color.ts
import type { ColorRole, ThemeColor } from '../../model/theme.js';

export const ROLE_TO_SCHEME: Record<ColorRole, string> = {
  text: 'tx1',
  background: 'bg1',
  textSecondary: 'tx2',
  backgroundAlt: 'bg2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  visitedHyperlink: 'folHlink',
};

export function colorFromStringOrTheme(c: ThemeColor | string): ThemeColor {
  return typeof c === 'string' ? { kind: 'srgb', value: c } : c;
}

export function colorChildXml(c: ThemeColor): string {
  const mods: string[] = [];
  if ('lumMod' in c && c.lumMod !== undefined) mods.push(`<a:lumMod val="${c.lumMod}"/>`);
  if ('lumOff' in c && c.lumOff !== undefined) mods.push(`<a:lumOff val="${c.lumOff}"/>`);
  if ('tint' in c && c.tint !== undefined) mods.push(`<a:tint val="${c.tint}"/>`);
  if ('shade' in c && c.shade !== undefined) mods.push(`<a:shade val="${c.shade}"/>`);
  if (c.alpha !== undefined) mods.push(`<a:alpha val="${c.alpha}"/>`);
  const inner = mods.join('');
  if (c.kind === 'role') {
    const val = ROLE_TO_SCHEME[c.role];
    return inner ? `<a:schemeClr val="${val}">${inner}</a:schemeClr>` : `<a:schemeClr val="${val}"/>`;
  }
  const hex = c.value.replace(/^#/, '').toUpperCase();
  return inner ? `<a:srgbClr val="${hex}">${inner}</a:srgbClr>` : `<a:srgbClr val="${hex}"/>`;
}

export function solidFillXml(c: ThemeColor): string {
  return `<a:solidFill>${colorChildXml(c)}</a:solidFill>`;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX color serialization (ThemeColor → DrawingML)"`

> **Round-trip note for implementer:** confirm `SCHEME_TO_ROLE` in `src/import/pptx/color.ts` round-trips through `ROLE_TO_SCHEME` (importer maps both `dk1`/`tx1`→text; exporter must pick the canonical `tx1` so re-import yields the same role — it does). Add a round-trip assertion in `color.test.ts` importing `SCHEME_TO_ROLE`.

---

### Task 4: Text body serialization

**Files:**
- Create: `packages/slides/src/export/pptx/text.ts`
- Test: `packages/slides/test/export/pptx/text.test.ts`

**Interfaces:**
- Consumes: `escapeXmlText`, `attr` (xml.ts); `ptToHundredths` (units.ts); `colorChildXml`, `colorFromStringOrTheme` (color.ts); `TextBody`, `AutofitMode`, `VerticalAnchorMode` (../../model/element.js); `Block`, `Inline` (@wafflebase/docs).
- Produces: `textBodyToXml(body: TextBody): string` → `<a:txBody><a:bodyPr .../><a:p>…</a:p>…</a:txBody>`.

Mapping rules (inverse of `src/import/pptx/text.ts`):
- `<a:bodyPr>`: `autofit` none→`<a:noAutofit/>`, shrink→`<a:normAutofit/>`, grow(or absent)→`<a:spAutoFit/>`; `verticalAnchor` top→`anchor="t"`, middle→`anchor="ctr"`, bottom→`anchor="b"` (omit when absent).
- Each `Block` → `<a:p>` with `<a:pPr>`: `style.alignment` → `algn` (`left→l,center→ctr,right→r,justify→just`); `listLevel` → `lvl`; `listKind` ordered→`<a:buAutoNum type="arabicPeriod"/>`, unordered→`<a:buChar char="•"/>`.
- Each `Inline` → `<a:r>` with `<a:rPr>`: `bold`→`b="1"`, `italic`→`i="1"`, `underline`→`u="sng"`, `strikethrough`→`strike="sngStrike"`, `fontSize`(pt)→`sz` via `ptToHundredths`, `color`→child `<a:solidFill>`, `fontFamily`→`<a:latin typeface="…"/>`, `href`→`<a:hlinkClick>` (link rel deferred — emit `<a:hlinkClick r:id=""/>` placeholder only if href present, see note). `<a:t>` carries escaped text.
- Empty block → `<a:p><a:pPr .../></a:p>` (no runs).

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/text.test.ts
import { describe, it, expect } from 'vitest';
import { textBodyToXml } from '../../../src/export/pptx/text.js';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';

function para(text: string, style: Record<string, unknown> = {}): Block {
  return { id: 'b', type: 'paragraph', inlines: [{ text, style }], style: { ...DEFAULT_BLOCK_STYLE } } as Block;
}

describe('textBodyToXml', () => {
  it('emits bodyPr autofit and a run', () => {
    const xml = textBodyToXml({ blocks: [para('Hi')], autofit: 'shrink', verticalAnchor: 'middle' });
    expect(xml).toContain('<a:bodyPr');
    expect(xml).toContain('anchor="ctr"');
    expect(xml).toContain('<a:normAutofit/>');
    expect(xml).toContain('<a:t>Hi</a:t>');
  });
  it('emits run properties for bold/italic/size/color', () => {
    const xml = textBodyToXml({ blocks: [para('X', { bold: true, italic: true, fontSize: 24, color: '#FF0000' })] });
    expect(xml).toMatch(/<a:rPr[^>]*b="1"/);
    expect(xml).toMatch(/<a:rPr[^>]*i="1"/);
    expect(xml).toMatch(/<a:rPr[^>]*sz="2400"/);
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });
  it('escapes text', () => {
    expect(textBodyToXml({ blocks: [para('a < b & c')] })).toContain('<a:t>a &lt; b &amp; c</a:t>');
  });
  it('defaults absent autofit to spAutoFit', () => {
    expect(textBodyToXml({ blocks: [para('x')] })).toContain('<a:spAutoFit/>');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Write `text.ts`** (complete implementation)

```ts
// packages/slides/src/export/pptx/text.ts
import type { Block, Inline } from '@wafflebase/docs';
import type { AutofitMode, TextBody, VerticalAnchorMode } from '../../model/element.js';
import { escapeXmlText } from './xml.js';
import { ptToHundredths } from './units.js';
import { colorChildXml, colorFromStringOrTheme } from './color.js';

export function textBodyToXml(body: TextBody): string {
  const paras = body.blocks.map(blockToXml).join('');
  return `<a:txBody>${bodyPrXml(body.autofit, body.verticalAnchor)}${paras || '<a:p/>'}</a:txBody>`;
}

function bodyPrXml(autofit: AutofitMode | undefined, anchor: VerticalAnchorMode | undefined): string {
  const anchorAttr =
    anchor === 'middle' ? ' anchor="ctr"' : anchor === 'bottom' ? ' anchor="b"' : anchor === 'top' ? ' anchor="t"' : '';
  const fit = autofit === 'none' ? '<a:noAutofit/>' : autofit === 'shrink' ? '<a:normAutofit/>' : '<a:spAutoFit/>';
  return `<a:bodyPr${anchorAttr}>${fit}</a:bodyPr>`;
}

const ALGN: Record<string, string> = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };

function blockToXml(block: Block): string {
  const algn = ALGN[block.style.alignment] ?? 'l';
  const lvl = block.listLevel ? ` lvl="${block.listLevel}"` : '';
  let bu = '';
  if (block.listKind === 'ordered') bu = '<a:buAutoNum type="arabicPeriod"/>';
  else if (block.listKind === 'unordered') bu = '<a:buChar char="•"/>';
  const pPr = `<a:pPr algn="${algn}"${lvl}>${bu}</a:pPr>`;
  const runs = block.inlines.map(runToXml).join('');
  return `<a:p>${pPr}${runs}</a:p>`;
}

function runToXml(inline: Inline): string {
  const s = inline.style;
  const attrs: string[] = [];
  if (s.bold) attrs.push('b="1"');
  if (s.italic) attrs.push('i="1"');
  if (s.underline) attrs.push('u="sng"');
  if (s.strikethrough) attrs.push('strike="sngStrike"');
  if (s.fontSize) attrs.push(`sz="${ptToHundredths(s.fontSize)}"`);
  const children: string[] = [];
  if (s.color) children.push(`<a:solidFill>${colorChildXml(colorFromStringOrTheme(s.color as never))}</a:solidFill>`);
  if (s.fontFamily) children.push(`<a:latin typeface="${escapeXmlText(s.fontFamily)}"/>`);
  const rPr = `<a:rPr${attrs.length ? ' ' + attrs.join(' ') : ''}${children.length ? `>${children.join('')}</a:rPr>` : '/>'}`;
  return `<a:r>${rPr}<a:t>${escapeXmlText(inline.text)}</a:t></a:r>`;
}
```

> **Note:** `s.color` is `StoredColor` in docs; the importer maps OOXML run colors into it. If `StoredColor` is not directly a `ThemeColor`/hex string, adjust `colorFromStringOrTheme` accordingly — read `src/import/pptx/text.ts` for the exact inverse. Hyperlinks (`href`) need a slide-rel; defer to a follow-up and assert in round-trip normalization that `href` is excluded if not yet wired.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX text body serialization (TextBody → a:txBody)"`

---

### Task 5: Shape + freeform serialization

**Files:**
- Create: `packages/slides/src/export/pptx/shape.ts`
- Create: `packages/slides/src/export/pptx/freeform.ts`
- Create: `packages/slides/src/export/pptx/effects.ts`
- Test: `packages/slides/test/export/pptx/shape.test.ts`
- Test: `packages/slides/test/export/pptx/freeform.test.ts`

**Interfaces:**
- Consumes: `attr` (xml), `pxToEmuX/Y`, `degToRot60k` (units), `solidFillXml`, `colorChildXml`, `colorFromStringOrTheme` (color), `textBodyToXml` (text); `ShapeElement`, `Frame`, `Stroke`, `FreeformPath`, `ShapeKind`, `Effects` (model/element); `PATH_BUILDERS` (../../view/canvas/shapes) — **import-audit: confirm DOM-free at module load**, else inline a local `KNOWN_KINDS: Set<ShapeKind>`.
- Produces:
  - `xfrmXml(frame: Frame): string` — `<a:xfrm rot flipH flipV><a:off/><a:ext/></a:xfrm>`.
  - `kindToPrst(kind: ShapeKind): string` — identity except `pentagonArrow→homePlate`.
  - `lineXml(stroke: Stroke | undefined): string` — `<a:ln w=…>{fill}{dash}</a:ln>` or ''.
  - `shapeToXml(el: ShapeElement): string` → `<p:sp>`.
  - `freeformToCustGeom(path: FreeformPath, frame: Frame): string` → `<a:custGeom>`.
  - `effectsToXml(e: Effects | undefined): string` → `<a:effectLst>` or ''.

- [ ] **Step 1: Write failing tests**

```ts
// packages/slides/test/export/pptx/shape.test.ts
import { describe, it, expect } from 'vitest';
import { shapeToXml, kindToPrst, xfrmXml } from '../../../src/export/pptx/shape.js';
import type { ShapeElement } from '../../../src/model/element.js';

const frame = { x: 100, y: 200, w: 300, h: 150, rotation: 0 };

describe('shape', () => {
  it('maps pentagonArrow to homePlate, others identity', () => {
    expect(kindToPrst('pentagonArrow')).toBe('homePlate');
    expect(kindToPrst('rect')).toBe('rect');
  });
  it('emits xfrm in EMU', () => {
    const xml = xfrmXml({ ...frame, rotation: 90 });
    expect(xml).toContain('rot="5400000"');
    expect(xml).toMatch(/<a:off x="\d+" y="\d+"\/>/);
  });
  it('emits p:sp with prstGeom and fill', () => {
    const el: ShapeElement = { id: 's', frame, type: 'shape', data: { kind: 'rect', fill: { kind: 'srgb', value: '#FF0000' } } };
    const xml = shapeToXml(el);
    expect(xml).toContain('<p:sp>');
    expect(xml).toContain('<a:prstGeom prst="rect">');
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });
  it('emits custGeom for freeform', () => {
    const el: ShapeElement = { id: 's', frame, type: 'shape', data: { kind: 'freeform', path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 1 }, { c: 'Z' }] } } };
    expect(shapeToXml(el)).toContain('<a:custGeom>');
  });
});
```

```ts
// packages/slides/test/export/pptx/freeform.test.ts
import { describe, it, expect } from 'vitest';
import { freeformToCustGeom } from '../../../src/export/pptx/freeform.js';

describe('freeformToCustGeom', () => {
  it('emits a path with moveTo/lnTo/close', () => {
    const xml = freeformToCustGeom({ commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 0.5 }, { c: 'Z' }] }, { x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('<a:moveTo>');
    expect(xml).toContain('<a:lnTo>');
    expect(xml).toContain('<a:close/>');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Write `effects.ts`**

```ts
// packages/slides/src/export/pptx/effects.ts
import type { Effects } from '../../model/element.js';
import { pxToEmu } from './units.js';
import { colorChildXml, colorFromStringOrTheme } from './color.js';

export function effectsToXml(e: Effects | undefined): string {
  if (!e || (!e.shadow && !e.reflection)) return '';
  const parts: string[] = [];
  if (e.shadow) {
    const s = e.shadow;
    const dir = Math.round(((s.angle % 360) + 360) % 360 * 60_000);
    const alpha = Math.round(s.opacity * 100_000);
    parts.push(
      `<a:outerShdw blurRad="${pxToEmu(s.blur)}" dist="${pxToEmu(s.distance)}" dir="${dir}">` +
        `${colorChildXml({ ...colorFromStringOrTheme(s.color), alpha } as never)}</a:outerShdw>`,
    );
  }
  if (e.reflection) {
    const r = e.reflection;
    parts.push(`<a:reflection blurRad="0" stA="${Math.round(r.opacity * 100_000)}" endA="0" dist="${pxToEmu(r.distance)}"/>`);
  }
  return `<a:effectLst>${parts.join('')}</a:effectLst>`;
}
```

- [ ] **Step 4: Write `freeform.ts`**

```ts
// packages/slides/src/export/pptx/freeform.ts
import type { FreeformPath, Frame } from '../../model/element.js';

// custGeom path space is the shape's own coordinate box; the importer
// normalizes commands to [0,1], so scale by a fixed guide extent.
const GUIDE = 100000;

export function freeformToCustGeom(path: FreeformPath, _frame: Frame): string {
  const g = (v: number) => Math.round(v * GUIDE);
  const cmds = path.commands
    .map((c) => {
      switch (c.c) {
        case 'M': return `<a:moveTo><a:pt x="${g(c.x)}" y="${g(c.y)}"/></a:moveTo>`;
        case 'L': return `<a:lnTo><a:pt x="${g(c.x)}" y="${g(c.y)}"/></a:lnTo>`;
        case 'Q': return `<a:quadBezTo><a:pt x="${g(c.x1)}" y="${g(c.y1)}"/><a:pt x="${g(c.x)}" y="${g(c.y)}"/></a:quadBezTo>`;
        case 'C': return `<a:cubicBezTo><a:pt x="${g(c.x1)}" y="${g(c.y1)}"/><a:pt x="${g(c.x2)}" y="${g(c.y2)}"/><a:pt x="${g(c.x)}" y="${g(c.y)}"/></a:cubicBezTo>`;
        case 'A': return `<a:arcTo wR="${g(c.rx)}" hR="${g(c.ry)}" stAng="${Math.round(c.start * 60000)}" swAng="${Math.round(c.sweep * 60000)}"/>`;
        case 'Z': return `<a:close/>`;
      }
    })
    .join('');
  return `<a:custGeom><a:avLst/><a:gdLst/><a:rect l="0" t="0" r="${GUIDE}" b="${GUIDE}"/><a:pathLst><a:path w="${GUIDE}" h="${GUIDE}">${cmds}</a:path></a:pathLst></a:custGeom>`;
}
```

> **Note:** the exact arc encoding must mirror `src/import/pptx/freeform.ts`. Read it and adjust `arcTo` to the inverse; cover with the round-trip freeform fixture in Task 14.

- [ ] **Step 5: Write `shape.ts`**

```ts
// packages/slides/src/export/pptx/shape.ts
import type { Frame, ShapeElement, ShapeKind, Stroke } from '../../model/element.js';
import { pxToEmuX, pxToEmuY, degToRot60k } from './units.js';
import { solidFillXml, colorChildXml, colorFromStringOrTheme } from './color.js';
import { textBodyToXml } from './text.js';
import { effectsToXml } from './effects.js';
import { freeformToCustGeom } from './freeform.js';

export function kindToPrst(kind: ShapeKind): string {
  return kind === 'pentagonArrow' ? 'homePlate' : kind;
}

export function xfrmXml(frame: Frame): string {
  const rot = frame.rotation ? ` rot="${degToRot60k(frame.rotation)}"` : '';
  const fh = frame.flipH ? ' flipH="1"' : '';
  const fv = frame.flipV ? ' flipV="1"' : '';
  return `<a:xfrm${rot}${fh}${fv}><a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/><a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/></a:xfrm>`;
}

const DASH: Record<string, string> = { dashed: 'dash', dotted: 'sysDot' };

export function lineXml(stroke: Stroke | undefined): string {
  if (!stroke) return '';
  const w = pxToEmuX(stroke.width);
  const fill = solidFillXml(colorFromStringOrTheme(stroke.color));
  const dash = stroke.dash && stroke.dash !== 'solid' ? `<a:prstDash val="${DASH[stroke.dash]}"/>` : '';
  return `<a:ln w="${w}">${fill}${dash}</a:ln>`;
}

export function shapeToXml(el: ShapeElement): string {
  const { data, frame } = el;
  const geom = data.kind === 'freeform' && data.path
    ? freeformToCustGeom(data.path, frame)
    : `<a:prstGeom prst="${kindToPrst(data.kind)}">${avLstXml(data.adjustments)}</a:prstGeom>`;
  const fill = data.fill ? solidFillXml(data.fill) : '<a:noFill/>';
  const spPr = `<p:spPr>${xfrmXml(frame)}${geom}${fill}${lineXml(data.stroke)}${effectsToXml(data.effects)}</p:spPr>`;
  const txBody = data.text ? textBodyToXml(data.text) : '<p:txBody><a:bodyPr/><a:p/></p:txBody>';
  const nv = `<p:nvSpPr><p:cNvPr id="0" name="${el.id}"${data.alt ? ` descr="${data.alt}"` : ''}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`;
  return `<p:sp>${nv}${spPr}${txBody}</p:sp>`;
}

function avLstXml(adj: number[] | undefined): string {
  if (!adj || adj.length === 0) return '<a:avLst/>';
  const gds = adj.map((v, i) => `<a:gd name="adj${i + 1}" fmla="val ${Math.round(v)}"/>`).join('');
  return `<a:avLst>${gds}</a:avLst>`;
}
```

> **Note:** `textBodyToXml` returns `<a:txBody>`; shapes need it wrapped as the shape's text. PPTX uses `<p:txBody>` only on `<p:sp>` — actually DrawingML uses `<p:txBody>` for `p:sp`. Adjust `textBodyToXml` to accept a tag param or wrap: emit `<p:txBody>` by replacing the outer tag in shape context. Decide in Step 3 of Task 4 (parameterize `textBodyToXml(body, { tag: 'a:txBody' | 'p:txBody' })`). Update the Task 4 test accordingly.

- [ ] **Step 6: Run both tests — expect PASS.**
- [ ] **Step 7: Commit** `git commit -m "Add PPTX shape/freeform/effects serialization"`

---

### Task 6: Image serialization

**Files:**
- Create: `packages/slides/src/export/pptx/image.ts`
- Test: `packages/slides/test/export/pptx/image.test.ts`

**Interfaces:**
- Consumes: `xfrmXml` (shape), `effectsToXml` (effects), `ImageElement`, `Crop` (model/element).
- Produces:
  - `imageToXml(el: ImageElement, embedRId: string): string` → `<p:pic>` referencing `r:embed="${embedRId}"`, with `<a:srcRect>` from crop, `<a:alphaModFix>` from opacity, recolor/brightness/contrast filters.
  - The orchestrator (Task 12) resolves bytes + adds media/rel and passes `embedRId`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/image.test.ts
import { describe, it, expect } from 'vitest';
import { imageToXml } from '../../../src/export/pptx/image.js';
import type { ImageElement } from '../../../src/model/element.js';

const base: ImageElement = { id: 'i', frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, type: 'image', data: { src: 'data:image/png;base64,AAAA' } };

describe('imageToXml', () => {
  it('emits p:pic with blip embed', () => {
    const xml = imageToXml(base, 'rId5');
    expect(xml).toContain('<p:pic>');
    expect(xml).toContain('r:embed="rId5"');
  });
  it('emits srcRect from crop and alphaModFix from opacity', () => {
    const xml = imageToXml({ ...base, data: { ...base.data, crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 }, opacity: 0.5 } }, 'rId1');
    expect(xml).toContain('<a:srcRect');
    expect(xml).toMatch(/<a:alphaModFix amt="50000"\/>/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write `image.ts`**

```ts
// packages/slides/src/export/pptx/image.ts
import type { Crop, ImageElement } from '../../model/element.js';
import { xfrmXml } from './shape.js';
import { effectsToXml } from './effects.js';

export function imageToXml(el: ImageElement, embedRId: string): string {
  const { data, frame } = el;
  const blipChildren: string[] = [];
  if (data.opacity !== undefined && data.opacity < 1) {
    blipChildren.push(`<a:alphaModFix amt="${Math.round(data.opacity * 100_000)}"/>`);
  }
  if (data.recolor === 'grayscale') blipChildren.push('<a:grayscl/>');
  if (data.brightness || data.contrast) {
    const bright = data.brightness ? ` bright="${Math.round(data.brightness * 100_000)}"` : '';
    const contrast = data.contrast ? ` contrast="${Math.round(data.contrast * 100_000)}"` : '';
    blipChildren.push(`<a:lum${bright}${contrast}/>`);
  }
  const blip = `<a:blip r:embed="${embedRId}">${blipChildren.join('')}</a:blip>`;
  const srcRect = data.crop ? srcRectXml(data.crop) : '';
  const nv = `<p:nvPicPr><p:cNvPr id="0" name="${el.id}"${data.alt ? ` descr="${data.alt}"` : ''}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`;
  const spPr = `<p:spPr>${xfrmXml(frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${effectsToXml(data.effects)}</p:spPr>`;
  return `<p:pic>${nv}<p:blipFill>${blip}${srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill>${spPr}</p:pic>`;
}

// OOXML srcRect insets are fractions of the source, in 1000ths of a percent.
function srcRectXml(crop: Crop): string {
  const l = Math.round(crop.x * 100_000);
  const t = Math.round(crop.y * 100_000);
  const r = Math.round((1 - crop.x - crop.w) * 100_000);
  const b = Math.round((1 - crop.y - crop.h) * 100_000);
  return `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>`;
}
```

> **Note:** verify the crop fraction convention against `src/import/pptx/image.ts` (`srcRect`→`crop`). Adjust `srcRectXml`/recolor (`sepia`→`<a:duotone>`) to the exact inverse; cover in round-trip.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX image serialization (ImageElement → p:pic)"`

---

### Task 7: Table serialization

**Files:**
- Create: `packages/slides/src/export/pptx/table.ts`
- Test: `packages/slides/test/export/pptx/table.test.ts`

**Interfaces:**
- Consumes: `pxToEmuX/Y` (units), `textBodyToXml` (text, `a:txBody` tag), `solidFillXml`, `colorFromStringOrTheme` (color); `TableElement`, `TableCell`, `CellBorder` (model/element).
- Produces: `tableToXml(el: TableElement): string` → `<p:graphicFrame>…<a:tbl>…`.

Rules (inverse of `src/import/pptx/table.ts`): `<p:xfrm>` from frame; `<a:tblGrid><a:gridCol w=…>` from `columnWidths`; each row `<a:tr h=…>`; each non-covered cell `<a:tc rowSpan gridSpan>` (omit when 1), covered cell (`gridSpan===0`/`rowSpan===0`) → `<a:tc hMerge="1"/>` / `<a:tc vMerge="1"/>`; cell `<a:tcPr>` with `<a:lnL/R/T/B>` borders + `<a:solidFill>` fill; cell body via `textBodyToXml`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/table.test.ts
import { describe, it, expect } from 'vitest';
import { tableToXml } from '../../../src/export/pptx/table.js';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { TableElement } from '../../../src/model/element.js';

function cell(text: string) {
  const blocks: Block[] = [{ id: 'b', type: 'paragraph', inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } } as Block];
  return { body: { blocks }, style: {} };
}
const el: TableElement = {
  id: 't', frame: { x: 0, y: 0, w: 200, h: 80, rotation: 0 }, type: 'table',
  data: { columnWidths: [100, 100], rows: [{ height: 40, cells: [cell('A'), cell('B')] }, { height: 40, cells: [cell('C'), cell('D')] }] },
};

describe('tableToXml', () => {
  it('emits graphicFrame with grid, rows, and cell text', () => {
    const xml = tableToXml(el);
    expect(xml).toContain('<p:graphicFrame>');
    expect(xml).toContain('<a:tbl>');
    expect(xml.match(/<a:gridCol /g)).toHaveLength(2);
    expect(xml.match(/<a:tr /g)).toHaveLength(2);
    expect(xml).toContain('<a:t>A</a:t>');
  });
  it('marks covered cells with hMerge', () => {
    const merged: TableElement = { ...el, data: { ...el.data, rows: [{ height: 40, cells: [{ ...cell('A'), gridSpan: 2 }, { ...cell(''), gridSpan: 0 }] }] } };
    expect(tableToXml(merged)).toContain('hMerge="1"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write `table.ts`** (complete; mirror importer cell/border mapping)

```ts
// packages/slides/src/export/pptx/table.ts
import type { CellBorder, TableCell, TableElement } from '../../model/element.js';
import { pxToEmuX, pxToEmuY } from './units.js';
import { textBodyToXml } from './text.js';
import { solidFillXml, colorFromStringOrTheme } from './color.js';

export function tableToXml(el: TableElement): string {
  const { data, frame } = el;
  const grid = data.columnWidths.map((w) => `<a:gridCol w="${pxToEmuX(w)}"/>`).join('');
  const rows = data.rows.map(rowToXml).join('');
  const tbl = `<a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl>`;
  const xfrm = `<p:xfrm><a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/><a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/></p:xfrm>`;
  const nv = `<p:nvGraphicFramePr><p:cNvPr id="0" name="${el.id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`;
  return `<p:graphicFrame>${nv}${xfrm}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${tbl}</a:graphicData></a:graphic></p:graphicFrame>`;
}

function rowToXml(row: { height: number; cells: TableCell[] }): string {
  return `<a:tr h="${pxToEmuY(row.height)}">${row.cells.map(cellToXml).join('')}</a:tr>`;
}

function cellToXml(cell: TableCell): string {
  if (cell.gridSpan === 0) return '<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc>';
  if (cell.rowSpan === 0) return '<a:tc vMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr/></a:tc>';
  const span = cell.gridSpan && cell.gridSpan > 1 ? ` gridSpan="${cell.gridSpan}"` : '';
  const rspan = cell.rowSpan && cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : '';
  return `<a:tc${span}${rspan}>${textBodyToXml(cell.body)}${tcPrXml(cell)}</a:tc>`;
}

function tcPrXml(cell: TableCell): string {
  const b = cell.style.border;
  const ln = (side: 'L' | 'R' | 'T' | 'B', border: CellBorder | undefined) =>
    border ? `<a:ln${side} w="${pxToEmuX(border.width)}">${solidFillXml(colorFromStringOrTheme(border.color))}</a:ln${side}>` : '';
  const borders = b ? ln('L', b.left) + ln('R', b.right) + ln('T', b.top) + ln('B', b.bottom) : '';
  const fill = cell.style.fill ? solidFillXml(colorFromStringOrTheme(cell.style.fill)) : '';
  return `<a:tcPr>${borders}${fill}</a:tcPr>`;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX table serialization (TableElement → a:tbl)"`

---

### Task 8: Connector serialization

**Files:**
- Create: `packages/slides/src/export/pptx/connector.ts`
- Test: `packages/slides/test/export/pptx/connector.test.ts`

**Interfaces:**
- Consumes: `pxToEmuX/Y` (units), `lineXml` (shape) or a local line builder, `computeConnectorFrame`/`resolveEndpoint` (../../view/canvas/connector-frame — node-safe per node.ts) to resolve a bounding frame from endpoints; `ConnectorElement`, `ConnectorRouting` (model/connector).
- Produces: `connectorToXml(el: ConnectorElement, frame: Frame): string` → `<p:cxnSp>` with `<a:prstGeom prst>` (`straight→line`, `elbow→bentConnector3`, `curved→curvedConnector3`), `<a:ln>` with arrowhead `<a:headEnd>/<a:tailEnd>`.
- The orchestrator computes `frame` via `computeConnectorFrame` and passes it (connectors store endpoints, not a frame).

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/connector.test.ts
import { describe, it, expect } from 'vitest';
import { connectorToXml } from '../../../src/export/pptx/connector.js';
import type { ConnectorElement } from '../../../src/model/connector.js';

const el = {
  id: 'c', type: 'connector', routing: 'straight',
  start: { kind: 'free', x: 0, y: 0 }, end: { kind: 'free', x: 100, y: 50 },
  arrowheads: { end: { kind: 'triangle', size: 'md' } },
} as unknown as ConnectorElement;

describe('connectorToXml', () => {
  it('emits cxnSp with a line preset and tail arrowhead', () => {
    const xml = connectorToXml(el, { x: 0, y: 0, w: 100, h: 50, rotation: 0 });
    expect(xml).toContain('<p:cxnSp>');
    expect(xml).toContain('prst="line"');
    expect(xml).toContain('<a:tailEnd');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write `connector.ts`**

```ts
// packages/slides/src/export/pptx/connector.ts
import type { Frame } from '../../model/element.js';
import type { ArrowheadStyle, ConnectorElement, ConnectorRouting } from '../../model/connector.js';
import { pxToEmuX, pxToEmuY } from './units.js';

const ROUTING_PRST: Record<ConnectorRouting, string> = {
  straight: 'line',
  elbow: 'bentConnector3',
  curved: 'curvedConnector3',
};

const HEAD_TYPE: Record<string, string> = {
  triangle: 'triangle', 'triangle-open': 'stealth',
  diamond: 'diamond', 'diamond-open': 'diamond',
  circle: 'oval', 'circle-open': 'oval',
  square: 'oval', 'square-open': 'oval',
};
const HEAD_SIZE = { sm: 'sm', md: 'med', lg: 'lg' } as const;

function arrowXml(tag: 'headEnd' | 'tailEnd', a: ArrowheadStyle | undefined): string {
  if (!a) return '';
  return `<a:${tag} type="${HEAD_TYPE[a.kind] ?? 'triangle'}" w="${HEAD_SIZE[a.size]}" len="${HEAD_SIZE[a.size]}"/>`;
}

export function connectorToXml(el: ConnectorElement, frame: Frame): string {
  const prst = ROUTING_PRST[el.routing];
  const stroke = el.stroke;
  const w = stroke ? pxToEmuX(stroke.width) : 12700;
  const ln = `<a:ln w="${w}">${arrowXml('headEnd', el.arrowheads.start)}${arrowXml('tailEnd', el.arrowheads.end)}</a:ln>`;
  const xfrm = `<a:xfrm><a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/><a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/></a:xfrm>`;
  const nv = `<p:nvCxnSpPr><p:cNvPr id="0" name="${el.id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`;
  return `<p:cxnSp>${nv}<p:spPr>${xfrm}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${ln}</p:spPr></p:cxnSp>`;
}
```

> **Note:** stroke color fill inside `<a:ln>` and exact arrowhead type mapping must mirror `src/import/pptx/connector.ts`. Add `solidFillXml(stroke.color)` inside `<a:ln>` if the importer reads it; cover in round-trip.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX connector serialization (ConnectorElement → p:cxnSp)"`

---

### Task 9: Group + element dispatch

**Files:**
- Create: `packages/slides/src/export/pptx/group.ts`
- Test: `packages/slides/test/export/pptx/group.test.ts`

**Interfaces:**
- Consumes: all element serializers (shape/image/table/connector/text-as-shape); `xfrmXml` (shape); `GroupElement`, `Element` (model/element); `computeConnectorFrame` for connector children.
- Produces:
  - `elementToXml(el: Element, ctx: ElementXmlCtx): string` — dispatch by `el.type`; for `image`, calls `ctx.resolveImageRId(el)`; for `connector`, computes frame via `ctx.connectorFrame(el)`.
  - `interface ElementXmlCtx { resolveImageRId(el: ImageElement): string; connectorFrame(el: ConnectorElement): Frame; }`
  - `groupToXml(el: GroupElement, ctx: ElementXmlCtx): string` → `<p:grpSp>` with `<a:grpSpPr><a:xfrm><a:off/><a:ext/><a:chOff/><a:chExt/></a:xfrm>` then children recursively.

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/group.test.ts
import { describe, it, expect } from 'vitest';
import { elementToXml, groupToXml, type ElementXmlCtx } from '../../../src/export/pptx/group.js';
import type { GroupElement, ShapeElement } from '../../../src/model/element.js';

const ctx: ElementXmlCtx = { resolveImageRId: () => 'rId1', connectorFrame: () => ({ x: 0, y: 0, w: 1, h: 1, rotation: 0 }) };
const child: ShapeElement = { id: 'c', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, type: 'shape', data: { kind: 'rect' } };

describe('group', () => {
  it('dispatches a shape', () => {
    expect(elementToXml(child, ctx)).toContain('<p:sp>');
  });
  it('emits grpSp with children and chOff/chExt', () => {
    const g: GroupElement = { id: 'g', frame: { x: 5, y: 5, w: 100, h: 100, rotation: 0 }, type: 'group', data: { children: [child] } };
    const xml = groupToXml(g, ctx);
    expect(xml).toContain('<p:grpSp>');
    expect(xml).toContain('<a:chOff');
    expect(xml).toContain('<a:chExt');
    expect(xml).toContain('<p:sp>');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write `group.ts`**

```ts
// packages/slides/src/export/pptx/group.ts
import type { Element, Frame, GroupElement, ImageElement } from '../../model/element.js';
import type { ConnectorElement } from '../../model/connector.js';
import { pxToEmuX, pxToEmuY } from './units.js';
import { shapeToXml } from './shape.js';
import { imageToXml } from './image.js';
import { tableToXml } from './table.js';
import { connectorToXml } from './connector.js';

export interface ElementXmlCtx {
  resolveImageRId(el: ImageElement): string;
  connectorFrame(el: ConnectorElement): Frame;
}

export function elementToXml(el: Element, ctx: ElementXmlCtx): string {
  switch (el.type) {
    case 'shape':
    case 'text':
      // text elements export as a rect shape carrying the text body
      return shapeToXml(el.type === 'text' ? textElementAsShape(el) : el);
    case 'image':
      return imageToXml(el, ctx.resolveImageRId(el));
    case 'table':
      return tableToXml(el);
    case 'connector':
      return connectorToXml(el, ctx.connectorFrame(el));
    case 'group':
      return groupToXml(el, ctx);
  }
}

function textElementAsShape(el: Extract<Element, { type: 'text' }>) {
  return {
    id: el.id,
    frame: el.frame,
    type: 'shape' as const,
    data: { kind: 'rect' as const, text: el.data, fill: el.data.fill, stroke: el.data.stroke, effects: el.data.effects, alt: el.data.alt },
  };
}

export function groupToXml(el: GroupElement, ctx: ElementXmlCtx): string {
  const { frame } = el;
  const ref = el.data.refSize ?? { w: frame.w, h: frame.h };
  const xfrm =
    `<a:xfrm><a:off x="${pxToEmuX(frame.x)}" y="${pxToEmuY(frame.y)}"/><a:ext cx="${pxToEmuX(frame.w)}" cy="${pxToEmuY(frame.h)}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${pxToEmuX(ref.w)}" cy="${pxToEmuY(ref.h)}"/></a:xfrm>`;
  const nv = `<p:nvGrpSpPr><p:cNvPr id="0" name="${el.id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`;
  const children = el.data.children.map((c) => elementToXml(c, ctx)).join('');
  return `<p:grpSp>${nv}<p:grpSpPr>${xfrm}</p:grpSpPr>${children}</p:grpSp>`;
}
```

> **Note:** child coordinate space — the importer reads group children in group-local coords with `chOff/chExt` defining the mapping. Confirm against `src/import/pptx/group.ts` that `chExt = refSize` and child frames are group-local; the round-trip group fixture (Task 14) is the gate.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX group + element dispatch"`

---

### Task 10: Theme / master / layout serialization

**Files:**
- Create: `packages/slides/src/export/pptx/theme.ts`
- Create: `packages/slides/src/export/pptx/master.ts`
- Create: `packages/slides/src/export/pptx/layout.ts`
- Test: `packages/slides/test/export/pptx/theme.test.ts`

**Interfaces:**
- Consumes: `colorChildXml` (color); `Theme`, `ColorScheme`, `FontScheme` (model/theme), `Master` (model/master), `Layout` (model/layout); `ROLE_TO_SCHEME`.
- Produces:
  - `themeToXml(theme: Theme, index: number): string` — `<a:theme><a:themeElements><a:clrScheme><a:fontScheme><a:fmtScheme/>`.
  - `masterToXml(master: Master, index: number): string` — `<p:sldMaster>` with background + `<p:clrMap>` + `<p:sldLayoutIdLst>` (filled by orchestrator rels).
  - `layoutToXml(layout: Layout, index: number): string` — `<p:sldLayout type="…" matchingName="…">` carrying the built-in layout `type` so the importer re-derives the same id.

- [ ] **Step 1: Write the failing test** (focus on clrScheme + layout type round-trip)

```ts
// packages/slides/test/export/pptx/theme.test.ts
import { describe, it, expect } from 'vitest';
import { themeToXml } from '../../../src/export/pptx/theme.js';
import { layoutToXml } from '../../../src/export/pptx/layout.js';
import { defaultLight } from '../../../src/themes/default-light.js';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout.js';

describe('theme/layout', () => {
  it('emits a 12-slot clrScheme and a fontScheme', () => {
    const xml = themeToXml(defaultLight, 1);
    expect(xml).toContain('<a:clrScheme');
    expect(xml).toContain('<a:dk1>');
    expect(xml).toContain('<a:accent1>');
    expect(xml).toContain('<a:fontScheme');
  });
  it('emits layout type so import re-derives the same id', () => {
    const layout = BUILT_IN_LAYOUTS[0];
    const xml = layoutToXml(layout, 1);
    expect(xml).toContain('<p:sldLayout');
    expect(xml).toContain(`type="`);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `theme.ts`/`master.ts`/`layout.ts`.**

Read `src/import/pptx/theme.ts`, `master.ts`, `layout.ts` for the exact inverse. The clrScheme maps the deck's `ColorScheme` back to the 12 OOXML slots (`dk1/lt1/dk2/lt2/accent1..6/hlink/folHlink`) via `colorChildXml`; the fontScheme maps `FontScheme.major/minor` to `<a:majorFont><a:latin>`/`<a:minorFont>`. The layout emits `type` and `matchingName` from the built-in layout's OOXML type (the importer maps OOXML layout `type` → built-in layout id via a table in `import/pptx/layout.ts` — emit the inverse). Provide a static `<a:fmtScheme>` boilerplate (PowerPoint requires it; a minimal valid block is fine — copy from `build-minimal-pptx.ts`'s THEME constant).

```ts
// packages/slides/src/export/pptx/theme.ts (core; full clrScheme/fontScheme)
import type { Theme } from '../../model/theme.js';
import { colorChildXml } from './color.js';

const FMT_SCHEME = `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>`;

export function themeToXml(theme: Theme, index: number): string {
  const c = theme.colors;
  const slot = (name: string, role: keyof typeof c) => `<a:${name}>${colorChildXml({ kind: 'role', role: role as never })}</a:${name}>`;
  // NOTE: emit srgb values from the resolved scheme — read import/pptx/theme.ts
  // for whether clrScheme stores raw hex (it does); map ColorScheme[role] → <a:srgbClr>.
  const clr = `<a:clrScheme name="${theme.name ?? 'Theme'}">${slot('dk1', 'text')}${slot('lt1', 'background')}${slot('dk2', 'textSecondary')}${slot('lt2', 'backgroundAlt')}${slot('accent1', 'accent1')}${slot('accent2', 'accent2')}${slot('accent3', 'accent3')}${slot('accent4', 'accent4')}${slot('accent5', 'accent5')}${slot('accent6', 'accent6')}${slot('hlink', 'hyperlink')}${slot('folHlink', 'visitedHyperlink')}</a:clrScheme>`;
  const fonts = `<a:fontScheme name="${theme.name ?? 'Theme'}"><a:majorFont><a:latin typeface="${theme.fonts.major}"/></a:majorFont><a:minorFont><a:latin typeface="${theme.fonts.minor}"/></a:minorFont></a:fontScheme>`;
  return `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Theme${index}"><a:themeElements>${clr}${fonts}${FMT_SCHEME}</a:themeElements></a:theme>`;
}
```

> The exact `ColorScheme`/`FontScheme`/`Theme` field names must be confirmed from `src/model/theme.ts` (the explorer quoted `ColorRole` but the implementer must read the `ColorScheme`/`Theme.colors`/`Theme.fonts` shapes and adjust `slot()` to emit `<a:srgbClr val>` from the stored hex, since clrScheme is absolute, not role-relative).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX theme/master/layout serialization"`

---

### Task 11: Animation + transition serialization

**Files:**
- Create: `packages/slides/src/export/pptx/animation.ts`
- Test: `packages/slides/test/export/pptx/animation.test.ts`

**Interfaces:**
- Consumes: `SlideAnimation`, `SlideTransition` (model/presentation or model/anim — confirm location).
- Produces:
  - `transitionToXml(t: SlideTransition): string` → `<p:transition>` (preserve `pptxPreset` if the model stores the raw OOXML transition node/preset; else emit the closest preset).
  - `animationsToTimingXml(anims: SlideAnimation[]): string` → `<p:timing>` (best-effort; preserve preserved preset ids).

- [ ] **Step 1: Write the failing test** (read `src/model` + `src/import/pptx/timing.ts`/`anim-preset-map.ts` first to learn the exact stored shape; write the test against real fields).

```ts
// packages/slides/test/export/pptx/animation.test.ts
import { describe, it, expect } from 'vitest';
import { transitionToXml, animationsToTimingXml } from '../../../src/export/pptx/animation.js';

describe('animation', () => {
  it('emits a transition element', () => {
    // Shape per actual SlideTransition model — adjust after reading the model.
    const xml = transitionToXml({ type: 'fade' } as never);
    expect(xml).toContain('<p:transition');
  });
  it('returns empty timing for no animations', () => {
    expect(animationsToTimingXml([])).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** mirroring `src/import/pptx/timing.ts` + `anim-preset-map.ts`. Where the model preserves a raw OOXML preset id (`pptxPreset`-style field), write it straight back; otherwise emit the closest `<p:transition>`/`<p:par>` preset. Empty input → `''`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX animation/transition serialization (best-effort)"`

---

### Task 12: Slide + notes serialization

**Files:**
- Create: `packages/slides/src/export/pptx/slide.ts`
- Test: `packages/slides/test/export/pptx/slide.test.ts`

**Interfaces:**
- Consumes: `elementToXml`, `ElementXmlCtx` (group); `solidFillXml`/`colorChildXml` (color, for background); `transitionToXml`, `animationsToTimingXml` (animation); `textBodyToXml` (notes wrap as a body); `Slide`, `Background` (model/presentation), `Block` (notes).
- Produces:
  - `slideToXml(slide: Slide, ctx: ElementXmlCtx): string` → `<p:sld><p:cSld><p:bg>…<p:spTree>{elements}</p:spTree></p:cSld>{transition}{timing}</p:sld>`.
  - `notesSlideToXml(notes: Block[]): string` → `<p:notes>` with a body placeholder shape carrying the notes text.
  - The `<p:spTree>` requires a leading `<p:nvGrpSpPr>`/`<p:grpSpPr>` boilerplate (copy from `build-minimal-pptx.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/test/export/pptx/slide.test.ts
import { describe, it, expect } from 'vitest';
import { slideToXml } from '../../../src/export/pptx/slide.js';
import type { Slide } from '../../../src/model/presentation.js';
import type { ElementXmlCtx } from '../../../src/export/pptx/group.js';

const ctx: ElementXmlCtx = { resolveImageRId: () => 'rId1', connectorFrame: () => ({ x: 0, y: 0, w: 1, h: 1, rotation: 0 }) };

describe('slideToXml', () => {
  it('emits sld with spTree and a shape', () => {
    const slide: Slide = {
      id: 's1', layoutId: 'blank', background: { fill: { kind: 'role', role: 'background' } },
      elements: [{ id: 'sh', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, type: 'shape', data: { kind: 'rect' } }],
      notes: [],
    } as unknown as Slide;
    const xml = slideToXml(slide, ctx);
    expect(xml).toContain('<p:sld');
    expect(xml).toContain('<p:spTree>');
    expect(xml).toContain('<p:sp>');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write `slide.ts`** (background + spTree boilerplate + elements + transition/timing; notes slide). Mirror `src/import/pptx/index.ts` slide parse for the background + spTree structure.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add PPTX slide + notes serialization"`

---

### Task 13: presentation.xml + exportPptx orchestrator + node/index exports

**Files:**
- Create: `packages/slides/src/export/pptx/presentation.ts`
- Create: `packages/slides/src/export/pptx/index.ts`
- Modify: `packages/slides/src/node.ts` (add re-export)
- Modify: `packages/slides/src/index.ts` (add re-export)
- Test: `packages/slides/test/export/pptx/export.test.ts`

**Interfaces:**
- Consumes: everything above; `SlidesDocument` (model/presentation); `PptxWriter` (zip); `REL_TYPES` (templates).
- Produces:
  - `presentationToXml(deck: SlidesDocument, slideRIds: string[], masterRId: string): string` — `<p:presentation>` with `<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>`, `<p:sldMasterIdLst>`, `<p:sldIdLst>` (id 256+).
  - `interface ExportPptxOptions { fetchImage?: (src: string) => Promise<{ bytes: Uint8Array; mime: string }>; }`
  - `exportPptx(deck: SlidesDocument, opts?: ExportPptxOptions): Promise<Uint8Array>` — orchestrates: pre-scan images (dedup by src, resolve via `fetchImage`, `writer.addMedia` + per-slide `addRel`), build each slide/layout/master/theme part, wire rels, return `writer.build()`.
  - image `mime`→`ext` map (`image/png`→png, etc.).

- [ ] **Step 1: Write the failing test** (the first end-to-end smoke)

```ts
// packages/slides/test/export/pptx/export.test.ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { importPptx } from '../../../src/import/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import '../../../../cli/src/docs/dom-polyfill.js'; // DOMParser for importPptx (or local polyfill)

describe('exportPptx', () => {
  it('produces a zip with required parts that re-imports', async () => {
    const { document: deck } = await importPptx(await buildMinimalPptx());
    const bytes = await exportPptx(deck);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/presentation.xml')).not.toBeNull();
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    // Re-import must not throw and yields one slide.
    const reimported = await importPptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(reimported.document.slides).toHaveLength(1);
  });
});
```

> The DOMParser polyfill: importPptx needs `DOMParser`. In the slides test env, add a `@vitest-environment jsdom` directive OR a local polyfill via `@xmldom/xmldom` (already a CLI dep; add to slides devDeps if needed). Prefer `// @vitest-environment jsdom` at the top of the round-trip tests.

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write `presentation.ts` and `index.ts`** (orchestrator wiring all parts + rels + media).
- [ ] **Step 4: Add re-exports**

```ts
// packages/slides/src/node.ts — append near importPptx exports
export { exportPptx } from './export/pptx/index.js';
export type { ExportPptxOptions } from './export/pptx/index.js';
```
```ts
// packages/slides/src/index.ts — append (browser entry parity)
export { exportPptx } from './export/pptx/index.js';
export type { ExportPptxOptions } from './export/pptx/index.js';
```

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Verify node entry stays DOM-free**

Run: `pnpm --filter @wafflebase/slides typecheck`
Then confirm no module under `export/pptx/` imports a DOM-only module (grep for `canvas`, `OffscreenCanvas`, `document.`).

- [ ] **Step 7: Commit** `git commit -m "Add exportPptx orchestrator + presentation.xml + node export"`

---

### Task 14: Model-equivalence round-trip suite + normalize()

**Files:**
- Create: `packages/slides/test/export/pptx/round-trip.test.ts`
- Create: `packages/slides/test/export/pptx/normalize.ts` (test helper)
- Create/extend: per-type round-trip fixtures using `build*Pptx` builders (extend `build-minimal-pptx.ts` with shapes/text/table/image/group/connector, or add `build-rich-pptx.ts`).

**Interfaces:**
- Produces:
  - `normalize(deck: SlidesDocument): unknown` — deep-clone that: zeroes `Slide.id`/`Element.id` (and group children recursively); sorts no collection that is order-significant (slides/elements stay ordered); deletes documented importer-lossy fields (list maintained in this file with a comment per exclusion); replaces intra-deck id references (e.g. connector `attached.elementId`, `layoutId`) with positional indices.
  - `fromDataUrl(src: string): Promise<{ bytes; mime }>` — decode `data:` URLs for the export `fetchImage`.

- [ ] **Step 1: Write the failing round-trip test**

```ts
// @vitest-environment jsdom
// packages/slides/test/export/pptx/round-trip.test.ts
import { describe, it, expect } from 'vitest';
import { importPptx } from '../../../src/import/pptx/index.js';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { normalize, fromDataUrl } from './normalize.js';

async function roundTrip(buf: ArrayBuffer) {
  const a = (await importPptx(buf)).document;
  const bytes = await exportPptx(a, { fetchImage: fromDataUrl });
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const b = (await importPptx(ab)).document;
  return { a, b };
}

describe('PPTX round-trip (model equivalence)', () => {
  it('minimal deck round-trips', async () => {
    const { a, b } = await roundTrip(await buildMinimalPptx());
    expect(normalize(b)).toEqual(normalize(a));
  });
  // Add: shapes, text, table, image, group, connector fixtures — one it() each.
});
```

- [ ] **Step 2: Run — expect FAIL** (until normalize + any serializer gaps are fixed).
- [ ] **Step 3: Write `normalize.ts`**, then iterate each serializer until the minimal fixture passes; add one fixture per element type and fix the corresponding serializer's inverse mismatches (this is where the per-module `> Note:` items get resolved against real OOXML).
- [ ] **Step 4: Run — expect PASS** for every fixture.
- [ ] **Step 5: Run the whole slides suite** `pnpm --filter @wafflebase/slides test` — expect PASS.
- [ ] **Step 6: Commit** `git commit -m "Add PPTX model-equivalence round-trip suite"`

---

### Task 15: CLI `slides export` command

**Files:**
- Create: `packages/cli/src/slides/pptx-export.ts`
- Modify: `packages/cli/src/commands/slides.ts` (add `export` command + import)
- Test: `packages/cli/test/slides-export.test.ts`

**Interfaces:**
- Consumes: `exportPptx` from `@wafflebase/slides/node`; `getSlidesContent` (already added); `createImageFetcher` (docs/image-fetcher — returns Blob), `writeBinary` (output/binary).
- Produces:
  - `exportPptxCli(deck: SlidesDocument, opts: { imageFetcher?: (url: string) => Promise<Blob> }): Promise<Uint8Array>` — adapts the Blob-based CLI `ImageFetcher` to `exportPptx`'s `fetchImage` ({bytes,mime}) by reading `blob.arrayBuffer()` + `blob.type`.
  - `slides export <doc-id> <file> [--force]` command — format inferred from `.pptx` ext (or `--format pptx`); mirrors `docs export`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/slides-export.test.ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportPptxCli } from '../src/slides/pptx-export.js';
import type { SlidesDocument } from '@wafflebase/slides/node';

function deck(): SlidesDocument {
  return {
    meta: { title: 'T', themeId: 'default-light', masterId: 'default' },
    themes: [], masters: [], layouts: [],
    slides: [{ id: 's1', layoutId: 'blank', background: { fill: { kind: 'role', role: 'background' } }, elements: [], notes: [] }],
    guides: [],
  } as unknown as SlidesDocument;
}

describe('exportPptxCli', () => {
  it('returns pptx bytes with a slide part', async () => {
    const bytes = await exportPptxCli(deck(), {});
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `pnpm --filter @wafflebase/cli exec vitest run test/slides-export.test.ts`

- [ ] **Step 3: Write `pptx-export.ts`**

```ts
// packages/cli/src/slides/pptx-export.ts
import { exportPptx, type SlidesDocument } from '@wafflebase/slides/node';

export interface CliPptxExportOptions {
  /** Blob-returning fetcher (the CLI's shared image fetcher). */
  imageFetcher?: (url: string) => Promise<Blob>;
}

export async function exportPptxCli(
  deck: SlidesDocument,
  opts: CliPptxExportOptions = {},
): Promise<Uint8Array> {
  const fetchImage = opts.imageFetcher
    ? async (src: string) => {
        const blob = await opts.imageFetcher!(src);
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/png' };
      }
    : undefined;
  return exportPptx(deck, { fetchImage });
}
```

- [ ] **Step 4: Add the `export` command to `commands/slides.ts`**

```ts
// add imports
import { writeBinary } from '../output/binary.js';
import { createImageFetcher } from '../docs/image-fetcher.js';
import { exportPptxCli } from '../slides/pptx-export.js';
import { extname } from 'node:path';

// inside registerSlidesCommand, after `content`:
slides
  .command('export <doc-id> <file>')
  .description('Export a slide deck to PPTX')
  .option('--force', 'Overwrite existing output file', false)
  .action(async function (this: Command, docId: string, file: string) {
    const opts = getGlobalOpts(this);
    const local = this.opts<{ force: boolean }>();
    try {
      const formatSource = this.getOptionValueSourceWithGlobals('format');
      const fmt = formatSource === 'cli' ? opts.format : undefined;
      if (fmt && fmt !== 'pptx') throw new Error(`Invalid --format "${fmt}". Only "pptx" is supported.`);
      if (!fmt && extname(file).toLowerCase() !== '.pptx') {
        throw new Error(`Cannot infer format from "${file}". Use a .pptx extension or --format pptx.`);
      }
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'GET', `/documents/${docId}/content`);
        return;
      }
      const res = await getClient(opts).getSlidesContent(docId);
      if (!res.ok) {
        const body = res.data as { error?: { code?: string } } | null;
        if (body?.error) { console.error(JSON.stringify(body, null, 2)); process.exitCode = 1; return; }
        throw new Error(`HTTP ${res.status}`);
      }
      const imageFetcher = createImageFetcher({ serverBase: getConfig(opts).server });
      const bytes = await exportPptxCli(res.data, { imageFetcher });
      writeBinary(bytes, file, { force: local.force, quiet: opts.quiet });
    } catch (e) {
      outputError(e, opts.quiet);
    }
  });
```

- [ ] **Step 5: Run both tests — expect PASS.**

Run: `pnpm --filter @wafflebase/cli exec vitest run test/slides-export.test.ts test/namespaces.test.ts`

- [ ] **Step 6: Extend `namespaces.test.ts`** — add `'export'` to the `slides contains …` sub-command list assertion.
- [ ] **Step 7: Commit** `git commit -m "Add wafflebase slides export (PPTX) command"`

---

### Task 16: Schema, skill, and docs

**Files:**
- Modify: `packages/cli/src/schema/registry.ts` (add `slides.export`)
- Create: `packages/cli/skills/slides-export-pptx.md`
- Modify: `packages/cli/skills/SKILL.md` (index row)
- Modify: `docs/design/cli.md` (command tree + schema table)
- Modify: `docs/design/cli.md` — remove the "PPTX export has no engine" deferral note added in Phase 1
- Test: extend `packages/cli/test/schema.test.ts` if it enumerates commands

**Interfaces:** none (docs/metadata only).

- [ ] **Step 1: Add the schema entry**

```ts
// in registry.ts, after slides.content
{
  name: 'slides.export',
  description: 'Export a slide deck to PPTX',
  safety: 'read-only',
  parameters: {
    'doc-id': { type: 'string', required: true, description: 'Document ID' },
    file: { type: 'string', required: true, description: 'Output path or - for stdout' },
    '--format': { type: 'string', required: false, description: 'Output format (pptx); default from extension' },
    '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
  },
  response: { type: 'binary', description: 'PPTX bytes' },
  aliases: ['slide.export', 'deck.export', 'decks.export'],
},
```

- [ ] **Step 2: Write `skills/slides-export-pptx.md`** (frontmatter `name/description/safety: read-only/tools: [wafflebase slides export]`, When-to-Use, Commands, Safety — mirror `docs-export-docx.md`).
- [ ] **Step 3: Add the SKILL.md index row** under Slides Skills:
  `| [slides-export-pptx.md](slides-export-pptx.md) | read-only | Export a deck to .pptx |`
- [ ] **Step 4: Update `docs/design/cli.md`** — add `export <doc-id> <file> [--format pptx] [--force]` to the slides command-tree block; add the `slides.export` row to the schema table; delete the Phase-1 sentence "`slides export pptx` ... no PPTX export engine exists" / adjust the deferral paragraph to note PPTX export now ships (PDF still deferred).
- [ ] **Step 5: Run** `pnpm --filter @wafflebase/cli test` — expect PASS (schema + namespaces).
- [ ] **Step 6: Commit** `git commit -m "Document slides export: schema, skill, cli.md"`

---

## Self-Review

**Spec coverage** (design doc §-by-§):
- §1 package structure → Tasks 1–13 (every module has a task).
- §2 part/rels assembly → Task 2 (PptxWriter).
- §3 coordinates/colors/text → Tasks 1, 3, 4.
- §4 elements (text/shape/freeform/image/table/connector/group/effects) → Tasks 4–9.
- §5 theme/master/layout/animation → Tasks 10, 11.
- §6 round-trip + normalize → Task 14.
- §7 CLI integration → Tasks 15, 16.
- §8 public surface (node.ts + index.ts) → Task 13.

**Placeholder scan:** Tasks 10–12 intentionally defer exact XML to "read the inverse importer module" because the boilerplate is large and the round-trip suite (Task 14) is the authoritative gate — each carries a concrete core implementation + the precise importer file to invert. All other tasks have complete, runnable code + tests.

**Type consistency:** `ElementXmlCtx` (Task 9) is consumed by Tasks 12–13; `textBodyToXml` tag-parameterization (Task 4 note ↔ Task 5/7 usage) flagged for reconciliation in Task 4 Step 3; `fetchImage: (src) => {bytes,mime}` (Task 13) ↔ `exportPptxCli` Blob adapter (Task 15) consistent; `PptxWriter` API (Task 2) used uniformly in Task 13.

**Known risk carried into execution:** Tasks 10/11/12 require reading the corresponding importer modules to nail exact inverse XML; the round-trip fixtures in Task 14 will surface any mismatch as a failing test (this is the intended TDD loop for those modules).
