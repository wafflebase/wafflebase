# Radix UI Improvements — Todo

## Goal

Fix accessibility gaps, remove unused dependencies, and clean up Radix UI
wrapper patterns in the frontend package.

## Tasks

- [x] Remove unused packages (`@radix-ui/react-toggle-group`, `vaul`)
- [x] Add global `TooltipProvider` and remove per-instance wrapping
- [x] Add `aria-label` to icon-only toolbar buttons
- [x] Replace `Switch` with `DropdownMenuCheckboxItem` in nav-user
- [x] Remove `"use client"` directives from 8 UI wrapper files

## Verification

- [x] `pnpm frontend build` passes
- [x] `pnpm verify:fast` passes (977 tests, 0 failures)
