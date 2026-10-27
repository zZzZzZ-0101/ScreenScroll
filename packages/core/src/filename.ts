export const DEFAULT_FILENAME_TEMPLATE = '{title}_{yyyy}-{mm}-{dd}_{HHmm}';

export interface FilenameInfo {
  title: string;
  url: string;
  date: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * PDF_OUTPUT §7: fills the template and makes the result safe as a Windows file name.
 * Tokens: {title} {domain} {url} {yyyy} {mm} {dd} {HH} {min} {HHmm}. Unknown tokens stay as typed.
 */
export function buildFilename(template: string, info: FilenameInfo, ext: string): string {
  let domain: string;
  try {
    domain = new URL(info.url).hostname.replace(/^www\./, '');
  } catch {
    domain = '';
  }
  const d = info.date;
  const tokens: Record<string, string> = {
    title: info.title.trim() || domain || 'capture',
    domain,
    url: info.url,
    yyyy: String(d.getFullYear()),
    mm: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    min: pad(d.getMinutes()),
    HHmm: pad(d.getHours()) + pad(d.getMinutes()),
  };
  const filled = template.replace(/\{(\w+)\}/g, (m, k: string) => tokens[k] ?? m);
  return `${sanitizeFilename(filled)}.${ext}`;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_CHARS = 150;

/** Windows-safe base name (no extension): keeps Unicode, e.g. Chinese titles. */
export function sanitizeFilename(name: string): string {
  let s = name
    .replace(/\s+/g, ' ')
    // Characters Windows forbids, plus control characters.
    // eslint-disable-next-line no-control-regex -- control characters are exactly the target
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim();
  // Cap by code points so surrogate pairs (emoji, rare CJK) are never split.
  const chars = Array.from(s);
  if (chars.length > MAX_CHARS) s = chars.slice(0, MAX_CHARS).join('');
  // Windows strips trailing dots and spaces, which can collide names; remove them ourselves.
  s = s.replace(/[. ]+$/, '');
  if (!s) s = 'capture';
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}
