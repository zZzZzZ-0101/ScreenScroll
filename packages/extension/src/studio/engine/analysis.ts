import {
  applyFilter,
  evidenceSummary,
  type FilterId,
  type FrameGeom,
  type RowProfile,
  type SheetCandidate,
  type SheetLayout,
} from '@screenscroll/core';
import {
  ANALYSIS_WIDTH,
  analyzeFrames,
  STRIP_WIDTH,
  type FrameInput,
  type RawAnalysis,
  type SeamInfo,
} from './analysis-core';
import type { FromAnalysisWorker, ToAnalysisWorker } from './analysis-worker';
import type { FrameCache, LoadedSession } from './session';

export { ANALYSIS_WIDTH, STRIP_WIDTH, type SeamInfo };

export interface Analysis {
  rows: RowProfile;
  /** Long-view thumbnail: one small canvas per frame band, stacked (ARCHITECTURE: ≤ 320 px). */
  strip: Array<{ canvas: HTMLCanvasElement; y0: number; y1: number }>;
  stripScale: number;
  /** Document pages (a PDF or document viewer), in CSS px; null for ordinary pages. */
  sheets: SheetLayout | null;
  /** Ranked ways to read the capture as pages (CSS px), best first; empty for ordinary pages. */
  readings: SheetCandidate[];
  /** What page detection read (CSS px), for Details; null when there is no page column. */
  evidence: ReturnType<typeof evidenceSummary> | null;
  /** Frame geometries after optional pixel seam alignment. */
  geoms: FrameGeom[];
  /** Total height in CSS px after optional pixel seam alignment. */
  height: number;
  /** Structured per-seam alignment and verification results. */
  seams: SeamInfo[];
  /** Sum of absolute pixel shifts applied across adjusted seams. */
  adjustedSeamPx: number;
  /** Number of seams that could not be verified by image matching. */
  unverifiedSeams: number;
  /** True when one or more unanchored frame seams were shifted by image matching. */
  seamAdjusted: boolean;
  /** Explicit notes when seams were realigned or could not be verified. */
  seamWarnings: string[];
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

let worker: Worker | null = null;
let workerFailed = false;
let seq = 0;
const pending = new Map<number, Pending>();

type WorkerReq = ToAnalysisWorker extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;

function failWorker(message: string): void {
  workerFailed = true;
  const dead = worker;
  worker = null;
  try {
    dead?.terminate();
  } catch {
    /* ignore */
  }
  const err = new Error(message);
  const inflight = [...pending.values()];
  pending.clear();
  for (const p of inflight) p.reject(err);
}

/** Resets worker singleton state (used by unit tests verifying crash fallback). */
export function _resetAnalysisWorkerForTest(): void {
  try {
    worker?.terminate();
  } catch {
    /* ignore */
  }
  worker = null;
  workerFailed = false;
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<FromAnalysisWorker>) => {
        const m = e.data;
        const p = pending.get(m.id);
        if (!p) return;
        if (m.type === 'progress') p.onProgress?.(m.done, m.total);
        else {
          pending.delete(m.id);
          if (m.type === 'done') p.resolve(m.result);
          else p.reject(new Error(m.message));
        }
      };
      worker.onerror = () => failWorker('Analysis worker crashed.');
      worker.onmessageerror = () => failWorker('Analysis worker returned an unreadable message.');
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

function callWorker<T>(
  msg: WorkerReq,
  onProgress?: (done: number, total: number) => void,
  transfer: Transferable[] = [],
): Promise<T> | null {
  const w = getWorker();
  if (!w) return null;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    try {
      w.postMessage({ ...msg, id } as ToAnalysisWorker, transfer);
    } catch (e) {
      pending.delete(id);
      failWorker(e instanceof Error ? e.message : String(e));
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Streams every frame's rows through the row/sheet analyzers and pixel seam verifier off the
 * main thread (falling back inline when Workers are unavailable or fail), building the ≤ 320 px strip.
 */
export async function analyze(
  s: LoadedSession,
  _frames: FrameCache,
  onProgress?: (done: number, total: number) => void,
  opts: { buildStrip?: boolean; alignSeams?: boolean } = {},
): Promise<Analysis> {
  const inputs: FrameInput[] = s.frames.map((f, i) => ({
    blob: f.blob,
    geom: s.geoms[i]!,
    anchored: f.hints.textRuns.length > 0 || f.hints.blockEnds.length > 0,
  }));
  const buildStrip = opts.buildStrip !== false && typeof document !== 'undefined';
  let raw: RawAnalysis | null = null;
  const workerReq = callWorker<RawAnalysis>(
    {
      type: 'analyze',
      frames: inputs,
      width: s.width,
      buildStrip,
      alignSeams: opts.alignSeams,
    },
    onProgress,
  );
  if (workerReq) {
    try {
      raw = await workerReq;
    } catch {
      raw = null;
    }
  }
  raw ??= await analyzeFrames(inputs, s.width, {
    buildStrip,
    alignSeams: opts.alignSeams,
    onProgress,
  });

  const strip = raw.strip.map(({ bitmap, y0, y1 }) => {
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { canvas: c, y0, y1 };
  });

  return {
    rows: raw.rows,
    strip,
    stripScale: raw.stripScale,
    sheets: raw.sheets,
    readings: raw.readings,
    evidence: raw.evidence,
    geoms: raw.geoms,
    height: raw.height,
    seams: raw.seams,
    adjustedSeamPx: raw.adjustedSeamPx,
    unverifiedSeams: raw.unverifiedSeams,
    seamAdjusted: raw.seamAdjusted,
    seamWarnings: raw.seamWarnings,
  };
}

/** Runs `applyFilter` in the Studio worker for large page canvases, falling back inline. */
export async function filterPixelsAsync(
  img: ImageData,
  filter: FilterId,
  pxPerCss: number,
): Promise<ImageData> {
  if (filter === 'original') return img;
  if (img.width * img.height >= 200_000) {
    const copy = img.data.slice().buffer;
    const workerReq = callWorker<ArrayBuffer>(
      {
        type: 'filter',
        filter,
        width: img.width,
        height: img.height,
        data: copy,
        pxPerCss,
      },
      undefined,
      [copy],
    );
    if (workerReq) {
      try {
        const out = await workerReq;
        return new ImageData(new Uint8ClampedArray(out), img.width, img.height);
      } catch {
        // Worker failed: fall through and run the filter inline on the untouched input buffer.
      }
    }
  }
  applyFilter(filter, img, pxPerCss);
  return img;
}
