import { initialize, type EditorAPI, type ThemeMode } from "@wafflebase/docs";
import { useEffect, useRef, useState } from "react";
import { useDocument, Tree } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { YorkieDocStore } from "./yorkie-doc-store";

export type { EditorAPI } from "@wafflebase/docs";

/**
 * Ensure the Yorkie document has a Tree CRDT for content.
 * Tree must be created via `new Tree()` inside doc.update();
 * it cannot be passed as a plain object through initialRoot.
 */
function ensureTree(doc: ReturnType<typeof useDocument<YorkieDocsRoot>>["doc"]): boolean {
  if (!doc) return false;
  const root = doc.getRoot();

  if (root.content && typeof root.content.getRootTreeNode === "function") {
    return true;
  }

  // Create Tree CRDT with a single empty paragraph block.
  doc.update((r) => {
    r.content = new Tree({
      type: "doc",
      children: [
        {
          type: "block",
          attributes: {
            id: `block-${Date.now()}-0`,
            type: "paragraph",
            alignment: "left",
            lineHeight: "1.5",
            marginTop: "0",
            marginBottom: "8",
            textIndent: "0",
            marginLeft: "0",
          },
          children: [
            {
              type: "inline",
              children: [],
            },
          ],
        },
      ],
    });
  });

  return true;
}

interface DocsViewProps {
  onEditorReady?: (editor: EditorAPI) => void;
}

/**
 * DocsView mounts the Canvas-based document editor inside a Yorkie
 * DocumentProvider context.  It creates a YorkieDocStore, calls
 * `initialize(container, store, theme)`, and wires remote changes to re-render.
 */
export function DocsView({ onEditorReady }: DocsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorAPI | null>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieDocsRoot>();
  const { resolvedTheme } = useTheme();

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) {
      return;
    }

    if (!ensureTree(doc)) {
      return;
    }

    const store = new YorkieDocStore(doc);
    const theme = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
    const editor: EditorAPI = initialize(container, store, theme);
    editorRef.current = editor;
    onEditorReady?.(editor);

    // Re-render the editor whenever a remote peer modifies the document.
    // refresh() updates the Doc's cached document from the store, then
    // render() repaints the canvas with the latest content.
    store.onRemoteChange = () => {
      editor.getDoc().refresh();
      editor.render();
    };

    return () => {
      editor.dispose();
      editorRef.current = null;
      onEditorReady?.(null as unknown as EditorAPI);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme changes are handled by the separate useEffect below; onEditorReady is stable
  }, [didMount, doc]);

  // Update the editor theme when the user toggles light/dark mode.
  useEffect(() => {
    if (editorRef.current) {
      const mode = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
      editorRef.current.setTheme(mode);
    }
  }, [resolvedTheme]);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 w-full min-h-0" />
  );
}

export default DocsView;
