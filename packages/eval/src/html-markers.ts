// A start-tag tokenizer, not a regex: a regex counts markers inside script strings, escaped text, and
// inert template content that the render page's DOM never turns into elements (docs/reference/spec.md 9.5).

// Elements whose content the render page does not parse into `[data-variant]` elements: raw text,
// RCDATA, scripting-enabled `noscript`, and inert `template` content.
const RAW_TEXT_ELEMENTS = new Set([
  "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "template", "plaintext",
]);
const MARKER_ATTR = "data-variant";
const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return codePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return codePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function codePoint(value: number): string {
  return Number.isNaN(value) || value < 0 || value > 0x10ffff ? "" : String.fromCodePoint(value);
}

const NAME_START = /[a-zA-Z]/;
const WHITESPACE = /\s/;

interface Scan { html: string; at: number }

function skipRawText(scan: Scan, name: string): void {
  if (name === "plaintext") { scan.at = scan.html.length; return; }
  const end = new RegExp(`</${name}[\\s/>]`, "i");
  const rest = scan.html.slice(scan.at);
  const found = rest.search(end);
  scan.at = found < 0 ? scan.html.length : scan.at + found;
}

// Honors quotes so a `>` inside a value cannot end the tag.
function readAttrValue(scan: Scan): string {
  const quote = scan.html[scan.at];
  if (quote === '"' || quote === "'") {
    const close = scan.html.indexOf(quote, scan.at + 1);
    const end = close < 0 ? scan.html.length : close;
    const value = scan.html.slice(scan.at + 1, end);
    scan.at = close < 0 ? scan.html.length : close + 1;
    return decodeEntities(value);
  }
  let end = scan.at;
  while (end < scan.html.length && !WHITESPACE.test(scan.html[end] as string) && scan.html[end] !== ">") end += 1;
  const value = scan.html.slice(scan.at, end);
  scan.at = end;
  return decodeEntities(value);
}

// A duplicate `data-variant` attribute keeps the first value.
function readStartTagMarker(scan: Scan): string | null {
  let marker: string | null = null;
  while (scan.at < scan.html.length) {
    const char = scan.html[scan.at] as string;
    if (char === ">") { scan.at += 1; break; }
    if (char === "/") { scan.at += 1; continue; }
    if (WHITESPACE.test(char)) { scan.at += 1; continue; }
    let end = scan.at;
    while (end < scan.html.length && !/[\s/>=]/.test(scan.html[end] as string)) end += 1;
    const name = scan.html.slice(scan.at, end).toLowerCase();
    scan.at = end;
    while (scan.at < scan.html.length && WHITESPACE.test(scan.html[scan.at] as string)) scan.at += 1;
    let value: string | null = null;
    if (scan.html[scan.at] === "=") {
      scan.at += 1;
      while (scan.at < scan.html.length && WHITESPACE.test(scan.html[scan.at] as string)) scan.at += 1;
      value = readAttrValue(scan);
    }
    if (name === MARKER_ATTR && marker === null && value !== null) marker = value;
  }
  return marker;
}

/** `data-variant` values of the start tags an HTML parser turns into elements, in document order. */
export function variantMarkers(html: string): string[] {
  const scan: Scan = { html, at: 0 };
  const markers: string[] = [];
  while (scan.at < html.length) {
    const lt = html.indexOf("<", scan.at);
    if (lt < 0) break;
    scan.at = lt + 1;
    const next = html[scan.at];
    if (next === "!") {
      const isComment = html.startsWith("!--", scan.at);
      const close = isComment ? html.indexOf("-->", scan.at) : html.indexOf(">", scan.at);
      scan.at = close < 0 ? html.length : close + (isComment ? "-->".length : ">".length);
      continue;
    }
    if (next === "/") {
      const close = html.indexOf(">", scan.at);
      scan.at = close < 0 ? html.length : close + 1;
      continue;
    }
    if (next === undefined || !NAME_START.test(next)) continue; // A bare `<` in text is not a tag start.
    let end = scan.at;
    while (end < html.length && !/[\s/>]/.test(html[end] as string)) end += 1;
    const tagName = html.slice(scan.at, end).toLowerCase();
    const tagStart = scan.at - 1;
    scan.at = end;
    const marker = readStartTagMarker(scan);
    if (marker !== null) markers.push(marker);
    const selfClosed = html[scan.at - 2] === "/";
    if (RAW_TEXT_ELEMENTS.has(tagName) && !selfClosed && scan.at > tagStart) skipRawText(scan, tagName);
  }
  return markers;
}
