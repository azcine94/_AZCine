import type { EditorView } from "@codemirror/view";

/** Half-pixel quantization with a dead band for a repeated measurement. */
export function stableListPrefixWidth(raw: number, previous?: number): number | null {
  if (!Number.isFinite(raw) || raw < 0) return null;
  if (previous !== undefined && Math.abs(raw - previous) <= 0.5) return previous;
  return Math.round(raw * 2) / 2;
}

const FONT_PROPERTIES = ["font-family", "font-size", "font-style", "font-weight", "font-stretch", "font-variant",
  "font-feature-settings", "font-variation-settings", "letter-spacing", "word-spacing", "tab-size", "line-height"];

/** Measures the actual rendered marker/widgets in a separate, unindented box.
 * Cursor coordinates are intentionally not an input: their rounding changes
 * when our hanging indent moves the line (notably in WebKit).
 */
export class ListPrefixMeasurer {
  private readonly host: HTMLDivElement;
  private readonly cache = new Map<string, { width: number; dirty: boolean }>();
  constructor(private readonly view: EditorView, private readonly mode: string) {
    this.host = view.dom.ownerDocument.createElement("div");
    this.host.className = "cm-list-prefix-measure";
    this.host.setAttribute("aria-hidden", "true");
    this.host.inert = true;
    view.dom.appendChild(this.host);
  }
  invalidate() { for (const entry of this.cache.values()) entry.dirty = true; }
  destroy() { this.host.remove(); this.cache.clear(); }

  width(from: number, to: number): number | null {
    if (from === to) return 0;
    const { view, host } = this;
    const start = view.domAtPos(from), end = view.domAtPos(to);
    const parent = start.node.nodeType === 1 ? start.node as Element : start.node.parentElement;
    const line = parent?.closest(".cm-line");
    if (!line || !line.contains(end.node)) return null;
    const range = host.ownerDocument.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    const probe = line.cloneNode(false) as HTMLElement;
    probe.removeAttribute("style");
    probe.appendChild(range.cloneContents());
    const style = getComputedStyle(line);
    const metrics = FONT_PROPERTIES.map(property => {
      const value = style.getPropertyValue(property);
      host.style.setProperty(property, value);
      return value;
    });
    const key = JSON.stringify([this.mode, metrics, probe.outerHTML]);
    const cached = this.cache.get(key);
    // Bound memory to the current viewport's useful prefixes, not note length.
    if (cached && !cached.dirty) { this.cache.delete(key); this.cache.set(key, cached); return cached.width; }
    host.replaceChildren(probe);
    const width = stableListPrefixWidth(probe.getBoundingClientRect().width, cached?.width);
    host.replaceChildren();
    if (width !== null) {
      this.cache.delete(key); this.cache.set(key, { width, dirty: false });
      if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
    }
    return width;
  }
}
