import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE, readText, type OcrRuntime, type Tensor } from '../../core/src/ocr/index';

/**
 * The real model on rendered text. Needs the model files, so it runs only when OCR_BUNDLE
 * points at an unpacked bundle directory (e.g. the npm package's `bundle/`); `pnpm ocr:check`
 * fetches it. Kept out of the default run, which must stay offline.
 */
const BUNDLE = process.env.OCR_BUNDLE;

async function runtime(dir: string): Promise<OcrRuntime> {
  ort.env.wasm.numThreads = 1;
  const sessions = {
    det: await ort.InferenceSession.create(`${dir}/${DEFAULT_ENGINE.files.det.path}`),
    rec: await ort.InferenceSession.create(`${dir}/${DEFAULT_ENGINE.files.rec.path}`),
  };
  return {
    async run(model, input: Tensor) {
      const s = sessions[model];
      const out = await s.run({
        [s.inputNames[0]!]: new ort.Tensor('float32', input.data, input.dims),
      });
      const t = out[s.outputNames[0]!]!;
      return { data: t.data as Float32Array, dims: [...t.dims] };
    },
  };
}

function render(lines: Array<[string, number]>, width = 1100) {
  const height = lines.reduce((h, [, size]) => h + size * 2.2, 40);
  const c = createCanvas(width, Math.round(height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#202124';
  let y = 20;
  for (const [text, size] of lines) {
    y += size * 1.6;
    ctx.font = `${size}px "DejaVu Sans", "WenQuanYi Zen Hei", sans-serif`;
    ctx.fillText(text, 24, y);
    y += size * 0.6;
  }
  mkdirSync('e2e-artifacts', { recursive: true });
  return { img: ctx.getImageData(0, 0, c.width, c.height), png: c.toBuffer('image/png') };
}

/** Share of characters right, by edit distance. */
function accuracy(got: string, want: string): number {
  const a = [...got.replace(/\s+/g, '')];
  const b = [...want.replace(/\s+/g, '')];
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return 1 - d[a.length]![b.length]! / b.length;
}

describe.skipIf(!BUNDLE)('OCR with the real PP-OCRv6 model', () => {
  it('reads English and Chinese screen text at 1× and 2×', { timeout: 300_000 }, async () => {
    const rt = await runtime(BUNDLE!);
    const dict = JSON.parse(
      readFileSync(`${BUNDLE}/${DEFAULT_ENGINE.files.dictionary.path}`, 'utf8'),
    ).characters as string[];
    const text: Array<[string, number]> = [
      ['ScreenScroll turns long pages into clean PDFs.', 16],
      ['The quick brown fox jumps over the lazy dog 1234567890.', 14],
      ['页面截图之后，文字可以搜索和复制。', 18],
      ['Invoice #2026-1029 · Total: $1,234.56', 16],
    ];
    for (const k of [1, 2]) {
      const { img, png } = render(
        text.map(([t, s]) => [t, s * k] as [string, number]),
        1100 * k,
      );
      writeFileSync(`e2e-artifacts/ocr-input-${k}x.png`, png);
      const t0 = Date.now();
      const lines = await readText(img, DEFAULT_ENGINE, rt, dict, { detScale: k === 1 ? 2 : 1 });
      const ms = Date.now() - t0;
      console.log(`${k}×: ${lines.length} lines in ${ms} ms`);
      for (const l of lines) console.log(`  ${l.confidence.toFixed(3)}  ${l.text}`);
      expect(lines).toHaveLength(text.length);
      for (const [i, [want]] of text.entries())
        expect(
          accuracy(lines[i]!.text, want),
          `${k}× line ${i + 1}: ${lines[i]!.text}`,
        ).toBeGreaterThan(0.9);
    }
  });
});
