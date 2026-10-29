# OCR (text recognition)

Pages that have no text of their own (a document viewer that paints its pages, a canvas, a picture of a page) can still become searchable: their page images are read and the text goes into the PDF's invisible text layer, at the place it was read.

## Layers, each replaceable on its own

| Layer | Where | What it is today | To replace it |
|---|---|---|---|
| Engine descriptor | `packages/core/src/ocr/engines.ts` | PP-OCRv6 small (PaddleOCR, Apache-2.0): model files, mirrors, SHA-256 sums, pre/post-processing numbers | Add a descriptor, point `DEFAULT_ENGINE` at it |
| Runtime | `packages/extension/src/ocr/ocr-worker.ts` (`OcrRuntime`) | onnxruntime-web 1.31.1, WebAssembly CPU, 1 thread | Implement `run(model, tensor)` with another runtime (WebGPU EP, WebNN, …) |
| Pipeline | `packages/core/src/ocr/pipeline.ts` (+ `db.ts`, `ctc.ts`, `prep.ts`) | DB detection on 1280 px tiles (128 px overlap) → axis-aligned boxes → 48 px-high line crops → CTC greedy decoding | Only if a new model is a different kind (e.g. one end-to-end model) |
| Use in the product | `packages/core/src/ocr/runs.ts`, `studio/engine/export.ts` | Which pages to read, lines → text runs in document coordinates | — |

### A newer model of the same kind (DB detection + CTC recognition)

One step: a new `EngineDescriptor` with
- `files`: detection and recognition ONNX models and the dictionary (JSON `{ "characters": [...] }`, class k > 0 is `characters[k − 1]`), each with `bytes` and `sha256`;
- `baseUrls`: where they are published (pin an exact version);
- `det` / `rec`: the numbers from the model's own config (colour order, mean/std, thresholds, unclip ratio, input height, width limits).

Then `DEFAULT_ENGINE = THE_NEW_ONE`. Check it with `pnpm ocr:check` (reads rendered English and Chinese at 1× and 2× with the real model; ≥ 90% of characters right per line) and the OCR e2e test (`OCR_BUNDLE=$(pnpm -s ocr:bundle) pnpm e2e -g "text recognition"`). Models downloaded under the old engine id are simply not used any more; Settings → Text recognition → Remove frees them.

### A different runtime

`OcrRuntime.run('det' | 'rec', { data: Float32Array, dims })` returns the model's first output the same way. Everything else stays.

## Numbers (PP-OCRv6 small, bundle ppocrv6-small-native-20260719.1)

- Detection: input BGR, (v / 255 − [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225], sides padded to a multiple of 32. Probability map > 0.3 → 8-connected regions; mean probability over the region's box ≥ 0.6; box grown by area · 1.5 / perimeter; sides < 3 px dropped. Text under 1.5 image px per CSS px is enlarged 2× for detection only.
- Tiles: 1280 px, 128 px overlap. Copies of a box from different tiles (IoU > 0.5 or 80% of the smaller covered) keep the one not touching a shared tile edge (within 32 px), then the higher score.
- Recognition: line crop resized to 48 px high, width ≤ 3,200 px, tensor ≥ 320 px wide (padding 0 after normalising), BGR, (v / 255 − 0.5) / 0.5. Output T × 18,710 softmax; greedy CTC (blank 0). Confidence = mean probability of the kept characters; lines under 0.5 are left out.
- Which pages: Settings → Text recognition. Auto: pages with fewer than 20 characters of their own text. Always: every page. Lines overlapping the page's own text by more than half are skipped (nothing searchable twice).

## Network and privacy

The only network use in ScreenScroll (DECISIONS 2026-10-29): the OCR worker fetches the three model files, when the user presses Download (Studio or Settings), from the descriptor's mirrors (jsDelivr, then unpkg), with no cookies; each file must match its SHA-256 before it is kept in IndexedDB (`screenscroll-ocr`). Nothing of the user's is sent. The offline guard test allows `fetch` only in the worker chunk and checks that the only absolute addresses there are those mirrors. The runtime's `.wasm` ships with the extension; the manifest's CSP adds only `'wasm-unsafe-eval'`.

## Known limits

- Upright text only (screen text is); rotated or vertical text isn't read.
- ~1–3 s per page on one CPU thread (extension pages aren't cross-origin isolated, so no threads). The WebGPU fp16 models in the same bundle (5 + 10.6 MB) are the obvious next step for speed.
- Download not verified from the build sandbox (its proxy blocks jsDelivr and unpkg); the e2e test serves the same files from the local fixture server.
