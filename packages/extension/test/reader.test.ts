import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractArticle,
  isSafeUrl,
  sanitizeElement,
  sanitizeSrcset,
} from '../src/content/reader';

const require = createRequire(import.meta.url);
const JSDOMParser = require('../node_modules/@mozilla/readability/JSDOMParser.js') as new () => {
  parse(html: string, url?: string): Document;
};

const fixturesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));

function parseDoc(html: string, url = 'https://example.com/article') {
  let clones = 0;
  const doc = new JSDOMParser().parse(html, url) as Document & {
    cloneNode?: (deep?: boolean) => Document;
  };
  doc.cloneNode = () => {
    clones++;
    return new JSDOMParser().parse(html, url);
  };
  return { doc, cloneCount: () => clones };
}

describe('reader URL & srcset sanitization', () => {
  it('allows safe http(s), relative, hash, mailto, and raster data:image URLs', () => {
    expect(isSafeUrl('https://example.com/post')).toBe(true);
    expect(isSafeUrl('http://example.com/img.png')).toBe(true);
    expect(isSafeUrl('/images/diagram.webp')).toBe(true);
    expect(isSafeUrl('#section-2')).toBe(true);
    expect(isSafeUrl('mailto:reader@example.com')).toBe(true);
    expect(isSafeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('rejects javascript:, vbscript:, data:text/html, and data:image/svg+xml URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('  JaVa\tScRiPt:alert(1)')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
  });

  it('strips unsafe URLs from srcset while preserving safe candidates and data:image URLs', () => {
    expect(
      sanitizeSrcset(
        'https://example.com/a.jpg 1x, javascript:alert(1) 2x, data:text/html,bad 3x, data:image/png;base64,iVBORw0KGgo= 2x, /img/b.png 4x',
      ),
    ).toBe('https://example.com/a.jpg 1x, data:image/png;base64,iVBORw0KGgo= 2x, /img/b.png 4x');
  });
});

describe('reader element sanitization', () => {
  it('strips active tags, inline event handlers, and unsafe URLs', () => {
    const html = `<!doctype html><html><body><div id="root">
      <h2 onclick="evil()">Clean Heading</h2>
      <p onmouseover="evil()">Safe paragraph with
        <a href="javascript:alert(1)" onclick="steal()">bad link</a>
        <a href="data:text/html,<h1>x</h1>">data link</a>
        <a href="https://example.com/ok">good link</a>.
      </p>
      <img src="https://example.com/pic.png" onerror="evil()" alt="Diagram" />
      <img src="javascript:alert(2)" alt="Bad" />
      <script>window.pwned = true;</script>
      <style>body { display: none; }</style>
      <iframe src="https://evil.example/embed" srcdoc="<script>1</script>"></iframe>
      <object data="https://evil.example/a.swf"></object>
      <embed src="https://evil.example/b.swf" />
    </div></body></html>`;
    const doc = new JSDOMParser().parse(html);
    const root = doc.body;
    sanitizeElement(root);
    const out = root.innerHTML;
    expect(out).toContain('Clean Heading');
    expect(out).toContain('https://example.com/ok');
    expect(out).toContain('https://example.com/pic.png');
    expect(out).not.toMatch(/<script\b/i);
    expect(out).not.toMatch(/<style\b/i);
    expect(out).not.toMatch(/<iframe\b/i);
    expect(out).not.toMatch(/<object\b/i);
    expect(out).not.toMatch(/<embed\b/i);
    expect(out).not.toMatch(/\bon(?:click|mouseover|error|load)\s*=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/data:text\/html/i);
  });
});

describe('reader article extraction', () => {
  it('extracts article fixture cleanly via a clone without mutating the source document', () => {
    const html = readFileSync(join(fixturesDir, 'article.html'), 'utf8');
    const { doc, cloneCount } = parseDoc(html);
    const beforeHtml = doc.body.innerHTML;

    const article = extractArticle(doc);
    expect(cloneCount()).toBe(1);
    expect(doc.body.innerHTML).toBe(beforeHtml);
    expect(article).not.toBeNull();
    expect(article!.title.length).toBeGreaterThan(0);
    expect(article!.textLength).toBeGreaterThan(200);
    expect(article!.contentHtml).not.toMatch(/<script\b/i);
  });

  it('sanitizes payloads embedded inside an extracted article', () => {
    const bodyText =
      'ScreenScroll captures long pages cleanly without cutting through lines of text. '.repeat(8);
    const html = `<!doctype html><html><head><title>Reader Security Test</title></head><body>
      <nav><a href="/home">Home</a><a href="/login">Sign in</a></nav>
      <article>
        <h1>Reader Security Test</h1>
        <p onclick="alert(1)">${bodyText}<a href="javascript:alert(2)">click</a> <a href="https://example.com/docs">docs</a></p>
        <p>${bodyText}</p>
        <script>alert('xss')</script>
        <style>.x{color:red}</style>
        <iframe src="https://evil.example"></iframe>
        <object data="bad"></object>
        <embed src="bad">
      </article>
      <aside>Subscribe to our newsletter now</aside>
    </body></html>`;
    const { doc } = parseDoc(html);
    const article = extractArticle(doc);
    expect(article).not.toBeNull();
    expect(article!.title).toBe('Reader Security Test');
    expect(article!.contentHtml).toContain('https://example.com/docs');
    expect(article!.contentHtml).not.toMatch(/<script\b|<style\b|<iframe\b|<object\b|<embed\b/i);
    expect(article!.contentHtml).not.toMatch(/onclick|javascript:/i);
  });

  it('returns null for non-article / tiny pages so capture emits an explicit fallback error', () => {
    const tiny = readFileSync(join(fixturesDir, 'tiny.html'), 'utf8');
    const { doc: tinyDoc } = parseDoc(tiny);
    expect(extractArticle(tinyDoc)).toBeNull();

    const appShell = `<!doctype html><html><head><title>Dashboard</title></head><body>
      <header><button>New</button><button>Filter</button></header>
      <main><div class="toolbar"><span>3 items</span></div></main>
    </body></html>`;
    const { doc: appDoc } = parseDoc(appShell);
    expect(extractArticle(appDoc)).toBeNull();
  });
});
