import { useEffect, useRef } from "react";
import { startPresenter, type Presenter } from "@wafflebase/slides";
import type { YorkieSlidesStore } from "./yorkie-slides-store";

interface SlidesPresentationModeProps {
  store: YorkieSlidesStore;
  startSlideId: string;
  onExit: () => void;
}

/**
 * Thin React wrapper that hosts the framework-free presenter from
 * @wafflebase/slides. Creates a portal <div> on document.body, mounts
 * the presenter, forwards every store snapshot into setDocument so the
 * presenter reacts to remote edits, and disposes on unmount.
 *
 * The component renders no DOM of its own — the host <div> is created
 * imperatively so its lifetime is decoupled from React's reconciliation
 * (the presenter manipulates this element directly: appends a canvas,
 * applies letterbox styles, requests fullscreen). Rendering null avoids
 * confusing React strict-mode double-mounts with two host divs.
 */
export function SlidesPresentationMode(props: SlidesPresentationModeProps) {
  const onExitRef = useRef(props.onExit);
  onExitRef.current = props.onExit;

  useEffect(() => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    // Drop editor focus so its contenteditable doesn't eat keystrokes
    // inside the fullscreen element.
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();

    let presenter: Presenter | null = null;
    try {
      presenter = startPresenter({
        container: host,
        doc: props.store.read(),
        startSlideId: props.startSlideId,
        onExit: () => onExitRef.current(),
      });
    } catch (e) {
      // Defensive — startPresenter currently doesn't throw, but a
      // future change could (e.g., an empty deck assertion). Surface
      // it as a one-shot exit so the shell unmounts us.
      host.remove();
      onExitRef.current();
      throw e;
    }

    const unsubscribe = props.store.onChange(() => {
      presenter?.setDocument(props.store.read());
    });

    return () => {
      unsubscribe();
      presenter?.dispose();
      host.remove();
    };
    // Intentionally mount-only: store + startSlideId changes are not
    // expected within a single presentation session. The parent unmounts
    // us when the session ends and remounts a fresh component when a
    // new session starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
