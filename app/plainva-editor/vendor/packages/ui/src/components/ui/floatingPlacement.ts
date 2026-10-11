export interface FloatingAnchor { left: number; top: number; bottom: number }
export interface FloatingBounds { left: number; top: number; right: number; bottom: number }

export function visibleFloatingBounds(owner: Window, insets: Partial<Record<"left" | "right" | "top" | "bottom", number>> = {}, margin = 8): FloatingBounds {
  const viewport = owner.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  return { left: left + Math.max(margin, insets.left ?? 0), top: top + Math.max(margin, insets.top ?? 0),
    right: left + (viewport?.width ?? owner.innerWidth) - Math.max(margin, insets.right ?? 0),
    bottom: top + (viewport?.height ?? owner.innerHeight) - Math.max(margin, insets.bottom ?? 0) };
}

/** The same placement for element anchors and virtual editor selections. */
export function placeFloatingPanel(anchor: FloatingAnchor, size: { width: number; height: number }, bounds: FloatingBounds, above = false, gap = 4) {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));
  const before = anchor.top - gap - size.height, after = anchor.bottom + gap;
  let top = above ? before : after;
  const alternate = above ? after : before;
  const fits = (value: number) => value >= bounds.top && value + size.height <= bounds.bottom;
  if (!fits(top) && fits(alternate)) top = alternate;
  return { left: clamp(anchor.left, bounds.left, bounds.right - size.width), top: clamp(top, bounds.top, bounds.bottom - size.height) };
}
