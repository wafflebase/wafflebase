import { useEffect, useRef } from "react";

/**
 * The box shared by the editor side panels (comments, version history).
 *
 * At `md` and up it is a 288px column docked beside the editor. Below `md` —
 * the `useIsMobile` breakpoint — a docked column would leave a 393px phone a
 * ~105px editor (and none at all with two panels open), so it becomes a bottom
 * sheet laid over the editor instead: full width, half of the visible
 * viewport, above the revision-preview overlay (`z-20`) and below dialogs and
 * popovers (`z-50`). The editor, or a version being previewed, keeps its full
 * width in the space above it.
 */
export const SIDE_PANEL_CLASS =
  "flex h-full w-72 flex-col border-l bg-background " +
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[50dvh] " +
  "max-md:w-full max-md:rounded-t-xl max-md:border-l-0 max-md:border-t " +
  "max-md:pb-[env(safe-area-inset-bottom)] max-md:shadow-[0_-8px_24px_rgb(0_0_0/0.12)]";

/**
 * On a phone the two side panels are bottom sheets in the same place, so a
 * second one would only hide the first. Keep one: whichever opened last
 * closes the other. Desktop docks them side by side and is left alone.
 */
export function useOnePanelOnMobile(
  isMobile: boolean,
  [aOpen, setAOpen]: readonly [boolean, (open: boolean) => void],
  [bOpen, setBOpen]: readonly [boolean, (open: boolean) => void],
) {
  const prev = useRef({ aOpen, bOpen });
  useEffect(() => {
    const was = prev.current;
    prev.current = { aOpen, bOpen };
    if (!isMobile || !aOpen || !bOpen) return;
    // `b` just opened: it wins. In every other case — `a` just opened, or
    // both were already open when the viewport narrowed — `a` wins.
    if (was.aOpen && !was.bOpen) setAOpen(false);
    else setBOpen(false);
  }, [isMobile, aOpen, bOpen, setAOpen, setBOpen]);
}
