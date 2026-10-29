import { useState } from 'react';
import { applySpot, DEFAULT_SPOT, isSpot, SPOT_STORAGE_KEY } from './spot.ts';
import type { Spot } from './spot.ts';

export function useSpot() {
  const [spot, setSpot] = useState<Spot>(() => {
    const current = document.documentElement.dataset.spot;
    return isSpot(current) ? current : DEFAULT_SPOT;
  });
  const [warning, setWarning] = useState('');
  function selectSpot(next: Spot) {
    applySpot(next);
    setSpot(next);
    try {
      localStorage.setItem(SPOT_STORAGE_KEY, next);
      setWarning('');
    } catch {
      setWarning('本次主色已切换，但无法保存偏好；重新打开时使用默认薰衣草或原有偏好。');
    }
  }
  return { spot, selectSpot, warning };
}
