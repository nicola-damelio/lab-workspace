/* =========================================================================
   _probe_admin_reimb_recover.mjs — LECTURE SEULE (aucune écriture, rien n'est
   supprimé ni déplacé sur le Drive).

   Question : « dans la base d'administration, les données de la table
   `reimbursements` ont disparu — où sont-elles encore ? »

   Une base d'administration est un dataset normal : TOUT son contenu vit dans
   la charge du dataset, sous `{ administration: { …, reimbursements: [...] } }`.
   Trois copies de cette charge peuvent donc encore porter les lignes perdues :

     1. les SAUVEGARDES du dataset — `Lab Workspace/<dataset>/backups/*.json`
        (hebdomadaires, et à chaque « 💾 Save backup ») + l'ancien format HTML ;
     2. la COPIE DE CONTENU — `Lab Workspace/_workspace/datasets/ds_<id>.json`
        (réécrite à chaque sauvegarde : Google Drive en garde les VERSIONS) ;
     3. la copie cloud (Firestore) — non lisible ici, voir la note en fin.

   Ce script lit 1 et 2, décompresse la charge comme le fait l'application
   (`parseBackupText` pour un document de sauvegarde, LZString pour la copie de
   contenu) et dit, pour chaque source : combien de lignes `reimbursements`
   elle porte, leur PLAGE DE DATES, et les premiers libellés — de quoi
   reconnaître SES lignes. Rien n'est écrit, ni sur le Drive ni ici.

   Usage : node _probe_admin_reimb_recover.mjs [--show=25]
   ========================================================================= */
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const B = await import('./src/utils/backupFile.js');
const LZString = (await import('lz-string')).default;

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const SHOW = Number(args.get('show') || 25);

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const auth = { Authorization: `Bearer ${token}` };
const FIELDS = 'files(id,name,mimeType,size,createdTime,parents,webViewLink)';

const list = async (q) => {
  const url = `${API}/drive/v3/files?q=${encodeURIComponent(q)}`
    + `&fields=${encodeURIComponent(FIELDS)}&orderBy=createdTime desc&pageSize=200`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) { console.log(`   (liste refusée : ${res.status})`); return []; }
  return (await res.json()).files || [];
};
const readText = async (id) => {
  const res = await fetch(`${API}/drive/v3/files/${id}?alt=media`, { headers: auth });
  return res.ok ? res.text() : '';
};

/* ── Ce qu'une charge d'administration porte ─────────────────────────────── */
const KEYS = ['reimbursements', 'depenses', 'om', 'recettes', 'librerie', 'personnel', 'conges', 'desiderate'];
const shapeOf = (administration) => {
  if (!administration || typeof administration !== 'object') return null;
  const out = {};
  KEYS.forEach((k) => { out[k] = Array.isArray(administration[k]) ? administration[k].length : (administration[k] === undefined ? -1 : -2); });
  return out;
};
const fmt = (n) => (n === -1 ? 'absente' : n === -2 ? 'non-tableau' : String(n));
const labelOf = (r) => {
  const t = (v) => String(v === undefined || v === null ? '' : v).trim();
  return t(r && r.description) || t(r && r.beneficiaire) || t(r && r.numOM) || t(r && r.id) || '(sans libellé)';
};
const dayOf = (r) => {
  const t = Number(r && (r.createdAt || r.updatedAt));
  return t > 1000000000000 ? new Date(t).toISOString().slice(0, 10) : '';
};
const describeRows = (rows) => {
  const days = rows.map(dayOf).filter(Boolean).sort();
  const span = days.length ? `${days[0]} → ${days[days.length - 1]}` : 'dates absentes';
  const head = rows.slice(0, 3).map((r) => `« ${labelOf(r).slice(0, 60)} »`).join(' · ');
  return { span, head };
};

const sources = [];


/* ── 1. Les copies de contenu : _workspace/datasets/ds_<id>.json ─────────── */
console.log('══ 1. Copies de contenu — Lab Workspace/_workspace/datasets/ ══');
const copies = await list("trashed=false and name contains 'ds_' and name contains '.json'");
for (const f of copies.slice(0, SHOW)) {
  const raw = await readText(f.id);
  if (!raw) { console.log(`\n## ${f.name} — lecture impossible`); continue; }
  let rec = null; let state = null;
  try {
    const parsed = JSON.parse(raw);
    rec = parsed && parsed.record ? parsed.record : parsed;
    const json = typeof (rec || {}).payload === 'string' ? LZString.decompressFromUTF16(rec.payload) : '';
    state = json ? JSON.parse(json) : null;
  } catch (err) { console.log(`\n## ${f.name} — illisible (${err && err.message})`); continue; }
  const administration = state && state.administration;
  const shape = shapeOf(administration);
  console.log(`\n## ${f.name} — ${f.size || 0} B, écrit ${String(f.createdTime || '').slice(0, 16).replace('T', ' ')}`);
  console.log(`   dataset : ${JSON.stringify((rec || {}).title || (rec || {}).id || '—')} — charge ${typeof (rec || {}).payload === 'string' ? 'compressée' : 'ABSENTE'}`);
  if (!shape) { console.log('   administration : ABSENTE de cette charge'); continue; }
  console.log(`   ${KEYS.map((k) => `${k}=${fmt(shape[k])}`).join('  ')}`);
  if (shape.reimbursements > 0) {
    const d = describeRows(administration.reimbursements);
    console.log(`   Remboursements (${shape.reimbursements}) — ${d.span} — ${d.head}`);
    sources.push({ where: `copie de contenu ${f.name}`, when: f.createdTime || '', n: shape.reimbursements, span: d.span, head: d.head });
  }
}

/* ── 2. Les sauvegardes : <dataset>/backups/*.json|*.html ────────────────── */
console.log('\n══ 2. Sauvegardes — Lab Workspace/<dataset>/backups/ ══');
const backups = (await list("trashed=false and name contains '_backup_'")).filter((f) => f.mimeType !== FOLDER_MIME);
console.log(`# fichiers « _backup_ » : ${backups.length} — je regarde les ${Math.min(backups.length, SHOW)} plus récents`);
for (const f of backups.slice(0, SHOW)) {
  const text = await readText(f.id);
  const v = B.parseBackupText(text);
  const administration = v && v.state ? v.state.administration : null;
  const shape = shapeOf(administration);
  console.log(`\n## ${f.name} — ${f.size || 0} B, écrit ${String(f.createdTime || '').slice(0, 16).replace('T', ' ')} — format ${v.kind || '—'} — relu : ${v.ok}`);
  if (!v.ok) { console.log(`   refus : ${v.reason || '—'}`); continue; }
  if (!shape) { console.log('   administration : ABSENTE (ce n’est pas une base d’administration)'); continue; }
  console.log(`   dataset : ${JSON.stringify((v.doc && (v.doc.title || v.doc.datasetId)) || '—')}`);
  console.log(`   ${KEYS.map((k) => `${k}=${fmt(shape[k])}`).join('  ')}`);
  if (shape.reimbursements > 0) {
    const d = describeRows(administration.reimbursements);
    console.log(`   Remboursements (${shape.reimbursements}) — ${d.span} — ${d.head}`);
    sources.push({ where: `sauvegarde ${f.name}`, when: f.createdTime || '', n: shape.reimbursements, span: d.span, head: d.head });
  }
}

/* ── 3. Le verdict : où sont les lignes, et à quelle date ────────────────── */
console.log('\n══ 3. Verdict — les sources qui portent encore des remboursements ══');
if (!sources.length) {
  console.log('AUCUNE source lue ne porte de ligne `reimbursements`.');
  console.log('La copie cloud (Firestore) reste à vérifier depuis l’application : ouvrir la base');
  console.log('sur un poste où elle n’a pas été modifiée depuis la perte, y faire « 💾 Save backup »');
  console.log('tout de suite (ce fichier-là portera les lignes), OU restaurer une VERSION du fichier');
  console.log('`_workspace/datasets/ds_<id>.json` dans Google Drive (clic droit → Gérer les versions).');
} else {
  sources.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  sources.forEach((s) => console.log(`• ${s.where}\n     écrit ${String(s.when).slice(0, 16).replace('T', ' ')} — ${s.n} remboursement(s), ${s.span}\n     ${s.head}`));
  console.log('\nMarche à suivre : télécharger la source la PLUS RÉCENTE ci-dessus depuis Google Drive,');
  console.log('puis dans l’application : barre latérale → « 📂 Load backup (.json / .html) » → cocher');
  console.log('SEULE la page « reimbursements » (l’en-tête de la fenêtre annonce son compte) → Restore.');
}
