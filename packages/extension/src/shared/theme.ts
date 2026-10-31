import { createElement, useEffect, useState, type ReactNode } from 'react';
import { resolveLang, setLang, type LangSetting } from './i18n';
import { loadSettings, saveSettings, type Theme } from './settings';

const dark = () => matchMedia('(prefers-color-scheme: dark)');

/** Puts the resolved theme on <html data-theme> (the Tailwind dark variant reads it). */
export function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? (dark().matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** The theme setting for a page: applied at once, kept in sync with the system and storage. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    void loadSettings().then((s) => setTheme(s.theme));
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>) => {
      const next = (changes.settings?.newValue as { theme?: Theme } | undefined)?.theme;
      if (next) setTheme(next);
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = dark();
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  const change = (t: Theme) => {
    setTheme(t);
    void saveSettings({ theme: t });
  };
  return [theme, change];
}

/**
 * Wraps a page so it follows the theme and language settings from the first paint on. The
 * page waits for the language (one storage read) so it never flashes in the wrong one.
 */
export function Themed({ children }: { children: ReactNode }) {
  useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadSettings().then((s) => {
      setLang(resolveLang(s.language));
      setReady(true);
    });
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>) => {
      const next = (changes.settings?.newValue as { language?: LangSetting } | undefined)
        ?.language;
      if (next) setLang(resolveLang(next));
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);
  return ready ? createElement('div', { className: 'contents' }, children) : null;
}
