/* =========================================================================
   _diag_file.mjs — LECTURE SEULE. Qu'est-ce que c'est que ce fichier ?

   Il trouve les fichiers dont le nom contient `--name=` (un fragment), dit où ils
   sont, et montre les premiers caractères de leur contenu (JSON indenté ou brut).
   C'est ainsi qu'on reconnaît QUI a écrit un fichier qu'on ne s'explique pas.

   Usage : node _diag_file.mjs --name=Nicola --chars=600
   ========================================================================= */
const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const NAME = args.get('name') || '';
const CHARS = Number(args.get('chars') || 400);

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const api = async (path) => {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} ${path.slice(0, 90)}`);
  return res.json();
};

const listAll = async (q) => {
  const out = [];
  let pageToken = '';
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,parents)');
  do {
    const j = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};

const all = await listAll(`trashed=false and name contains '${NAME}'`);
const named = new Map(all.map((f) => [String(f.id), f]));
const pathOf = (f) => {
  const segs = [String(f.name || '')];
  let cur = f;
  let guard = 0;
  while (cur && guard++ < 30) {
    const pid = String((cur.parents || [])[0] || '');
    const parent = named.get(pid);
    if (!parent) break;
    segs.unshift(String(parent.name || ''));
    cur = parent;
  }
  return segs.join('/');
};

console.log(`# ${all.length} objet(s) dont le nom contient « ${NAME} »`);
for (const f of all.slice(0, 12)) {
  console.log(`\n## ${pathOf(f)}  (${f.createdTime}, ${f.size || 0} B)  id=${f.id}`);
  if (f.mimeType === 'application/vnd.google-apps.folder') continue;
  const res = await fetch(`${API}/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text().catch(() => '');
  console.log(text.slice(0, CHARS).replace(/\s+/g, ' '));
}
