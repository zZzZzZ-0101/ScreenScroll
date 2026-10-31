import {
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  TextRenderingMode,
  beginText,
  popGraphicsState,
  pushGraphicsState,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFDocument,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { TextRun } from '../hints.js';
import type { PageLayout } from '../layout.js';
import type { PageSlice } from '../paginate.js';
import {
  buildGlyphlessFont,
  GLYPHLESS_ADVANCE,
  GLYPHLESS_ASCENT,
  GLYPHLESS_DESCENT,
  GLYPHLESS_NAME,
  GLYPHLESS_UNITS_PER_EM,
} from './glyphless.js';
import { contentLayout } from './locate.js';

/**
 * PDF_OUTPUT §2: Type0 font, Identity-H encoding, over the glyphless TrueType. Each distinct
 * character gets a CID (1, 2, 3, …); the ToUnicode CMap maps CIDs back to the characters, which
 * is what search, selection and copy use. Works for every script, with no font data per script.
 */
export class TextLayerFont {
  readonly ref: PDFRef;
  private readonly cids = new Map<string, number>();
  private readonly toUnicodeRef: PDFRef;
  private readonly cidToGidRef: PDFRef;

  constructor(private readonly doc: PDFDocument) {
    const ctx = doc.context;
    const fontBytes = buildGlyphlessFont();
    const fontFile = ctx.register(ctx.flateStream(fontBytes, { Length1: fontBytes.length }));
    const descriptor = ctx.register(
      ctx.obj({
        Type: 'FontDescriptor',
        FontName: GLYPHLESS_NAME,
        Flags: 4,
        FontBBox: [0, GLYPHLESS_DESCENT, GLYPHLESS_ADVANCE, GLYPHLESS_ASCENT],
        ItalicAngle: 0,
        Ascent: GLYPHLESS_ASCENT,
        Descent: GLYPHLESS_DESCENT,
        CapHeight: 700,
        StemV: 80,
        FontFile2: fontFile,
      }),
    );
    this.toUnicodeRef = ctx.nextRef();
    this.cidToGidRef = ctx.nextRef();
    const cidFont = ctx.register(
      ctx.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: GLYPHLESS_NAME,
        CIDSystemInfo: {
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        },
        FontDescriptor: descriptor,
        DW: (GLYPHLESS_ADVANCE * 1000) / GLYPHLESS_UNITS_PER_EM,
        CIDToGIDMap: this.cidToGidRef,
      }),
    );
    this.ref = ctx.register(
      ctx.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: GLYPHLESS_NAME,
        Encoding: 'Identity-H',
        DescendantFonts: [cidFont],
        ToUnicode: this.toUnicodeRef,
      }),
    );
  }

  /** Two-byte CIDs for `text`, assigning new ones as characters first appear. */
  encode(text: string): PDFHexString {
    let hex = '';
    for (const ch of text) {
      let cid = this.cids.get(ch);
      if (cid === undefined) {
        cid = this.cids.size + 1;
        if (cid > 0xffff) throw new Error('Text layer: too many distinct characters');
        this.cids.set(ch, cid);
      }
      hex += cid.toString(16).padStart(4, '0');
    }
    return PDFHexString.of(hex);
  }

  /** Writes the ToUnicode CMap and CID→GID map once every page has been drawn. */
  finish(): void {
    const ctx = this.doc.context;
    const entries = [...this.cids.entries()];
    let body = '';
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      body += `${chunk.length} beginbfchar\n`;
      for (const [ch, cid] of chunk)
        body += `<${cid.toString(16).padStart(4, '0')}> <${utf16beHex(ch)}>\n`;
      body += 'endbfchar\n';
    }
    const cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      body +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    ctx.assign(this.toUnicodeRef, ctx.flateStream(cmap));
    // Every CID uses glyph 1 (blank but not .notdef, which some tools treat as missing text).
    const map = new Uint8Array(2 * (this.cids.size + 1));
    for (let i = 2; i < map.length; i += 2) map[i + 1] = 1;
    ctx.assign(this.cidToGidRef, ctx.flateStream(map));
  }
}

function utf16beHex(ch: string): string {
  let hex = '';
  for (let i = 0; i < ch.length; i++) hex += ch.charCodeAt(i).toString(16).padStart(4, '0');
  return hex;
}

/** A run positioned on a PDF page: baseline origin in pt (PDF coordinates), size and width. */
export interface PlacedRun {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
}

/**
 * Runs that belong on this page, in reading order, mapped from document CSS px to PDF pt.
 * A run belongs to the page holding its vertical centre; the repeated overlap at the top of a
 * page after a forced cut is skipped, so text is never found twice.
 */
export function placeRuns(
  runs: readonly TextRun[],
  slice: PageSlice,
  pageLayout: PageLayout,
): PlacedRun[] {
  const layout = contentLayout(pageLayout, slice);
  const top = slice.y0 + slice.overlapTop;
  const mine = runs.filter((r) => {
    const cy = r.rect.y + r.rect.height / 2;
    const cx = r.rect.x + r.rect.width / 2;
    return cy >= top && cy < slice.y1 && cx >= slice.x0 && cx < slice.x1;
  });
  mine.sort(
    (a, b) =>
      (a.order ?? Infinity) - (b.order ?? Infinity) || a.rect.y - b.rect.y || a.rect.x - b.rect.x,
  );
  const out: PlacedRun[] = [];
  for (const r of mine) {
    // Rendered whitespace collapses, so the layer does too.
    const text = r.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // Font size = box height: the glyphless font's ascent − descent is exactly one em, so
    // selection highlights cover the line box.
    const size = r.rect.height * layout.s;
    const topPt = layout.box.y + (r.rect.y - slice.y0) * layout.s;
    out.push({
      text,
      x: layout.box.x + (r.rect.x - slice.x0) * layout.s,
      y: layout.paperH - topPt - (GLYPHLESS_ASCENT / GLYPHLESS_UNITS_PER_EM) * size,
      size,
      width: r.rect.width * layout.s,
    });
  }
  return out;
}

/** Draws placed runs in text rendering mode 3 (invisible), stretched to their measured width. */
export function drawTextRuns(page: PDFPage, font: TextLayerFont, runs: readonly PlacedRun[]): void {
  if (!runs.length) return;
  const key: PDFName = page.node.newFontDictionary('SPText', font.ref);
  // q … Q: the rendering mode is graphics state and would otherwise leak past ET, making
  // the footer drawn after this invisible too.
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];
  const em = GLYPHLESS_ADVANCE / GLYPHLESS_UNITS_PER_EM;
  for (const r of runs) {
    const chars = Array.from(r.text).length;
    const natural = chars * em * r.size;
    const scale = natural > 0 ? (100 * r.width) / natural : 100;
    ops.push(
      setFontAndSize(key, r.size),
      PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(round(scale))]),
      setTextMatrix(1, 0, 0, 1, round(r.x), round(r.y)),
      showText(font.encode(r.text)),
    );
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
