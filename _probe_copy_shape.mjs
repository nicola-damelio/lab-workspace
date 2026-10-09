/* =========================================================================
   _probe_copy_shape.mjs — LECTURE SEULE. Sonde jetable : montre la FORME d'une
   copie de contenu (`Lab Workspace/_workspace/datasets/ds_<id>.json`) et la
   liste du dossier, pour comprendre pourquoi un instantané n'était pas relu.
   ========================================================================= */
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const LZString = (await import('lz-string')).default;

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const res0 = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
});
const token = (await res0.json()).access_token;
const auth = { Authorization: `Bearer ${token}` };
const FIELDS = 'files(id,name,size,createdTime,modifiedTime,mimeType)';
const q = async (query) => {
  const r = await fetch(`${API}/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(FIELDS)}&orderBy=createdTime desc&pageSize=100`, { headers: auth });
  return (await r.json()).files || [];
};
const FOLDER = 'application/vnd.google-apps.folder';
const ws = (await q(`trashed=false and mimeType='${FOLDER}' and name='_workspace'`))[0];
const ds = ws ? (await q(`trashed=false and mimeType='${FOLDER}' and name='datasets' and '${ws.id}' in parents`))[0] : null;
console.log('# dossier _workspace/datasets :', ds ? ds.id : 'INTROUVABLE');
const files = ds ? await q(`trashed=false and '${ds.id}' in parents`) : [];
files.forEach((f) => console.log(`· ${f.name} — ${f.size} B — créé ${String(f.createdTime).slice(0, 16)} — modifié ${String(f.modifiedTime).slice(0, 16)}`));

const target = files.find((f) => f.name.includes('1788541255238')) || files[0];
if (!target) { console.log('aucune copie à inspecter'); process.exit(0); }
const raw = await (await fetch(`${API}/drive/v3/files/${target.id}?alt=media`, { headers: auth })).text();
console.log(`\n=== ${target.name} — ${raw.length} caractères ===`);
console.log('début :', JSON.stringify(raw.slice(0, 200)));
let doc = null;
try { doc = JSON.parse(raw); } catch (e) { console.log('JSON illisible :', e.message); }
if (doc && typeof doc === 'object') {
  Object.keys(doc).forEach((k) => {
    const v = doc[k];
    const shape = typeof v === 'string' ? `chaîne (${v.length} car.) : ${JSON.stringify(v.slice(0, 60))}` : `${typeof v} : ${JSON.stringify(v).slice(0, 140)}`;
    console.log(`  clé ${k} → ${shape}`);
  });
  const p = typeof doc.payload === 'string' ? doc.payload : '';
  if (p) {
    console.log('  LZString UTF16 :', JSON.stringify(String(LZString.decompressFromUTF16(p) || '').slice(0, 120)));
    console.log('  LZString base64 :', JSON.stringify(String(LZString.decompressFromBase64(p) || '').slice(0, 120)));
    console.log('  LZString URI :', JSON.stringify(String(LZString.decompressFromEncodedURIComponent(p) || '').slice(0, 120)));
    console.log('  LZString brut :', JSON.stringify(String(LZString.decompress(p) || '').slice(0, 120)));
  }
}
