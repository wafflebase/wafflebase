/**
 * The three `packages/frontend` modules `providers.tsx` mounts, declared here instead of
 * resolved through a `@/*` path mapping.
 *
 * WHY NOT JUST MAP `@/*`. Measured: mapping it makes `tsc` follow `@/app/Layout` into the
 * whole frontend graph — including the sheets / docs / slides / notes engines — and
 * typecheck all of it under THIS package's options. That is 471 errors, none of them real
 * defects: aligning `types: ["vite/client"]` and `verbatimModuleSyntax` brings it to 184,
 * and the remainder is cross-package friction from `@wafflebase/*` resolving to `src`
 * here and to something else in the frontend's own config. Closing the gap would mean
 * maintaining a second copy of the frontend's tsconfig forever.
 *
 * WHAT IS ACTUALLY LOST, said plainly: if one of these three modules changes its props,
 * `providers.tsx` will not fail here — it will fail in the browser. What is NOT lost is
 * the frontend's own checking; `pnpm frontend typecheck` reads these files under the
 * config that owns them, which is the program that should be checking them.
 *
 * The shapes below are transcribed from the real signatures, so a mistake in
 * `providers.tsx` itself — a missing `children`, a wrong `defaultTheme` — is still caught.
 * Vite resolves the real modules at runtime through the `@` alias in `vite.config.ts`.
 */
declare module '@/components/theme-provider' {
  import type { ReactNode } from 'react';
  export function ThemeProvider(props: {
    children: ReactNode;
    defaultTheme?: 'light' | 'dark' | 'system';
    storageKey?: string;
  }): ReactNode;
}

declare module '@/components/ui/tooltip' {
  import type { ReactNode } from 'react';
  export function TooltipProvider(props: {
    children: ReactNode;
    delayDuration?: number;
  }): ReactNode;
  // The rest, loosely — `previews.tsx` only builds an open tooltip around the component
  // it is previewing. See the block at the end of this file.
  export function Tooltip(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
  export function TooltipTrigger(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
  export function TooltipContent(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
}

declare module '@/components/ui/sidebar' {
  import type { ReactNode } from 'react';
  /**
   * Only the provider. A component preview mounts one component alone, so `useSidebar`
   * has no context and `AppSidebar`/`NavUser` throw; this supplies it. The rest of the
   * module's 24 exports are the app's business, not this file's.
   */
  export function SidebarProvider(props: {
    children: ReactNode;
    defaultOpen?: boolean;
  }): ReactNode;
  // Plus the three `previews.tsx` needs to build a sidebar around a menu button.
  export function Sidebar(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
  export function SidebarContent(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
  export function SidebarMenu(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
  export function SidebarMenuItem(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
  export function SidebarMenuButton(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
}

declare module '@/app/Layout' {
  import type { ReactNode } from 'react';
  /** Renders an `<Outlet/>`, which is why the shell is a nested route — see `providers.tsx`. */
  export default function Layout(): ReactNode;
}

/*
 * THE `ui/` MODULES `previews.tsx` COMPOSES, for the same reason and with the same
 * trade-off as the four above: mapping `@/*` costs 471 errors in a program that does not
 * own those files.
 *
 * DELIBERATELY LOOSE. These are only ever used to build a PARENT around the component
 * being previewed — an open menu to hold a menu item, a select to hold an option — so
 * what matters is that the composition is valid React, not that every Radix prop is
 * spelled here. Transcribing forty prop types would be a second copy of the design
 * system's surface, maintained by hand, to catch mistakes the frontend's own typecheck
 * already catches.
 */
declare module '@/components/ui/dropdown-menu' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function DropdownMenu(props: P): ReactNode;
  export function DropdownMenuTrigger(props: P): ReactNode;
  export function DropdownMenuContent(props: P): ReactNode;
  export function DropdownMenuItem(props: P): ReactNode;
  export function DropdownMenuLabel(props: P): ReactNode;
  export function DropdownMenuSeparator(props: P): ReactNode;
  export function DropdownMenuShortcut(props: P): ReactNode;
}

declare module '@/components/ui/select' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Select(props: P): ReactNode;
  export function SelectTrigger(props: P): ReactNode;
  export function SelectContent(props: P): ReactNode;
  export function SelectValue(props: P): ReactNode;
  export function SelectItem(props: P): ReactNode;
}

declare module '@/components/ui/popover' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Popover(props: P): ReactNode;
  export function PopoverTrigger(props: P): ReactNode;
  export function PopoverContent(props: P): ReactNode;
}

declare module '@/components/ui/dialog' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Dialog(props: P): ReactNode;
  export function DialogContent(props: P): ReactNode;
}

declare module '@/components/ui/sheet' {
  import type { ReactNode } from 'react';
  export function Sheet(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
}

declare module '@/components/ui/context-menu' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function ContextMenu(props: P): ReactNode;
  export function ContextMenuTrigger(props: P): ReactNode;
  export function ContextMenuContent(props: P): ReactNode;
  export function ContextMenuItem(props: P): ReactNode;
}

declare module '@/components/ui/tabs' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Tabs(props: P): ReactNode;
  export function TabsList(props: P): ReactNode;
  export function TabsTrigger(props: P): ReactNode;
  export function TabsContent(props: P): ReactNode;
}

declare module '@/components/ui/table' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Table(props: P): ReactNode;
  export function TableHeader(props: P): ReactNode;
  export function TableBody(props: P): ReactNode;
  export function TableRow(props: P): ReactNode;
  export function TableHead(props: P): ReactNode;
  export function TableCell(props: P): ReactNode;
}

declare module '@/components/ui/radio-group' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function RadioGroup(props: P): ReactNode;
  export function RadioGroupItem(props: P): ReactNode;
}

declare module '@/components/ui/button' {
  import type { ReactNode } from 'react';
  export function Button(props: Record<string, unknown> & { children?: ReactNode }): ReactNode;
}

/* The rest of the parts the assembled composite roots need. Same looseness, same reason. */
declare module '@/components/ui/card' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Card(props: P): ReactNode;
  export function CardHeader(props: P): ReactNode;
  export function CardTitle(props: P): ReactNode;
  export function CardDescription(props: P): ReactNode;
  export function CardContent(props: P): ReactNode;
  export function CardFooter(props: P): ReactNode;
}

declare module '@/components/ui/avatar' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Avatar(props: P): ReactNode;
  export function AvatarFallback(props: P): ReactNode;
}

declare module '@/components/ui/toolbar' {
  import type { ReactNode } from 'react';
  type P = Record<string, unknown> & { children?: ReactNode };
  export function Toolbar(props: P): ReactNode;
  export function ToolbarButton(props: P): ReactNode;
  export function ToolbarSeparator(props: P): ReactNode;
}
