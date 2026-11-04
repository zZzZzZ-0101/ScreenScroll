import type { TextBlock } from './markdown.js';
import { zipStore } from './zip.js';

/**
 * M8: the capture's text as a Word document, from the same blocks as Markdown: Heading 1–3
 * styles (so Word's navigation pane and table of contents work), list items with a bullet,
 * and a page break where document pages end.
 */
export function blocksToDocx(blocks: readonly TextBlock[], title = ''): Uint8Array {
  const enc = new TextEncoder();
  const body = blocks.map(block).join('');
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body || '<w:p/>'}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`;
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'word/document.xml', data: enc.encode(document) },
    { name: 'word/styles.xml', data: enc.encode(STYLES) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(DOC_RELS) },
    { name: 'docProps/core.xml', data: enc.encode(core(title)) },
  ]);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function block(b: TextBlock): string {
  if (b.kind === 'pageBreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  if (b.kind === 'heading')
    return `<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(3, Math.max(1, b.level))}"/></w:pPr>${run(b.text)}</w:p>`;
  if (b.kind === 'item')
    return `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>${run(`•\t${b.text}`)}</w:p>`;
  return `<w:p>${run(b.text)}</w:p>`;
}

function run(text: string): string {
  // A tab is its own element in WordprocessingML; xml:space keeps leading spaces.
  return text
    .split('\t')
    .map((part) => (part ? `<w:r><w:t xml:space="preserve">${xml(part)}</w:t></w:r>` : ''))
    .join('<w:r><w:tab/></w:r>');
}

function xml(s: string): string {
  // Characters XML 1.0 forbids (most C0 controls) would make Word refuse the whole file.
  return Array.from(s)
    .filter((c) => {
      const n = c.codePointAt(0)!;
      return (n >= 0x20 || n === 0x09 || n === 0x0a || n === 0x0d) && n !== 0xfffe && n !== 0xffff;
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function core(title: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `</Relationships>`;

const DOC_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

function heading(level: number, size: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/>` +
  `<w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
  `</w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  heading(1, 36) +
  heading(2, 30) +
  heading(3, 26) +
  `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style>` +
  `</w:styles>`;
