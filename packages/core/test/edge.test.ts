import { describe, expect, it } from 'vitest';
import {
  annotationAt,
  blockedReason,
  bounds,
  buildFilename,
  commit,
  computeLayout,
  contentCrop,
  cropAround,
  DEFAULT_PAGE_SETTINGS,
  DEFAULT_STYLE,
  drawAnnotations,
  emptyHints,
  emptyHistory,
  fillTemplate,
  bandTokens,
  hitTest,
  mergeHints,
  moveBy,
  normalizeRegion,
  paginate,
  redo,
  sanitizeFilename,
  undo,
  type Annotation,
  type AnnotationCtx,
  type DomHints,
  type PageSlice,
  type PaginateInput,
} from '../src/index.js';

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/** PAGINATION §8 invariants that must hold for any input. */
function check(input: PaginateInput, slices: PageSlice[]): string[] {
  const errs: string[] = [];
  const H = input.height;
  const start = Math.max(0, Math.min(H, input.range?.y0 ?? 0));
  const end = Math.max(start, Math.min(H, input.range?.y1 ?? H));
  if (!(H > 0)) return slices.length ? ['slices for an empty capture'] : [];
  if (!slices.length) return ['no slices'];
  if (Math.abs(slices[0]!.y0 - start) > 1e-6) errs.push(`starts at ${slices[0]!.y0}, not ${start}`);
  if (Math.abs(slices.at(-1)!.y1 - end) > 1e-6)
    errs.push(`ends at ${slices.at(-1)!.y1}, not ${end}`);
  slices.forEach((s, i) => {
    const own = s.y1 - s.y0 - s.overlapTop;
    if (!(s.y1 >= s.y0)) errs.push(`slice ${i} inverted`);
    if (own > input.T + 1e-6) errs.push(`slice ${i} holds ${own} > T ${input.T}`);
    if (i > 0 && Math.abs(s.y0 + s.overlapTop - slices[i - 1]!.y1) > 1e-6)
      errs.push(`slice ${i} does not continue slice ${i - 1}`);
    if (s.overlapTop > 0 && slices[i - 1]?.breakKind !== 'forced')
      errs.push(`slice ${i} repeats content without a forced cut`);
    if (s.breakKind === 'forced' && !s.warnings.length)
      errs.push(`forced cut ${i} without warning`);
    if (i < slices.length - 1 && s.breakKind !== 'forced' && s.breakKind !== 'manual') {
      // A clean break never lands strictly inside a text line.
      for (const f of input.hints?.forbidden ?? [])
        if (f.kind === 'line' && s.y1 > f.y0 + 1e-6 && s.y1 < f.y1 - 1e-6)
          errs.push(`break ${i} at ${s.y1} cuts line ${f.y0}–${f.y1}`);
    }
    if (s.x0 !== (input.crop?.x0 ?? 0) || s.x1 !== (input.crop?.x1 ?? input.width))
      errs.push(`slice ${i} has the wrong crop`);
  });
  return errs;
}

function randomDoc(r: () => number): PaginateInput {
  const H = Math.floor(r() < 0.1 ? r() * 50 : r() * 20_000);
  const T = Math.max(20, Math.floor(200 + r() * 1500));
  const hints: DomHints = emptyHints();
  let y = r() * 40;
  const lh = 12 + r() * 30;
  while (y < H) {
    const roll = r();
    if (roll < 0.75) {
      hints.forbidden.push({ y0: y, y1: Math.min(H, y + lh), kind: 'line' });
      y += lh + (r() < 0.2 ? lh : 2);
    } else if (roll < 0.9) {
      // Images and atomic blocks, sometimes taller than a page.
      const h = r() < 0.3 ? T * (1 + r() * 2) : r() * T * 0.6;
      hints.forbidden.push({ y0: y, y1: Math.min(H, y + h), kind: r() < 0.5 ? 'image' : 'atomic' });
      y += h + 8;
    } else {
      hints.blockEnds.push({ y, kind: r() < 0.5 ? 'paragraph' : 'section' });
      y += 16;
    }
  }
  const input: PaginateInput = { height: H, width: 800, T, hints };
  if (r() < 0.3) input.crop = { x0: Math.floor(r() * 200), x1: 600 + Math.floor(r() * 200) };
  if (r() < 0.3) {
    const a = r() * H;
    const b = r() * H;
    input.range = r() < 0.1 ? { y0: b, y1: a } : { y0: Math.min(a, b), y1: Math.max(a, b) };
  }
  if (r() < 0.3) {
    input.options = {
      pinned: Array.from({ length: Math.floor(r() * 5) }, () => r() * H * 1.2 - H * 0.1),
      removed: Array.from({ length: Math.floor(r() * 5) }, () => r() * H),
    };
  }
  return input;
}

describe('pagination fuzz', () => {
  it('holds the invariants on 3,000 random documents', () => {
    const r = rng(20261028);
    const failures: string[] = [];
    for (let n = 0; n < 3000; n++) {
      const input = randomDoc(r);
      let slices: PageSlice[];
      try {
        slices = paginate(input);
      } catch (e) {
        failures.push(`#${n}: threw ${String(e)}`);
        continue;
      }
      for (const e of check(input, slices))
        failures.push(`#${n} (H=${input.height}, T=${input.T}): ${e}`);
      // Determinism (TESTING §1 invariant 4).
      if (JSON.stringify(paginate(input)) !== JSON.stringify(slices))
        failures.push(`#${n}: not deterministic`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('handles degenerate sizes', () => {
    for (const height of [0, 0.5, 1, 99.999, 100, 100.001, 200, 1e6]) {
      const input = { height, width: 10, T: 100 };
      expect(check(input, paginate(input)), `H=${height}`).toEqual([]);
    }
  });

  it('cuts a page made of one giant image with overlap and warnings', () => {
    const hints = emptyHints();
    hints.forbidden.push({ y0: 0, y1: 5000, kind: 'atomic' });
    const input = { height: 5000, width: 500, T: 1000, hints };
    const slices = paginate(input);
    expect(check(input, slices)).toEqual([]);
    expect(slices.slice(0, -1).every((s) => s.breakKind === 'forced')).toBe(true);
    expect(slices.slice(1).every((s) => s.overlapTop > 0)).toBe(true);
  });

  it('keeps every pinned break inside the range and ignores the rest', () => {
    const input: PaginateInput = {
      height: 3000,
      width: 500,
      T: 1000,
      range: { y0: 500, y1: 2500 },
      options: { pinned: [-5, 0, 500, 900, 900, 2500, 2600, Number.NaN] },
    };
    const slices = paginate(input);
    expect(check(input, slices)).toEqual([]);
    expect(slices.map((s) => s.y1)).toContain(900);
    expect(slices.filter((s) => s.y1 === 900)).toHaveLength(1);
  });

  it('a 1,000,000 px page paginates quickly', () => {
    const hints = emptyHints();
    for (let y = 0; y < 1e6; y += 24) hints.forbidden.push({ y0: y, y1: y + 20, kind: 'line' });
    const t = performance.now();
    const slices = paginate({ height: 1e6, width: 800, T: 1100, hints });
    expect(performance.now() - t).toBeLessThan(5000);
    expect(slices.length).toBeGreaterThan(900);
  });
});

describe('layout edge cases', () => {
  it('rejects margins that leave no room, with a readable message', () => {
    const big = { top: 200, right: 200, bottom: 200, left: 200 };
    expect(() => computeLayout({ ...DEFAULT_PAGE_SETTINGS, marginsMm: big }, 800)).toThrow(
      /margin/i,
    );
  });

  it('handles a 1 px wide capture and a 20,000 px wide one', () => {
    for (const w of [1, 20_000]) {
      const l = computeLayout(DEFAULT_PAGE_SETTINGS, w);
      expect(l.s).toBeGreaterThan(0);
      expect(Number.isFinite(l.T)).toBe(true);
      expect(l.T).toBeGreaterThan(0);
    }
  });
});

describe('file names', () => {
  const date = new Date(2026, 9, 28, 9, 5);
  it.each([
    ['', 'https://example.org/'],
    ['   ', ''],
    ['CON', ''],
    ['a/b\\c:d*e?f"g<h>i|j', ''],
    ['...', ''],
    ['中文标题 · テスト 🙂', ''],
    ['x'.repeat(500), ''],
    ['line\nbreak\ttab', ''],
  ])('%j makes a safe, non-empty name', (title, url) => {
    const name = buildFilename('{title}_{date}', { title, url, date }, 'pdf');
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name).not.toMatch(/[\\/:*?"<>|\n\t]/);
    expect(name.replace(/\.pdf$/, '').replace(/[_\s.-]/g, '').length).toBeGreaterThan(0);
    expect(name.startsWith('.')).toBe(false);
  });

  it('drops invisible format characters Chrome refuses', () => {
    const name = sanitizeFilename('a\u200bb\ufeffc\u00add\u202ee\u2066f\u061cg\u{e0001}h\u200fi');
    expect(name).toBe('abcdefghi');
    expect(sanitizeFilename('\u200f\u200e')).toBe('capture');
  });

  it('keeps CJK and emoji intact', () => {
    expect(sanitizeFilename('中文 🙂')).toContain('中文');
  });

  it('understands {date} and {time} like the header and footer, and the old tokens', () => {
    const info = { title: 'T', url: '', date };
    expect(buildFilename('{title}_{date}_{time}', info, 'pdf')).toBe('T_2026-10-28_0905.pdf');
    expect(buildFilename('{title}_{yyyy}-{mm}-{dd}_{HHmm}', info, 'pdf')).toBe(
      'T_2026-10-28_0905.pdf',
    );
  });

  it('survives an empty or token-only template', () => {
    for (const t of ['', '{nope}', '{title}{title}{title}'])
      expect(buildFilename(t, { title: 'A', url: '', date }, 'pdf')).toMatch(/\.pdf$/);
  });
});

describe('header/footer templates', () => {
  it('leaves unknown tokens and fills page numbers at scale', () => {
    const t = bandTokens({ title: '', url: 'not a url', capturedAt: date() }, 9999, 10000);
    expect(fillTemplate('{page}/{pages} {unknown}', t)).toBe('9999/10000 {unknown}');
    expect(fillTemplate('{domain}', t)).not.toContain('undefined');
  });
  function date() {
    return new Date(2026, 0, 1);
  }
});

describe('blocked pages', () => {
  it.each([
    ['chrome://settings', true],
    ['edge://settings', true],
    ['about:blank', true],
    ['view-source:https://example.org', true],
    ['https://chromewebstore.google.com/detail/x', true],
    ['https://chrome.google.com/webstore/detail/x', true],
    ['https://microsoftedge.microsoft.com/addons/detail/x', true],
    ['javascript:alert(1)', true],
    ['not a url', true],
    [undefined, true],
    ['', true],
    ['https://example.org', false],
    ['http://localhost:5177/a.html', false],
  ] as const)('%s → blocked %s', (url, blocked) => {
    expect(blockedReason(url) !== null).toBe(blocked);
    if (blocked) expect(blockedReason(url)!.message.length).toBeGreaterThan(20);
  });

  it('file:// needs the file access switch', () => {
    expect(blockedReason('file:///C:/a.html', false)).not.toBeNull();
    expect(blockedReason('file:///C:/a.html', true)).toBeNull();
  });
});

describe('regions and crops', () => {
  it('normalises reversed and out-of-bounds corners', () => {
    expect(normalizeRegion({ x: 500, y: 900 }, { x: -20, y: -50 }, 400, 800)).toEqual({
      x0: 0,
      x1: 400,
      y0: 0,
      y1: 800,
    });
    const r = normalizeRegion({ x: 10, y: 10 }, { x: 10, y: 10 }, 100, 100);
    expect(r.x1 - r.x0).toBe(0);
  });

  it('content crop with nothing to measure keeps the full width', () => {
    expect(contentCrop(1200, {})).toEqual({ x0: 0, x1: 1200, cropped: false });
    expect(contentCrop(1200, { hints: emptyHints() })).toEqual({ x0: 0, x1: 1200, cropped: false });
  });

  it('merging no hints gives empty hints', () => {
    expect(mergeHints([])).toEqual(emptyHints());
  });
});

describe('annotation edge cases', () => {
  const s = DEFAULT_STYLE;
  const dot: Annotation = { id: 'p', kind: 'pen', style: s, points: [50, 50] };
  const flat: Annotation = { id: 'r', kind: 'rect', style: s, x: 10, y: 10, w: 0, h: 0 };
  const empty: Annotation = { id: 't', kind: 'text', style: s, x: 0, y: 0, text: '' };

  it('one-point strokes, zero-size boxes and empty text have finite bounds', () => {
    for (const a of [dot, flat, empty]) {
      const b = bounds(a);
      expect([b.x, b.y, b.width, b.height].every(Number.isFinite)).toBe(true);
    }
    expect(hitTest(dot, 51, 51)).toBe(false); // no segment to hit, and no crash
    expect(hitTest(flat, 10, 10)).toBe(true);
    expect(annotationAt([], 0, 0)).toBeNull();
  });

  it('moving to negative coordinates is allowed (export clips)', () => {
    expect(bounds(moveBy(flat, -100, -100))).toMatchObject({ x: -90, y: -90 });
  });

  it('undo and redo stop at the ends', () => {
    let h = emptyHistory<number>(0);
    expect(undo(h)).toBe(h);
    h = commit(commit(h, 1), 2);
    h = undo(undo(undo(undo(h))));
    expect(h.present).toBe(0);
    h = redo(redo(redo(h)));
    expect(h.present).toBe(2);
    expect(redo(h)).toBe(h);
    // A new edit after undo drops the redo branch.
    h = commit(undo(h), 9);
    expect(h.future).toEqual([]);
  });

  it('drawing outside the region does nothing; the crop never grows past the page', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as AnnotationCtx, {
      get: (_t, k) => (typeof k === 'string' && k !== 'then' ? () => calls.push(k) : undefined),
      set: () => true,
    });
    drawAnnotations(ctx, [flat], { x0: 1000, x1: 2000, y0: 1000, y1: 2000 }, 1);
    expect(calls.filter((c) => c === 'stroke')).toEqual([]);
    const crop = cropAround({ x0: 100, x1: 200, cropped: true }, [moveBy(flat, -500, 0)], 300);
    expect(crop.x0).toBe(0);
  });
});

describe('trailing blank space', () => {
  function rows(height: number, ink: Array<[number, number]>) {
    const safe = new Uint8Array(height).fill(1);
    for (const [a, b] of ink) safe.fill(0, a, b);
    return {
      rowsPerPx: 1,
      width: 100,
      height,
      safe,
      mode: new Uint8Array(height).fill(255),
      damage: new Uint16Array(height),
      colInk: new Uint32Array(100),
    };
  }

  it('a short page on a tall viewport is one page', () => {
    const r = rows(1600, [[24, 48]]);
    const without = paginate({ height: 1600, width: 100, T: 1000, rows: r });
    const trimmed = paginate({ height: 1600, width: 100, T: 1000, rows: r, trimBlankEnd: true });
    expect(without).toHaveLength(2);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]!.y1).toBe(48 + 16);
  });

  it('keeps DOM content that has no ink (white text, transparent images)', () => {
    const hints = emptyHints();
    hints.forbidden.push({ y0: 1200, y1: 1220, kind: 'line' });
    const s = paginate({
      height: 1600,
      width: 100,
      T: 1000,
      rows: rows(1600, [[0, 30]]),
      hints,
      trimBlankEnd: true,
    });
    expect(s.at(-1)!.y1).toBe(1236);
  });

  it('a blank capture keeps its page; a drawn crop is never trimmed', () => {
    expect(
      paginate({ height: 900, width: 100, T: 1000, rows: rows(900, []), trimBlankEnd: true })[0]!
        .y1,
    ).toBe(900);
    const s = paginate({
      height: 1600,
      width: 100,
      T: 1000,
      rows: rows(1600, [[0, 30]]),
      range: { y0: 0, y1: 1500 },
      trimBlankEnd: true,
    });
    expect(s.at(-1)!.y1).toBe(1500);
  });
});
