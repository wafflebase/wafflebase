/**
 * Connects the header's avatar stack (`UserPresence`, rendered by the
 * page layout) to the board's presence controller (created inside
 * `BoardView`'s mount effect). The layout owns one bridge and passes it
 * down; the view attaches its controller while mounted. Clicks before the
 * view attaches, or after it detaches, do nothing.
 */
export interface BoardFollowTarget {
  selectPeer(clientID: string): void;
  jumpHint(clientID: string): string | undefined;
}

export interface BoardFollowBridge extends BoardFollowTarget {
  attach(target: BoardFollowTarget | null): void;
}

export function createBoardFollowBridge(): BoardFollowBridge {
  let target: BoardFollowTarget | null = null;
  return {
    attach(next) {
      target = next;
    },
    selectPeer(clientID) {
      target?.selectPeer(clientID);
    },
    jumpHint(clientID) {
      return target?.jumpHint(clientID);
    },
  };
}
