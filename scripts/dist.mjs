// Refreshes extension/: the built extension, committed so anyone can install ScreenScroll
// straight from GitHub's "Download ZIP" (README → Install). CI fails if it is out of date.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = `${root}packages/extension/.output/chrome-mv3`;
const out = `${root}extension`;
if (!existsSync(`${built}/manifest.json`)) throw new Error('Build first: pnpm build');
rmSync(out, { recursive: true, force: true });
cpSync(built, out, { recursive: true });
console.log('extension/ updated');
