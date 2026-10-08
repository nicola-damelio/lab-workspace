/* Écrit le plan de DRIVE-MIRROR.md dans un fichier, à lire avec l'outil de
   lecture (la console PowerShell abîme les accents). TEMPORAIRE. */
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync('docs/DRIVE-MIRROR.md', 'utf8').split(/\r?\n/);
const out = [`total ${lines.length} lignes`, '--- titres ---'];
lines.forEach((l, i) => { if (/^#{1,6} /.test(l)) out.push(`${i + 1}| ${l}`); });
out.push('--- 60 dernières lignes ---');
out.push(...lines.slice(-60).map((l, i) => `${lines.length - 60 + i + 1}| ${l}`));
writeFileSync('tmp_doc_headings.txt', out.join('\n'), 'utf8');
console.log('ok');
