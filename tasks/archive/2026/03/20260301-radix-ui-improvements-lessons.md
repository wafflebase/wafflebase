# Radix UI Improvements — Lessons

## What went well

- All 5 tasks were independent, enabling clean atomic commits.
- Pre-commit hook (`verify:fast`) caught issues early on each commit.

## Lessons

1. **shadcn/ui templates carry Next.js artifacts**: `"use client"` directives
   have no effect in Vite SPAs. Worth removing when noticed.

2. **TooltipProvider should be global**: Per-instance wrapping in each
   `Tooltip` is the shadcn/ui default but creates redundant providers.
   A single root-level provider is the Radix-recommended pattern.

3. **ARIA role conflicts in menus**: Nesting a `Switch` (role=switch) inside
   a `DropdownMenuItem` (role=menuitem) creates conflicting roles.
   `DropdownMenuCheckboxItem` is the correct Radix primitive for toggleable
   menu items.

4. **Icon-only buttons need explicit labels**: Screen readers cannot derive
   accessible names from SVG icon children alone. `aria-label` is the
   simplest fix for icon-only buttons.
