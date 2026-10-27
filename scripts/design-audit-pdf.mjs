/**
 * NEXUS — DIZAJN AUDIT (PDF, latinica-1 / WinAnsi)
 *
 * Generiše `docs/Dizajn-audit-NEXUS.pdf`: analizu trenutnog vizuelnog identiteta
 * portala + plan za paletu sa više boja, sa konkretnim fajlovima, linijama i
 * tačnim vrednostima tokena.
 *
 * Bez dodatnih zavisnosti: minimalni PDF writer (Helvetica / Helvetica-Bold /
 * Courier), A4, automatsko lomljenje redova i prelazak na novu stranu.
 *
 * Pokretanje: `node scripts/design-audit-pdf.mjs`
 *
 * Napomena o kodiranju: PDF koristi WinAnsi (CP1252). Naše slovo „š“ i sva
 * ćirilična slova UOPŠTE NE POSTOJE u Helvetici bez ugrađenog fonta, pa tekst
 * ostaje na latinici bez kvačica. Zato je funkcija `A()` ispod: sva slova sa
 * kvačicama (č ć ž š đ) prevodi u čistu latinicu (c c z s dj), a crtica „—“ i
 * navodnici idu u ASCII. Tako se u PDF-u NIKAD ne vidi „è“ ili „ą“ (klasičan
 * bug kada se UTF-8 bajtovi mače 0xB9/0xE8 — to su „¹“ i „è“ u CP1252).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'Dizajn-audit-NEXUS.pdf');

/* ==========================================================================
   1. TEKST (prevod u ASCII pre nego što uopšte dođe do PDF-a)
   ========================================================================== */

const MAP = {
  č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj',
  Č: 'C', Ć: 'C', Ž: 'Z', Š: 'S', Đ: 'Dj',
  '—': '-', '–': '-', '„': '"', '”': '"', '“': '"', '’': "'", '…': '...',
  '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '·': '-', '•': '*',
  '×': 'x', '−': '-', '½': '1/2', '²': '2', '→': '->',
};

function A(text) {
  return String(text)
    .replace(/[čćžšđČĆŽŠĐ—–„”“’…≥≤→←·•×−½²]/g, (ch) => MAP[ch] ?? ch)
    .replace(/[^\x20-\x7E]/g, '?');
}

/* ==========================================================================
   2. PDF WRITER (Helvetica, A4 595.28 x 841.89 pt)
   ========================================================================== */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 52;
const CONTENT_W = PAGE_W - MARGIN * 2;

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Širine znakova Helvetica (1/1000 em) — dovoljno za lomljenje redova.
const HELV = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

function width(text, size, bold = false) {
  let total = 0;
  for (const ch of text) {
    const w = HELV[ch] ?? 556;
    total += w * (bold ? 1.055 : 1);
  }
  return (total / 1000) * size;
}

function wrap(text, size, maxWidth, bold = false) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (width(probe, size, bold) <= maxWidth || !current) {
      current = probe;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

class Doc {
  constructor() {
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
    this.pageNo = this.pages.length;
  }

  ensure(height) {
    if (this.y - height < MARGIN + 28) this.newPage();
  }

  text(raw, { size = 10, bold = false, font, color = [0.13, 0.15, 0.2], x = MARGIN, gap = 14, line = 1.42, widthOverride } = {}) {
    const face = font ?? (bold ? 'F2' : 'F1');
    const s = A(raw);
    const maxW = widthOverride ?? CONTENT_W - (x - MARGIN);
    const lines = wrap(s, size, maxW, bold);
    for (const ln of lines) {
      this.ensure(size * line + 4);
      this.ops.push(
        `BT /${face} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ${x} ${(this.y - size).toFixed(2)} Td (${esc(ln)}) Tj ET`,
      );
      this.y -= size * line;
    }
    // `gap` je ukupna visina do SLEDEĆEG bloka: nakon teksta ostaje samo dodatak.
    this.y -= Math.max(gap, 0);
  }

  para(raw, opts = {}) {
    this.text(raw, { size: 10, gap: 12, ...opts });
  }

  bullet(raw, { size = 10, indent = 14, marker = '-', color = [0.13, 0.15, 0.2], gap = 6 } = {}) {
    const s = A(raw);
    const lines = wrap(s, size, CONTENT_W - indent, false);
    this.ensure(size * 1.42 + 4);
    this.ops.push(
      `BT /F1 ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ${MARGIN + 2} ${(this.y - size).toFixed(2)} Td (${esc(marker)}) Tj ET`,
    );
    for (const ln of lines) {
      this.ensure(size * 1.42 + 4);
      this.ops.push(
        `BT /F1 ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ${MARGIN + indent} ${(this.y - size).toFixed(2)} Td (${esc(ln)}) Tj ET`,
      );
      this.y -= size * 1.42;
    }
    this.y -= gap;
  }

  h1(raw) {
    this.ensure(70);
    this.y -= 8;
    // Bazna linija mora biti iznad `this.y` (y raste nagore u PDF-u).
    this.ops.push(`BT /F2 22 Tf 0.08 0.09 0.14 rg ${MARGIN} ${(this.y - 22).toFixed(2)} Td (${esc(A(raw))}) Tj ET`);
    this.y -= 30;
    this.rule([0.49, 0.23, 0.93], 3);
    this.y -= 14;
  }

  h2(raw) {
    this.ensure(46);
    this.y -= 6;
    this.ops.push(`BT /F2 13.5 Tf 0.29 0.13 0.66 rg ${MARGIN} ${(this.y - 13.5).toFixed(2)} Td (${esc(A(raw))}) Tj ET`);
    this.y -= 19;
    this.rule([0.85, 0.86, 0.9], 0.7);
    this.y -= 12;
  }

  h3(raw) {
    this.ensure(30);
    this.y -= 2;
    this.text(raw, { size: 10.5, bold: true, color: [0.1, 0.11, 0.16], gap: 7 });
  }

  rule(color = [0.85, 0.86, 0.9], w = 0.7) {
    this.ops.push(`${color[0]} ${color[1]} ${color[2]} RG ${w} w ${MARGIN} ${this.y.toFixed(2)} m ${PAGE_W - MARGIN} ${this.y.toFixed(2)} l S`);
  }

  /** Tabela: kolone su [naslov, širina]; redovi su nizovi stringova. */
  table(headers, cols, rows, { size = 8.6, headerColor = [0.29, 0.13, 0.66] } = {}) {
    const drawRow = (cells, bold) => {
      const lineSets = cells.map((cell, i) => wrap(A(cell), size, cols[i] - 8, false));
      const height = Math.max(...lineSets.map((l) => l.length)) * size * 1.35 + 6;
      this.ensure(height + 4);
      const yTop = this.y;
      lineSets.forEach((lines, i) => {
        const x = MARGIN + cols.slice(0, i).reduce((a, b) => a + b, 0) + 3;
        lines.forEach((ln, li) => {
          this.ops.push(
            `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${bold ? '0.16 0.1 0.36' : '0.16 0.18 0.24'} rg ${x} ${(yTop - size - li * size * 1.35).toFixed(2)} Td (${esc(ln)}) Tj ET`,
          );
        });
      });
      this.y = yTop - height;
      this.ops.push(`0.88 0.89 0.92 RG 0.5 w ${MARGIN} ${this.y.toFixed(2)} m ${PAGE_W - MARGIN} ${this.y.toFixed(2)} l S`);
    };
    drawRow(headers, true);
    for (const row of rows) drawRow(row, false);
    this.y -= 10;
    void headerColor;
  }

  /** Swatch: obojeni kvadrat + naziv + hex + namena. */
  swatch(label, hex, use, { size = 9, note } = {}) {
    const rgb = hexToRgb(hex);
    const h = 30;
    this.ensure(h + 10);
    const y = this.y;
    this.ops.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} rg ${MARGIN} ${(y - 24).toFixed(2)} 24 24 re f`);
    this.ops.push(`0.8 0.8 0.85 RG 0.5 w ${MARGIN} ${(y - 24).toFixed(2)} 24 24 re S`);
    this.ops.push(`BT /F2 ${size} Tf 0.1 0.11 0.16 rg ${MARGIN + 34} ${(y - 10).toFixed(2)} Td (${esc(A(label))}) Tj ET`);
    this.ops.push(`BT /F3 ${size - 0.5} Tf 0.36 0.38 0.46 rg ${MARGIN + 34 + width(A(label), size, true) + 8} ${(y - 10).toFixed(2)} Td (${esc(A(hex))}) Tj ET`);
    this.ops.push(`BT /F1 ${size - 0.5} Tf 0.36 0.38 0.46 rg ${MARGIN + 34} ${(y - 22).toFixed(2)} Td (${esc(A(use))}) Tj ET`);
    this.y = y - h;
    if (note) {
      this.ops.push(`BT /F1 ${size - 1} Tf 0.5 0.52 0.6 rg ${MARGIN + 34} ${(y - 33).toFixed(2)} Td (${esc(A(note))}) Tj ET`);
      this.y = y - h - 12;
    }
  }

  code(lines) {
    const size = 8.3;
    const height = lines.length * size * 1.45 + 12;
    this.ensure(height + 6);
    const y = this.y;
    this.ops.push(`0.96 0.96 0.98 rg ${MARGIN} ${(y - height).toFixed(2)} ${CONTENT_W} ${height} re f`);
    this.ops.push(`0.88 0.89 0.92 RG 0.6 w ${MARGIN} ${(y - height).toFixed(2)} ${CONTENT_W} ${height} re S`);
    lines.forEach((ln, i) => {
      this.ops.push(
        `BT /F3 ${size} Tf 0.17 0.19 0.26 rg ${MARGIN + 6} ${(y - 12 - size - i * size * 1.45).toFixed(2)} Td (${esc(A(ln))}) Tj ET`,
      );
    });
    this.y = y - height - 8;
  }

  footer() {
    this.pages.forEach((ops, i) => {
      ops.push(`BT /F1 7.5 Tf 0.55 0.57 0.63 rg ${MARGIN} 28 Td (${esc(A('NEXUS - dizajn audit - ' + new Date().toISOString().slice(0, 10)))}) Tj ET`);
      const label = `${i + 1} / ${this.pages.length}`;
      ops.push(`BT /F1 7.5 Tf 0.55 0.57 0.63 rg ${(PAGE_W - MARGIN - width(label, 7.5)).toFixed(2)} 28 Td (${esc(label)}) Tj ET`);
    });
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(4));
}

function buildPdf(doc) {
  doc.footer();
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  // 1 Catalog, 2 Pages, 3-5 fontovi (upisani posle, ali indeksi fiksni)
  const catalogId = add('');
  const pagesId = add('');
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const fontMono = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  const pageIds = [];
  for (const ops of doc.pages) {
    const stream = ops.join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontMono} 0 R >> ` +
      `/ProcSet [/PDF /Text] >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    // CRLF: neki čitači (po spec-u) traže EOL posle `obj` pre početka rečnika.
    pdf += `${i + 1} 0 obj\r\n${body.replace(/\r?\n/g, '\r\n')}\r\nendobj\r\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\r\n0 ${objects.length + 1}\r\n0000 65535 f \r\n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \r\n`;
  pdf += `trailer\r\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\r\nstartxref\r\n${xrefStart}\r\n%%EOF\r\n`;
  return Buffer.from(pdf, 'latin1');
}

/* ==========================================================================
   3. SADRŽAJ AUDITA
   ========================================================================== */

const doc = new Doc();

/* ---------- Naslovna ---------- */
doc.y -= 60;
doc.ops.push(`0.49 0.23 0.93 rg ${MARGIN} ${(doc.y).toFixed(2)} 42 42 re f`);
doc.ops.push(`BT /F2 24 Tf 1 1 1 rg ${MARGIN + 11} ${(doc.y - 30).toFixed(2)} Td (N) Tj ET`);
doc.y -= 70;
doc.text('NEXUS gaming portal', { size: 24, bold: true, color: [0.08, 0.09, 0.14], gap: 6 });
doc.text('Dizajn audit i plan za paletu sa vise boja', { size: 14.5, color: [0.49, 0.23, 0.93], gap: 18 });
doc.rule([0.49, 0.23, 0.93], 1.4);
doc.para(
  'Ovaj dokument je analiza celog web appa sa stanovišta dizajna: kako sada izgleda, ' +
  'zbog cega deluje "tamno i jednobojno", sta treba popraviti i kako da ubacimo vise boja ' +
  'a da portal ostane profesionalan i citljiv.',
  { size: 10.5, gap: 10 },
);
doc.para(
  'Analiza je uradjena nad stvarnim kodom projekta (src/styles/*, src/pages/*, src/components/*) ' +
  'i nad snimcima ekrana iz .qa/ (home, forum, popusti, rang lista, login, mobilna verzija), ' +
  'a ne nad pretpostavkama.',
  { size: 10.5, gap: 18 },
);

doc.table(
  ['Stavka', 'Vrednost'],
  [110, CONTENT_W - 110],
  [
    ['Projekat', 'NEXUS - gaming portal + forum (React 19, TypeScript, Vite, Tailwind v4)'],
    ['Datum analize', new Date().toISOString().slice(0, 10)],
    ['Trenutni pravac', '"Editorial Noir" - tamna osnova, JEDAN violet akcent, cyan/rose/amber samo kao status'],
    ['Glavni problem', 'Jedan akcenat + dominantno sive povrsine = ekran deluje tamno i "spljosten"; identitet bez karaktera'],
    ['Predlog', '"Neon Editorial" - zadrzati tamnu osnovu i smirenost, ali uvesti 4-5 ulogovanih boja po oblasti'],
    ['Obim posla', 'oko 25 izmena u 12-14 fajlova, 3 faze (fondacija -> primene -> poliranje)'],
  ],
);

doc.h3('Sta sve ovaj dokument sadrzi');
doc.bullet('Stanje trenutne palete i pravila dizajna koja su je zakljucala u jednu boju.');
doc.bullet('Nalaz po stranici sta ne valja i zasto (sa fajlovima i linijama).');
doc.bullet('Predlog nove palete sa tacnim hex kodovima i ulogom svake boje.');
doc.bullet('Detaljan spisak zadataka, redom po fazama, sa fajlovima, klasama i kodom.');
doc.bullet('Checklist za verifikaciju pre i posle izmene i finalnu listu akcija.');

doc.newPage();

/* ---------- 1. Trenutno stanje ---------- */
doc.h1('1. Trenutno stanje - diagnostika');

doc.h2('1.1 Osnovna paleta (src/styles/tokens.css)');
doc.para(
  'Ceo portal vuce boje iz jednog fajla. Povrsine su gotovo crne, akcentna boja je samo violet, ' +
  'a sve ostale boje su proglasene statusnim i skoro se ne koriste:',
);
doc.swatch('surface-0', '#0b0d14', 'pozadina stranice (skoro crna, blago plava)', {
  note: 'surface-1 do surface-4 su sve nijanse iste skoro-crne (#12151f ... #2b3144)',
});
doc.swatch('primary', '#7c3aed', 'violet - JEDINA akcija i akcent na ekranu');
doc.swatch('secondary', '#06b6d4', 'cyan - dozvoljen SAMO za status (online, live, "novo")');
doc.swatch('tertiary', '#f43f5e', 'rose - SAMO istekao rok / opasno stanje');
doc.swatch('success', '#10b981', 'emerald - potvrda, online avatar prsten');
doc.swatch('warning', '#f59e0b', 'amber - "na cekanju", esports badge');
doc.y -= 6;

doc.h2('1.2 Pravila koja su uvela jednobojnost');
doc.para(
  'Redizajn oznacen kao 2.8.0 ("EDITORIAL NOIR") je namerno uklonio sarolikost. Pravila su u komentarima, ' +
  'ali ih i lint skripte cuvaju:',
);
doc.bullet('tokens.css, uvodni komentar: "jedna primarna akcija po ekranu, kartice odvojene 1px ivicom".');
doc.bullet('theme.css: "jedan akcent po ekranu (violet = akcija; cyan/emerald/rose/amber = samo status)".');
doc.bullet('ui-kit.css: aktivni tab i primarni CTA su jedina dva mesta sa glow-om; sve ostalo je 1px ivica + neutralna senka.');
doc.bullet('badge sistem (ui-kit.css, Badge.tsx): badge je proglasen "meta podatkom", pa su sekundarni / warning tonovi svedeni na sivu povrsinu (surface-2).');
doc.bullet('scripts/check-css-tokens.mjs odbija svaki novi hex / rgba van tokens.css - to je dobro, samo se nove boje moraju upisati u tokene.');

doc.h2('1.3 Gde se boja ipak gubi');
doc.table(
  ['Mesto', 'Sta se desava sada'],
  [170, CONTENT_W - 170],
  [
    ['Navbar (Navbar.tsx)', 'Samo violet indikator aktivne stavke i datum u micro-bar-u; sve ostalo je sivo-crno.'],
    ['Pocetna (HomeMagazine.tsx)', 'Hero, kartice i lista su iste sivkaste povrsine; razlikuju se samo slikom i velicinom teksta.'],
    ['Kategorije (Badge.tsx / categoryTone)', '5 razlicitih kategorija deli 3 tona, a "Vesti" i "Liste" nemaju svoj ton - padaju na sivo.'],
    ['Forum (ForumPage.tsx)', 'Kartice foruma su jedna boja; nema razlikovanja sekcija po boji.'],
    ['Popusti (DealsPage.tsx, DealCard.tsx)', 'Procena popusta je u violetu (ista boja kao sve akcije), urgentni deal je jedva vidljiva rose ivica.'],
    ['Rang lista (LeaderboardBoard.tsx)', 'Zlatna/srebrna/bronzana rang boja je svedena na istu sivu karticu; jedini "prsten" je violet.'],
    ['Login / Register (auth-shell)', 'Tamna kartica na tamnoj pozadini - malo dubine, bez boje brenda.'],
    ['Auth stranice, Article/Thread komentari', 'U JSX-u je hardkodovano bg-[#0D101D]/75 i bg-[#06070E]/80 - to je boja koja NIJE u tokenima i ne menja se sa temom.'],
  ],
);

doc.h2('1.4 Tehnicki dug vezan za dizajn (lako se popravlja usput)');
doc.bullet('Hardkodovane boje u TSX: bg-[#0D101D]/75 u ForumPage.tsx:211, ThreadPage.tsx:582/828/832/876, ArticlePage.tsx:339/505/536/656, Navbar.tsx:127. One zaobilaze temu i light mode.');
doc.bullet('Dva izvora istine za badge: .ui-badge-primary / -secondary / -warning / -neutral / -featured su definisane dva puta u ui-kit.css (oko linije 249 i oko linije 1403). Drugi blok gazi prvi.');
doc.bullet('Mrtvi tokeni: --gradient-cyber, --gradient-prestige, --gradient-cyber-vertical, --color-depth-indigo / -violet / -cyan se skoro nigde ne koriste - idealan materijal za novu paletu.');
doc.bullet('base.css ima dupliran blok za .forge-grain i #root (linije 55-120) - ne utice na boju, ali cistiti pri istom poslu.');
doc.bullet('Footer.tsx jos koristi stare Tailwind boje (violet-500, cyan-400, emerald-400, slate-400) umesto tokena - iskace iz teme.');
doc.bullet('ArticlePage.tsx:285 koristi text-cyan-400 za kategoriju - cyan je po pravilima samo status.');

doc.newPage();

/* ---------- 2. Predlog palete ---------- */
doc.h1('2. Predlog: "Neon Editorial" paleta');

doc.para(
  'Cilj nije da portal postane saren, nego da dobije 4-5 jasno ulogovanih boja koje nose znacenje: ' +
  'svaka oblast portala ima svoju boju, a primarna akcija ostaje jedna. Time se dobija zivost bez haosa.',
  { size: 10.5, gap: 10 },
);

doc.h2('2.1 Osnovne povrsine - malo toplije, sa "vazduha"');
doc.para(
  'Trenutne povrsine su skoro crne i hladne. Pomeranje ka tamno-indigo/ljubicastom tamnom tonu daje ' +
  'dubljinu i bolji kontrast sa neonom. Ovo je najveci vizuelni dobitak za najmanje posla.',
);
doc.swatch('surface-0 (novo)', '#0d0a1a', 'pozadina stranice - tamno ljubicasti ink');
doc.swatch('surface-1 (novo)', '#15112b', 'kartice (default) - vidljivo svetlije od pozadine');
doc.swatch('surface-2 (novo)', '#1e1940', 'hover / unutrasnjost kartice');
doc.swatch('surface-3 (novo)', '#2a2354', 'aktivno, segment, chip');
doc.swatch('surface-4 (novo)', '#362c6b', 'najsvetliji sloj, broj badge-a');
doc.y -= 4;

doc.h2('2.2 Ulogovane boje (svaka ima svoju oblast)');
doc.swatch('Violet / primary', '#8b5cf6', 'glavna akcija: "Objavi", "Prijavi se", aktivni tab');
doc.swatch('Cyan / arena', '#22d3ee', 'PC Gaming sekcija, online status, "live", hardver badge');
doc.swatch('Amber / deals', '#fbbf24', 'POPUSTI: cena, -% , "istice danas" - amber = para i akcija');
doc.swatch('Emerald / community', '#34d399', 'forum, rang lista, reputacija, uspeh, "reseno"');
doc.swatch('Rose / alert', '#fb7185', 'greske, istekao deal, ban, opasne akcije (ne za dekoraciju)');
doc.swatch('Rose -> violet / prestige', '#fb7185 -> #8b5cf6', 'sampion, top 3, featured/predstavi teme');
doc.y -= 4;

doc.para(
  'Pravilo koje ostaje (i cuva profesionalnost): violet je JEDINA boja glavne akcije na ekranu. ' +
  'Ostale boje su "ambijentalne" - nose zonu ili status, ne takmici se za klik. U praksi to znaci: ' +
  'na Popustima je primary = amber (jer je tamo glavna stvar popust), ali dugme "Objavi popust" " ' +
  'ostaje violet da bude jasno da je to akcija.',
);

doc.h2('2.3 Raspodela po stranicama');
doc.table(
  ['Stranica / oblast', 'Dominantna boja', 'Gde se vidi'],
  [150, 120, CONTENT_W - 270],
  [
    ['Pocetna', 'violet + amber', 'violet eyebrow i hero CTA, amber cene i -% u "Najbolji popusti danas"'],
    ['Forum (lista)', 'cyan', 'ikona kategorije u cyan chip-u, cyan broj odgovora, emerald "reseno"'],
    ['Popusti', 'amber', 'profitna cena, -% pilula, "istice danas", amber aktivni tab filtera'],
    ['Rang lista', 'rose -> violet (prestige)', 'zlatna = #fbbf24, srebro = #cbd5e1, bronza = #f97316, prsten svetlosti'],
    ['Profil', 'emerald + violet', 'emerald XP traka i nivo, violet bedz role, brand boje platformi'],
    ['Login / Register', 'violet', 'gradijentni pas "brand side", violet dugme, blagi violet sjaj u pozadini'],
    ['Novosti / clanak', 'cyan (kategorija)', 'kategorija u cyan badge-u, amber ocena recenzije'],
  ],
);

doc.para(
  'Ovim se dobija: pocetna ima ritam (violet -> slika -> amber), forum je prepoznatljivo "cyan zona", ' +
  'popusti su topli (amber), rang lista je svecana (zlato/srebro/bronza). Korisnik po boji zna gde je.',
);

doc.newPage();

/* ---------- 3. Konkretne izmene ---------- */
doc.h1('3. Plan izmena - detaljno, redom');

doc.h2('FAZA 1 - Fondacija (1-2h, jedan fajl + light tema)');
doc.h3('3.1 tokens.css - nova skala povrsina i nova uloga boja');
doc.code([
  '/* src/styles/tokens.css - @theme */',
  '--color-surface-0: #0d0a1a;   /* pozadina */',
  '--color-surface-1: #15112b;   /* kartice */',
  '--color-surface-2: #1e1940;   /* hover */',
  '--color-surface-3: #2a2354;',
  '--color-surface-4: #362c6b;',
  '',
  '/* Ulogovane boje - iste vrednosti, jaca namena */',
  '--color-primary: #8b5cf6;',
  '--color-primary-hover: #a78bfa;',
  '--color-secondary: #22d3ee;   /* cyan = PC/online */',
  '--color-deal: #fbbf24;        /* NOVO - amber zona popusta */',
  '--color-deal-fg: #fcd34d;',
  '--color-community: #34d399;   /* NOVO - emerald zona zajednice */',
  '--color-community-fg: #6ee7b7;',
  '--color-gold-rank: #fbbf24;   /* rang 1 */',
  '--color-silver-rank: #cbd5e1; /* rang 2 */',
  '--color-bronze-rank: #f97316; /* rang 3 */',
  '--color-tertiary: #fb7185;    /* rose = alert */',
  '',
  '/* Ambijentalni sloj - iskoristi postojece, nekoriscene tokene */',
  '--color-depth-indigo: rgba(124, 58, 237, 0.22);',
  '--color-depth-violet: rgba(34, 211, 238, 0.16);',
  '--color-depth-amber:  rgba(251, 191, 36, 0.10);',
  '--gradient-brand: linear-gradient(135deg, #8b5cf6 0%, #22d3ee 100%);',
  '--gradient-deal:  linear-gradient(180deg, rgba(251,191,36,.16) 0%, transparent 100%);',
]);
doc.bullet('Svaku vrednost menjati SAMO ovde - lint (check-css-tokens.mjs) i baseline cuvaju da se hex ne razmaze po komponentama.');
doc.bullet('Ako se menja --color-primary, proveriti kontrast teksta na njemu (beli tekst na #8b5cf6 prolazi AA za 16px+).');

doc.h3('3.2 theme.css - light tema mora da isprati iste tokene');
doc.bullet('U [data-theme="light"] bloku dodati nove ulogovane tokene za svetlu temu: --color-deal: #b45309, --color-community: #047857, --color-gold-rank: #b45309.');
doc.bullet('Dodati svetle vrednosti za surface-0..4 (topli beli: #fbf9ff, #ffffff, #f3effc, #e7e1f7, #d9d0f0).');
doc.bullet('Proveriti pravilo :root[data-theme="light"] nav.sticky i .ui-card da i dalje pobeđuju (oni vec postoje).');

doc.h3('3.3 base.css - ambijent pozadine');
doc.bullet('body: umesto ravnog gradijenta, dodati dva radijalna sloja (violet gore-levo, cyan dole-desno) preko linearne osnove. Koristiti --color-depth-* tokene.');
doc.bullet('Pojacati mrezu (body::before) sa 0.03 na 0.05 vidljivosti i maskirati ka centru - dobija se "cyber" tekstura bez buke.');
doc.bullet('Obrisati duplirani blok .forge-grain / #root (base.css, oko linije 76-120).');

doc.h2('FAZA 2 - Primene u komponentama (4-6h)');
doc.h3('3.4 Navbar.tsx - boja u identitetu');
doc.bullet('Logo: zameniti bg-[var(--color-primary)] gradientom --gradient-brand (violet -> cyan), dodati blagi glow (--shadow-glow).');
doc.bullet('Svaka nav stavka dobija svoju tick boju na hover/aktivno: Forum = cyan, Popusti = amber, Rang lista = rose, ostalo violet. Realizacija: CSS varijabla na <Link> (style={{ ["--nav-accent"]: "var(--color-secondary)" }}) + u feature.css: nav.sticky a:hover .nav-tick { background: var(--nav-accent); }.');
doc.bullet('Micro-bar: datum u text-tertiary, "NEXUS Portal" u violet, plus mali amber chip "3 nova popusta" (ako postoji broj) - to je prva topla boja na ekranu.');
doc.bullet('Zameniti hardkodovano bg-[#06070E]/80 (linija 127) sa var(--glass-bg).');

doc.h3('3.5 Pocetna - ritam boja po sekcijama');
doc.bullet('Hero: eyebrow (kategorija) u boji kategorije (cyan za PC, amber za hardver, rose za konzole), CTA "Procitaj" violet.');
doc.bullet('Sekcija "Najbolji popusti danas": naslov sekcije sa amber crtom ispod (koristiti --color-deal), DealCard cena u amberu (PriceTag: .price-tag-value { color: var(--color-deal-fg) } u kontekstu .deal-card).');
doc.bullet('Sekcija "Forum u fokusu": emerald eyebrow i emerald ikona u .thread-row-icon (sada je violet).');
doc.bullet('Razlikovati sekcije debljom levom ivicom 3px u boji zone (opcija: lagani "rail" levo od naslova) - bez novih okvira oko svake kartice.');

doc.h3('3.6 Forum - cyan zona');
doc.bullet('U ForumPage.tsx:211 zameniti bg-[#0D101D]/75 sa bg-[var(--color-surface-1)] i skinuti backdrop-blur (nije dozvoljen na karticama).');
doc.bullet('Kartice kategorija (forum-cat-card): ikona u cyan chip-u, hover ivica cyan umesto violet.');
doc.bullet('Badge "pinned" - cyan, "hot" - amber, "locked" - rose, "reseno" - emerald; to vec postoji u temi, samo treba dodeliti u ThreadRow.');
doc.bullet('Broj odgovora u mono fontu u cyan boji - odmah "zivlja" lista.');

doc.h3('3.7 Popusti - amber zona (najveci dobitak)');
doc.bullet('DealCard.tsx:44 -% pilula: bg amber (--color-deal) sa tamnim tekstom, umesto sada sivo-crvene.');
doc.bullet('PriceTag: cena u amber-fg, original precrtan u text-muted, "istice danas" u rose.');
doc.bullet('DealsPage - aktivni tab filtera u amber (posebna klasa .ui-tab.is-deal-active) da se ne mesa sa violet CTA dugmetom.');
doc.bullet('Sekcija filtera: blaga amber pozadina (--gradient-deal) u zaglavlju, da stranica bude "topla".');

doc.h3('3.8 Rang lista - prestige boje');
doc.bullet('LeaderboardBoard.tsx:284-286 - ukloniti bg-[#e2e8f0] (svetlo-siva) i uvesti --color-gold-rank / -silver-rank / -bronze-rank za prsten i pozadinu avatara.');
doc.bullet('Pobednik (1. mesto): dvostruki prsten zlato + violet glow + mala kruna ikona u zlatu.');
doc.bullet('Medalje u MedalRow: boje po rangu, ostalo neutralno.');

doc.h3('3.9 Login / Register - prvi utisak');
doc.bullet('auth-shell: levi "brand" panel sa --gradient-brand i velikim logom; desni panel cist surface-1.');
doc.bullet('Dugme "Prijavi se" violet sa glow-om; linkovi u cyan (ne violet) da dugme ostane jedina akcija.');
doc.bullet('Ukloniti hardkodovane tamne hexove iz auth-backdrop-image i koristiti --color-surface-*.');

doc.h3('3.10 Profil, Admin, Notifikacije');
doc.bullet('Profil: XP traka emerald (nivo = napredak), bedz role violet, brand boje platformi (Steam/Discord/YouTube) ostaju kakve jesu - to su autenticne boje, dobro je da se vide.');
doc.bullet('Admin: upozorenja amber, opasne akcije rose, "reseno" emerald. Tabele ostaviti neutralne.');
doc.bullet('Notifikacije: neproc itano u cyan tacki, sistemske poruke u violet chip-u.');

doc.newPage();

/* ---------- 4. Badge i tokens pravila ---------- */
doc.h1('4. Badge sistem i pravila (da ne bude sarenilo)');

doc.para(
  'Najveci rizik kod "vise boja" je da svaki bedz bude druga boja. Zato badge dobija FIKSNU skalu od 7 tonova, ' +
  'i nijedan ekran ne sme da koristi vise od 3 tona istovremeno.',
);
doc.table(
  ['Ton', 'Boja', 'Kada se koristi'],
  [90, 110, CONTENT_W - 200],
  [
    ['primary', 'violet #8b5cf6', 'kategorija clanka (opste vesti), LVL, recenzija'],
    ['secondary', 'cyan #22d3ee', 'hardver, PC, "online", "live"'],
    ['warning', 'amber #fbbf24', 'popust, "istice danas", "na cekanju"'],
    ['success', 'emerald #34d399', 'reseno, odobreno, "verified"'],
    ['error', 'rose #fb7185', 'konzole (PS/Xbox/Nintendo), greska, ban'],
    ['featured', 'gradijent rose -> violet', 'predstavljena tema, top 3, sampion'],
    ['neutral', 'surface-2 + sivi tekst', 'sve meta: datum, broj pregleda, tagovi'],
  ],
);

doc.h3('Zaduzenja po fajlovima');
doc.bullet('ui-kit.css: obrisati DUPLI blok badge definicija (drugi blok, oko linije 1399-1455) i zadrzati jedan - sa novim bojama. Warning vise ne sme da bude surface-2 (siva) nego amber sa 14% alpha pozadinom.');
doc.bullet('Badge.tsx / categoryTone(): prosiriti mapiranje - "vesti"/"news" -> primary, "liste"/"lista" -> secondary, "esport" -> warning, "najave" -> neutral.');
doc.bullet('ui-tab.is-active: violet OSTAJE za navigacione tabove; za filtere u zoni popusta uvesti .ui-tab.is-active-deal (amber pozadina, tamni tekst).');

doc.h2('4.1 Pravila koja cuvaju kvalitet');
doc.bullet('1 akcent = 1 akcija. Na ekranu postoji najvise JEDAN pun violet (ili amber, u deals zoni) CTA.');
doc.bullet('Boja nikad nije jedini nosilac informacije - uz nju ide ikona ili tekst (pristupacnost za daltoniste).');
doc.bullet('Kontrast: tekst na obojenoj povrsini >= 4.5:1 (za 16px+), >= 3:1 za velike naslove. Amber i gold traze TAMAN tekst.');
doc.bullet('Ne vise od 3 akcentne boje iznad preloma ekrana.');
doc.bullet('Gradijenti samo na: logo, featured bedz, auth panel, hero fade. Nigde u dugmadima i karticama.');

doc.h2('4.2 Kako se sve to tehicki cuva');
doc.bullet('Nove boje idu u tokens.css (+ light varijante u theme.css). Ne u tsx i ne u druge css fajlove.');
doc.bullet('Skripta scripts/check-css-tokens.mjs ce odbiti hex van tokena - to je zastita, ne prepreka.');
doc.bullet('Dodati u baseline (scripts/qa/css-token-baseline.mjs) samo ako se broj postojecih prekrsaja smanjuje; nikad da raste.');
doc.bullet('Za Tailwind: ako se boja koristi kao klasa (npr. text-deal), dodati u @theme --color-deal pa ce Tailwind generisati text-deal / bg-deal.');

doc.newPage();

/* ---------- 5. Redosled rada ---------- */
doc.h1('5. Redosled rada i procena');

doc.table(
  ['Faza', 'Sta se radi', 'Fajlovi', 'Vreme'],
  [52, 230, 175, CONTENT_W - 457],
  [
    ['F1', 'Nova paleta tokena + svetla tema + ambijent pozadine', 'tokens.css, theme.css, base.css', '1-2h'],
    ['F1', 'Ukidanje hardkodovanih boja iz TSX', 'Navbar, ForumPage, ThreadPage, ArticlePage', '1h'],
    ['F2', 'Badge sistem (jedan blok, 7 tonova, nova mapa kategorija)', 'ui-kit.css, Badge.tsx', '1h'],
    ['F3', 'Navbar + pocetna (boje zona, amber deals sekcija)', 'Navbar.tsx, feature.css, HomeMagazine.tsx, StoryCard', '2h'],
    ['F3', 'Forum (cyan zona) i Popusti (amber zona)', 'ForumPage.tsx, DealsPage.tsx, DealCard.tsx, PriceTag', '2-3h'],
    ['F3', 'Rang lista (zlato/srebro/bronza) i profil (emerald XP)', 'LeaderboardBoard.tsx, MedalRow.tsx, ProfileHeader', '1-2h'],
    ['F4', 'Login/Register brand panel, Footer na tokene, admin/notifikacije', 'auth-shell, Footer.tsx, AdminDashboard', '1-2h'],
    ['F5', 'Snimci svih strana (desktop + mobilni + light), korekcije', '.qa/, playwright', '1-2h'],
  ],
);
doc.para('Ukupno: 10-15 sati rada u 5 faza. Posle F1-F2 portal vec izgleda drugacije; F3 donosi prepoznatljivost.', {
  size: 10,
  gap: 14,
});

doc.h2('5.1 Verifikacija (obavezno posle svake faze)');
doc.bullet('npm run lint - TypeScript bez gresaka.');
doc.bullet('npm run lint:css - token provera; broj prekrsaja ne sme da poraste.');
doc.bullet('npm run test - server testovi.');
doc.bullet('Snimci: /, /forum, /deals, /leaderboard, /login u 1440 i 390 px, tamna I svetla tema (.qa/dizajn-*.png).');
doc.bullet('Provera kontrasta za par najvaznijih parova (amber na tamnom, tamni tekst na amber dugmetu, sivi tekst na surface-1).');
doc.bullet('Baterija: 1 akcent po ekranu, najvise 3 boje iznad preloma, nijedan tekst ispod 4.5:1.');

doc.newPage();

doc.h1('6. Checklist - brzi pregled svih zadataka');

const checks = [
  'tokens.css: nova skala surface-0..4 (topliji indigo tonovi)',
  'tokens.css: novi ulogovani tokeni --color-deal, --color-community, --color-gold/silver/bronze-rank',
  'tokens.css: --gradient-brand (violet -> cyan) i --gradient-deal',
  'tokens.css: iskoristiti postojece --color-depth-* za ambijent (sada mrtvi)',
  'theme.css: iste nove tokene upisati u [data-theme="light"] sa tamnijim varijantama',
  'base.css: pozadina sa dva radijalna sloja + jaca mreza, obrisan dupli .forge-grain blok',
  'Navbar.tsx: logo gradient + glow, nav tick boja po sekciji, hardkodovani #06070E -> token',
  'feature.css: pravilo za hover/aktivni nav tick (var(--nav-accent))',
  'ui-kit.css: obrisati duplikat badge bloka, nova skala od 7 tonova, amber za warning',
  'ui-kit.css: .ui-tab.is-active-deal (amber varijanta za filtere popusta)',
  'Badge.tsx: categoryTone() pokriva Vesti, Liste, Najave, Esports',
  'Pocetna: eyebrow u boji kategorije, amber crta kod popusta, emerald forum sekcija',
  'StoryCard: eyebrow badge nosi boju kategorije; hover naslova ostaje violet',
  'DealCard/PriceTag: amber cena i -%, rose za istek, uklonjen sivi overlay',
  'DealsPage: amber aktivni filter tab, topla pozadina zaglavlja',
  'ForumPage: kartice bez hardkodovane boje i bez backdrop-blur, cyan ikone i hover',
  'ThreadRow: cyan za odgovore, emerald "reseno", rose "zakljucano"',
  'LeaderboardBoard: zlato/srebro/bronza prsten umesto #e2e8f0, prestige kruna za 1. mesto',
  'Profile: emerald XP traka i nivo, violet role bedz, brand boje platformi ostaju',
  'Auth: brand panel sa gradientom, cyan linkovi, violet CTA',
  'Footer.tsx: Tailwind boje -> tokeni (violet-500, cyan-400, emerald-400, slate-400)',
  'ArticlePage.tsx: text-cyan-400 kategorija -> badge token; hardkodovani #0D101D -> surface token',
  'ThreadPage.tsx: 4 komada bg-[#0D101D]/75 -> surface-1, bez backdrop-blur',
  'Snimci: 5 strana x 2 sirine x 2 teme, pregled i korekcija',
  'npm run lint, lint:css, test - sve zeleno',
];
for (const item of checks) doc.bullet(item, { marker: '[ ]', size: 9.6, gap: 4 });

doc.y -= 6;
doc.h2('Sta NE raditi');
doc.bullet('Ne uvoditi gradijente na dugmad i kartice - to je bilo uklonjeno sa razlogom.');
doc.bullet('Ne uvoditi "glow" na svaku karticu - glow ostaje samo za CTA i aktivni tab.');
doc.bullet('Ne dirati zelenu boju online statusa, crvenu za greske i brand boje platformi (Steam, Discord, YouTube).');
doc.bullet('Ne stavljati vise od jedne "jake" boje u istu karticu.');

doc.y -= 10;
doc.rule([0.49, 0.23, 0.93], 1);
doc.para(
  'Zakljucak: portal nije "lose dizajniran", nego je namerno sveden na jednu boju. Najbrzi put do zivljeg ' +
  'izgleda je popravka fonda (toplije povrsine + ambijent), zatim ulogovane boje po zonama (amber popusti, ' +
  'cyan forum, prestige rang lista) i na kraju badge sistem sa 7 tonova. Bez hazarda i bez gubitka citljivosti.',
  { size: 10.5, gap: 6 },
);

const pdf = buildPdf(doc);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, pdf);
console.log(`OK: ${path.relative(process.cwd(), OUT)} (${doc.pages.length} strana, ${(pdf.length / 1024).toFixed(1)} KB)`);
