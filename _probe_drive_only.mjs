/* =========================================================================
   _probe_drive_only.mjs — LECTURE SEULE (aucune écriture, aucun dossier créé).

   L'INVENTAIRE « LE DRIVE PORTE, LE DATASET NE PORTE PAS » :
     · toutes les entrées du Drive (`trashed=false`) sont listées UNE fois
       (fichiers + dossiers), les chemins reconstruits depuis `parents` ;
     · les fichiers-objets d'expérience (`<Test>/<instance>/<Test>.json`) sont
       comparés aux tests de la copie vive du dataset ;
     · ce qui reste → « sur le Drive et pas dans le dataset », avec sa DATE :
       c'est là qu'on voit une publication récente.

   Aucune charge n'est téléchargée : noms, chemins et dates seulement.
   Usage : node _probe_drive_only.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';
const COPY_NAME = 'ds_ds_1788383774488.json';
const OUT = '_probe_drive_only.txt';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }

const listPage = async (q, fields) => {
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

/* ① LA LISTE COMPLÈTE DU DRIVE (une seule fois) */
const all = await listPage('trashed=false', 'files(id,name,mimeType,size,modifiedTime,createdTime,parents)');
say(`════ ① LE DRIVE — ${all.length} entrée(s) (trashed=false) ════`);
const byId = new Map(all.map((f) => [f.id, f]));
const pathOf = (f) => {
  const parts = [];
  let cur = f;
  let guard = 0;
  while (cur && guard < 20) {
    parts.unshift(cur.name);
    const p = (cur.parents || [])[0];
    cur = p ? byId.get(p) : null;
    guard += 1;
  }
  return parts.join('/');
};
const isFolder = (f) => f.mimeType === FOLDER;

/* ② LA COPIE VIVE : la liste NUE des tests du dataset */
const copyFile = (await listPage(`name='${COPY_NAME}' and trashed=false`, 'files(id,name,size,modifiedTime)'))[0];
if (!copyFile) { say('✖ copie du dataset absente : rien à confronter.'); writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); process.exit(0); }
const envelope = decode(await download(copyFile.id), false) || {};
const record = envelope.record || envelope;
const content = record.payload ? decode(record.payload, record.isCompressed !== false) : null;
const tests = Array.isArray(content && content.tests) ? content.tests : [];
const projectNames = (Array.isArray(content && content.projects) ? content.projects : [])
  .map((p) => String((p && p.name) || '').trim()).filter(Boolean);
say(`   copie ${COPY_NAME} · modifiée ${copyFile.modifiedTime} · tests=${tests.length} · projets=${projectNames.length}`);
say(`   projets : ${projectNames.join(' | ')}`);

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const testNames = new Set(tests.map((t) => norm(t && t.name)).filter(Boolean));

/* ③ LES FICHIERS-OBJETS D'EXPÉRIENCE DU DRIVE
   Un fichier-objet porte le nom de son DOSSIER : `…/<Test>/<instance>/<Test>.json`
   (ou `…/<Test>/<Test>.json`). Tout le reste — `_meta.json`, images, figures —
   n'est pas un objet d'expérience et ne doit pas entrer dans la comparaison. */
say(`\n════ ② LES FICHIERS-OBJETS D'EXPÉRIENCE SUR LE DRIVE ════`);
const isObjectFile = (f) => {
  if (isFolder(f) || !/\.json$/i.test(f.name)) return false;
  const p = pathOf(f);
  if (/^_workspace\//.test(p)) return false;
  const segs = p.split('/');
  const leaf = String(f.name).replace(/\.json$/i, '');
  const instance = segs[segs.length - 2] || '';
  if (leaf === '_meta') return false;
  /* un OBJET d'expérience = `…/<Test>/<instance>/<Test>.json` : le nom du
     fichier est celui du dossier GRAND-PARENT, et le parent est une instance.
     Les objets de projet (`projects/<prj>/<prj>.json`), d'agenda, de stockage
     suivent le même motif « nom = dossier » mais ne sont pas des expériences. */
  return /^(instance\d+|New_Instance_\d+)$/i.test(instance) && leaf === segs[segs.length - 3];
};
const objects = all.filter(isObjectFile);
say(`   ${objects.length} fichier(s)-objet(s) d'expérience portés par le Drive`);

const rows = objects.map((f) => {
  const path = pathOf(f);
  const leaf = String(f.name).replace(/\.json$/i, '');
  return { path, leaf, key: norm(leaf), mtime: String(f.modifiedTime || ''), ctime: String(f.createdTime || ''), id: f.id, size: Number(f.size || 0) };
});
const inDataset = rows.filter((r) => testNames.has(r.key));
const notInDataset = rows.filter((r) => !testNames.has(r.key));
say(`   ▸ portés par le dataset (nom du test trouvé) : ${inDataset.length}`);
say(`   ▸ SUR LE DRIVE ET PAS DANS LE DATASET          : ${notInDataset.length}`);

const groups = new Map();
notInDataset.forEach((r) => {
  const proj = (/^projects\/([^/]+)\//.exec(r.path) || [])[1] || '(hors projects/)';
  if (!groups.has(r.leaf)) groups.set(r.leaf, { leaf: r.leaf, proj, gens: [] });
  groups.get(r.leaf).gens.push(r);
});
say(`\n   ${groups.size} expérience(s) absente(s) du dataset (le Drive les porte) :`);
[...groups.values()].sort((a, b) => String(b.gens[0].mtime).localeCompare(String(a.gens[0].mtime))).forEach((g) => {
  say(`\n      ▲ « ${g.leaf} »  (${g.gens.length} fichier(s))  projet du chemin : ${g.proj}`);
  g.gens.forEach((r) => say(`         ${r.path}  modifié=${r.mtime}  créé=${r.ctime}  ${Math.round(r.size / 1024)} Ko`));
});

/* ④ CE QUI A BOUGÉ DEPUIS LE 2026-10-09 (publications récentes) */
say(`\n════ ③ FICHIERS-OBJETS PUBLIÉS DEPUIS 2026-10-09 ════`);
const recent = rows.filter((r) => r.mtime >= '2026-10-09T00:00:00')
  .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
say(`   ${recent.length} fichier(s) :`);
recent.forEach((r) => say(`   • ${r.path}  modifié=${r.mtime}  ${testNames.has(r.key) ? 'DANS le dataset' : 'ABSENT du dataset'}`));

/* ⑤ LES DOSSIERS D'INSTANCE SANS TEST DANS LE DATASET */
say(`\n════ ④ DOSSIERS D'INSTANCE SANS TEST CORRESPONDANT ════`);
const expFolders = all.filter((f) => isFolder(f) && /\/(instance\d+|New_Instance_\d+)/i.test(pathOf(f)));
const orphanFolders = expFolders.filter((f) => !testNames.has(norm(pathOf(f).split('/').slice(-2)[0])));
say(`   ${orphanFolders.length} dossier(s) dont le nom du test n'existe pas dans le dataset :`);
orphanFolders.forEach((f) => say(`   • ${pathOf(f)}  modifié=${f.modifiedTime}`));

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`\n→ rapport : ${OUT}`);
