/**
 * The shell's entry. Bundled by `vite.shell.config.ts` into `dist/shell/`.
 *
 * This React is OURS — bundled, not the consumer's. §6 settles why: the consumer's
 * Tailwind would restyle the panels that exist to judge their theme, and two
 * Reacts sharing one document is two Reacts. The scene frame is the opposite case
 * and gets the opposite answer; see `src/shell/public/scene.html`.
 *
 * No `StrictMode`. It double-invokes effects in development, and this shell IS
 * development — a doubled `GET /health` is harmless but a doubled staged-edit POST
 * would not be, and the panels landing in 11b are built on those. Better to not
 * establish the pattern.
 */
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './shell.css';

const host = document.getElementById('wb-root');
if (!host) {
  // The document is ours and prebuilt, so this cannot happen from a consumer's
  // mistake — only from an edit to `index.html` that dropped the mount point. Say
  // which file, because a blank shell otherwise reads as a broken install.
  throw new Error('[design-editor] #wb-root missing from the shell document');
}

createRoot(host).render(<App />);
