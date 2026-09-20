/* =========================================================================
   _diag_instance_twins.mjs — LECTURE SEULE. OÙ SONT LES DOSSIERS EN DOUBLE.

   Symptôme constaté par l'utilisateur le 20/09/2026 : dans le Drive, les
   dossiers d'INSTANCE d'une expérience apparaissent « souvent en double »
   (deux dossiers pour la même instance), vu pour l'expérience NMR.

   Ce script ne MODIFIE rien (aucune création, aucun déplacement, aucune mise
   à la corbeille) : il lit l'arborescence et rapporte
     1. les jumeaux des conteneurs canoniques du dataset (projects, protocols…) ;
     2. pour CHAQUE dossier visité : les enfants dont le nom est identique à la
        normalisation près (minuscules, sans séparateurs) — donc les JUMEAUX —
        avec le nombre d'éléments de chacun (un jumeau vide est celui qu'une
        version précédente a créé à côté des données) ;
     3. l'arbre des expériences sous `projects/` jusqu'au niveau demandé, pour
        situer l'expérience NMR (`data/Bruker_1r`).

   Usage :
     node _diag_instance_twins.mjs
     node _diag_instance_twins.mjs --dataset=GEC-UPJV-projects
     node _diag_instance_twins.mjs --dataset=1fiiNoFCfioYFP1rt_1IwV1PZ3d0jlwil --depth=6
     node _diag_instance_twins.mjs --all --depth=4
   La sortie est aussi écrite dans _diag_instance_twins_out.txt.
   ========================================================================= */
import { writeFileSync } from 'node:fs';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const ALL = args.get('all') === 'true';
const DATASET = args.get('dataset') || 'GEC-UPJV-projects';
const DEPTH = Number(args.get('depth') || 4);

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) {
  say('PAS DE JETON — serveur de jetons injoignable : rien de vérifié (relancer quand le réseau revient).');
  writeFileSync('_diag_instance_twins_out.txt', lines.join('\n'), 'utf8');
  process.exit(0);
}

const api = async (path) => {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res;
};
const json = async (path) => (await api(path)).json();

/** TOUS les enfants d'un dossier (paginé). */
const listAll = async (parentId) => {
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,createdTime,size)');
    const page = await json(`/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`);
    out.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
};

/** Clé de comparaison d'un nom de dossier : minuscules, sans séparateurs —
 *  la même règle que figuresFolder.folderNameKey. */
const nameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const isFolder = (n) => n && n.mimeType === FOLDER;

/* Ce que contient un dossier, en une requête : dossiers et fichiers. */
const peek = async (id) => {
  const kids = await listAll(id).catch(() => []);
  return { folders: kids.filter(isFolder).length, files: kids.filter((n) => !isFolder(n)).length };
};


const findings = [];   // { path, children: [[{name,id,counts}]] }
const tree = [];       // lignes de l'arbre lu

/** Jumeaux d'une liste de dossiers : groupes dont le nom normalisé est égal. */
const twinGroups = (folders) => {
  const byKey = new Map();
  folders.forEach((f) => {
    const k = nameKey(f.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  });
  return [...byKey.values()].filter((g) => g.length > 1);
};

/** Marche un dossier : signale les jumeaux, descend dans les sous-dossiers. */
const walk = async (folderId, pathParts, depth) => {
  const kids = await listAll(folderId).catch((err) => { say(`   ! ${pathParts.join('/')} : ${err.message}`); return []; });
  const folders = kids.filter(isFolder);
  const files = kids.filter((n) => !isFolder(n));

  const twins = twinGroups(folders);
  if (twins.length) {
    const detail = [];
    for (const group of twins) {
      const withCounts = [];
      for (const f of group) withCounts.push({ name: f.name, id: f.id, createdTime: f.createdTime, ...(await peek(f.id)) });
      detail.push(withCounts);
    }
    findings.push({ path: pathParts.join('/') || '(dataset)', children: detail });
    say(`  ✗ JUMEAUX dans ${pathParts.join('/')} :`);
    detail.forEach((group) => {
      group.forEach((c, i) => say(`      ${i ? 'contre ' : '       '}« ${c.name} » [${c.id}] créé ${c.createdTime || '?'} → ${c.folders} dossier(s), ${c.files} fichier(s)`));
    });
  }

  tree.push(`${'  '.repeat(depth)}${pathParts[pathParts.length - 1]}/  (${folders.length} dossier(s), ${files.length} fichier(s))`
    + (folders.length ? `  [${folders.map((f) => f.name).join(', ')}]` : ''));

  if (depth >= DEPTH) return;
  for (const f of folders) await walk(f.id, [...pathParts, f.name], depth + 1);
};

/* ── Le point d'entrée : les datasets du « Lab Workspace » ───────────────── */
const roots = (await json(`/drive/v3/files?q=${encodeURIComponent(`name='Lab Workspace' and mimeType='${FOLDER}' and trashed=false`)}&fields=files(id,name)&pageSize=10`)).files || [];
if (!roots.length) say('Lab Workspace introuvable sur ce Drive.');
for (const workspace of roots) {
  say(`\n=== Lab Workspace [${workspace.id}] ===`);
  const datasets = (await listAll(workspace.id).catch(() => [])).filter(isFolder);
  say(`Datasets lus : ${datasets.map((d) => `${d.name} [${d.id}]`).join(', ') || '(aucun)'}`);
  for (const ds of datasets) {
    if (!ALL && DATASET && ds.name !== DATASET && ds.id !== DATASET) continue;
    say(`\n--- Dataset « ${ds.name} » [${ds.id}] ---`);
    /* 1. Les conteneurs canoniques du dataset (projects / protocols / …) : le
       lieu des jumeaux historiques, vérifié ici aussi. */
    const dsFolders = (await listAll(ds.id).catch(() => [])).filter(isFolder);
    const dsTwins = twinGroups(dsFolders);
    if (dsTwins.length) {
      findings.push({ path: `dataset « ${ds.name} » (racine)`, children: dsTwins.map((g) => g.map((f) => ({ name: f.name, id: f.id, createdTime: f.createdTime }))) });
      say(`  ✗ JUMEAUX à la racine du dataset : ${dsTwins.map((g) => g.map((f) => `« ${f.name} » [${f.id}] créé ${f.createdTime || '?'}`).join(' contre ')).join(' ; ')}`);
    }
    say(`Racine du dataset : ${dsFolders.map((f) => f.name).join(', ') || '(aucun dossier)'}`);
    /* 2. L'arbre des expériences : le lieu des jumeaux d'INSTANCE. */
    const projectsFolder = dsFolders.find((f) => nameKey(f.name) === 'projects');
    if (!projectsFolder) { say('  (pas de conteneur « projects »)'); continue; }
    await walk(projectsFolder.id, ['projects'], 1);
  }
}

say('\n=== ARBRE LU ===');
tree.forEach((t) => say(t));
say(`\n=== BILAN : ${findings.length} emplacement(s) avec des dossiers jumeaux ===`);
findings.forEach((f) => say(`  • ${f.path}`));

writeFileSync('_diag_instance_twins_out.txt', lines.join('\n'), 'utf8');
say('\n(_diag_instance_twins_out.txt)');
