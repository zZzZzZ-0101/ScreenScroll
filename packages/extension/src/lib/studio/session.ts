import { mergeHints, ownedBands, type DomHints, type FrameGeom } from '@scrollpress/core';
import { db, framesOf, type FrameRecord, type SessionRecord } from '@/lib/db';

/** Everything the Studio needs about one capture, minus the pixels (decoded lazily). */
export interface LoadedSession {
  session: SessionRecord;
  frames: FrameRecord[];
  geoms: FrameGeom[];
  hints: DomHints;
  /** Captured region size in CSS px. */
  width: number;
  height: number;
  /** Output device px per CSS px: the capture's own resolution, never upscaled. */
  dpr: number;
}

export async function loadSession(id: string): Promise<LoadedSession> {
  const session = await (await db()).get('sessions', id);
  if (!session) throw new Error('This capture no longer exists.');
  const frames = await framesOf(id);
  if (!frames.length) throw new Error('This capture has no frames.');
  const geoms = frames.map((f) => ({
    docY: f.docY,
    height: f.crop.height,
    cropX: f.crop.x * f.dpr,
    cropY: f.crop.y * f.dpr,
    dpr: f.dpr,
  }));
  const bands = ownedBands(geoms);
  return {
    session,
    frames,
    geoms,
    hints: mergeHints(frames.map((f) => f.hints)),
    width: frames[0]!.crop.width,
    height: bands.at(-1)!.y1,
    dpr: Math.max(...frames.map((f) => f.dpr)),
  };
}

/** Decodes frames on demand, keeping a few recent ones (pages touch 1–3 frames). */
export class FrameCache {
  private cache = new Map<number, Promise<ImageBitmap>>();

  constructor(
    private readonly frames: FrameRecord[],
    private readonly keep = 4,
  ) {}

  get(index: number): Promise<ImageBitmap> {
    let p = this.cache.get(index);
    if (p) {
      // Refresh recency.
      this.cache.delete(index);
      this.cache.set(index, p);
      return p;
    }
    p = createImageBitmap(this.frames[index]!.blob);
    this.cache.set(index, p);
    while (this.cache.size > this.keep) {
      const [oldest, bitmap] = this.cache.entries().next().value as [number, Promise<ImageBitmap>];
      this.cache.delete(oldest);
      void bitmap.then((b) => b.close());
    }
    return p;
  }

  clear(): void {
    for (const p of this.cache.values()) void p.then((b) => b.close());
    this.cache.clear();
  }
}
