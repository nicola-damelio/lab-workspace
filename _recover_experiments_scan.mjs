/* =========================================================================
   _recover_experiments_scan.mjs — LECTURE SEULE. « Resync from Drive n'a pas
   marché : pourquoi, et qu'est-ce qui reste récupérable ? »

   Ce que la lecture du code établit, et que ce script MESURE :

     • « 🔄 Resync from Drive » n'adopte un contenu que par la COPIE
       `_workspace/datasets/ds_<id>.json` (`readDatasetCopy` → `parsePayload` →
       `mergeProjectsFromCloud`, App.jsx) — et cette copie n'est proposée que
       quand le DOSSIER du dataset a disparu du Drive (workspaceResync.js,
       constat `dataset-folder-missing`). Dossier présent ⇒ `copyIds` vide ⇒ le
       geste ne fait rien. Et ce qu'il adopte, ce sont des PROJETS : les
       expériences de la copie (`content.tests`) ne servent qu'à attribuer les
       projets historiques (`testIds`), elles ne reviennent jamais dans la page.

     • Le Drive porte POURTANT l'expérience ENTIÈRE : la publication écrit, dans
       le dossier de chaque expérience, `<expérience>.json`
       (`kind: lab-workspace/object`, `type: 'experiment'`, son `id` et son
       `data` complet — driveStructure.js). Aucun code de l'application ne relit
       ces fichiers-objets : `OBJECT_KIND` n'a pas de lecteur, `omittedPixels`
       est écrit et jamais lu. Le miroir est donc À SENS UNIQUE.

   Ce script ne fait que LIRE le Drive (aucune écriture, aucun dossier créé) :

     ① le dossier du dataset et son `_meta.json` (l'id du dataset) ;
     ② le balayage de l'arbre entier ;
     ③ chaque fichier-objet du dataset (nom = nom d'un dossier ancêtre) :
        téléchargé, analysé, classé (`type`) — les expériences sont retenues
        avec leur `id`, leur `name` et leur `data` COMPLET ;
     ④ les copies `_workspace/datasets/ds_<id>.json` (le SEUL contenu que le
        geste de resync sait adopter) : décodées (LZString), leurs expériences
        réelles comptées et nommées ;
     ⑤ les GÉNÉRATIONS du fichier-index `<dataset>.json` à la racine (le bug des
        jumeaux en a laissé plusieurs, de tailles différentes) : chacune liste
        ce que le Drive portait à sa date (`counts`, `files`) — la seule trace
        datée de ce qui a disparu ;
     ⑥ le verdict : ce que le Drive porte et que la copie ne porte pas.

   Il écrit, À CÔTÉ : le rapport lisible (`--out=`, défaut
   `_recover_experiments_scan.txt`) et les charges trouvées
   (`_recover/found_experiments.json`) — matière brute de la reprise, à
   réimporter par le chemin NORMAL de l'application (📂 Load HTML).

   Usage :
     node _recover_experiments_scan.mjs
     node _recover_experiments_scan.mjs --dataset=GEC-UPJV-projects
     node _recover_experiments_scan.mjs --limit=8          (requêtes parallèles)
     node _recover_experiments_scan.mjs --max-folders=2500 (garde-fou de balayage)
   ========================================================================= */
import { writeFileSync, mkdirSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const DATASET_NAME = args.get('dataset') || 'GEC-UPJV-projects';
const LIMIT = Math.max(1, Number(args.get('limit') || 8));
const MAX_FOLDERS = Math.max(10, Number(args.get('max-folders') || 3000));
const OUT = args.get('out') || '_recover_experiments_scan.txt';
const FOUND = args.get('found') || '_recover/found_experiments.json';

const lines = [];
/* Chaque ligne est écrite TOUT DE SUITE : une sonde longue interrompue garde
   ce qu'elle a déjà mesuré (le rapport est la seule chose qui compte). */
const say = (s = '') => {
  lines.push(String(s));
  console.log(String(s));
  try { writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); } catch { /* best-effort */ }
};

/* ── Le jeton : le même serveur que les autres outils de ce dossier ───────── */
const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const api = async (path) => {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 140)}`);
  }
  return res.json();
};

const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)');
  do {
    const j = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};

const childrenOf = async (folderId) =>
  listAll(`'${folderId}' in parents and trashed=false`);

const mediaText = async (fileId) => {
  const res = await fetch(`${API}/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return '';
  return res.text().catch(() => '');
};

const jsonOf = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
const when = (f) => String((f && (f.modifiedTime || f.createdTime)) || '').slice(0, 16).replace('T', ' ');
const ko = (n) => `${Math.round(Number(n || 0) / 1024)} Ko`;

/** Un petit bassin de requêtes parallèles (le Drive réel est lent en série). */
const mapPool = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i).catch(() => null);
    }
  });
  await Promise.all(workers);
  return out;
};
/** Le même décodeur que l'application (`parsePayload`, data/constants.js). PUR. */
const parsePayload = (obj) => {
  if (!obj || !obj.payload) return null;
  try {
    let pStr = String(obj.payload);
    if (obj.isCompressed || (!pStr.startsWith('{') && !pStr.startsWith('['))) {
      for (const dec of [
        () => LZString.decompressFromUTF16(pStr),
        () => LZString.decompressFromBase64(pStr),
        () => LZString.decompress(pStr)
      ]) {
        try { const d = dec(); if (d) { pStr = d; break; } } catch { /* essaie la suivante */ }
      }
    }
    return JSON.parse(pStr);
  } catch { return null; }
};

/* ═══ ① L'ESPACE DE TRAVAIL ET LE DOSSIER DU DATASET ═══════════════════════ */
say(`# Sonde de récupération — dataset « ${DATASET_NAME} »`);
say(`# ${new Date().toISOString()}`);

const workspaceRoots = await listAll(
  `mimeType='${FOLDER}' and name='Lab Workspace' and trashed=false`
);
say(`\n## ① Lab Workspace : ${workspaceRoots.length} dossier(s) de ce nom`);
workspaceRoots.forEach((w) => say(`   • ${w.name}  id=${w.id}  ${when(w)}`));

const datasetsFound = await listAll(
  `mimeType='${FOLDER}' and name='${DATASET_NAME.replace(/'/g, "\\'")}' and trashed=false`
);
say(`\n## Le dossier du dataset « ${DATASET_NAME} » : ${datasetsFound.length} exemplaire(s)`);
datasetsFound.forEach((d) => say(`   • id=${d.id}  parent=${(d.parents || []).join(',')}  ${when(d)}`));
if (!datasetsFound.length) {
  say('\n✖ Aucun dossier de ce nom : rien de plus à mesurer.');
  writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
  process.exit(0);
}
/* Le dossier de TRAVAIL est celui sous « Lab Workspace » ; les autres sont des
   jumeaux à regarder de près (le rapport le dit, il ne déplace rien). */
const underWorkspace = datasetsFound.filter((d) => workspaceRoots.some((w) => (d.parents || []).includes(w.id)));
const DATA_ROOT = (underWorkspace[0] || datasetsFound[0]);
say(`\n→ dossier retenu : id=${DATA_ROOT.id} ${underWorkspace.length ? '(sous Lab Workspace)' : '(⚠ hors workspace)'}`);
say(`   ⚠ jumeaux : ${datasetsFound.filter((d) => d.id !== DATA_ROOT.id).length}`);

const rootKids = await childrenOf(DATA_ROOT.id).catch(() => []);
const dataMeta = jsonOf(await mediaText((rootKids.find((f) => String(f.name).toLowerCase() === '_meta.json') || {}).id || ''));
const DATASET_ID = String((dataMeta && dataMeta.dataset && dataMeta.dataset.id) || (dataMeta && dataMeta.id) || '');
say(`   _meta.json : ${dataMeta ? `type=${dataMeta.type} name=${dataMeta.name} datasetId=${DATASET_ID}` : 'ABSENT'}`);

/* ═══ ② LE BALAYAGE DE L'ARBRE (lecture seule) ═════════════════════════════ */
say('\n## ② L’arbre du dataset (balayage complet)');
const foldersQueue = [{ id: DATA_ROOT.id, path: '' }];
const filesOnDrive = [];
let foldersSeen = 0;
const seenIds = new Set([DATA_ROOT.id]);
while (foldersQueue.length && foldersSeen < MAX_FOLDERS) {
  const batch = foldersQueue.splice(0, LIMIT);
  const results = await mapPool(batch, LIMIT, async (node) => (
    { node, kids: await childrenOf(node.id).catch(() => null) }
  ));
  results.forEach((res) => {
    if (!res) return;
    foldersSeen += 1;
    if (!res.kids) { say(`   ⚠ illisible : ${res.node.path || '(racine)'}`); return; }
    res.kids.forEach((k) => {
      const rel = res.node.path ? `${res.node.path}/${k.name}` : String(k.name);
      if (k.mimeType === FOLDER) {
        if (seenIds.has(k.id)) return;
        seenIds.add(k.id);
        foldersQueue.push({ id: k.id, path: rel });
        return;
      }
      filesOnDrive.push({ id: k.id, name: String(k.name), rel, size: Number(k.size || 0), mtime: when(k), folder: res.node.path });
    });
  });
}
say(`   dossiers lus  : ${foldersSeen}${foldersQueue.length ? ` (⚠ ${foldersQueue.length} non lus : --max-folders)` : ''}`);
say(`   fichiers      : ${filesOnDrive.length}`);
const jsonOnDrive = filesOnDrive.filter((f) => /\.json$/i.test(f.name));
say(`   fichiers .json: ${jsonOnDrive.length}`);
/* ═══ ③ LES OBJETS : `<objet>.json`, dont les EXPÉRIENCES ENTIÈRES ═════════ */
/* La règle du dépôt : le fichier d'un objet porte le nom de son dossier, et il
   est posé dans le dossier de l'objet (ou dans son instance, plus bas). Un
   `.json` dont le radical est celui d'un dossier ANCÊTRE est donc un objet. */
const looksLikeObject = (rel) => {
  const segs = String(rel).split('/');
  const base = segs.pop().replace(/\.json$/i, '');
  return segs.includes(base);
};
const objectFiles = jsonOnDrive.filter((f) => looksLikeObject(f.rel));
say(`\n## ③ Fichiers-objets candidats (radical = nom d’un dossier ancêtre) : ${objectFiles.length}`);
say('   téléchargement et analyse…');

let scanned = 0;
const objects = await mapPool(objectFiles, LIMIT, async (f) => {
  const body = jsonOf(await mediaText(f.id));
  scanned += 1;
  if (scanned % 25 === 0) say(`     … ${scanned}/${objectFiles.length} fichiers lus`);
  if (!body || !body.kind) return null;
  return { file: f, body };
});
const found = objects.filter(Boolean);
const byType = new Map();
found.forEach((o) => {
  const t = String(o.body.type || '?');
  byType.set(t, (byType.get(t) || 0) + 1);
});
say(`   objets reconnus : ${found.length} / ${objectFiles.length}`);
[...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => say(`     ${t} : ${n}`));

const experimentsOnDrive = found.filter((o) => String(o.body.type) === 'experiment');
say(`\n## Les EXPÉRIENCES portées par le Drive (fichier <expérience>.json) : ${experimentsOnDrive.length}`);
experimentsOnDrive
  .slice()
  .sort((a, b) => String(a.file.rel).localeCompare(String(b.file.rel)))
  .forEach((o) => {
    const d = (o.body.data && typeof o.body.data === 'object') ? o.body.data : {};
    const cond = Array.isArray(d.conditions) ? d.conditions.length : 0;
    say(`   • ${o.file.rel}  →  name="${o.body.name}"  id=${o.body.id}  `
      + `data.name="${String(d.name || '')}"  conditions=${cond}  `
      + `savedAt=${String(o.body.savedAt || '').slice(0, 16)}  ${ko(o.file.size)}`);
  });

/* ═══ ④ CE QUE « RESYNC » SAIT ADOPTER : la copie `_workspace/datasets/` ═══ */
say('\n## ④ La copie que « 🔄 Resync from Drive » sait adopter');
const workspaceDir = (await listAll(`mimeType='${FOLDER}' and name='_workspace' and trashed=false`))
  .filter((w) => workspaceRoots.some((r) => (w.parents || []).includes(r.id)));
const copies = [];
for (const w of workspaceDir) {
  const dsDir = (await childrenOf(w.id)).filter((f) => f.mimeType === FOLDER && f.name === 'datasets');
  for (const dd of dsDir) {
    (await childrenOf(dd.id)).filter((f) => /^ds_.*\.json$/i.test(f.name))
      .forEach((f) => copies.push({ ...f, mtime: when(f) }));
  }
}
say(`   copies trouvées : ${copies.length}`);
copies.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
  .forEach((c) => say(`     ${c.name}  ${ko(c.size)}  ${c.mtime}  id=${c.id}`));

const copyNames = new Set();
let copyExperiments = null;
/* ⚠ Le noms déposés portent DEUX fois le préfixe : l'id du dataset est déjà
   `ds_…` et `workspaceDatasetFileName` ajoute son propre `ds_` — le fichier du
   dataset ds_1788383774488 s'appelle donc `ds_ds_1788383774488.json`. Le
   rapprochement se fait sur la CLÉ (tous les `ds_` de tête retirés). */
const copyKeyOf = (name) => String(name).replace(/\.json$/i, '').replace(/^(ds_)+/i, '');
const datasetKey = String(DATASET_ID).replace(/^(ds_)+/i, '');
const wantedCopy = (datasetKey ? copies.find((c) => copyKeyOf(c.name) === datasetKey) : null)
  || copies.find((c) => /upjv/i.test(String(c.name)))
  || null;
if (wantedCopy) {
  const envelope = jsonOf(await mediaText(wantedCopy.id));
  const content = parsePayload(envelope);
  say(`\n   copie lue : ${wantedCopy.name}`);
  say(`     enveloppe : ${envelope ? `clés=${Object.keys(envelope).slice(0, 12).join(',')} isCompressed=${!!envelope.isCompressed}` : 'illisible'}`);
  if (content) {
    const protos = content.datasetProtocols || content.protocols || [];
    say(`     charge    : ${(content.tests || []).length} entrée(s) d’expérience · `
      + `${(content.projects || []).length} projet(s) · ${(content.storages || []).length} storage(s) · `
      + `${Array.isArray(protos) ? protos.length : 0} protocole(s)`);
    say(`     projets de la copie : ${(content.projects || []).map((p) => String((p && p.name) || '')).filter(Boolean).join(', ') || '—'}`);
  } else {
    say('     charge    : NON DÉCODÉE');
  }
  if (content && Array.isArray(content.tests)) {
    copyExperiments = content.tests;
    content.tests.forEach((t) => copyNames.add(String((t && t.name) || '')));
  }
} else {
  say('   ⚠ aucune copie `ds_<id>.json` pour ce dataset : le geste de resync n’a RIEN à adopter.');
}
/* ═══ ⑤ LES GÉNÉRATIONS DE L'INDEX `<dataset>.json` (racine du dataset) ════ */
say('\n## ⑤ Les générations de l’index <dataset>.json à la racine du dataset');
const indexFiles = filesOnDrive.filter((f) => !f.folder && /\.json$/i.test(f.name) && !/^_meta\.json$/i.test(f.name));
say(`   fichiers : ${indexFiles.length}`);
const generations = await mapPool(indexFiles, LIMIT, async (f) => (
  { f, body: jsonOf(await mediaText(f.id)) }
));
const genList = [];
generations.filter(Boolean).forEach(({ f, body }) => {
  if (!body || body.type !== 'dataset') return;
  const counts = body.counts || {};
  const files = Array.isArray(body.files) ? body.files : [];
  const expPaths = files
    .map((s) => String(s))
    .filter((s) => /\.json$/.test(s))
    .map((s) => {
      const cut = s.lastIndexOf(' / ');
      if (cut < 0) return '';
      const pathPart = s.slice(0, cut);
      const base = s.slice(cut + 3).replace(/\.json$/i, '');
      return pathPart.split('/').includes(base) ? `${pathPart}/${base}` : '';
    })
    .filter(Boolean);
  genList.push({
    file: f,
    savedAt: String(body.savedAt || ''),
    counts,
    experiments: expPaths.length,
    names: expPaths,
    experimentNames: [...new Set(expPaths.map((p) => p.split('/').pop()))].sort(),
    folders: Array.isArray(body.folders) ? body.folders.length : 0
  });
});
genList.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
genList.forEach((g) => {
  say(`   • ${g.file.name}  ${ko(g.file.size)}  📅 ${g.file.mtime}  savedAt=${g.savedAt.slice(0, 16)}`);
  say(`     counts=${JSON.stringify(g.counts)}  fichiers-objets d’expérience listés=${g.experiments}  dossiers=${g.folders}`);
});
for (let i = 1; i < genList.length; i += 1) {
  const prev = genList[i - 1]; const cur = genList[i];
  const lost = prev.names.filter((p) => !cur.names.includes(p));
  const added = cur.names.filter((p) => !prev.names.includes(p));
  say(`\n   Δ ${prev.file.mtime} → ${cur.file.mtime}`);
  say(`     disparues de l’index : ${lost.length ? lost.join(', ') : '—'}`);
  say(`     apparues             : ${added.length ? added.join(', ') : '—'}`);
}

/* ═══ ⑥ LE VERDICT : ce qui est sur le Drive et PAS dans la copie ══════════ */
say('\n## ⑥ VERDICT — ce que le Drive porte et que la copie (chemin du resync) ne porte pas');
say('   (rappel : `copyIds` ne reçoit une copie que si le DOSSIER du dataset a disparu —');
say('    constat `dataset-folder-missing`, workspaceResync.js. Dossier présent ⇒ rien à adopter.)');
const driveNames = [...new Set(experimentsOnDrive.map((o) => String(o.body.name || '')))].sort();
say(`   expériences portées par le Drive : ${driveNames.length}`);
if (copyExperiments) {
  const onlyDrive = driveNames.filter((n) => !copyNames.has(n));
  const onlyCopy = [...copyNames].filter((n) => n && !driveNames.includes(n)).sort();
  say(`   expériences de la copie          : ${copyNames.size}`);
  say(`\n   ▲ SUR LE DRIVE ET PAS DANS LA COPIE (récupérables par les fichiers-objets) : ${onlyDrive.length}`);
  onlyDrive.forEach((n) => {
    const all = experimentsOnDrive.filter((o) => String(o.body.name) === n);
    say(`      • ${n}  (${all.length} fichier(s) : ${all.map((o) => o.file.rel).join(' , ')})`);
  });
  say(`\n   ▼ DANS LA COPIE ET PAS SUR LE DRIVE (rien à récupérer, à vérifier) : ${onlyCopy.length}`);
  onlyCopy.forEach((n) => say(`      • ${n}`));
} else {
  say('   ⚠ pas de copie décodée : la comparaison « Drive vs resync » ne peut pas être faite.');
}

/* ═══ ⑦ LA MATIÈRE BRUTE, POUR LA REPRISE ══════════════════════════════════ */
mkdirSync('_recover', { recursive: true });
const rawFound = {
  at: new Date().toISOString(),
  dataset: { name: DATASET_NAME, id: DATASET_ID, folderId: DATA_ROOT.id, folder: dataMeta ? dataMeta.name : '' },
  experiments: experimentsOnDrive.map((o) => ({
    file: o.file.rel,
    id: o.body.id,
    name: o.body.name,
    savedAt: o.body.savedAt,
    omittedPixels: o.body.omittedPixels || 0,
    object: o.body
  })),
  projects: found.filter((o) => String(o.body.type) === 'project').map((o) => ({
    file: o.file.rel, id: o.body.id, name: o.body.name, object: o.body
  })),
  indexGenerations: genList.map((g) => ({
    file: g.file.name, savedAt: g.savedAt, counts: g.counts, experimentNames: g.experimentNames
  }))
};
writeFileSync(FOUND, `${JSON.stringify(rawFound, null, 2)}\n`, 'utf8');
writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`\n→ rapport : ${OUT}`);
console.log(`→ matière : ${FOUND}  (${experimentsOnDrive.length} expérience(s), ${rawFound.projects.length} projet(s))`);




