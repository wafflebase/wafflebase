/*
 * HOW WAFFLEBASE'S OWN PRIMITIVES WANT TO BE MOUNTED.
 *
 * The editor's generic mount is `<Component {...generated}>{name}</Component>`. For a
 * styled primitive — Button, Badge, Toggle — that is the whole answer. For most of a
 * shadcn `ui/` directory it is not, and the pane said so 60 times over: `DropdownMenuItem`
 * outside its menu throws `must be used within`, `SelectValue` the same, a `Slider` with
 * no width is a zero-pixel line, and a `TableCell` alone is an unstyled `<td>`.
 *
 * None of that is the editor's to know. "A slider wants 260px" and "our menus carry an
 * icon and a shortcut" are facts about THIS design system, which is why the plugin takes
 * this file as an option (`previews`) rather than shipping a table of its own. A
 * component with no entry here still mounts the generic way.
 *
 * TWO SHAPES, and the choice is not stylistic:
 *   - `frame` / `props` decorate the real mount. Use them when the component IS the
 *     subject and only needs room or a value — Slider, Input, Avatar.
 *   - `render` replaces it. Use it when the subject cannot exist alone: every part of a
 *     Dropdown, Select, Dialog, Tooltip, Tabs or Table needs its parent, so the recipe
 *     mounts the parent and puts the real component in its place inside it.
 *
 * The dummy content is deliberately CONCRETE — "Rename", "Move to…", ⌘K — because a menu
 * of "Item 1 / Item 2" tells you nothing about how the real one wraps, truncates or
 * aligns, which is the only reason to look at it.
 */
import type { ReactNode } from 'react';
import { FileText, Pencil, Share2, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet } from '@/components/ui/sheet';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AvatarFallback } from '@/components/ui/avatar';
import { ToolbarButton, ToolbarSeparator } from '@/components/ui/toolbar';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

type Mount = (C: (p: Record<string, unknown>) => ReactNode, props: Record<string, unknown>) => ReactNode;

interface Recipe {
  props?: Record<string, unknown>;
  render?: Mount;
  frame?: { width?: number | string; height?: number | string };
  /** `false` where the component renders a void element and cannot take children. */
  children?: false;
}

/**
 * A composite's part, mounted inside the parent it needs.
 *
 * `open` is forced and `modal` disabled on purpose: an overlay that only appears on click
 * is an overlay you cannot sit and style, and a modal one would take the pointer for the
 * whole frame — including the editor's own pan and zoom.
 */
const inMenu =
  (before?: ReactNode, after?: ReactNode): Mount =>
  (C, props) => (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Menu
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {before}
        <C {...props} />
        {after}
      </DropdownMenuContent>
    </DropdownMenu>
  );

const inSelect =
  (): Mount =>
  (C, props) => (
    <Select open>
      <SelectTrigger className="w-52">
        <SelectValue placeholder="Choose a workspace" />
      </SelectTrigger>
      <SelectContent>
        <C {...props} />
      </SelectContent>
    </Select>
  );

/*
 * THE COMPOSITE ROOTS, assembled.
 *
 * The catalogue folds a module's parts behind its root — `DropdownMenu` rather than
 * fifteen `DropdownMenu…` rows — which only helps if selecting the root shows the whole
 * thing. Mounted bare it shows nothing at all: `<DropdownMenu>` with no trigger and no
 * content renders an empty fragment, `<Card>` an empty box. So each root gets the
 * assembly a designer would actually judge — a menu with a label, three items, a
 * separator and a shortcut; a card with a header, body and footer.
 *
 * The parts keep their own single-part recipes below. Both are useful and they answer
 * different questions: "does our menu look right" and "how does one item wrap".
 */
const previews: Record<string, Recipe> = {
  // --- things that only need room or a value -------------------------------
  // A slider with no width has nothing to slide along, so the handle cannot move and
  // the track cannot be judged. 260px is roughly what the app gives it in a panel.
  Slider: { frame: { width: 260 }, props: { defaultValue: [40], max: 100, step: 1 }, children: false },
  // `children: false` — these render a bare `<input>` / `<hr>`, which React refuses to
  // give children at all, so the generic label was reported as a crash.
  Input: { frame: { width: 260 }, props: { placeholder: 'Search by title…' }, children: false },
  SidebarInput: { frame: { width: 220 }, props: { placeholder: 'Search' }, children: false },
  Textarea: { frame: { width: 260 }, children: false },
  Progress: { frame: { width: 260 }, props: { value: 62 }, children: false },
  Separator: { frame: { width: 200 }, children: false },
  Skeleton: { frame: { width: 180, height: 16 }, children: false },
  Label: { props: { children: 'Workspace name' } },
  Checkbox: { props: { defaultChecked: true }, children: false },
  Switch: { props: { defaultChecked: true }, children: false },
  // --- dropdown menu: every part, inside a real open menu -------------------
  DropdownMenuContent: {
    render: (C, props) => (
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Menu
          </Button>
        </DropdownMenuTrigger>
        <C {...props} align="start" className="w-52">
          <div className="px-2 py-1.5 text-sm">Rename</div>
          <div className="px-2 py-1.5 text-sm">Move to…</div>
        </C>
      </DropdownMenu>
    ),
  },
  DropdownMenuItem: {
    render: inMenu(
      undefined,
      <div className="px-2 py-1.5 text-sm text-muted-foreground">a sibling, for spacing</div>,
    ),
    props: { children: <><Pencil /> Rename</> },
  },
  DropdownMenuCheckboxItem: {
    render: inMenu(),
    props: { checked: true, children: 'Spreadsheets' },
  },
  DropdownMenuRadioItem: { render: inMenu(), props: { value: 'a', children: 'Newest first' } },
  DropdownMenuLabel: { render: inMenu(), props: { children: 'Filter by type' } },
  DropdownMenuSeparator: {
    render: inMenu(
      <div className="px-2 py-1.5 text-sm">Above</div>,
      <div className="px-2 py-1.5 text-sm">Below</div>,
    ),
  },
  DropdownMenuShortcut: { render: inMenu(), props: { children: '⌘K' } },
  DropdownMenuGroup: {
    render: inMenu(),
    props: { children: <div className="px-2 py-1.5 text-sm">Grouped</div> },
  },
  DropdownMenuSubTrigger: { render: inMenu(), props: { children: 'Move to…' } },

  // --- select ---------------------------------------------------------------
  SelectItem: { render: inSelect(), props: { value: 'personal', children: 'Personal' } },
  SelectLabel: { render: inSelect(), props: { children: 'Workspaces' } },
  SelectSeparator: { render: inSelect() },
  SelectContent: {
    render: (C, props) => (
      <Select open>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Choose a workspace" />
        </SelectTrigger>
        <C {...props}>
          <div className="px-2 py-1.5 text-sm">Personal</div>
        </C>
      </Select>
    ),
  },
  SelectTrigger: {
    render: (C, props) => (
      <Select>
        <C {...props} className="w-52">
          <SelectValue placeholder="Choose a workspace" />
        </C>
      </Select>
    ),
  },
  SelectValue: {
    render: (C, props) => (
      <Select>
        <SelectTrigger className="w-52">
          <C {...props} placeholder="Choose a workspace" />
        </SelectTrigger>
      </Select>
    ),
  },

  // --- overlays that must be open to be seen --------------------------------
  TooltipContent: {
    render: (C, props) => (
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm">
            Hover target
          </Button>
        </TooltipTrigger>
        <C {...props}>Rename this document</C>
      </Tooltip>
    ),
  },
  PopoverContent: {
    render: (C, props) => (
      <Popover open modal={false}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Open
          </Button>
        </PopoverTrigger>
        <C {...props} className="w-60">
          <p className="text-sm">Anything can go in a popover.</p>
        </C>
      </Popover>
    ),
  },
  DialogContent: {
    render: (C, props) => (
      <Dialog open>
        <C {...props}>
          <h2 className="text-lg font-semibold">Delete document?</h2>
          <p className="text-sm text-muted-foreground">This cannot be undone.</p>
        </C>
      </Dialog>
    ),
  },
  SheetContent: {
    render: (C, props) => (
      <Sheet open>
        <C {...props}>
          <p className="p-4 text-sm">A side sheet.</p>
        </C>
      </Sheet>
    ),
  },
  ContextMenuContent: {
    render: (C, props) => (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="rounded-md border border-dashed px-6 py-4 text-xs text-muted-foreground">
            right-click area
          </div>
        </ContextMenuTrigger>
        <C {...props} />
      </ContextMenu>
    ),
  },

  // --- structural parts -----------------------------------------------------
  TabsList: {
    render: (C, props) => (
      <Tabs defaultValue="a">
        <C {...props}>
          <div className="px-3 py-1 text-sm">Documents</div>
          <div className="px-3 py-1 text-sm">Members</div>
        </C>
      </Tabs>
    ),
  },
  TabsTrigger: {
    render: (C, props) => (
      <Tabs defaultValue="a">
        <TabsList>
          <C {...props} value="a">
            Documents
          </C>
        </TabsList>
      </Tabs>
    ),
  },
  TableRow: {
    render: (C, props) => (
      <Table className="w-96">
        <TableBody>
          <C {...props}>
            <td className="p-2 text-sm">Q3 revenue</td>
            <td className="p-2 text-sm text-muted-foreground">2 days ago</td>
          </C>
        </TableBody>
      </Table>
    ),
  },
  TableCell: {
    render: (C, props) => (
      <Table className="w-96">
        <TableBody>
          <TableRow>
            <C {...props}>Q3 revenue</C>
          </TableRow>
        </TableBody>
      </Table>
    ),
  },
  TableHead: {
    render: (C, props) => (
      <Table className="w-96">
        <TableHeader>
          <TableRow>
            <C {...props}>Name</C>
          </TableRow>
        </TableHeader>
      </Table>
    ),
  },
  RadioGroupItem: {
    render: (C, props) => (
      <RadioGroup defaultValue="a" className="flex gap-3">
        <C {...props} value="a" />
        <C {...props} value="b" />
      </RadioGroup>
    ),
  },

  // --- the sidebar family, which needs its provider -------------------------
  SidebarMenuButton: {
    frame: { width: 220 },
    render: (C, props) => (
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SidebarContent>
            <SidebarMenu>
              <C {...props}>
                <FileText /> Documents
              </C>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ),
  },
  SidebarMenuItem: {
    frame: { width: 220 },
    render: (C, props) => (
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SidebarContent>
            <SidebarMenu>
              <C {...props}>
                <span className="px-2 py-1.5 text-sm">Documents</span>
              </C>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ),
  },

  // --- app components whose generated stand-ins are too thin ----------------
  NavMain: {
    frame: { width: 240 },
    props: {
      items: [
        { title: 'Documents', url: '/w/ws-fixture', icon: FileText },
        { title: 'Shared with me', url: '/w/ws-fixture/shared', icon: Share2 },
        { title: 'Trash', url: '/w/ws-fixture/trash', icon: Trash2 },
      ],
    },
  },
  NavUser: {
    frame: { width: 240 },
    props: { user: { username: 'hotsunchip', email: 'hot@wafflebase.io', photo: undefined } },
  },

  // --- composite roots, assembled ------------------------------------------
  DropdownMenu: {
    render: (C) => (
      <C open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Q3 revenue</DropdownMenuLabel>
          <DropdownMenuItem>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Share2 /> Share…
            <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </C>
    ),
  },
  Select: {
    render: (C) => (
      <C open>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Choose a workspace" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="acme">Acme Inc.</SelectItem>
          <SelectItem value="research">Research</SelectItem>
        </SelectContent>
      </C>
    ),
  },
  Card: {
    frame: { width: 320 },
    render: (C) => (
      <C>
        <CardHeader>
          <CardTitle>Q3 revenue</CardTitle>
          <CardDescription>Edited 2 days ago by hotsunchip</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          A spreadsheet with 12 tabs and three connected data sources.
        </CardContent>
        <CardFooter className="gap-2">
          <Button size="sm">Open</Button>
          <Button size="sm" variant="outline">
            Share
          </Button>
        </CardFooter>
      </C>
    ),
  },
  Dialog: {
    render: (C) => (
      <C open>
        <DialogContent>
          <h2 className="text-lg font-semibold">Delete “Q3 revenue”?</h2>
          <p className="text-sm text-muted-foreground">
            The document moves to trash. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          </div>
        </DialogContent>
      </C>
    ),
  },
  Avatar: {
    frame: { width: 40, height: 40 },
    render: (C) => (
      <C>
        <AvatarFallback>WB</AvatarFallback>
      </C>
    ),
  },
  Tabs: {
    frame: { width: 360 },
    render: (C) => (
      <C defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="api">API keys</TabsTrigger>
        </TabsList>
        <TabsContent value="documents" className="pt-3 text-sm text-muted-foreground">
          12 documents in this workspace.
        </TabsContent>
      </C>
    ),
  },
  Table: {
    frame: { width: 420 },
    render: (C) => (
      <C>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Modified</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Q3 revenue</TableCell>
            <TableCell className="text-muted-foreground">2 days ago</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Roadmap</TableCell>
            <TableCell className="text-muted-foreground">last week</TableCell>
          </TableRow>
        </TableBody>
      </C>
    ),
  },
  Tooltip: {
    render: (C) => (
      <C open>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm">
            Rename
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rename this document</TooltipContent>
      </C>
    ),
  },
  Popover: {
    render: (C) => (
      <C open modal={false}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Filter
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-60 text-sm">Anything can go in a popover.</PopoverContent>
      </C>
    ),
  },
  ContextMenu: {
    render: (C) => (
      <C>
        <ContextMenuTrigger asChild>
          <div className="rounded-md border border-dashed px-6 py-4 text-xs text-muted-foreground">
            right-click area
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Rename</ContextMenuItem>
          <ContextMenuItem>Duplicate</ContextMenuItem>
        </ContextMenuContent>
      </C>
    ),
  },
  RadioGroup: {
    render: (C) => (
      <C defaultValue="newest" className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="newest" /> Newest first
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="oldest" /> Oldest first
        </label>
      </C>
    ),
  },
  Toolbar: {
    render: (C) => (
      <C>
        <ToolbarButton>
          <Pencil />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton>
          <Share2 />
        </ToolbarButton>
      </C>
    ),
  },
  Sidebar: {
    frame: { width: 240, height: 260 },
    render: (C) => (
      <SidebarProvider>
        <C collapsible="none">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <FileText /> Documents
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Share2 /> Shared with me
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </C>
      </SidebarProvider>
    ),
  },
};

export default previews;
