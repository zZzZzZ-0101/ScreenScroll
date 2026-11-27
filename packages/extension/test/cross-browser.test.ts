import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENGINE } from '../../core/src/ocr/engines';
import {
  actionApi,
  ensureDebuggerPermission,
  hasDebugger,
  isFileAccessAllowed,
  isFirefox,
  shortcutsPageUrl,
} from '../src/shared/capabilities';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const firefoxOut = join(pkg, '.output/firefox-mv3');
const firefoxManifestPath = join(firefoxOut, 'manifest.json');

const MODEL_URLS = DEFAULT_ENGINE.baseUrls;
const escape = (u: string) => u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const FORBIDDEN = [/\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/];
const URL_ALLOW = [
  /^http:\/\/www\.w3\.org\//,
  /^http:\/\/schemas\.openxmlformats\.org\/[\w/.-]+$/,
  /^http:\/\/purl\.org\/dc\/elements\/1\.1\/$/,
  /^https:\/\/react\.dev\/errors\//,
  /^https:\/\/tailwindcss\.com$/,
  /^https:\/\/github\.com\/Hopding\/pdf-lib$/,
  /^https:\/\/\$\{\w+\}$/,
  ...MODEL_URLS.map((u) => new RegExp(`^${escape(u)}$`)),
];
const OCR_WORKER = /[\\/]assets[\\/]ocr-worker-[\w-]+\.js$/;
const OCR_WORKER_URLS = [/^https:\/\/web\.dev\/cross-origin-isolation-guide\/$/];
const PDFJS = /[\\/](assets[\\/]pdf-worker|chunks[\\/]pdf)-[\w-]+\.js$/;
const PDFJS_URLS = [
  /^http:\/\/www\.xfa\.org\/schema\/[\w/.-]*$/,
  /^http:\/\/ns\.adobe\.com\/(xdp|xdp\/pdf|xfdf|xmpmeta)\/$/,
  /^http:\/\/\$\{e\}$/,
  /^http:\/\/example\.com$/,
  /^https:\/\/foo\.bar$/,
];

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

describe('runtime browser capabilities', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('detects Chrome/Edge capabilities when chrome.debugger and chrome-extension:// are present', async () => {
    const action = { setBadgeText: vi.fn() };
    const request = vi.fn().mockResolvedValue(true);
    const isAllowedFileSchemeAccess = vi.fn().mockResolvedValue(true);
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { getURL: (p: string) => `chrome-extension://abcdef/${p}` },
      debugger: { attach: vi.fn(), sendCommand: vi.fn() },
      permissions: { request, contains: vi.fn() },
      extension: { isAllowedFileSchemeAccess },
      action,
    };

    expect(isFirefox()).toBe(false);
    expect(hasDebugger()).toBe(true);
    expect(shortcutsPageUrl()).toBe('chrome://extensions/shortcuts');
    expect(actionApi()).toBe(action);
    expect(await ensureDebuggerPermission()).toBe(true);
    expect(request).toHaveBeenCalledWith({ permissions: ['debugger'] });
    expect(await isFileAccessAllowed()).toBe(true);
  });

  it('falls back to chrome.permissions.contains when request rejects on Chrome/Edge', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Only permissions specified in the manifest'));
    const contains = vi.fn().mockResolvedValue(true);
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { getURL: (p: string) => `chrome-extension://abcdef/${p}` },
      debugger: { attach: vi.fn(), sendCommand: vi.fn() },
      permissions: { request, contains },
    };

    expect(await ensureDebuggerPermission()).toBe(true);
    expect(contains).toHaveBeenCalledWith({ permissions: ['debugger'] });
  });

  it('degrades cleanly on Firefox when debugger, fileSchemeAccess, and chrome:// shortcuts are absent', async () => {
    const browserAction = { setBadgeText: vi.fn() };
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { getURL: (p: string) => `moz-extension://1234-5678/${p}` },
      permissions: { request: vi.fn(), contains: vi.fn() },
      browserAction,
    };

    expect(isFirefox()).toBe(true);
    expect(hasDebugger()).toBe(false);
    expect(shortcutsPageUrl()).toBeNull();
    expect(actionApi()).toBe(browserAction);
    expect(await ensureDebuggerPermission()).toBe(false);
    expect(await isFileAccessAllowed()).toBe(false);
  });
});

describe('Firefox MV3 production build', () => {
  beforeAll(() => {
    execSync('pnpm exec wxt build -b firefox --mv3', {
      cwd: pkg,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }, 120_000);

  it('builds a valid Firefox MV3 manifest without debugger and with Gecko settings', () => {
    const manifest = JSON.parse(readFileSync(firefoxManifestPath, 'utf8')) as {
      manifest_version: number;
      permissions?: string[];
      optional_permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
      content_security_policy?: { extension_pages?: string };
      browser_specific_settings?: {
        gecko?: {
          id?: string;
          strict_min_version?: string;
          data_collection_permissions?: { required?: string[] };
        };
      };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions ?? []).not.toContain('debugger');
    expect(manifest.optional_permissions ?? []).not.toContain('debugger');
    expect(manifest.permissions ?? []).not.toContain('<all_urls>');
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
    expect(manifest.browser_specific_settings?.gecko).toEqual({
      id: 'screenscroll@screenscroll.app',
      strict_min_version: '115.0',
      data_collection_permissions: { required: ['none'] },
    });
  });

  it('Firefox MV3 bundle upholds the offline guard (no network APIs or unexpected URLs)', () => {
    const hits: string[] = [];
    for (const file of walkFiles(firefoxOut).filter((f) => /\.(js|html|css|json)$/.test(f))) {
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
});
