import { emptyHints, type DomHints } from '@screenscroll/core';
import { db } from './db';
import { IMPORT_FRAME_ROWS } from './import-image';

/** PDF points → CSS px (1 pt = 1/72 in, 1 CSS px = 1/96 in). */
const CSS_PER_PT = 96 / 72;
/** Pages are drawn at 2 device px per CSS px (192 dpi): sharp on paper and on 2× screens. */
const DPR = 2;
/** Grey gap between pages and beside them, so page detection finds the original pages. */
const GAP = 16;
const SIDE = 24;
const GAP_GREY = '#6b6b6b';
/** Longest side a page may be drawn at (canvas limits); larger pages are drawn smaller. */
const MAX_SIDE = 16_384;

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

/** pdf.js loads only when a PDF is opened; its worker is bundled (see pdf-worker.ts). */
function pdfjs(): Promise<PdfJs> {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdf-worker.ts', import.meta.url), {
      type: 'module',
    });
    return m;
  });
  return lib;
}

/**
 * Import (M6/M8): a PDF becomes a capture: its pages stacked top to bottom with a grey gap,
 * drawn at 192 dpi into frames of at most 1000 rows (no canvas taller than that, CLAUDE.md
 * rule 5), and its text as text runs, so the new PDF is searchable and Save as text works.
 * The gaps let document-page detection find the original pages.
 */
export async function importPdf(file: File): Promise<string> {
  const m = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await m
    .getDocument({ data, useSystemFonts: true })
    .promise.catch(() => {
      throw new Error(`${file.name} is not a PDF this browser can open.`);
    });
  try {
    // Every page at the widest page's width, so the capture is one column.
    const sizes: Array<{ w: number; h: number }> = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: CSS_PER_PT });
      sizes.push({ w: vp.width, h: vp.height });
    }
    const width = Math.round(Math.max(...sizes.map((s) => s.w))) + 2 * SIDE;
    if (width * DPR > MAX_SIDE) throw new Error(`${file.name} has pages too wide to open.`);

    const id = crypto.randomUUID();
    const d = await db();
    let y = 0;
    let index = 0;
    let order = 0;
    const warnings: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const size = sizes[p - 1]!;
      // Pages are centred on the common width with a grey margin, like a viewer shows them.
      const left = Math.round((width - size.w) / 2);
      const pageH = Math.round(size.h);
      const hints: DomHints = emptyHints();
      const text = await page.getTextContent();
      const vp = page.getViewport({ scale: CSS_PER_PT });
      for (const item of text.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const tx = m.Util.transform(vp.transform, item.transform);
        const size = Math.hypot(tx[2]!, tx[3]!);
        if (!(size > 0)) continue;
        const top = y + tx[5]! - size * 0.85;
        hints.textRuns.push({
          text: item.str,
          rect: { x: left + tx[4]!, y: top, width: item.width * CSS_PER_PT, height: size * 1.1 },
          fontSizePx: size,
          order: order++,
        });
        hints.forbidden.push({ y0: top, y1: top + size * 1.1, kind: 'line' });
      }
      hints.blockEnds.push({ y: y + pageH, kind: 'section' });

      // Drawn in slices of ≤ 1000 CSS rows: pdf.js renders each slice through an offset
      // viewport, so the full page never needs a canvas.
      for (let sy = 0; sy < pageH + (p < doc.numPages ? GAP : 0); sy += IMPORT_FRAME_ROWS) {
        const sh = Math.min(IMPORT_FRAME_ROWS, pageH + (p < doc.numPages ? GAP : 0) - sy);
        const c = new OffscreenCanvas(width * DPR, sh * DPR);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = GAP_GREY;
        ctx.fillRect(0, 0, c.width, c.height);
        if (sy < pageH) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(left * DPR, 0, Math.round(size.w * DPR), Math.min(sh, pageH - sy) * DPR);
          const view = page.getViewport({
            scale: CSS_PER_PT * DPR,
            offsetX: left * DPR,
            offsetY: -sy * DPR,
          });
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, c.width, Math.min(sh, pageH - sy) * DPR);
          ctx.clip();
          await page.render({
            canvas: c as unknown as HTMLCanvasElement,
            canvasContext: ctx as unknown as CanvasRenderingContext2D,
            viewport: view,
          }).promise;
          ctx.restore();
        }
        await d.put('frames', {
          sessionId: id,
          index,
          docY: y + sy,
          crop: { x: 0, y: 0, width, height: sh },
          dpr: DPR,
          imageWidth: c.width,
          imageHeight: c.height,
          blob: await c.convertToBlob({ type: 'image/png' }),
          // Text belongs to the page's first slice; frames' hints are merged by position.
          hints: sy === 0 ? hints : emptyHints(),
          hintsMs: 0,
        });
        index++;
      }
      y += pageH + (p < doc.numPages ? GAP : 0);
      page.cleanup();
    }
    // Same-size pages (the usual case): the pages are known exactly, no detection needed.
    const sameSize = sizes.every(
      (z) => Math.abs(z.w - sizes[0]!.w) < 1 && Math.abs(Math.round(z.h) - Math.round(sizes[0]!.h)) < 1,
    );
    const firstLeft = Math.round((width - sizes[0]!.w) / 2);
    if (!order) warnings.push('This PDF has no text layer: pages are pictures. Text recognition can read them at export.');
    await d.put('sessions', {
      id,
      url: '',
      title: file.name.replace(/\.[^.]+$/, ''),
      capturedAt: new Date().toISOString(),
      status: 'complete',
      docWidth: width,
      docHeight: y,
      frameCount: index,
      warnings,
      tabId: -1,
      windowId: -1,
      // The file's own pages are what was asked for: used straight away (one click back to
      // "everything", as for any capture).
      project: sameSize
        ? {
            annotations: [],
            crop: null,
            pages: 'grid',
            sheetGrid: { x0: firstLeft, x1: firstLeft + sizes[0]!.w, top: 0, height: Math.round(sizes[0]!.h), gap: GAP },
          }
        : { annotations: [], crop: null, pages: 'auto' },
    });
    return id;
  } finally {
    void doc.destroy();
  }
}
