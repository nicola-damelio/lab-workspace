/* =========================================================================
   _probe_state_now.mjs — LECTURE SEULE (aucune écriture, aucun dossier créé).

   Répond, sur les données VIVANTES, à des questions précises :
     ① les projets BadH / BidH / cyclinA_H sont-ils dans la COPIE du dataset
        (`_workspace/datasets/ds_ds_1788383774488.json`), celle que chaque poste
        relit quand le cloud ne répond pas ?
     ② les 6 expériences retrouvées (fichier de reprise local) sont-elles
        revenues dans la copie ?
     ③ la copie porte-t-elle des expériences qui se déclarent d'un des trois
        projets (l'autre moitié du lien) ?

   Usage : node _probe_state_now.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const COPY_NAME = 'ds_ds_1788383774488.json';
const OUT = '_probe_state_now.txt';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }

const download = async (id) => {
  const res = await fetch(`${API}/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? await res.text() : '';
};
const decode = (raw, isCompressed) => {
  let s = String(raw || '');
  if (isCompressed || (!s.startsWith('{') && !s.startsWith('['))) {
    for (const dec of [
      () => LZString.decompressFromUTF16(s),
      () => LZString.decompressFromBase64(s),
      () => LZString.decompress(s)
    ]) {
      try { const d = dec(); if (d) { s = d; break; } } catch { /* suivante */ }
    }
  }
  try { return JSON.parse(s); } catch { return null; }
};

/* ① LA COPIE VIVE (recherche trashed=false : la corbeille n'est jamais lue) */
const listRes = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(`name='${COPY_NAME}' and trashed=false`)}`
  + `&fields=${encodeURIComponent('files(id,name,size,modifiedTime,createdTime)')}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const found = ((await listRes.json().catch(() => ({}))).files || []);
say(`════ ① LA COPIE VIVE — ${COPY_NAME} ════`);
found.forEach((f) => say(`   • id=${f.id}  ${Math.round(Number(f.size || 0) / 1024)} Ko  modifié=${f.modifiedTime}`));
if (!found.length) { say('   ✖ copie absente.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }

const envelope = decode(await download(found[0].id), false) || {};
const record = envelope.record || envelope;
const content = record.payload ? decode(record.payload, record.isCompressed !== false) : null;
if (!content) { say('   ✖ charge illisible.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }
say(`   enveloppe : ${JSON.stringify({ kind: envelope.kind, at: envelope.at, isCompressed: record.isCompressed, updatedAt: record.updatedAt })}`);
say(`   charge    : tests=${(content.tests || []).length} · projets=${(content.projects || []).length}`);

const projects = Array.isArray(content.projects) ? content.projects : [];
const tests = Array.isArray(content.tests) ? content.tests : [];
say(`\n   ▸ PROJETS de la copie (${projects.length}) :`);
projects.forEach((p) => say(`      • ${p.name || p.id}  (${((p.experiments) || []).length} entrée(s) · scientist=${p.scientist || '—'})`));

const WANT = ['BadH', 'BidH', 'cyclinA_H'];
say(`\n   ▸ ① LES TROIS PROJETS CHERCHÉS (comparaison insensible à la casse) :`);
WANT.forEach((w) => {
  const hit = projects.filter((p) => String(p.name || '').trim().toLowerCase() === w.toLowerCase());
  say(`      ${hit.length ? '✔' : '✖'} « ${w} » : ${hit.length ? hit.map((p) => p.name).join(', ') : 'ABSENT de la copie'}`);
});
say(`      projets de la copie : ${projects.map((p) => String(p.name || '').trim()).join(' | ')}`);

/* ② LES 6 EXPÉRIENCES DE LA REPRISE (nom + id d'origine) */
const RECOVERED = [
  { name: 'pdb_Bad_BCL-XL', id: 't17915013096201399', project: 'BadH' },
  { name: 'pdb_Bcl-XL_Bid', id: 't17915001326217901', project: 'BidH' },
  { name: 'pdb_CDK2_CyclinA', id: 't17915016474816788', project: 'cyclinA_H' },
  { name: 'pdb_Mdm2_p53', id: 't17914952328471224', project: 'p53H' },
  { name: 'pdb_PD1_PDL1', id: 't17915023284364463', project: 'PD1-PDL1' },
  { name: 'Test 85', id: 't17915002806849126', project: 'BidH' }
];
const byId = new Map(tests.map((t) => [String(t && t.id), t]));
const byName = new Map(tests.map((t) => [String((t && t.name) || '').trim(), t]));
say(`\n════ ② LES 6 EXPÉRIENCES DE LA REPRISE — revenues dans la copie ? ════`);
let back = 0;
RECOVERED.forEach((r) => {
  const t = byId.get(r.id) || byName.get(r.name);
  if (t) back += 1;
  say(`   ${t ? '✔ PRÉSENTE' : '✖ ABSENTE '} « ${r.name} »  id=${r.id}  (projet visé : ${r.project})`
    + (t ? `  → copie : nom=« ${t.name} »  projectNames=${JSON.stringify(t.projectNames ?? null)}  operator=${t.operator || '—'}` : ''));
});
say(`   → ${back}/6 présentes dans la copie.`);

/* ③ NOMS ANNEXES (renommages vus sur le Drive) */
const ALIASES = ['Test 86', 'Test 87', 'Test 88', 'Pd1', 'pdb', 'pdb_', 'pdb_BadH'];
say(`\n════ ③ NOMS ANNEXES (le Drive les portait) ════`);
ALIASES.forEach((n) => say(`   ${byName.has(n) ? '✔' : '✖'} « ${n} »`));

/* ④ EXPÉRIENCES QUI SE DÉCLARENT D'UN DES TROIS PROJETS (côté TEST) */
say(`\n════ ④ EXPÉRIENCES QUI SE DÉCLARENT D'UN DES TROIS PROJETS (côté TEST) ════`);
const claiming = tests.filter((t) => (Array.isArray(t && t.projectNames) ? t.projectNames : [])
  .some((n) => WANT.some((x) => String(n).trim().toLowerCase() === x.toLowerCase())));
say(`   ${claiming.length} expérience(s) :`);
claiming.forEach((t) => say(`      • « ${t.name} »  id=${t.id}  projectNames=${JSON.stringify(t.projectNames)}`));

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`\n→ rapport : ${OUT}`);
