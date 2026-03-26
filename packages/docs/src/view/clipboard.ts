import type { Block, Inline, InlineStyle } from '../model/types.js';
import { inlineStylesEqual } from '../model/types.js';

interface ClipboardPayload {
  version: 1;
  blocks: Block[];
}

export function serializeBlocks(blocks: Block[]): string {
  const payload: ClipboardPayload = { version: 1, blocks };
  return JSON.stringify(payload);
}

export function deserializeBlocks(json: string): Block[] {
  const payload: ClipboardPayload = JSON.parse(json);
  if (payload.version !== 1) return [];
  return payload.blocks;
}

export const WAFFLEDOCS_MIME = 'application/x-waffledocs';

/**
 * Style-related HTML tag names (lowercased) and their InlineStyle mappings.
 */
const TAG_STYLE_MAP: Record<string, Partial<InlineStyle>> = {
  b: { bold: true },
  strong: { bold: true },
  i: { italic: true },
  em: { italic: true },
  u: { underline: true },
  s: { strikethrough: true },
  del: { strikethrough: true },
  strike: { strikethrough: true },
};

/**
 * Parse an HTML string into an array of Inline objects, preserving formatting.
 *
 * Walks the DOM tree produced by DOMParser, collecting text nodes with their
 * inherited style context from ancestor elements.
 */
export function parseHtmlToInlines(html: string): Inline[] {
  if (!html) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const inlines: Inline[] = [];

  function walk(node: Node, inherited: InlineStyle): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        inlines.push({ text, style: { ...inherited } });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const style: InlineStyle = { ...inherited };

    // Apply tag-based styles
    const tagStyle = TAG_STYLE_MAP[tag];
    if (tagStyle) {
      Object.assign(style, tagStyle);
    }

    // Handle <a> href
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        style.href = href;
      }
    }

    // Parse inline CSS styles
    if (el instanceof HTMLElement && el.style) {
      if (el.style.color) {
        style.color = el.style.color;
      }
      if (el.style.backgroundColor) {
        style.backgroundColor = el.style.backgroundColor;
      }
      if (el.style.fontSize) {
        const match = el.style.fontSize.match(/^(\d+(?:\.\d+)?)px$/);
        if (match) {
          style.fontSize = parseFloat(match[1]);
        }
      }
      if (el.style.fontWeight === 'bold' || parseInt(el.style.fontWeight) >= 700) {
        style.bold = true;
      }
      if (el.style.fontStyle === 'italic') {
        style.italic = true;
      }
      if (el.style.textDecoration?.includes('underline')) {
        style.underline = true;
      }
      if (el.style.textDecoration?.includes('line-through')) {
        style.strikethrough = true;
      }
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child, style);
    }
  }

  walk(doc.body, {});

  // Merge adjacent inlines with identical styles
  const merged: Inline[] = [];
  for (const inline of inlines) {
    if (merged.length > 0 && inlineStylesEqual(merged[merged.length - 1].style, inline.style)) {
      merged[merged.length - 1].text += inline.text;
    } else {
      merged.push(inline);
    }
  }

  return merged;
}
