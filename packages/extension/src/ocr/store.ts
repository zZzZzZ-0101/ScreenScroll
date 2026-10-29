import { openDB, type IDBPDatabase } from 'idb';
import type { EngineDescriptor, ModelFile } from '@screenscroll/core/ocr';

/**
 * Downloaded OCR model files, kept on this computer in their own database so they can be
 * listed, sized and removed apart from captures. No network here: downloading is the OCR
 * worker's job (ocr-worker.ts), and only after the user asks.
 */
interface Stored {
  /** `${engine id}/${path}` */
  key: string;
  sha256: string;
  bytes: ArrayBuffer;
}

let open: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  open ??= openDB('screenscroll-ocr', 1, {
    upgrade(d) {
      d.createObjectStore('files', { keyPath: 'key' });
    },
  });
  return open;
}

const keyOf = (e: EngineDescriptor, f: ModelFile) => `${e.id}/${f.path}`;
const filesOf = (e: EngineDescriptor) => [e.files.det, e.files.rec, e.files.dictionary];

export async function getFile(e: EngineDescriptor, f: ModelFile): Promise<ArrayBuffer | null> {
  const rec = (await (await db()).get('files', keyOf(e, f))) as Stored | undefined;
  return rec && rec.sha256 === f.sha256 ? rec.bytes : null;
}

export async function putFile(
  e: EngineDescriptor,
  f: ModelFile,
  bytes: ArrayBuffer,
): Promise<void> {
  await (await db()).put('files', { key: keyOf(e, f), sha256: f.sha256, bytes } satisfies Stored);
}

export interface ModelStatus {
  ready: boolean;
  /** Bytes kept on this computer for this engine. */
  stored: number;
  /** Bytes the full set takes. */
  total: number;
}

export async function modelStatus(e: EngineDescriptor): Promise<ModelStatus> {
  let stored = 0;
  let ready = true;
  for (const f of filesOf(e)) {
    const b = await getFile(e, f);
    if (b) stored += b.byteLength;
    else ready = false;
  }
  return { ready, stored, total: filesOf(e).reduce((n, f) => n + f.bytes, 0) };
}

/** Removes every stored file of the engine (Settings → Remove model). */
export async function removeModel(e: EngineDescriptor): Promise<void> {
  const d = await db();
  for (const f of filesOf(e)) await d.delete('files', keyOf(e, f));
}

export { filesOf };
