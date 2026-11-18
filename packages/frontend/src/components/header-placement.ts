import { createContext, useContext, useState } from "react";

/**
 * Where a `SiteHeader` slot is being rendered, so one slot node can draw
 * itself as a header button or as rows of the header's More menu.
 *
 * - `bar` — the header row on a wide viewport; the control's full form.
 * - `compact` — the header row on a phone. Only `primary` and `share` stay
 *   in the row there, and a control with a secondary affordance (the
 *   Slideshow split button's chevron) drops it into the menu instead.
 * - `menu` — inside the phone header's More dropdown. A slot rendered here
 *   must return dropdown menu items (or nothing), never a button: `comments`,
 *   `history` and `export` always land here on a phone, and `primary` does
 *   too for whatever it moved out of the row.
 */
export type HeaderPlacement = "bar" | "compact" | "menu";

export const HeaderPlacementContext = createContext<HeaderPlacement>("bar");

export function useHeaderPlacement(): HeaderPlacement {
  return useContext(HeaderPlacementContext);
}

/**
 * The one size every square header control takes: 32px on a fine pointer,
 * the 44px touch floor on a coarse one. On a phone the header used to mix
 * 44×44, 34×44, 32×32 and 58×34 boxes in one row.
 */
export const HEADER_CONTROL_SIZE = "size-8 pointer-coarse:size-11";

/**
 * Work a header control has in flight (an export), held by `SiteHeader`
 * rather than by the control. On a phone a control in the More menu unmounts
 * when the menu closes, so a flag in its own state would be gone by the next
 * tap and a second export could start over the first.
 */
export interface HeaderBusy {
  busy: ReadonlySet<string>;
  setBusy: (key: string, on: boolean) => void;
}

export const HeaderBusyContext = createContext<HeaderBusy | null>(null);

/**
 * A busy flag that outlives the control: kept by the enclosing `SiteHeader`,
 * or in the control's own state when it is rendered outside one.
 */
export function useHeaderBusy(key: string): [boolean, (on: boolean) => void] {
  const header = useContext(HeaderBusyContext);
  const [local, setLocal] = useState(false);
  if (!header) return [local, setLocal];
  return [header.busy.has(key), (on) => header.setBusy(key, on)];
}
