import { useEffect, useState } from "react";
import { useBoardCollab } from "./board-collab-hook";
import type { RitualToolState } from "./ritual-tool";

/** The ritual tool state, re-rendering on change. `null` outside a provider. */
export function useRitualToolState(): RitualToolState | null {
  const collab = useBoardCollab();
  const tool = collab?.tool ?? null;
  const [state, setState] = useState<RitualToolState | null>(() => tool?.get() ?? null);
  useEffect(() => {
    if (!tool) {
      setState(null);
      return;
    }
    setState(tool.get());
    return tool.subscribe(() => setState(tool.get()));
  }, [tool]);
  return state;
}
