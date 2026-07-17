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

    // Detect cancel via window focus (no perfect way, but acceptable).
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve([]);
        }
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
