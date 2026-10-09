/* =========================================================================
   _recover_copy_diff.mjs — LECTURE SEULE. Le CONFRONT : ce que la copie du
   Drive porte (le seul contenu que « 🔄 Resync from Drive » sait adopter) et ce
   que le Drive porte en fichiers-objets (`<expérience>.json`, matière déjà
   téléchargée par _recover_experiments_scan.mjs dans _recover/found2.json).

   Ce que ça répond : « les expériences perdues sont-elles dans la copie ? »
     • OUI  ⇒ le geste de resync peut les rendre (il ne lui manque que d'être
              appelé — et de les ré-importer dans la page, voir plus bas) ;
     • NON  ⇒ la copie est un MIROIR DE L'ÉTAT COURANT, pas une archive : elle a
              été réécrite après la perte. La seule matière qui garde le passé,
              ce sont les fichiers-objets (et leurs jumeaux, écrits à des dates
              différentes) — c'est eux qui servent à reconstruire.

   Usage :
     node _recover_copy_diff.mjs
     node _recover_copy_diff.mjs --copy=ds_ds_1788383774488.json
     node _recover_copy_diff.mjs --found=_recover/found2.json
   ========================================================================= */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import LZString from 'lz-string';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const COPY_NAME = args.get('copy') || 'ds_ds_1788383774488.json';
const FOUND_PATH = args.get('found') || '_recover/found2.json';
const OUT = args.get('out') || '_recover_copy_diff.txt';

const lines = [];
const say = (s = '') => {
  lines.push(String(s));
  console.log(String(s));
  try { writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8'); } catch { /* best-effort */ }
};

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { say('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)');
  do {
    const res = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await res.json().catch(() => ({}));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};

/** Le décodeur de l'application (`parsePayload`), appliqué à un `record`. PUR. */
const contentOfRecord = (record) => {
  if (!record || !record.payload) return null;
  let pStr = String(record.payload);
  if (record.isCompressed || (!pStr.startsWith('{') && !pStr.startsWith('['))) {
    for (const dec of [
      () => LZString.decompressFromUTF16(pStr),
      () => LZString.decompressFromBase64(pStr),
      () => LZString.decompress(pStr)
    ]) {
      try { const d = dec(); if (d) { pStr = d; break; } } catch { /* suivante */ }
    }
  }
  try { return JSON.parse(pStr); } catch { return null; }
};
/* ═══ ① LA COPIE ═══════════════════════════════════════════════════════════ */
say(`# Confront copie vs Drive — ${new Date().toISOString()}`);
const workspaces = await listAll(`mimeType='${FOLDER}' and name='Lab Workspace' and trashed=false`);
const copies = [];
for (const w of workspaces) {
  const dirs = (await listAll(`'${w.id}' in parents and trashed=false`))
    .filter((f) => f.mimeType === FOLDER && f.name === '_workspace');
  for (const dir of dirs) {
    const dsDirs = (await listAll(`'${dir.id}' in parents and trashed=false`))
      .filter((f) => f.mimeType === FOLDER && f.name === 'datasets');
    for (const dd of dsDirs) {
      (await listAll(`'${dd.id}' in parents and trashed=false`))
        .filter((f) => /^ds_.*\.json$/i.test(String(f.name)))
        .forEach((f) => copies.push(f));
    }
  }
}
say(`\n## Copies de contenu sur le Drive : ${copies.length}`);
copies.forEach((c) => say(`   • ${c.name}  ${Math.round(Number(c.size || 0) / 1024)} Ko  ${String(c.modifiedTime || '').slice(0, 16)}`));

const target = copies.find((c) => String(c.name).toLowerCase() === COPY_NAME.toLowerCase())
  || copies.filter((c) => /upjv/i.test(String(c.name))).sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)))[0]
  || copies[0];
if (!target) { say('\n✖ aucune copie : rien à confronter.'); process.exit(0); }

const resCopy = await fetch(`${API}/drive/v3/files/${target.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
const envelope = JSON.parse(await resCopy.text());
const record = envelope && envelope.record;
const content = contentOfRecord(record);
say(`\n## La copie « ${target.name} » (${Math.round(Number(target.size || 0) / 1024)} Ko, ${String(target.modifiedTime || '').slice(0, 16)})`);
say(`   enveloppe : ${Object.keys(envelope || {}).join(', ')}`);
say(`   record    : ${record ? Object.keys(record).join(', ') : 'ABSENT'}`);
say(`   identité  : id=${(record && record.id) || '—'}  titre="${(record && (record.title || record.name)) || '—'}"  isCompressed=${!!(record && record.isCompressed)}`);
if (!content) {
  say('   ✖ charge NON DÉCODÉE : le geste de resync ne pourrait rien adopter.');
  process.exit(0);
}
const list = (v) => (Array.isArray(v) ? v : []);
const copyTests = list(content.tests);
const copyProjects = list(content.projects);
const copyStorages = list(content.storages);
const copyProtocols = list(content.datasetProtocols || content.protocols);
const nameOf = (x) => String((x && (x.name || x.title)) || '').trim();
const copyNames = new Set(copyTests.map(nameOf).filter(Boolean));
say(`   charge    : ${copyTests.length} entrée(s) d’expérience (${copyNames.size} nom(s)) · `
  + `${copyProjects.length} projet(s) · ${copyStorages.length} stockage(s) · ${copyProtocols.length} protocole(s)`);
say(`   projets   : ${copyProjects.map(nameOf).filter(Boolean).join(', ') || '—'}`);

/* ═══ ② LE DRIVE (matière déjà téléchargée par la sonde) ═══════════════════ */
const found = existsSync(FOUND_PATH) ? JSON.parse(readFileSync(FOUND_PATH, 'utf8')) : null;
const driveExps = found ? list(found.experiments) : [];
say(`\n## Le Drive (fichiers-objets) : ${driveExps.length} fichier(s) d’expérience lus dans ${FOUND_PATH}`);
if (!found) say('   ⚠ lance d’abord : node _recover_experiments_scan.mjs --found=_recover/found2.json');

/* Les jumeaux (même nom, même dossier) sont des GÉNÉRATIONS : on garde la plus
   récente comme état courant, et toutes comme matière. */
const byName = new Map();
driveExps.forEach((e) => {
  const n = String(e.name || '').trim();
  if (!n) return;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(e);
});
say(`   noms distincts portés par le Drive : ${byName.size}`);

/* ═══ ③ LE CONFRONT ════════════════════════════════════════════════════════ */
const driveOnly = [...byName.keys()].filter((n) => !copyNames.has(n)).sort();
const copyOnly = [...copyNames].filter((n) => !byName.has(n)).sort();
say(`\n## ③ Ce que le Drive porte et que la COPIE ne porte PAS (à reconstruire) : ${driveOnly.length}`);
driveOnly.forEach((n) => {
  const gens = byName.get(n).slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  say(`   ▲ ${n}`);
  gens.forEach((g) => say(`       ${g.file}  id=${g.id}  savedAt=${String(g.savedAt || '').slice(0, 16)}  pixels omis=${g.omittedPixels || 0}`));
});
say(`\n## Ce que la COPIE porte et que le Drive n’a pas en fichier-objet : ${copyOnly.length}`);
copyOnly.forEach((n) => {
  const rows = copyTests.filter((t) => nameOf(t) === n);
  say(`   ▼ ${n}  (${rows.length} entrée(s), ids : ${rows.map((t) => String(t && t.id)).join(', ')})`);
});

/* ═══ ④ LA MATIÈRE DE REPRISE ══════════════════════════════════════════════ */
mkdirSync('_recover', { recursive: true });
const out = {
  at: new Date().toISOString(),
  copy: {
    file: target.name, id: target.id, modifiedTime: target.modifiedTime,
    datasetId: String((record && record.id) || ''),
    experiments: copyNames.size, entries: copyTests.length
  },
  /** Les charges complètes, prêtes à être ré-importées (📂 Load HTML) : la
   *  version la PLUS RÉCENTE de chaque expérience absente de la copie. */
  recoverable: driveOnly.map((n) => {
    const gens = byName.get(n).slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    return { name: n, generations: gens.length, object: gens[0].object };
  }),
  driveNames: [...byName.keys()].sort(),
  copyNames: [...copyNames].sort()
};
writeFileSync('_recover/recoverable_experiments.json', `${JSON.stringify(out, null, 2)}\n`, 'utf8');
say(`\n→ matière : _recover/recoverable_experiments.json (${out.recoverable.length} expérience(s) complète(s))`);
say(`→ rapport : ${OUT}`);

