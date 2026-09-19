import * as Sentry from "@sentry/react";
import { Component, Suspense, type ReactNode } from "react";
import { toast } from "sonner";
import { isChunkLoadError } from "@/lib/chunk-load-error";

/**
 * `Suspense`, plus a boundary that keeps a failed panel chunk from taking the
 * document down with it.
 *
 * There is exactly one `ErrorBoundary` in this app and it is at the root
 * (`main.tsx`), so before this existed, a lazy panel whose chunk would not
 * load — the history panel, a chart editor, a revision overlay — unmounted the
 * whole tree. That unmount takes `DocumentProvider` with it, and while a clean
 * unmount is not the data loss it looks like (`@yorkie-js/react` detaches on
 * cleanup, and `Client.detachDocument` sends a final change pack), the user
 * still loses their editor session and lands on a full-screen crash page
 * because a side panel failed to download.
 *
 * So the failure is made local. `lazyWithRetry` has already retried and, where
 * that was safe, reloaded; reaching here means the panel is not coming back
 * this page-load, and React caches a rejected `lazy()` payload, so there is no
 * in-place retry to offer either. What is left is to say so and stay out of
 * the way: a toast, and nothing rendered where the panel would have been. The
 * editor keeps working and the document stays attached.
 *
 * ONLY chunk-load failures are caught. Anything else is rethrown from
 * `render`, which propagates it to the root boundary exactly as before — a
 * panel with a real bug in it must still reach the crash page and Sentry,
 * not be swallowed into a toast.
 *
 * ## Where NOT to use it
 *
 * Wrap a PANEL, never a whole view. Containment here means rendering nothing
 * in the children's place, which is right for a side panel and wrong for the
 * editor itself: the six mounts whose fallback is a full-page `<Loader />` —
 * `SheetView`, and the shared-document views — stay on plain `Suspense`
 * precisely so a failure there still reaches the root boundary, where the user
 * gets an explanation and a button instead of a blank page and a toast.
 *
 * The error state does not reset, which is deliberate rather than an
 * omission: `React.lazy` caches a rejected payload, so remounting the same
 * child would fail identically. There is no in-place retry to offer, and the
 * toast says so.
 */

interface Props {
  children: ReactNode;
  /** The `Suspense` fallback, unchanged. */
  fallback?: ReactNode;
  /**
   * What to call the thing that did not load, for the toast. Defaults to the
   * generic wording, which is correct but less useful.
   */
  label?: string;
}

interface State {
  error: unknown;
}

export class ChunkBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (!isChunkLoadError(error)) return;

    Sentry.captureException(error, {
      level: "warning",
      tags: { chunk_load_failed: "true", chunk_recovery: "contained" },
    });

    const what = this.props.label ?? "Part of this page";
    toast.error(`${what} couldn't be loaded.`, {
      description: "Reload the page to try again.",
      // Not a `location.reload()` we call ourselves: this document may hold
      // edits that are not on the server yet, and going through the browser's
      // own reload keeps whatever unload prompt it honors in play.
      duration: 8000,
    });
  }

  render() {
    const { error } = this.state;
    if (error) {
      // A module that loaded and then threw is a real bug. Rethrowing from
      // render hands it to the next boundary up, which is the root one.
      if (!isChunkLoadError(error)) throw error;
      return null;
    }

    return (
      <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>
    );
  }
}
