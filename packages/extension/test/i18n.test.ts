import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLang, setLang, t, tMsg } from '../src/shared/i18n';
import { ZH_CN } from '../src/shared/zh-CN';
import { SETTINGS } from '../src/shared/settings-schema';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('interface languages', () => {
  it('auto follows the browser; Chinese variants get Simplified Chinese', () => {
    expect(resolveLang('auto', 'zh-CN')).toBe('zh-CN');
    expect(resolveLang('auto', 'zh-TW')).toBe('zh-CN');
    expect(resolveLang('auto', 'en-GB')).toBe('en');
    expect(resolveLang('en', 'zh-CN')).toBe('en');
  });
  it('translates, fills values, and falls back to English', () => {
    setLang('zh-CN');
    expect(t('Save PDF')).toBe('保存 PDF');
    expect(t('{n} pages', { n: 13 })).toBe('13 页');
    expect(t('Something not translated yet')).toBe('Something not translated yet');
    setLang('en');
    expect(t('{n} pages', { n: 13 })).toBe('13 pages');
  });
  it('messages made elsewhere: page notes, numbers in place, unknown ones as written', () => {
    setLang('zh-CN');
    expect(tMsg('Page 3: an element taller than one page was split.')).toBe(
      '第 3 页：一个比一页还高的元素被切开了。',
    );
    expect(tMsg('You stopped the capture after 12 screens; the rest was not captured.')).toBe(
      '你在截了 12 屏后停止了截图；其余部分没有截取。',
    );
    expect(tMsg('Capture failed: No tab to capture.')).toBe('截图失败：没有可截图的标签页。');
    expect(tMsg('Something new 42')).toBe('Something new 42');
    setLang('en');
    expect(tMsg('Page 3: an element taller than one page was split.')).toBe(
      'Page 3: an element taller than one page was split.',
    );
  });
  it('every string the interface passes to t(), and every setting, has a translation', () => {
    const missing = new Set<string>();
    for (const f of sources(join(__dirname, '../src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\b(?:t|tr)\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        const s = m[1]!.replace(/\\'/g, "'");
        if (!(s in ZH_CN)) missing.add(s);
      }
      // Plurals and other choices: t(n === 1 ? 'one' : 'many', …).
      for (const m of src.matchAll(/\b(?:t|tr)\(\s*[^'(),]+\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
        for (const s of [m[1]!, m[2]!].map((x) => x.replace(/\\'/g, "'")))
          if (!(s in ZH_CN)) missing.add(s);
      }
    }
    for (const e of SETTINGS) {
      for (const s of [e.section, e.label, e.help, e.why, ...(e.choices ?? []).map((c) => c.label)])
        if (s && !(s in ZH_CN) && !/^[A-Z]\d|^\d|^[A-Z]{1,3}\d*$/.test(s)) missing.add(s);
    }
    expect([...missing]).toEqual([]);
  });
});
