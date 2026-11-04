import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocksToDocx, crc32, type TextBlock, zipStore } from '../src/index.js';

const unzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const BLOCKS: TextBlock[] = [
  { kind: 'heading', level: 1, text: 'Report <draft> & notes' },
  { kind: 'paragraph', text: '第一段 with "quotes"\u0007 and a bell.' },
  { kind: 'item', text: 'one' },
  { kind: 'pageBreak' },
  { kind: 'heading', level: 2, text: 'Page two' },
  { kind: 'paragraph', text: '  leading spaces' },
];

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it.skipIf(!unzip)('writes a package unzip accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'a.zip');
    writeFileSync(
      file,
      zipStore([
        { name: 'a.txt', data: new TextEncoder().encode('hello') },
        { name: '目录/b.txt', data: new Uint8Array([0, 1, 2]) },
      ]),
    );
    expect(execFileSync('unzip', ['-t', file]).toString()).toMatch(/No errors detected/);
    expect(execFileSync('unzip', ['-p', file, 'a.txt']).toString()).toBe('hello');
  });
});

describe('docx', () => {
  it.skipIf(!unzip)('holds escaped text, heading styles, list items and page breaks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-'));
    const file = join(dir, 'a.docx');
    writeFileSync(file, blocksToDocx(BLOCKS, 'T & T'));
    expect(execFileSync('unzip', ['-t', file]).toString()).toMatch(/No errors detected/);
    const doc = execFileSync('unzip', ['-p', file, 'word/document.xml']).toString();
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain('Report &lt;draft&gt; &amp; notes');
    expect(doc).toContain('第一段 with &quot;quotes&quot; and a bell.'); // control char dropped
    expect(doc).toContain('<w:br w:type="page"/>');
    expect(doc).toContain('<w:pStyle w:val="ListBullet"/>');
    expect(doc).toContain('xml:space="preserve">  leading spaces');
    expect(execFileSync('unzip', ['-p', file, 'docProps/core.xml']).toString()).toContain(
      'T &amp; T',
    );
  });

  it('is reproducible', () => {
    expect(blocksToDocx(BLOCKS)).toEqual(blocksToDocx(BLOCKS));
  });
});
