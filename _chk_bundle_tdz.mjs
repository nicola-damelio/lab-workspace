/* SONDE — LA MÊME ANALYSE DE PORTÉE (`_tdz_scan_test.mjs`), mais sur les CHUNKS
   du bundle. Elle sert à répondre à une seule question : le nom que le
   navigateur cite (« Cannot access 'dr' before initialization ») est-il une
   lecture AVANT déclaration DANS LE BUNDLE ? Le paquet est minifié, donc le nom
   n'est pas celui du source : on lit la ligne, le nom du chunk, et le texte
   autour pour remonter à la source.
   Usage : node _chk_bundle_tdz.mjs [--only=index] [--name=dr]                 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

const ROOT = process.cwd();
const TEST = readFileSync(join(ROOT, '_tdz_scan_test.mjs'), 'utf8');
const body = TEST.slice(TEST.indexOf('const TDZ_KINDS'), TEST.indexOf('const CONTROLS = ['));
const scanSource = new Function('parseAst', body + '\nreturn scanSource;')(parseAst);

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const name = (process.argv.find((a) => a.startsWith('--name=')) || '').split('=')[1] || '';

const DIR = join(ROOT, 'dist', 'assets');
let files = readdirSync(DIR).filter((f) => /\.(js|mjs)$/.test(f));
if (only) files = files.filter((f) => f.includes(only));

const rows = [];
for (const f of files) {
  const code = readFileSync(join(DIR, f), 'utf8');
  const t0 = Date.now();
  let res;
  try { res = scanSource(join(DIR, f), code); } catch (e) { rows.push(`PANNE ${f}: ${e && e.message}`); continue; }
  const dt = Date.now() - t0;
  if (res.parseError) { rows.push(`PARSE ${f}: ${res.parseError}`); continue; }
  rows.push(`── ${f}  (${Math.round(code.length / 1024)} ko, ${res.refCount} lectures, ${dt} ms)`
    + `  certaines=${res.certain.length} risques=${res.risky.length}`);
  for (const r of res.certain) rows.push(`   CERTAINE  ${r}`);
  for (const r of res.risky) {
    if (!name || new RegExp(`—\\s+${name}\\b`).test(r)) rows.push(`   RISQUE    ${r}`);
  }
}
writeFileSync(join(ROOT, '_chk_bundle_tdz.txt'), rows.join('\r\n'), 'utf8');
console.log(rows.slice(0, 80).join('\n'));
console.log(`\n(${rows.length} lignes · _chk_bundle_tdz.txt)`);
