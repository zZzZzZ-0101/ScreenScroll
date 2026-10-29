import * as ort from 'onnxruntime-web/wasm';
import { DEFAULT_ENGINE, readText, type OcrRuntime, type Tensor } from '@screenscroll/core/ocr';
import { filesOf, getFile, putFile } from './store';

/**
 * Text recognition, off the page's main thread. This worker is the only code in ScreenScroll
 * that uses the network, and only to fetch the model files the user asked for, from the one
 * address in the engine descriptor, each checked against its SHA-256 before it is kept
 * (DECISIONS 2026-10-29). Everything else, including reading text, is local.
 */
export type ToWorker =
  | { id: number; type: 'init'; baseUrl?: string }
  | { id: number; type: 'download' }
  | {
      id: number;
      type: 'read';
      width: number;
      height: number;
      data: ArrayBuffer;
      detScale: number;
    };
export type FromWorker =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; result?: unknown }
  | { id: number; type: 'error'; message: string };

const engine = DEFAULT_ENGINE;
let baseUrls = engine.baseUrls;
let runtime: Promise<{ rt: OcrRuntime; dictionary: string[] }> | null = null;

const post = (m: FromWorker) => postMessage(m);

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The file from the first mirror that answers; says which failed and why otherwise. */
async function fetchFirst(path: string): Promise<Response> {
  const why: string[] = [];
  for (const base of baseUrls) {
    const url = new URL(path, base);
    try {
      const res = await fetch(url.href, { credentials: 'omit', cache: 'no-store' });
      if (res.ok && res.body) return res;
      why.push(`${url.host}: HTTP ${res.status}`);
    } catch (e) {
      why.push(`${url.host}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`Could not download ${path} (${why.join('; ')}).`);
}

async function download(id: number): Promise<void> {
  const files = filesOf(engine);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  let done = 0;
  for (const f of files) {
    if (await getFile(engine, f)) {
      done += f.bytes;
      continue;
    }
    const res = await fetchFirst(f.path);
    const reader = res.body!.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      parts.push(value);
      got += value.length;
      post({ id, type: 'progress', done: done + got, total });
    }
    const buf = new Uint8Array(got);
    let at = 0;
    for (const p of parts) {
      buf.set(p, at);
      at += p.length;
    }
    if ((await sha256(buf.buffer)) !== f.sha256)
      throw new Error(`${f.path} did not match its checksum, so it was not kept.`);
    await putFile(engine, f, buf.buffer);
    done += f.bytes;
  }
  post({ id, type: 'progress', done: total, total });
}

async function load(): Promise<{ rt: OcrRuntime; dictionary: string[] }> {
  const det = await getFile(engine, engine.files.det);
  const rec = await getFile(engine, engine.files.rec);
  const dict = await getFile(engine, engine.files.dictionary);
  if (!det || !rec || !dict) throw new Error('The text recognition model is not downloaded.');
  const sessions = {
    det: await ort.InferenceSession.create(new Uint8Array(det)),
    rec: await ort.InferenceSession.create(new Uint8Array(rec)),
  };
  const dictionary = (JSON.parse(new TextDecoder().decode(dict)) as { characters: string[] })
    .characters;
  const rt: OcrRuntime = {
    async run(model, input: Tensor) {
      const s = sessions[model];
      const out = await s.run({
        [s.inputNames[0]!]: new ort.Tensor('float32', input.data, input.dims),
      });
      const t = out[s.outputNames[0]!]!;
      return { data: t.data as Float32Array, dims: [...t.dims] };
    },
  };
  return { rt, dictionary };
}

onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      // The .wasm ships with the extension (the bundler emits it next to this worker); one
      // thread, because extension pages aren't cross-origin isolated (no SharedArrayBuffer).
      ort.env.wasm.numThreads = 1;
      // Tests serve the model from the local fixture server; shipped builds ignore this.
      if (__SP_E2E__ && m.baseUrl) baseUrls = [m.baseUrl];
      post({ id: m.id, type: 'done' });
    } else if (m.type === 'download') {
      await download(m.id);
      post({ id: m.id, type: 'done' });
    } else if (m.type === 'read') {
      runtime ??= load();
      let ready;
      try {
        ready = await runtime;
      } catch (err) {
        runtime = null;
        throw err;
      }
      const img = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) };
      const lines = await readText(img, engine, ready.rt, ready.dictionary, {
        detScale: m.detScale,
        onProgress: (done, total) => post({ id: m.id, type: 'progress', done, total }),
      });
      post({ id: m.id, type: 'done', result: lines });
    }
  } catch (err) {
    post({ id: m.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
