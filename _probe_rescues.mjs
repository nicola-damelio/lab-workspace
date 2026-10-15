/* Sonde jetable : les items réels des fichiers de reprise (_recover/*.json),
   décompressés, avec leur id et leur nom — pour savoir quels ids portent
   plusieurs noms DANS QUELLES fichiers. */
import { readFileSync, readdirSync } from 'node:fs';
import LZString from 'lz-string';

const decompress = (doc) => {
  const raw = doc && doc.payload;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw) return null;
  const tries = [() => LZString.decompressFromUTF16(raw), () => LZString.decompress(raw), () => raw];
  for (const t of tries) {
    try {
      const s = t();
      if (typeof s !== 'string' || !s) continue;
      const p = JSON.parse(s);
      if (p && typeof p === 'object') return p;
    } catch { /* essai suivant */ }
  }
  return null;
};

const files = readdirSync('_recover').filter((f) => f.toLowerCase().endsWith('.json')).sort();
files.forEach((f) => {
  let doc = null;
  try { doc = JSON.parse(readFileSync(`_recover/${f}`, 'utf8')); } catch { return; }
  const payload = decompress(doc);
  const list = payload && (payload.tests || payload.plates);
  if (!Array.isArray(list) || !list.length) return;
  console.log(`\n${f}`);
  list.filter(Boolean).forEach((t) => console.log(`   id=${String(t.id || '')}  name=${String(t.name || '')}`));
});

/* La base telle que le contrôle la construit : tous les fichiers SAUF le plus
   récent, dédoublonnés par NOM. Combien d'ids y portent plusieurs noms ? */
const rescues = [];
files.forEach((f) => {
  let doc = null;
  try { doc = JSON.parse(readFileSync(`_recover/${f}`, 'utf8')); } catch { return; }
  const payload = decompress(doc);
  const list = payload && (payload.tests || payload.plates);
  if (!Array.isArray(list) || !list.length) return;
  const date = (f.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || String(doc.savedAt || '');
  rescues.push({ file: f, date, items: list.filter(Boolean).map((t) => ({ id: String(t.id || ''), name: String(t.name || '') })) });
});
rescues.sort((a, b) => String(a.date).localeCompare(String(b.date)));
const rescueLike = rescues.filter((r) => /experiences-retrouvees/i.test(r.file));
const newest = (rescueLike.length ? rescueLike[rescueLike.length - 1] : rescues[rescues.length - 1]) || null;
const applied = rescues.filter((r) => r !== newest);
const byName = new Map();
applied.flatMap((r) => r.items).forEach((t) => { if (!byName.has(t.name)) byName.set(t.name, t); });
const base = Array.from(byName.values());
const byId = new Map();
base.forEach((t) => { if (!byId.has(t.id)) byId.set(t.id, []); byId.get(t.id).push(t.name); });
console.log(`\n── BASE (tous les fichiers sauf « ${newest && newest.file} »), par nom : ${base.length} ligne(s)`);
base.forEach((t) => console.log(`   id=${t.id}  name=${t.name}`));
const twinsInBase = Array.from(byId.entries()).filter(([, n]) => n.length > 1);
console.log(`   → ids portant PLUSIEURS noms DANS LA BASE : ${twinsInBase.length}`);
twinsInBase.forEach(([id, n]) => console.log(`      ${id} → ${n.join(' + ')}`));
