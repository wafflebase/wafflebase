import { initialize, type EditorAPI } from "@wafflebase/docs";
import { useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { YorkieDocStore } from "./yorkie-doc-store";

/**
 * DocsView mounts the Canvas-based document editor inside a Yorkie
 * DocumentProvider context.  It creates a YorkieDocStore, calls
 * `initialize(container, store)`, and wires remote changes to re-render.
 */
export function DocsView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieDocsRoot>();

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) {
      return;
    }

    const store = new YorkieDocStore(doc);
    const editor: EditorAPI = initialize(container, store);

    // Re-render the editor whenever a remote peer modifies the document.
    // refresh() updates the Doc's cached document from the store, then
    // render() repaints the canvas with the latest content.
    store.onRemoteChange = () => {
      editor.getDoc().refresh();
      editor.render();
    };

    return () => {
      editor.dispose();
    };
  }, [didMount, doc]);

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
    <div className="flex h-full w-full flex-col">
      <div className="relative flex-1 w-full overflow-auto">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}

export default DocsView;
