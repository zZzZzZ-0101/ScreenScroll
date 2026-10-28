import { createCanvas, ImageData as SkImageData } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeRows,
  computeLayout,
  DEFAULT_PAGE_SETTINGS,
  debugJson,
  drawDebugOverlay,
  paginateDebug,
  toGrey,
  type PageSettings,
  type PageSlice,
  type RowProfile,
} from '@screenscroll/core';
import { synthFixtures, type SynthDoc } from '../src/synth.js';

const PAPERS: Array<[string, PageSettings]> = [
  ['A4 portrait', DEFAULT_PAGE_SETTINGS],
  ['A4 landscape', { ...DEFAULT_PAGE_SETTINGS, orientation: 'landscape' }],
  ['Letter portrait', { ...DEFAULT_PAGE_SETTINGS, paper: 'Letter' }],
  ['A5 portrait', { ...DEFAULT_PAGE_SETTINGS, paper: 'A5' }],
];
const OUT = new URL('../out/', import.meta.url);

let docs: SynthDoc[] = [];
const profiles = new Map<string, RowProfile>();

beforeAll(async () => {
  docs = await synthFixtures();
  for (const d of docs) {
    profiles.set(
      d.name,
      analyzeRows(toGrey({ width: d.width, height: d.height, data: d.rgba, channels: 4 })),
    );
  }
  mkdirSync(OUT, { recursive: true });
}, 60_000);

/** TESTING §1 invariants 1–3 and 5 (4, determinism, is checked by running twice). */
function checkInvariants(doc: SynthDoc, slices: PageSlice[], T: number) {
  const problems: string[] = [];
  if (slices[0]!.y0 !== 0) problems.push('first slice does not start at 0');
  if (slices.at(-1)!.y1 !== doc.height) problems.push('last slice does not end at H');
  slices.forEach((s, i) => {
    if (s.y1 - s.y0 > T + 1e-6)
      problems.push(`page ${i + 1} taller than T (${s.y1 - s.y0} > ${T})`);
    if (i > 0 && Math.abs(s.y0 + s.overlapTop - slices[i - 1]!.y1) > 1e-6)
      problems.push(`page ${i + 1} does not tile`);
    if (i === slices.length - 1) return;
    const forced = s.breakKind === 'forced';
    if (!forced) {
      const hit = doc.glyphs.find((g) => s.y1 > g.y0 && s.y1 < g.y1);
      if (hit) problems.push(`page ${i + 1} cut at ${s.y1} through text ${hit.y0}–${hit.y1}`);
    } else if (!doc.unbreakable.some((u) => s.y1 > u.y0 && s.y1 < u.y1)) {
      problems.push(`page ${i + 1} forced cut at ${s.y1} outside an unbreakable element`);
    }
  });
  return problems;
}

describe.each(['pixels', 'hints'] as const)('synthetic fixtures, %s', (mode) => {
  it.each(PAPERS)('%s: invariants hold for every fixture', (paperName, settings) => {
    const T = computeLayout(settings, 800).T;
    const failures: string[] = [];
    for (const doc of docs) {
      const rows = profiles.get(doc.name)!;
      const input = {
        height: doc.height,
        width: doc.width,
        T,
        rows,
        hints: mode === 'hints' ? doc.hints : null,
      };
      const a = paginateDebug(input);
      const b = paginateDebug(structuredClone(input));
      if (JSON.stringify(a.slices) !== JSON.stringify(b.slices))
        failures.push(`${doc.name}: not deterministic`);
      for (const p of checkInvariants(doc, a.slices, T)) failures.push(`${doc.name}: ${p}`);
      // Forced cuts must happen where the generator put an unbreakable element taller than a page.
      if (
        doc.unbreakable.some((u) => u.y1 - u.y0 > T) &&
        !a.slices.some((s) => s.breakKind === 'forced')
      ) {
        failures.push(`${doc.name}: expected a forced cut`);
      }
      if (paperName === 'A4 portrait') writeOverlay(doc, a, mode);
    }
    expect(failures).toEqual([]);
  });
});

function writeOverlay(doc: SynthDoc, d: ReturnType<typeof paginateDebug>, mode: string) {
  const scale = 0.25;
  const w = Math.round(doc.width * scale);
  const h = Math.round(doc.height * scale);
  const full = createCanvas(doc.width, doc.height);
  full.getContext('2d').putImageData(new SkImageData(doc.rgba, doc.width, doc.height), 0, 0);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(full, 0, 0, w, h);
  drawDebugOverlay(ctx, d, w, scale);
  writeFileSync(new URL(`${doc.name}-${mode}.png`, OUT), c.toBuffer('image/png'));
  writeFileSync(new URL(`${doc.name}-${mode}.json`, OUT), debugJson(d));
  // Full-resolution strips around each break, with the cut drawn as a 1 px line.
  d.slices.slice(0, -1).forEach((sl, i) => {
    const top = Math.max(0, Math.round(sl.y1) - 60);
    const strip = createCanvas(doc.width, 120);
    const sctx = strip.getContext('2d');
    sctx.drawImage(full, 0, top, doc.width, 120, 0, 0, doc.width, 120);
    sctx.fillStyle = 'rgba(217, 48, 37, 0.9)';
    sctx.fillRect(0, sl.y1 - top, 40, 1);
    sctx.fillRect(doc.width - 40, sl.y1 - top, 40, 1);
    writeFileSync(
      new URL(`${doc.name}-${mode}-break${i + 1}.png`, OUT),
      strip.toBuffer('image/png'),
    );
  });
}
