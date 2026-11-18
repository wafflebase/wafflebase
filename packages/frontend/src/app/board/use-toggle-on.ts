import { useEffect, useState } from "react";
import type { ToggleTool } from "./board-drawing-extras";

/** Whether a board toggle tool (hand-shaped) is on, kept in sync with it. */
export function useToggleOn(tool: ToggleTool | null | undefined): boolean {
  const [on, setOn] = useState(() => tool?.get() ?? false);
  useEffect(() => {
    if (!tool) {
      setOn(false);
      return;
    }
    setOn(tool.get());
    return tool.subscribe(() => setOn(tool.get()));
  }, [tool]);
  return on;
}
