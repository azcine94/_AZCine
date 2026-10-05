import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { readTheme, THEME_STORAGE_KEY } from './theme.ts';
import type { Theme } from './theme.ts';
import { themeOrigin, transitionTheme } from './theme-transition.ts';
import type { ThemeOrigin } from './theme-transition.ts';

export function useTheme(options: { initialTheme?: Theme; persist?: boolean } = {}) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (options.initialTheme) return options.initialTheme;
    // Access to the localStorage property itself can also throw in a restricted WebView.
    try { return readTheme(window.localStorage); }
    catch { return 'light'; }
  });
  const requestedTheme = useRef(theme);
  const [warning, setWarning] = useState('');
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  function selectTheme(next: Theme, origin?: ThemeOrigin, animate = true) {
    if (next === requestedTheme.current) return;
    requestedTheme.current = next;
    transitionTheme(() => {
      document.documentElement.dataset.theme = next;
      setTheme(next);
      if (options.persist === false) return;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
        setWarning('');
      } catch {
        setWarning('本次主题已切换，但无法保存偏好；重新打开时使用默认浅色或原有偏好。');
      }
    }, origin, animate);
  }
  function toggle(event?: MouseEvent<HTMLElement>) { selectTheme(requestedTheme.current === 'dark' ? 'light' : 'dark', themeOrigin(event)); }
  return { theme, toggle, selectTheme, warning };
}
