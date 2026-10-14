/* =========================================================================
   _probe_test86.mjs — LECTURE SEULE. « Où en est l'expérience Test 86 ? »

   La question posée : « remettre Test 86, elle est sur le Drive mais invisible
   dans le programme ». Ce qu'il faut savoir AVANT tout geste, et que trois
   lectures suffisent à établir (aucune écriture, aucun dossier créé, que des GET) :

     ① LE DOCUMENT PARTAGÉ (Firestore) — c'est LUI que l'écran affiche : Test 86
        y est-elle, sous quel id, dans quel(s) projet(s) ? C'est la réponse à
        « l'import a-t-il manqué, ou l'expérience est-elle revenue puis reparue ? » ;
     ② LA COPIE DU DRIVE (`_workspace/datasets/ds_<id>.json`) ET L'INDEX
        (`_workspace/state.json`) — ce que le miroir porte à sa date ;
     ③ LES FICHIERS-OBJETS DU DRIVE (`projects/<projet>/<exp>/<instance>/<exp>.json`)
        — la seule trace que l'application NE relit PAS (voir
        _recover_experiments_scan.mjs) : elle dit si le dossier de l'expérience
        est toujours là, et depuis quand.

   Usage : node _probe_test86.mjs
           node _probe_test86.mjs --id=ds_ds_1788383774488 --name="Test 86"
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';
const FS_ROOT = 'https://firestore.googleapis.com/v1/projects/cell-experiment-tracker/databases/(default)/documents';
const FS_KEY = 'AIzaSyCVemPUayc_Q-IsbcQxnFRHg8bBLZFSHfA';
const APP_ID = 'lab-workspace-app';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const DS_ID = String(args.get('id') || 'ds_ds_1788383774488');
const WANT_NAME = String(args.get('name') || 'Test 86').trim();
const WANT_ID = String(args.get('testid') || 't17918122680048458');
const OUT = args.get('out') || '_probe_test86.txt';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) say('PAS DE JETON DRIVE : les parties ② et ③ ne seront pas lues.');

const drive = async (path) => {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return res.json();
};
const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)');
  do {
    const j = await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};
const mediaText = async (id) => {
  const res = await fetch(`${API}/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? res.text().catch(() => '') : '';
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
const when = (v) => String(v || '').slice(0, 16).replace('T', ' ');
const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();

/* ══ ① LE DOCUMENT PARTAGÉ (Firestore) ════════════════════════════════════ */
say('════ ① LE DOCUMENT PARTAGÉ (Firestore) — c’est lui que l’écran affiche ════');
const fsGet = async (path, mask) => {
  const url = `${FS_ROOT}/${path}?key=${FS_KEY}` + (mask || []).map((m) => `&mask.fieldPaths=${encodeURIComponent(m)}`).join('');
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0, body: res ? (await res.text().catch(() => '')).slice(0, 200) : '' };
  return { ok: true, doc: await res.json().catch(() => null) };
};
const fsList = async (path, mask, pageSize = 200) => {
  const url = `${FS_ROOT}/${path}?key=${FS_KEY}&pageSize=${pageSize}`
    + mask.map((m) => `&mask.fieldPaths=${encodeURIComponent(m)}`).join('');
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
  return { ok: true, data: await res.json().catch(() => ({})) };
};

const COLL = `artifacts/${APP_ID}/public/data/datasets`;
const list = await fsList(COLL, ['title', 'subtitle', 'testCount', 'updatedAt', 'isCompressed']);
if (!list.ok) {
  say(`   ⚠ liste illisible (HTTP ${list.status}) — la lecture publique est peut-être fermée ;`);
  say('     les parties ② et ③ restent valables (le Drive, lui, répond).');
} else {
  const docs = Array.isArray(list.data.documents) ? list.data.documents : [];
  say(`   ${docs.length} document(s) dans ${COLL}`);
  docs.map((d) => {
    const f = d.fields || {};
    return {
      id: String(d.name || '').split('/').pop(),
      title: (f.title && f.title.stringValue) || '',
      tests: Number((f.testCount && (f.testCount.integerValue || f.testCount.doubleValue)) || 0),
      at: when((f.updatedAt && (f.updatedAt.stringValue || f.updatedAt.integerValue)) || '')
    };
  }).sort((a, b) => String(b.at).localeCompare(String(a.at))).forEach((d) => {
    say(`      • ${d.id}  « ${d.title} »  ${d.tests} test(s)  maj ${d.at}`);
  });
}

const doc = await fsGet(`${COLL}/${DS_ID}`, ['payload', 'isCompressed', 'title', 'testCount', 'updatedAt']);
let sharedTests = [];
if (!doc.ok) {
  say(`\n   ⚠ document ${DS_ID} illisible (HTTP ${doc.status}) ${doc.body || ''}`);
} else {
  const f = (doc.doc && doc.doc.fields) || {};
  const payload = (f.payload && f.payload.stringValue) || '';
  const compressed = !!(f.isCompressed && f.isCompressed.booleanValue);
  const parsed = decode(payload, compressed);
  sharedTests = Array.isArray(parsed && parsed.tests) ? parsed.tests : [];
  say(`\n   « ${(f.title && f.title.stringValue) || ''} »  (${DS_ID})  maj ${when((f.updatedAt && (f.updatedAt.stringValue || f.updatedAt.integerValue)) || '')}`);
  say(`   payload ${Math.round(payload.length / 1024)} Ko${compressed ? ' (compressé)' : ''} → ${sharedTests.length} expérience(s)`);
}

const byId = sharedTests.find((t) => String(t.id) === WANT_ID);
const byName = sharedTests.filter((t) => norm(t.name) === WANT_NAME);
say(`\n   ▸ « ${WANT_NAME} » (id ${WANT_ID}) dans le document partagé : ${(byId || byName.length) ? 'OUI' : 'NON'}`);
if (byId) {
  say(`      id trouvé — nom « ${norm(byId.name)} »  projet(s) ${(byId.projectNames || []).filter(Boolean).join(', ') || '—'}`
    + `  instance ${byId.instanceName || '—'}  maj ${when(byId.savedAt)}`);
} else if (byName.length) {
  byName.forEach((t) => say(`      homonyme id ${t.id}  instance ${t.instanceName || '—'}  maj ${when(t.savedAt)}`));
}
const project = String(args.get('project') || 'NATURAL ARSENAL Antibiotics');
const inProject = sharedTests.filter((t) => (Array.isArray(t.projectNames) ? t.projectNames : [])
  .some((p) => norm(p) === norm(project)));
say(`   ▸ expériences du projet « ${project} » : ${inProject.length}`);
inProject.forEach((t) => say(`      • « ${norm(t.name)} »  id ${t.id}  maj ${when(t.savedAt)}`));

/* ══ ② LA COPIE DU DRIVE + L'INDEX ════════════════════════════════════════ */
say('\n════ ② LA COPIE DU DRIVE ET L’INDEX DE L’ESPACE DE TRAVAIL ════');
if (!token) {
  say('   (pas de jeton : rien lu)');
} else {
  const all = await listAll('trashed=false');
  const byDriveId = new Map(all.map((f) => [f.id, f]));
  const pathOf = (f) => {
    const parts = [];
    let cur = f; let guard = 0;
    while (cur && guard < 20) {
      parts.unshift(cur.name);
      const p = (cur.parents || [])[0];
      cur = p ? byDriveId.get(p) : null;
      guard += 1;
    }
    return parts.join('/');
  };
  say(`   ${all.length} entrée(s) sur le Drive (trashed=false)`);
  const copies = all.filter((f) => /(^|\/)_workspace\/datasets\/ds_.*\.json$/i.test(pathOf(f)));
  say(`   copies de dataset dans l’espace de travail : ${copies.length}`);
  /* Chaque copie est DÉCODÉE : le titre du dataset n'est pas dans le nom du
     fichier mais dans la charge. C'est le seul moyen sûr de rapprocher une copie
     de son dataset (l'identifiant du dossier du dataset, lui, peut porter un
     « ds_ » de plus selon la génération — voir le nom réel ci-dessus). */
  const wanted = String(args.get('title') || 'GEC-UPJV-projects');
  for (const f of copies) {
    /* La copie est une ENVELOPPE (`{ kind, at, record }`) et le `record` porte le
       MÊME couple que le document Firestore : `payload` (LZString UTF-16) +
       `isCompressed` — voir App.jsx (`updatedPayload`). C'est ce que l'app relit
       (`readDatasetCopy` → `parsePayload`) : on relit donc EXACTEMENT pareil. */
    const outer = decode(await mediaText(f.id), false);
    const record = (outer && outer.record) || {};
    const state = decode(record.payload, record.isCompressed !== false);
    const tests = Array.isArray(state && state.tests) ? state.tests : [];
    const title = String(record.title || (state && state.datasetTitle) || '—');
    const hasId = tests.some((t) => String(t.id) === WANT_ID);
    const hasName = tests.some((t) => norm(t.name) === WANT_NAME);
    const mark = norm(title) === norm(wanted) ? ' ◀ NOTRE DATASET' : '';
    say(`      • ${String(f.name).padEnd(34)} maj ${when(f.modifiedTime)}  ${String(Math.round(Number(f.size || 0) / 1024)).padStart(4)} Ko`
      + `  « ${title} »  ${tests.length} test(s)  · ${WANT_NAME} : ${hasId ? 'OUI (id)' : (hasName ? 'OUI (nom)' : 'non')}${mark}`);
    if (mark && tests.length) {
      /* ══ ④ LE LIEN DE L'EXPÉRIENCE : c'est LUI qui décide si elle est visible ══
         Une expérience que le dataset porte mais dont le PROJET ne porte pas
         l'entrée (`project.experiments[].testId`) reste dans la liste
         « Expériences » et DISPARAÎT de la page de son projet. On lit donc les
         DEUX moitiés du lien, dans la copie vive (voir utils/experimentRules.js :
         `experimentProjects` côté test, `project.experiments[]` côté projet). */
      const fat = tests.find((t) => String(t.id) === WANT_ID);
      say(`         ── ${WANT_NAME} (id ${WANT_ID}) dans la copie vive : ${fat ? 'PRÉSENTE' : 'ABSENTE'}`);
      if (fat) {
        say(`            nom « ${norm(fat.name)} »  instance ${fat.instanceName || '—'}  catégorie ${fat.testCategory || '—'}`
          + `  opérateur ${fat.operator || '—'}`);
        say(`            projectNames = ${JSON.stringify(fat.projectNames || [])}`);
        const keys = Object.keys(fat);
        say(`            champs (${keys.length}) : ${keys.slice(0, 20).join(', ')}${keys.length > 20 ? ', …' : ''}`);
      }
      const projects = Array.isArray(state && state.projects) ? state.projects : [];
      /* Les jumeaux : la règle d'identité de l'IMPORT est le NOM
         (`testGroupKey` = `name:<nom>`, loadSelection.js) — pas l'id. Deux
         essais de même id mais de noms différents sont donc DEUX lignes, et un
         import qui rapporte l'ancien nom en créerait un second. On regarde. */
      const byIdCount = new Map();
      tests.forEach((t) => byIdCount.set(String(t.id), (byIdCount.get(String(t.id)) || 0) + 1));
      const twins = [...byIdCount.entries()].filter(([, n]) => n > 1);
      say(`         jumeaux (même id sur plusieurs essais) : ${twins.length}`
        + `${twins.length ? ` → ${twins.map(([id, n]) => `${id}×${n}`).join(', ')}` : ''}`);
      const lookalike = tests.filter((t) => /^(Test\s*\d+|CDCHD)$/i.test(norm(t.name)));
      say(`         essais nommés « Test <n> » ou « CDCHD » : ${lookalike.length}`);
      lookalike.sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .forEach((t) => say(`            • « ${norm(t.name)} »  id ${t.id}  instance ${t.instanceName || '—'}`
          + `  projet(s) ${(t.projectNames || []).join(', ') || '—'}`));
      const holders = projects.filter((p) => ((p && p.experiments) || [])
        .some((e) => e && String(e.testId) === WANT_ID));
      say(`         projets portés par la copie : ${projects.length}`
        + `  ·  projets dont « experiments[] » PORTE l’entrée de ${WANT_NAME} : ${holders.length}`
        + `${holders.length ? ` → ${holders.map((p) => norm(p.name)).join(', ')}` : ''}`);
      if (fat && !holders.length) {
        say(`         ⛔ DIAGNOSTIC : le PROJET ne porte pas l’entrée de ${WANT_NAME}`
          + (Array.isArray(fat.projectNames) && fat.projectNames.length
            ? ` (le test annonce pourtant : ${fat.projectNames.join(', ')}) — moitié de lien manquante.`
            : ' — et le test n’annonce AUCUN projet.'));
        say('            LE GESTE : page du projet → « Link existing test » → choisir cette expérience'
          + ' (aucun fichier n’est nécessaire, voir docs/DRIVE-MIRROR.md § « l’expérience perdue »).');
      } else if (fat && holders.length) {
        say('         ✔ Les deux moitiés du lien sont là : l’expérience est liée à son projet.');
      }
    }
  }
  const states = all.filter((f) => String(f.name) === 'state.json');
  say(`   ▸ copies de l’index state.json : ${states.length}`);
  for (const st of states) {
    const parsed = decode(await mediaText(st.id), false);
    const idx = Array.isArray(parsed && parsed.datasets) ? parsed.datasets : [];
    say(`      • ${pathOf(st)}  maj ${when(st.modifiedTime)}  ${idx.length} dataset(s)`);
    idx.forEach((d) => say(`         • ${d.id}  « ${d.title} »  ${Number(d.testCount) || 0} test(s)  maj ${when(d.updatedAt)}`));
  }

  /* ══ ③ LES FICHIERS-OBJETS DU DRIVE ═════════════════════════════════════ */
  say('\n════ ③ LES FICHIERS-OBJETS DU DRIVE (la trace que l’app ne relit pas) ════');
  /* Les noms du Drive sont des « slugs » (`sanitizeSlug`) : l'espace d'un nom
     d'expérience y devient `_`. Chercher « Test 86 » seul ne trouverait rien. */
  const slugs = [...new Set([WANT_NAME, WANT_NAME.replace(/\s+/g, '_')])];
  say(`   recherche des chemins contenant : ${slugs.map((s) => `« ${s} »`).join(' ou ')}`);
  const dot = all.filter((f) => slugs.some((s) => pathOf(f).includes(s)));
  say(`   ${dot.length} entrée(s) dont le CHEMIN contient « ${WANT_NAME} » :`);
  dot.slice().sort((a, b) => String(pathOf(a)).localeCompare(String(pathOf(b)))).forEach((f) => {
    const isDir = f.mimeType === FOLDER;
    say(`      ${isDir ? '📁' : '📄'} ${pathOf(f)}  ${isDir ? '' : `${Math.round(Number(f.size || 0) / 1024)} Ko  `}créé ${when(f.createdTime)}  modifié ${when(f.modifiedTime)}`);
  });
  const objFiles = dot.filter((f) => f.mimeType !== FOLDER && /\.json$/i.test(f.name) && !/_meta\.json$/i.test(f.name));
  for (const f of objFiles) {
    const body = decode(await mediaText(f.id), false);
    const data = body && body.data;
    const names = data && Array.isArray(data.projectNames) ? data.projectNames.filter(Boolean) : [];
    say(`\n      ▲ fichier-objet ${pathOf(f)}`);
    say(`         type=${(body && body.type) || '—'}  id=${(body && body.id) || '—'}  nom=${(data && norm(data.name)) || '—'}  projet(s) ${names.join(', ') || '—'}`);
    say(`         id attendu ${WANT_ID} → ${String(body && body.id) === WANT_ID ? 'IDENTIQUE' : (body && body.id ? 'DIFFÉRENT' : 'absent du fichier')}`);
    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      say(`         charge : ${keys.length} champ(s) — ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ', …' : ''}`);
    }
  }
}

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`\n→ rapport : ${OUT}`);


