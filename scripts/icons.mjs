// Renders packages/extension/assets-src/icon.svg to the PNG sizes the manifest needs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createCanvas, Image } from '@napi-rs/canvas';

const svg = await readFile(new URL('../packages/extension/assets-src/icon.svg', import.meta.url));
const outDir = new URL('../packages/extension/public/icon/', import.meta.url);
await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const img = new Image();
  img.src = svg;
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  await writeFile(new URL(`${size}.png`, outDir), canvas.toBuffer('image/png'));
}
console.log('icons written');
