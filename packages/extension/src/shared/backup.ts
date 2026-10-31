import { db, type FrameRecord, type SessionRecord } from './db';

/**
 * Captures backup (M7): one file holding saved captures, frames included. Captures can be
 * hundreds of MB, so nothing is assembled in memory: the file is a short header and a JSON
 * index followed by the frame images as they are stored, and a restore slices each image
 * straight out of the file.
 *
 *   "SSBACKUP" · uint32 LE index length · index (UTF-8 JSON) · frame images, in index order
 */
const MAGIC = 'SSBACKUP';

type FrameMeta = Omit<FrameRecord, 'blob'> & { size: number; type: string };
interface Index {
  version: 1;
  sessions: Array<{ record: SessionRecord; frames: FrameMeta[] }>;
}

export function packBackup(items: Array<{ record: SessionRecord; frames: FrameRecord[] }>): Blob {
  const index: Index = {
    version: 1,
    sessions: items.map(({ record, frames }) => ({
      record,
      frames: frames.map(({ blob, ...f }) => ({ ...f, size: blob.size, type: blob.type })),
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(index));
  const head = new Uint8Array(12);
  head.set(new TextEncoder().encode(MAGIC));
  new DataView(head.buffer).setUint32(8, json.length, true);
  return new Blob([head, json, ...items.flatMap((i) => i.frames.map((f) => f.blob))], {
    type: 'application/octet-stream',
  });
}

export async function unpackBackup(
  file: Blob,
): Promise<Array<{ record: SessionRecord; frames: FrameRecord[] }>> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12 || new TextDecoder().decode(head.subarray(0, 8)) !== MAGIC)
    throw new Error('This file is not a ScreenScroll backup.');
  const n = new DataView(head.buffer).getUint32(8, true);
  let index: Index;
  try {
    index = JSON.parse(await file.slice(12, 12 + n).text()) as Index;
  } catch {
    throw new Error('This backup is damaged: its contents list cannot be read.');
  }
  if (index.version !== 1 || !Array.isArray(index.sessions))
    throw new Error('This backup is from a newer ScreenScroll; update it first.');
  let at = 12 + n;
  const out = index.sessions.map(({ record, frames }) => ({
    record,
    frames: frames.map(({ size, type, ...f }) => {
      const blob = file.slice(at, at + size, type);
      at += size;
      return { ...f, blob };
    }),
  }));
  if (at > file.size) throw new Error('This backup is cut short: some images are missing.');
  return out;
}

/** The chosen captures (all when none chosen) as a backup file. */
export async function backupCaptures(ids: readonly string[]): Promise<Blob> {
  const d = await db();
  const sessions = (await d.getAll('sessions')).filter(
    (s) => s.status !== 'capturing' && (!ids.length || ids.includes(s.id)),
  );
  const items = [];
  for (const record of sessions) {
    const frames = (await d.getAllFromIndex('frames', 'bySession', record.id)).sort(
      (a, b) => a.index - b.index,
    );
    items.push({ record, frames });
  }
  return packBackup(items);
}

/** Restores a backup; captures already here (same id) are left as they are. */
export async function restoreCaptures(file: Blob): Promise<{ added: number; skipped: number }> {
  const items = await unpackBackup(file);
  const d = await db();
  let added = 0;
  let skipped = 0;
  for (const { record, frames } of items) {
    if (await d.get('sessions', record.id)) {
      skipped++;
      continue;
    }
    // Frames first, the session last: an interrupted restore never lists a capture whose
    // images aren't all there.
    for (const f of frames) await d.put('frames', f);
    await d.put('sessions', record);
    added++;
  }
  return { added, skipped };
}
