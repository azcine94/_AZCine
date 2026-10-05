import { flushSync } from 'react-dom';
import type { MouseEvent } from 'react';

export interface ThemeOrigin { x: number; y: number }

export function themeOrigin(event?: MouseEvent<HTMLElement>): ThemeOrigin {
  if (event && event.detail > 0) return { x: event.clientX, y: event.clientY };
  const target = event?.currentTarget ?? document.activeElement;
  if (target instanceof HTMLElement && target.matches('button,[role="button"]')) {
    const bounds = target.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

let active: ViewTransition | undefined;
let sequence = 0;

/** Shared circular reveal for production and fixture previews; no root remount. */
export function transitionTheme(update: () => void, origin = themeOrigin(), animate = true) {
  const request = ++sequence;
  active?.skipTransition();
  active = undefined;
  const root = document.documentElement;
  const cleanup = () => {
    if (request !== sequence) return;
    active = undefined;
    delete root.dataset.themeTransition;
    root.style.removeProperty('--theme-reveal-x');
    root.style.removeProperty('--theme-reveal-y');
  };
  if (!animate || typeof document.startViewTransition !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cleanup();
    update();
    return;
  }

  root.style.setProperty('--theme-reveal-x', `${origin.x}px`);
  root.style.setProperty('--theme-reveal-y', `${origin.y}px`);
  root.dataset.themeTransition = 'active';
  try {
    const transition = document.startViewTransition(() => {
      if (request === sequence) flushSync(update);
    });
    active = transition;
    // Skipping an older reveal rejects ready; it must not produce an unhandled rejection.
    void transition.ready.catch(() => {});
    void transition.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    update();
  }
}
