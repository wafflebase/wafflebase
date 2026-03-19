# UI Design Improvements

## Phase 1: Color Token Consolidation
- [x] Add homepage dark-section tokens to index.css
- [x] Update footer.tsx to use design tokens
- [x] Update developer-section.tsx to use design tokens
- [x] Update opensource-section.tsx to use design tokens
- [x] Verify dark/light mode consistency

## Phase 2: Accessibility
- [x] Fix missing ARIA labels and roles (site-header, footer)
- [x] Fix focus states (outline-none → focus-visible ring)
- [x] Fix AvatarFallback hardcoded "CN" → user initials
- [x] Add hover/focus states to homepage CTA buttons

## Phase 3: Homepage Visual Polish
- [x] Add hover effects to feature cards
- [x] Add hover ring to developer code cards
- [x] Add hover to open-source badges and footer links
- [x] Make hero CTA buttons stack vertically on mobile
- [x] Unify max-width to 960px across sections
- [x] Add spinner to demo loading state

## Phase 4: UX Improvements
- [x] Add delete confirmation dialog for documents
- [x] Add error retry button on documents page
- [x] ~~Loading skeleton~~ (already implemented)
- [x] ~~Truncated text tooltips~~ (deferred — low impact)
