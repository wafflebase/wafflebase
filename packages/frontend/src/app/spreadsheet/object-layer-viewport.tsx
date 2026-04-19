import type { Spreadsheet } from "@wafflebase/sheets";

export function ObjectLayerViewport({
  spreadsheet,
  zIndex,
  renderVersion,
  children,
}: {
  spreadsheet: Spreadsheet;
  zIndex: number;
  renderVersion: number;
  children: React.ReactNode;
}) {
  const viewport = spreadsheet.getGridViewportRect();
  const scrollableViewport = spreadsheet.getScrollableGridViewportRect();
  const clipLeft = Math.max(0, scrollableViewport.left - viewport.left);
  const clipTop = Math.max(0, scrollableViewport.top - viewport.top);
  const clipWidth = Math.max(0, scrollableViewport.width);
  const clipHeight = Math.max(0, scrollableViewport.height);

  if (clipWidth === 0 || clipHeight === 0) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-none overflow-hidden"
      data-render-version={renderVersion}
      style={{
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        zIndex,
      }}
    >
      <div
        className="absolute pointer-events-none overflow-hidden"
        style={{
          left: clipLeft,
          top: clipTop,
          width: clipWidth,
          height: clipHeight,
        }}
      >
        <div
          className="relative h-full w-full pointer-events-none"
          style={{
            left: -clipLeft,
            top: -clipTop,
            width: viewport.width,
            height: viewport.height,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
