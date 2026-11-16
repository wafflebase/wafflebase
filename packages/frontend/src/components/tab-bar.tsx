import { useState, useRef, useEffect, useCallback } from "react";
import {
  IconBuildingWarehouse,
  IconChevronDown,
  IconDatabase,
  IconPlus,
  IconTable,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { SHEET_TAB_PANEL_ID, sheetTabElementId } from "./tab-bar-ids";
import type { TabMeta, TabType } from "@/types/worksheet";

type TabBarProps = {
  tabs: TabMeta[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onAddTab: (type: TabType) => void;
  onRenameTab: (tabId: string, name: string) => boolean;
  onDeleteTab: (tabId: string) => void;
  onMoveTab?: (fromIndex: number, toIndex: number) => void;
  /** Copies a sheet tab next to itself; Duplicate is hidden without it. */
  onDuplicateTab?: (tabId: string) => void;
};

function SortableTab({
  tab,
  isActive,
  isEditing,
  editValue,
  onEditValueChange,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onKeyDown,
  tabRef,
  inputRef,
}: {
  tab: TabMeta;
  isActive: boolean;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (v: string) => void;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  tabRef: (el: HTMLButtonElement | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, disabled: isEditing });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <button
      ref={(el) => {
        setNodeRef(el);
        tabRef(el);
      }}
      style={style}
      className={cn(
        "shrink-0 flex items-center gap-1.5 px-3 py-1 text-sm whitespace-nowrap rounded-t border-b-2 cursor-pointer select-none",
        "hover:bg-muted/50 transition-colors",
        isActive
          ? "border-primary bg-background text-foreground font-medium"
          : "border-transparent text-muted-foreground",
      )}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      {...attributes}
      {...listeners}
      // After the dnd-kit spread, which would otherwise make this a
      // `role="button"` announced as "sortable" with every tab in the Tab
      // order. Reordering is pointer-only (no keyboard sensor) and the tab
      // menu's Move left / Move right is the keyboard path.
      role="tab"
      id={sheetTabElementId(tab.id)}
      aria-controls={SHEET_TAB_PANEL_ID}
      aria-roledescription={undefined}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onKeyDown={onKeyDown}
    >
      {tab.type === "datasource" ? (
        <IconDatabase className="size-3.5" />
      ) : tab.type === "lakehouse" ? (
        <IconBuildingWarehouse className="size-3.5" />
      ) : (
        <IconTable className="size-3.5" />
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          aria-label="Rename tab"
          className="w-20 bg-transparent border-b border-primary text-base md:text-sm outline-none"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
            e.stopPropagation();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span>{tab.name}</span>
      )}
    </button>
  );
}

/**
 * Renders the TabBar component.
 */
export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onMoveTab,
  onDuplicateTab,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  // Focus the rename input — use a small delay to ensure the dropdown
  // has fully closed and won't steal focus back.
  useEffect(() => {
    if (!editingTabId) return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [editingTabId]);

  const startRename = useCallback((tab: TabMeta) => {
    setEditingTabId(tab.id);
    setEditValue(tab.name);
  }, []);

  const commitRename = useCallback(() => {
    if (!editingTabId) {
      setEditingTabId(null);
      return;
    }

    const nextName = editValue.trim();
    if (!nextName) {
      setEditingTabId(null);
      return;
    }

    const renamed = onRenameTab(editingTabId, nextName);
    if (!renamed) {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
      return;
    }

    setEditingTabId(null);
  }, [editingTabId, editValue, onRenameTab]);

  const cancelRename = useCallback(() => {
    setEditingTabId(null);
  }, []);

  // WAI-ARIA tabs with automatic activation: the arrow keys move focus and
  // select, so a keyboard user can reach a tab the roving `tabIndex` keeps
  // out of the Tab order.
  const handleTabKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
      let next: number;
      if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (e.key === "ArrowLeft")
        next = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      const target = tabs[next];
      onSelectTab(target.id);
      tabRefs.current.get(target.id)?.focus();
    },
    [tabs, onSelectTab],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onMoveTab) return;

      const fromIndex = tabs.findIndex((t) => t.id === active.id);
      const toIndex = tabs.findIndex((t) => t.id === over.id);
      if (fromIndex !== -1 && toIndex !== -1) {
        onMoveTab(fromIndex, toIndex);
      }
    },
    [tabs, onMoveTab],
  );

  return (
    <div className="overflow-x-auto border-t bg-muted/30 px-1 h-9 shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex h-full items-center w-max">
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex h-full items-center"
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tabs.map((t) => t.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab, index) => (
                <ContextMenu key={tab.id}>
                  <ContextMenuTrigger asChild>
                    <div role="presentation">
                      <SortableTab
                        tab={tab}
                        isActive={tab.id === activeTabId}
                        isEditing={editingTabId === tab.id}
                        editValue={editValue}
                        onEditValueChange={setEditValue}
                        onSelect={() => onSelectTab(tab.id)}
                        onStartRename={() => startRename(tab)}
                        onCommitRename={commitRename}
                        onCancelRename={cancelRename}
                        onKeyDown={(e) => handleTabKeyDown(index, e)}
                        tabRef={(el) => {
                          if (el) tabRefs.current.set(tab.id, el);
                          else tabRefs.current.delete(tab.id);
                        }}
                        inputRef={inputRef}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        setTimeout(() => startRename(tab), 0);
                      }}
                    >
                      Rename
                    </ContextMenuItem>
                    {/* A data source / lakehouse tab has no worksheet to copy. */}
                    {onDuplicateTab && tab.type === "sheet" && (
                      <ContextMenuItem onSelect={() => onDuplicateTab(tab.id)}>
                        Duplicate
                      </ContextMenuItem>
                    )}
                    {onMoveTab && tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          disabled={index === 0}
                          onSelect={() => onMoveTab(index, index - 1)}
                        >
                          Move left
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={index === tabs.length - 1}
                          onSelect={() => onMoveTab(index, index + 1)}
                        >
                          Move right
                        </ContextMenuItem>
                      </>
                    )}
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => onDeleteTab(tab.id)}
                        >
                          Delete
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* "+" adds a sheet in one click, as in Google Sheets. The connected
            tab kinds have no Google counterpart, so they sit one click
            further, named for what they do rather than for their engine. */}
        <button
          type="button"
          aria-label="Add sheet"
          title="Add sheet"
          className="shrink-0 flex items-center justify-center size-7 ml-1 rounded hover:bg-muted/50 text-muted-foreground cursor-pointer"
          onClick={() => onAddTab("sheet")}
        >
          <IconPlus className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More tab types"
              title="More tab types"
              className="shrink-0 flex items-center justify-center w-5 h-7 rounded hover:bg-muted/50 text-muted-foreground cursor-pointer"
            >
              <IconChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onAddTab("datasource")}>
              <IconDatabase className="size-4" />
              Connect data source (SQL)…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAddTab("lakehouse")}>
              <IconBuildingWarehouse className="size-4" />
              Connect lakehouse table…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
