/**
 * Open a native file picker (multi-select). Resolves to the selected files,
 * or an empty array if the user cancels. Mirrors `pickFile` in
 * `@/app/docs/export-utils` but sets `input.multiple = true` and returns all
 * selected files instead of just the first.
 */
export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.style.display = "none";
    let settled = false;

    input.onchange = () => {
      settled = true;
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    };

    // Detect cancel via window focus (no perfect way, but acceptable). When
    // the timer fires, read `input.files` directly rather than assuming a
    // cancel: the browser populates it synchronously on selection, so if a
    // real pick's `change` event is merely delayed (large multi-select / slow
    // disk) past this window, we still resolve the selected files instead of
    // silently discarding them. `resolve` is idempotent, so a later `change`
    // is harmless.
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        const files = input.files ? Array.from(input.files) : [];
        cleanup();
        resolve(files);
      }, 300);
    };
    window.addEventListener("focus", onFocus);

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
  });
}
