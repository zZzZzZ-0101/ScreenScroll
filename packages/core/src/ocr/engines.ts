import type { EngineDescriptor } from './types.js';

/**
 * Known engines. To move to a newer model of the same kind (DB detection + CTC recognition),
 * add a descriptor with its files, checksums and numbers, and point DEFAULT_ENGINE at it.
 *
 * PP-OCRv6 small (PaddleOCR, Apache-2.0), July 2026: 18,709 characters covering Chinese
 * (simplified and traditional), Japanese kana, Latin, digits and symbols. ONNX float32
 * models as packaged in npm `@arcships/light-ocr-model-ppocrv6-small@0.3.4` (Apache-2.0,
 * bundle ppocrv6-small-native-20260719.1); the numbers are that bundle's
 * normalized-config.json. Fetched once from an npm CDN (jsDelivr, else unpkg) when the user
 * asks, checked against these SHA-256 sums, then kept on this computer.
 */
export const PP_OCR_V6_SMALL: EngineDescriptor = {
  id: 'ppocrv6-small',
  name: 'PP-OCRv6 small',
  languages: 'Chinese, Japanese, English and other Latin-script languages',
  license: 'Apache-2.0',
  baseUrls: [
    'https://cdn.jsdelivr.net/npm/@arcships/light-ocr-model-ppocrv6-small@0.3.4/bundle/',
    'https://unpkg.com/@arcships/light-ocr-model-ppocrv6-small@0.3.4/bundle/',
  ],
  files: {
    det: {
      path: 'det/inference.onnx',
      bytes: 9_880_512,
      sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
    },
    rec: {
      path: 'rec/inference.onnx',
      bytes: 21_159_378,
      sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
    },
    dictionary: {
      path: 'rec/dictionary.json',
      bytes: 112_408,
      sha256: '6e93cc028ff774c8bef0801ad08391f8284f7ef897013a9aeb9cbd515db3276d',
    },
  },
  det: {
    colorOrder: 'BGR',
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    scale: 1 / 255,
    threshold: 0.3,
    boxThreshold: 0.6,
    unclipRatio: 1.5,
    minimumBoxSide: 3,
    maxCandidates: 3000,
    multiple: 32,
    tileSide: 1280,
    overlap: 128,
  },
  rec: {
    colorOrder: 'BGR',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    scale: 1 / 255,
    height: 48,
    minWidth: 320,
    maxWidth: 3200,
    blankIndex: 0,
  },
};

export const ENGINES: readonly EngineDescriptor[] = [PP_OCR_V6_SMALL];
export const DEFAULT_ENGINE = PP_OCR_V6_SMALL;
