import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToolbarButton } from "@/components/ui/toolbar";
import { IconLink } from "@tabler/icons-react";
import { modKey } from "./platform";

interface InsertLinkButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function InsertLinkButton({ onClick, disabled }: InsertLinkButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarButton
          aria-label="Insert link"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          <IconLink size={16} />
        </ToolbarButton>
      </TooltipTrigger>
      <TooltipContent>Insert link ({modKey}+K)</TooltipContent>
    </Tooltip>
  );
}
