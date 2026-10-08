/* Plan de docs/DRIVE-MIRROR.md (titres) + tête du fichier, pour écrire le
   compte-rendu de cause racine au bon endroit et au bon format. TEMPORAIRE. */
import { readFileSync } from 'node:fs';

const dump = (file, headLines) => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  console.log(`\n########## ${file} — ${lines.length} lignes ##########`);
  console.log(`--- tête (${headLines}) ---`);
  console.log(lines.slice(0, headLines).map((l, i) => `${i + 1}| ${l}`).join('\n'));
  console.log(`--- titres ---`);
  lines.forEach((l, i) => { if (/^#{1,6} /.test(l)) console.log(`${i + 1}| ${l}`); });
};

dump('README.md', 60);
dump('docs/DRIVE-MIRROR.md', 60);
