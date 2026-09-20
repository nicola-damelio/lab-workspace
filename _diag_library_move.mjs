/* =========================================================================
   _diag_library_move.mjs — LECTURE SEULE : où vivent les entrées de la
   bibliothèque d'images, par PORTÉE, dans le fichier partagé des clés
   (`Lab Workspace/_workspace/keys.json`), et OÙ sont leurs fichiers.

   But : vérifier le constat « j'ai déplacé des images de la bibliothèque
   générale vers celle d'un projet, et sur l'autre poste elles sont encore
   dans la générale et absentes de celle du projet ». Il a servi le 19/09/2026 :
   trois images étaient dans `labFiguresLibrary` ET dans deux bibliothèques de
   projet à la fois (même id, même fichier Drive) — d'où le correctif de
   `moveLibraryItem` (voir _library_move_test.mjs).

     node _diag_library_move.mjs                       (relit _diag_keys.json déjà téléchargé)
     node _diag_library_move.mjs --fresh               (retélécharge keys.json du Drive)
     node _diag_library_move.mjs --fresh --report      (…et écrit _diag_library_move.txt)
   ========================================================================= */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';

const out = [];
const say = (s = '') => { out.push(String(s)); console.log(String(s)); };

const analyze = (state) => {
  const keys = state.keys || {};
  const names = Object.keys(keys);
  say(`kind=${state.kind} at=${state.at} clés=${names.length}`);

  const parse = (k) => {
    const v = keys[k].v;
    if (Array.isArray(v)) return v;
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  };
  const libKeys = names.filter((k) => /^labFigures(Lib|Library)/.test(k)).sort();

  say('\n── LISTES DE BIBLIOTHÈQUE ─────────────────────────────────────────────');
  const byScope = new Map();
  for (const k of libKeys) {
    const list = parse(k);
    byScope.set(k, list);
    const at = keys[k].at ? new Date(keys[k].at).toISOString() : '?';
    say(`${k}  at=${at}  entrées=${list.length}`);
  }

  /* L'identité d'une entrée : son id, ET l'identifiant de son fichier cloud —
     c'est lui qui dit « c'est la MÊME image » d'une portée à l'autre. */
  const fileIdOf = (i) => {
    const urls = [i && i.driveUrl, i && i.full, i && i.url].filter(Boolean);
    for (const u of urls) {
      const m = String(u).match(/\/d\/([^/?#]+)/) || String(u).match(/[?&]id=([^&]+)/);
      if (m) return m[1];
    }
    return '';
  };

  say('\n── LA MÊME IMAGE DANS DEUX PORTÉES (ce que le déplacement devait empêcher) ──');
  const common = [...byScope.entries()].filter(([k]) => k === 'labFiguresLibrary');
  const projects = [...byScope.entries()].filter(([k]) => k !== 'labFiguresLibrary');
  let dupes = 0;
  for (const [ck, clist] of common) {
    const cFiles = new Map();
    clist.forEach((i) => { const f = fileIdOf(i); if (f) cFiles.set(f, i); });
    const cIds = new Map(clist.map((i) => [String(i.id || ''), i]));
    for (const [pk, plist] of projects) {
      plist.forEach((i) => {
        const f = fileIdOf(i);
        const sameFile = f && cFiles.get(f);
        const sameId = cIds.get(String(i.id || ''));
        if (sameFile || sameId) {
          dupes += 1;
          const other = sameFile || sameId;
          say(`  ⚠ « ${i.label || '?'} » id=${i.id} fichier=${f || '(aucun)'} — dans ${ck} ET ${pk}`);
          say(`      générale: label=« ${other.label || '?'} » id=${other.id}`);
          say(`      projet  : label=« ${i.label || '?'} » id=${i.id}`);
        }
      });
    }
  }
  say(`  total doublons : ${dupes}`);
  return { byScope, fileIds: [...new Set([...byScope.values()].flat().map(fileIdOf).filter(Boolean))] };
};

const listing = ({ byScope }) => {
  for (const [k, list] of byScope.entries()) {
    say(`\n── « ${k} » : ${list.length} entrée(s) ─────────────────────────────`);
    list.forEach((i) => say(`   • « ${i.label || '?'} » id=${i.id} drive=${!!i.drive} canvas=${!!i.canvasData} meta=${i.metaName || ''} fichier=${i.drive ? String(i.driveUrl || i.full || i.url || '').slice(0, 80) : '(local, base64)'}`));
  }
  const keys = Object.keys((globalThis.__state || {}).keys || {});
  const trashKeys = keys.filter((k) => /^labFiguresTrash_/.test(k)).sort();
  say('\n── PIERRES TOMBALES (suppressions notées, par portée) ─────────────────');
  if (!trashKeys.length) say('  (aucune)');
  trashKeys.forEach((k) => say(`${k} : ${String((globalThis.__state.keys[k] || {}).v || '')}`));
};

let state = null;
if (process.argv.includes('--fresh')) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'workspace' })
  }).catch(() => null);
  const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
  if (!token) { console.log('PAS DE JETON — serveur injoignable.'); process.exit(0); }
  const api = async (path) => {
    const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return res;
  };
  const q = encodeURIComponent("name='keys.json' and trashed=false");
  const fields = encodeURIComponent('files(id,name,modifiedTime,parents)');
  const found = (await (await api(`/drive/v3/files?q=${q}&fields=${fields}&pageSize=20`)).json()).files || [];
  const pick = found.slice().sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))[0];
  if (!pick) { console.log('keys.json introuvable sur le Drive.'); process.exit(0); }
  say(`keys.json = ${pick.id} modifié ${pick.modifiedTime}`);
  state = JSON.parse(await (await api(`/drive/v3/files/${pick.id}?alt=media`)).text());
  writeFileSync('_diag_keys_now.json', JSON.stringify(state, null, 2), 'utf8');
} else if (!existsSync('_diag_keys.json')) {
  /* Le dump n'est PAS versionné (5 Mo de keys.json du Drive) : il se
     (re)télécharge avec --fresh. Sans lui ce diagnostic n'a rien à lire — ce
     n'est pas un échec de l'application, donc on sort en 0. */
  console.log('_diag_keys.json absent — relance avec : node _diag_library_move.mjs --fresh');
  process.exit(0);
} else {
  state = JSON.parse(readFileSync('_diag_keys.json', 'utf8'));
}
globalThis.__state = state;

const res = analyze(state);
listing(res);
/* Le rapport FICHIER est en option : lancé par la suite de tests (sans drapeau)
   ce diagnostic n'écrit rien — il se contente d'afficher. */
if (process.argv.includes('--report') || process.argv.includes('--fresh')) {
  writeFileSync('_diag_library_move.txt', out.join('\n'), 'utf8');
  console.log('\n(rapport écrit : _diag_library_move.txt)');
}
