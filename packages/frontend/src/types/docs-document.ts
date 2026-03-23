import type { Tree } from '@yorkie-js/sdk';

/**
 * Yorkie document root for the docs (rich-text) editor.
 *
 * - `content`: yorkie.Tree holding the block/inline structure
 * - `pageSetup`: document-level metadata (paper size, margins)
 */
export type YorkieDocsRoot = {
  content: Tree;
  pageSetup?: {
    paperSize: { name: string; width: number; height: number };
    orientation: 'portrait' | 'landscape';
    margins: { top: number; bottom: number; left: number; right: number };
  };
};
