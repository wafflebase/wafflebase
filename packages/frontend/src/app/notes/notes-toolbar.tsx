import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  NoteEditorAPI,
  NoteViewMode,
  NoteInlineFormats,
  NoteKeymap,
  NoteHeadingLevel,
} from "@wafflebase/notes";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Toolbar,
  ToolbarSeparator,
  ToolbarButton,
} from "@/components/ui/toolbar";
import { TableGridPicker } from "@/components/table-grid-picker";
import { useIsMobile } from "@/hooks/use-mobile";
import { isMac, modKey } from "@/components/text-formatting/platform";
import { cn } from "@/lib/utils";
import {
  IconPencil,
  IconLayoutColumns,
  IconEye,
  IconChevronDown,
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconLink,
  IconBlockquote,
  IconCode,
  IconFold,
  IconTable,
  IconPhoto,
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconUserCode,
  IconList,
  IconListNumbers,
  IconListCheck,
  IconIndentIncrease,
  IconIndentDecrease,
  IconDotsVertical,
} from "@tabler/icons-react";

const KEYMAPS: { key: NoteKeymap; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "vim", label: "Vim" },
];

const MODES: { mode: NoteViewMode; label: string; Icon: typeof IconEye }[] = [
  { mode: "edit", label: "Editor", Icon: IconPencil },
  { mode: "both", label: "Split", Icon: IconLayoutColumns },
  { mode: "view", label: "Preview", Icon: IconEye },
];

const EMPTY_FORMATS: NoteInlineFormats = {
  bold: false,
  italic: false,
  strikethrough: false,
  link: false,
  list: null,
  canIndent: false,
  canOutdent: false,
  heading: 0,
};

/**
 * A formatting shortcut as `packages/notes` binds it (`formattingBindings` in
 * `editor.ts`): always the platform modifier, plus optional Shift / Alt.
 */
interface Shortcut {
  key: string;
  shift?: boolean;
  alt?: boolean;
}

/** `⌘+⇧X` on a Mac, `Ctrl+Shift+X` elsewhere — the app's tooltip style. */
function shortcutLabel({ key, shift, alt }: Shortcut): string {
  if (isMac) return `${modKey}+${shift ? "⇧" : ""}${alt ? "⌥" : ""}${key}`;
  return [modKey, shift && "Shift", alt && "Alt", key]
    .filter(Boolean)
    .join("+");
}

/** The same chord in `aria-keyshortcuts` syntax. */
function ariaShortcut({ key, shift, alt }: Shortcut): string {
  return [isMac ? "Meta" : "Control", shift && "Shift", alt && "Alt", key]
    .filter(Boolean)
    .join("+");
}

const SHORTCUTS = {
  bold: { key: "B" },
  italic: { key: "I" },
  strikethrough: { key: "X", shift: true },
  link: { key: "K" },
  ordered: { key: "7", shift: true },
  bullet: { key: "8", shift: true },
  task: { key: "9", shift: true },
} satisfies Record<string, Shortcut>;

/**
 * Markdown has six heading levels and no Title / Subtitle, so this is the
 * docs style picker's list minus those two, with the same Mod+Alt+<n> keys.
 * Each item previews its level by weight and size, as that picker does.
 */
const HEADINGS: { level: NoteHeadingLevel; label: string; className: string }[] =
  [
    { level: 0, label: "Normal text", className: "text-sm" },
    { level: 1, label: "Heading 1", className: "text-lg font-semibold" },
    { level: 2, label: "Heading 2", className: "text-base font-semibold" },
    { level: 3, label: "Heading 3", className: "text-sm font-semibold" },
    { level: 4, label: "Heading 4", className: "text-sm font-medium" },
    {
      level: 5,
      label: "Heading 5",
      className: "text-xs font-medium text-muted-foreground",
    },
    {
      level: 6,
      label: "Heading 6",
      className: "text-xs font-medium italic text-muted-foreground",
    },
  ];

/**
 * Tooltip text for a control: its name, plus its shortcut when the editor
 * actually has one bound (see `NotesToolbar`'s `shortcutsBound`).
 */
function tooltipText(label: string, shortcut?: Shortcut): string {
  return shortcut ? `${label} (${shortcutLabel(shortcut)})` : label;
}

function TooltipToggle({
  label,
  pressed,
  onToggle,
  shortcut,
  children,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  shortcut?: Shortcut;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={pressed}
          onPressedChange={onToggle}
          className="h-7 w-7 cursor-pointer"
          aria-label={label}
          aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{tooltipText(label, shortcut)}</TooltipContent>
    </Tooltip>
  );
}

/** Plain (non-toggle) toolbar action with a tooltip and disabled state. */
function TooltipButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarButton aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </ToolbarButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Table insert as a hover-grid size picker, mirroring the docs toolbar. */
function TableDropdown({ editor }: { editor: NoteEditorAPI }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarButton aria-label="Insert table">
              <IconTable size={16} />
            </ToolbarButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Insert table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        sideOffset={4}
        // Radix focuses the menu container on open; redirect focus to the grid
        // so its arrow-key sizing handler is reachable.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>('[role="grid"]')
            ?.focus();
        }}
      >
        <TableGridPicker
          onSelect={(rows, cols) => {
            editor.insertTable(rows, cols);
            editor.focus();
            setOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Paragraph style picker: Normal text / Heading 1–6, labelled with the caret
 * line's current level. On a phone the trigger shrinks to `Text` / `H1`…
 * so the strip still fits. Picking hands focus back to the editor rather than
 * to the trigger, so typing continues on the restyled line.
 */
function HeadingMenu({
  editor,
  level,
  showShortcuts,
  compact,
}: {
  editor: NoteEditorAPI;
  level: NoteHeadingLevel;
  showShortcuts: boolean;
  compact: boolean;
}) {
  const current = HEADINGS.find((h) => h.level === level) ?? HEADINGS[0];
  const triggerLabel = compact
    ? level === 0
      ? "Text"
      : `H${level}`
    : current.label;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <ToolbarButton
              variant="menu"
              aria-label={`Text style: ${current.label}`}
              className={cn(
                "justify-between text-xs",
                compact ? "min-w-11" : "min-w-[6.5rem]",
              )}
            >
              <span className="truncate">{triggerLabel}</span>
              <IconChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
            </ToolbarButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Text style</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.focus();
        }}
      >
        {HEADINGS.map((h) => (
          <DropdownMenuCheckboxItem
            key={h.level}
            checked={h.level === level}
            onCheckedChange={() => editor.setHeading(h.level)}
            className="justify-between gap-4"
          >
            <span className={h.className}>{h.label}</span>
            {showShortcuts && (
              <span className="text-xs text-muted-foreground">
                {shortcutLabel({ key: String(h.level), alt: true })}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Image insert via a hidden file input — the keyboard/touch equivalent of
 * pasting or dropping a file, which the editor handles on its own. The accept
 * list mirrors the upload endpoint's allowed types so the picker filters what
 * the server would reject anyway.
 *
 * The input is mounted separately from its trigger because there are two
 * triggers: the toolbar button on desktop and the overflow-menu item on
 * mobile. Both open this one input via the ref.
 */
function ImageFileInput({
  inputRef,
  editor,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  editor: NoteEditorAPI;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files?.length) editor.insertImageFiles(e.target.files);
        // Clear the value so picking the same file again still fires change.
        e.target.value = "";
      }}
    />
  );
}

/**
 * Everything the strip cannot hold on a phone, in one `⋮` menu — the same
 * shape the docs toolbar uses (`docs-formatting-toolbar.tsx`): the inline text
 * formats stay on the strip, the list and insert controls move here under
 * labelled sections.
 *
 * Table is a fixed 3×3 insert rather than the desktop's `TableGridPicker`,
 * which sizes the table by hovering across a grid and so has no touch
 * equivalent. Docs' mobile menu settled on the same 3×3.
 */
function MobileOverflowMenu({
  editor,
  formats,
  onPickImage,
}: {
  editor: NoteEditorAPI;
  formats: NoteInlineFormats;
  onPickImage: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton aria-label="More formatting options">
          <IconDotsVertical size={16} />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // Radix returns focus to the trigger when the menu closes, which on a
        // phone means the caret leaves the document and the soft keyboard
        // drops — right after the user asked for a formatting change they
        // want to keep typing into. Hand focus back to the editor instead.
        // (`TableDropdown` calls `editor.focus()` inline for the same reason;
        // doing it here covers every item at once.)
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.focus();
        }}
      >
        {/* Strikethrough lives here on a phone so the strip keeps room for
            undo/redo, heading, bold and italic beside the pinned controls. */}
        <DropdownMenuCheckboxItem
          checked={formats.strikethrough}
          onCheckedChange={() => editor.toggleStrikethrough()}
          className="gap-2"
        >
          <IconStrikethrough size={16} />
          Strikethrough
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Lists</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={formats.list === "bullet"}
          onCheckedChange={() => editor.toggleBulletList()}
          className="gap-2"
        >
          <IconList size={16} />
          Bullet list
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={formats.list === "ordered"}
          onCheckedChange={() => editor.toggleOrderedList()}
          className="gap-2"
        >
          <IconListNumbers size={16} />
          Numbered list
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={formats.list === "task"}
          onCheckedChange={() => editor.toggleTaskList()}
          className="gap-2"
        >
          <IconListCheck size={16} />
          Checkbox
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          disabled={!formats.canIndent}
          onClick={() => editor.indentList()}
          className="gap-2"
        >
          <IconIndentIncrease size={16} />
          Indent
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!formats.canOutdent}
          onClick={() => editor.outdentList()}
          className="gap-2"
        >
          <IconIndentDecrease size={16} />
          Outdent
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Insert</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={formats.link}
          onCheckedChange={() => editor.toggleLink()}
          className="gap-2"
        >
          <IconLink size={16} />
          Link
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          onClick={() => editor.toggleQuote()}
          className="gap-2"
        >
          <IconBlockquote size={16} />
          Quote
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.insertCodeBlock()}
          className="gap-2"
        >
          <IconCode size={16} />
          Code block
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.insertFoldout()}
          className="gap-2"
        >
          <IconFold size={16} />
          Foldout
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.insertTable(3, 3)}
          className="gap-2"
        >
          <IconTable size={16} />
          Table (3×3)
        </DropdownMenuItem>
        {editor.canInsertImage() && (
          <DropdownMenuItem onClick={onPickImage} className="gap-2">
            <IconPhoto size={16} />
            Image
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Thin notes toolbar: a markdown-formatting group (bold / italic /
 * strikethrough toggles, link toggle, quote / code / foldout / table inserts)
 * on the left when editing, and on the right the view modes plus an
 * "Editor settings" menu (keyboard mode, show authors). The view modes are
 * visible toggles rather than a menu: switching between source, split and
 * the rendered note is the most frequent layout change in a note. Uses the
 * same Toggle + tooltip + tabler-icon look as the docs/sheets toolbars, and
 * each tooltip names its Google-Docs shortcut where one is bound.
 *
 * Two layouts. Above the mobile breakpoint the formatting group is the full
 * inline row and the modes are Editor / Split / Preview. Below it, only
 * undo/redo, the text style and the inline text formats stay on the strip —
 * the rest moves into `MobileOverflowMenu` — and the modes collapse to one
 * Preview toggle, Split being a two-pane layout. See the `isMobile` branches
 * for why each is the way it is.
 */
export function NotesToolbar({
  mode,
  onModeChange,
  keymap,
  onKeymapChange,
  showAuthors,
  onShowAuthorsChange,
  editor,
  readOnly,
}: {
  mode: NoteViewMode;
  onModeChange: (mode: NoteViewMode) => void;
  keymap: NoteKeymap;
  onKeymapChange: (keymap: NoteKeymap) => void;
  /** Whether the blame gutter (who last edited each line) is shown. */
  showAuthors: boolean;
  onShowAuthorsChange: (show: boolean) => void;
  editor: NoteEditorAPI | null;
  readOnly?: boolean;
}) {
  const [formats, setFormats] = useState<NoteInlineFormats>(EMPTY_FORMATS);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const isMobile = useIsMobile();
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor) {
      setFormats(EMPTY_FORMATS);
      setHistory({ canUndo: false, canRedo: false });
      return;
    }
    // The selection-change callback fires on every doc/selection change, which
    // is exactly when both inline formats and undo/redo depth can change — so
    // we refresh both from the one subscription.
    const refresh = (f: NoteInlineFormats) => {
      setFormats(f);
      setHistory({ canUndo: editor.canUndo(), canRedo: editor.canRedo() });
    };
    refresh(editor.getActiveFormats());
    editor.onSelectionChange(refresh);
    return () => editor.onSelectionChange(null);
  }, [editor]);

  const canFormat = !readOnly && mode !== "view";
  // Vim mode binds the formatting keys on a Mac only (Ctrl-B / Ctrl-I are
  // vim's own keys elsewhere — `formattingBindings` in `packages/notes`), so a
  // tooltip only advertises a shortcut the editor will actually honour.
  const shortcutsBound = keymap === "default" || isMac;
  const sc = (shortcut: Shortcut) => (shortcutsBound ? shortcut : undefined);

  return (
    // `role` makes the label below reachable: `aria-label` on a generic
    // container is not exposed to the accessibility tree.
    //
    // Two strips: the formatting controls scroll sideways in their own
    // inner strip, while the view-mode toggle and Editor settings stay
    // pinned at the right. On a phone the whole row used to scroll as one
    // (~524px in 393px), which put Preview — the primary mode switch —
    // off screen. The outer strip keeps the coarse-pointer sizing for both.
    <Toolbar
      role="toolbar"
      aria-label="Note toolbar"
      className="overflow-hidden"
    >
      {canFormat && editor && (
        <Toolbar className="min-w-0 flex-1 border-b-0 bg-transparent p-0 pointer-coarse:py-0">
          <TooltipButton
            label="Undo"
            disabled={!history.canUndo}
            onClick={() => editor.undo()}
          >
            <IconArrowBackUp size={16} />
          </TooltipButton>
          <TooltipButton
            label="Redo"
            disabled={!history.canRedo}
            onClick={() => editor.redo()}
          >
            <IconArrowForwardUp size={16} />
          </TooltipButton>
          {!isMobile && <ToolbarSeparator />}
          <HeadingMenu
            editor={editor}
            level={formats.heading}
            showShortcuts={shortcutsBound}
            compact={isMobile}
          />
          {!isMobile && <ToolbarSeparator />}
          <TooltipToggle
            label="Bold"
            pressed={formats.bold}
            onToggle={() => editor.toggleBold()}
            shortcut={sc(SHORTCUTS.bold)}
          >
            <IconBold size={16} />
          </TooltipToggle>
          <TooltipToggle
            label="Italic"
            pressed={formats.italic}
            onToggle={() => editor.toggleItalic()}
            shortcut={sc(SHORTCUTS.italic)}
          >
            <IconItalic size={16} />
          </TooltipToggle>
          {!isMobile && (
            <TooltipToggle
              label="Strikethrough"
              pressed={formats.strikethrough}
              onToggle={() => editor.toggleStrikethrough()}
              shortcut={sc(SHORTCUTS.strikethrough)}
            >
              <IconStrikethrough size={16} />
            </TooltipToggle>
          )}
          {!isMobile && <ToolbarSeparator />}

          {/* One hidden input for both triggers (button / overflow item). */}
          {editor.canInsertImage() && (
            <ImageFileInput inputRef={imageInputRef} editor={editor} />
          )}

          {/* Eighteen controls do not fit a phone: there only undo/redo,
              the heading menu and the inline formats stay in the strip, and
              the rest moves into the overflow menu pinned beside the view
              toggle below. */}
          {!isMobile && (
            <>
              {/* List group: the three kinds are toggles (pressed when every
              selected line is of that kind), indent/outdent plain buttons that
              disable when the block cannot nest further in that direction.
              All five apply to every line the selection covers. */}
              <TooltipToggle
                label="Bullet list"
                pressed={formats.list === "bullet"}
                onToggle={() => editor.toggleBulletList()}
                shortcut={sc(SHORTCUTS.bullet)}
              >
                <IconList size={16} />
              </TooltipToggle>
              <TooltipToggle
                label="Numbered list"
                pressed={formats.list === "ordered"}
                onToggle={() => editor.toggleOrderedList()}
                shortcut={sc(SHORTCUTS.ordered)}
              >
                <IconListNumbers size={16} />
              </TooltipToggle>
              <TooltipToggle
                label="Checkbox"
                pressed={formats.list === "task"}
                onToggle={() => editor.toggleTaskList()}
                shortcut={sc(SHORTCUTS.task)}
              >
                <IconListCheck size={16} />
              </TooltipToggle>
              <TooltipButton
                label="Indent"
                disabled={!formats.canIndent}
                onClick={() => editor.indentList()}
              >
                <IconIndentIncrease size={16} />
              </TooltipButton>
              <TooltipButton
                label="Outdent"
                disabled={!formats.canOutdent}
                onClick={() => editor.outdentList()}
              >
                <IconIndentDecrease size={16} />
              </TooltipButton>
              <ToolbarSeparator />
              <TooltipToggle
                label="Link"
                pressed={formats.link}
                onToggle={() => editor.toggleLink()}
                shortcut={sc(SHORTCUTS.link)}
              >
                <IconLink size={16} />
              </TooltipToggle>
              <TooltipButton label="Quote" onClick={() => editor.toggleQuote()}>
                <IconBlockquote size={16} />
              </TooltipButton>
              <TooltipButton
                label="Code block"
                onClick={() => editor.insertCodeBlock()}
              >
                <IconCode size={16} />
              </TooltipButton>
              {/* Foldout is a plain insert, not a toggle: foldouts nest. */}
              <TooltipButton
                label="Foldout"
                onClick={() => editor.insertFoldout()}
              >
                <IconFold size={16} />
              </TooltipButton>
              <TableDropdown editor={editor} />
              {editor.canInsertImage() && (
                <TooltipButton
                  label="Insert image"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <IconPhoto size={16} />
                </TooltipButton>
              )}
            </>
          )}
        </Toolbar>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {isMobile && canFormat && editor && (
          <>
            <MobileOverflowMenu
              editor={editor}
              formats={formats}
              onPickImage={() => imageInputRef.current?.click()}
            />
          </>
        )}
        {isMobile ? (
          // Split is not offered on a phone (a fixed two-pane split is ~187px
          // a pane at 375px; both mounting routes demote a stored `both` to
          // `edit`), which leaves two modes — so one toggle: pressed reads the
          // rendered note, released edits the source.
          <TooltipToggle
            label="Preview"
            pressed={mode === "view"}
            onToggle={() => onModeChange(mode === "view" ? "edit" : "view")}
          >
            <IconEye size={16} />
          </TooltipToggle>
        ) : (
          <div
            role="group"
            aria-label="View mode"
            className="flex items-center gap-0.5"
          >
            {MODES.map(({ mode: m, label, Icon }) => (
              <TooltipToggle
                key={m}
                label={label}
                pressed={mode === m}
                // A mode is always selected, so pressing the active one is not
                // a request to turn it off — and must not be reported either:
                // `mode` is the *effective* mode, and echoing it back would
                // persist whatever the host demoted it to.
                onToggle={() => {
                  if (m !== mode) onModeChange(m);
                }}
              >
                <Icon size={16} />
              </TooltipToggle>
            ))}
          </div>
        )}
        {!isMobile && <ToolbarSeparator />}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ToolbarButton aria-label="Editor settings">
                  <IconAdjustmentsHorizontal size={16} />
                </ToolbarButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Editor settings</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            {!readOnly && (
              <>
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                  Keyboard
                </DropdownMenuLabel>
                {KEYMAPS.map(({ key, label }) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={keymap === key}
                    onCheckedChange={() => {
                      if (key !== keymap) onKeymapChange(key);
                    }}
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {/*
              Display only: every client records authorship, so this decides
              what you see, not what you leave behind. The title still says
              that a name is recorded — it is the part a user cannot see, and
              it is durable (it goes into the note's content, readable by
              anyone who can read the note), so this menu is where they find
              out.
            */}
            <DropdownMenuCheckboxItem
              checked={showAuthors}
              onCheckedChange={(next) => onShowAuthorsChange(next)}
              className="gap-2"
              title="Show who last edited each line. Names are self-reported: everyone editing this note records their display name on the text they write, and it is visible to everyone who can read the note."
            >
              <IconUserCode size={16} />
              Show authors
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Toolbar>
  );
}

export default NotesToolbar;
