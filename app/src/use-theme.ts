import { useLayoutEffect, useState } from 'react';
import { readTheme, THEME_STORAGE_KEY } from './theme.ts';
import type { Theme } from './theme.ts';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Access to the localStorage property itself can also throw in a restricted WebView.
    try { return readTheme(window.localStorage); }
    catch { return 'light'; }
  });
  const [warning, setWarning] = useState('');
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  function selectTheme(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      setWarning('');
    } catch {
      setWarning('本次主题已切换，但无法保存偏好；重新打开时使用默认浅色或原有偏好。');
    }
  }
  function toggle() { selectTheme(theme === 'dark' ? 'light' : 'dark'); }
  return { theme, toggle, selectTheme, warning };
}
