import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
const OMIT = new Set(["script", "style", "head", "title", "template"]);
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "tr", "table", "blockquote", "pre"]);
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", mdash: "—", ndash: "–",
};

/** Decode once: an encoded ampersand must not activate a second entity. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, entity: string) => {
    if (!entity.startsWith("#")) {
      const key = entity.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : raw;
    }
    try {
      return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    } catch { return raw; }
  });
}

function children(node: HtmlNode): HtmlNode[] { return "childNodes" in node ? node.childNodes : []; }
function tag(node: HtmlNode): string { return "tagName" in node ? node.tagName : ""; }
function attribute(node: HtmlElement, name: string): string { return node.attrs.find(attr => attr.name === name)?.value ?? ""; }

/** Plain TEXT, never HTML: callers must keep their normal contextual escaping. */
function textContent(root: HtmlNode): string {
  const parts: string[] = [];
  const stack: Array<{ node: HtmlNode; end?: boolean }> = [{ node: root }];
  while (stack.length) {
    const { node, end } = stack.pop()!;
    const name = tag(node);
    if (end) { parts.push("\n"); continue; }
    if (OMIT.has(name)) continue;
    if (node.nodeName === "#text" && "value" in node) { parts.push(node.value.replace(/\u00a0/g, " ")); continue; }
    if (name === "br") { parts.push("\n"); continue; }
    if (BLOCK.has(name)) { parts.push("\n"); stack.push({ node, end: true }); }
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index--) stack.push({ node: nested[index] });
  }
  return parts.join("");
}

export function htmlToPlainText(html: string): string {
  return textContent(parseFragment(html));
}

function markdownText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
}

/** Attribute values have already been decoded by the HTML parser. */
function destination(raw: string, image: boolean): string | null {
  const value = raw.trim();
  // URL parsers discard tabs/newlines in schemes. Reject controls before
  // deciding whether this is a relative path or an allowed external URL.
  if (!value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme && !(image ? ["http", "https", "blob"].includes(scheme) || /^data:image\//i.test(value) : ["http", "https", "mailto", "tel"].includes(scheme))) return null;
  return value.replace(/[\\()<> "']/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

function render(node: HtmlNode, depth: number): string {
  if (depth > 256) throw new Error("HTML nesting exceeds the import limit");
  const name = tag(node);
  if (OMIT.has(name)) return "";
  if (node.nodeName === "#text" && "value" in node) return markdownText(node.value);
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return "";
  if (name === "br") return "\n";
  const inner = children(node).map(child => render(child, depth + 1)).join("");
  if (!("tagName" in node)) return inner;
  if (name === "img") {
    const src = destination(attribute(node, "src"), true);
    return src ? `![${markdownText(attribute(node, "alt")).trim()}](${src})` : "";
  }
  if (name === "a") {
    const href = destination(attribute(node, "href"), false);
    const label = inner.trim();
    return !href ? label : label && label !== href ? `[${label}](${href})` : href;
  }
  if (name === "strong" || name === "b") return `**${inner.trim()}**`;
  if (name === "em" || name === "i") return `*${inner.trim()}*`;
  if (name === "code") {
    const text = textContent(node).replace(/[\r\n]/g, " ");
    let width = 1;
    for (const run of text.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1);
    const fence = "`".repeat(width), pad = /^[` ]|[` ]$/.test(text) ? " " : "";
    return fence + pad + text + pad + fence;
  }
  if (/^h[1-6]$/.test(name)) return `\n\n${"#".repeat(Number(name[1]))} ${inner.trim()}\n\n`;
  if (name === "en-todo") return (attribute(node, "checked").toLowerCase() === "true" ? "- [x] " : "- [ ] ") + inner;
  if (name === "li") {
    const checked = attribute(node, "style").split(";").map(part => part.split(":").map(value => value.trim().toLowerCase())).find(([key]) => key === "--en-checked")?.[1];
    const marker = checked === "true" ? "- [x] " : checked === "false" ? "- [ ] " : "- ";
    return "\n" + marker + inner.trim();
  }
  return BLOCK.has(name) ? "\n" + inner + "\n" : inner;
}

/**
 * Lossy HTML-to-Markdown conversion for provider descriptions and imports.
 * Parse before extracting content; source regexes are not HTML sanitizers.
 * Existing untouched provider descriptions keep their original write payload.
 */
export function htmlToMarkdown(html: string): string {
  return render(parseFragment(html), 0).split("\n").map(line => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Locate headings structurally; remove only a fully delimited h1 from source. */
export function extractHtmlTitle(content: string, fallback: string): { title: string; body: string } {
  const root = parseFragment(content, { sourceCodeLocationInfo: true });
  const stack: HtmlNode[] = [...children(root)].reverse();
  let firstHeading: HtmlElement | undefined, firstTitle: HtmlElement | undefined;
  while (stack.length) {
    const node = stack.pop()!;
    if ("tagName" in node) {
      if (node.tagName === "h1" && !firstHeading) firstHeading = node;
      if (node.tagName === "title" && !firstTitle) firstTitle = node;
    }
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index]);
  }
  const heading = firstHeading ? children(firstHeading).map(textContent).join("").trim() : "";
  if (heading && firstHeading) {
    const location = firstHeading.sourceCodeLocation;
    return { title: heading, body: location?.endTag ? content.slice(0, location.startOffset) + content.slice(location.endOffset) : content };
  }
  const title = firstTitle ? children(firstTitle).map(textContent).join("").trim() : "";
  return { title: title || fallback, body: content };
}

/** Whether a raw description carries HTML markup or entities. */
export function looksLikeHtml(text: string): boolean {
  // Tag-name candidates cannot consume another opener and repeatedly retry it.
  return /<\/?[a-z][^<>]*>/i.test(text) || /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/.test(text);
}

export function normalizeDescription(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return looksLikeHtml(trimmed) ? htmlToMarkdown(trimmed) || undefined : trimmed;
}
