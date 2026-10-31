// Renders the icon SVGs in packages/extension/assets-src to the PNG sizes the manifest needs.
// Small sizes have their own drawings: the doodle's fine lines blur below 48 px.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createCanvas, Image } from '@napi-rs/canvas';

const src = (name) => new URL(`../packages/extension/assets-src/${name}`, import.meta.url);
const outDir = new URL('../packages/extension/public/icon/', import.meta.url);
await mkdir(outDir, { recursive: true });
const sources = { 16: 'icon-16.svg', 32: 'icon-small.svg', 48: 'icon.svg', 128: 'icon.svg' };
for (const [size, file] of Object.entries(sources)) {
  const img = new Image();
  img.src = await readFile(src(file));
  const canvas = createCanvas(Number(size), Number(size));
  canvas.getContext('2d').drawImage(img, 0, 0, Number(size), Number(size));
  await writeFile(new URL(`${size}.png`, outDir), canvas.toBuffer('image/png'));
}
console.log('icons written');
