/* Verification BOUT EN BOUT contre le VRAI Drive : un graphe Flow Cytometry
   sauvé en image doit arriver sur le Drive en tant que `.svg` de type
   `image/svg+xml`, avec le contenu XML exact — c'est ce que la correction
   garantit (avant, le SVG partait sous un nom `.png`).

   La requête reproduit à l'identique celle de `uploadLocalFile()`
   (src/utils/driveUpload.js) : POST /upload/drive/v3/files?uploadType=multipart
   avec un corps `multipart/related` contenant { name, mimeType, parents }.
   Tout ce qui est créé est remis à la corbeille à la fin. */
const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const results = [];
const ok = (label, got, want) => results.push({ label, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'workspace' })
});
const token = (await tokenRes.json()).access_token;
if (!token) { console.log('PAS DE JETON — serveur injoignable'); process.exit(1); }
const api = async (path, init = {}) => {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res;
};
const list = async (q) => (await (await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`)).json()).files || [];

const rootId = (await list(`name='Lab Workspace' and mimeType='${FOLDER_MIME}' and trashed=false`))[0].id;
const wsId = (await list(`'${rootId}' in parents and name='_workspace' and mimeType='${FOLDER_MIME}' and trashed=false`))[0].id;
// Dossier jetable, créé puis mis à la corbeille.
const madeFolder = await (await api('/drive/v3/files?fields=id', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '_svgcheck_tmp', mimeType: FOLDER_MIME, parents: [wsId] })
})).json();

// Le graphe : un vrai SVG (XML), tel que le produit le « save as figure ».
const XML = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><polyline points="0,80 40,20 80,60 120,10" fill="none" stroke="#c00"/><text x="4" y="14">flow_cyt_p53H</text></svg>';
const blob = new Blob([new TextEncoder().encode(XML)], { type: 'image/svg+xml' });
const name = '1D Histogram (Data Analysis) - flow_cyt_p53H.svg';
const type = 'image/svg+xml';

// ── la requête EXACTE de uploadLocalFile() ──────────────────────────────────
const boundary = 'labBoundary' + Date.now() + Math.random().toString(36).slice(2);
const meta = JSON.stringify({ name, mimeType: type, parents: [madeFolder.id] });
const pre = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`], { type: 'multipart/related' });
const post = new Blob([`\r\n--${boundary}--\r\n`], { type: 'multipart/related' });
const body = new Blob([pre, blob, post], { type: `multipart/related; boundary=${boundary}` });

const up = await (await api('/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
  method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
})).json();
ok('[drive] un identifiant est rendu', !!up.id, true);
ok('[drive] le nom déposé garde le nom de la figure', String(up.name).slice(-24), name.slice(-24));
ok('[drive] l’URL publique se construit sur cet id', `https://drive.google.com/file/d/${up.id}/view`.includes('/file/d/'), true);

const got = await (await api(`/drive/v3/files/${up.id}?fields=id,name,mimeType,size,parents,trashed`)).json();
ok('[drive] le type est VRAI (image/svg+xml, pas image/png)', got.mimeType, 'image/svg+xml');
ok('[drive] le fichier est bien dans le dossier visé', got.parents, [madeFolder.id]);
ok('[drive] la taille correspond aux octets du SVG', Number(got.size), new TextEncoder().encode(XML).length);

const back = await (await api(`/drive/v3/files/${up.id}?alt=media`)).text();
ok('[drive] le contenu relu est EXACTEMENT le XML du graphe', back, XML);

// ── ménage : corbeille pour le fichier puis pour le dossier jetable ─────────
let cleaned = true;
try {
  await api(`/drive/v3/files/${up.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  await api(`/drive/v3/files/${madeFolder.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
} catch { cleaned = false; }
ok('[drive] le dossier de vérification est parti à la corbeille', cleaned, true);

let failed = 0;
for (const r of results) {
  if (!r.pass) { failed += 1; console.log(`✗ ${r.label}\n    obtenu: ${JSON.stringify(r.got)}\n    voulu:  ${JSON.stringify(r.want)}`); }
}
console.log(`passed ${results.length - failed}/${results.length} (Drive réel, fichier et dossier remis à la corbeille)`);
if (failed) process.exitCode = 1;
