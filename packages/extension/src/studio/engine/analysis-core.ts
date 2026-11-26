import {
  checkSeam,
  detectSheets,
  evidenceSummary,
  ownedBands,
  RowAnalyzer,
  SEAM_MIN_OVERLAP,
  SEAM_WINDOW,
  sheetCandidates,
  SheetAnalyzer,
  sheetEvidence,
  toGrey,
  type FrameGeom,
  type GreyImage,
  type RowProfile,
  type SheetCandidate,
  type SheetLayout,
} from '@screenscroll/core';

export const ANALYSIS_WIDTH = 800;
export const STRIP_WIDTH = 320;

export interface FrameInput {
  blob: Blob;
  geom: FrameGeom;
  /** True when DOM text/block hints already anchor this frame's coordinates. */
  anchored: boolean;
}

export interface AnalyzeOptions {
  buildStrip?: boolean;
  alignSeams?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface RawStripPart {
  bitmap: ImageBitmap;
  y0: number;
  y1: number;
}

export interface SeamInfo {
  frame: number;
  y: number;
  kind: 'adjusted' | 'unverified';
  delta: number;
  score: number;
}

export interface RawAnalysis {
  rows: RowProfile;
  strip: RawStripPart[];
  stripScale: number;
  sheets: SheetLayout | null;
  readings: SheetCandidate[];
  evidence: ReturnType<typeof evidenceSummary> | null;
  geoms: FrameGeom[];
  height: number;
  seams: SeamInfo[];
  adjustedSeamPx: number;
  unverifiedSeams: number;
  seamAdjusted: boolean;
  seamWarnings: string[];
}

/**
 * Worker-safe pixel analysis and seam verification. Streams one frame bitmap at a time so
 * memory stays bounded to a single screen regardless of capture length.
 */
export async function analyzeFrames(
  inputs: readonly FrameInput[],
  width: number,
  opts: AnalyzeOptions = {},
): Promise<RawAnalysis> {
  const aw = Math.min(ANALYSIS_WIDTH, Math.round(width));
  const analyzer = new RowAnalyzer(aw, 1);
  const sheetAnalyzer = new SheetAnalyzer(aw);
  const stripScale = Math.min(1, STRIP_WIDTH / width);
  const strip: RawStripPart[] = [];
  const geoms: FrameGeom[] = [];
  const wantStrip = opts.buildStrip !== false;
  const wantSeams = opts.alignSeams !== false;

  let cumulativeShift = 0;
  let coveredTo = Number.NEGATIVE_INFINITY;
  let prevTail: GreyImage | null = null;
  let totalSeamPx = 0;
  let unverifiedCount = 0;
  const seams: SeamInfo[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const { blob, geom: rawG, anchored } = inputs[i]!;
    let docY = rawG.docY - cumulativeShift;
    const cropH = Math.round(rawG.height);
    if (cropH <= 0) {
      geoms.push({ ...rawG, docY });
      opts.onProgress?.(i + 1, inputs.length);
      continue;
    }

    const bitmap = await createImageBitmap(blob);
    try {
      if (wantSeams && prevTail !== null && i > 0) {
        const prev = geoms[i - 1]!;
        const nomOverlap = Math.max(0, prev.docY + prev.height - docY);
        if (!anchored || nomOverlap >= SEAM_MIN_OVERLAP) {
          const headH = Math.min(SEAM_WINDOW, cropH);
          const hc = new OffscreenCanvas(aw, headH);
          const hctx = hc.getContext('2d', { willReadFrequently: true })!;
          hctx.drawImage(
            bitmap,
            rawG.cropX,
            rawG.cropY,
            width * rawG.dpr,
            headH * rawG.dpr,
            0,
            0,
            aw,
            headH,
          );
          const currHead = toGrey({
            width: aw,
            height: headH,
            data: hctx.getImageData(0, 0, aw, headH).data,
            channels: 4,
          });
          const seam = checkSeam(prevTail, currHead, nomOverlap);
          if (seam.kind === 'adjusted' && !anchored) {
            cumulativeShift += seam.delta;
            docY -= seam.delta;
            const deltaPx = Math.round(seam.delta);
            totalSeamPx += Math.abs(deltaPx);
            seams.push({
              frame: i,
              y: Math.max(0, docY),
              kind: 'adjusted',
              delta: deltaPx,
              score: seam.score,
            });
          } else if (seam.kind === 'unverified') {
            unverifiedCount++;
            seams.push({
              frame: i,
              y: Math.max(0, docY),
              kind: 'unverified',
              delta: 0,
              score: seam.score,
            });
          }
        }
      }

      const y0 = Math.max(docY, coveredTo);
      const y1 = Math.max(y0, docY + rawG.height);
      coveredTo = Math.max(coveredTo, y1);
      geoms.push({ ...rawG, docY });

      if (wantSeams && i + 1 < inputs.length) {
        const next = inputs[i + 1]!;
        const nextNomOverlap = docY + rawG.height - (next.geom.docY - cumulativeShift);
        if (!next.anchored || nextNomOverlap >= SEAM_MIN_OVERLAP) {
          const tailH = Math.min(SEAM_WINDOW, cropH);
          const tailStart = cropH - tailH;
          const tc = new OffscreenCanvas(aw, tailH);
          const tctx = tc.getContext('2d', { willReadFrequently: true })!;
          tctx.drawImage(
            bitmap,
            rawG.cropX,
            rawG.cropY + tailStart * rawG.dpr,
            width * rawG.dpr,
            tailH * rawG.dpr,
            0,
            0,
            aw,
            tailH,
          );
          prevTail = toGrey({
            width: aw,
            height: tailH,
            data: tctx.getImageData(0, 0, aw, tailH).data,
            channels: 4,
          });
        } else {
          prevTail = null;
        }
      } else {
        prevTail = null;
      }

      const h = Math.round(y1 - y0);
      if (h > 0) {
        const sx = rawG.cropX;
        const sy = rawG.cropY + (y0 - docY) * rawG.dpr;
        const sw = width * rawG.dpr;
        const sh = h * rawG.dpr;

        const a = new OffscreenCanvas(aw, h);
        const actx = a.getContext('2d', { willReadFrequently: true })!;
        actx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, aw, h);
        const img = actx.getImageData(0, 0, aw, h);
        const grey = toGrey({ width: aw, height: h, data: img.data, channels: 4 });
        analyzer.push(grey);
        sheetAnalyzer.push(grey);

        if (wantStrip) {
          const swOut = Math.max(1, Math.round(width * stripScale));
          const shOut = Math.max(1, Math.round(h * stripScale));
          const sc = new OffscreenCanvas(swOut, shOut);
          sc.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, swOut, shOut);
          strip.push({ bitmap: sc.transferToImageBitmap(), y0, y1 });
        }
      }
    } finally {
      bitmap.close();
    }
    opts.onProgress?.(i + 1, inputs.length);
  }

  const profile = sheetAnalyzer.finish();
  const found = detectSheets(profile);
  const k = width / aw;
  const toCss = <T extends { x0: number; x1: number }>(v: T): T => ({
    ...v,
    x0: v.x0 * k,
    x1: v.x1 * k,
  });
  const sheets = found && toCss(found);
  const ev = sheetEvidence(profile);
  const evidence = ev && { ...evidenceSummary(ev), x0: ev.x0 * k, x1: ev.x1 * k };
  const readings = sheetCandidates(ev, found, 3, k).map((c) => ({
    ...c,
    layout: toCss(c.layout),
    grid: c.grid && toCss(c.grid),
  }));

  const seamWarnings: string[] = [];
  if (totalSeamPx > 0)
    seamWarnings.push(`Screen seams were realigned by ${totalSeamPx} px using image matching.`);
  if (unverifiedCount > 0)
    seamWarnings.push(
      `${unverifiedCount} screen seam${unverifiedCount === 1 ? ' could' : 's could'} not be verified (content changed while capturing).`,
    );

  const bands = ownedBands(geoms);
  const height = bands.at(-1)?.y1 ?? 0;

  return {
    rows: analyzer.finish(),
    strip,
    stripScale,
    sheets,
    readings,
    evidence,
    geoms,
    height,
    seams,
    adjustedSeamPx: totalSeamPx,
    unverifiedSeams: unverifiedCount,
    seamAdjusted: totalSeamPx > 0,
    seamWarnings,
  };
}
