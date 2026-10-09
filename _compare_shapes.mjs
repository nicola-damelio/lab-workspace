/* _compare_shapes.mjs — LECTURE SEULE. Question unique : la charge d'un
   fichier-objet du Drive (`object.data`) a-t-elle la MÊME FORME qu'un élément de
   `state.tests` (une expérience de l'application) ? Sans cette réponse, un
   fichier de reprise pourrait être refusé (ou pire, mal migré) par l'import.

   On compare donc : les clés d'un `tests[]` de la COPIE
   (`_workspace/datasets/ds_ds_<id>.json`, décodée comme le fait l'application) et
   les clés des `object.data` retenus.

   Usage : node _compare_shapes.mjs */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import LZString from 'lz-string';

const OUT = '_shape_check.txt';
const lines = [];
const say = (s = '') => lines.push(String(s));

/* Retrouve la copie VIVANTE sur le Drive (elle n'est pas posée dans le dossier).
   `trashed=false` : la corbeille n'est jamais lue. */
const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const COPY_NAME = 'ds_ds_1788383774488.json';

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }

const found = await (async () => {
  const q = encodeURIComponent(`name='${COPY_NAME}' and trashed=false`);
  const res = await fetch(`${API}/drive/v3/files?q=${q}&fields=files(id,name,size,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  return (j.files || []);
})();
say(`# Formes — ${new Date().toISOString()}`);
say(`## La copie vivante sur le Drive : ${found.length} fichier(s) nommé(s) ${COPY_NAME}`);
found.forEach((f) => say(`   • id=${f.id}  ${Math.round(Number(f.size || 0) / 1024)} Ko  ${f.modifiedTime}`));
if (!found.length) { writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); console.log(`→ ${OUT}`); process.exit(0); }

const resMedia = await fetch(`${API}/drive/v3/files/${found[0].id}?alt=media`,
  { headers: { Authorization: `Bearer ${token}` } });
const doc = JSON.parse(await resMedia.text());

const decode = (payload, compressed = true) => {
  let raw = String(payload || '');
  if (compressed || (!raw.startsWith('{') && !raw.startsWith('['))) {
    for (const dec of [
      () => LZString.decompressFromUTF16(raw),
      () => LZString.decompressFromBase64(raw),
      () => LZString.decompress(raw)
    ]) { try { const d = dec(); if (d) { raw = d; break; } } catch { /* suivante */ } }
  }
  try { return JSON.parse(raw); } catch { return null; }
};

const rec = doc.record || doc;
const state = decode(rec.payload, !(rec.isCompressed === false)) || {};
const tests = Array.isArray(state.tests) ? state.tests : [];
say(`\n## La copie`);
say(`   • kind=${doc.kind}  datasetId=${state.id}  titre=${JSON.stringify(state.title || state.datasetTitle || '')}`);
say(`   • state.tests : ${tests.length} élément(s)`);
if (tests[0]) say(`   • clés d'un tests[0] (${Object.keys(tests[0]).length}) : ${Object.keys(tests[0]).join(', ')}`);
say(`   • clés du state (${Object.keys(state).length}) : ${Object.keys(state).slice(0, 30).join(', ')}`);

/* Les objets du Drive retenus. */
const mat = existsSync('_recover/recoverable_experiments.json')
  ? JSON.parse(readFileSync('_recover/recoverable_experiments.json', 'utf8')) : { recoverable: [] };
const rows = Array.isArray(mat.recoverable) ? mat.recoverable : [];
const sample = (rows[0] && rows[0].object && rows[0].object.data) || {};
say(`\n## La charge d'un fichier-objet (exemple : ${rows[0] ? rows[0].name : '—'})`);
say(`   • clés (${Object.keys(sample).length}) : ${Object.keys(sample).join(', ')}`);

if (tests[0]) {
  const a = new Set(Object.keys(sample));
  const b = new Set(Object.keys(tests[0]));
  const onlyObj = [...a].filter((k) => !b.has(k));
  const onlyCop = [...b].filter((k) => !a.has(k));
  say(`\n## Comparaison`);
  say(`   • présentes des DEUX côtés : ${[...a].filter((k) => b.has(k)).length}`);
  say(`   • seulement dans l'objet  (${onlyObj.length}) : ${onlyObj.join(', ') || '—'}`);
  say(`   • seulement dans la copie (${onlyCop.length}) : ${onlyCop.join(', ') || '—'}`);
  const shared = [...a].filter((k) => b.has(k));
  say(`\n   état des instances dans la copie (tests[0].instances ? ${Array.isArray(tests[0].instances) ? `oui, ${tests[0].instances.length}` : 'non'})`);
}
/* ── La comparaison qui DÉCIDE : pour chaque fichier-objet, le test de la copie
   dont les clés se superposent le plus. Si un test de la copie a exactement les
   clés de l'objet, la charge est un test COMPLET (pas une projection partielle) et
   l'import la prendra telle quelle. */
say(`\n## Objet ↔ test de la copie : meilleure superposition`);
rows.forEach((r) => {
  const d = (r.object && r.object.data) || {};
  const a = Object.keys(d);
  let best = null;
  tests.forEach((t) => {
    const b = new Set(Object.keys(t || {}));
    const hit = a.filter((k) => b.has(k)).length;
    if (!best || hit > best.hit) best = { t, hit, keys: b };
  });
  if (!best) return;
  const miss = a.filter((k) => !best.keys.has(k));
  say(`\n   • « ${r.name} » (${a.length} clés, catégorie ${d.testCategory || '—'}, type ${d.type || '—'})`);
  say(`     meilleur test : « ${best.t.name} » (catégorie ${best.t.testCategory || '—'}, type ${best.t.type || '—'})`
    + `  → ${best.hit}/${a.length}`);
  say(`     ${miss.length ? `${miss.length} clé(s) ABSENTE(S) du test : ${miss.join(', ')}` : 'aucune clé manquante : forme identique ✔'}`);
});



/* Les 6 expériences distinctes (un id = une expérience ; plusieurs noms = des
   renommages historiques, la PLUS RÉCENTE génération faisant foi). */
const byId = new Map();
rows.forEach((r) => {
  const id = r.object && r.object.id;
  const at = String((r.object && r.object.savedAt) || '');
  const cur = byId.get(id);
  if (!cur || at > cur.at) byId.set(id, { at, name: r.name, generations: r.generations });
});
say(`\n## Les ${rows.length} fichiers-objets = ${byId.size} expérience(s) distincte(s) (id unique) :`);
[...byId.entries()].forEach(([id, v]) => {
  const names = rows.filter((r) => r.object && r.object.id === id).map((r) => `${r.name}(${r.generations})`);
  say(`   • ${id}  état le plus récent : « ${v.name} »  ${v.at}   noms sur le Drive : ${names.join(', ')}`);
});

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`→ ${OUT}`);
