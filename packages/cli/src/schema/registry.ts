export type SafetyLevel = 'read-only' | 'write' | 'destructive';

/**
 * Per-command safety variant — used by `docs.import` to spell out that
 * the same command is `write` by default but `destructive` with
 * `--replace`. Skill agents read this to decide when extra confirmation
 * is needed.
 */
export interface SafetyVariant {
  when: string;
  safety: SafetyLevel;
  creates?: string;
  modifies?: string;
  removes?: string;
}

export interface CommandSchema {
  name: string;
  description: string;
  safety: SafetyLevel;
  parameters: Record<
    string,
    {
      type: string;
      required: boolean;
      description: string;
      default?: string;
    }
  >;
  response: Record<string, unknown>;
  /**
   * Singular / legacy / namespace-stripped names that should resolve to
   * this canonical entry. `getCommandSchema('cell.get')` returns the
   * `sheets.cells.get` schema because `'cell.get'` appears here.
   */
  aliases?: string[];
  /** Optional per-flag safety overrides (currently only `docs.import`). */
  variants?: SafetyVariant[];
}

const registry: CommandSchema[] = [
  {
    name: 'login',
    description: 'Authenticate via GitHub OAuth in the browser',
    safety: 'write',
    parameters: {
      '--server': { type: 'string', required: false, description: 'Server URL', default: 'https://api.wafflebase.io' },
      '--allow-unbound-callback': { type: 'boolean', required: false, description: 'Accept a login callback that carries no state (server predates nonce-bound CLI login); downgrades the binding that stops a local page from completing this login' },
    },
    response: { user: 'string', workspace: 'string' },
  },
  {
    name: 'logout',
    description: 'Clear session and log out',
    safety: 'write',
    parameters: {},
    response: {},
  },
  {
    name: 'status',
    description: 'Show current auth state',
    safety: 'read-only',
    parameters: {},
    response: {
      loggedIn: 'boolean',
      message: 'string (logged out only)',
      user: 'string',
      email: 'string',
      server: 'string',
      workspaceId: 'string',
      workspaceName: 'string | null',
      session: "'valid' | 'expired'",
      expiresAt: 'string',
    },
  },
  {
    name: 'ctx.list',
    description: 'List workspaces',
    safety: 'read-only',
    parameters: {},
    response: { type: 'array', items: { id: 'string', name: 'string', active: 'boolean' } },
  },
  {
    name: 'ctx.switch',
    description: 'Switch active workspace',
    safety: 'write',
    parameters: {
      'name-or-id': { type: 'string', required: true, description: 'Workspace name or ID' },
    },
    response: { workspace: 'string' },
  },

  // Docs (word-processor) namespace
  {
    name: 'docs.list',
    description: 'List documents in workspace',
    safety: 'read-only',
    parameters: {
      '--type': { type: 'string', required: false, description: 'Filter by document type (doc|sheet)' },
    },
    response: { type: 'array', items: { id: 'string', title: 'string', type: 'string', createdAt: 'string' } },
    aliases: ['doc.list', 'document.list', 'documents.list'],
  },
  {
    name: 'docs.create',
    description: 'Create a new document',
    safety: 'write',
    parameters: {
      title: { type: 'string', required: true, description: 'Document title' },
      '--type': { type: 'string', required: false, description: 'Document type (doc|sheet)', default: 'sheet' },
    },
    response: { id: 'string', title: 'string', type: 'string' },
    aliases: ['doc.create', 'document.create', 'documents.create'],
  },
  {
    name: 'docs.get',
    description: 'Show document metadata',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string', title: 'string', type: 'string', createdAt: 'string' },
    aliases: ['doc.get', 'document.get', 'documents.get'],
  },
  {
    name: 'docs.rename',
    description: 'Rename a document',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      title: { type: 'string', required: true, description: 'New title' },
    },
    response: { id: 'string', title: 'string' },
    aliases: ['doc.rename', 'document.rename', 'documents.rename'],
  },
  {
    name: 'docs.delete',
    description: 'Delete a document',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string' },
    aliases: ['doc.delete', 'document.delete', 'documents.delete'],
  },
  {
    name: 'docs.content',
    description: 'Read document content as JSON, Markdown, or plain text',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--format': { type: 'string', required: false, description: 'Output format (json|md|text)', default: 'json' },
      '--pages': { type: 'string', required: false, description: 'Page range (e.g. 1-3,5)' },
      '--include-header-footer': { type: 'boolean', required: false, description: 'Include header/footer (md/text)', default: 'false' },
      '--inline-images': { type: 'boolean', required: false, description: 'Inline data: image URLs (md only)', default: 'false' },
      '--out': { type: 'string', required: false, description: 'Output file (- for stdout)' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'object', description: 'Document JSON, Markdown text, or plaintext per --format' },
    aliases: ['doc.content', 'document.content', 'documents.content'],
  },
  {
    name: 'docs.export',
    description: 'Export a document to PDF or DOCX',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      file: { type: 'string', required: true, description: 'Output path or - for stdout' },
      '--format': { type: 'string', required: false, description: 'Output format (pdf|docx); default from extension' },
      '--pages': { type: 'string', required: false, description: 'Page range (PDF only)' },
      '--include-header-footer': { type: 'boolean', required: false, description: 'Include header/footer regions', default: 'true' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'binary', description: 'PDF or DOCX bytes' },
    aliases: ['doc.export', 'document.export', 'documents.export'],
  },
  {
    name: 'docs.import',
    description: 'Import a .docx file as a new (or replacement) document',
    // Default safety is `write` (create new doc); `--replace` flips it
    // to destructive. Variants spell this out for skill agents.
    safety: 'write',
    parameters: {
      file: { type: 'string', required: true, description: 'Source .docx path or - for stdin' },
      '--title': { type: 'string', required: false, description: 'Document title (default: file basename)' },
      '--replace': { type: 'string', required: false, description: 'Existing document ID to replace' },
      '--yes': { type: 'boolean', required: false, description: 'Skip --replace confirmation', default: 'false' },
    },
    response: { id: 'string', title: 'string', replaced: 'boolean' },
    variants: [
      { when: 'default', safety: 'write', creates: 'new document' },
      { when: '--replace given', safety: 'destructive', modifies: 'existing document content' },
    ],
    aliases: ['doc.import', 'document.import', 'documents.import'],
  },
  {
    name: 'docs.set-content',
    description: 'Replace document content from JSON (stdin or --data)',
    // A whole-content replace, not a merge — the same classification
    // `docs.import --replace` carries.
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--data': { type: 'string', required: false, description: 'Content as a JSON string (default: read stdin)' },
    },
    response: { type: 'object', description: 'The stored document JSON, echoed back by the server' },
    aliases: ['doc.set-content', 'document.set-content', 'documents.set-content'],
  },

  // Slides (presentation) namespace
  {
    name: 'slides.list',
    description: 'List slide decks in workspace',
    safety: 'read-only',
    parameters: {},
    response: { type: 'array', items: { id: 'string', title: 'string', type: 'string', createdAt: 'string' } },
    aliases: ['slide.list', 'deck.list', 'decks.list'],
  },
  {
    name: 'slides.create',
    description: 'Create a new slide deck',
    safety: 'write',
    parameters: {
      title: { type: 'string', required: true, description: 'Deck title' },
    },
    response: { id: 'string', title: 'string', type: 'string' },
    aliases: ['slide.create', 'deck.create', 'decks.create'],
  },
  {
    name: 'slides.get',
    description: 'Show slide deck metadata',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string', title: 'string', type: 'string', createdAt: 'string' },
    aliases: ['slide.get', 'deck.get', 'decks.get'],
  },
  {
    name: 'slides.rename',
    description: 'Rename a slide deck',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      title: { type: 'string', required: true, description: 'New title' },
    },
    response: { id: 'string', title: 'string' },
    aliases: ['slide.rename', 'deck.rename', 'decks.rename'],
  },
  {
    name: 'slides.delete',
    description: 'Delete a slide deck',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string' },
    aliases: ['slide.delete', 'deck.delete', 'decks.delete'],
  },
  {
    name: 'slides.content',
    description: 'Read deck content as JSON, Markdown, or plain text',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--format': { type: 'string', required: false, description: 'Output format (json|md|text)', default: 'json' },
      '--notes': { type: 'boolean', required: false, description: 'Include speaker notes (md/text)', default: 'false' },
      '--out': { type: 'string', required: false, description: 'Output file (- for stdout)' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'object', description: 'Deck JSON, Markdown text, or plaintext per --format' },
    aliases: ['slide.content', 'deck.content', 'decks.content'],
  },
  {
    name: 'slides.import',
    description: 'Import a .pptx file as a new (or replacement) slide deck',
    // Default safety is `write` (create new deck); `--replace` flips it
    // to destructive, mirroring `docs.import`.
    safety: 'write',
    parameters: {
      file: { type: 'string', required: true, description: 'Source .pptx path or - for stdin' },
      '--title': { type: 'string', required: false, description: 'Deck title (default: file basename)' },
      '--replace': { type: 'string', required: false, description: 'Existing deck ID to replace' },
      '--yes': { type: 'boolean', required: false, description: 'Skip --replace confirmation', default: 'false' },
    },
    response: { id: 'string', title: 'string', replaced: 'boolean' },
    variants: [
      { when: 'default', safety: 'write', creates: 'new slide deck' },
      { when: '--replace given', safety: 'destructive', modifies: 'existing deck content' },
    ],
    aliases: ['slide.import', 'deck.import', 'decks.import'],
  },
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
  {
    name: 'slides.set-content',
    description: 'Replace deck content from JSON (stdin or --data)',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--data': { type: 'string', required: false, description: 'Content as a JSON string (default: read stdin)' },
    },
    response: { type: 'object', description: 'The stored deck JSON, echoed back by the server' },
    aliases: ['slide.set-content', 'deck.set-content', 'decks.set-content'],
  },

  // Notes (markdown) namespace
  {
    name: 'notes.list',
    description: 'List notes in workspace',
    safety: 'read-only',
    parameters: {},
    response: { type: 'array', items: { id: 'string', title: 'string', type: 'string', createdAt: 'string' } },
    aliases: ['note.list'],
  },
  {
    name: 'notes.create',
    description: 'Create a new note',
    safety: 'write',
    parameters: {
      title: { type: 'string', required: true, description: 'Note title' },
    },
    response: { id: 'string', title: 'string', type: 'string' },
    aliases: ['note.create'],
  },
  {
    name: 'notes.get',
    description: 'Show note metadata',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string', title: 'string', type: 'string', createdAt: 'string' },
    aliases: ['note.get'],
  },
  {
    name: 'notes.rename',
    description: 'Rename a note',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      title: { type: 'string', required: true, description: 'New title' },
    },
    response: { id: 'string', title: 'string' },
    aliases: ['note.rename'],
  },
  {
    name: 'notes.delete',
    description: 'Delete a note',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string' },
    aliases: ['note.delete'],
  },
  {
    name: 'notes.content',
    description: 'Read note content as JSON or Markdown',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--format': { type: 'string', required: false, description: 'Output format (json|md|text)', default: 'json' },
      '--out': { type: 'string', required: false, description: 'Output file (- for stdout)' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'object', description: 'Note JSON ({content}) or raw Markdown per --format' },
    aliases: ['note.content'],
  },
  {
    name: 'notes.import',
    description: 'Import a Markdown file as a new (or replacement) note',
    // Default safety is `write` (create new note); `--replace` flips it to
    // destructive, mirroring `docs.import` / `slides.import`.
    safety: 'write',
    parameters: {
      file: { type: 'string', required: true, description: 'Source .md path or - for stdin' },
      '--title': { type: 'string', required: false, description: 'Note title (default: file basename)' },
      '--replace': { type: 'string', required: false, description: 'Existing note ID to replace' },
      '--yes': { type: 'boolean', required: false, description: 'Skip --replace confirmation', default: 'false' },
    },
    response: { id: 'string', title: 'string', replaced: 'boolean' },
    variants: [
      { when: 'default', safety: 'write', creates: 'new note' },
      { when: '--replace given', safety: 'destructive', modifies: 'existing note content' },
    ],
    aliases: ['note.import'],
  },
  {
    name: 'notes.export',
    description: 'Export a note to Markdown',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      file: { type: 'string', required: true, description: 'Output path or - for stdout' },
      '--format': { type: 'string', required: false, description: 'Output format (md); default from extension' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'string', description: 'Markdown text' },
    aliases: ['note.export'],
  },
  {
    name: 'notes.set-content',
    description: 'Replace note content from JSON (stdin or --data)',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--data': { type: 'string', required: false, description: 'Content as a JSON string (default: read stdin)' },
    },
    response: { type: 'object', description: 'The stored note JSON ({content}), echoed back by the server' },
    aliases: ['note.set-content'],
  },

  // Files (blob documents) namespace
  {
    name: 'files.upload',
    description:
      'Upload any file as a document (stored as bytes; never parsed)',
    safety: 'write',
    parameters: {
      file: { type: 'string', required: true, description: 'Source file path (no stdin: the type comes from the filename)' },
      '--title': { type: 'string', required: false, description: 'Document title (default: file basename)' },
    },
    response: { id: 'string', title: 'string', type: 'string', fileSize: 'number', mimeType: 'string' },
    aliases: ['file.upload'],
  },
  {
    name: 'files.download',
    description: 'Download the bytes of a file document',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      out: { type: 'string', required: false, description: 'Output path, - for stdout (default: the document filename)' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'binary', description: 'Stored file bytes' },
    aliases: ['file.download'],
  },
  {
    name: 'files.list',
    description: 'List blob documents (file, pdf, image) in workspace',
    safety: 'read-only',
    parameters: {
      '--type': { type: 'string', required: false, description: 'Filter by a single type (file|pdf|image)' },
    },
    response: { type: 'array', items: { id: 'string', title: 'string', type: 'string', fileSize: 'number' } },
    aliases: ['file.list'],
  },
  {
    name: 'files.get',
    description: 'Show file document metadata',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string', title: 'string', type: 'string', fileSize: 'number', mimeType: 'string' },
    aliases: ['file.get'],
  },
  {
    name: 'files.rename',
    description: 'Rename a file document',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      title: { type: 'string', required: true, description: 'New title' },
    },
    response: { id: 'string', title: 'string' },
    aliases: ['file.rename'],
  },
  {
    name: 'files.delete',
    description: 'Delete a file document and its stored bytes',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string' },
    aliases: ['file.delete'],
  },

  // Images (workspace image bucket) namespace. Workspace-scoped, not
  // document-scoped: an image blob has no link back to the document that
  // embeds it, so there is no doc id and no --tab here.
  {
    name: 'images.upload',
    description: 'Upload an image (png, jpeg, gif, or webp) to the workspace image bucket',
    safety: 'write',
    parameters: {
      file: { type: 'string', required: true, description: 'Source image path (no stdin: the part name and content type come from the filename)' },
    },
    response: { id: 'string', url: 'string' },
    aliases: ['image.upload'],
  },
  {
    name: 'images.get',
    description: "Download a workspace image's bytes",
    safety: 'read-only',
    parameters: {
      'image-id': { type: 'string', required: true, description: 'Image ID' },
      out: { type: 'string', required: false, description: 'Output path, - for stdout (default: the image id; the read route sends no filename)' },
      '--force': { type: 'boolean', required: false, description: 'Overwrite existing output file', default: 'false' },
    },
    response: { type: 'binary', description: 'Stored image bytes' },
    aliases: ['image.get'],
  },
  {
    name: 'images.delete',
    description: 'Delete an image from the workspace image bucket',
    safety: 'destructive',
    parameters: {
      'image-id': { type: 'string', required: true, description: 'Image ID' },
    },
    response: { deleted: 'boolean' },
    aliases: ['image.delete'],
  },

  // Sheets namespace — canonical names live under sheets.*
  {
    name: 'sheets.tabs.list',
    description: 'List tabs in a spreadsheet document',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { type: 'array', items: { id: 'string', name: 'string', type: 'string' } },
    aliases: ['tab.list', 'tabs.list', 'sheet.tabs.list', 'sheet.tab.list', 'sheets.tab.list'],
  },
  {
    name: 'sheets.tabs.create',
    description: 'Create a new sheet tab',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      name: {
        type: 'string',
        required: false,
        description: 'Tab name (omit for the next SheetN)',
      },
      '--type': {
        type: 'string',
        required: false,
        description: 'Tab type; only "sheet" is supported',
        default: 'sheet',
      },
    },
    response: { id: 'string', name: 'string', type: 'string' },
    aliases: ['tab.create', 'tabs.create', 'sheet.tabs.create', 'sheet.tab.create', 'sheets.tab.create'],
  },
  {
    name: 'sheets.tabs.rename',
    description: 'Rename a tab',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      'tab-id': { type: 'string', required: true, description: 'Tab ID' },
      name: { type: 'string', required: true, description: 'New tab name' },
    },
    response: { id: 'string', name: 'string', type: 'string' },
    aliases: ['tab.rename', 'tabs.rename', 'sheet.tabs.rename', 'sheet.tab.rename', 'sheets.tab.rename'],
  },
  {
    name: 'sheets.cells.get',
    description: 'Get cells from a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      range: { type: 'string', required: false, description: 'Cell range (e.g. A1:C10)', default: 'all' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: {
      type: 'array',
      items: { ref: 'string', value: 'string | null', formula: 'string | null', style: 'object | null' },
    },
    aliases: ['cell.get', 'cells.get', 'sheet.cells.get', 'sheet.cell.get', 'sheets.cell.get'],
  },
  {
    name: 'sheets.cells.set',
    description: 'Set a single cell value',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      ref: { type: 'string', required: true, description: 'Cell reference (e.g. A1)' },
      value: { type: 'string', required: true, description: 'Cell value or formula' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { ref: 'string', value: 'string', formula: 'string | null' },
    aliases: ['cell.set', 'cells.set', 'sheet.cells.set', 'sheet.cell.set', 'sheets.cell.set'],
  },
  {
    name: 'sheets.cells.batch',
    description: 'Batch update cells',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON data (or pipe from stdin)' },
    },
    response: { updated: 'number' },
    aliases: ['cell.batch', 'cells.batch', 'sheet.cells.batch', 'sheet.cell.batch', 'sheets.cell.batch'],
  },
  {
    name: 'sheets.cells.delete',
    description: 'Delete a single cell',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      ref: { type: 'string', required: true, description: 'Cell reference' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { ref: 'string', deleted: 'boolean' },
    aliases: ['cell.delete', 'cells.delete', 'sheet.cells.delete', 'sheet.cell.delete', 'sheets.cell.delete'],
  },
  {
    name: 'sheets.import',
    description: 'Import CSV/JSON into a spreadsheet tab',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      file: { type: 'string', required: true, description: 'File path or - for stdin' },
      '--tab': { type: 'string', required: false, description: 'Target tab', default: 'tab-1' },
      '--file-format': { type: 'string', required: false, description: 'File format (csv, json)' },
      '--start': {
        type: 'string',
        required: false,
        description:
          "Top-left cell for a positional grid. Ignored when the input's first row is the per-cell header `ref,value,formula[,style]` that `sheets export` writes — those rows carry their own `ref`, so they land where they were exported from. The `mode` field in the response says which of the two ran",
        default: 'A1',
      },
    },
    response: {
      imported: 'number',
      mode: "'cells' when the input was an exported ref,value,formula table (--start ignored) | 'grid' when it was a positional grid placed at --start",
    },
    aliases: ['import', 'sheet.import'],
  },
  {
    name: 'sheets.export',
    description: 'Export spreadsheet tab data to CSV/JSON',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      file: { type: 'string', required: true, description: 'File path or - for stdout' },
      '--tab': { type: 'string', required: false, description: 'Source tab', default: 'tab-1' },
      '--range': { type: 'string', required: false, description: 'Cell range (e.g. A1:D100)' },
      '--file-format': { type: 'string', required: false, description: 'File format (csv, json)' },
      '--raw': {
        type: 'boolean',
        required: false,
        description:
          'CSV only: write cell text verbatim, without the leading-quote formula guard, so `sheets import` round-trips formulas',
        default: 'false',
      },
    },
    response: { type: 'string', description: 'Formatted cell data' },
    aliases: ['export', 'sheet.export'],
  },
  {
    name: 'sheets.clear',
    description: 'Empty a cell range on a spreadsheet tab, keeping rows and columns (JSON body from stdin or --data)',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Request body as JSON: { "range": "A1:C10" }. Read from stdin when omitted. A single reference ("A1") is a 1x1 range. The server caps one call at 1,000,000 cells', default: 'read from stdin' },
    },
    response: { cleared: 'number — how many non-empty cells were emptied' },
    aliases: ['clear', 'sheet.clear'],
  },
  {
    name: 'sheets.insert',
    description: 'Insert rows or columns into a spreadsheet tab (JSON body from stdin or --data)',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Request body as JSON: { "axis": "row" | "column", "index": number, "count": number }. Read from stdin when omitted. `index` is 1-based and names the position the new entries are inserted before; the server refuses a call that would materialize more than 10,000 axis entries (MaxAxisEntries), measured against the axis\'s current length so the cap is cumulative', default: 'read from stdin' },
    },
    response: { axis: "'row' | 'column'", index: 'number — echoed back', count: 'number — echoed back' },
    aliases: ['insert', 'sheet.insert'],
  },
  {
    name: 'sheets.delete',
    description: 'Delete rows or columns from a spreadsheet tab (JSON body from stdin or --data)',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Request body as JSON: { "axis": "row" | "column", "index": number, "count": number }. Read from stdin when omitted. `index` is 1-based and `count` is positive — the engine\'s negative-count convention is applied server-side. A delete materializes nothing, so it is not bounded by MaxAxisEntries: deleting every row is one legal call', default: 'read from stdin' },
    },
    response: { axis: "'row' | 'column'", index: 'number — echoed back', count: 'number — echoed back, positive' },
    aliases: ['sheet.delete'],
  },
  {
    name: 'sheets.move',
    description: 'Move rows or columns within a spreadsheet tab (JSON body from stdin or --data)',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Request body as JSON: { "axis": "row" | "column", "srcIndex": number, "count": number, "dstIndex": number }. Read from stdin when omitted. All indices are 1-based; `dstIndex` is the position the moved block lands before and may not fall inside the block. `count` is capped at 10,000 (MaxAxisEntries). Returns 409 when the move would split a merged range — move the whole merged block or unmerge it first', default: 'read from stdin' },
    },
    response: { axis: "'row' | 'column'", srcIndex: 'number — echoed back', count: 'number — echoed back', dstIndex: 'number — echoed back' },
    aliases: ['move', 'sheet.move'],
  },
  {
    name: 'sheets.styles.get',
    description: 'Get the range-style layer of a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { type: 'array', items: { range: 'array of two { r, c } cell refs', style: 'object' } },
    aliases: ['style.get', 'styles.get', 'range-styles.get', 'sheet.styles.get', 'sheet.style.get', 'sheet.range-styles.get', 'sheets.style.get', 'sheets.range-styles.get'],
  },
  {
    name: 'sheets.styles.set',
    description: 'Replace the range-style layer of a spreadsheet tab (JSON array from stdin or --data); patches omitted from the payload are deleted',
    // The PUT replaces the whole collection, so an omitted patch is deleted.
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Range style patches as a JSON array of { range, style } (or the { rangeStyles: [...] } envelope `styles get` prints); pipe from stdin when omitted' },
    },
    response: { type: 'array', items: { range: 'array of two { r, c } cell refs', style: 'object' } },
    aliases: ['style.set', 'styles.set', 'range-styles.set', 'sheet.styles.set', 'sheet.style.set', 'sheet.range-styles.set', 'sheets.style.set', 'sheets.range-styles.set'],
  },
  {
    name: 'sheets.sheet-style.get',
    description: 'Get the sheet-wide style of a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { style: 'object | null' },
    aliases: ['sheet-style.get', 'sheet.sheet-style.get'],
  },
  {
    name: 'sheets.sheet-style.set',
    description: 'Merge a style into the sheet-wide style of a tab (JSON from stdin or --data); an explicit null clears it',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Sheet style as a JSON object, `null` to clear, or the { style: ... } envelope `sheet-style get` prints; pipe from stdin when omitted' },
    },
    response: { style: 'object | null' },
    variants: [
      { when: 'default', safety: 'write', modifies: 'the sheet-wide style (merged onto the stored one)' },
      { when: 'payload is null', safety: 'destructive', removes: 'the sheet-wide style' },
    ],
    aliases: ['sheet-style.set', 'sheet.sheet-style.set'],
  },
  {
    name: 'sheets.column-styles.get',
    description: 'Get the whole-column styles of a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { columnStyles: 'object map of 1-based column index (as a string) to style object' },
    aliases: ['column-styles.get', 'column-style.get', 'sheet.column-styles.get', 'sheet.column-style.get', 'sheets.column-style.get'],
  },
  {
    name: 'sheets.column-styles.set',
    description: 'Merge whole-column styles keyed by 1-based column index (JSON from stdin or --data); a null value clears that column',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Column styles as a JSON object map of 1-based column index to style or null (or the { columnStyles: {...} } envelope `column-styles get` prints); pipe from stdin when omitted' },
    },
    response: { columnStyles: 'object map of 1-based column index (as a string) to style object' },
    variants: [
      { when: 'default', safety: 'write', modifies: "the listed columns' styles (merged per index)" },
      { when: 'a value is null', safety: 'destructive', removes: "that column's stored style" },
    ],
    aliases: ['column-styles.set', 'column-style.set', 'sheet.column-styles.set', 'sheet.column-style.set', 'sheets.column-style.set'],
  },
  {
    name: 'sheets.row-styles.get',
    description: 'Get the whole-row styles of a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { rowStyles: 'object map of 1-based row index (as a string) to style object' },
    aliases: ['row-styles.get', 'row-style.get', 'sheet.row-styles.get', 'sheet.row-style.get', 'sheets.row-style.get'],
  },
  {
    name: 'sheets.row-styles.set',
    description: 'Merge whole-row styles keyed by 1-based row index (JSON from stdin or --data); a null value clears that row',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Row styles as a JSON object map of 1-based row index to style or null (or the { rowStyles: {...} } envelope `row-styles get` prints); pipe from stdin when omitted' },
    },
    response: { rowStyles: 'object map of 1-based row index (as a string) to style object' },
    variants: [
      { when: 'default', safety: 'write', modifies: "the listed rows' styles (merged per index)" },
      { when: 'a value is null', safety: 'destructive', removes: "that row's stored style" },
    ],
    aliases: ['row-styles.set', 'row-style.set', 'sheet.row-styles.set', 'sheet.row-style.set', 'sheets.row-style.set'],
  },
  {
    name: 'sheets.column-widths.get',
    description: 'Get whole-column widths for a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { columnWidths: 'object — map of 1-based column index (as a string, "1" = column A) to width; only sized columns appear' },
    aliases: ['column-widths.get', 'column-width.get', 'sheet.column-widths.get', 'sheet.column-width.get', 'sheets.column-width.get'],
  },
  {
    name: 'sheets.column-widths.set',
    description: 'Set whole-column widths (JSON map of 1-based column index to width, or null to clear; merges per index)',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON map of 1-based column index to width, or null to clear that index (or pipe from stdin)' },
    },
    response: { columnWidths: "object — the tab's full column-width map after the merge" },
    variants: [
      { when: 'default', safety: 'write', modifies: "the listed columns' widths (merged per index)" },
      { when: 'a value is null', safety: 'destructive', removes: "that column's stored width" },
    ],
    aliases: ['column-widths.set', 'column-width.set', 'sheet.column-widths.set', 'sheet.column-width.set', 'sheets.column-width.set'],
  },
  {
    name: 'sheets.row-heights.get',
    description: 'Get whole-row heights for a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { rowHeights: 'object — map of 1-based row index (as a string, "1" = the first row) to height; only sized rows appear' },
    aliases: ['row-heights.get', 'row-height.get', 'sheet.row-heights.get', 'sheet.row-height.get', 'sheets.row-height.get'],
  },
  {
    name: 'sheets.row-heights.set',
    description: 'Set whole-row heights (JSON map of 1-based row index to height, or null to clear; merges per index)',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON map of 1-based row index to height, or null to clear that index (or pipe from stdin)' },
    },
    response: { rowHeights: "object — the tab's full row-height map after the merge" },
    variants: [
      { when: 'default', safety: 'write', modifies: "the listed rows' heights (merged per index)" },
      { when: 'a value is null', safety: 'destructive', removes: "that row's stored height" },
    ],
    aliases: ['row-heights.set', 'row-height.set', 'sheet.row-heights.set', 'sheet.row-height.set', 'sheets.row-height.set'],
  },
  {
    name: 'sheets.freeze.get',
    description: 'Get the frozen row/column counts for a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { rows: 'number', cols: 'number' },
    aliases: ['freeze.get', 'sheet.freeze.get'],
  },
  {
    name: 'sheets.freeze.set',
    description: 'Set frozen rows/columns (JSON body { rows, cols }; an omitted key resets to 0)',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON data (or pipe from stdin)' },
    },
    response: { rows: 'number', cols: 'number' },
    aliases: ['freeze.set', 'sheet.freeze.set'],
  },
  {
    name: 'sheets.hidden.get',
    description: 'Get the hidden row/column indices (1-based) for a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { rows: 'number[]', columns: 'number[]' },
    aliases: ['hidden.get', 'sheet.hidden.get'],
  },
  {
    name: 'sheets.hidden.set',
    description: 'Set hidden rows/columns (JSON body { rows, columns }, 1-based; replaces the whole set)',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON data (or pipe from stdin)' },
    },
    response: { rows: 'number[]', columns: 'number[]' },
    aliases: ['hidden.set', 'sheet.hidden.set'],
  },
  {
    name: 'sheets.merges.get',
    description: 'Get merged cells as a map of anchor ref to { rs, cs }',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { merges: 'object (cell ref -> { rs: number, cs: number })' },
    aliases: ['merge.get', 'merges.get', 'sheet.merges.get', 'sheet.merge.get', 'sheets.merge.get'],
  },
  {
    name: 'sheets.merges.set',
    description: 'Replace all merged cells (JSON map of anchor ref to { rs, cs }; omitted merges are removed)',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON data (or pipe from stdin)' },
    },
    response: { merges: 'object (cell ref -> { rs: number, cs: number })' },
    aliases: ['merge.set', 'merges.set', 'sheet.merges.set', 'sheet.merge.set', 'sheets.merge.set'],
  },
  {
    name: 'sheets.conditional-formats.get',
    description: 'Get the conditional format rules of a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { type: 'array', items: { id: 'string', ranges: 'array', op: 'string', value: 'string | undefined', value2: 'string | undefined', style: 'object' } },
    aliases: ['conditional-format.get', 'conditional-formats.get', 'sheet.conditional-formats.get', 'sheet.conditional-format.get', 'sheets.conditional-format.get'],
  },
  {
    name: 'sheets.conditional-formats.set',
    description: 'Replace the conditional format rules of a spreadsheet tab',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Rules as JSON (array or { rules: [...] }; or pipe from stdin)' },
    },
    response: { type: 'array', items: { id: 'string', ranges: 'array', op: 'string', value: 'string | undefined', value2: 'string | undefined', style: 'object' } },
    aliases: ['conditional-format.set', 'conditional-formats.set', 'sheet.conditional-formats.set', 'sheet.conditional-format.set', 'sheets.conditional-format.set'],
  },
  {
    name: 'sheets.data-validations.get',
    description: 'Get the data validation rules of a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { type: 'array', items: { id: 'string', ranges: 'array', kind: 'string', onInvalid: 'string | undefined', list: 'string[] | undefined', operator: 'string | undefined', values: 'string[] | undefined' } },
    aliases: ['data-validation.get', 'data-validations.get', 'sheet.data-validations.get', 'sheet.data-validation.get', 'sheets.data-validation.get'],
  },
  {
    name: 'sheets.data-validations.set',
    description: 'Replace the data validation rules of a spreadsheet tab',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Rules as JSON (array or { rules: [...] }; or pipe from stdin)' },
    },
    response: { type: 'array', items: { id: 'string', ranges: 'array', kind: 'string', onInvalid: 'string | undefined', list: 'string[] | undefined', operator: 'string | undefined', values: 'string[] | undefined' } },
    aliases: ['data-validation.set', 'data-validations.set', 'sheet.data-validations.set', 'sheet.data-validation.set', 'sheets.data-validation.set'],
  },
  {
    name: 'sheets.charts.get',
    description: 'Get the charts on a spreadsheet tab',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { type: 'array', items: { id: 'string', type: "'bar' | 'line' | 'area' | 'pie' | 'scatter'", sourceTabId: 'string', sourceRange: 'string', anchor: 'string (A1 reference)', offsetX: 'number', offsetY: 'number', width: 'number', height: 'number', title: 'string (optional)', xAxisColumn: 'string (optional)', seriesColumns: 'string[] (optional)', legendPosition: "'top' | 'bottom' | 'right' | 'left' | 'none' (optional)", colorPalette: 'string (optional)', showGridlines: 'boolean (optional)' } },
    aliases: ['chart.get', 'charts.get', 'sheet.charts.get', 'sheet.chart.get', 'sheets.chart.get'],
  },
  {
    name: 'sheets.charts.set',
    description: 'Replace all charts on a spreadsheet tab (JSON from stdin or --data; omitted charts are deleted)',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Charts as a JSON array, or { "charts": [ ... ] } (or pipe from stdin)' },
    },
    response: { type: 'array', items: { id: 'string', type: "'bar' | 'line' | 'area' | 'pie' | 'scatter'", sourceTabId: 'string', sourceRange: 'string', anchor: 'string (A1 reference)', offsetX: 'number', offsetY: 'number', width: 'number', height: 'number', title: 'string (optional)', xAxisColumn: 'string (optional)', seriesColumns: 'string[] (optional)', legendPosition: "'top' | 'bottom' | 'right' | 'left' | 'none' (optional)", colorPalette: 'string (optional)', showGridlines: 'boolean (optional)' } },
    aliases: ['chart.set', 'charts.set', 'sheet.charts.set', 'sheet.chart.set', 'sheets.chart.set'],
  },
  {
    name: 'sheets.filter.get',
    description: "Get a spreadsheet tab's filter state",
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { filter: 'object | null — { startRow, endRow, startCol, endCol, columns, hiddenRows } as stored, or null when the tab has no filter' },
    aliases: ['filter.get', 'sheet.filter.get'],
  },
  {
    name: 'sheets.filter.set',
    description: "Set a spreadsheet tab's filter (JSON object from stdin or --data; null clears it)",
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Filter state as a JSON string — the filter object itself ({ startRow, endRow, startCol, endCol, columns, hiddenRows }), not wrapped in a `filter` key; `null` clears the filter. Read from stdin when omitted' },
    },
    response: { filter: 'object | null — the filter as stored after the write' },
    variants: [
      { when: 'default', safety: 'write', modifies: "the tab's filter" },
      { when: 'payload is null', safety: 'destructive', removes: "the tab's filter" },
    ],
    aliases: ['filter.set', 'sheet.filter.set'],
  },
  {
    name: 'sheets.pivot.get',
    description: "Get a spreadsheet tab's pivot table definition",
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { pivot: 'object | null — { id, sourceTabId, sourceRange, rowFields, columnFields, valueFields, filterFields, showTotals } as stored, or null when the tab has no pivot table' },
    aliases: ['pivot.get', 'sheet.pivot.get'],
  },
  {
    name: 'sheets.pivot.set',
    description: "Set a spreadsheet tab's pivot table (JSON object from stdin or --data; null clears it)",
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'Pivot table definition as a JSON string — the pivot object itself ({ id, sourceTabId, sourceRange, rowFields, columnFields, valueFields, filterFields, showTotals }), not wrapped in a `pivot` key; `null` clears it. Read from stdin when omitted' },
    },
    response: { pivot: 'object | null — the pivot table as stored after the write' },
    variants: [
      { when: 'default', safety: 'write', modifies: "the tab's pivot table" },
      { when: 'payload is null', safety: 'destructive', removes: "the tab's pivot table" },
    ],
    aliases: ['pivot.set', 'sheet.pivot.set'],
  },

  // API keys namespace
  {
    name: 'api-keys.create',
    description: 'Create a new API key',
    safety: 'write',
    parameters: {
      name: { type: 'string', required: true, description: 'Key name' },
    },
    response: { id: 'string', name: 'string', prefix: 'string', key: 'string' },
    aliases: ['api-key.create'],
  },
  {
    name: 'api-keys.list',
    description: 'List API keys in workspace',
    safety: 'read-only',
    parameters: {},
    response: { type: 'array', items: { id: 'string', name: 'string', prefix: 'string' } },
    aliases: ['api-key.list'],
  },
  {
    name: 'api-keys.revoke',
    description: 'Revoke an API key',
    safety: 'destructive',
    parameters: {
      'key-id': { type: 'string', required: true, description: 'API key ID' },
    },
    response: { id: 'string' },
    aliases: ['api-key.revoke'],
  },
];

/**
 * Look up a schema entry by canonical name or any registered alias.
 * Aliases let scripts and skills written against the v0.3.x singular
 * names (`cell.get`, `doc.list`, `import`) keep working after the
 * v0.3.7 namespace shuffle.
 */
export function getCommandSchema(name: string): CommandSchema | undefined {
  const direct = registry.find((c) => c.name === name);
  if (direct) return direct;
  return registry.find((c) => c.aliases?.includes(name));
}

export function getAllCommandSchemas(): CommandSchema[] {
  return registry;
}
