import type { Block } from '../model/types.js';

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
