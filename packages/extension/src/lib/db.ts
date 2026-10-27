import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DomHints, Rect } from '@scrollpress/core';

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
