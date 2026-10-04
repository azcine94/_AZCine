export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'azcine.theme';

export function readTheme(storage: Pick<Storage, 'getItem'>, _systemDark = false): Theme {
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    if (value === 'dark' || value === 'light') return value;
  } catch { /* No persistence promise when browser storage is unavailable. */ }
  return 'light';
}
