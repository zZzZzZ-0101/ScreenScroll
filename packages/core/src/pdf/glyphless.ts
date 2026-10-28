/**
 * A minimal TrueType font whose glyphs are empty (PDF_OUTPUT §2, "glyphless font"). The text
 * layer is invisible, so glyph shapes never matter: what matters is that every reader accepts
 * the font, and the ToUnicode map (see textlayer.ts) carries the real characters.
 * Built byte by byte so no third-party font file is shipped.
 */
export const GLYPHLESS_UNITS_PER_EM = 1000;
/** Advance width of every glyph, in font units. */
export const GLYPHLESS_ADVANCE = 500;
export const GLYPHLESS_ASCENT = 800;
export const GLYPHLESS_DESCENT = -200;
export const GLYPHLESS_NAME = 'ScrollPressGlyphless';

class Writer {
  private bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number) {
    return this.u16(v >>> 16).u16(v & 0xffff);
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.u8(0);
    return this;
  }
  get length() {
    return this.bytes.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum =
      (sum +
        (((data[i] ?? 0) << 24) |
          ((data[i + 1] ?? 0) << 16) |
          ((data[i + 2] ?? 0) << 8) |
          (data[i + 3] ?? 0))) >>>
      0;
  }
  return sum;
}

function nameTable(): Uint8Array {
  const strings: Array<[number, string]> = [
    [1, GLYPHLESS_NAME],
    [2, 'Regular'],
    [4, GLYPHLESS_NAME],
    [6, GLYPHLESS_NAME],
  ];
  const w = new Writer()
    .u16(0)
    .u16(strings.length)
    .u16(6 + 12 * strings.length);
  let offset = 0;
  const encoded = strings.map(([, s]) => {
    const e = new Writer();
    for (const ch of s) e.u16(ch.charCodeAt(0));
    return e.done();
  });
  strings.forEach(([id], i) => {
    // Windows, Unicode BMP, en-US.
    w.u16(3).u16(1).u16(0x409).u16(id).u16(encoded[i]!.length).u16(offset);
    offset += encoded[i]!.length;
  });
  for (const e of encoded) for (const b of e) w.u8(b);
  return w.done();
}

/** Simple glyph: one 4-point contour around the em box, padded to an even length. */
const EM_BOX_GLYPH_BYTES = 36;
function emBoxGlyph(): Uint8Array {
  const pts: Array<[number, number]> = [
    [0, GLYPHLESS_DESCENT],
    [0, GLYPHLESS_ASCENT],
    [GLYPHLESS_ADVANCE, GLYPHLESS_ASCENT],
    [GLYPHLESS_ADVANCE, GLYPHLESS_DESCENT],
  ];
  const w = new Writer()
    .i16(1) // numberOfContours
    .i16(0)
    .i16(GLYPHLESS_DESCENT)
    .i16(GLYPHLESS_ADVANCE)
    .i16(GLYPHLESS_ASCENT)
    .u16(pts.length - 1) // endPtsOfContours[0]
    .u16(0); // no instructions
  for (let i = 0; i < pts.length; i++) w.u8(0x01); // on-curve, coordinates as int16 deltas
  pts.forEach(([x], i) => w.i16(x - (i ? pts[i - 1]![0] : 0)));
  pts.forEach(([, y], i) => w.i16(y - (i ? pts[i - 1]![1] : 0)));
  while (w.length < EM_BOX_GLYPH_BYTES) w.u8(0);
  return w.done();
}

/** Builds the font file: .notdef (empty) and one em-box glyph, both 500 units wide. */
export function buildGlyphlessFont(): Uint8Array {
  const numGlyphs = 2;
  const tables: Record<string, Uint8Array> = {
    cmap: new Writer()
      .u16(0)
      .u16(1) // version, one subtable
      .u16(3)
      .u16(1)
      .u32(12) // Windows Unicode BMP at offset 12
      // format 4 with the single mandatory 0xFFFF segment
      .u16(4)
      .u16(24)
      .u16(0)
      .u16(2)
      .u16(2)
      .u16(0)
      .u16(0)
      .u16(0xffff)
      .u16(0)
      .u16(0xffff)
      .i16(1)
      .u16(0)
      .done(),
    // Glyph 0 (.notdef) is zero-length. Glyph 1 is one rectangle covering the em box: the
    // text is drawn in rendering mode 3, so it is never painted, but PDFium (Chrome's viewer)
    // derives search and selection boxes from glyph outlines — an empty glyph gave
    // zero-height highlights.
    glyf: emBoxGlyph(),
    head: new Writer()
      .u32(0x00010000)
      .u32(0x00010000)
      .u32(0) // checkSumAdjustment, patched below
      .u32(0x5f0f3cf5)
      .u16(0x000b)
      .u16(GLYPHLESS_UNITS_PER_EM)
      .zeros(16) // created, modified
      .i16(0)
      .i16(GLYPHLESS_DESCENT)
      .i16(GLYPHLESS_ADVANCE)
      .i16(GLYPHLESS_ASCENT)
      .u16(0)
      .u16(8)
      .i16(2)
      .i16(0) // short loca
      .i16(0)
      .done(),
    hhea: new Writer()
      .u32(0x00010000)
      .i16(GLYPHLESS_ASCENT)
      .i16(GLYPHLESS_DESCENT)
      .i16(0)
      .u16(GLYPHLESS_ADVANCE)
      .i16(0)
      .i16(0)
      .i16(0)
      .i16(1)
      .i16(0)
      .i16(0)
      .zeros(8)
      .i16(0)
      .u16(1) // numberOfHMetrics
      .done(),
    hmtx: new Writer().u16(GLYPHLESS_ADVANCE).i16(0).i16(0).done(),
    loca: new Writer()
      .u16(0)
      .u16(0)
      .u16(EM_BOX_GLYPH_BYTES / 2)
      .done(), // short offsets (÷2)
    maxp: new Writer()
      .u32(0x00010000)
      .u16(numGlyphs)
      .u16(4) // maxPoints
      .u16(1) // maxContours
      .u16(0)
      .u16(0)
      .u16(2) // maxZones
      .zeros(16) // the eight remaining maxp fields
      .done(),
    name: nameTable(),
    post: new Writer().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).zeros(16).done(),
  };

  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 16 * 2 ** entrySelector;
  const dir = new Writer()
    .u32(0x00010000)
    .u16(n)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(n * 16 - searchRange);
  let offset = 12 + 16 * n;
  const body: Uint8Array[] = [];
  let headOffset = 0;
  for (const tag of tags) {
    const data = tables[tag]!;
    for (const ch of tag) dir.u8(ch.charCodeAt(0));
    dir.u32(checksum(data)).u32(offset).u32(data.length);
    if (tag === 'head') headOffset = offset;
    const padded = new Uint8Array((data.length + 3) & ~3);
    padded.set(data);
    body.push(padded);
    offset += padded.length;
  }
  const font = new Uint8Array(offset);
  font.set(dir.done(), 0);
  let pos = 12 + 16 * n;
  for (const b of body) {
    font.set(b, pos);
    pos += b.length;
  }
  // head.checkSumAdjustment makes the whole file sum to 0xB1B0AFBA.
  const adjust = (0xb1b0afba - checksum(font)) >>> 0;
  new DataView(font.buffer).setUint32(headOffset + 8, adjust);
  return font;
}
