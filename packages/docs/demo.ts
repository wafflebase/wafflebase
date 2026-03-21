import { initialize, getBlockText, Doc, MemDocStore } from './src/index.js';

// Create a store pre-populated with multi-page content for visual testing
const store = new MemDocStore();
const doc = Doc.create();

// Add enough paragraphs to span multiple pages
const sampleText = [
  'Document Pagination Demo',
  'This document demonstrates the pagination feature of the Canvas-based document editor. The document is divided into discrete pages with configurable paper size, orientation, and margins.',
  'Pages are rendered with Google Docs-style visual separation: a light gray background, drop shadows, and 40px gaps between pages. Lines that overflow a page boundary are automatically pushed to the next page.',
  'The pagination engine works as a post-processing layer that sits between the layout engine and the renderer. The layout engine computes a continuous flow of lines, and the pagination engine splits them into pages at line boundaries.',
  'Each page has a standard Letter size (8.5 x 11 inches at 96dpi = 816 x 1056 pixels) with 1-inch margins on all sides. The content area within each page is 624 x 864 pixels.',
  'Block margins (the spacing between paragraphs) follow standard word processor conventions: marginTop is suppressed at the top of a page, and marginBottom is applied only after the last line group of a block on a given page.',
  'Coordinate mapping has been updated to work with paginated layouts. Clicking on a page correctly maps to document positions, and the cursor renders at the correct page-relative coordinates.',
  'Selection highlighting works across page boundaries. When a selection spans multiple pages, each page renders only the selection rectangles that belong to it, with proper content-area clipping.',
  'The viewport culling optimization ensures that only visible pages are rendered, which is important for performance in documents with many pages.',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.',
  'At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.',
  'This is the final paragraph of the demo. If pagination is working correctly, you should see multiple pages with gray background, white pages with shadows, and proper text flow across page boundaries.',
];

// Build blocks: first block is the title, rest are body paragraphs
for (let i = 1; i < sampleText.length; i++) {
  doc.splitBlock(doc.document.blocks[doc.document.blocks.length - 1].id, 0);
}

// Insert text into each block
for (let i = 0; i < sampleText.length; i++) {
  const blockId = doc.document.blocks[i].id;
  doc.insertText({ blockId, offset: 0 }, sampleText[i]);
}

// Make the title larger
doc.applyInlineStyle(
  {
    anchor: { blockId: doc.document.blocks[0].id, offset: 0 },
    focus: { blockId: doc.document.blocks[0].id, offset: sampleText[0].length },
  },
  { fontSize: 24, bold: true },
);

store.setDocument(doc.document);

const container = document.getElementById('editor-container')!;
const editor = initialize(container, store);

// Expose test bridge for Playwright IME tests
(window as any).__WB_DOC__ = {
  isReady: () => true,
  getDocText: () => {
    const doc = editor.getDoc();
    return doc.document.blocks.map((b) => getBlockText(b)).join('\n');
  },
  getBlockCount: () => editor.getDoc().document.blocks.length,
  focus: () => editor.focus(),
};

// --- Event Logger ---
// Logs all IME-related events on the hidden textarea to help debug
// cross-browser differences in composition event sequences.
const logEl = document.getElementById('event-log')!;
let eventSeq = 0;

function logEvent(type: string, cls: string, detail: string) {
  const line = document.createElement('div');
  const seqSpan = document.createElement('span');
  seqSpan.style.color = '#666';
  seqSpan.textContent = String(++eventSeq).padStart(3, ' ') + ' ';
  const typeSpan = document.createElement('span');
  typeSpan.className = cls;
  typeSpan.textContent = type.padEnd(20) + ' ';
  const detailSpan = document.createElement('span');
  detailSpan.textContent = detail;
  line.append(seqSpan, typeSpan, detailSpan);
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function escVal(s: string | null | undefined): string {
  if (s == null) return '<null>';
  return `"${s}"`;
}

// Attach listeners to the hidden textarea
const textarea = container.querySelector('textarea')!;

textarea.addEventListener('compositionstart', (e) => {
  logEvent('compositionstart', 'ev-comp', `data=${escVal(e.data)}`);
});
textarea.addEventListener('compositionupdate', (e) => {
  logEvent('compositionupdate', 'ev-comp',
    `data=${escVal(e.data)} textarea.value=${escVal(textarea.value)}`);
});
textarea.addEventListener('compositionend', (e) => {
  logEvent('compositionend', 'ev-comp',
    `data=${escVal(e.data)} textarea.value=${escVal(textarea.value)}`);
});
textarea.addEventListener('input', (e) => {
  const ie = e as InputEvent;
  logEvent('input', 'ev-input',
    `data=${escVal(ie.data)} inputType=${ie.inputType ?? '?'} ` +
    `isComposing=${ie.isComposing} textarea.value=${escVal(textarea.value)}`);
});
textarea.addEventListener('keydown', (e) => {
  logEvent('keydown', 'ev-key',
    `key=${escVal(e.key)} code=${e.code} isComposing=${e.isComposing}`);
});
textarea.addEventListener('keyup', (e) => {
  logEvent('keyup', 'ev-key',
    `key=${escVal(e.key)} code=${e.code} isComposing=${e.isComposing}`);
});

// Log panel toggle
const logPanel = document.getElementById('log-panel')!;
const toggleArrow = document.getElementById('toggle-arrow')!;
document.getElementById('log-panel-toggle')!.addEventListener('click', (e) => {
  // Don't toggle when clicking buttons inside the header
  if ((e.target as HTMLElement).tagName === 'BUTTON') return;
  logPanel.classList.toggle('collapsed');
  toggleArrow.innerHTML = logPanel.classList.contains('collapsed') ? '&#9660;' : '&#9650;';
});

document.getElementById('btn-clear-log')!.addEventListener('click', () => {
  logEl.innerHTML = '';
  eventSeq = 0;
});

document.getElementById('btn-copy-log')!.addEventListener('click', async () => {
  const btn = document.getElementById('btn-copy-log')!;
  try {
    await navigator.clipboard.writeText(logEl.innerText);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

// Also log the doc text after each render
const origRender = editor.render;
editor.render = () => {
  origRender();
  const doc = editor.getDoc();
  const text = doc.document.blocks.map((b) => getBlockText(b)).join('\\n');
  logEvent('doc-state', 'ev-val', `text=${escVal(text)}`);
};

// Toolbar buttons
document.getElementById('btn-bold')!.addEventListener('click', () => {
  editor.applyStyle({ bold: true });
  editor.focus();
});

document.getElementById('btn-italic')!.addEventListener('click', () => {
  editor.applyStyle({ italic: true });
  editor.focus();
});

document.getElementById('btn-underline')!.addEventListener('click', () => {
  editor.applyStyle({ underline: true });
  editor.focus();
});

document.getElementById('font-size')!.addEventListener('change', (e) => {
  const size = Number((e.target as HTMLSelectElement).value);
  editor.applyStyle({ fontSize: size });
  editor.focus();
});

document.getElementById('btn-align-left')!.addEventListener('click', () => {
  editor.applyBlockStyle({ alignment: 'left' });
  editor.focus();
});

document.getElementById('btn-align-center')!.addEventListener('click', () => {
  editor.applyBlockStyle({ alignment: 'center' });
  editor.focus();
});

document.getElementById('btn-align-right')!.addEventListener('click', () => {
  editor.applyBlockStyle({ alignment: 'right' });
  editor.focus();
});

document.getElementById('btn-undo')!.addEventListener('click', () => {
  editor.undo();
  editor.focus();
});

document.getElementById('btn-redo')!.addEventListener('click', () => {
  editor.redo();
  editor.focus();
});
