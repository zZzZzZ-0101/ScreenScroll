import { emptyHints } from '@screenscroll/core';
import { db } from './db';

/** Rows per stored frame: no canvas taller than this is ever made (CLAUDE.md rule 5). */
export const IMPORT_FRAME_ROWS = 1000;
/** Browsers can't draw canvases wider than this. */
const MAX_WIDTH = 16384;

/**
 * Import (M6): a tall PNG, JPEG or WebP (a long screenshot from another tool) becomes a
 * capture like any other, cut into frames, so the Studio paginates it by its pixels. One
 * image pixel is one CSS px; the page layout scales it to the paper. No DOM, so no text
 * layer: Text recognition reads it at export.
 */
export async function importImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} is not an image this browser can open.`);
  });
  const { width, height } = bmp;
  if (width > MAX_WIDTH)
    throw new Error(`${file.name} is ${width} px wide; images up to ${MAX_WIDTH} px wide open.`);
  const id = crypto.randomUUID();
  const d = await db();
  let index = 0;
  for (let y = 0; y < height; y += IMPORT_FRAME_ROWS, index++) {
    const h = Math.min(IMPORT_FRAME_ROWS, height - y);
    const c = new OffscreenCanvas(width, h);
    c.getContext('2d')!.drawImage(bmp, 0, y, width, h, 0, 0, width, h);
    await d.put('frames', {
      sessionId: id,
      index,
      docY: y,
      crop: { x: 0, y: 0, width, height: h },
      dpr: 1,
      imageWidth: width,
      imageHeight: h,
      blob: await c.convertToBlob({ type: 'image/png' }),
      hints: emptyHints(),
      hintsMs: 0,
    });
  }
  bmp.close();
  await d.put('sessions', {
    id,
    url: '',
    title: file.name.replace(/\.[^.]+$/, ''),
    capturedAt: new Date().toISOString(),
    status: 'complete',
    docWidth: width,
    docHeight: height,
    frameCount: index,
    warnings: [],
    tabId: -1,
    windowId: -1,
  });
  return id;
}
