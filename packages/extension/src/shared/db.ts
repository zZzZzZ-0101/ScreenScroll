import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Annotation,
  DomHints,
  FilterId,
  Rect,
  Region,
  SheetGrid,
  TextRun,
} from '@screenscroll/core';
import type { CaptureMode } from './messages';

export interface OcrMeta {
  filter: FilterId;
  y0: number;
  y1: number;
  count: number;
}

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
  /** Total byte size of all stored frame blobs, computed when the capture finishes. */
  bytes?: number;
  /** Plain text (DOM + recognised OCR text, capped at SEARCH_TEXT_MAX) for library search. */
  searchText?: string;
  /** Recognised OCR text runs in document coordinates, cached so exports and tools reuse them. */
  ocrRuns?: TextRun[];
  /** Coverage metadata for `ocrRuns` (even when 0 lines were found). */
  ocrMeta?: OcrMeta;
  /** The window as it was before "Page width" narrowed it, until it is put back. */
  window?: SavedWindow;
  /** Active debugger / batch flags while capturing, so a restarted service worker carries on. */
  run?: {
    sharpScale?: number;
    quietScale?: number;
    silent?: boolean;
  };
  /** How it was captured, so it can be captured again the same way. */
  mode?: CaptureMode;
  /** The Studio's edits (TODO M4: projects are re-editable later). */
  project?: Project;
}

export interface SavedWindow {
  id: number;
  state: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface Project {
  annotations: Annotation[];
  /** Crop tool region in document coordinates, or null for the whole capture. */
  crop: Region | null;
  /** Breaks pinned or removed by hand in the Breaks view. */
  edits?: { pinned: number[]; removed: number[] };
  /** Document pages set by hand (Pages → document pages), or none to use the detected ones. */
  sheetGrid?: SheetGrid | null;
  /** What the pages are made from when document pages are found (see plan.ts PagesMode). */
  pages?: 'original' | 'auto' | 'grid';
  /** The document's own page numbers: hide them, or number the pages from 1; and its
   * running headers and footers: hide them. */
  pageNumbers?: { hide?: boolean; renumber?: boolean; hideRunning?: boolean };
  /** True when the user turns off automatic pixel seam alignment for this capture. */
  rawSeams?: boolean;
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
  /** The page's own text as captured (plus OCR when read), for search (capped). */
  text: string;
}

/** Enough text to find a capture by what it said, without holding whole books in memory. */
export const SEARCH_TEXT_MAX = 200_000;

/** Computes frame byte total and searchable text (DOM + OCR, capped) for a capture. */
export function summarizeFrames(
  frames: ReadonlyArray<{ blob: { size: number }; hints?: Pick<DomHints, 'textRuns'> }>,
  ocrRuns: readonly TextRun[] = [],
): { bytes: number; searchText: string } {
  let bytes = 0;
  let text = '';
  for (const f of frames) {
    bytes += f.blob.size;
    for (const r of f.hints?.textRuns ?? []) {
      if (text.length >= SEARCH_TEXT_MAX) break;
      text += `${r.text} `;
    }
  }
  for (const r of ocrRuns) {
    if (text.length >= SEARCH_TEXT_MAX) break;
    text += `${r.text} `;
  }
  return { bytes, searchText: text.replace(/\s+/g, ' ').trim() };
}

/** Persists recognised OCR runs on a capture and refreshes its searchable text index. */
export async function saveOcrRuns(
  sessionId: string,
  ocrRuns: TextRun[],
  ocrMeta: OcrMeta,
): Promise<void> {
  const d = await db();
  const frames = await framesOf(sessionId);
  const summary = summarizeFrames(frames, ocrRuns);
  const tx = d.transaction('sessions', 'readwrite');
  const session = await tx.store.get(sessionId);
  if (session) await tx.store.put({ ...session, ocrRuns, ocrMeta, ...summary });
  await tx.done;
}

/** Fast `O(sessions)` count and byte total for the toolbar panel, backfilling legacy records once. */
export async function storageSummary(): Promise<{ count: number; bytes: number }> {
  const d = await db();
  const sessions = await d.getAll('sessions');
  let total = 0;
  for (const s of sessions) {
    if (typeof s.bytes === 'number') {
      total += s.bytes;
      continue;
    }
    const frames = (await d.getAllFromIndex('frames', 'bySession', s.id)).sort(
      (a, b) => a.index - b.index,
    );
    const summary = summarizeFrames(frames, s.ocrRuns);
    total += summary.bytes;
    if (s.status !== 'capturing') await d.put('sessions', { ...s, ...summary });
  }
  return { count: sessions.length, bytes: total };
}

/** Every capture, newest first, with the space its frames take. */
export async function listCaptures(): Promise<StoredCapture[]> {
  const d = await db();
  const sessions = await d.getAll('sessions');
  const out: StoredCapture[] = [];
  for (const session of sessions) {
    if (typeof session.bytes === 'number' && typeof session.searchText === 'string') {
      // Summary fields are already on the session: read only frame 0 for the thumbnail.
      const first = session.frameCount > 0 ? await d.get('frames', [session.id, 0]) : undefined;
      out.push({
        session,
        bytes: session.bytes,
        preview: first?.blob ?? null,
        text: session.searchText,
      });
      continue;
    }
    // Legacy or in-progress capture: scan frames once and backfill completed sessions.
    const frames = (await d.getAllFromIndex('frames', 'bySession', session.id)).sort(
      (a, b) => a.index - b.index,
    );
    const summary = summarizeFrames(frames, session.ocrRuns);
    const preview = frames.find((f) => f.index === 0)?.blob ?? null;
    const updated = session.status !== 'capturing' ? { ...session, ...summary } : session;
    if (updated !== session) await d.put('sessions', updated);
    out.push({ session: updated, bytes: summary.bytes, preview, text: summary.searchText });
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
