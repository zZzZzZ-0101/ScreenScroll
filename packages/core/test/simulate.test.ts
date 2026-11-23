import { writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  blockedReason,
  BlockPrinter,
  bounds,
  gridOf,
  gridSheets,
  hitTest,
  matchRect,
  moveBy,
  narrowWindowTo,
  paintBounds,
  registerFrames,
  textBlocks,
  type Annotation,
  type FilterId,
  blocksToDocx,
  buildFilename,
  cnIdValid,
  commit,
  computeLayout,
  crc32,
  DEFAULT_PAGE_SETTINGS,
  detectSheets,
  diffPictures,
  diffSeq,
  diffText,
  emptyHints,
  emptyHistory,
  fillTemplate,
  findPageNumbers,
  findRunningLines,
  findSensitive,
  hexToRgb,
  luhn,
  mergeIntervals,
  MutationLog,
  nextStep,
  normalizeRegion,
  paginate,
  pageNumberAnnotations,
  Pacer,
  parsePageList,
  redo,
  sanitizeFilename,
  SheetAnalyzer,
  undo,
  zipStore,
  type DomHints,
  type LoopState,
  type NextStep,
  type PageSlice,
  type PaginateInput,
  type StyleLike,
  type TextBlock,
  type TextRun,
} from '../src/index.js';

/**
 * Simulations (user, 2026-11-23: "perform at least 100000+ more simulations and edge
 * tests"): seeded random inputs for every pure module, each checked against invariants
 * that must hold for any input, or against a simple reference implementation. CI runs
 * the base counts, about 160,000 cases in under half a minute; `SIM_SCALE=5` runs five
 * times as many and `SIM_SEED=…` picks other inputs. A failure prints its seed and case number, so it reproduces.
 */
const SCALE = Math.max(0.01, Number(process.env.SIM_SCALE ?? 1));
const N = (base: number) => Math.max(1, Math.round(base * SCALE));
const SEED = Number(process.env.SIM_SEED ?? 20261123);
let total = 0;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const r = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
  return Object.assign(r, {
    int: (a: number, b: number) => a + Math.floor(r() * (b - a + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!,
    chance: (p: number) => r() < p,
  });
}
type Rng = ReturnType<typeof rng>;

/** Runs `n` cases; collects the first failures with their case number. */
function simulate(name: string, n: number, body: (r: Rng, i: number) => string | null | void) {
  const r = rng(SEED ^ hash(name));
  const fails: string[] = [];
  for (let i = 0; i < n; i++) {
    let msg: string | null | void;
    try {
      msg = body(r, i);
    } catch (e) {
      msg = `threw ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    }
    if (msg) fails.push(`${name} #${i} (seed ${SEED}): ${msg}`);
    if (fails.length >= 5) break;
  }
  total += n;
  expect(fails).toEqual([]);
}

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ─── Pagination (PAGINATION §8) ─────────────────────────────────────────────────────

function randomDoc(r: Rng): PaginateInput {
  const H = r.chance(0.05) ? r() * 60 : r() * 30_000;
  const T = r.chance(0.05) ? 20 + r() * 40 : 150 + r() * 1800;
  const hints: DomHints = emptyHints();
  let y = r() * 60;
  const lh = 10 + r() * 40;
  while (y < H) {
    const roll = r();
    if (roll < 0.7) {
      const h = lh * (r.chance(0.1) ? 2 + r.int(0, 3) : 1);
      hints.forbidden.push({ y0: y, y1: Math.min(H, y + h), kind: 'line' });
      y += h + (r.chance(0.2) ? lh : r() * 4);
    } else if (roll < 0.85) {
      const h = r.chance(0.25) ? T * (1 + r() * 3) : r() * T * 0.7;
      hints.forbidden.push({ y0: y, y1: Math.min(H, y + h), kind: r.pick(['image', 'atomic']) });
      y += h + r() * 12;
    } else if (roll < 0.95) {
      hints.blockEnds.push({ y, kind: r.pick(['paragraph', 'section', 'listItem', 'tableRow']) });
      y += 4 + r() * 20;
    } else {
      // Overlapping and touching boxes, as real layouts produce.
      const h = r() * lh * 3;
      hints.forbidden.push({ y0: Math.max(0, y - r() * lh), y1: Math.min(H, y + h), kind: 'line' });
      y += r() * h;
    }
  }
  const input: PaginateInput = { height: H, width: 200 + r() * 1800, T, hints };
  if (r.chance(0.3)) {
    const x0 = r() * input.width * 0.4;
    input.crop = { x0, x1: x0 + 1 + r() * (input.width - x0 - 1) };
  }
  if (r.chance(0.3)) {
    const a = r() * H;
    const b = r() * H;
    input.range = r.chance(0.1) ? { y0: b, y1: a } : { y0: Math.min(a, b), y1: Math.max(a, b) };
  }
  if (r.chance(0.3))
    input.options = {
      pinned: Array.from({ length: r.int(0, 6) }, () =>
        r.chance(0.05) ? r.pick([Number.NaN, Infinity, -Infinity]) : r() * H * 1.2 - H * 0.1,
      ),
      removed: Array.from({ length: r.int(0, 6) }, () => r() * H),
    };
  return input;
}

function paginationErrors(input: PaginateInput, slices: PageSlice[]): string | null {
  const H = input.height;
  const start = Math.max(0, Math.min(H, input.range?.y0 ?? 0));
  const end = Math.max(start, Math.min(H, input.range?.y1 ?? H));
  if (!(H > 0)) return slices.length ? 'slices for an empty capture' : null;
  if (!slices.length) return 'no slices';
  if (Math.abs(slices[0]!.y0 - start) > 1e-6) return `starts at ${slices[0]!.y0}, not ${start}`;
  if (Math.abs(slices.at(-1)!.y1 - end) > 1e-6) return `ends at ${slices.at(-1)!.y1}, not ${end}`;
  for (const [i, s] of slices.entries()) {
    const own = s.y1 - s.y0 - s.overlapTop;
    if (!(s.y1 >= s.y0) || !Number.isFinite(s.y0) || !Number.isFinite(s.y1))
      return `slice ${i} inverted or not finite`;
    if (own > input.T + 1e-6) return `slice ${i} holds ${own} > T ${input.T}`;
    if (i > 0 && Math.abs(s.y0 + s.overlapTop - slices[i - 1]!.y1) > 1e-6)
      return `slice ${i} does not continue slice ${i - 1}`;
    if (s.overlapTop > 0 && slices[i - 1]?.breakKind !== 'forced')
      return `slice ${i} repeats content without a forced cut`;
    if (s.breakKind === 'forced' && !s.warnings.length) return `forced cut ${i} without warning`;
    if (i < slices.length - 1 && s.breakKind !== 'forced' && s.breakKind !== 'manual')
      for (const f of input.hints?.forbidden ?? [])
        if (f.kind === 'line' && s.y1 > f.y0 + 1e-6 && s.y1 < f.y1 - 1e-6)
          return `break ${i} at ${s.y1} cuts line ${f.y0}–${f.y1}`;
    if (s.x0 !== (input.crop?.x0 ?? 0) || s.x1 !== (input.crop?.x1 ?? input.width))
      return `slice ${i} has the wrong crop`;
  }
  return null;
}

describe('simulations', { timeout: Math.max(30_000, 120_000 * SCALE) }, () => {
  it('pagination: never cuts a line, never overfills, covers the range, deterministic', () => {
    simulate('paginate', N(1000), (r) => {
      const input = randomDoc(r);
      let slices: PageSlice[];
      try {
        slices = paginate(input);
      } catch (e) {
        // SIM_DUMP=file.json keeps the failing input, to turn it into a unit test.
        if (process.env.SIM_DUMP) writeFileSync(process.env.SIM_DUMP, JSON.stringify(input));
        throw e;
      }
      const err = paginationErrors(input, slices);
      if (err) return `H=${input.height.toFixed(1)} T=${input.T.toFixed(1)}: ${err}`;
      if (r.chance(0.2) && JSON.stringify(paginate(input)) !== JSON.stringify(slices))
        return 'not deterministic';
      return null;
    });
  });

  // ─── Capture loop (CAPTURE §5, §9) ──────────────────────────────────────────────────

  it('capture plan: every row kept once the loop says done; every other stop warns', () => {
    simulate('capture-plan', N(4000), (r) => {
      const view = r.int(40, 2000);
      const h0 = r.chance(0.1) ? r.int(0, view) : r.int(0, 60_000);
      const grow = r.chance(0.2) ? r.int(1, 2000) : 0;
      const growFor = r.int(0, 30);
      const limits = {
        maxScreens: r.int(1, 400),
        maxHeight: r.chance(0.2) ? r.int(1, 20_000) : 200_000,
      };
      const reserve = r.chance(0.5)
        ? { top: r.int(0, Math.floor(view / 2)), bottom: r.int(0, Math.floor(view / 2)) }
        : undefined;
      const start = r.chance(0.2) ? r.int(0, Math.max(0, h0 - 1)) : 0;
      let s: LoopState = {
        viewportHeight: view,
        scrollHeight: h0,
        initialScrollHeight: h0,
        coveredTo: null,
        framesTaken: 0,
        start,
      };
      const frames: Array<Extract<NextStep, { kind: 'scroll' }>> = [];
      for (let k = 0; ; k++) {
        if (k > limits.maxScreens + 5) return `did not stop after ${k} steps`;
        const step = nextStep(s, limits, reserve);
        if (step.kind === 'stop') {
          if (step.reason !== 'done')
            return step.warning ? null : `stop ${step.reason} without warning`;
          // Done: every row from start to the end is in some frame's kept band.
          const bands = frames
            .map((f) => [f.y + f.keep.top, f.y + f.keep.bottom] as const)
            .sort((a, b) => a[0] - b[0]);
          let at = start;
          for (const [a, b] of bands) {
            if (a > at + 1e-6) return `rows ${at}–${a} never kept`;
            at = Math.max(at, b);
          }
          if (at < s.scrollHeight - 0.5) return `kept up to ${at} of ${s.scrollHeight}`;
          return null;
        }
        const maxScroll = Math.max(0, s.scrollHeight - view);
        if (step.y < -1e-6 || step.y > maxScroll + 1e-6)
          return `scrolls to ${step.y} of 0–${maxScroll}`;
        if (step.keep.top < 0 || step.keep.bottom > view || step.keep.top >= step.keep.bottom)
          return `keeps ${step.keep.top}–${step.keep.bottom} of a ${view} px box`;
        frames.push(step);
        s = {
          ...s,
          coveredTo: Math.max(s.coveredTo ?? 0, step.y + step.keep.bottom),
          framesTaken: s.framesTaken + 1,
          scrollHeight: s.scrollHeight + (s.framesTaken < growFor ? grow : 0),
        };
      }
    });
  });

  // ─── Text and picture diffs (M8 "what changed") ───────────────────────────────────

  it('diffSeq: replays both sides and is as short as the longest common subsequence', () => {
    simulate('diffSeq', N(8000), (r) => {
      const k = r.int(1, 6);
      const a = Array.from({ length: r.int(0, 30) }, () => r.int(0, k));
      const b = r.chance(0.3)
        ? a.map((x) => (r.chance(0.2) ? r.int(0, k) : x)).filter(() => !r.chance(0.1))
        : Array.from({ length: r.int(0, 30) }, () => r.int(0, k));
      const ops = diffSeq(a, b);
      const left = ops.flatMap((o) => (o.kind === 'add' ? [] : [o.a]));
      const right = ops.flatMap((o) => (o.kind === 'del' ? [] : [o.b]));
      if (left.join() !== a.join() || right.join() !== b.join()) return 'does not replay';
      if (ops.some((o) => o.kind === 'same' && o.a !== o.b)) return 'unequal "same"';
      const same = ops.filter((o) => o.kind === 'same').length;
      const best = lcs(a, b);
      return same === best ? null : `${same} kept, LCS is ${best}`;
    });
  });

  it('diffText: identical texts are unchanged; every word of both sides is accounted for', () => {
    const words = ['price', '10', '12', 'note', 'the', 'a', 'total', '合计', '价格', 'x'];
    simulate('diffText', N(3000), (r) => {
      const para = () => Array.from({ length: r.int(1, 8) }, () => r.pick(words)).join(' ');
      const before = Array.from({ length: r.int(0, 6) }, para);
      const after = before.map((p) => (r.chance(0.2) ? para() : p)).filter(() => !r.chance(0.15));
      if (r.chance(0.3)) after.splice(r.int(0, after.length), 0, para());
      const A = before.join('\n\n');
      const B = after.join('\n\n');
      const out = diffText(A, B);
      if (A === B && out.some((c) => c.kind !== 'same')) return 'changes in identical texts';
      const side = (keep: 'add' | 'del') =>
        out
          .flatMap((c) =>
            c.kind === 'edit'
              ? c.words.filter((w) => w.kind !== keep).map((w) => w.text)
              : c.kind === keep
                ? []
                : c.text.split(/\s+/),
          )
          .filter(Boolean)
          .join(' ');
      const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
      if (side('add') !== norm(A)) return `older side: ${side('add')} ≠ ${norm(A)}`;
      if (side('del') !== norm(B)) return `newer side: ${side('del')} ≠ ${norm(B)}`;
      return null;
    });
  });

  it('picture diff: moved content matches; a changed block is found; chunking never matters', () => {
    simulate('picdiff', N(600), (r) => {
      const width = r.int(60, 480);
      const blocks = Array.from({ length: r.int(1, 12) }, () => ({
        h: r.int(1, 140),
        seed: r.int(1, 1e9),
        x0: r.int(0, Math.floor(width / 2)),
        dark: r.int(0, 120),
      }));
      const bg = r.pick([255, 250, 240, 20, 35]);
      const render = (gaps: number[], changed = -1) => {
        const rows: Uint8Array[] = [];
        const blank = () => new Uint8Array(width).fill(bg);
        for (let g = 0; g < gaps[0]!; g++) rows.push(blank());
        blocks.forEach((b, i) => {
          const pr = rng(i === changed ? b.seed + 1 : b.seed);
          const ink = bg > 128 ? b.dark : 255 - b.dark;
          for (let y = 0; y < b.h; y++) {
            const row = blank();
            for (let x = b.x0; x < width; x++) if (pr() < 0.4) row[x] = ink;
            rows.push(row);
          }
          for (let g = 0; g < gaps[i + 1]!; g++) rows.push(blank());
        });
        const data = new Uint8Array(rows.length * width);
        rows.forEach((row, y) => data.set(row, y * width));
        return { data, height: rows.length };
      };
      const print = (img: { data: Uint8Array; height: number }, chunk: number) => {
        const p = new BlockPrinter(width);
        for (let y = 0; y < img.height; y += chunk) {
          const h = Math.min(chunk, img.height - y);
          p.push({ width, height: h, data: img.data.subarray(y * width, (y + h) * width) });
        }
        return p.finish();
      };
      const gaps = () => Array.from({ length: blocks.length + 1 }, () => r.int(1, 60));
      const a = render(gaps());
      const one = print(a, a.height || 1);
      const chunked = print(a, r.int(1, 300));
      if (JSON.stringify(one) !== JSON.stringify(chunked)) return 'blocks depend on chunk size';
      const moved = print(render(gaps()), r.int(1, 300));
      const d = diffPictures(one, moved);
      if (d.length) return `moved content reported as ${d.length} change(s)`;
      const target = r.int(0, blocks.length - 1);
      const changed = print(render(gaps(), target), r.int(1, 300));
      if (!diffPictures(one, changed).length) return `changed block ${target} not found`;
      return null;
    });
  });

  // ─── Page numbers and running lines (M8 exam / handout) ───────────────────────────

  it('page numbers: real numbering is found with its first number; scattered numbers are not', () => {
    const formats = [
      (n: number, t: number) => `Page ${n} of ${t}`,
      (n: number, t: number) => `${n} / ${t}`,
      (n: number) => `Page ${n}`,
      (n: number) => `${n}`,
      (n: number) => `- ${n} -`,
      (n: number, t: number) => `第 ${n} 页 共 ${t} 页`,
      (n: number) => `p. ${n}`,
    ];
    simulate('pagenumbers', N(6000), (r) => {
      const count = r.int(2, 40);
      const h = r.int(300, 1400);
      const gap = r.int(0, 40);
      const sheets = Array.from({ length: count }, (_, i) => ({
        x0: 50,
        x1: 850,
        y0: 10 + i * (h + gap),
        y1: 10 + i * (h + gap) + h,
      }));
      const first = r.int(1, 500);
      const totalPages = first + count - 1 + r.int(0, 50);
      const fmt = r.pick(formats);
      const top = r.chance(0.3);
      const missing = new Set<number>();
      const maxMissing = count - Math.max(2, Math.ceil(count * 0.6));
      while (missing.size < r.int(0, Math.max(0, maxMissing))) missing.add(r.int(0, count - 1));
      const runs: TextRun[] = [];
      sheets.forEach((s, i) => {
        // Body text, including numbers, and a few figures in the band that aren't numbering.
        for (let k = 0; k < 4; k++)
          runs.push(
            run(
              `Line ${r.int(1, 99)} of the text ${r.int(1, 9)}`,
              100,
              s.y0 + h * (0.2 + k * 0.15),
            ),
          );
        if (missing.has(i)) return;
        const y = top ? s.y0 + h * 0.04 : s.y1 - h * 0.06;
        runs.push(run(fmt(first + i, totalPages), r.int(100, 700), y));
      });
      const found = findPageNumbers(sheets, runs);
      if (!found)
        return `numbering ${fmt(first, totalPages)} on ${count - missing.size}/${count} pages not found`;
      if (found.first !== first) return `first ${found.first}, want ${first}`;
      if (found.marks.length !== count - missing.size) return `${found.marks.length} marks`;
      // Renumbering keeps the wording and counts from 1.
      const anns = pageNumberAnnotations(found, { renumber: true }, count);
      const texts = anns
        .filter((a) => a.kind === 'text')
        .map((a) => (a.kind === 'text' ? a.text : ''));
      const firstMark = found.marks[0]!;
      const want = fmt(firstMark.sheet + 1, count).replace(/\s+/g, ' ');
      if (fmt === formats[0] || fmt === formats[1] || fmt === formats[5])
        if (texts[0] !== want) return `renumbered as "${texts[0]}", want "${want}"`;
      // Noise: the same bands with numbers that don't count up are not numbering.
      const noise = sheets.map((s) => run(`${r.int(1, 9999)}`, 400, s.y1 - h * 0.06));
      const sorted = noise.map((n) => Number(n.text));
      let consecutive = 0;
      for (let i = 1; i < sorted.length; i++) if (sorted[i]! - sorted[i - 1]! === 1) consecutive++;
      if (consecutive < 2 && findPageNumbers(sheets, noise))
        return 'random numbers taken as numbering';
      return null;
    });
  });

  it('running lines: a repeated header is found on most pages; one-off lines are not', () => {
    simulate('running-lines', N(4000), (r) => {
      const count = r.int(2, 30);
      const h = r.int(300, 1200);
      const sheets = Array.from({ length: count }, (_, i) => ({
        x0: 0,
        x1: 800,
        y0: i * (h + 20),
        y1: i * (h + 20) + h,
      }));
      const header = `Course notes ${r.pick(['A', 'B', 'Internal', '内部资料'])} · ${r.pick(['draft', 'final'])}`;
      const need = Math.max(2, Math.ceil(count * 0.6));
      const on = new Set<number>();
      const want = r.int(need, count);
      while (on.size < want) on.add(r.int(0, count - 1));
      const runs: TextRun[] = [];
      sheets.forEach((s, i) => {
        if (on.has(i)) runs.push(run(header, 300, s.y0 + h * 0.03 + r() * 4));
        runs.push(run(`Chapter ${i + 1}`, 300, s.y0 + h * 0.05));
        runs.push(run(`Unique line ${i} ${r.int(0, 1e6)}`, 300, s.y1 - h * 0.05));
        runs.push(run('Body text here', 300, s.y0 + h / 2));
      });
      const lines = findRunningLines(sheets, runs);
      const got = lines.find((l) => l.text === header);
      if (!got) return `header on ${on.size}/${count} pages not found`;
      if (got.marks.length !== on.size) return `${got.marks.length} marks for ${on.size} pages`;
      if (lines.some((l) => /^(Chapter|Unique|Body)/.test(l.text)))
        return `wrong line: ${lines.map((l) => l.text).join(' | ')}`;
      return null;
    });
  });

  // ─── Document pages (sheets) ──────────────────────────────────────────────────────

  it('document pages: synthetic viewers of any size, gap and shade are found to the pixel', () => {
    simulate('sheets', N(250), (r) => {
      const W = r.int(200, 640);
      const sx0 = r.int(10, Math.floor(W * 0.3));
      const sx1 = W - r.int(10, Math.floor(W * 0.3));
      const page = r.int(160, 520);
      const gap = r.int(6, 60);
      const count = r.int(2, 7);
      const bg = r.pick([40, 70, 128, 200, 230]);
      const paper = r.pick([255, 245]);
      if (Math.abs(paper - bg) < 30) return null;
      const H = gap + count * (page + gap);
      const data = new Uint8Array(W * H).fill(bg);
      const pr = rng(r.int(1, 1e9));
      for (let i = 0; i < count; i++) {
        const y0 = gap + i * (page + gap);
        for (let y = y0; y < y0 + page; y++) {
          const ry = y - y0;
          for (let x = sx0; x < sx1; x++) {
            let v = paper;
            if (
              ry > 30 &&
              ry < page - 30 &&
              ry % 18 < 8 &&
              x > sx0 + 16 &&
              x < sx1 - 16 &&
              pr() < 0.6
            )
              v = 30;
            data[y * W + x] = v;
          }
        }
      }
      const an = new SheetAnalyzer(W);
      const chunk = r.int(50, 600);
      for (let y = 0; y < H; y += chunk) {
        const h = Math.min(chunk, H - y);
        an.push({ width: W, height: h, data: data.subarray(y * W, (y + h) * W) });
      }
      const got = detectSheets(an.finish());
      if (!got) return `none found (W ${W}, page ${page}, gap ${gap}, bg ${bg})`;
      if (got.sheets.length !== count) return `${got.sheets.length} pages, want ${count}`;
      for (const [i, s] of got.sheets.entries()) {
        const y0 = gap + i * (page + gap);
        if (Math.abs(s.y0 - y0) > 2 || Math.abs(s.y1 - (y0 + page)) > 2)
          return `page ${i} at ${s.y0}–${s.y1}, want ${y0}–${y0 + page} (gap ${gap}, bg ${bg})`;
      }
      if (Math.abs(got.x0 - sx0) > 3 || Math.abs(got.x1 - sx1) > 3)
        return `x ${got.x0}–${got.x1}, want ${sx0}–${sx1}`;
      return null;
    });
  });

  // ─── File names, page lists, templates ────────────────────────────────────────────

  it('file names: always safe, short, visible, not reserved, and stable', () => {
    const pool = [
      'a',
      'Z',
      ' ',
      '.',
      '..',
      '/',
      '\\',
      ':',
      '*',
      '?',
      '"',
      '<',
      '>',
      '|',
      '\u0000',
      '\u001f',
      '\u007f',
      '​',
      '‎',
      '‮',
      '﻿',
      '­',
      '\t',
      '\n',
      '中',
      '文',
      '😀',
      '👩‍👩‍👧',
      'é',
      'CON',
      'nul',
      'COM1',
      'lpt9',
      '.txt',
      'x'.repeat(40),
      '\ud800',
      '\udc00',
    ];
    // eslint-disable-next-line no-control-regex -- control characters are exactly the target
    const forbidden = /[<>:"/\\|?*\u0000-\u001f\u007f]|\p{Cf}/u;
    simulate('filename', N(20000), (r) => {
      const name = Array.from({ length: r.int(0, 30) }, () => r.pick(pool)).join('');
      const out = sanitizeFilename(name);
      if (!out) return 'empty';
      if (forbidden.test(out)) return `forbidden character in ${JSON.stringify(out)}`;
      if (/^[. ]|[. ]$/.test(out)) return `leading or trailing dot/space: ${JSON.stringify(out)}`;
      if (Array.from(out).length > 150) return `${Array.from(out).length} characters`;
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(out)) return `reserved: ${out}`;
      if (sanitizeFilename(out) !== out) return `not stable: ${JSON.stringify(out)}`;
      const file = buildFilename(
        r.pick(['{title}', '{domain}_{date}', '{title} {time}', '', '{nope}', '../{title}']),
        {
          title: name,
          url: r.pick(['https://例子.cn/a', 'about:blank', 'not a url', '']),
          date: new Date(r.int(0, 4e12)),
        },
        r.pick(['pdf', 'png', 'zip']),
      );
      if (!/\.(pdf|png|zip)$/.test(file)) return `no extension: ${file}`;
      if (forbidden.test(file.replace(/\.(pdf|png|zip)$/, '')))
        return `unsafe file ${JSON.stringify(file)}`;
      return null;
    });
  });

  it('page lists ("1-3, 5, 8-"): exactly the pages written, sorted, in range', () => {
    simulate('page-list', N(10000), (r) => {
      const max = r.int(0, 60);
      const want = new Set<number>();
      const parts: string[] = [];
      for (let k = r.int(0, 6); k > 0; k--) {
        const a = r.int(0, 70);
        const b = r.int(0, 70);
        switch (r.int(0, 4)) {
          case 0:
            parts.push(String(a));
            if (a >= 1 && a <= max) want.add(a);
            break;
          case 1:
            parts.push(`${a}${r.pick(['-', '–', '~', ' - '])}${b}`);
            for (let p = Math.max(1, Math.min(a, b)); p <= Math.min(max, Math.max(a, b)); p++)
              want.add(p);
            break;
          case 2:
            parts.push(`${a}-`);
            for (let p = Math.max(1, Math.min(a, max)); p <= max; p++) if (a <= max) want.add(p);
            break;
          case 3:
            parts.push(`-${b}`);
            for (let p = 1; p <= Math.min(max, b); p++) want.add(p);
            break;
          default:
            parts.push(r.pick(['x', '1.5', 'a-b', '--', '', '页']));
        }
      }
      const text = parts.join(r.pick([',', ', ', '，', ';', '、', ' , ']));
      const got = parsePageList(text, max);
      const exp = [...want].sort((x, y) => x - y);
      return got.join() === exp.join()
        ? null
        : `"${text}" (max ${max}) → ${got.join()} want ${exp.join()}`;
    });
  });

  it('templates and colours never throw and fill what they know', () => {
    simulate('templates', N(5000), (r) => {
      const tokens = [
        '{page}',
        '{pages}',
        '{title}',
        '{date}',
        '{time}',
        '{domain}',
        '{url}',
        '{x}',
        '{',
        '}',
        'text ',
      ];
      const tpl = Array.from({ length: r.int(0, 8) }, () => r.pick(tokens)).join('');
      const out = fillTemplate(tpl, {
        page: r.int(1, 999),
        pages: 9,
        title: 'T',
        date: 'D',
        time: 't',
        domain: 'd',
        url: 'u',
      });
      if (out.includes('{page}')) return `unfilled: ${out}`;
      const c = hexToRgb(
        r.pick(['#fff', '#123456', 'abcdef', '#GGGGGG', '', ' #00ff00 ', '#1234567']),
      );
      if (c.some((v) => !(v >= 0 && v <= 1))) return `colour ${c}`;
      return null;
    });
  });

  // ─── Outputs: zip and Word ────────────────────────────────────────────────────────

  it('zip: every entry reads back byte for byte; crc32 matches the reference', () => {
    simulate('zip', N(2500), (r) => {
      const names = new Set<string>();
      const entries = Array.from({ length: r.int(1, 8) }, () => {
        let name: string;
        do
          name = `${r.pick(['page', '页', 'a b', 'x'])}-${r.int(0, 1e6)}.${r.pick(['png', 'txt'])}`;
        while (names.has(name));
        names.add(name);
        const bytes = new Uint8Array(r.chance(0.1) ? 0 : r.int(1, 3000));
        for (let i = 0; i < bytes.length; i++) bytes[i] = r.int(0, 255);
        return { name, data: bytes };
      });
      for (const e of entries)
        if (crc32(e.data) !== crcRef(e.data)) return `crc32 of ${e.data.length} bytes`;
      const back = unzipSync(zipStore(entries));
      for (const e of entries) {
        const got = back[e.name];
        if (!got) return `missing ${e.name}`;
        if (got.length !== e.data.length || got.some((v, i) => v !== e.data[i]))
          return `bytes of ${e.name}`;
      }
      return Object.keys(back).length === entries.length ? null : 'extra entries';
    });
  });

  it('Word: any text, including control characters and markup, gives well-formed XML', () => {
    const pool = [
      'a',
      ' ',
      '<',
      '>',
      '&',
      '"',
      "'",
      '\u0000',
      '\u0008',
      '\u000b',
      '\u001f',
      '中',
      '😀',
      ']]>',
      '\t',
      '￾',
      '\ud800',
    ];
    simulate('docx', N(1500), (r) => {
      const text = () => Array.from({ length: r.int(0, 20) }, () => r.pick(pool)).join('');
      const blocks: TextBlock[] = Array.from({ length: r.int(0, 10) }, () => {
        const k = r.int(0, 3);
        return k === 0
          ? { kind: 'heading', level: r.int(1, 6), text: text() }
          : k === 1
            ? { kind: 'paragraph', text: text() }
            : k === 2
              ? { kind: 'item', text: text() }
              : { kind: 'pageBreak' };
      });
      const files = unzipSync(blocksToDocx(blocks, text()));
      for (const [name, bytes] of Object.entries(files)) {
        if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
        const xml = new TextDecoder().decode(bytes);
        const err = xmlError(xml);
        if (err) return `${name}: ${err}`;
      }
      return null;
    });
  });

  // ─── Personal data ────────────────────────────────────────────────────────────────

  it('personal data: valid card and ID numbers are found; one wrong digit is not', () => {
    simulate('sensitive', N(8000), (r) => {
      const len = r.pick([13, 15, 16, 16, 16, 19]);
      const digits = Array.from({ length: len - 1 }, () => r.int(0, 9));
      digits[0] = r.int(3, 6);
      const card = digits.join('') + luhnDigit(digits.join(''));
      if (!luhn(card)) return `luhn rejects ${card}`;
      const shown = r.chance(0.5)
        ? card.replace(/(\d{4})(?=\d)/g, `$1${r.pick([' ', '-'])}`)
        : card;
      const found = findSensitive([{ text: `Paid with ${shown} today.` }]);
      if (!found.some((m) => m.kind === 'card' && m.text === shown))
        return `card ${shown} not found`;
      const bad = card.slice(0, -1) + ((Number(card.at(-1)) + r.int(1, 9)) % 10);
      if (findSensitive([{ text: `Ref ${bad} here` }]).some((m) => m.kind === 'card'))
        return `bad card ${bad} found`;
      const id = cnId(r);
      if (!cnIdValid(id)) return `valid ID ${id} rejected`;
      if (!findSensitive([{ text: `身份证 ${id}` }]).some((m) => m.kind === 'id'))
        return `ID ${id} not found`;
      const wrong = id.slice(0, 17) + (id[17] === '0' ? '1' : '0');
      if (cnIdValid(wrong) && wrong !== id) return `wrong check character accepted: ${wrong}`;
      return null;
    });
  });

  // ─── Undo, restore, pacing, layout, geometry ──────────────────────────────────────

  it('undo history behaves like a list with a cursor', () => {
    simulate('history', N(5000), (r) => {
      let h = emptyHistory<number>(0);
      let model = [0];
      let at = 0;
      let next = 1;
      for (let k = r.int(1, 60); k > 0; k--) {
        const op = r.int(0, 2);
        if (op === 0) {
          h = commit(h, next);
          model = [...model.slice(0, at + 1), next++];
          at++;
        } else if (op === 1) {
          h = undo(h);
          at = Math.max(0, at - 1);
        } else {
          h = redo(h);
          at = Math.min(model.length - 1, at + 1);
        }
        if (h.present !== model[at]) return `present ${h.present}, want ${model[at]}`;
        if (h.past.length !== at || h.future.length !== model.length - 1 - at) return 'stack sizes';
      }
      return null;
    });
  });

  it('mutation log: any sequence of changes is undone exactly, also after a partial undo', () => {
    simulate('mutation-log', N(5000), (r) => {
      const props = ['top', 'position', 'overflow', 'height', 'visibility'];
      const els = Array.from({ length: r.int(1, 4) }, () => fakeEl(r, props));
      const before = els.map((e) => e.dump());
      const log = new MutationLog();
      let mark = -1;
      let atMark: string[] = [];
      for (let k = r.int(0, 25); k > 0; k--) {
        if (mark < 0 && r.chance(0.1)) {
          mark = log.size;
          atMark = els.map((e) => e.dump());
        }
        const el = r.pick(els);
        // Arbitrary undo steps, as the capture logs them (on elements that have a style).
        if (el.hadStyle && r.chance(0.1)) {
          const prop = r.pick(props);
          const old = el.style.getPropertyValue(prop);
          const pri = el.style.getPropertyPriority(prop);
          el.style.setProperty(prop, 'recorded');
          log.record(() =>
            old ? el.style.setProperty(prop, old, pri) : el.style.removeProperty(prop),
          );
        } else log.setStyle(el, r.pick(props), `${r.int(0, 99)}px`, r.chance(0.7));
      }
      if (mark >= 0) {
        log.restoreSince(mark);
        const now = els.map((e) => e.dump());
        if (now.join('|') !== atMark.join('|')) return 'restoreSince did not return to the mark';
      }
      log.restore();
      const after = els.map((e) => e.dump());
      if (after.join('|') !== before.join('|'))
        return `not restored: ${after.join('|')} vs ${before.join('|')}`;
      if (els.some((e) => e.hadStyle === false && e.attr !== null))
        return 'left a style attribute behind';
      return log.restore().length ? 'second restore failed' : null;
    });
  });

  it('pacing: calls never start closer than the interval; quota errors retry, others do not', async () => {
    const n = N(1500);
    const r = rng(SEED ^ hash('pacer'));
    const fails: string[] = [];
    for (let i = 0; i < n && fails.length < 5; i++) {
      let now = r.int(0, 1e6);
      const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
      const opts = {
        minIntervalMs: r.int(0, 1000),
        backoffMs: r.int(0, 1000),
        maxRetries: r.int(0, 5),
      };
      const pacer = new Pacer(opts, clock);
      const starts: number[] = [];
      for (let k = r.int(1, 12); k > 0; k--) {
        now += r.chance(0.5) ? r.int(0, 2000) : 0;
        const quota = r.int(0, 7);
        const other = r.chance(0.1);
        let calls = 0;
        try {
          await pacer.run(async () => {
            starts.push(now);
            calls++;
            if (other) throw new Error('boom');
            if (calls <= quota) throw new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota');
            return 1;
          });
          if (other) fails.push(`#${i}: other error swallowed`);
          if (quota > opts.maxRetries) fails.push(`#${i}: succeeded past retries`);
        } catch (e) {
          const msg = (e as Error).message;
          if (!other && quota <= opts.maxRetries)
            fails.push(`#${i}: failed after ${calls} calls (${msg})`);
          if (other && calls !== 1) fails.push(`#${i}: retried a non-quota error`);
        }
      }
      for (let k = 1; k < starts.length; k++)
        if (starts[k]! - starts[k - 1]! < opts.minIntervalMs)
          fails.push(
            `#${i}: starts ${starts[k - 1]} and ${starts[k]} closer than ${opts.minIntervalMs}`,
          );
    }
    total += n;
    expect(fails.slice(0, 5)).toEqual([]);
  });

  it('page layout: any paper, margins and scale give a usable page or a plain error', () => {
    simulate('layout', N(10000), (r) => {
      const settings = {
        ...DEFAULT_PAGE_SETTINGS,
        paper: r.chance(0.2)
          ? { w: r.int(1, 1200), h: r.int(1, 1200) }
          : r.pick(['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'] as const),
        orientation: r.pick(['portrait', 'landscape'] as const),
        marginsMm: {
          top: r.int(0, 80),
          right: r.int(0, 80),
          bottom: r.int(0, 80),
          left: r.int(0, 80),
        },
        headerPt: r.int(0, 40),
        footerPt: r.int(0, 40),
        scale: r.chance(0.5) ? ('fit' as const) : r.int(1, 400),
      };
      const width = r.chance(0.05) ? r.pick([0, -5, 0.5]) : r.int(1, 20_000);
      try {
        const l = computeLayout(settings, width);
        const ok = [l.s, l.T, l.paperW, l.paperH, l.box.w, l.box.h].every(
          (v) => Number.isFinite(v) && v > 0,
        );
        if (!ok) return `bad layout ${JSON.stringify(l)}`;
        if (l.s * width > l.box.w + 1e-6) return 'content wider than the box';
        return null;
      } catch (e) {
        return /margin/i.test((e as Error).message)
          ? null
          : `unclear error: ${(e as Error).message}`;
      }
    });
  });

  it('geometry: drawn regions are ordered and inside the box; merged intervals are disjoint', () => {
    simulate('geometry', N(10000), (r) => {
      const w = r.int(0, 3000);
      const h = r.int(0, 3000);
      const p = () => ({ x: r.int(-500, 3500), y: r.int(-500, 3500) });
      const g = normalizeRegion(p(), p(), w, h);
      if (!(g.x0 <= g.x1 && g.y0 <= g.y1)) return `inverted ${JSON.stringify(g)} in ${w}×${h}`;
      if (g.x0 < 0 || g.y0 < 0 || g.x1 > w || g.y1 > h)
        return `outside ${JSON.stringify(g)} in ${w}×${h}`;
      const ivs = Array.from({ length: r.int(0, 12) }, () => {
        const a = r.int(0, 1000);
        return { y0: a, y1: a + r.int(0, 200) };
      });
      const m = mergeIntervals(ivs);
      for (let i = 1; i < m.length; i++)
        if (m[i]!.y0 <= m[i - 1]!.y1) return 'merged intervals overlap';
      for (const iv of ivs)
        if (!m.some((x) => x.y0 <= iv.y0 && x.y1 >= iv.y1)) return 'interval lost';
      return null;
    });
  });

  // ─── Second batch: marks, text out, redaction boxes, grids, frames, filters ───────

  it('marks: moving shifts the bounds exactly; a mark is hit on its own outline or area', () => {
    simulate('annotations', N(10000), (r) => {
      const style = { color: '#d93025', width: r.int(1, 12), fontSize: r.int(8, 60) };
      const x = r.int(-200, 3000);
      const y = r.int(-200, 30000);
      const w = r.int(0, 800);
      const h = r.int(0, 800);
      const kind = r.int(0, 5);
      const a: Annotation =
        kind === 0
          ? {
              id: 'a',
              kind: r.pick(['rect', 'ellipse', 'blur', 'pixelate', 'cover'] as const),
              style,
              x,
              y,
              w,
              h,
            }
          : kind === 1
            ? {
                id: 'a',
                kind: r.pick(['line', 'arrow'] as const),
                style,
                x1: x,
                y1: y,
                x2: x + w - 400,
                y2: y + h - 400,
              }
            : kind === 2
              ? {
                  id: 'a',
                  kind: r.pick(['pen', 'highlighter'] as const),
                  style,
                  points: Array.from(
                    { length: 2 * r.int(1, 30) },
                    (_, i) => (i % 2 ? y : x) + r.int(-300, 300),
                  ),
                }
              : kind === 3
                ? {
                    id: 'a',
                    kind: 'text',
                    style,
                    x,
                    y,
                    text: Array.from({ length: r.int(0, 3) }, () => 'line of text').join('\n'),
                  }
                : { id: 'a', kind: 'step', style, x, y, n: r.int(1, 99) };
      const b = bounds(a);
      if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < 0 || b.height < 0)
        return `bounds ${JSON.stringify(b)} for ${a.kind}`;
      const p = paintBounds(a);
      if (
        p.x > b.x ||
        p.y > b.y ||
        p.x + p.width < b.x + b.width ||
        p.y + p.height < b.y + b.height
      )
        return 'paint bounds smaller than bounds';
      const dx = r.int(-500, 500);
      const dy = r.int(-500, 500);
      const m = bounds(moveBy(a, dx, dy));
      if (
        Math.abs(m.x - b.x - dx) > 1e-9 ||
        Math.abs(m.y - b.y - dy) > 1e-9 ||
        Math.abs(m.width - b.width) > 1e-9
      )
        return `moved bounds ${JSON.stringify(m)} from ${JSON.stringify(b)} by ${dx},${dy}`;
      if (hitTest(a, b.x - 5000, b.y - 5000)) return `hit far away (${a.kind})`;
      // A point on the mark itself: a box's edge, a line's start, a stroke's first point.
      const on =
        'x1' in a
          ? [a.x1, a.y1]
          : 'points' in a
            ? [a.points[0]!, a.points[1]!]
            : a.kind === 'ellipse'
              ? [a.x + a.w / 2, a.y]
              : a.kind === 'step'
                ? [a.x, a.y]
                : [a.x, a.y];
      if (!hitTest(a, on[0]!, on[1]!)) return `not hit on itself (${a.kind} ${JSON.stringify(on)})`;
      return null;
    });
  });

  it('text out: every character of the page text reaches the Markdown/Word blocks, in order', () => {
    const words = [
      'The',
      'price',
      'is',
      '12',
      'dollars.',
      '价格',
      '是',
      '十二',
      'é',
      'link',
      '(see',
      'note)',
    ];
    simulate('text-blocks', N(5000), (r) => {
      const runs: TextRun[] = [];
      let y = 0;
      let order = 0;
      for (let line = r.int(0, 30); line > 0; line--) {
        const size = r.pick([12, 14, 16, 24, 32]);
        let x = r.int(0, 40);
        for (let k = r.int(1, 4); k > 0; k--) {
          const text =
            Array.from({ length: r.int(1, 5) }, () => r.pick(words)).join(' ') +
            (r.chance(0.3) ? ' ' : '');
          const width = text.length * size * 0.5;
          runs.push({
            text,
            rect: { x, y, width, height: size * 1.2 },
            fontSizePx: size,
            order: order++,
          });
          x += width + (r.chance(0.3) ? 0 : size * 0.3);
        }
        y += size * 1.2 + (r.chance(0.3) ? size : 2);
      }
      const shuffled = r.chance(0.5) ? runs : [...runs].sort(() => r() - 0.5);
      const pages = r.chance(0.3)
        ? [
            { y0: 0, y1: y / 2 },
            { y0: y / 2, y1: y + 1 },
          ]
        : [];
      const blocks = textBlocks(shuffled, [], pages);
      const got = blocks
        .map((b) => ('text' in b ? b.text : ''))
        .join('')
        .replace(/\s+/g, '');
      const want = runs
        .map((x) => x.text)
        .join('')
        .replace(/\s+/g, '');
      return got === want ? null : `text changed:\n${got}\n${want}`;
    });
  });

  it('redaction boxes: inside the line and around the matched text', () => {
    simulate('match-rect', N(8000), (r) => {
      const text = Array.from({ length: r.int(1, 60) }, () =>
        r.pick(['a', 'b', ' ', '@', '1', '中']),
      ).join('');
      const start = r.int(0, text.length - 1);
      const end = r.int(start + 1, text.length);
      const rect = {
        x: r.int(0, 1000),
        y: r.int(0, 1000),
        width: r.int(1, 900),
        height: r.int(8, 40),
      };
      const run = { text, rect, fontSizePx: r.int(8, 40) };
      const box = matchRect(run, { start, end });
      if (box.x < rect.x - 1e-9 || box.x + box.width > rect.x + rect.width + 1e-9)
        return 'outside the line';
      if (box.width <= 0) return `empty box for ${start}–${end} of ${text.length}`;
      const at = (i: number) => rect.x + (rect.width * i) / text.length;
      if (box.x > at(start) + 1e-9 || box.x + box.width < at(end) - 1e-9)
        return 'does not cover the match';
      return null;
    });
  });

  it('page grids: pages in order, inside the capture, and a grid survives the round trip', () => {
    simulate('grid', N(10000), (r) => {
      const height = r.int(0, 50_000);
      const g = {
        x0: r.int(-50, 500),
        x1: r.int(0, 1500),
        top: r.int(-100, 3000),
        height: r.int(0, 3000),
        gap: r.int(-10, 200),
      };
      const l = gridSheets(g, height);
      if (!l) return null;
      if (l.x1 - l.x0 < 20) return 'too narrow';
      for (const [i, sh] of l.sheets.entries()) {
        if (sh.y0 < 0 || sh.y1 > height || sh.y1 <= sh.y0)
          return `sheet ${i} ${sh.y0}–${sh.y1} in ${height}`;
        if (i && sh.y0 < l.sheets[i - 1]!.y1) return `sheet ${i} overlaps`;
      }
      if (
        l.sheets.length >= 4 &&
        l.sheets.at(-2)!.y1 - l.sheets.at(-2)!.y0 === Math.round(g.height)
      ) {
        const back = gridOf(l);
        if (
          back.top !== l.sheets[0]!.y0 ||
          back.height !== Math.round(g.height) ||
          back.gap !== Math.max(0, Math.round(g.gap))
        )
          return `round trip ${JSON.stringify(back)} from ${JSON.stringify(g)}`;
      }
      return null;
    });
  });

  it('frame registration: a confident match is the true shift', () => {
    simulate('registration', N(600), (r) => {
      const width = r.int(40, 200);
      const height = r.int(60, 220);
      const tall = height * 2;
      const full = new Uint8Array(width * tall);
      const pr = rng(r.int(1, 1e9));
      let v = 255;
      for (let y = 0; y < tall; y++) {
        if (pr() < 0.15) v = pr() < 0.5 ? 255 : Math.floor(pr() * 200);
        for (let x = 0; x < width; x++)
          full[y * width + x] = pr() < 0.3 ? Math.floor(pr() * 255) : v;
      }
      const shift = r.int(0, height - 10);
      const a = { width, height, data: full.subarray(0, width * height) };
      const b = { width, height, data: full.subarray(shift * width, (shift + height) * width) };
      const got = registerFrames(a, b);
      return got.confident && Math.abs(got.shift - shift) > 0
        ? `confident shift ${got.shift}, true ${shift}`
        : null;
    });
  });

  it('filters: same size, Original untouched, and stable on a blank page', () => {
    const ids: FilterId[] = ['original', 'enhance', 'sharpen', 'grey', 'bw', 'inksaver'];
    simulate('filters', N(1500), (r) => {
      const width = r.int(1, 48);
      const height = r.int(1, 48);
      const data = new Uint8ClampedArray(width * height * 4);
      const flat = r.chance(0.3);
      for (let i = 0; i < data.length; i++)
        data[i] = i % 4 === 3 ? 255 : flat ? 255 : r.int(0, 255);
      const before = data.slice();
      const id = r.pick(ids);
      const img = { width, height, data };
      applyFilter(id, img, r.pick([1, 1.5, 2, 3]));
      if (img.data.length !== width * height * 4) return 'size changed';
      if (id === 'original' && img.data.some((x, i) => x !== before[i]))
        return 'Original changed pixels';
      if (flat && id !== 'inksaver' && img.data.some((x, i) => i % 4 !== 3 && x < 250))
        return `${id} darkened a white page`;
      return null;
    });
  });

  it('page width: the window only ever narrows, never below the minimum unless it already was', () => {
    simulate('capture-width', N(10000), (r) => {
      const target = r.pick([0, 1000, 1200, 1440]);
      const win = r.int(300, 4000);
      const viewport = r.int(200, 4000);
      const zoom = r.pick([0.5, 0.75, 1, 1.25, 2]);
      const w = narrowWindowTo(target, { width: win }, viewport, zoom);
      if (w === null) return null;
      if (!target || viewport <= target + 1) return 'narrows when it need not';
      if (w > win) return `widens the window from ${win} to ${w}`;
      return null;
    });
  });

  it('blocked pages: any address gets an answer, never an exception', () => {
    const parts = [
      'https://',
      'http://',
      'chrome://',
      'edge://',
      'file:///',
      'about:',
      'data:',
      'view-source:',
      'chrome-extension://',
      'javascript:',
      '',
      'example.com',
      'chromewebstore.google.com',
      'microsoftedge.microsoft.com',
      '/path',
      '?q=1',
      '#x',
      ' ',
      '%',
      '中文',
    ];
    simulate('blocked', N(10000), (r) => {
      const url = r.chance(0.05)
        ? undefined
        : Array.from({ length: r.int(0, 5) }, () => r.pick(parts)).join('');
      const b = blockedReason(url, r.chance(0.5));
      if (b && !b.message) return 'block without a reason';
      if (url?.startsWith('chrome://') && !b) return `${url} not blocked`;
      return null;
    });
  });

  it(`ran the simulations`, () => {
    // Shown with --reporter=verbose; the count is what SIM_SCALE multiplies.
    console.log(
      `simulations: ${total.toLocaleString('en')} cases (SIM_SCALE ${SCALE}, seed ${SEED})`,
    );
    expect(total).toBeGreaterThan(0);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────────────

function run(text: string, x: number, y: number): TextRun {
  return { text, rect: { x, y: y - 6, width: text.length * 7, height: 12 }, fontSizePx: 12 };
}

function lcs(a: number[], b: number[]): number {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  return t[0]![0]!;
}

function crcRef(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function luhnDigit(body: string): number {
  for (let d = 0; d < 10; d++) if (luhn(body + d)) return d;
  throw new Error('no Luhn digit');
}

function cnId(r: Rng): string {
  const body = `${r.int(110000, 659999)}${r.int(1950, 2020)}${String(r.int(1, 12)).padStart(2, '0')}${String(r.int(1, 28)).padStart(2, '0')}${String(r.int(0, 999)).padStart(3, '0')}`;
  for (const c of '0123456789X') if (cnIdValid(body + c)) return body + c;
  throw new Error('no check character');
}

/** Minimal XML check: allowed characters, balanced tags, entities that exist. */
function xmlError(xml: string): string | null {
  // eslint-disable-next-line no-control-regex -- the characters XML 1.0 forbids are the target
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/.test(xml)) return 'forbidden character';
  if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(xml))
    return 'lone surrogate';
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml)) return 'bare &';
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>|<\?[^>]*\?>/g)) {
    if (!m[2]) continue;
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return `unbalanced </${m[2]}>`;
    } else stack.push(m[2]);
  }
  if (stack.length) return `unclosed <${stack.at(-1)}>`;
  const text = xml.replace(/<[^>]*>/g, '');
  if (/[<>]/.test(text.replace(/&gt;|&lt;/g, ''))) return 'raw < or > in text';
  return null;
}

interface FakeEl {
  style: StyleLike;
  hadStyle: boolean;
  attr: string | null;
  dump(): string;
  hasAttribute(n: string): boolean;
  getAttribute(n: string): string | null;
  removeAttribute(n: string): void;
}

/** An element with an inline style, its `style` attribute mirrored like the DOM does. */
function fakeEl(r: Rng, props: string[]): FakeEl {
  const map = new Map<string, { v: string; p: string }>();
  for (const p of props)
    if (r.chance(0.3)) map.set(p, { v: `${r.int(0, 9)}px`, p: r.chance(0.3) ? 'important' : '' });
  const hadStyle = map.size > 0 || r.chance(0.2);
  const el: FakeEl = {
    hadStyle,
    attr: hadStyle ? 'x' : null,
    style: {
      getPropertyValue: (k) => map.get(k)?.v ?? '',
      getPropertyPriority: (k) => map.get(k)?.p ?? '',
      setProperty: (k, v, p = '') => {
        map.set(k, { v, p });
        el.attr = 'x';
      },
      removeProperty: (k) => {
        const old = map.get(k)?.v ?? '';
        map.delete(k);
        if (el.attr !== null && !map.size) el.attr = '';
        return old;
      },
    },
    dump: () =>
      [...map]
        .sort()
        .map(([k, { v, p }]) => `${k}:${v}${p ? '!' : ''}`)
        .join(';'),
    hasAttribute: () => el.attr !== null,
    getAttribute: () => el.attr,
    removeAttribute: () => void (el.attr = null),
  };
  return el;
}
