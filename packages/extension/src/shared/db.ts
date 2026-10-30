import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotation, DomHints, Rect, Region } from '@screenscroll/core';

export interface SessionRecord {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  status: 'capturing' | 'complete' | 'cancelled' | 'error';
  docWidth: number;
  docHeight: number;
  frameCount: number;
  warnings: string[];
  /** Where the capture runs, so a restarted service worker can carry on. */
  tabId: number;
  windowId: number;
  /** The Studio's edits (TODO M4: projects are re-editable later). */
  project?: Project;
}

export interface Project {
  annotations: Annotation[];
  /** Crop tool region in document coordinates, or null for the whole capture. */
  crop: Region | null;
}

export const EMPTY_PROJECT: Project = { annotations: [], crop: null };

export async function saveProject(sessionId: string, project: Project): Promise<void> {
  const d = await db();
  const tx = d.transaction('sessions', 'readwrite');
  const session = await tx.store.get(sessionId);
  if (session) await tx.store.put({ ...session, project });
  await tx.done;
}

export interface FrameRecord {
  sessionId: string;
  index: number;
  docY: number;
  /** Crop rect in CSS px (viewport coordinates). */
  crop: Rect;
  dpr: number;
  imageWidth: number;
  imageHeight: number;
  blob: Blob;
  hints: DomHints;
  hintsMs: number;
}

interface Schema extends DBSchema {
  sessions: { key: string; value: SessionRecord };
  frames: { key: [string, number]; value: FrameRecord; indexes: { bySession: string } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  // The database keeps the product's first name so captures made before the rename stay.
  dbp ??= openDB<Schema>('scrollpress', 1, {
    upgrade(d) {
      d.createObjectStore('sessions', { keyPath: 'id' });
      d.createObjectStore('frames', { keyPath: ['sessionId', 'index'] }).createIndex(
        'bySession',
        'sessionId',
      );
    },
  });
  return dbp;
}

export async function framesOf(sessionId: string): Promise<FrameRecord[]> {
  const all = await (await db()).getAllFromIndex('frames', 'bySession', sessionId);
  return all.sort((a, b) => a.index - b.index);
}

/** The most recent capture with frames, for "Open last capture" in the panel. */
export async function lastSession(): Promise<SessionRecord | null> {
  const all = await (await db()).getAll('sessions');
  let best: SessionRecord | null = null;
  for (const s of all) if (s.frameCount > 0 && (!best || s.capturedAt > best.capturedAt)) best = s;
  return best;
}

/** One saved capture as the library shows it. */
export interface StoredCapture {
  session: SessionRecord;
  bytes: number;
  /** First frame, for a thumbnail. */
  preview: Blob | null;
  /** The page's own text as captured, for search (capped). */
  text: string;
}

/** Enough text to find a capture by what it said, without holding whole books in memory. */
export const SEARCH_TEXT_MAX = 200_000;

/** Every capture, newest first, with the space its frames take. */
export async function listCaptures(): Promise<StoredCapture[]> {
  const d = await db();
  const sessions = await d.getAll('sessions');
  const out: StoredCapture[] = [];
  for (const session of sessions) {
    let bytes = 0;
    let preview: Blob | null = null;
    let text = '';
    // Blobs in IndexedDB are references: summing sizes doesn't read the pixels.
    const frames = await d.getAllFromIndex('frames', 'bySession', session.id);
    for (const f of frames.sort((a, b) => a.index - b.index)) {
      bytes += f.blob.size;
      if (f.index === 0) preview = f.blob;
      for (const r of f.hints?.textRuns ?? []) {
        if (text.length >= SEARCH_TEXT_MAX) break;
        text += `${r.text} `;
      }
    }
    out.push({ session, bytes, preview, text: text.replace(/\s+/g, ' ').trim() });
  }
  return out.sort((a, b) => b.session.capturedAt.localeCompare(a.session.capturedAt));
}

/** Deletes a capture and all its frames. */
export async function deleteCapture(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['sessions', 'frames'], 'readwrite');
  const frames = tx.objectStore('frames');
  for (const key of await frames.index('bySession').getAllKeys(id)) await frames.delete(key);
  await tx.objectStore('sessions').delete(id);
  await tx.done;
}

/** Auto-clean: deletes captures older than `days`. Returns how many went. */
export async function deleteOlderThan(days: number, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const old = (await (await db()).getAll('sessions')).filter(
    (s) => s.capturedAt < cutoff && s.status !== 'capturing',
  );
  for (const s of old) await deleteCapture(s.id);
  return old.length;
}
