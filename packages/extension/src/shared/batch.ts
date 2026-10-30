/**
 * Batch capture (ROADMAP M5): several pages one after another, either tabs of a window or a
 * list of addresses. The background runs it and keeps its progress in session storage, which
 * the batch page shows as it changes.
 */
export type BatchTarget = { kind: 'tab'; tabId: number } | { kind: 'url'; url: string };

export interface BatchItem {
  label: string;
  url: string;
  status: 'waiting' | 'capturing' | 'done' | 'skipped' | 'failed';
  /** Why it was skipped or failed, or a note on a done capture. */
  reason?: string;
  sessionId?: string;
}

export interface BatchState {
  running: boolean;
  items: BatchItem[];
}

export const BATCH_KEY = 'batch';

/** Background message from the batch page. */
export interface BatchStart {
  type: 'sp:batch-start';
  targets: BatchTarget[];
  windowId: number;
  /** The batch page's tab, brought back to the front at the end. */
  homeTabId: number;
}

/** Addresses from pasted text: one per line (or separated by spaces), http(s) and file only. */
export function parseUrls(text: string): { urls: string[]; rejected: string[] } {
  const urls: string[] = [];
  const rejected: string[] = [];
  for (const raw of text.split(/\s+/).map((t) => t.trim()).filter(Boolean)) {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(withScheme);
      if (['http:', 'https:', 'file:'].includes(u.protocol) && (u.hostname || u.protocol === 'file:'))
        urls.push(u.href);
      else rejected.push(raw);
    } catch {
      rejected.push(raw);
    }
  }
  return { urls: [...new Set(urls)], rejected };
}
