# Lessons: Fix MobileEditPanel Keyboard Occlusion

## Key Insights

- iOS Safari does not shrink the layout viewport when the soft keyboard
  opens, so `position: fixed; bottom: 0` stays behind the keyboard.
- The `visualViewport` API reports the actual visible area; computing
  `window.innerHeight - visualViewport.height` gives the keyboard height.
- Must listen to both `resize` and `scroll` events on `visualViewport`
  since iOS Safari fires `scroll` during keyboard slide-in animations.
- `viewport-fit=cover` is required to enable `env(safe-area-inset-*)`
  CSS values for notch/home-indicator devices.
