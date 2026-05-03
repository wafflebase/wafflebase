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
    response: { user: 'string', server: 'string', workspace: 'string', session: 'string' },
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
      '--start': { type: 'string', required: false, description: 'Top-left cell', default: 'A1' },
    },
    response: { imported: 'number' },
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
    },
    response: { type: 'string', description: 'Formatted cell data' },
    aliases: ['export', 'sheet.export'],
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
 * v0.4.0 namespace shuffle.
 */
export function getCommandSchema(name: string): CommandSchema | undefined {
  const direct = registry.find((c) => c.name === name);
  if (direct) return direct;
  return registry.find((c) => c.aliases?.includes(name));
}

export function getAllCommandSchemas(): CommandSchema[] {
  return registry;
}
