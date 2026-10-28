import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotation, DomHints, Rect, Region } from '@scrollpress/core';

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
