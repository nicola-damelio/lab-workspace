/* =========================================================================
   _probe_backup_shape.mjs — LECTURE SEULE (aucune écriture sur le Drive).

   « Un résumé LISIBLE dans l'en-tête d'une sauvegarde » : il faut pour cela
   les VRAIS noms de champs des collections d'un dataset (une expérience porte
   `name`, un protocole `title`…), et le dataset RÉEL les donne mieux que toute
   supposition. On ouvre donc la sauvegarde la plus récente et on décrit la
   forme de chaque collection.

   Usage : node _probe_backup_shape.mjs [--name=_backup_] [--show=3]
   ========================================================================= */
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const B = await import('./src/utils/backupFile.js');

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const NEEDLE = args.get('name') || '_backup_';
const SHOW = Number(args.get('show') || 3);

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const fields = encodeURIComponent('files(id,name,size,createdTime,mimeType)');
const q = encodeURIComponent(`trashed=false and name contains '${NEEDLE}'`);
const listing = await (await fetch(`${API}/drive/v3/files?q=${q}&fields=${fields}&orderBy=createdTime desc&pageSize=${SHOW * 3}`,
  { headers: { Authorization: `Bearer ${token}` } })).json();
/* Les DOSSIERS portent aussi ce nom (« backups ») : ils ne sont pas des
   sauvegardes, on ne les ouvre pas. */
const files = (listing.files || []).filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').slice(0, SHOW);
console.log(`# fichiers « ${NEEDLE} » : ${files.length}`);

const CANDIDATES = ['name', 'title', 'label', 'code', 'id'];

for (const f of files) {
  const res = await fetch(`${API}/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  const raw = res.ok ? await res.text() : '';
  const v = B.parseBackupText(raw);
  console.log(`\n## ${f.name} — ${f.size || 0} B — format ${v.kind || '—'} — décodé : ${v.ok}`);
  if (!v.ok || !v.state) { console.log(`   (${v.reason || 'rien'})`); continue; }
  const state = v.state;
  console.log(`   clés de l’état : ${Object.keys(state).join(' · ')}`);
  B.BACKUP_COUNT_KEYS.forEach(({ key }) => {
    const value = state[key];
    if (value === undefined) { console.log(`   ${key} : ABSENT`); return; }
    if (Array.isArray(value)) {
      const first = value.find((e) => e && typeof e === 'object') || null;
      console.log(`   ${key} : tableau de ${value.length} — champs du 1er : ${first ? Object.keys(first).slice(0, 16).join(' ') : '—'}`);
      CANDIDATES.forEach((c) => {
        const hit = value.filter((e) => e && typeof e === 'object' && String(e[c] ?? '').trim()).length;
        if (hit) console.log(`      ${c} : ${hit}/${value.length} — ex. ${JSON.stringify(String(value.find((e) => e && String(e[c] ?? '').trim())[c]).slice(0, 60))}`);
      });
      return;
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      console.log(`   ${key} : carte de ${keys.length} — premières clés : ${JSON.stringify(keys.slice(0, 8))}`);
      if (keys.length) console.log(`      valeur du 1er : ${JSON.stringify(value[keys[0]]).slice(0, 220)}`);
      return;
    }
    console.log(`   ${key} : ${typeof value} (${JSON.stringify(value)})`);
  });
  /* CE QUE L'EN-TÊTE DIRAIT DE CE DATASET — le résumé est tiré de CETTE charge
     (lecture seule : rien n'est écrit nulle part). */
  const summary = B.backupSummaryOf(state);
  console.log('   ── le RÉSUMÉ de cet en-tête ──');
  Object.keys(summary).forEach((key) => {
    if (key === 'note') return;
    const names = summary[key];
    console.log(`   ${key} (${names.length}) : ${names.slice(0, 6).map((n) => `“${n}”`).join(' · ')}${names.length > 6 ? ' …' : ''}`);
  });
  console.log(`   poids de l’en-tête (résumé compris) : ${JSON.stringify(summary).length} caractères`);
  console.log(`   note : ${summary.note}`);
}
