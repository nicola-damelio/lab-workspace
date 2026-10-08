/* =========================================================================
   _diag_lag.mjs — LA QUESTION : le Drive VOIT-IL tout de suite le fichier qu'il
   vient de créer ?

   C'est la seule chose qui peut expliquer des jumeaux SEQUENTIELS : l'écriture
   cherche le fichier par son nom AVANT d'écrire (c'est la règle d'écrasement),
   et si la RECHERCHE ne voit pas encore ce que le POST précédent vient d'écrire,
   chaque passe crée un fichier de plus.

   Il écrit UN petit fichier dans un dossier de travail, le cherche aussitôt,
   répète la recherche, puis met le fichier À LA CORBEILLE (jamais de destruction).
   Rien d'autre n'est touché.

   Usage : node _diag_lag.mjs [--parent=GEC-UPJV-projects] [--seconds=15]
   ========================================================================= */
const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const PARENT_NAME = args.get('parent') || 'GEC-UPJV-projects';
const SECONDS = Number(args.get('seconds') || 15);
const NAME = `_diag_lag_probe_${Date.now()}.txt`;

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été fait.'); process.exit(0); }

const api = async (path, opts = {}) => {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
  }
  return res.json();
};

const findFolder = async (name, parent) => {
  const q = encodeURIComponent(`name='${name}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const j = await api(`/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=5`);
  return (j.files || [])[0] || null;
};

const listRoot = async () => api('/drive/v3/files?q=' + encodeURIComponent("'root' in parents and trashed=false")
  + '&fields=files(id,name,mimeType)&pageSize=50');

const searchByName = async (name, parentId) => {
  const q = encodeURIComponent(`name='${name}' and '${parentId}' in parents and trashed=false`);
  const j = await api(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
  return (j.files || []).length;
};

const root = await listRoot();
const workspace = root.files.find((f) => f.name === 'Lab Workspace');
console.log(`# dossiers à la racine visibles : ${root.files.map((f) => f.name).join(' · ')}`);
/* Le dossier de travail est cherché PAR SON NOM, où qu'il soit (la racine du
   compte n'est pas toujours lisible par ce jeton) — même geste que les autres
   sondes. */
const found = await api('/drive/v3/files?q='
  + encodeURIComponent(`name='${PARENT_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  + '&fields=files(id,name,createdTime,parents)&pageSize=10');
const dataset = found.files[0];
if (!dataset) { console.log(`PAS de dossier « ${PARENT_NAME} » visible.`); process.exit(0); }
console.log(`# dossier de travail : ${PARENT_NAME} (${dataset.id})${workspace ? '' : ' — hors racine lisible'}`);

const t0 = Date.now();
/* LE POST — exactement la requête du module (multipart, métadonnées + contenu). */
const boundary = 'diagBoundary' + t0;
const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
  + JSON.stringify({ name: NAME, mimeType: 'text/plain', parents: [dataset.id] })
  + `\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n`;
const post = `\r\n--${boundary}--\r\n`;
const created = await api('/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
  method: 'POST',
  headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  body: pre + 'probe' + post
});
console.log(`# POST t+0 ms  →  id=${created.id}`);
console.log(`# t+${Date.now() - t0} ms  recherche par nom : ${await searchByName(NAME, dataset.id)} résultat(s)`);

let seenAt = null;
for (let i = 1; i * 1000 <= SECONDS * 1000; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const n = await searchByName(NAME, dataset.id);
  console.log(`# t+${Date.now() - t0} ms  recherche par nom : ${n} résultat(s)`);
  if (n > 0) { seenAt = Date.now() - t0; break; }
}
console.log(seenAt === null
  ? `# LA LECTURE PAR NOM NE L'A JAMAIS VU EN ${SECONDS} s`
  : `# LA LECTURE PAR NOM L'A VU APRÈS ${seenAt} ms`);

/* NETTOYAGE : le fichier part à la corbeille (jamais une destruction). */
await api(`/drive/v3/files/${created.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trashed: true })
}).then(() => console.log('# fichier de sonde mis à la corbeille')).catch((e) => console.log(`# nettoyage : ${e.message}`));
