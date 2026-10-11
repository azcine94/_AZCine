import type { ReaderSource } from "@plainva/core";
import type { HastNode } from "./readerAnchors";

/** Stable original source addresses, independent of the displayed Markdown. */
export function rehypeReaderSource(source: ReaderSource, original: string) {
  const lines = [0];
  for (let i = 0; i < original.length; i++) if (original[i] === "\n") lines.push(i + 1);
  return () => (root: HastNode) => {
    const walk = (node: HastNode, inCode = false) => {
      const start = node.position?.start?.offset, end = node.position?.end?.offset;
      if (node.type === "element" && start !== undefined && end !== undefined) {
        const from = source.toOriginal(start), to = source.toOriginal(end, "end");
        let lo = 0, hi = lines.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid] <= from) lo = mid + 1; else hi = mid; }
        const props = node.properties ??= {};
        props.dataSourceFrom = from;
        props.dataSourceTo = to;
        props.dataSourceLine = lo;
      }
      for (const child of node.children ?? []) walk(child, inCode || node.tagName === "code");
      if (!inCode && node.tagName !== "code" && node.children) node.children = node.children.map((child) => {
        const a = child.position?.start?.offset, b = child.position?.end?.offset;
        if (child.type !== "text" || !child.value || a === undefined || b === undefined || b - a !== child.value.length) return child;
        const changes: [number, number][] = [[0, source.toOriginal(a)]];
        for (let i = 1; i <= child.value.length; i++) {
          const raw = source.toOriginal(a + i, i === child.value.length ? "end" : "start");
          const last = changes[changes.length - 1];
          if (raw !== last[1] + i - last[0]) changes.push([i, raw]);
        }
        return { type: "element", tagName: "span", properties: { dataReaderText: "", dataSourceFrom: changes[0][1], dataSourceTo: source.toOriginal(b, "end"), dataSourceOffsets: JSON.stringify(changes) }, children: [child] };
      });
    };
    walk(root);
  };
}
