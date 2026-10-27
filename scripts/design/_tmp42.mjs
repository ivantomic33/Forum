import fs from 'node:fs';
const f = 'docs/dizajn-3.0/03-NEXUS-3.0-Obsidian-Violet-dizajn.html';
let h = fs.readFileSync(f, 'utf8');
h = h.replace('    pre .c { color: #6F6A93; }',
    '    pre .c { color: #6F6A93; }\n    pre, pre code, .shot .url, .sg .hx { font-feature-settings: "liga" 0, "clig" 0; }');
fs.writeFileSync(f, h);
console.log('ok', h.includes('font-feature-settings'));
