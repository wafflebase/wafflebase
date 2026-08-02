import { DEFAULT_BLOCK_STYLE, type Block, type Inline } from '@wafflebase/docs';

/** Inline formatting accumulated while walking the HTML tree. */
interface Marks { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean }

const TAG_MARKS: Record<string, keyof Marks> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italic',
  I: 'italic',
  U: 'underline',
  S: 'strikethrough',
};

function makeBlock(inlines: Inline[], index: number): Block {
  return {
    id: `miro-${index}`,
    type: 'paragraph',
    inlines: inlines.length ? inlines : [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

/**
 * Parse Miro's `data.content` HTML fragment into docs `Block[]`.
 *
 * Deliberately conservative: block breaks come from `<p>`/`<br>`, and
 * bold/italic/underline/strikethrough carry onto the inline style. Every other
 * tag degrades to its text content — rich-text fidelity is best-effort, and a
 * tag we do not model must never lose the user's words.
 */
export function miroHtmlToBlocks(html: string | undefined): Block[] {
  const source = (html ?? '').trim();
  if (!source) return [makeBlock([], 0)];

  const doc = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  const blocks: Block[] = [];
  let current: Inline[] = [];

  const flush = () => {
    if (current.length) {
      blocks.push(makeBlock(current, blocks.length));
      current = [];
    }
  };

  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === 3 /* text */) {
      const text = node.textContent ?? '';
      if (text) current.push({ text, style: { ...marks } });
      return;
    }
    if (node.nodeType !== 1 /* element */) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      flush();
      return;
    }

    const isBlock = tag === 'P' || tag === 'DIV' || tag === 'LI';
    if (isBlock) flush();

    const mark = TAG_MARKS[tag];
    const next = mark ? { ...marks, [mark]: true } : marks;
    for (const child of Array.from(el.childNodes)) walk(child, next);

    if (isBlock) flush();
  };

  for (const child of Array.from(doc.body.childNodes)) walk(child, {});
  flush();

  return blocks.length ? blocks : [makeBlock([], 0)];
}
