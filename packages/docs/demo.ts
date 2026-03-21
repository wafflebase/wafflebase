import { initialize, getBlockText } from './src/index.js';

const container = document.getElementById('editor-container')!;
const editor = initialize(container);

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
