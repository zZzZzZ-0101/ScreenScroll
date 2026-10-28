import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// Hard constraint 1: the shipped bundle must make no network requests.
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
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${file}: ${re}`);
      for (const m of text.matchAll(/https?:\/\/[^"'`\s)\\]*/g)) {
        if (!URL_ALLOW.some((a) => a.test(m[0]))) hits.push(`${file}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('manifest requests no broad host permissions', () => {
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.permissions).not.toContain('<all_urls>');
    expect(manifest.content_security_policy).toBeUndefined();
  });
});
