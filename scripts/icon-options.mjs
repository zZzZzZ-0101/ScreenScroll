import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';

const OUT = '/home/user/ScreenScroll/docs/icon-options/';
mkdirSync(OUT, { recursive: true });
const T = '#0e7c7b'; // brand teal
const TD = '#0a5f5e';
const TL = '#3c9e9d'; // doodle ink on the tile, low contrast

const tile = (fill = T) => `<rect width="128" height="128" rx="28" fill="${fill}"/>`;
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><clipPath id="t"><rect width="128" height="128" rx="28"/></clipPath></defs>${body}</svg>`;
const ink = (w, c = '#fff') =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// Little doodles for the WhatsApp-wallpaper feel: drawn at (0,0), ~14 px, placed by transform.
const D = {
  star: 'M7 0 L9 5 L14 5.5 L10 9 L11.5 14 L7 11 L2.5 14 L4 9 L0 5.5 L5 5 Z',
  heart: 'M7 13 C2 9 0 6 2 3 C4 0 7 2 7 4 C7 2 10 0 12 3 C14 6 12 9 7 13 Z',
  leaf: 'M1 13 C1 5 6 1 13 1 C13 8 9 13 1 13 Z M1 13 L8 6',
  fish: 'M1 7 C4 2 10 2 13 7 C10 12 4 12 1 7 Z M13 7 L17 3 M13 7 L17 11',
  plane: 'M0 7 L15 0 L10 15 L7 9 Z M7 9 L15 0',
  cloud: 'M3 12 C0 12 0 7 4 7 C4 2 11 2 11 6 C15 5 16 12 12 12 Z',
  moon: 'M10 1 C4 2 2 10 7 13 C11 15 14 12 14 10 C10 12 6 7 10 1 Z',
  dot: 'M7 7 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0',
  cat: 'M2 13 C1 9 1 6 2 2 L5 5 H9 L12 2 C13 6 13 9 12 13 C9 15 5 15 2 13 Z M5 9 h0.1 M9 9 h0.1',
  bird: 'M1 9 C3 4 9 3 12 6 L16 5 L13 8 C12 12 6 14 1 9 Z M9 6 h0.1 M4 9 C6 10 8 10 10 8',
  snail:
    'M1 13 H13 C15 13 15 9 13 9 M8 12 m-5 0 a5 5 0 1 1 10 0 M8 12 m-2 0 a2 2 0 1 1 4 0 M13 9 L14 5 M12 9 L11 5',
  paw: 'M7 13 C3 13 3 8 7 8 C11 8 11 13 7 13 Z M3 6 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M7 4 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M11 6 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0',
};
const doodle = (name, x, y, r = 0, s = 1) =>
  `<path d="${D[name]}" transform="translate(${x} ${y}) rotate(${r} 7 7) scale(${s})" ${ink(1.6 / s, TL)}/>`;

/** Sparse corner doodles (big sizes only). */
const sparse =
  '<g clip-path="url(#t)">' +
  [
    doodle('star', 10, 10, -12),
    doodle('leaf', 104, 12, 20),
    doodle('dot', 8, 104),
    doodle('heart', 106, 104, 10),
    doodle('dot', 100, 60),
    doodle('moon', 14, 58, -20),
  ].join('') +
  '</g>';

/** A full wallpaper of doodles. */
const wallpaper = (() => {
  const names = ['cat', 'star', 'fish', 'leaf', 'bird', 'heart', 'snail', 'paw', 'cloud', 'moon'];
  let out = '';
  let k = 0;
  for (let y = 4; y < 124; y += 22)
    for (let x = (y / 22) % 2 ? 2 : 13; x < 124; x += 24) {
      out += doodle(names[k % names.length], x, y, ((k * 37) % 60) - 30, 0.95);
      k++;
    }
  return `<g clip-path="url(#t)">${out}</g>`;
})();

const dash = (y, w = 5, c = '#fff', x0 = 14, x1 = 114) =>
  `<path d="M${x0} ${y} H${x1}" ${ink(w, c)} stroke-dasharray="${w * 1.6} ${w * 1.5}"/>`;

const options = {
  // ---- Simple ----
  'A-break': {
    name: 'A · Break',
    note: 'Simple. A page and the dashed line where it is cut: what the extension does.',
    big:
      tile() +
      `<rect x="32" y="18" width="64" height="52" rx="7" fill="#fff"/>` +
      `<path d="M44 34 H84 M44 46 H78 M44 58 H70" ${ink(6, T)}/>` +
      dash(82) +
      `<rect x="32" y="94" width="64" height="20" rx="7" fill="#fff"/>` +
      `<path d="M44 104 H80" ${ink(6, T)}/>`,
    small:
      tile() +
      `<rect x="28" y="16" width="72" height="56" rx="9" fill="#fff"/>` +
      dash(86, 9) +
      `<rect x="28" y="98" width="72" height="16" rx="7" fill="#fff"/>`,
  },
  'B-stack': {
    name: 'B · Pages',
    note: 'Simple. One long page coming out as two neat pages.',
    big:
      tile() +
      `<rect x="26" y="16" width="62" height="46" rx="7" fill="none" stroke="#fff" stroke-width="6"/>` +
      `<rect x="40" y="66" width="62" height="46" rx="7" fill="#fff"/>` +
      `<path d="M52 82 H90 M52 94 H82" ${ink(6, T)}/>`,
    small:
      tile() +
      `<rect x="22" y="14" width="66" height="48" rx="8" fill="none" stroke="#fff" stroke-width="10"/>` +
      `<rect x="40" y="66" width="66" height="48" rx="8" fill="#fff"/>`,
  },
  'C-glyph': {
    name: 'C · Glyph',
    note: 'Simplest. No tile: one teal page split in two, like a system icon.',
    big:
      `<rect x="24" y="6" width="80" height="116" rx="14" fill="${T}"/>` +
      `<path d="M40 30 H88 M40 46 H80" ${ink(7)}/>` +
      `<rect x="24" y="64" width="80" height="12" fill="#fff"/>` +
      `<path d="M40 94 H86" ${ink(7)}/>`,
    small:
      `<rect x="20" y="4" width="88" height="120" rx="16" fill="${T}"/>` +
      `<rect x="20" y="60" width="88" height="18" fill="#fff"/>`,
  },
  // ---- Doodle ----
  'D-giraffe': {
    name: 'D · Giraffe',
    note: 'Doodle. The long neck is the long page; it carries on across the page break.',
    big:
      tile() +
      sparse +
      `<path d="M48 128 C50 102 54 74 60 48 M76 128 C76 102 78 76 84 52" ${ink(5)}/>` +
      `<path d="M60 48 C55 37 59 25 70 22 C81 19 96 23 101 31 C105 38 100 45 91 45 C87 45 85 48 84 52" ${ink(5)}/>` +
      `<path d="M70 22 L67 11 M79 21 L80 10" ${ink(5)}/>` +
      `<circle cx="67" cy="9" r="3.5" fill="#fff"/><circle cx="80" cy="8" r="3.5" fill="#fff"/>` +
      `<path d="M64 29 L53 25 L61 35" ${ink(4)}/>` +
      `<circle cx="80" cy="31" r="3.2" fill="#fff"/><circle cx="96" cy="35" r="2" fill="#fff"/>` +
      `<circle cx="64" cy="66" r="4" fill="#fff"/><circle cx="71" cy="100" r="4.5" fill="#fff"/><circle cx="60" cy="114" r="3.5" fill="#fff"/>` +
      dash(84, 4),
    small:
      tile() +
      `<path d="M46 128 C48 100 52 74 58 48 M80 128 C80 102 82 76 88 52" ${ink(10)}/>` +
      `<path d="M58 48 C53 34 60 22 74 20 C88 18 102 26 102 34 C102 42 94 46 88 52" ${ink(10)}/>` +
      `<path d="M72 20 L70 8 M84 19 L86 8" ${ink(9)}/>` +
      dash(88, 8, '#fff', 8, 120),
  },
  'E-snail': {
    name: 'E · Snail',
    note: 'Doodle. Its shell is a scroll; slow and steady, it takes every screen.',
    big:
      tile() +
      sparse +
      (() => {
        // Archimedean spiral for the shell, centre (58, 66).
        let d = '';
        for (let t = 0; t <= 4.6 * Math.PI; t += 0.15) {
          const r = 3 + 2.15 * t;
          const x = 58 + r * Math.cos(t + Math.PI);
          const y = 66 + r * Math.sin(t + Math.PI);
          d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }
        return `<path d="${d}" ${ink(5)}/>`;
      })() +
      `<path d="M18 98 H94 C104 98 110 92 110 84 C110 76 103 71 96 73 C92 74 90 78 90 82" ${ink(5)}/>` +
      `<path d="M98 73 L93 54 M105 75 L110 56" ${ink(4)}/>` +
      `<circle cx="92.5" cy="52" r="3.5" fill="#fff"/><circle cx="110.5" cy="54" r="3.5" fill="#fff"/>` +
      `<path d="M30 106 H40 M50 108 H58" ${ink(3, TL)}/>`,
    small:
      tile() +
      (() => {
        let d = '';
        for (let t = 0; t <= 3.2 * Math.PI; t += 0.15) {
          const r = 4 + 3.1 * t;
          const x = 56 + r * Math.cos(t + Math.PI);
          const y = 62 + r * Math.sin(t + Math.PI);
          d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }
        return `<path d="${d}" ${ink(10)}/>`;
      })() +
      `<path d="M14 100 H96 C106 100 112 92 110 82" ${ink(10)}/>` +
      `<path d="M104 78 L110 56" ${ink(8)}/>`,
  },
  'F-longcat': {
    name: 'F · Long cat',
    note: 'Doodle. A very long cat, one PDF page per half, never cut through the face.',
    big:
      tile() +
      sparse +
      `<path d="M44 42 L46 14 L58 27 H70 L82 14 L84 42 C84 54 76 60 64 60 C52 60 44 54 44 42 Z" ${ink(5)}/>` +
      `<circle cx="56" cy="40" r="3.2" fill="#fff"/><circle cx="72" cy="40" r="3.2" fill="#fff"/>` +
      `<path d="M61 48 L64 51 L67 48 M50 48 H38 M50 52 L39 55 M78 48 H90 M78 52 L89 55" ${ink(2.6)}/>` +
      `<path d="M50 60 V110 C50 119 78 119 78 110 V60" ${ink(5)}/>` +
      `<path d="M78 106 C96 106 102 92 94 80" ${ink(5)}/>` +
      `<path d="M56 112 V117 M72 112 V117" ${ink(3)}/>` +
      dash(84, 4),
    small:
      tile() +
      `<path d="M40 44 L42 12 L56 26 H72 L86 12 L88 44 C88 58 78 64 64 64 C50 64 40 58 40 44 Z" fill="#fff"/>` +
      `<path d="M50 64 V110 C50 120 78 120 78 110 V64" ${ink(10)}/>` +
      dash(90, 8, '#fff', 8, 120),
  },
  'G-wallpaper': {
    name: 'G · Wallpaper',
    note: 'Chat-wallpaper doodles (cats, birds, fish, snails, stars, leaves) behind the simple page. Small sizes show only the page.',
    big:
      tile() +
      wallpaper +
      `<rect x="30" y="20" width="68" height="88" rx="10" fill="#fff" stroke="${TD}" stroke-width="4"/>` +
      `<path d="M42 36 H86 M42 48 H80 M42 82 H84 M42 94 H72" ${ink(6, T)}/>` +
      dash(65, 4, T, 34, 94),
    small:
      tile() +
      `<rect x="26" y="14" width="76" height="100" rx="12" fill="#fff"/>` +
      dash(64, 8, T, 30, 98),
  },
};

const render = (s, size) => {
  const img = new Image();
  img.src = Buffer.from(s);
  const c = createCanvas(size, size);
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  return c;
};

// Contact sheet: per option, 128 · 48 · 32 · 16 on a light and a dark toolbar, and 16 shown 4× (pixels).
const keys = Object.keys(options);
const rowH = 170;
const W = 1100;
const sheet = createCanvas(W, 70 + keys.length * rowH);
const g = sheet.getContext('2d');
g.fillStyle = '#fafafa';
g.fillRect(0, 0, W, sheet.height);
g.fillStyle = '#111';
g.font = 'bold 22px sans-serif';
g.fillText('ScreenScroll icon options', 24, 40);
g.font = '13px sans-serif';
g.fillStyle = '#666';
g.fillText(
  '128 px · 48 · 32 · 16 on light and dark toolbars · 16 px enlarged 4× (real pixels)',
  300,
  40,
);
keys.forEach((k, i) => {
  const o = options[k];
  const y = 70 + i * rowH;
  const big = svg(o.big);
  const small = svg(o.small);
  writeFileSync(`${OUT}${k}.svg`, big);
  writeFileSync(`${OUT}${k}-small.svg`, small);
  g.drawImage(render(big, 128), 24, y);
  g.fillStyle = '#111';
  g.font = 'bold 16px sans-serif';
  g.fillText(o.name, 170, y + 22);
  g.font = '12.5px sans-serif';
  g.fillStyle = '#555';
  const words = o.note.split(' ');
  let line = '';
  let ly = y + 44;
  for (const w of words) {
    if (g.measureText(line + w).width > 300) {
      g.fillText(line, 170, ly);
      ly += 17;
      line = '';
    }
    line += w + ' ';
  }
  g.fillText(line, 170, ly);
  for (const [bx, bg] of [
    [490, '#f1f3f4'],
    [700, '#35363a'],
  ]) {
    g.fillStyle = bg;
    g.fillRect(bx, y + 20, 190, 80);
    let x = bx + 12;
    for (const s of [48, 32, 16]) {
      g.drawImage(render(s >= 48 ? big : small, s), x, y + 60 - s / 2);
      x += s + 18;
    }
  }
  const px = render(small, 16);
  g.imageSmoothingEnabled = false;
  g.drawImage(px, 920, y + 28, 64, 64);
  g.imageSmoothingEnabled = true;
});
writeFileSync(`${OUT}options.png`, sheet.toBuffer('image/png'));
console.log('ok', keys.length);
