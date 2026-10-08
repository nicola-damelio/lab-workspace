/* Cherche où le plan (phases 2–6) a été consigné : docs, racine, fichiers tmp_.
   TEMPORAIRE. */
import { readdirSync, readFileSync, statSync } from 'node:fs';

const targets = [];
for (const e of readdirSync('.')) {
  if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
  const s = statSync(e);
  if (s.isFile() && /\.(md|txt|mjs|cjs|js|json)$/i.test(e)) targets.push(e);
}
for (const e of readdirSync('docs')) targets.push(`docs/${e}`);

const re = /(phase\s*[2-6]\b|drive-first|drive first|source de v[ée]rit[ée]|single source of truth|backups? structur|sauvegardes? structur|validated restore|restauration valid[ée]e|macro.{0,40}(deux|two) couleurs|two colours|deux couleurs)/i;
const hits = [];
for (const f of targets) {
  let text = '';
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  text.split(/\r?\n/).forEach((l, i) => {
    if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 170)}`);
  });
}
console.log(`fichiers examinés : ${targets.length} · lignes retenues : ${hits.length}`);
console.log(hits.slice(0, 120).join('\n'));
