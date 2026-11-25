import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useOnePanelOnMobile } from "./side-panel-layout";

type Panel = "comments" | "history" | "chat";
type PanelState = Record<Panel, boolean>;

const CLOSED: PanelState = { comments: false, history: false, chat: false };

export interface RightPanels {
  commentsOpen: boolean;
  setCommentsOpen: Dispatch<SetStateAction<boolean>>;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  chatOpen: boolean;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * Opening `panel` in `state`. Chat takes the right-hand slot on its own:
 * opening it closes comments and history, and opening either of those closes
 * chat. Comments and history keep their old relationship with each other —
 * docked side by side on desktop, one at a time on a phone, which
 * `useOnePanelOnMobile` decides.
 */
function withPanel(state: PanelState, panel: Panel, open: boolean): PanelState {
  if (state[panel] === open) return state;
  if (!open) return { ...state, [panel]: false };
  if (panel === "chat") return { ...CLOSED, chat: true };
  return { ...state, chat: false, [panel]: true };
}

/**
 * The editor's right-hand slot: comments, version history and chat. Every
 * document detail page holds its panel flags here rather than in separate
 * `useState`s, so the rule for who shares the slot lives in one place. The
 * setters take a value or an updater, like `useState`'s, and are stable.
 */
export function useRightPanels(isMobile: boolean): RightPanels {
  const [state, setState] = useState<PanelState>(CLOSED);

  const [setters] = useState(() => {
    const setter =
      (panel: Panel): Dispatch<SetStateAction<boolean>> =>
      (action) =>
        setState((s) =>
          withPanel(
            s,
            panel,
            typeof action === "function" ? action(s[panel]) : action,
          ),
        );
    return {
      comments: setter("comments"),
      history: setter("history"),
      chat: setter("chat"),
    };
  });

  useOnePanelOnMobile(
    isMobile,
    [state.comments, setters.comments],
    [state.history, setters.history],
  );

  return {
    commentsOpen: state.comments,
    setCommentsOpen: setters.comments,
    historyOpen: state.history,
    setHistoryOpen: setters.history,
    chatOpen: state.chat,
    setChatOpen: setters.chat,
  };
}
