import type { SlidesEditor } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  IconChevronDown,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconStack2,
} from '@tabler/icons-react';
import { modKey } from '@/components/text-formatting/platform';

export interface ArrangeMenuProps {
  editor: SlidesEditor | null;
  /** Number of LIVE selected elements (matches what align/distribute acts on). */
  selectionSize: number;
}

/**
 * Arrange dropdown — collapses z-order, align, distribute, and rotate
 * actions into a single menu button. Intended for the object-selected
 * toolbar states (shape / image / text-element / mixed).
 *
 * Wired into the toolbar by Task 8's object-section.tsx. Not rendered in
 * idle or text-edit states.
 */
export function ArrangeMenu({ editor, selectionSize }: ArrangeMenuProps) {
  const canAlign = !!editor && selectionSize > 0;
  const canDistribute = !!editor && selectionSize >= 3;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Arrange"
              disabled={!editor}
              className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <IconStack2 size={16} />
              <IconChevronDown size={12} className="ml-0.5 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Arrange</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start">
        {/* Z-order */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Order</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => editor?.bringToFront()}>
              Bring to front
              <Shortcut>{modKey}⇧↑</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.bringForward()}>
              Bring forward
              <Shortcut>{modKey}↑</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.sendBackward()}>
              Send backward
              <Shortcut>{modKey}↓</Shortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.sendToBack()}>
              Send to back
              <Shortcut>{modKey}⇧↓</Shortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Align */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!canAlign}>Align</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem disabled={!canAlign} onClick={() => editor?.align('left')}>
              <IconLayoutAlignLeft size={16} className="mr-2" />
              Left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canAlign} onClick={() => editor?.align('center-h')}>
              <IconLayoutAlignCenter size={16} className="mr-2" />
              Center
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canAlign} onClick={() => editor?.align('right')}>
              <IconLayoutAlignRight size={16} className="mr-2" />
              Right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canAlign} onClick={() => editor?.align('top')}>
              <IconLayoutAlignTop size={16} className="mr-2" />
              Top
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canAlign} onClick={() => editor?.align('center-v')}>
              <IconLayoutAlignMiddle size={16} className="mr-2" />
              Middle
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canAlign} onClick={() => editor?.align('bottom')}>
              <IconLayoutAlignBottom size={16} className="mr-2" />
              Bottom
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Distribute */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!canDistribute}>Distribute</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              disabled={!canDistribute}
              onClick={() => editor?.distribute('horizontal')}
            >
              <IconLayoutDistributeHorizontal size={16} className="mr-2" />
              Horizontally
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canDistribute}
              onClick={() => editor?.distribute('vertical')}
            >
              <IconLayoutDistributeVertical size={16} className="mr-2" />
              Vertically
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Rotate */}
        <DropdownMenuItem
          disabled={!canAlign}
          onClick={() => editor?.rotateBy(Math.PI / 2)}
        >
          Rotate 90° clockwise
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAlign}
          onClick={() => editor?.rotateBy(-Math.PI / 2)}
        >
          Rotate 90° counter-clockwise
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Keyboard shortcut label displayed on the right side of a menu item. */
function Shortcut({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto text-[11px] text-muted-foreground">{children}</span>
  );
}
