import { initialize, getBlockText, Doc, MemDocStore } from './src/index.js';
import {
  PARAGRAPHS,
  TITLE_INDEX,
  AUTHOR_INDEX,
  CHAPTER_TITLE_INDICES,
} from './sample-text.js';

// Create a store pre-populated with a full-length book for visual testing
const store = new MemDocStore();
const doc = Doc.create();

// Build blocks from the sample book (Alice's Adventures in Wonderland)
for (let i = 1; i < PARAGRAPHS.length; i++) {
  doc.splitBlock(doc.document.blocks[doc.document.blocks.length - 1].id, 0);
}

for (let i = 0; i < PARAGRAPHS.length; i++) {
  const blockId = doc.document.blocks[i].id;
  doc.insertText({ blockId, offset: 0 }, PARAGRAPHS[i]);
}

// Style the book title
const titleBlock = doc.document.blocks[TITLE_INDEX];
doc.applyInlineStyle(
  {
    anchor: { blockId: titleBlock.id, offset: 0 },
    focus: { blockId: titleBlock.id, offset: PARAGRAPHS[TITLE_INDEX].length },
  },
  { fontSize: 28, bold: true },
);
doc.applyBlockStyle(titleBlock.id, { alignment: 'center' });

// Style the author line
const authorBlock = doc.document.blocks[AUTHOR_INDEX];
doc.applyInlineStyle(
  {
    anchor: { blockId: authorBlock.id, offset: 0 },
    focus: { blockId: authorBlock.id, offset: PARAGRAPHS[AUTHOR_INDEX].length },
  },
  { fontSize: 18 },
);
doc.applyBlockStyle(authorBlock.id, { alignment: 'center' });

// Style chapter titles as headings
for (const idx of CHAPTER_TITLE_INDICES) {
  const block = doc.document.blocks[idx];
  if (!block) continue;
  const text = getBlockText(block);
  doc.applyInlineStyle(
    {
      anchor: { blockId: block.id, offset: 0 },
      focus: { blockId: block.id, offset: text.length },
    },
    { fontSize: 20, bold: true },
  );
}

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
