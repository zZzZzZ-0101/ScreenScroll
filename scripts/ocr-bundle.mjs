// Dev tool (not shipped): gets the OCR model files named in the engine descriptor into
// .cache/ocr-bundle/ (via `npm pack`, which uses npm's own network settings), checks their
// SHA-256, and prints the directory for OCR_BUNDLE. Used by `pnpm ocr:check` (the model
// test) and the OCR e2e test.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(root, 'packages/core/src/ocr/engines.ts'), 'utf8');
const [, pkg] = /npm\/(@[^/]+\/[^/@]+@[^/]+)\/bundle\//.exec(src);
const files = [
  ...src.matchAll(/path: '([^']+)',\s*bytes: [\d_]+,\s*sha256: '([0-9a-f]{64})'/g),
].map((m) => ({ path: m[1], sha256: m[2] }));
const cache = join(root, '.cache');
const out = join(cache, 'ocr-bundle');
const sum = (p) => {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
};
if (files.some((f) => sum(join(out, f.path)) !== f.sha256)) {
  mkdirSync(out, { recursive: true });
  const tgz = execFileSync('npm', ['pack', pkg, '--pack-destination', cache], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .trim()
    .split('\n')
    .at(-1);
  execFileSync('tar', [
    'xzf',
    join(cache, tgz),
    '-C',
    out,
    '--strip-components=2',
    'package/bundle',
  ]);
}
for (const f of files)
  if (sum(join(out, f.path)) !== f.sha256) throw new Error(`${f.path}: checksum mismatch`);
console.log(out);
