import { describe, expect, it } from 'vitest';
import { detectSheets, SheetAnalyzer } from '../src/sheets.js';

/**
 * Document page detection across combinations (user: "every combination and edge case").
 * Each case is a synthetic viewer: pages of text on a background, varied along every axis
 * at once, and the detected pages must match the truth within 2 px (y) and 3 px (x).
 */
interface Case {
  bg: number;
  paper: 'white' | 'scan' | 'slide';
  gap: number;
  shadow: number;
  border: boolean;
  cut: boolean;
  band: 'none' | 'top' | 'mid';
  list: boolean;
}

const W = 420;
const SX0 = 80;
const SX1 = 340;
const PAGE = 360;
const N = 5;

function render(c: Case) {
  const paperGrey = c.paper === 'white' ? 255 : c.paper === 'scan' ? 238 : 45;
  const noise = c.paper === 'scan' ? 8 : 0;
  const ink = c.paper === 'slide' ? 230 : 30;
  const full = c.gap + N * (PAGE + c.gap);
  const cutTop = c.cut ? c.gap + 150 : 0; // capture starts inside page 1
  const cutBottom = c.cut ? 140 : 0; // and ends inside the last page
  const H = full - cutTop - cutBottom;
  const data = new Uint8Array(W * H).fill(c.bg);
  let seed = 11;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const set = (x: number, yFull: number, v: number) => {
    const y = yFull - cutTop;
    if (y >= 0 && y < H && x >= 0 && x < W) data[y * W + x] = v;
  };
  if (c.list)
    for (let y = 0; y < full; y++)
      for (let x = 250; x < W; x++)
        if (y % 36 < 9 && x % 5 < 3) set(x, y, Math.min(255, c.bg + 60));
  const truth: Array<{ y0: number; y1: number }> = [];
  for (let i = 0; i < N; i++) {
    const y0 = c.gap + i * (PAGE + c.gap);
    // Shadow: a soft darker (or lighter, on dark viewers) halo around the page.
    for (let s = c.shadow; s >= 1; s--) {
      const v = c.bg > 100 ? c.bg - 4 * (c.shadow - s + 1) : c.bg + 3 * (c.shadow - s + 1);
      for (let y = y0 - s; y < y0 + PAGE + s; y++) {
        set(SX0 - s, y, v);
        set(SX1 - 1 + s, y, v);
      }
      for (let x = SX0 - s; x < SX1 + s; x++) {
        set(x, y0 - s, v);
        set(x, y0 + PAGE - 1 + s, v);
      }
    }
    for (let y = y0; y < y0 + PAGE; y++) {
      const ry = y - y0;
      for (let x = SX0; x < SX1; x++) {
        let v = paperGrey - Math.round(rand() * noise);
        if (c.border && (x === SX0 || x === SX1 - 1 || ry === 0 || ry === PAGE - 1)) v = 160;
        if (ry > 40 && ry < PAGE - 40 && ry % 18 < 8 && x > SX0 + 24 && x < SX1 - 24 && x % 6 < 4)
          v = ink;
        const inBand =
          (c.band === 'top' && i === 2 && ry < 70) ||
          (c.band === 'mid' && i === 2 && ry >= 150 && ry < 230);
        if (inBand) v = c.bg;
        set(x, y, v);
      }
    }
    const a = Math.max(0, y0 - cutTop);
    const b = Math.min(H, y0 + PAGE - cutTop);
    if (b - a >= 120) truth.push({ y0: a, y1: b });
  }
  const an = new SheetAnalyzer(W);
  for (let y = 0; y < H; y += 300) {
    const h = Math.min(300, H - y);
    an.push({ width: W, height: h, data: data.subarray(y * W, (y + h) * W) });
  }
  return { profile: an.finish(), truth };
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const bg of [40, 128, 230, 248])
    for (const paper of ['white', 'scan', 'slide'] as const)
      for (const gap of [6, 16, 40])
        for (const shadow of [0, 5])
          for (const border of [false, true])
            for (const cut of [false, true])
              for (const band of ['none', 'top', 'mid'] as const)
                for (const list of [false, true]) {
                  const p = paper === 'white' ? 255 : paper === 'scan' ? 234 : 45;
                  const tol = Math.min(12, Math.abs(255 - bg) / 2 + 1, bg / 2 + 1);
                  // Paper the same grey as the viewer can't be told apart by anyone.
                  if (Math.abs(p - bg) <= tol + 8) continue;
                  // A shadow whose darkest ring is the paper's own grey (scan on a near-white
                  // viewer) can't be told from paper by grey alone; by eye it is a blur.
                  if (shadow && paper === 'scan' && bg > 200) continue;
                  out.push({ bg, paper, gap, shadow, border, cut, band, list });
                }
  return out;
}

describe('document pages across combinations', () => {
  it('finds every page, to the pixel, in all distinguishable combinations', () => {
    const all = cases();
    const fails: string[] = [];
    for (const c of all) {
      const { profile, truth } = render(c);
      const got = detectSheets(profile);
      const ok =
        !!got &&
        got.sheets.length === truth.length &&
        got.sheets.every(
          (s, i) => Math.abs(s.y0 - truth[i]!.y0) <= 2 && Math.abs(s.y1 - truth[i]!.y1) <= 2,
        ) &&
        Math.abs(got.x0 - SX0) <= 3 &&
        Math.abs(got.x1 - SX1) <= 3;
      if (!ok)
        fails.push(
          `${JSON.stringify(c)} → ${got ? `${got.sheets.length} pages x ${got.x0}-${got.x1} ${JSON.stringify(got.sheets.slice(0, 3))}` : 'none'} want ${truth.length} ${JSON.stringify(truth.slice(0, 3))}`,
        );
    }
    if (fails.length) console.log(`${fails.length}/${all.length} failed\n` + fails.join('\n'));
    expect(fails.length).toBe(0);
    // 1,224 renders: seconds alone, longer when the machine is busy.
  }, 60_000);
});
