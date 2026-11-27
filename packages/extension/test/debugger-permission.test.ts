import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = join(pkg, '.output/chrome-mv3/manifest.json');

describe('production manifest debugger permission (F0)', () => {
  beforeAll(() => {
    if (!existsSync(manifestPath)) {
      execSync('pnpm exec wxt build', {
        cwd: pkg,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'production' },
      });
    }
  }, 120_000);

  it('declares debugger in permissions and never in optional_permissions', () => {
    // Chrome MV3 forbids 'debugger' in optional_permissions and rejects
    // chrome.permissions.request({ permissions: ['debugger'] }) with
    // "Only permissions specified in the manifest may be requested."
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      permissions?: string[];
      optional_permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    expect(manifest.permissions ?? []).toContain('debugger');
    expect(manifest.optional_permissions ?? []).not.toContain('debugger');
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  });
});
