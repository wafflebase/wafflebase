import { useState, useRef, useEffect, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader({
  title,
  editable = false,
  onRename,
  children,
}: {
  title: string;
  editable?: boolean;
  onRename?: (newTitle: string) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(title);
  }, [title]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, title, onRename]);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center justify-between gap-1 px-4 lg:gap-2 lg:px-6 min-h-[3.5rem]">
        <div className="flex items-center gap-1 lg:gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 data-[orientation=vertical]:h-4"
          />
          {editing ? (
            <input
              ref={inputRef}
              className="text-base font-medium bg-transparent border-b border-primary outline-none px-1 min-w-[120px]"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setEditValue(title);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <h1
              className={`text-base font-medium ${editable ? "cursor-pointer hover:bg-muted/50 px-1 rounded transition-colors" : ""}`}
              onClick={() => {
                if (editable) setEditing(true);
              }}
              title={editable ? "Click to rename" : undefined}
            >
              {title}
            </h1>
          )}
        </div>

        {/* Always reserve space for children to prevent layout shift */}
        <div className="flex items-center min-w-0">{children}</div>
      </div>
    </header>
  );
}
