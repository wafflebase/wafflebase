import { useState, useRef, useEffect } from "react";
import { IconPlus, IconTable, IconDatabase } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TabMeta, TabType } from "@/types/worksheet";

type TabBarProps = {
  tabs: TabMeta[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onAddTab: (type: TabType) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onDeleteTab: (tabId: string) => void;
};

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextTabId, setContextTabId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleDoubleClick = (tab: TabMeta) => {
    setEditingTabId(tab.id);
    setEditValue(tab.name);
  };

  const commitRename = () => {
    if (editingTabId && editValue.trim()) {
      onRenameTab(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  };

  return (
    <div className="flex items-center border-t bg-muted/30 px-1 h-9 shrink-0">
      {tabs.map((tab) => (
        <DropdownMenu
          key={tab.id}
          open={contextTabId === tab.id}
          onOpenChange={(open) => {
            if (!open) setContextTabId(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-sm rounded-t border-b-2 cursor-pointer select-none",
                "hover:bg-muted/50 transition-colors",
                tab.id === activeTabId
                  ? "border-primary bg-background text-foreground font-medium"
                  : "border-transparent text-muted-foreground",
              )}
              onClick={() => {
                onSelectTab(tab.id);
              }}
              onDoubleClick={() => handleDoubleClick(tab)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextTabId(tab.id);
              }}
            >
              {tab.type === "datasource" ? (
                <IconDatabase className="size-3.5" />
              ) : (
                <IconTable className="size-3.5" />
              )}
              {editingTabId === tab.id ? (
                <input
                  ref={inputRef}
                  className="w-20 bg-transparent border-b border-primary text-sm outline-none"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span>{tab.name}</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => handleDoubleClick(tab)}>
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
