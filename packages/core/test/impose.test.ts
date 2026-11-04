import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { bookletOrder, impose } from '../src/pdf/impose.js';

async function numbered(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`PAGE${i}`, { x: 250, y: 420, size: 30, font });
  }
  return doc.save();
}

/** The PAGEn labels on each output page, left to right. */
async function labels(bytes: Uint8Array): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: string[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const items = (await (await pdf.getPage(i)).getTextContent()).items as Array<{
      str: string;
      transform: number[];
    }>;
    out.push(
      items
        .filter((t) => t.str.startsWith('PAGE'))
        .sort((a, b) => a.transform[4]! - b.transform[4]!)
        .map((t) => t.str),
    );
  }
  return out;
}

describe('2-up and booklet printing', () => {
  it('booklet order: padded to 4, outside in', () => {
    expect(bookletOrder(5)).toEqual([
      [null, 0],
      [1, null],
      [null, 2],
      [3, 4],
    ]);
    expect(bookletOrder(4)).toEqual([
      [3, 0],
      [1, 2],
    ]);
  });
  it('2-up: pairs on landscape sheets of the same paper, text still there', async () => {
    const out = await impose(await numbered(5), '2up');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
    expect(await labels(out)).toEqual([['PAGE1', 'PAGE2'], ['PAGE3', 'PAGE4'], ['PAGE5']]);
  });
  it('booklet: sides in fold order', async () => {
    const out = await impose(await numbered(5), 'booklet');
    expect(await labels(out)).toEqual([['PAGE1'], ['PAGE2'], ['PAGE3'], ['PAGE4', 'PAGE5']]);
  });
});
