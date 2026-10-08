/* =========================================================================
   _upload_twins_test.mjs — LES JUMEAUX DE FICHIERS (même nom, même dossier).

   Constaté sur le Drive réel le 21/09/2026 (dataset « GEC-UPJV-projects ») :
   **142 dossiers portaient plus d'un identifiant distinct du même nom** — six
   `_meta.json` IDENTIQUES de 519 octets écrits en 1,8 s (21 h 44 min 15 s à
   21 h 44 min 16 s) dans `agenda/2026-07-02_appointment`, six dans
   `2026-07-04_appointment`, etc. Les identifiants sont DIFFÉRENTS (la sonde les
   affiche : `node _probe_dups.mjs --name=_meta.json`) : ce ne sont pas des
   artefacts de listage, ce sont de vrais jumeaux.

   LA CAUSE. `uploadDriveFileToFolderOnce` cherchait le fichier par son nom PUIS
   écrivait. La sauvegarde publie à chaque frappe : plusieurs passes se
   chevauchaient donc, chacune cherchant le fichier AVANT que l'autre ne l'ait
   écrit — et le Drive recevait un fichier de plus par appelant.

   LE REMÈDE. Le couple (chercher → écrire) est UNIQUE par (dossier, nom), comme
   la création d'un dossier l'est déjà (`folderRace.oncePerFolder`) : les
   appelants simultanés PARTAGENT l'envoi, donc reçoivent le même identifiant, et
   un seul fichier naît.

   Vérifié ici :
     1. la clé PURE (`fileInFolderKey`) : le dossier RÉSOLU et le nom, rien d'autre ;
     2. le GESTE RÉEL, sur le module driveUpload.js (jeton + fetch bouchonnés) :
        TÉMOIN de l'ancienne règle (six envois simultanés → SIX fichiers), puis
        le correctif (six envois simultanés → UN fichier, un seul identifiant) ;
     3. ce qui reste permis : écrire PLUS TARD le même nom remplace le fichier
        (aucune seconde création), et le même nom dans un AUTRE dossier est un
        AUTRE fichier — un verrou ne doit jamais confondre deux destinations ;
     4. un Drive muet : l'envoi échoue, mais la clé est LIBÉRÉE (l'envoi suivant
        cherche et écrit pour de vrai, sinon le nom resterait bloqué) ;
     5. les contrats de code qui empêchent le défaut de revenir.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

register('./_esm_test_hook.mjs', import.meta.url);

const FOLDER = 'application/vnd.google-apps.folder';
const NAME = '_meta.json';
const META = '{"kind":"lab-workspace/folder","id":"agenda/2026-07-02_appointment"}\n';

/** La mémoire du navigateur, refaite par scénario : le magasin des envois en vol
 *  ET le dossier retenu y vivent. Un jeton bidon suffit — le Drive est bouchonné. */
const makeStorage = () => {
  const store = new Map([['labDriveAccessToken', 'fake-token']]);
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear()
  };
};

/* ── 1. La logique PURE ────────────────────────────────────────────────────
   La clé d'un fichier est celle de son dossier (même identité, vue depuis un
   fichier) : le dossier et le nom, jamais l'un sans l'autre. */
const RACE = await import('./src/utils/folderRace.js');
ok(RACE.fileInFolderKey(NAME, 'D1') !== RACE.fileInFolderKey(NAME, 'D2'),
  'deux dossiers différents = deux clés différentes');
eq(RACE.fileInFolderKey(NAME, 'D1'), RACE.folderCreateKey(NAME, 'D1'),
  'la clé d’un fichier est celle de son dossier (le nom + le conteneur)');
ok(RACE.fileInFolderKey('a', 'bc') !== RACE.fileInFolderKey('ab', 'c'),
  '…et elle ne mélange pas dossier et nom');
eq(RACE.fileInFolderKey(NAME, 'D1'), RACE.fileInFolderKey(NAME, 'D1'),
  'la même paire (nom, dossier) donne toujours la même clé');

/* ── 2. Le faux Drive (fichiers compris) ───────────────────────────────────
   Un Drive minimal mais fidèle : des NŒUDS (dossiers et fichiers) rangés par
   identifiant, une latence réseau (15 ms — c'est elle qui ouvre la fenêtre
   « chercher puis écrire »), et un JOURNAL des écritures : c'est lui qui dit
   combien de fois un (dossier, nom) a été CRÉÉ, donc si un jumeau est né. */
const makeDrive = (latency = 15) => {
  const nodes = new Map();   // id -> { id, name, parent, mimeType, trashed }
  const journal = [];        // { op:'create'|'update'|'folder', name, parent, id }
  const flags = { muteUploads: false };
  let uploads = 0;
  let seq = 0;
  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());
  const res = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  const put = ({ name, parent = '', mimeType = 'application/json' }) => {
    const id = `N${++seq}`;
    nodes.set(id, { id, name, parent, mimeType, trashed: false });
    return id;
  };
  const under = (name, parent) => [...nodes.values()]
    .filter((n) => !n.trashed && n.name === name && n.parent === parent);
  /* Le premier objet JSON d'un corps d'envoi (multipart : après les en-têtes). */
  const metaOf = async (body) => {
    if (typeof body === 'string') return JSON.parse(body || '{}');
    const txt = await body.text();
    const at = txt.indexOf('\r\n\r\n');
    return JSON.parse(txt.slice(at + 4, txt.indexOf('\r\n--', at + 4)) || '{}');
  };

  const fetchLike = async (url, init = {}) => {
    await wait();
    const u = new URL(String(url));
    const method = String(init.method || 'GET').toUpperCase();
    const q = u.searchParams.get('q') || '';
    const upload = u.pathname.startsWith('/upload/');
    if (upload) {
      uploads += 1;
      /* UNE PANNE 5xx, pas une exception de `fetch` : `driveFetch` réessaie une
         fois une COUPURE réseau (800 ms plus tard) — le compte des envois
         physiques doublerait alors pour une seule tentative logique. Un 5xx est
         justement le « Drive muet » des rapports (quota, 5xx, délai), et il
         remonte tel quel. */
      if (flags.muteUploads) return res({ error: { message: 'Drive muet' } }, 500);
      const meta = await metaOf(init.body);
      if (method === 'PATCH') {
        const id = decodeURIComponent(u.pathname.split('/').pop());
        const node = nodes.get(id);
        if (node) node.name = meta.name || node.name;
        journal.push({ op: 'update', name: meta.name, parent: node ? node.parent : '', id });
        return res({ id, name: (node && node.name) || meta.name });
      }
      const parent = (meta.parents || [])[0] || '';
      const id = put({ name: meta.name, parent, mimeType: meta.mimeType });
      journal.push({ op: 'create', name: meta.name, parent, id });
      return res({ id, name: meta.name });
    }
    if (u.pathname.endsWith('/permissions')) return res({ id: 'perm' });
    if (method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const parent = (body.parents || [])[0] || '';
      const id = put({ name: body.name, parent, mimeType: body.mimeType || FOLDER });
      journal.push({ op: 'folder', name: body.name, parent, id });
      return res({ id, name: body.name });
    }
    const byId = /\/drive\/v3\/files\/([^/?]+)/.exec(u.pathname);
    if (byId) {
      const node = nodes.get(decodeURIComponent(byId[1]));
      if (!node) return res({ error: { message: 'not found' } }, 404);
      return res({
        id: node.id, name: node.name, mimeType: node.mimeType,
        trashed: node.trashed, parents: node.parent ? [node.parent] : []
      });
    }
    const wanted = (/name='((?:[^'\\]|\\.)*)'/.exec(q) || [])[1];
    const name = wanted ? wanted.replace(/\\'/g, "'") : '';
    const parent = (/'(?:([A-Za-z0-9_-]+))' in parents/.exec(q) || [])[1] || '';
    const rootOnly = /'root' in parents/.test(q);
    const folderOnly = q.includes(`mimeType='${FOLDER}'`);
    let out = [...nodes.values()].filter((n) => !n.trashed);
    if (rootOnly) out = out.filter((n) => !n.parent);
    else if (parent) out = out.filter((n) => n.parent === parent);
    if (name) out = out.filter((n) => n.name === name);
    if (folderOnly) out = out.filter((n) => n.mimeType === FOLDER);
    return res({ files: out });
  };

  return {
    fetch: fetchLike,
    /** Un dossier posé à la main (la destination d'un envoi) : son identifiant. */
    folder: (name, parent = '') => put({ name, parent, mimeType: FOLDER }),
    /** Ce qui existe VRAIMENT sous ce nom dans ce dossier (les dossiers exclus). */
    filesNamed: (name, parent) => under(name, parent).filter((n) => n.mimeType !== FOLDER),
    /** Combien de fois ce (dossier, nom) a été CRÉÉ sur ce Drive. */
    creates: (name, parent) => journal.filter((e) => e.op === 'create' && e.name === name && e.parent === parent).length,
    /** …et combien de fois il a été RÉÉCRIT (un remplacement, aucun jumeau). */
    updates: (name, parent) => journal.filter((e) => e.op === 'update' && e.name === name && e.parent === parent).length,
    /** Les (dossier, nom) créés PLUS D'UNE FOIS : les jumeaux. */
    duplicates: () => {
      const seen = new Map();
      journal.filter((e) => e.op === 'create').forEach((e) => {
        const k = `${e.parent || '.'}/${e.name}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      });
      return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    },
    /** Combien d'envois ont été TENTÉS (réussis ou non). */
    uploads: () => uploads,
    muteUploads: (v) => { flags.muteUploads = v === undefined ? true : !!v; }
  };
};

/** Le module RÉEL, sur SON faux Drive : chaque scénario reçoit sa propre instance
 *  (l'état du module — envois en vol, dossier retenu — ne doit pas fuir d'un
 *  scénario à l'autre). `?upload-…` contourne le bouchon du crochet de test. */
const load = async (tag, drive) => {
  globalThis.localStorage = makeStorage();
  globalThis.fetch = drive.fetch;
  return await import(`./src/utils/driveUpload.js?upload-${tag}`);
};

/** L'envoi d'un `_meta.json` dans un dossier DONNÉ, tel que le fait la
 *  publication du dataset (`driveStructure` : `folderId` connu, corps JSON). */
const sendMeta = (mod, folderId) => mod.uploadLocalFile({
  name: NAME,
  mimeType: 'application/json',
  file: new Blob([META], { type: 'application/json' }),
  folderId,
  skipQueue: true
});

/* ── 3. TÉMOIN — l'ancienne règle, reproduite à la main ───────────────────
   L'ancien envoi : chercher le fichier par son nom, puis écrire SEULEMENT s'il
   n'existe pas. Six envois simultanés cherchent tous avant le premier POST : le
   Drive reçoit six fichiers. C'est exactement ce que la sonde a vu sur le Drive
   réel (`_probe_dups.mjs` : des identifiants différents pour le même nom). */
const witness = makeDrive();
const W_DIR = witness.folder('2026-07-02_appointment', 'dsRoot');
const oldSearch = (name, parent) => witness.fetch(
  'https://www.googleapis.com/drive/v3/files'
  + `?q=${encodeURIComponent(`name='${name}' and '${parent}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=10`
);
const oldWrite = (name, parent) => witness.fetch(
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
  {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=b' },
    body: new Blob([
      '--b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
      + JSON.stringify({ name, mimeType: 'application/json', parents: [parent] })
      + '\r\n--b\r\nContent-Type: application/json\r\n\r\n' + META + '\r\n--b--\r\n'
    ])
  }
);
await Promise.all([...Array(6)].map(async () => {
  const found = await (await oldSearch(NAME, W_DIR)).json();
  if ((found.files || []).length) return;
  await oldWrite(NAME, W_DIR);
}));
eq(witness.filesNamed(NAME, W_DIR).length, 6,
  'témoin : six envois simultanés de l’ancienne règle (chercher PUIS écrire) → SIX fichiers');
eq(witness.duplicates(), [`${W_DIR}/${NAME}`],
  '…et le journal le nomme : ce (dossier, nom) a été créé six fois');

/* ── 4. LE CORRECTIF — six envois simultanés, UN seul fichier ───────────── */
const race = makeDrive();
const U = await load('same', race);
const DIR = race.folder('2026-07-02_appointment', 'dsRoot');
const six = await Promise.all([...Array(6)].map(() => sendMeta(U, DIR)));
ok(six.every((r) => r && r.id), 'les six envois aboutissent (aucun appelant n’est perdu)');
eq(new Set(six.map((r) => r.id)).size, 1,
  '…et ils rendent tous LE MÊME identifiant (c’est le même fichier)');
eq(six[0].name, NAME, '…avec le nom demandé');
eq(race.filesNamed(NAME, DIR).length, 1, 'le dossier ne porte qu’UN « _meta.json »');
eq(race.creates(NAME, DIR), 1, '…une seule création dans le journal du Drive');
eq(race.duplicates(), [], 'aucun (dossier, nom) créé deux fois : plus de jumeaux');

/* ── 5. Ce qui reste permis ─────────────────────────────────────────────── */
/* a. Écrire PLUS TARD le même nom réutilise le fichier (la règle d'origine) :
      le verrou ne la change pas — le second envoi arrive APRÈS la fin du
      premier, il cherche donc, le trouve, et le REMPLACE. */
const later = await sendMeta(U, DIR);
ok(later && later.id === six[0].id, 'un envoi postérieur du même nom réutilise LE MÊME fichier');
eq(race.filesNamed(NAME, DIR).length, 1, '…toujours un seul fichier');
eq(race.updates(NAME, DIR), 1, '…par une MISE À JOUR (le Drive ne reçoit pas un second POST)');

/* b. Le même nom dans un AUTRE dossier est un AUTRE fichier. C'est le piège
      d'un verrou : une clé bâtie sur un chemin nominal (ou sur le seul nom)
      ferait écrire — ou pire, NE PAS écrire — dans le mauvais dossier. */
const otherDir = race.folder('2026-07-04_appointment', 'dsRoot');
const other = await sendMeta(U, otherDir);
ok(other && other.id !== six[0].id, 'le même nom dans un autre dossier est un AUTRE fichier');
eq(race.filesNamed(NAME, otherDir).length, 1, '…et il a bien été écrit là-bas');
eq(race.filesNamed(NAME, DIR).length, 1, '…sans rien ajouter dans le premier dossier');

/* ── 6. Un Drive MUET ne bloque pas le nom ────────────────────────────────
   Les trois envois simultanés partagent UNE tentative : ils échouent donc
   ENSEMBLE (un échec dit, pas trois demi-envois) — et surtout la clé est
   LIBÉRÉE, sinon un Drive injoignable laisserait le nom occupé et le fichier ne
   serait plus jamais remplacé. */
const flaky = makeDrive();
const F = await load('mute', flaky);
const FDIR = flaky.folder('2026-07-02_appointment', 'dsRoot');
flaky.muteUploads();
const failed = await Promise.all([...Array(3)].map(() => sendMeta(F, FDIR)));
eq(failed, [null, null, null], 'Drive muet : les envois simultanés échouent (aucun fichier inventé)');
eq(flaky.uploads(), 1, '…et ils n’ont fait qu’UNE tentative (l’échec est dit, pas multiplié)');
eq(flaky.filesNamed(NAME, FDIR).length, 0, '…rien n’a été écrit');
flaky.muteUploads(false);
const back = await sendMeta(F, FDIR);
ok(back && back.id, 'le Drive revenu, l’envoi suivant écrit pour de vrai');
eq(flaky.filesNamed(NAME, FDIR).length, 1, '…un seul fichier (la clé n’était pas restée occupée)');
eq(flaky.creates(NAME, FDIR), 1, '…et une seule création');

/* ── 7. Les contrats de code (le défaut ne peut pas revenir) ─────────────── */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const UPLOAD = read('src/utils/driveUpload.js');
const RACESRC = read('src/utils/folderRace.js');

has(RACESRC, 'export const fileInFolderKey = (name, folderId) => folderCreateKey(name, folderId);',
  'folderRace expose la clé d’un fichier : son nom + son dossier');
has(RACESRC, 'agenda/2026-07-02_appointment',
  '…et la raison (les six `_meta.json` du Drive réel) est écrite dans le module');
has(UPLOAD, 'const uploadsInFlight = new Map();', 'driveUpload tient UN magasin d’envois en vol');
has(UPLOAD, "import { oncePerFolder, folderCreateKey, fileInFolderKey } from './folderRace';",
  '…branché sur le module des opérations uniques');
has(UPLOAD, 'return oncePerFolder(uploadsInFlight, fileInFolderKey(name, targetId), () => writeFileInResolvedFolder({',
  'les envois d’expérience gardent (chercher → écrire) en vol, sur le dossier RÉSOLU');
has(UPLOAD, 'return await oncePerFolder(uploadsInFlight, fileInFolderKey(name, folderId), () =>',
  '…et les sauvegardes hebdomadaires aussi (même verrou, autre dossier)');
eq(UPLOAD.split('oncePerFolder(uploadsInFlight').length - 1, 2,
  'les DEUX chemins qui cherchent-puis-écrivent un fichier sont sous le verrou (aucun frère oublié)');
/* LE POINT CAPITAL : la recherche doit être DANS le travail unique. Si elle
   restait dehors, deux appelants chercheraient tous les deux « rien » — et le
   défaut reviendrait exactement là où il était. */
const atLock = UPLOAD.indexOf('oncePerFolder(uploadsInFlight, fileInFolderKey(name, targetId)');
const atSearch = UPLOAD.indexOf("const q = encodeURIComponent(`name='${safeName}' and '${targetId}' in parents");
ok(atLock !== -1 && atSearch !== -1 && atLock < atSearch,
  'la RECHERCHE du fichier est DANS le travail unique (sinon la fenêtre reste ouverte)');
/* Un verrou par (dossier, nom) ne se base pas sur un chemin nominal : deux
   chemins différents désignent parfois LE MÊME dossier, et l’inverse. */
ok(!/fileInFolderKey\((?:folderNames|path|ctx)\b/.test(UPLOAD),
  'la clé ne dépend jamais d’un chemin nominal (le dossier est RÉSOLU avant)');

console.log(`_upload_twins_test: ${passed} passed`);
