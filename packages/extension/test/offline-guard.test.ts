import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE } from '../../core/src/ocr/engines';

const MODEL_URLS = DEFAULT_ENGINE.baseUrls;
const escape = (u: string) => u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Hard constraint 1: the shipped bundle must make no network requests. One exception, asked
// for by the user (DECISIONS 2026-10-29): the OCR worker may fetch the text recognition
// model, from the engine descriptor's address only, when the user asks for it.
const pkg = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(pkg, '.output/chrome-mv3');

const FORBIDDEN = [/\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/];
// URL literals that are identifiers, not requests: XML namespaces and docs links in
// library error messages.
const URL_ALLOW = [
  /^http:\/\/www\.w3\.org\//,
  // Word (.docx) export: OOXML and Dublin Core namespace names written into the file.
  /^http:\/\/schemas\.openxmlformats\.org\/[\w/.-]+$/,
  /^http:\/\/purl\.org\/dc\/elements\/1\.1\/$/,
  /^https:\/\/react\.dev\/errors\//,
  /^https:\/\/tailwindcss\.com$/,
  // pdf-lib's default "Producer" metadata string; we overwrite it and never request it.
  /^https:\/\/github\.com\/Hopding\/pdf-lib$/,
  // Batch: the scheme put in front of an address the user typed without one (opened as a tab).
  /^https:\/\/\$\{\w+\}$/,
  // The model's address, as data in the engine descriptor (the Studio shows the model's status).
  ...MODEL_URLS.map((u) => new RegExp(`^${escape(u)}$`)),
];
// The OCR worker chunk: fetch() for the model, and onnxruntime's Emscripten loader
// (fetch/XMLHttpRequest) for its own bundled .wasm, plus a link in one of its error
// messages. What keeps this honest is the URL check: the only absolute address the worker
// holds is the model's.
const OCR_WORKER = /[\\/]assets[\\/]ocr-worker-[\w-]+\.js$/;
const OCR_WORKER_URLS = [/^https:\/\/web\.dev\/cross-origin-isolation-guide\/$/];
// pdf.js (opening a PDF, DECISIONS 2026-11-05) can load a document, fonts or wasm from a
// URL, so its code holds fetch and XMLHttpRequest. We only ever pass the file's bytes and
// set no font or wasm URL (checked below), so they never run. Its only URL literals are
// XFA/XMP namespace names and base URLs for parsing links in a document.
const PDFJS = /[\\/](assets[\\/]pdf-worker|chunks[\\/]pdf)-[\w-]+\.js$/;
const PDFJS_URLS = [
  /^http:\/\/www\.xfa\.org\/schema\/[\w/.-]*$/,
  /^http:\/\/ns\.adobe\.com\/(xdp|xdp\/pdf|xfdf|xmpmeta)\/$/,
  /^http:\/\/\$\{e\}$/,
  /^http:\/\/example\.com$/,
  /^https:\/\/foo\.bar$/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('offline guard', () => {
  beforeAll(() => {
    // Vitest sets NODE_ENV=test, which would pull in React's dev build.
    execSync('pnpm exec wxt build', {
      cwd: pkg,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }, 120_000);

  it('bundle contains no network APIs or unexpected URLs', () => {
    const hits: string[] = [];
    for (const file of files(outDir).filter((f) => /\.(js|html|css|json)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      const worker = OCR_WORKER.test(file);
      const pdfjs = PDFJS.test(file);
      for (const re of FORBIDDEN) {
        if (
          (worker || pdfjs) &&
          (re.source === /\bfetch\(/.source || re.source === 'XMLHttpRequest')
        )
          continue;
        if (re.test(text)) hits.push(`${file}: ${re}`);
      }
      for (const m of text.matchAll(/https?:\/\/[^"'`\s)\\]*/g)) {
        const allowed = [
          ...URL_ALLOW,
          ...(worker ? OCR_WORKER_URLS : []),
          ...(pdfjs ? PDFJS_URLS : []),
        ];
        if (!allowed.some((a) => a.test(m[0]))) hits.push(`${file}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the OCR worker exists and fetches only the model addresses', () => {
    const worker = files(outDir).filter((f) => OCR_WORKER.test(f));
    expect(worker).toHaveLength(1);
    const text = readFileSync(worker[0]!, 'utf8');
    const urls = [...text.matchAll(/https?:\/\/[^"'`\s)\\]*/g)].map((m) => m[0]);
    expect(urls.filter((u) => !OCR_WORKER_URLS.some((a) => a.test(u)))).toEqual(MODEL_URLS);
  });

  it('pdf.js is given bytes, never an address to load from', () => {
    const src = readFileSync(join(pkg, 'src/shared/import-pdf.ts'), 'utf8');
    const calls = [...src.matchAll(/getDocument\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(calls).toEqual(['{ data, useSystemFonts: true }']);
    expect(src).not.toMatch(/standardFontDataUrl|cMapUrl|wasmUrl|iccUrl/);
    // The pdf.js files are the only other ones allowed fetch, and they exist.
    expect(files(outDir).filter((f) => PDFJS.test(f))).toHaveLength(2);
  });

  it('manifest requests no broad host permissions', () => {
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.host_permissions ?? []).toEqual([]);
    // All sites only on request, for batch capture.
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.permissions).not.toContain('<all_urls>');
    // Only 'wasm-unsafe-eval' added to the default, for the bundled OCR runtime.
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
  });
});
