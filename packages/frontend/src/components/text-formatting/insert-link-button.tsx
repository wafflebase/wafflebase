import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
        <button
          type="button"
          aria-label="Insert link"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconLink size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Insert link ({modKey}+K)</TooltipContent>
    </Tooltip>
  );
}
