/**
 * `TextRange` represents a range of text in contenteditable element containing styles.
 *
 * For example, consider the following contenteditable element:
 * `sum(1,2)` where `1` and `2` are styled with blue color.
 * `=sum(<span style="color: blue;">1</span>,<span style="color: blue;">2</span>)`
 * In the above example, if the range is (5, 6), then the selected text is `1`.
 */
export type TextRange = {
  start: number;
  end: number;
};

/**
 * `toTextRange` converts the current selection to a `TextRange` object.
 */
export function toTextRange(container: HTMLDivElement): TextRange | undefined {
  const selection = window.getSelection()!;

  if (selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) {
    return;
  }

  let offset = 0;
  let start = 0;
  let end = 0;

  // traverse the container to find the start and end offsets.
  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent!;

      if (node === range.startContainer) {
        start = offset + range.startOffset;
      }

      if (node === range.endContainer) {
        end = offset + range.endOffset;
      }

      offset += text.length;
    }

    for (const child of node.childNodes) {
      traverse(child);
    }
  }

  traverse(container);

  return { start, end };
}

/**
 * `setTextRange` sets the current selection to the given `TextRange`.
 */
export function setTextRange(
  container: HTMLDivElement,
  textRange: TextRange,
): void {
  // traverse the container to find the start and end nodes.
  let offset = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  const range = document.createRange();
  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent!;

      if (startNode === null && offset + text.length >= textRange.start) {
        startNode = node;
        range.setStart(node, textRange.start - offset);
      }

      if (endNode === null && offset + text.length >= textRange.end) {
        endNode = node;
        range.setEnd(node, textRange.end - offset);
      }

      offset += text.length;
    }

    for (const child of node.childNodes) {
      traverse(child);
    }
  }
  traverse(container);

  const selection = window.getSelection()!;

  selection.removeAllRanges();
  selection.addRange(range);
  container.focus();
}
