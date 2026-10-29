import type { OcrLine } from '@screenscroll/core/ocr';
import type { FromWorker, ToWorker } from './ocr-worker';

/** Talks to the OCR worker: one worker per page, started on first use. */
type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

type Request = ToWorker extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;

function call<T>(
  msg: Request,
  onProgress?: (done: number, total: number) => void,
  transfer: Transferable[] = [],
): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./ocr-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
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
    void call({ type: 'init', baseUrl: e2eBase });
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    worker!.postMessage({ ...msg, id } as ToWorker, transfer);
  });
}

/** e2e only: the model comes from the local fixture server, not the internet. */
let e2eBase: string | undefined;
export function setE2eModelBase(url: string | undefined): void {
  if (__SP_E2E__) e2eBase = url;
}

/** Downloads the model files (the user asked). Progress in bytes. */
export function downloadModel(onProgress?: (done: number, total: number) => void): Promise<void> {
  return call({ type: 'download' }, onProgress);
}

/** Reads the text in an image. `detScale` enlarges small text for detection. */
export function readImage(
  img: ImageData,
  detScale: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OcrLine[]> {
  const copy = img.data.slice().buffer;
  return call(
    { type: 'read', width: img.width, height: img.height, data: copy, detScale },
    onProgress,
    [copy],
  );
}
