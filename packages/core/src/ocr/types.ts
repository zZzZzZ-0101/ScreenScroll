/**
 * Text recognition (OCR), built to be replaced. Three layers, each swappable on its own:
 *
 * 1. An **engine descriptor** (`EngineDescriptor`): which model files, from where, with which
 *    checksums, and the numbers its pre- and post-processing need. A newer model is a new
 *    descriptor; nothing else changes if it keeps the same kind of pipeline.
 * 2. A **runtime** (`OcrRuntime`): runs a model on a tensor. onnxruntime-web on CPU (wasm)
 *    today; WebGPU, WebNN or a different library tomorrow, behind the same two calls.
 * 3. The **pipeline** (`ocr/pipeline.ts`): detection → boxes → line crops → recognition →
 *    text, pure TypeScript with unit tests.
 *
 * See docs/spec/OCR.md for how to swap each layer.
 */

export interface Tensor {
  data: Float32Array;
  /** e.g. [1, 3, H, W]. */
  dims: number[];
}

export interface OcrRuntime {
  /** Runs the named model ('det' or 'rec') on one input tensor; returns its first output. */
  run(model: 'det' | 'rec', input: Tensor): Promise<Tensor>;
}

export interface ModelFile {
  /** Path inside the engine's bundle, e.g. 'det/inference.onnx'. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface EngineDescriptor {
  id: string;
  name: string;
  /** What it reads, in plain words. */
  languages: string;
  license: string;
  /**
   * Where the files are fetched from (once, then kept), tried in order: mirrors of the same
   * published package, so any of them is as good as another once the checksum matches.
   */
  baseUrls: string[];
  files: { det: ModelFile; rec: ModelFile; dictionary: ModelFile };
  det: DetConfig;
  rec: RecConfig;
}

export interface DetConfig {
  /** BGR or RGB order of the input channels. */
  colorOrder: 'BGR' | 'RGB';
  mean: [number, number, number];
  std: [number, number, number];
  /** Pixel value multiplier before mean/std, usually 1/255. */
  scale: number;
  /** Probability above which a map pixel is text. */
  threshold: number;
  /** Mean probability a box needs to be kept. */
  boxThreshold: number;
  /** How far boxes grow back out (the model predicts shrunk text regions). */
  unclipRatio: number;
  minimumBoxSide: number;
  maxCandidates: number;
  /** Input sides must be a multiple of this. */
  multiple: number;
  /** Large pages are processed in tiles of this side, overlapping by `overlap`. */
  tileSide: number;
  overlap: number;
}

export interface RecConfig {
  colorOrder: 'BGR' | 'RGB';
  mean: [number, number, number];
  std: [number, number, number];
  scale: number;
  /** Line images are resized to this height… */
  height: number;
  /** …and padded to at least this width, at most `maxWidth`. */
  minWidth: number;
  maxWidth: number;
  /** CTC blank class; class k > blank is dictionary entry k − 1. */
  blankIndex: number;
}

/** One line of recognised text, in the pixels of the image it was read from. */
export interface OcrLine {
  text: string;
  /** Mean probability of the chosen characters, 0…1. */
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
