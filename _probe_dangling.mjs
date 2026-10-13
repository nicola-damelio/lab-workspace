/* =========================================================================
   _probe_dangling.mjs — LECTURE SEULE (aucune écriture, aucun dossier créé).

   L'INVENTAIRE DES LIENS ROMPUS de la copie vive du dataset :
     · chaque projet, ses ENTRÉES (`experiments[].testId`) et si le test
       correspondant existe encore dans `tests` ;
     · les entrées ORPHELINES (le projet cite un id que `tests` ne porte plus)
       — c'est exactement la trace d'une expérience perdue ;
     · les tests qui ne sont cités par aucun projet (l'autre moitié du lien) ;
     · les opérateurs distincts, et les tests de chacun.

   Usage : node _probe_dangling.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const COPY_NAME = 'ds_ds_1788383774488.json';
const OUT = '_probe_dangling.txt';

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

const listRes = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(`name='${COPY_NAME}' and trashed=false`)}`
  + `&fields=${encodeURIComponent('files(id,name,size,modifiedTime)')}`, {
  headers: { Authorization: `Bearer ${token}` }
});
const file = ((await listRes.json().catch(() => ({}))).files || [])[0];
if (!file) { say('✖ copie absente.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }
const envelope = decode(await download(file.id), false) || {};
const record = envelope.record || envelope;
const content = record.payload ? decode(record.payload, record.isCompressed !== false) : null;
const projects = Array.isArray(content && content.projects) ? content.projects : [];
const tests = Array.isArray(content && content.tests) ? content.tests : [];
say(`copie ${COPY_NAME} · modifiée ${file.modifiedTime} · charge écrite à ${envelope.at || '—'}`);
say(`tests=${tests.length} · projets=${projects.length} · access=${JSON.stringify(content.access || null)}`);
say(`createdBy=${JSON.stringify(content.createdBy || null)} · createdByRole=${content.createdByRole || '—'}`);

const byId = new Map(tests.map((t) => [String(t && t.id), t]));
const nameOf = (t) => String((t && t.name) || '').trim();
const entriesOf = (p) => (Array.isArray(p && p.experiments) ? p.experiments : []);

/* ① CHAQUE PROJET ET SES ENTRÉES */
say(`\n════ ① LES ENTRÉES DE CHAQUE PROJET (le lien vu du côté PROJET) ════`);
const dangling = [];
const cited = new Set();
projects.forEach((p) => {
  const rows = entriesOf(p);
  say(`\n   ▸ « ${nameOf(p) || p.id} »  scientist=${p.scientist || '—'}  ${rows.length} entrée(s)  [id=${p.id}]`);
  rows.forEach((e) => {
    const id = String((e && (e.testId || e.id)) || '');
    const t = byId.get(id);
    if (id) cited.add(id);
    if (!t && id) dangling.push({ project: nameOf(p) || p.id, testId: id, row: e });
    say(`      ${t ? '✔' : '✖'} testId=${id}`
      + `  nom=${JSON.stringify((e && (e.name || e.testName)) || null)}`
      + `  instance=${(e && (e.instanceName || e.instance)) || '—'}`
      + `  → ${t ? `TEST PRÉSENT (« ${nameOf(t)} »)` : 'TEST ABSENT du dataset'}`);
  });
});

/* ② LES ENTRÉES ORPHELINES, EN CLAIR */
say(`\n════ ② ENTRÉES ORPHELINES (un projet cite un test que « tests » ne porte plus) ════`);
say(`   ${dangling.length} entrée(s) :`);
dangling.forEach((d) => say(`   ✖ projet « ${d.project} » → testId=${d.testId}  row=${JSON.stringify(d.row)}`));
const danglingIds = [...new Set(dangling.map((d) => d.testId))];
say(`   ids distincts : ${danglingIds.length} → ${danglingIds.join(', ')}`);

/* ③ LES TESTS SANS PROJET (l'autre moitié du lien) */
const isBox = (t) => String((t && t.type) || '').trim() === 'plate-9x9box';
const projectsOf = (t) => (Array.isArray(t && t.projectNames) ? t.projectNames : [])
  .map((s) => String(s || '').trim()).filter(Boolean);
const orphans = tests.filter((t) => !isBox(t) && projectsOf(t).length === 0);
say(`\n════ ③ EXPÉRIENCES SANS PROJET (côté test) : ${orphans.length} ════`);
orphans.forEach((t) => say(`   ✖ « ${nameOf(t)} » id=${t.id} type=${t.type || '—'}`
  + ` operator=${t.operator || '—'} catégorie=${t.testCategory || '—'}`));

/* ④ LES OPÉRATEURS ET LEURS TESTS (qui a quoi ?) */
const ops = new Map();
tests.forEach((t) => {
  const k = String((t && t.operator) || '—');
  if (!ops.has(k)) ops.set(k, []);
  ops.get(k).push(t);
});
say(`\n════ ④ OPÉRATEURS ET LEURS TESTS ════`);
[...ops.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([op, list]) => {
  say(`\n   ▸ ${op} : ${list.length} test(s)`);
  list.forEach((t) => say(`      • « ${nameOf(t)} » id=${t.id} type=${t.type || '—'} projectNames=${JSON.stringify(t.projectNames ?? null)}`));
});

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`\n→ rapport : ${OUT}`);
