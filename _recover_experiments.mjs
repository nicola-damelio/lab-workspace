/* =========================================================================
   _recover_experiments.mjs — RENDRE LES EXPÉRIENCES PERDUES, SANS JAMAIS
   TOUCHER À LA CORBEILLE ET SANS RIEN ÉCRIRE SUR LE DRIVE.

   La règle tenue ici, telle qu'elle a été posée : LES DONNÉES DE LA CORBEILLE
   NE SE RESTAURENT PAS. Ce script ne lit donc QUE la moitié VIVANTE du Drive :
   les fichiers-objets des expériences (`<expérience>.json`, `kind:
   lab-workspace/object`, `type: experiment`), posés dans le dossier de chaque
   expérience par la publication. Ces fichiers sont la seule trace complète
   d'une expérience que la copie du dataset (`_workspace/datasets/ds_<id>.json`)
   ne porte plus — constat de `_recover_copy_diff.mjs` : 13 fichiers-objets
   vivants absents de la copie, soit 6 expériences (les autres noms sont des
   renommages historiques de la même expérience, reconnaissables à leur `id`
   identique ; la génération la plus récente fait foi).

   Ce qui est VÉRIFIÉ avant d'écrire quoi que ce soit :
     ① la charge d'un fichier-objet a la FORME d'un test complet — ses clés
        recouvrent celles d'un `state.tests[]` de la copie (`_compare_shapes.mjs` ;
        deux objets portent même 2 champs de plus : `ligandCode`, `ligandSmiles`) ;
     ② le fichier produit est relu par le module de l'application
        (`buildBackupDocument` puis `parseBackupText`) : c'est SON validateur qui
        juge, et il compare les comptes déclarés à ce que la charge porte ;
     ③ les lignes de la fenêtre d'import sont calculées par l'application
        elle-même (`experimentRowChoices`) : chacune des 6 doit être AJOUTÉE
        (`inBase` faux) — aucune n'est un jumeau de ce que le dataset porte déjà ;
     ④ chaque expérience retrouve son ID D'ORIGINE : c'est lui que le lien du
        projet et le dossier du Drive nomment. Ce qui revient est donc
        l'expérience, pas une copie anonyme.

   RIEN N'EST ÉCRIT SUR LE DRIVE : le résultat est un fichier LOCAL, chargeable
   par « 📂 Load HTML » (mode ➕ AJOUT, page « Expériences » seulement).

   Usage : node _recover_experiments.mjs
           node _recover_experiments.mjs --copy=ds_ds_1788383774488.json
           node _recover_experiments.mjs --ids=t17915023284364463,t17914…
   ========================================================================= */
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

register('./_esm_test_hook.mjs', import.meta.url);
const B = await import('./src/utils/backupFile.js');
const L = await import('./src/utils/loadSelection.js');
const LZString = (await import('lz-string')).default;

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const COPY_NAME = String(args.get('copy') || 'ds_ds_1788383774488.json');
const WANT_IDS = String(args.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAT = String(args.get('mat') || '_recover/recoverable_experiments.json');
const OUT_DIR = path.resolve('_recover');

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const apiJson = async (p) => {
  const res = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
};
/** La même lecture que l'application (`parsePayload`) : LZString pas à pas. */
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
const nameOf = (v) => String((v && (v.name || v.testName || v.title)) || '').trim();

/* ── 1. La copie VIVANTE du dataset : elle dit le titre, les projets et le
      contenu d'aujourd'hui (référence des contrôles). `trashed=false` — la
      corbeille n'est jamais demandée. ────────────────────────────────────── */
const found = ((await apiJson(`/drive/v3/files?q=${
  encodeURIComponent(`name='${COPY_NAME}' and trashed=false`)
}&fields=files(id,name,size,modifiedTime)`)).files) || [];
if (!found.length) { say(`✖ copie vivante « ${COPY_NAME} » introuvable.`); process.exit(0); }
const copyFile = found[0];
const copyText = await (await fetch(`${API}/drive/v3/files/${copyFile.id}?alt=media`,
  { headers: { Authorization: `Bearer ${token}` } })).text();
const copyDoc = JSON.parse(copyText);
const liveState = decode(copyDoc.record && copyDoc.record.payload,
  !(copyDoc.record && copyDoc.record.isCompressed === false)) || {};
const liveTests = Array.isArray(liveState.tests) ? liveState.tests : [];
const DATASET_ID = `ds_${String(COPY_NAME).replace(/^ds_/, '').replace(/\.json$/i, '')}`;
const liveProjects = new Set((Array.isArray(liveState.projects) ? liveState.projects : [])
  .map(nameOf).filter(Boolean));

say(`# Expériences perdues — reprise depuis la moitié VIVANTE (${new Date().toISOString()})`);
say('(règle : la corbeille ne se restaure pas — aucun fichier en corbeille n’est lu ni proposé)\n');
say('## La copie vivante du dataset');
say(`   • ${copyFile.name}  id=${copyFile.id}  ${Math.round(Number(copyFile.size || 0) / 1024)} Ko  ${copyFile.modifiedTime}`);
say(`   • dataset ${DATASET_ID}  titre « ${liveState.datasetTitle || copyDoc.title || ''} »`
  + `  sous-titre « ${liveState.datasetSubtitle || ''} »`);
say(`   • aujourd’hui : ${liveTests.length} expérience(s) · ${liveProjects.size} projet(s)`);

/* ── 2. Les fichiers-objets VIVANTS que la copie ne porte plus, groupés par id :
      un id = une expérience ; plusieurs noms = des renommages, la génération la
      plus récente fait foi. ──────────────────────────────────────────────── */
const mat = JSON.parse(fs.readFileSync(MAT, 'utf8'));
const rows = (Array.isArray(mat.recoverable) ? mat.recoverable : [])
  .filter((r) => !WANT_IDS.length || WANT_IDS.includes(String(r.object && r.object.id)));
const byId = new Map();
rows.forEach((r) => {
  const id = String((r.object && r.object.id) || '');
  if (!id) return;
  const at = String((r.object && r.object.savedAt) || '');
  let cur = byId.get(id);
  if (!cur) { cur = { id, at, name: r.name, data: r.object.data, names: [] }; byId.set(id, cur); }
  if (at > cur.at) { cur.at = at; cur.name = r.name; cur.data = r.object.data; }
  cur.names.push(r.name);
});
const lost = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

say(`\n## ${rows.length} fichier(s)-objet(s) vivant(s) → ${lost.length} expérience(s) à retrouver`);
lost.forEach((e) => {
  const p = (Array.isArray(e.data.projectNames) ? e.data.projectNames : []).filter(Boolean);
  say(`   • « ${e.name} »  id=${e.id}  enregistrée ${e.at}`);
  say(`     instance ${e.data.instanceName || '—'} · catégorie ${e.data.testCategory || '—'}`
    + ` · projet(s) ${p.join(', ') || '—'}${p.some((n) => !liveProjects.has(n)) ? '  ⚠ projet absent du dataset' : ''}`);
  say(`     noms portés sur le Drive : ${e.names.join(', ')}`);
});

/* ── 3. LE FICHIER : la charge ne porte QUE ces expériences. Les autres clés
      (projets, définitions, stockage…) restent celles du dataset ouvert — c'est
      le principe de l'import partiel (`filterLoadState`) : une sauvegarde réduite
      ne peut pas écraser ce qu'elle ne contient pas. ─────────────────────── */
const built = {
  datasetTitle: liveState.datasetTitle || copyDoc.title || 'Untitled Dataset',
  datasetSubtitle: liveState.datasetSubtitle || '',
  tests: lost.map((e) => e.data)
};
const payload = B.encodeBackupPayload(built, true);
const doc = B.buildBackupDocument({
  payload,
  title: built.datasetTitle,
  subtitle: `${lost.length} expérience(s) retrouvée(s) dans les fichiers-objets du Drive`,
  /* La provenance est écrite, mais l'import en AJOUT vise le dataset OUVERT
     (`targetId = currentDatasetId`, App.jsx) : c'est ce qui fait revenir les
     expériences ICI, sous leurs ids d'origine, au lieu de créer un dataset. */
  datasetId: DATASET_ID,
  savedAt: Date.now(),
  counts: null,
  compressed: true
});
const fileText = B.backupDocumentText(doc);
const fileName = B.backupFileName({
  title: doc.title,
  datasetId: doc.datasetId,
  dateStr: new Date().toISOString().slice(0, 10),
  kind: 'experiences-retrouvees'
});
const outPath = path.join(OUT_DIR, fileName);
fs.writeFileSync(outPath, fileText, 'utf8');

/* ── 4. LES CONTRÔLES, faits par l'application elle-même ────────────────── */
const verdict = B.parseBackupText(fileText);
const backTests = verdict.state && Array.isArray(verdict.state.tests) ? verdict.state.tests : [];
const samePayload = verdict.state
  ? JSON.stringify(verdict.state.tests) === JSON.stringify(built.tests) : false;

say('\n## Le fichier écrit (LOCAL — rien n’a été écrit sur le Drive)');
say(`   ${outPath}  (${Math.round(Buffer.byteLength(fileText, 'utf8') / 1024)} Ko)`);
say(`   format ${doc.format} · schéma ${doc.schema} · dataset ${doc.datasetId} · compressé ${doc.compressed}`);
say(`   comptes déclarés : ${JSON.stringify(doc.counts)}`);
say(`   ${verdict.ok ? '✔ VALIDÉ par le validateur de l’application' : `✖ REFUSÉ : ${verdict.reason}`}`);
say(`   relecture : ${backTests.length} expérience(s), charges identiques : ${samePayload ? 'oui' : 'NON'}`);

/* La fenêtre d'import, telle que l'application la construira : une ligne par
   expérience. Une ligne `inBase` serait un jumeau que l'ajout IGNORE. */
const rowsOfWindow = L.experimentRowChoices(built.tests, liveTests, false);
let twins = 0;
say(`\n## Les lignes de la fenêtre d’import (« Expériences », ${rowsOfWindow.length} ligne(s))`);
rowsOfWindow.forEach((r) => {
  if (r.inBase) twins += 1;
  say(`   ${r.inBase ? '⛔ DÉJÀ PRÉSENTE (ignorée par l’ajout)' : '➕ à ajouter'}`
    + `  « ${r.title} »  clé ${r.key}${r.sub ? `  · ${r.sub}` : ''}`);
});
say(`\n   → ${rowsOfWindow.length - twins}/${rowsOfWindow.length} ligne(s) seront VRAIMENT ajoutées`
  + `${twins ? ` ; ${twins} écartée(s) comme déjà présente(s)` : ''}.`);

/* Le choix ligne à ligne, appliqué par la fonction de l'application : les ids
   d'origine doivent traverser intacts (c'est eux que le dossier du Drive et le
   lien du projet nomment). */
const pickedKeys = rowsOfWindow.filter((r) => r.picked).map((r) => r.key);
const willImport = L.pickExperimentRows(built.tests, pickedKeys);
const idsKept = willImport.every((t) => lost.some((e) => String(e.id) === String(t.id)));
say(`   → choix appliqué : ${willImport.length} expérience(s), ids d’origine conservés : ${idsKept ? 'oui' : 'NON'}`);

/* ── 5. LE MODE D'EMPLOI, écrit à côté du fichier ──────────────────────── */
const howTo = [
  'RETROUVER LES EXPÉRIENCES PERDUES — LE GESTE, EN CLAIR',
  '=====================================================',
  '',
  `Fichier à charger : ${fileName}`,
  '  (dossier _recover/ — il est LOCAL, rien n’a été écrit sur le Drive)',
  '',
  `Ce qu’il porte : ${lost.length} expérience(s), avec leurs ids d’origine —`,
  ...lost.map((e) => `   • « ${e.name} »  (id ${e.id})`),
  '',
  'DANS L’APPLICATION :',
  `   1. OUVRIR le dataset « ${built.datasetTitle} » : l’import en AJOUT écrit dans`,
  '      le dataset OUVERT (targetId = currentDatasetId), pas dans un nouveau ;',
  '   2. « 📂 Load HTML » (ou Load backup .json) et choisir ce fichier ;',
  '   3. dans la fenêtre : cocher la page « Expériences » SEULEMENT — les autres',
  '      pages gardent leur valeur actuelle (import partiel : rien n’est écrasé) ;',
  '   4. chaque expérience est une LIGNE : décocher celles qu’on ne veut pas',
  '      (par défaut tout est coché) ;',
  '   5. valider avec ➕ AJOUT (« Add »), JAMAIS ♻️ REMPLACEMENT : l’ajout ignore',
  '      ce qui est déjà là et n’efface rien ;',
  '   6. la fenêtre dit alors COMBIEN d’expériences sont revenues, avec leurs ids.',
  '',
  'CE QU’IL FAUT SAVOIR :',
  '   • une expérience retrouvée LÈVE sa suppression locale',
  '     (recordExperimentRevivals) : si elle avait été supprimée volontairement,',
  '     elle revient — c’est le geste ; décocher sa ligne l’écarte ;',
  '   • « Test 84 » N’EST PAS dans ce fichier : sa seule trace est à la CORBEILLE',
  '     du Drive, et la corbeille ne se restaure pas (règle posée).',
  ''
].join('\n');
const howToPath = path.join(OUT_DIR, 'HOW-TO_retrouver-les-experiences.txt');
fs.writeFileSync(howToPath, howTo, 'utf8');

say('\n## Gestes');
say(`   1. ouvrir le dataset « ${built.datasetTitle} » dans l’application ;`);
say(`   2. 📂 Load HTML → ${fileName} ;`);
say('   3. cocher « Expériences » seulement (chaque expérience est une ligne) ;');
say('   4. ➕ AJOUT (jamais ♻️ REMPLACEMENT) ;');
say(`   → mode d’emploi écrit : ${howToPath}`);

fs.writeFileSync(path.join(OUT_DIR, 'recovery_report.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log(`\n→ ${outPath}\n→ ${howToPath}\n→ _recover/recovery_report.txt`);
