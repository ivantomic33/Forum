import fs from 'node:fs';
const f = 'docs/dizajn-3.0/03-NEXUS-3.0-Obsidian-Violet-dizajn.html';
let h = fs.readFileSync(f, 'utf8');
const pairs = [
  ["Cilj nije efekat, nego <strong>život</strong>: pozadina se jedva kreće, dovoljno da ekran ne izgleda kao statična slika, a da tekst ostane miran za čitanje. Sve animacije su <em>ispod</em> sadržaja i isključuju se na <code>prefers-reduced-motion</code>.",
    "Cilj nije efekat, nego <strong>život</strong>: pozadina se jedva kreće - dovoljno da ekran ne izgleda kao statična slika, a da tekst ostane miran za čitanje. Sve animacije su <em>ispod</em> sadržaja i isključuju se na <code>prefers-reduced-motion</code>."],
  ['translate3d(6px, -120px, 0 opacity: .2;)', 'translate3d(6px, -120px, 0); opacity: .2;'],
];
let changed = 0;
for (const [from, to] of pairs) {
  if (h.includes(from)) { h = h.replace(from, to); changed++; }
}
fs.writeFileSync(f, h);
console.log('izmena:', changed, '| tick ok:', h.includes('-120px, 0); opacity'), '| em obrisano:', !h.includes('si <em>ispod</em>'));
