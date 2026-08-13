import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { noteImageUpload, pendingImageUploads } from './image-upload.js';
import type { UploadImage } from './image-upload.js';

/** A promise whose settlement the test controls, to hold an upload in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function imageFile(name = 'photo.png'): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

/**
 * jsdom implements neither `DataTransfer` nor `ClipboardEvent`'s payload, so
 * the paste/drop payload is faked. `files` is what this feature reads;
 * `getData`/`types` are there because when we decline an event CodeMirror's own
 * paste handler runs next and would throw on a payload that only has files.
 * `Array.from` accepts any array-like — which is what a real `FileList` is.
 */
function transferData(files: File[], text = '') {
  return {
    files: Object.assign({}, files, { length: files.length }),
    types: text ? ['text/plain'] : [],
    getData: () => text,
  };
}

function firePaste(view: EditorView, files: File[], text = ''): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: transferData(files, text),
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

function fireDrop(view: EditorView, files: File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transferData(files) });
  Object.defineProperty(event, 'clientX', { value: 40 });
  Object.defineProperty(event, 'clientY', { value: 10 });
  view.contentDOM.dispatchEvent(event);
  return event;
}

/**
 * jsdom implements no layout and, unlike `Element`, gives `Range` no
 * `getClientRects`. An insert here completes asynchronously (after the upload
 * resolves), so CodeMirror's scroll-into-view measure runs for real instead of
 * being torn down first — and throws out-of-band without this. Empty rects are
 * the honest answer for a document that was never laid out.
 */
const noRects = () => [] as unknown as DOMRectList;
let originalGetClientRects: typeof Range.prototype.getClientRects | undefined;
beforeAll(() => {
  originalGetClientRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = noRects;
});
afterAll(() => {
  if (originalGetClientRects) {
    Range.prototype.getClientRects = originalGetClientRects;
  } else {
    delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  }
});

const views: EditorView[] = [];

function mount(doc: string, caret: number, upload: UploadImage): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [noteImageUpload(upload)],
    }),
    // Deliberately not attached to the document: jsdom has no layout, so
    // CodeMirror's measure pass on an attached view throws on Range APIs it
    // does not implement. Event handlers and DOM updates run either way,
    // which is all these tests exercise (as in commands.test.ts).
  });
  views.push(view);
  return view;
}

afterEach(() => {
  let view: EditorView | undefined;
  while ((view = views.pop())) view.destroy();
});

describe('note image upload', () => {
  it('uploads a pasted image and inserts it at the caret', async () => {
    const upload = vi.fn<UploadImage>().mockResolvedValue('/img/a.png');
    const view = mount('hello', 5, upload);

    const event = firePaste(view, [imageFile('photo.png')]);
    expect(event.defaultPrevented).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));
    // Alt text is the filename without its extension; the image gets its own
    // line, so a caret mid-line breaks out of it first.
    expect(view.state.doc.toString()).toBe('hello\n![photo](/img/a.png)\n');
  });

  it('inserts a dropped image at the drop point, not at the caret', async () => {
    const upload = vi.fn<UploadImage>().mockResolvedValue('/img/b.png');
    const view = mount('one\ntwo', 7, upload);
    // jsdom has no layout, so posAtCoords cannot resolve real coordinates.
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 0;

    const event = fireDrop(view, [imageFile('b.png')]);
    expect(event.defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));
    expect(view.state.doc.toString()).toBe('![b](/img/b.png)\none\ntwo');
  });

  it('keeps the insertion point correct across edits made while uploading', async () => {
    const gate = deferred<string | null>();
    const view = mount('AB', 2, () => gate.promise);

    firePaste(view, [imageFile('late.png')]);
    expect(pendingImageUploads(view.state)).toBe(1);

    // A peer (or the user) inserts text ahead of the pending insertion point.
    // The ghost maps forward with it, so the image must still land after "AB".
    view.dispatch({ changes: { from: 0, insert: 'XYZ' } });

    gate.resolve('/img/late.png');
    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));
    expect(view.state.doc.toString()).toBe('XYZAB\n![late](/img/late.png)\n');
  });

  it('shows a placeholder while the upload is in flight and removes it after', async () => {
    const gate = deferred<string | null>();
    const view = mount('', 0, () => gate.promise);

    firePaste(view, [imageFile('slow.png')]);
    const ghost = view.contentDOM.querySelector('.cm-note-upload-ghost');
    expect(ghost?.textContent).toBe('Uploading slow.png…');

    gate.resolve('/img/slow.png');
    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));
    expect(view.contentDOM.querySelector('.cm-note-upload-ghost')).toBeNull();
  });

  it('leaves the document untouched when the upload fails', async () => {
    const upload = vi.fn<UploadImage>().mockRejectedValue(new Error('boom'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = mount('text', 4, upload);

    firePaste(view, [imageFile()]);
    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));

    expect(view.state.doc.toString()).toBe('text');
    expect(view.contentDOM.querySelector('.cm-note-upload-ghost')).toBeNull();
    errors.mockRestore();
  });

  it('drops the placeholder without inserting when the host cancels', async () => {
    const upload = vi.fn<UploadImage>().mockResolvedValue(null);
    const view = mount('text', 4, upload);

    firePaste(view, [imageFile()]);
    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));

    expect(view.state.doc.toString()).toBe('text');
  });

  it('ignores payloads with no image, leaving normal paste alone', () => {
    const upload = vi.fn<UploadImage>().mockResolvedValue('/img/x.png');
    const view = mount('text', 4, upload);

    // Declining the event lets CodeMirror's own paste handler run, which is
    // what inserts the clipboard text — the proof we did not swallow it.
    firePaste(view, [], ' typed');
    expect(upload).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('text typed');

    // A non-image file attachment is ignored just the same.
    firePaste(view, [new File(['x'], 'notes.txt', { type: 'text/plain' })], '!');
    expect(upload).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('text typed!');
  });

  it('inserts several pasted images in file order, not completion order', async () => {
    // The second upload finishes first — the ordinary case with files of
    // different sizes. Inserting as each completes would swap them, because
    // both placeholders share one anchor.
    const gates = new Map<string, ReturnType<typeof deferred<string | null>>>();
    const view = mount('', 0, (file) => {
      const gate = deferred<string | null>();
      gates.set(file.name, gate);
      return gate.promise;
    });

    firePaste(view, [imageFile('one.png'), imageFile('two.png')]);
    expect(pendingImageUploads(view.state)).toBe(2);

    gates.get('two.png')!.resolve('/img/two.png');
    await Promise.resolve();
    // Nothing may land yet: the first image has not been committed.
    expect(view.state.doc.toString()).toBe('');

    gates.get('one.png')!.resolve('/img/one.png');
    await vi.waitFor(() => expect(pendingImageUploads(view.state)).toBe(0));
    expect(view.state.doc.toString()).toBe(
      '![one](/img/one.png)\n![two](/img/two.png)\n',
    );
  });

  it('falls back to the caret when a resync replaces the whole document', async () => {
    const gate = deferred<string | null>();
    const view = mount('original text', 13, () => gate.promise);

    firePaste(view, [imageFile('snap.png')]);

    // What noteSync dispatches for a `replace` remote change (a Yorkie
    // snapshot resync): one change spanning the entire old document. Every
    // anchor inside it would otherwise collapse to position 0, dropping the
    // image at the top of the note.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'resynced body' },
      selection: EditorSelection.cursor(8),
    });

    // The placeholder is already gone (its anchor died with the old
    // document), so wait on the insert itself rather than on the count.
    expect(pendingImageUploads(view.state)).toBe(0);

    gate.resolve('/img/snap.png');
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toBe(
        'resynced\n![snap](/img/snap.png)\n body',
      ),
    );
  });

  it('does not upload into a read-only editor', () => {
    const upload = vi.fn<UploadImage>().mockResolvedValue('/img/x.png');
    const view = new EditorView({
      state: EditorState.create({
        doc: 'text',
        extensions: [noteImageUpload(upload), EditorView.editable.of(false)],
      }),
    });
    views.push(view);

    firePaste(view, [imageFile()]);
    expect(upload).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('text');
  });
});
