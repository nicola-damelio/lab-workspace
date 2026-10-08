/* Inventaire utile : racine (hors fichiers de travail `_…` et `tmp_…`), docs/,
   scripts/, src/ (1 niveau). Fichier TEMPORAIRE. */
import { readdirSync, statSync } from 'node:fs';

const listing = (d, filter = () => true) => readdirSync(d, { withFileTypes: true })
  .filter((e) => filter(e))
  .map((e) => `${e.isDirectory() ? 'D' : 'f'} ${String(statSync(`${d}/${e.name}`).size).padStart(9)}  ${e.name}`);

console.log('=== racine (utile) ===');
console.log(listing('.', (e) => !e.isDirectory() && !/^(_|tmp_)/.test(e.name)).join('\n'));
console.log('\n=== racine (dossiers) ===');
console.log(listing('.', (e) => e.isDirectory() && !/^(node_modules|\.git|dist|_|Restored_canvases)$/.test(e.name)).join('\n'));

for (const d of ['docs', 'scripts', 'server', 'src']) {
  console.log(`\n=== ${d} ===`);
  console.log(listing(d, (e) => !/^tmp_/.test(e.name)).join('\n'));
}
