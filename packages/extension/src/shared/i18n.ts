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
  if (lang === 'en') return text;
  const m = /^Page (\d+): ([\s\S]*)$/.exec(text);
  if (m) return t('Page {n}: {text}', { n: m[1]!, text: tMsg(m[2]!) });
  const f = /^Capture failed: ([\s\S]*)$/.exec(text);
  if (f) return t('Capture failed: {why}', { why: tMsg(f[1]!) });
  if (text in ZH_CN) return t(text);
  // Messages with numbers in them are keyed with {0}, {1}… in their place.
  const nums: string[] = [];
  const key = text.replace(/\d+(?:\.\d+)?/g, (n) => `{${nums.push(n) - 1}}`);
  const zh = ZH_CN[key];
  return zh ? zh.replace(/\{(\d+)\}/g, (_, i: string) => nums[Number(i)] ?? '') : text;
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
