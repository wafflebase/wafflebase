let current: HTMLDivElement | null = null;

export function showAdjustmentTooltip(
  overlay: HTMLDivElement,
  worldX: number,
  worldY: number,
  scale: number,
  text: string,
): void {
  if (!current) {
    current = document.createElement('div');
    current.className = 'wfb-slides-adjust-tooltip';
    current.style.position = 'absolute';
    current.style.padding = '2px 6px';
    current.style.background = 'rgba(0,0,0,0.75)';
    current.style.color = '#fff';
    current.style.fontSize = '11px';
    current.style.borderRadius = '3px';
    current.style.pointerEvents = 'none';
    current.style.whiteSpace = 'nowrap';
  }
  if (!current.isConnected) {
    overlay.appendChild(current);
  }
  current.textContent = text;
  // 12px upper-right offset, post-scale
  current.style.left = `${worldX * scale + 12}px`;
  current.style.top = `${worldY * scale - 20}px`;
}

export function hideAdjustmentTooltip(): void {
  if (current) {
    current.remove();
    current = null;
  }
}
