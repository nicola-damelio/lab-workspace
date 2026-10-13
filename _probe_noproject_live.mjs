/* =========================================================================
   _probe_noproject_live.mjs — LECTURE SEULE. Qui est « l'expérience sans
   Projet » que le message de connexion signale ?

   Le message vient de `validateDatasetExperiments` (src/utils/experimentRules.js),
   appelé par `runWeeklyBackup` (src/App.jsx) sur `latestDataRef.current.tests`.
   Sa règle, mot pour mot dans le code :
     · `isExperimentTest(t)`        = t.type !== 'plate-9x9box' (les bacs exclus) ;
     · `experimentHasProject(t)`    = `t.projectNames` contient au moins un nom
                                      non vide — REGARDÉ DU CÔTÉ DU TEST SEUL ;
     · manquant = expérience && !projectNames.

   Cet outil lit la COPIE VIVE du dataset sur le Drive (recherche
   `trashed=false` : la corbeille n'est jamais ni lue ni citée) et compte, avec
   la règle ci-dessus, les expériences sans projet. Il dit aussi si le PROJET,
   lui, connaît l'expérience (`projects[].experiments[]`) — le lien s'écrit des
   deux côtés, et un seul côté écrit donne exactement ce message.

   Rien n'est écrit sur le Drive. Usage : node _probe_noproject_live.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const OUT = '_recover_noproject_live.txt';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }

const listAll = async (q, fields = 'files(id,name,mimeType,size,modifiedTime,parents,createdTime)') => {
  const out = [];
  let pageToken = '';
  do {
    const res = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(q)}`
      + `&fields=${encodeURIComponent(`nextPageToken,${fields}`)}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await res.json().catch(() => ({}));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};
const download = async (id) => {
  const res = await fetch(`${API}/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? await res.text() : '';
};
const decode = (raw, isCompressed) => {
  let s = String(raw || '');
  if (isCompressed || (!s.startsWith('{') && !s.startsWith('['))) {
    for (const dec of [() => LZString.decompressFromUTF16(s), () => LZString.decompressFromBase64(s), () => LZString.decompress(s)]) {
      try { const d = dec(); if (d) { s = d; break; } } catch { /* suivante */ }
    }
  }
  try { return JSON.parse(s); } catch { return null; }
};

/* ── les copies de datasets (LECTURE : trashed=false) ───────────────────── */
say('════ LES COPIES DE DATASET SUR LE DRIVE (« trashed=false ») ════');
const copies = (await listAll("name contains '.json' and trashed=false and mimeType='application/json'"))
  .filter((f) => /^ds_.*\.json$/i.test(f.name));
say(`   copies vues : ${copies.length}`);
copies.forEach((f) => say(`   • ${f.name}  id=${f.id}  ${Math.round(Number(f.size || 0) / 1024)} Ko  modifié=${String(f.modifiedTime).slice(0, 16)}`));

copies.sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
for (const copy of copies) {
  say(`\n════ ${copy.name} (modifié ${String(copy.modifiedTime).slice(0, 19)}) ════`);
  const rec = decode(await download(copy.id), false);
  if (!rec || typeof rec !== 'object') { say('   (illisible)'); continue; }
  /* La copie vive est un ENREGISTREMENT (`{ kind, at, record }`) : le contenu
     est dans `record.payload` (compressé), exactement comme le lit l'app. */
  const record = rec.record || rec;
  const content = record && record.payload
    ? decode(record.payload, record.isCompressed !== false)
    : (rec.tests || rec.projects ? rec : null);
  if (!content) { say(`   (charge illisible — clés du record : ${Object.keys(record || {}).join(', ')})`); continue; }
  const tests = Array.isArray(content.tests) ? content.tests : [];
  const projects = Array.isArray(content.projects) ? content.projects : [];
  say(`   datasetId=${content.id || rec.id || '—'} · titre=${content.title || '—'}`);
  say(`   tests=${tests.length} · projets=${projects.length} · clés racine : ${Object.keys(content).slice(0, 12).join(', ')}`);

  /* LA RÈGLE DE L'APPLICATION, appliquée telle quelle. */
  const isExperimentTest = (t) => !!t && String(t.type || '').trim() !== 'plate-9x9box';
  const projectsOf = (t) => (Array.isArray(t && t.projectNames) ? t.projectNames : [])
    .map((s) => String(s || '').trim()).filter(Boolean);
  const missing = tests.filter((t) => isExperimentTest(t) && projectsOf(t).length === 0);
  say(`   ▸ expériences (hors bacs) : ${tests.filter(isExperimentTest).length} · SANS projet : ${missing.length}`);
  missing.forEach((t) => {
    /* le PROJET connaît-il l'expérience ? (l'autre moitié du lien) */
    const owners = projects.filter((p) => ((p && p.experiments) || [])
      .some((e) => e && String(e.testId) === String(t.id)))
      .map((p) => String(p.name || p.id || '?'));
    say(`      ✖ « ${t.name} »  id=${t.id}  instance=${t.instanceName || '—'}  type=${t.type || '—'}`
      + `  projectNames=${JSON.stringify(t.projectNames ?? null)}`);
    say(`         le PROJET le connaît-il ? ${owners.length ? `OUI → ${owners.join(', ')}` : 'NON — aucun projet ne le liste'}`);
    say(`         clés du test : ${Object.keys(t).slice(0, 16).join(', ')}`);
  });
  /* Le compte des expériences vues depuis le PROJET (l'autre moitié) */
  say(`   ▸ projets : ${projects.map((p) => `${p.name || p.id}(${((p.experiments) || []).length} entrées)`).join(' · ') || '—'}`);
}

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
say(`\n→ ${OUT}`);
