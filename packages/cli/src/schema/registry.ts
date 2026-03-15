export type SafetyLevel = 'read-only' | 'write' | 'destructive';

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
}

const registry: CommandSchema[] = [
  {
    name: 'auth.login',
    description: 'Set up API key and server configuration',
    safety: 'write',
    parameters: {
      '--profile': { type: 'string', required: false, description: 'Profile name', default: 'default' },
      '--server': { type: 'string', required: false, description: 'Server URL' },
      '--api-key': { type: 'string', required: false, description: 'API key' },
      '--workspace': { type: 'string', required: false, description: 'Workspace ID' },
    },
    response: { profile: 'string', path: 'string' },
  },
  {
    name: 'doc.list',
    description: 'List documents in workspace',
    safety: 'read-only',
    parameters: {},
    response: { type: 'array', items: { id: 'string', title: 'string', createdAt: 'string' } },
  },
  {
    name: 'doc.create',
    description: 'Create a new document',
    safety: 'write',
    parameters: {
      title: { type: 'string', required: true, description: 'Document title' },
    },
    response: { id: 'string', title: 'string' },
  },
  {
    name: 'doc.get',
    description: 'Show document metadata',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string', title: 'string', createdAt: 'string' },
  },
  {
    name: 'doc.rename',
    description: 'Rename a document',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      title: { type: 'string', required: true, description: 'New title' },
    },
    response: { id: 'string', title: 'string' },
  },
  {
    name: 'doc.delete',
    description: 'Delete a document',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { id: 'string' },
  },
  {
    name: 'tab.list',
    description: 'List tabs in a document',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
    },
    response: { type: 'array', items: { id: 'string', name: 'string', type: 'string' } },
  },
  {
    name: 'cell.get',
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
  },
  {
    name: 'cell.set',
    description: 'Set a single cell value',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      ref: { type: 'string', required: true, description: 'Cell reference (e.g. A1)' },
      value: { type: 'string', required: true, description: 'Cell value or formula' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { ref: 'string', value: 'string', formula: 'string | null' },
  },
  {
    name: 'cell.batch',
    description: 'Batch update cells',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
      '--data': { type: 'string', required: false, description: 'JSON data (or pipe from stdin)' },
    },
    response: { updated: 'number' },
  },
  {
    name: 'cell.delete',
    description: 'Delete a single cell',
    safety: 'destructive',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      ref: { type: 'string', required: true, description: 'Cell reference' },
      '--tab': { type: 'string', required: false, description: 'Tab ID', default: 'tab-1' },
    },
    response: { ref: 'string', deleted: 'boolean' },
  },
  {
    name: 'import',
    description: 'Import CSV/JSON into a tab',
    safety: 'write',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      file: { type: 'string', required: true, description: 'File path or - for stdin' },
      '--tab': { type: 'string', required: false, description: 'Target tab', default: 'tab-1' },
      '--format': { type: 'string', required: false, description: 'File format (csv, json)' },
      '--no-header': { type: 'boolean', required: false, description: 'First row is not a header' },
      '--start': { type: 'string', required: false, description: 'Top-left cell', default: 'A1' },
    },
    response: { imported: 'number' },
  },
  {
    name: 'export',
    description: 'Export tab data to CSV/JSON',
    safety: 'read-only',
    parameters: {
      'doc-id': { type: 'string', required: true, description: 'Document ID' },
      file: { type: 'string', required: true, description: 'File path or - for stdout' },
      '--tab': { type: 'string', required: false, description: 'Source tab', default: 'tab-1' },
      '--range': { type: 'string', required: false, description: 'Cell range (e.g. A1:D100)' },
      '--format': { type: 'string', required: false, description: 'Output format (csv, json)' },
    },
    response: { type: 'string', description: 'Formatted cell data' },
  },
  {
    name: 'api-key.create',
    description: 'Create a new API key',
    safety: 'write',
    parameters: {
      name: { type: 'string', required: true, description: 'Key name' },
    },
    response: { id: 'string', name: 'string', prefix: 'string', key: 'string' },
  },
  {
    name: 'api-key.list',
    description: 'List API keys in workspace',
    safety: 'read-only',
    parameters: {},
    response: { type: 'array', items: { id: 'string', name: 'string', prefix: 'string' } },
  },
  {
    name: 'api-key.revoke',
    description: 'Revoke an API key',
    safety: 'destructive',
    parameters: {
      'key-id': { type: 'string', required: true, description: 'API key ID' },
    },
    response: { id: 'string' },
  },
];

export function getCommandSchema(name: string): CommandSchema | undefined {
  return registry.find((c) => c.name === name);
}

export function getAllCommandSchemas(): CommandSchema[] {
  return registry;
}
