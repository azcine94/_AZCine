import { useLayoutEffect, useRef } from 'react';

// A native top-layer popover stays in the React/DOM subtree for focus and blur
// handling, but cannot be clipped by a horizontally scrolling table.
export function useAnchoredPopover(open: boolean, dismiss: () => void, width: number, align: 'start' | 'end' = 'start', maximumHeight = 320) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(dismiss);
  useLayoutEffect(() => { dismissRef.current = dismiss; });
  useLayoutEffect(() => {
    const trigger = triggerRef.current, panel = panelRef.current;
    if (!open || !trigger || !panel) return;
    const view = trigger.ownerDocument.defaultView;
    if (!view) return;
    panel.showPopover();
    function position() {
      if (!trigger || !panel || !view) return;
      const anchor = trigger.getBoundingClientRect();
      const regions = [trigger.closest('.list-scroll'), trigger.closest('.project-document-scroll'), trigger.closest('.project-checklists-scroll'), trigger.closest('.workspace-scroll')].filter((region): region is Element => region !== null);
      const clipped = regions.some(region => {
        const bounds = region.getBoundingClientRect();
        return anchor.right <= bounds.left || anchor.left >= bounds.right || anchor.bottom <= bounds.top || anchor.top >= bounds.bottom;
      });
      const gutter = 8, gap = 4;
      if (anchor.bottom <= 0 || anchor.top >= view.innerHeight || anchor.right <= 0 || anchor.left >= view.innerWidth || clipped) {
        dismissRef.current(); return;
      }
      const panelWidth = Math.min(Math.max(width, anchor.width), view.innerWidth - gutter * 2);
      panel.style.width = `${panelWidth}px`;
      const above = Math.max(0, anchor.top - gap - gutter), below = Math.max(0, view.innerHeight - anchor.bottom - gap - gutter);
      const naturalHeight = Math.min(panel.scrollHeight, maximumHeight);
      const useAbove = below < naturalHeight && above > below;
      panel.style.maxHeight = `${Math.min(maximumHeight, useAbove ? above : below)}px`;
      const height = panel.getBoundingClientRect().height;
      panel.style.left = `${Math.max(gutter, Math.min(align === 'end' ? anchor.right - panelWidth : anchor.left, view.innerWidth - panelWidth - gutter))}px`;
      panel.style.top = `${Math.max(gutter, useAbove ? anchor.top - gap - height : anchor.bottom + gap)}px`;
    }
    position();
    // Capture includes nested table scrolling; resize includes window/DPI changes.
    view.addEventListener('scroll', position, true);
    view.addEventListener('resize', position);
    const observer = new ResizeObserver(position);
    observer.observe(trigger); observer.observe(panel);
    return () => {
      observer.disconnect();
      view.removeEventListener('scroll', position, true); view.removeEventListener('resize', position);
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
  }, [open, width, align, maximumHeight]);
  return { triggerRef, panelRef };
}
