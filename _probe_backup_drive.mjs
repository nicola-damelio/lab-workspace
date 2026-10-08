/* =========================================================================
   _probe_backup_drive.mjs — LECTURE SEULE. « Le fichier de sauvegarde est en
   chinois, est-ce normal ? » : on ouvre LE fichier du Drive et on dit ce qu'il
   porte vraiment — en-tête lisible, charge compressée, validation.

   Usage : node _probe_backup_drive.mjs [--name=_backup_] [--show=6]
   ========================================================================= */
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const { parseBackupText } = await import('./src/utils/backupFile.js');

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const NEEDLE = args.get('name') || '_backup_';
const SHOW = Number(args.get('show') || 6);

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const fields = encodeURIComponent('files(id,name,size,createdTime,parents)');
const q = encodeURIComponent(`trashed=false and name contains '${NEEDLE}'`);
const listing = await (await fetch(`${API}/drive/v3/files?q=${q}&fields=${fields}&orderBy=createdTime desc&pageSize=${SHOW * 3}`,
  { headers: { Authorization: `Bearer ${token}` } })).json();
const files = (listing.files || []).slice(0, SHOW);
console.log(`# fichiers dont le nom contient « ${NEEDLE} » : ${(listing.files || []).length} — je regarde les ${files.length} plus récents`);

for (const f of files) {
  const res = await fetch(`${API}/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  const text = res.ok ? await res.text() : '';
  const head = text.slice(0, text.indexOf('"payload"') + 9);
  const cjk = (text.match(/[\u2E80-\u9FFF\uAC00-\uD7AF]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]/g) || []).length;
  const verdict = parseBackupText(text);
  console.log('');
  console.log(`## ${f.name}`);
  console.log(`   ${f.size || 0} B, écrit ${String(f.createdTime || '').slice(0, 16).replace('T', ' ')} — lu : ${res.ok ? text.length : `ÉCHEC ${res.status}`}`);
  console.log(`   latin/chiffres ${latin} · CJK « chinois » ${cjk} (${text.length ? Math.round((cjk / text.length) * 100) : 0} %)`);
  console.log(`   ── en-tête (ce qui se lit) ──`);
  console.log(head.split('\n').map((l) => `   ${l.slice(0, 150)}`).join('\n'));
  console.log(`   ── la charge, telle quelle (40 premiers caractères) ──`);
  console.log(`   ${JSON.stringify(text.slice(text.indexOf('"payload": "') + 12, text.indexOf('"payload": "') + 52))}`);
  console.log(`   ── le verdict de l’app ── reconnu : ${verdict.ok} | format : ${verdict.kind || '—'} | comptes : ${JSON.stringify(verdict.counts && verdict.counts.tests)} expérience(s)`);
  if (!verdict.ok) console.log(`   refus : ${verdict.reason}`);
}
