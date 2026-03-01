# Frontend UI Polish — Todo

## Goal

Improve visual consistency and completeness of frontend pages (login +
internal pages). Excludes the spreadsheet editor view.

## Design Decisions

### 1. Page Layout Unification

Standardize padding and max-width across all pages:

- All pages: `p-4 lg:p-6` padding
- Form/settings pages: add `max-w-2xl` (left-aligned, not centered)
- Table pages (Documents, Data Sources): no width restriction

### 2. Hardcoded Color Removal

Replace raw Tailwind gray/red colors with theme tokens:

- `text-gray-500` → `text-muted-foreground`
- `text-gray-400` → `text-muted-foreground`
- `text-red-500` → `text-destructive`
- `text-red-600` → `text-destructive`
- `border-red-300` → `border-destructive/30`

### 3. Loading/Error State Improvement

Replace plain text loading indicators with Skeleton components:

- Table pages: table-shaped skeleton (header + rows)
- Settings pages: text block skeleton
- Error states: use `text-muted-foreground` + retry guidance

### 4. Empty State Enhancement

Replace bare "No results." with contextual empty states:

- Icon + description + CTA button inside the empty table row
- Documents: file icon + "No documents yet" + New Document button
- Data Sources: database icon + "No data sources yet" + New Data Source button

### 5. Login Page Fix

- Fix incomplete description: "Wafflebase with your GitHub account."
  → "Sign in with your GitHub account to get started."

### 6. Settings Page Structure

- Add "Appearance" section heading
- Match `section > h2 + content` pattern from Workspace Settings

## Tasks

- [ ] 1. Unify page layout padding/width across all pages
- [ ] 2. Replace hardcoded colors with theme tokens
- [ ] 3. Improve loading states with Skeleton components
- [ ] 4. Improve error states with theme colors
- [ ] 5. Add contextual empty states with icons and CTA
- [ ] 6. Fix login page description text
- [ ] 7. Restructure Settings page with section headings
- [ ] 8. Run `pnpm verify:fast` to confirm no regressions
