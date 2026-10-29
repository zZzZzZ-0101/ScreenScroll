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
  /^https:\/\/react\.dev\/errors\//,
  /^https:\/\/tailwindcss\.com$/,
  // pdf-lib's default "Producer" metadata string; we overwrite it and never request it.
  /^https:\/\/github\.com\/Hopding\/pdf-lib$/,
  // The model's address, as data in the engine descriptor (the Studio shows the model's status).
  ...MODEL_URLS.map((u) => new RegExp(`^${escape(u)}$`)),
];
// The OCR worker chunk: fetch() for the model, and onnxruntime's Emscripten loader
// (fetch/XMLHttpRequest) for its own bundled .wasm, plus a link in one of its error
// messages. What keeps this honest is the URL check: the only absolute address the worker
// holds is the model's.
const OCR_WORKER = /[\\/]assets[\\/]ocr-worker-[\w-]+\.js$/;
const OCR_WORKER_URLS = [/^https:\/\/web\.dev\/cross-origin-isolation-guide\/$/];

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
      for (const re of FORBIDDEN) {
        if (worker && (re.source === /\bfetch\(/.source || re.source === 'XMLHttpRequest'))
          continue;
        if (re.test(text)) hits.push(`${file}: ${re}`);
      }
      for (const m of text.matchAll(/https?:\/\/[^"'`\s)\\]*/g)) {
        const allowed = [...URL_ALLOW, ...(worker ? OCR_WORKER_URLS : [])];
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

  it('manifest requests no broad host permissions', () => {
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.permissions).not.toContain('<all_urls>');
    // Only 'wasm-unsafe-eval' added to the default, for the bundled OCR runtime.
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
  });
});
