import { describe, expect, it } from 'vitest';
import type { FrameRecord, SessionRecord } from '../src/shared/db';
import { packBackup, unpackBackup } from '../src/shared/backup';
import { emptyHints } from '@screenscroll/core';

const record = (id: string): SessionRecord => ({
  id,
  url: 'https://example.com/',
  title: `Capture ${id}`,
  capturedAt: '2026-10-31T09:00:00.000Z',
  status: 'complete',
  docWidth: 800,
  docHeight: 2000,
  frameCount: 2,
  warnings: [],
  tabId: 1,
  windowId: 1,
});
const frame = (sessionId: string, index: number, bytes: string): FrameRecord => ({
  sessionId,
  index,
  docY: index * 1000,
  crop: { x: 0, y: 0, width: 800, height: 1000 },
  dpr: 1,
  imageWidth: 800,
  imageHeight: 1000,
  blob: new Blob([bytes], { type: 'image/png' }),
  hints: emptyHints(),
  hintsMs: 0,
});

describe('captures backup file', () => {
  it('round-trips records and frame images, in order', async () => {
    const items = [
      { record: record('a'), frames: [frame('a', 0, 'AAAA'), frame('a', 1, 'BB')] },
      { record: record('b'), frames: [frame('b', 0, 'CCCCCC')] },
    ];
    const back = await unpackBackup(packBackup(items));
    expect(back.map((i) => i.record)).toEqual(items.map((i) => i.record));
    const texts = await Promise.all(back.flatMap((i) => i.frames.map((f) => f.blob.text())));
    expect(texts).toEqual(['AAAA', 'BB', 'CCCCCC']);
    expect(back[0]!.frames[1]!.docY).toBe(1000);
    expect(back[0]!.frames[0]!.blob.type).toBe('image/png');
  });
  it('refuses other files and says when one is cut short', async () => {
    await expect(unpackBackup(new Blob(['hello world, not a backup']))).rejects.toThrow(
      /not a ScreenScroll backup/,
    );
    const whole = packBackup([{ record: record('a'), frames: [frame('a', 0, 'AAAAAAAA')] }]);
    await expect(unpackBackup(whole.slice(0, whole.size - 3))).rejects.toThrow(/cut short/);
  });
});
