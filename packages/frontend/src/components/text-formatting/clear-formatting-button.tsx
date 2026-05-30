import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconClearFormatting } from "@tabler/icons-react";

interface ClearFormattingButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function ClearFormattingButton({
  onClick,
  disabled,
}: ClearFormattingButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Clear formatting"
          disabled={disabled}
          onClick={onClick}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
        >
          <IconClearFormatting size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Clear formatting</TooltipContent>
    </Tooltip>
  );
}
