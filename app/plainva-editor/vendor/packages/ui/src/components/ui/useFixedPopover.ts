import { useLayoutEffect, useRef, type RefObject } from "react";
import { placeFloatingPanel, visibleFloatingBounds } from "./floatingPlacement";

/**
 * Viewport-clamped popover placement (plan Designsprache P12). The old
 * `.pv-popover` sat position:absolute inside its row — at the window edge
 * (right sidebar!) it overflowed and was clipped. This hook positions the
 * panel FIXED below/above the anchor, clamped to the viewport. Positioning is
 * written imperatively in a layout effect (no state round-trip, and the
 * react-hooks compiler rules forbid reading a ref-carrying hook result during
 * render); the panel starts hidden off-screen via `.pv-popover--fixed`.
 *
 * Usage: const popRef = useFixedPopover(open, anchorRef);
 *        {open && <div ref={popRef} className="pv-popover pv-popover--fixed">…</div>}
 *
 * Pass `undefined` as anchorRef to disable (legacy absolutely-positioned
 * call sites keep their own skin and skip the `--fixed` class).
 */
export function useFixedPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  opts: { minWidth?: number; margin?: number } = {}
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const { minWidth = 0, margin = 8 } = opts;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !anchorRef || !el) return;
    const measure = () => {
      const panel = ref.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor) return;
      const a = anchor.getBoundingClientRect();
      const bounds = visibleFloatingBounds(window, {}, margin);
      const available = Math.max(0, bounds.right - bounds.left);
      panel.style.minWidth = `${Math.min(available, Math.max(minWidth, a.width))}px`;
      panel.style.maxWidth = `${available}px`;
      panel.style.maxHeight = `${Math.max(0, bounds.bottom - bounds.top)}px`;
      const { left, top } = placeFloatingPanel(a, { width: panel.offsetWidth, height: panel.offsetHeight }, bounds);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    const viewport = window.visualViewport;
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      observer?.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      // Back to the hidden off-screen base state so a re-open re-measures.
      el.style.left = "";
      el.style.top = "";
      el.style.minWidth = "";
      el.style.maxWidth = "";
      el.style.maxHeight = "";
      el.style.visibility = "";
    };
  }, [open, anchorRef, minWidth, margin]);

  return ref;
}
