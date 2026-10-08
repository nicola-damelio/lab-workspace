/* =========================================================================
   _purge_orphan_datasets.mjs — LES DOSSIERS DE DATASETS SUPPRIMÉS QUI SONT
   RESTÉS SUR LE DRIVE.

   LE DÉFAUT (constaté sur le Drive réel) : un dossier de dataset est resté
   sous « Lab Workspace » alors que le programme n'avait plus ce dataset —
   `GEC-UPJV-pp`, portant des projets (`p53H`) et une expérience
   (`pdbs_interactions`) du dataset d'origine. Le programme et le Drive ne se
   ressemblaient plus : ce n'était plus un miroir.

   POURQUOI. Le geste de suppression écrit TOUJOURS sa pierre tombale, même
   quand la mise à la corbeille Drive n'aboutit pas (Drive éteint, jeton
   expiré, quota, 5xx, recherche en échec). La tombe empêchait le dossier de
   revenir — mais rien ne reprenait la mise à la corbeille restée en chemin :
   le dossier (et ses fichiers) restait là pour toujours. La reprise
   automatique vit maintenant dans `src/utils/driveMirror.js`
   (`mirrorPurgeDeletedDatasets`, appelée au démarrage et à la reconnexion) ;
   ce script fait le MÊME travail À LA MAIN, pour un Drive déjà abîmé — et il
   MONTRE ce qu'il trouve avant de toucher à quoi que ce soit.

   Ce qu'il lit : `Lab Workspace/_workspace/state.json` (l'index partagé) —
   la liste des datasets VIVANTS et les pierres tombales (suppressions). Tout
   dossier de « Lab Workspace » qui ne correspond à aucun dataset vivant est
   signalé :
     • « supprimé dans le programme » (une tombe le nomme) → c'est exactement
       « ce que je supprime dans le programme doit être supprimé sur le
       Drive » : `--apply` le met à la corbeille ;
     • « inconnu de l'index » (aucune tombe, aucun dataset vivant) → il est
       SEULEMENT signalé : un dataset créé sur un autre poste et pas encore
       indexé ne doit pas être effacé par surprise. `--apply-unknown` le met à
       la corbeille (choix explicite).

   Usage (SANS argument = lecture seule, rien n'est modifié) :
     node _purge_orphan_datasets.mjs
     node _purge_orphan_datasets.mjs --apply                 (les tombes seulement)
     node _purge_orphan_datasets.mjs --apply --apply-unknown (tout ce qui n'est
                                                             pas un dataset vivant)
     node _purge_orphan_datasets.mjs --keep=Pepper_viruses,BG04
                                                             (noms à NE PAS toucher)
     node _purge_orphan_datasets.mjs --report=tmp_orphans.txt (relire le plan)
   Rien n'est jamais supprimé définitivement : tout part à la CORBEILLE Drive
   (restaurable 30 jours). Aucun dossier n'est créé, aucun fichier déplacé.
   ========================================================================= */
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';

register('./_esm_test_hook.mjs', import.meta.url);
const { sanitizeSlug } = await import('./src/utils/driveNaming.js');

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const APPLY = args.get('apply') === 'true';
const APPLY_UNKNOWN = args.get('apply-unknown') === 'true';
const KEEP = new Set((args.get('keep') || '').split(',').map((s) => sanitizeSlug(s)).filter(Boolean));

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };
const finish = () => {
  const report = args.get('report') || '';
  if (report) { try { writeFileSync(report, `${lines.join('\n')}\n`, 'utf8'); } catch { /* ignore */ } }
};

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
/* Ce script n'est pas un test : sans jeton il ne peut rien VÉRIFIER, et le dire
   suffit (sortie 0). */
if (!token) {
  say('PAS DE JETON — serveur de jetons injoignable : rien de vérifié (relancer quand le réseau revient).');
  finish();
  process.exit(0);
}

const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) }
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res;
};
const json = async (path, init) => (await api(path, init)).json();

const isFolder = (node) => String(node.mimeType || '') === FOLDER;
const listAll = async (parentId) => {
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime)');
    const page = await json(`/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`);
    out.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
};
const trashFile = async (fileId) => api(`/drive/v3/files/${fileId}?fields=id`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
});

/* ── « Lab Workspace » et l'INDEX partagé ────────────────────────────────── */
const wsRes = await json(`/drive/v3/files?q=${encodeURIComponent(
  `name='Lab Workspace' and mimeType='${FOLDER}' and trashed=false`
)}&fields=files(id,name)&pageSize=10`);
const wsId = (wsRes.files || [])[0] ? (wsRes.files || [])[0].id : '';
if (!wsId) { say('« Lab Workspace » introuvable — rien à faire.'); finish(); process.exit(0); }

const children = await listAll(wsId);
const wsDir = children.find((n) => isFolder(n) && n.name === '_workspace');
const datasetFolders = children.filter((n) => isFolder(n) && n.name !== '_workspace');

let state = null;
if (wsDir) {
  const inside = await listAll(wsDir.id).catch(() => []);
  const stateFile = inside.find((n) => !isFolder(n) && n.name === 'state.json');
  if (stateFile) {
    const text = await api(`/drive/v3/files/${stateFile.id}?alt=media`).then((r) => r.text()).catch(() => '');
    try { state = JSON.parse(text); } catch { state = null; }
  }
}
const liveSlugs = new Set(((state && Array.isArray(state.datasets)) ? state.datasets : [])
  .map((d) => sanitizeSlug((d && (d.title || d.name)) || ''))
  .filter(Boolean));
/* Une tombe SANS chemin = le dataset ENTIER a été supprimé dans le programme. */
const tombstones = (state && state.mirror && Array.isArray(state.mirror.tombstones))
  ? state.mirror.tombstones.filter((t) => t && !t.path) : [];
const deletedSlugs = new Set(tombstones.map((t) => sanitizeSlug(t.name || '')).filter(Boolean));
const deletedIds = new Set(tombstones.map((t) => String(t.id || '')).filter(Boolean));

say(`Datasets VIVANTS (index partagé) : ${Array.from(liveSlugs).join(', ') || '(aucun)'}`);
say(`Datasets SUPPRIMÉS (pierres tombales) : ${Array.from(deletedSlugs).join(', ') || '(aucune)'}`
  + (deletedIds.size ? ` — ids : ${Array.from(deletedIds).join(', ')}` : ''));
if (!state) say('⚠ state.json illisible : aucun dataset VIVANT n’a pu être établi — rien ne sera mis à la corbeille sans --apply-unknown.');
say(`Dossiers sous « Lab Workspace » : ${datasetFolders.length}`);
say('');

/* ── Le tri : vivant / supprimé / inconnu ────────────────────────────────── */
const plan = [];
for (const folder of datasetFolders) {
  const slug = sanitizeSlug(folder.name);
  const kids = await listAll(folder.id).catch(() => null);
  const where = liveSlugs.has(slug) ? 'live'
    : deletedSlugs.has(slug) ? 'deleted'
      : (state ? 'unknown' : 'undecided');
  plan.push({ folder, slug, where, items: kids ? kids.length : null });
}

const LABEL = {
  live: 'DATASET VIVANT — laissé en place',
  deleted: 'SUPPRIMÉ DANS LE PROGRAMME — à mettre à la corbeille',
  unknown: 'INCONNU DE L’INDEX — à toi de décider',
  undecided: 'INDÉTERMINÉ (index illisible) — laissé en place'
};
for (const entry of plan) {
  const items = entry.items === null ? '? élément(s)' : `${entry.items} élément(s)`;
  say(`• ${entry.folder.name} [${entry.folder.id}] ${items}`
    + ` créé ${String(entry.folder.createdTime || '').slice(0, 10)} — ${LABEL[entry.where]}`);
}

/* ── Le geste ────────────────────────────────────────────────────────────── */
const targets = plan.filter((entry) => {
  if (KEEP.has(entry.slug)) return false;
  if (entry.where === 'deleted') return true;
  return APPLY_UNKNOWN && (entry.where === 'unknown' || entry.where === 'undecided');
});

say('');
if (!APPLY && !APPLY_UNKNOWN) {
  say('Mode LECTURE SEULE (plan affiché, rien n’est modifié).');
  if (targets.length) say(`À mettre à la corbeille avec --apply : ${targets.map((t) => t.folder.name).join(', ')}`);
  finish();
  process.exit(0);
}

if (!targets.length) {
  say('Rien à mettre à la corbeille : le Drive ne porte aucun dossier de dataset supprimé.');
  finish();
  process.exit(0);
}

let trashed = 0;
for (const entry of targets) {
  try {
    await trashFile(entry.folder.id);
    trashed += 1;
    say(`🗑 ${entry.folder.name} [${entry.folder.id}] mis à la corbeille (restaurable 30 jours).`);
  } catch (err) {
    say(`✗ ${entry.folder.name} [${entry.folder.id}] : ${err.message}`);
  }
}
say('');
say(`${trashed}/${targets.length} dossier(s) mis à la corbeille. Rien n’est supprimé définitivement, aucun fichier déplacé.`);
finish();

