/**
 * Clean (reader) capture (CAPTURE §12, ROADMAP M6): clones the page DOM so the live page is
 * never mutated during parsing, extracts the article with `@mozilla/readability`, strips active
 * or unsafe markup, and mounts a reversible ~720 px print-styled layout through `MutationLog`.
 * Because the clean container stays on the page's own origin, relative and authenticated images
 * keep loading without any network request from the extension, and finishing/cancelling/errors
 * restore the original page cleanly.
 */
import { Readability } from '@mozilla/readability';
import type { MutationLog } from '@screenscroll/core';

export interface ReaderArticle {
  title: string;
  byline: string | null;
  siteName: string | null;
  dir: string | null;
  contentNode: Element;
  contentHtml: string;
  textLength: number;
}

export const READER_MIN_TEXT_LENGTH = 80;

const FORBIDDEN_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'APPLET',
  'BASE',
  'LINK',
  'META',
  'NOSCRIPT',
]);

const URL_ATTRS = new Set(['href', 'src', 'action', 'poster', 'xlink:href']);

/** Rejects executable schemes (`javascript:`, `vbscript:`, `data:text/html`, `data:image/svg+xml`). */
export function isSafeUrl(raw: string): boolean {
  let normalized = '';
  for (const ch of raw) {
    if (ch.charCodeAt(0) > 0x20) normalized += ch;
  }
  normalized = normalized.toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return false;
  if (normalized.startsWith('data:')) {
    return /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp)(?:;|,)/.test(normalized);
  }
  return true;
}

/** Drops unsafe candidate URLs from an `srcset` attribute value, handling commas inside `data:` URLs. */
export function sanitizeSrcset(raw: string): string {
  const out: string[] = [];
  let i = 0;
  const len = raw.length;
  while (i < len) {
    while (i < len && (raw[i] === ',' || /\s/.test(raw[i]!))) i++;
    if (i >= len) break;
    const urlStart = i;
    const isData = raw.slice(i, i + 5).toLowerCase() === 'data:';
    while (i < len && !/\s/.test(raw[i]!) && (isData || raw[i] !== ',')) i++;
    const url = raw.slice(urlStart, i);
    const descStart = i;
    while (i < len && raw[i] !== ',') i++;
    const desc = raw.slice(descStart, i).trim();
    if (url && isSafeUrl(url)) {
      out.push(desc ? `${url} ${desc}` : url);
    }
    if (i < len && raw[i] === ',') i++;
  }
  return out.join(', ');
}

/**
 * Strips scripts, stylesheets, frames, embedded objects, inline `on*` handlers, and unsafe URLs
 * from a parsed DOM subtree in place.
 */
export function sanitizeElement(root: Element): void {
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const tag = el.tagName?.toUpperCase() ?? '';
    if (el !== root && FORBIDDEN_TAGS.has(tag)) {
      el.parentNode?.removeChild(el);
      continue;
    }
    const attrs = el.attributes ? Array.from(el.attributes) : [];
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(name)) {
        if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'srcset') {
        const clean = sanitizeSrcset(attr.value);
        if (clean) el.setAttribute(attr.name, clean);
        else el.removeAttribute(attr.name);
      }
    }
    const children = el.children ? Array.from(el.children) : [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
}

/**
 * Clones `doc`, runs Readability on the clone (never mutating `doc`), sanitizes the extracted
 * subtree, and returns `null` if the page does not look like an article.
 */
export function extractArticle(doc: Document): ReaderArticle | null {
  const cloned = doc.cloneNode(true) as Document;
  if (typeof cloned.querySelectorAll === 'function') {
    for (const el of Array.from(cloned.querySelectorAll('[data-screenscroll]'))) {
      el.parentNode?.removeChild(el);
    }
  }
  const parsed = new Readability<Element>(cloned, {
    serializer: (node) => node as Element,
  }).parse();
  if (!parsed || !parsed.content) return null;
  sanitizeElement(parsed.content);
  const textLength = (parsed.content.textContent ?? '').replace(/\s+/g, ' ').trim().length;
  if (textLength < READER_MIN_TEXT_LENGTH) return null;
  const title = (parsed.title ?? doc.title ?? '').trim();
  const byline = parsed.byline?.trim() || null;
  const siteName = parsed.siteName?.trim() || null;
  const dir = parsed.dir?.trim() || null;
  return {
    title,
    byline,
    siteName,
    dir,
    contentNode: parsed.content,
    contentHtml: parsed.content.innerHTML ?? '',
    textLength,
  };
}

const READER_CSS = `
[data-screenscroll="reader"] {
  all: revert;
  box-sizing: border-box;
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 56px;
  background: #ffffff;
  color: #18181b;
  font: 17px/1.68 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  overflow-wrap: break-word;
}
[data-screenscroll="reader"] *, [data-screenscroll="reader"] *::before, [data-screenscroll="reader"] *::after {
  box-sizing: border-box;
}
[data-screenscroll="reader"] .sp-reader-header {
  border-bottom: 1px solid #e4e4e7;
  margin-bottom: 24px;
  padding-bottom: 16px;
}
[data-screenscroll="reader"] .sp-reader-title {
  margin: 0 0 8px;
  font-size: 30px;
  line-height: 1.25;
  font-weight: 700;
  color: #09090b;
}
[data-screenscroll="reader"] .sp-reader-meta {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #52525b;
  word-break: break-word;
}
[data-screenscroll="reader"] h1,
[data-screenscroll="reader"] h2,
[data-screenscroll="reader"] h3,
[data-screenscroll="reader"] h4 {
  color: #09090b;
  line-height: 1.3;
  margin: 1.5em 0 0.5em;
}
[data-screenscroll="reader"] h1 { font-size: 26px; }
[data-screenscroll="reader"] h2 { font-size: 22px; }
[data-screenscroll="reader"] h3 { font-size: 19px; }
[data-screenscroll="reader"] p { margin: 0 0 1em; }
[data-screenscroll="reader"] a { color: #0e7c7b; text-decoration: underline; }
[data-screenscroll="reader"] img,
[data-screenscroll="reader"] picture,
[data-screenscroll="reader"] svg,
[data-screenscroll="reader"] figure {
  max-width: 100%;
  height: auto;
}
[data-screenscroll="reader"] img {
  display: block;
  margin: 1.25em auto;
}
[data-screenscroll="reader"] figure {
  margin: 1.25em 0;
}
[data-screenscroll="reader"] figcaption {
  font-size: 14px;
  color: #52525b;
  margin-top: 6px;
}
[data-screenscroll="reader"] blockquote {
  margin: 1.2em 0;
  padding: 4px 0 4px 16px;
  border-left: 3px solid #d4d4d8;
  color: #3f3f46;
}
[data-screenscroll="reader"] pre {
  margin: 1.2em 0;
  padding: 12px 14px;
  background: #f4f4f5;
  border-radius: 6px;
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
[data-screenscroll="reader"] code {
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #f4f4f5;
  padding: 1px 4px;
  border-radius: 3px;
}
[data-screenscroll="reader"] pre code {
  background: transparent;
  padding: 0;
}
[data-screenscroll="reader"] table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.25em 0;
  font-size: 15px;
}
[data-screenscroll="reader"] th,
[data-screenscroll="reader"] td {
  border: 1px solid #d4d4d8;
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
[data-screenscroll="reader"] th {
  background: #f4f4f5;
  font-weight: 600;
}
[data-screenscroll="reader"] ul,
[data-screenscroll="reader"] ol {
  margin: 0 0 1em;
  padding-left: 1.5em;
}
[data-screenscroll="reader"] li { margin-bottom: 0.35em; }
[data-screenscroll="reader"] hr {
  border: 0;
  border-top: 1px solid #e4e4e7;
  margin: 1.75em 0;
}
@media print {
  [data-screenscroll="reader"] { padding: 0; max-width: none; }
}
`;

/**
 * Mounts the extracted article into a clean ~720 px print-styled container inside `document.body`,
 * hiding the original page children via `MutationLog` so every change restores cleanly on finish,
 * cancel, error, or `pagehide`.
 */
export function mountReaderView(
  log: MutationLog,
  article: ReaderArticle,
  pageUrl: string,
): HTMLElement {
  for (const child of Array.from(document.body.children)) {
    if (child.getAttribute('data-screenscroll')) continue;
    if (child instanceof HTMLElement || child instanceof SVGElement) {
      log.setStyle(child, 'display', 'none');
    }
  }

  log.setStyle(document.documentElement, 'background', '#ffffff');
  log.setStyle(document.documentElement, 'overflow-x', 'visible');
  log.setStyle(document.documentElement, 'overflow-y', 'auto');
  log.setStyle(document.documentElement, 'height', 'auto');
  log.setStyle(document.documentElement, 'max-height', 'none');
  log.setStyle(document.documentElement, 'margin', '0');
  log.setStyle(document.documentElement, 'padding', '0');

  log.setStyle(document.body, 'display', 'block');
  log.setStyle(document.body, 'background', '#ffffff');
  log.setStyle(document.body, 'color', '#18181b');
  log.setStyle(document.body, 'margin', '0');
  log.setStyle(document.body, 'padding', '0');
  log.setStyle(document.body, 'overflow', 'visible');
  log.setStyle(document.body, 'height', 'auto');
  log.setStyle(document.body, 'max-height', 'none');
  log.setStyle(document.body, 'width', 'auto');
  log.setStyle(document.body, 'max-width', 'none');

  const style = document.createElement('style');
  style.dataset.screenscroll = 'reader-style';
  style.textContent = READER_CSS;
  document.documentElement.append(style);
  log.record(() => style.remove());

  const container = document.createElement('article');
  container.dataset.screenscroll = 'reader';
  if (article.dir) container.dir = article.dir;

  const header = document.createElement('header');
  header.className = 'sp-reader-header';
  if (article.title) {
    const h1 = document.createElement('h1');
    h1.className = 'sp-reader-title';
    h1.textContent = article.title;
    header.append(h1);
  }
  const metaParts = [article.byline, article.siteName, pageUrl].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
  if (metaParts.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'sp-reader-meta';
    meta.textContent = metaParts.join(' · ');
    header.append(meta);
  }
  if (header.childNodes.length > 0) container.append(header);

  const body = document.createElement('div');
  body.className = 'sp-reader-body';
  body.append(document.importNode(article.contentNode, true));
  container.append(body);

  document.body.append(container);
  log.record(() => container.remove());
  window.scrollTo(0, 0);
  return container;
}
