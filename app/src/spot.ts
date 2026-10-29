/** herdr 风主色（spot）。亮暗各有一组取值，定义在 styles/tokens.css 的 data-spot 选择器里。 */
export const SPOTS = [
  { id: 'lavender', label: '薰衣草', light: '#8839ef', dark: '#cba6f7' },
  { id: 'blue', label: '电蓝', light: '#1e66f5', dark: '#4a9eff' },
  { id: 'peach', label: '蜜桃', light: '#c4520a', dark: '#fab387' },
  { id: 'pink', label: '粉', light: '#c21f7a', dark: '#f5c2e7' },
  { id: 'sky', label: '天青', light: '#0b7fa8', dark: '#89dceb' },
  { id: 'yellow', label: '奶黄', light: '#9a6a08', dark: '#f9e2af' },
  { id: 'coral', label: '珊瑚', light: '#d20f39', dark: '#f38ba8' },
] as const;
export type Spot = typeof SPOTS[number]['id'];
export const DEFAULT_SPOT: Spot = 'lavender';
export const SPOT_STORAGE_KEY = 'azcine.spot';

export function isSpot(value: unknown): value is Spot {
  return SPOTS.some(spot => spot.id === value);
}

export function readSpot(storage: Pick<Storage, 'getItem'>): Spot {
  try {
    const value = storage.getItem(SPOT_STORAGE_KEY);
    if (isSpot(value)) return value;
  } catch { /* No persistence promise when browser storage is unavailable. */ }
  return DEFAULT_SPOT;
}

export function applySpot(spot: Spot, root: HTMLElement = document.documentElement) {
  root.dataset.spot = spot;
}

/** 启动时尽早应用本机偏好，避免先闪默认主色。 */
export function applyStoredSpot() {
  let spot: Spot = DEFAULT_SPOT;
  try { spot = readSpot(window.localStorage); } catch { /* Restricted WebView storage keeps the default. */ }
  applySpot(spot);
  return spot;
}
