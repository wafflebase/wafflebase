# Share link QR code (#1193)

**Created**: 2026-11-23

## Goal

Hand a share link to somebody in the room: every share link row in
`ShareDialog` gets a QR button beside Copy that opens a QR code for the
exact URL Copy writes to the clipboard, with Download PNG / Download SVG
/ Copy image.

## Constraints

- Client-side generation only; the token never leaves the browser.
- No share-link creation, permission or backend change.
- Small maintained zero-dependency QR library.
- Reusable component, so the template share section can use it later.

## Steps

- [x] Add `uqr` (zero-dep, TS) to `@wafflebase/frontend`.
- [x] `src/components/qr-code.tsx` — `QrCode` (SVG matrix, always dark
      modules on a white quiet zone) + `QrCodeDialog` (URL, download PNG,
      download SVG, copy image, toasts).
- [x] Wire a QR button into each share link row in `share-dialog.tsx`.
- [x] Unit tests: component renders for a URL; the dialog shows the same
      URL as Copy; existing share dialog test still passes.

## Out of scope

- Logo/colour customisation inside the QR.
- Using it from `template-share-section.tsx` (the component is shared so
  it can be, later).
