import { applyFilter, type FilterId } from '@screenscroll/core';
import { analyzeFrames, type FrameInput, type RawAnalysis } from './analysis-core';

export type ToAnalysisWorker =
  | {
      id: number;
      type: 'analyze';
      frames: FrameInput[];
      width: number;
      buildStrip?: boolean;
      alignSeams?: boolean;
    }
  | {
      id: number;
      type: 'filter';
      filter: FilterId;
      width: number;
      height: number;
      data: ArrayBuffer;
      pxPerCss: number;
    };

export type FromAnalysisWorker =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; result: RawAnalysis | ArrayBuffer }
  | { id: number; type: 'error'; message: string };

const post = (m: FromAnalysisWorker, transfer: Transferable[] = []) => postMessage(m, transfer);

onmessage = async (e: MessageEvent<ToAnalysisWorker>) => {
  const m = e.data;
  try {
    if (m.type === 'analyze') {
      const result = await analyzeFrames(m.frames, m.width, {
        buildStrip: m.buildStrip,
        alignSeams: m.alignSeams,
        onProgress: (done, total) => post({ id: m.id, type: 'progress', done, total }),
      });
      post(
        { id: m.id, type: 'done', result },
        result.strip.map((p) => p.bitmap),
      );
    } else if (m.type === 'filter') {
      const data = new Uint8ClampedArray(m.data);
      applyFilter(m.filter, { width: m.width, height: m.height, data }, m.pxPerCss);
      post({ id: m.id, type: 'done', result: data.buffer }, [data.buffer]);
    }
  } catch (err) {
    post({ id: m.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
