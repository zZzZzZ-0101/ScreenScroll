import { ZH_CN } from './zh-CN';

/**
 * Interface languages (M7): English is the source; Simplified Chinese is a lookup from the
 * English text, so anything not yet translated still reads, in English. `{name}` marks a
 * value filled in at run time.
 */
export type Lang = 'en' | 'zh-CN';
export type LangSetting = 'auto' | Lang;

let lang: Lang = 'en';

export function resolveLang(setting: LangSetting, browser = navigator.language): Lang {
  if (setting !== 'auto') return setting;
  return browser.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function setLang(l: Lang): void {
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh-CN' ? 'zh-CN' : 'en';
}

/**
 * A message made elsewhere (core, the capture, the background), in English and sometimes
 * "Page 5: …": translated when known, else shown as written.
 */
export function tMsg(text: string): string {
  const m = /^Page (\d+): ([\s\S]*)$/.exec(text);
  if (m) return t('Page {n}: {text}', { n: m[1]!, text: tMsg(m[2]!) });
  return t(text);
}

/** A date and time as the interface's language writes them. */
export function formatDate(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleString(lang === 'zh-CN' ? 'zh-CN' : undefined, opts);
}

/** The text in the current language, with `{name}` filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = lang === 'zh-CN' ? (ZH_CN[text] ?? text) : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}
