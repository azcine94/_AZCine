// Evaluated inside an already loaded page. Alpha-composites ancestors before WCAG ratios.
(() => {
  const rgb = value => { const values = (value.match(/[\d.]+/g) || []).map(Number); return values.length > 2 ? [values[0], values[1], values[2], values[3] ?? 1] : [0, 0, 0, 0]; };
  const mix = (front, back) => [...front.slice(0, 3).map((v, index) => v * front[3] + back[index] * (1 - front[3])), 1];
  const background = element => element ? mix(rgb(getComputedStyle(element).backgroundColor), background(element.parentElement)) : [255, 255, 255, 1];
  const luminance = color => color.slice(0, 3).map(value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const low = [], overlap = [];
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    // Closed <details> descendants may retain layout rectangles in Chromium but
    // are not painted. checkVisibility also accounts for those hidden subtrees.
    if (!rect.width || !rect.height || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) || style.visibility === 'hidden' || style.display === 'none' || element.disabled) continue;
    // aria-hidden marks decorative content; its visible functional label is checked separately.
    if (element.closest('[aria-hidden="true"]')) continue;
    if ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) {
      const bg = background(element);
      const contrast = ratio(mix(rgb(style.color), bg), bg);
      if (contrast < 4.5) low.push({ tag: element.tagName, text: element.textContent.slice(0, 40), contrast });
    }
  }
  const cards = [...document.querySelectorAll('.today-card')];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i].getBoundingClientRect(), b = cards[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap.push([i, j]);
  }
  return { low, overlap };
})();
