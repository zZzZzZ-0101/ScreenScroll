import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_PAGE_SETTINGS,
  type PageSettings,
} from '@scrollpress/core';
import type { ImageMode } from './studio/compose';

export interface Settings {
  page: PageSettings;
  /** PAGINATION §6: crop empty side margins automatically, or keep the full width. */
  crop: 'auto' | 'off';
  /** "Fewer pages ↔ cleaner breaks", 0…1. */
  breakStyle: number;
  imageMode: ImageMode;
  filenameTemplate: string;
  /** UI §1: what happens after a capture. */
  afterCapture: 'studio' | 'pdf';
}

export const DEFAULT_SETTINGS: Settings = {
  page: DEFAULT_PAGE_SETTINGS,
  crop: 'auto',
  breakStyle: 0.5,
  imageMode: 'auto',
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  afterCapture: 'studio',
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    page: { ...DEFAULT_SETTINGS.page, ...stored?.page },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
