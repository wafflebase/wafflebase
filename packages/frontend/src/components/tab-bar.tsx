import { useState, useRef, useEffect, useCallback } from "react";
import { IconPlus, IconTable, IconDatabase } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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
import type { TabMeta, TabType } from "@/types/worksheet";

type TabBarProps = {
  tabs: TabMeta[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onAddTab: (type: TabType) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onDeleteTab: (tabId: string) => void;
  onMoveTab?: (fromIndex: number, toIndex: number) => void;
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
  onContextMenu,
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
  onContextMenu: (e: React.MouseEvent) => void;
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
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 text-sm rounded-t border-b-2 cursor-pointer select-none",
        "hover:bg-muted/50 transition-colors",
        isActive
          ? "border-primary bg-background text-foreground font-medium"
          : "border-transparent text-muted-foreground",
      )}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {tab.type === "datasource" ? (
        <IconDatabase className="size-3.5" />
      ) : (
        <IconTable className="size-3.5" />
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          className="w-20 bg-transparent border-b border-primary text-sm outline-none"
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

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onMoveTab,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextTabId, setContextTabId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (editingTabId && editValue.trim()) {
      onRenameTab(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  }, [editingTabId, editValue, onRenameTab]);

  const cancelRename = useCallback(() => {
    setEditingTabId(null);
  }, []);

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
    <div className="flex items-center border-t bg-muted/30 px-1 h-9 shrink-0">
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
          {tabs.map((tab) => (
            <DropdownMenu
              key={tab.id}
              open={contextTabId === tab.id}
              onOpenChange={(open) => {
                if (!open) setContextTabId(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <div>
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextTabId(tab.id);
                    }}
                    inputRef={inputRef}
                  />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => {
                    setContextTabId(null);
                    // Delay so the dropdown fully unmounts before we try to focus the input
                    setTimeout(() => startRename(tab), 0);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                {tabs.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDeleteTab(tab.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </SortableContext>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center justify-center size-7 ml-1 rounded hover:bg-muted/50 text-muted-foreground cursor-pointer">
            <IconPlus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onAddTab("sheet")}>
            <IconTable className="size-4" />
            New Sheet
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddTab("datasource")}>
            <IconDatabase className="size-4" />
            New DataSource
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
