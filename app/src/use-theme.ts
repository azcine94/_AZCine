import { useLayoutEffect, useState } from 'react';
import { readTheme, THEME_STORAGE_KEY } from './theme.ts';
import type { Theme } from './theme.ts';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
    // Access to the localStorage property itself can also throw in a restricted WebView.
    try { return readTheme(window.localStorage, systemDark); }
    catch { return systemDark ? 'dark' : 'light'; }
  });
  const [warning, setWarning] = useState('');
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      setWarning('');
    } catch {
      setWarning('本次主题已切换，但无法保存偏好；重新打开时可能跟随系统。');
    }
  }
  return { theme, toggle, warning };
}
