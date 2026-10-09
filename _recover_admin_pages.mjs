/* =========================================================================
   _recover_admin_pages.mjs — PRÉPARER LA RESTAURATION D'UNE PAGE D'ADMIN,
   SANS RIEN ÉCRIRE SUR LE DRIVE ET SANS RIEN DÉTRUIRE ICI.

   Le fait établi par `_probe_admin_missing_rows.mjs --revs` : l'HISTORIQUE
   DES VERSIONS de la copie de contenu (`_workspace/datasets/ds_<id>.json`) est
   l'histoire de l'état VIVANT — le miroir est réécrit à chaque sauvegarde
   automatique, donc une version d'AVANT l'accident porte tout ce que la base
   avait à ce moment-là. C'est la seule source qui contient encore les lignes
   perdues APRÈS la dernière sauvegarde hebdomadaire.

   Ce script en fait un FICHIER chargeable par l'application :

     1. il LISTE les versions de la copie (lecture seule) et dit laquelle est
        retenue ;
     2. il DÉCODE sa charge et affiche les comptes PAGE PAR PAGE, à côté de
        ceux d'aujourd'hui — pour ne restaurer que ce qui a fondu (une page
        qui a GRANDI depuis ne doit surtout pas être remplacée) ;
     3. il ÉCRIT UN FICHIER LOCAL (`_recover/…json`) au format EXACT que
        l'application relit (« 📂 Load backup (.json) »), construit par le
        module de l'application lui-même (`buildBackupDocument`) puis VÉRIFIÉ
        par son propre validateur (`parseBackupText`).

   Usage :
     node _recover_admin_pages.mjs [--id=1788541255238] [--rev=1] [--at=2026-10-08T12:32]
                                  [--pages=devisBc,depenses,librerie] [--list] [--all]
   ========================================================================= */
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

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
/* L'identifiant du dataset à récupérer (défaut : la base d'administration). */
const DATASET = String(args.get('id') || '1788541255238');
const WANT_PAGES = String(args.get('pages') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY_LIST = args.has('list');
const AT = String(args.get('at') || '');
const REV_N = args.has('rev') ? Number(args.get('rev')) : null;
/* `--scan=N` : relire les N versions les plus récentes et DIRE, page par page,
   où la chute apparaît — c'est ce qui nomme le dernier instantané SANS la
   perte. `--auto` : c'est lui qui part en restauration. */
const SCAN = Number(args.get('scan') || 0);
const AUTO = args.has('auto');
/* `--no-union` : écrire le fichier avec la SEULE version choisie (l'import
   remplacerait alors la page par celle d'hier, ce qui peut effacer des lignes
   créées depuis). Par DÉFAUT on écrit l'UNION — les lignes d'aujourd'hui
   d'abord, puis celles que la version a et qu'aujourd'hui a perdues : un
   import qui ne peut RIEN enlever. */
const UNION = !args.has('no-union');
const OUT_DIR = path.resolve('_recover');

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été lu.'); process.exit(0); }
const auth = { Authorization: `Bearer ${token}` };

const list = async (q) => {
  const url = `${API}/drive/v3/files?q=${encodeURIComponent(q)}`
    + `&fields=${encodeURIComponent('files(id,name,mimeType,size,createdTime,modifiedTime,parents)')}`
    + '&pageSize=200';
  const res = await fetch(url, { headers: auth });
  if (!res.ok) return [];
  return (await res.json().catch(() => ({}))).files || [];
};
const textOfRevision = async (fileId, revId) => {
  const res = await fetch(`${API}/drive/v3/files/${fileId}/revisions/${encodeURIComponent(revId)}?alt=media`, { headers: auth });
  return res.ok ? res.text() : '';
};
const day = (v) => String(v || '').slice(0, 16).replace('T', ' ');

/* ── 1. La copie de contenu du dataset, puis TOUTES ses versions ─────────── */
const ws = (await list(`trashed=false and mimeType='${FOLDER_MIME}' and name='_workspace'`))[0];
const dsDir = ws ? (await list(`trashed=false and mimeType='${FOLDER_MIME}' and name='datasets' and '${ws.id}' in parents`))[0] : null;
const copy = dsDir ? (await list(`trashed=false and '${dsDir.id}' in parents and name='ds_ds_${DATASET}.json'`))[0] : null;
if (!copy) { console.log(`Aucune copie « ds_ds_${DATASET}.json » (dataset jamais sauvegardé en ligne ?).`); process.exit(0); }
console.log(`══ Copie de contenu : ${copy.name} (modifiée ${day(copy.modifiedTime)}) ══`);

const revs = [];
let pageToken = '';
for (let i = 0; i < 10; i += 1) {
  const url = `${API}/drive/v3/files/${copy.id}/revisions?fields=${encodeURIComponent('revisions(id,modifiedTime,size,keepForever),nextPageToken')}&pageSize=1000`
    + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
  const res = await fetch(url, { headers: auth });
  if (!res.ok) break;
  const got = await res.json().catch(() => ({}));
  (got.revisions || []).forEach((r) => revs.push(r));
  pageToken = got.nextPageToken || '';
  if (!pageToken) break;
}
revs.sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
const oldest = revs.length ? day(revs[revs.length - 1].modifiedTime) : '';
console.log(`# versions accessibles : ${revs.length} (de ${oldest} à ${revs.length ? day(revs[0].modifiedTime) : ''})`);

/* ── 2. Décoder une version (le miroir range sa charge sous `record`) ────── */
const stateOfMirrorText = (raw) => {
  let doc = null;
  try { doc = JSON.parse(raw); } catch { return { state: null, why: 'JSON illisible' }; }
  const rec = (doc && doc.record && typeof doc.record === 'object') ? doc.record : (doc || {});
  const payload = typeof rec.payload === 'string' ? rec.payload : '';
  if (!payload) return { state: null, why: 'charge absente' };
  const json = LZString.decompressFromUTF16(payload) || LZString.decompressFromBase64(payload) || '';
  if (!json) return { state: null, why: 'charge non décompressable' };
  try {
    return { state: JSON.parse(json), at: String(doc.at || ''), title: String(rec.title || ''), datasetId: String(rec.datasetId || '') };
  } catch { return { state: null, why: 'charge illisible' }; }
};
/* Les comptes PAGE PAR PAGE d'une charge d'administration : chaque collection
   (un tableau) à tous les niveaux utiles. */
/* Le TABLEAU d'une page (chemin « a.b.c »), ou null — et de quoi le réécrire
   dans une COPIE de l'état (voir la fusion `--union`). */
const arrayAt = (state, key) => {
  let node = state;
  const parts = String(key || '').split('.');
  for (let i = 0; i < parts.length; i += 1) {
    if (!node || typeof node !== 'object') return null;
    node = node[parts[i]];
  }
  return Array.isArray(node) ? node : null;
};
const setArrayAt = (state, key, value) => {
  const parts = String(key || '').split('.');
  let node = state;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!node || typeof node !== 'object') return false;
    node = node[parts[i]];
  }
  if (!node || typeof node !== 'object') return false;
  node[parts[parts.length - 1]] = value;
  return true;
};
/* Les lignes d'une PAGE, par identifiant : c'est ce qui permet de VÉRIFIER,
   AVANT de cliquer, qu'un import n'efface rien de ce qui est là aujourd'hui. */
const rowsOfPage = (state, key) => {
  const out = new Map();
  const node = arrayAt(state, key);
  if (!node) return out;
  node.forEach((it) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return;
    const id = it.id === undefined || it.id === null ? '' : String(it.id);
    if (!id) return;
    const label = it.description || it.objet || it.designation || it.beneficiaire
      || it.intitule || it.nom || it.name || it.numOM || id;
    out.set(id, String(label).slice(0, 60));
  });
  return out;
};
const pageCountsOf = (state) => {
  const out = new Map();
  const visit = (node, prefix, depth) => {
    if (depth > 3 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { out.set(prefix, node.length); return; }
    Object.keys(node).forEach((k) => {
      const v = node[k];
      if (Array.isArray(v)) out.set(prefix ? `${prefix}.${k}` : k, v.length);
      else if (v && typeof v === 'object') visit(v, prefix ? `${prefix}.${k}` : k, depth + 1);
    });
  };
  visit(state, '', 0);
  return out;
};

/* ── 3. La version retenue, la copie d'aujourd'hui, et la comparaison ─────── */
const wantedIdx = (() => {
  if (AT) {
    const i = revs.findIndex((r) => String(r.modifiedTime) <= AT);
    return i >= 0 ? i : revs.length - 1;
  }
  if (REV_N !== null && Number.isFinite(REV_N)) return Math.max(0, Math.min(revs.length - 1, Math.floor(REV_N)));
  return Math.min(1, revs.length - 1); /* la plus récente EST le contenu actuel */
})();

console.log('\n══ Versions (0 = la plus récente) ══');
const shown = args.has('all') ? revs.length : Math.min(24, revs.length);
for (let i = 0; i < shown; i += 1) {
  const r = revs[i];
  console.log(`  ${String(i).padStart(2)} · ${day(r.modifiedTime)} · ${Math.round(Number(r.size || 0) / 1024)} Ko${i === wantedIdx ? '   ← retenue' : ''}`);
}
if (shown < revs.length) console.log(`  … ${revs.length - shown} version(s) plus ancienne(s) — --all pour tout voir`);
if (ONLY_LIST) { console.log('\n(--list : rien d’autre n’a été lu.)'); process.exit(0); }

/* --scan / --auto : QUEL est le dernier instantané SANS la perte ? On relit les
   versions du plus récent au plus ancien et on suit, page par page, le compte
   de chacune : la dernière version où tous les comptes sont au maximum EST
   l'état d'avant. */
let chosenIdx = wantedIdx;
/* Le PLAN : un fichier de restauration PAR version source, avec les pages à
   cocher pour chacun (voir le scan ci-dessous). */
let plan = null;
if (SCAN || AUTO) {
  const scanPages = WANT_PAGES.length
    ? WANT_PAGES
    : ['devisBc', 'depenses', 'librerie', 'desiderate', 'recettes', 'om', 'reimbursements'];
  const n = Math.min(SCAN || 24, revs.length);
  const seenVals = [];
  let bestIdx = 0;
  let bestSum = -1;
  console.log(`\n══ Comptes par version (${scanPages.join(' · ')}) ══`);
  for (let i = 0; i < n; i += 1) {
    const got = stateOfMirrorText(await textOfRevision(copy.id, revs[i].id));
    if (!got.state) { console.log(`  ${String(i).padStart(2)} · ${day(revs[i].modifiedTime)} · (${got.why})`); continue; }
    const c = pageCountsOf(got.state);
    const vals = scanPages.map((w) => {
      const k = [...c.keys()].find((p) => p.toLowerCase().includes(w.toLowerCase()));
      return k ? c.get(k) : 0;
    });
    const sum = vals.reduce((a, b) => a + b, 0);
    if (sum > bestSum) { bestSum = sum; }
    seenVals.push({ i, vals });
    console.log(`  ${String(i).padStart(2)} · ${day(revs[i].modifiedTime)} · ${String(vals.join(' · ')).padEnd(34)} (total ${sum})`);
  }
  /* Le choix, page par page, de la version qui porte le maximum — puis sa
     consolidation : voir juste en dessous. */
  /* Pour CHAQUE page amoindrie, la version la PLUS RÉCENTE qui en porte le
     MAXIMUM, puis CONSOLIDATION : deux pages dont le maximum est à deux
     versions VOISINES (moins de 6 h) tiennent dans UNE SEULE — la plus ancienne
     des deux — si elle porte aussi le maximum de l'autre. C'est le cas quand la
     perte vient du même enchaînement (l'accident d'hier, la dérive
     d'aujourd'hui) : un fichier au lieu de deux, donc un geste au lieu de deux. */
  const maxPer = scanPages.map((_, k) => Math.max(...seenVals.map((r) => r.vals[k])));
  const lost = scanPages.map((_, k) => seenVals[0].vals[k] < maxPer[k]);
  const valsAt = (idx, page) => {
    const r = seenVals.find((x) => x.i === idx);
    const k = scanPages.indexOf(page);
    return r && k >= 0 ? r.vals[k] : 0;
  };
  const owners = scanPages
    .map((p, k) => (lost[k] ? { p, n: maxPer[k], idx: (seenVals.find((r) => r.vals[k] === maxPer[k]) || { i: -1 }).i } : null))
    .filter((o) => o && o.idx >= 0);
  const qty = new Map(owners.map((o) => [o.p, o.n]));
  const groups = owners.map((o) => ({ idx: o.idx, pages: [o.p] }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < groups.length && !merged; a += 1) {
      for (let b = a + 1; b < groups.length && !merged; b += 1) {
        const ta = Date.parse(revs[groups[a].idx].modifiedTime);
        const tb = Date.parse(revs[groups[b].idx].modifiedTime);
        if (Math.abs(ta - tb) > 6 * 3600 * 1000) continue;
        const older = groups[a].idx > groups[b].idx ? groups[a] : groups[b];
        const other = older === groups[a] ? groups[b] : groups[a];
        const all = [...older.pages, ...other.pages];
        if (!all.every((p) => valsAt(older.idx, p) === qty.get(p))) continue;
        older.pages = all;
        groups.splice(groups.indexOf(other), 1);
        merged = true;
      }
    }
  }
  groups.sort((a, b) => a.idx - b.idx);
  plan = groups.map((g) => ({ idx: g.idx, keys: g.pages, pages: g.pages.map((p) => `${p} (${qty.get(p)})`) }));
  console.log(`  pages amointies : ${scanPages.filter((_, k) => lost[k]).join(' · ') || 'aucune'}`);
  plan.forEach((s) => console.log(`  → depuis l’index ${s.idx} (${day(revs[s.idx].modifiedTime)}) : ${s.pages.join(' · ')}`));
  if (AUTO && plan.length) chosenIdx = plan[0].idx;
}
const chosen = revs[chosenIdx];
const before = stateOfMirrorText(await textOfRevision(copy.id, chosen.id));
if (!before.state) {
  console.log(`\n✖ version ${day(chosen.modifiedTime)} : ${before.why} — choisir un autre index (--rev=N, voir --list).`);
  process.exit(0);
}
const nowRaw = await fetch(`${API}/drive/v3/files/${copy.id}?alt=media`, { headers: auth })
  .then((r) => (r.ok ? r.text() : '')).catch(() => '');
const nowGot = stateOfMirrorText(nowRaw);

const beforePages = pageCountsOf(before.state);
const nowPages = nowGot.state ? pageCountsOf(nowGot.state) : new Map();
const rows = [...new Set([...beforePages.keys(), ...nowPages.keys()])]
  .map((p) => ({ p, was: beforePages.get(p) || 0, now: nowPages.get(p) || 0 }))
  .sort((a, b) => (b.was - b.now) - (a.was - a.now) || a.p.localeCompare(b.p));

console.log(`\n══ « ${before.title || nowGot.title || 'base'} » — version du ${day(chosen.modifiedTime)} vs aujourd’hui ══`);
console.log(`  ${beforePages.size} collection(s) dans la version · ${nowPages.size} aujourd’hui`);
rows.forEach(({ p, was, now }) => {
  if (WANT_PAGES.length && !WANT_PAGES.some((w) => p.toLowerCase().includes(w.toLowerCase()))) return;
  const verdict = was > now ? `⬅ ${was - now} ligne(s) à ramener`
    : (was < now ? `⤴ la version en a MOINS que maintenant (${now}) : NE PAS restaurer` : 'identique');
  console.log(`  ${String(was).padStart(4)} → ${String(now).padStart(4)}  ${p.padEnd(42)} ${verdict}`);
});
if (!WANT_PAGES.length) console.log('  (filtrer avec --pages=devisBc,depenses,… pour ne voir que ces collections)');

/* ── 4. Les FICHIERS DE RESTAURATION, locaux, écrits par le module de l'app ─ */
fs.mkdirSync(OUT_DIR, { recursive: true });
const sources = (plan && plan.length) ? plan : [{ idx: chosenIdx, pages: [] }];
const made = [];
/* Combien de lignes d’AUJOURD’HUI manquent dans TOUS les fichiers : si ce
   nombre n’est pas zéro, aucun import automatique n’est sûr sans sauvegarde. */
let dangerTotal = 0;
for (const src of sources) {
  const version = revs[src.idx];
  const got = src.idx === chosenIdx ? before : stateOfMirrorText(await textOfRevision(copy.id, version.id));
  if (!got.state) { console.log(`\n✖ version ${day(version.modifiedTime)} : ${got.why} — fichier non écrit`); continue; }
  /* La charge qui part dans le fichier : celle de la VERSION, plus (par défaut)
     les lignes d'AUJOURD'HUI, collées à la fin. On travaille sur une COPIE —
     l'état du cache reste intact pour le fichier suivant. */
  const built = JSON.parse(JSON.stringify(got.state));
  const liveKeysOf = [...pageCountsOf(nowGot.state).keys()];
  (src.keys || []).forEach((w) => {
    if (!UNION) return;
    const key = liveKeysOf.find((p) => p === w || p.toLowerCase().endsWith(`.${String(w).toLowerCase()}`)) || w;
    const srcArr = arrayAt(built, key);
    const nowArr = arrayAt(nowGot.state, key);
    if (!Array.isArray(srcArr) || !Array.isArray(nowArr)) return;
    const have = new Set(nowArr.map((r) => (r && r.id !== undefined && r.id !== null ? String(r.id) : '')).filter(Boolean));
    const back = srcArr.filter((r) => {
      const id = r && r.id !== undefined && r.id !== null ? String(r.id) : '';
      return id && !have.has(id);
    });
    setArrayAt(built, key, [...nowArr, ...back]);
  });
  const savedAt = Date.parse(version.modifiedTime) || Date.now();
  const payload = B.encodeBackupPayload(built, true);
  const doc = B.buildBackupDocument({
    payload,
    title: got.title || before.title || 'Base d’administration',
    subtitle: `Version du ${day(version.modifiedTime)} (avant la perte)`,
    datasetId: got.datasetId || before.datasetId || `ds_${DATASET}`,
    savedAt,
    counts: null,
    compressed: true
  });
  const fileText = B.backupDocumentText(doc);
  const name = B.backupFileName({
    title: doc.title,
    datasetId: doc.datasetId,
    dateStr: `${String(version.modifiedTime).slice(0, 10)}_${String(version.modifiedTime).slice(11, 16).replace(':', 'h')}`,
    kind: 'restore'
  });
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, fileText, 'utf8');

  /* Le contrôle qui compte : c'est le VALIDATEUR de l'application qui juge le
     fichier — s'il refuse, aucune page ne doit être importée. */
  const verdict = B.parseBackupText(fileText);
  const back = verdict.state ? pageCountsOf(verdict.state) : new Map();
  const same = verdict.state
    ? [...pageCountsOf(built).entries()].every(([p, n]) => (back.get(p) || 0) === n)
    : false;
  console.log(`\n══ Fichier ${made.length + 1}/${sources.length} (LOCAL : rien n’a été écrit sur le Drive) ══`);
  console.log(`  ${outPath}  (${Math.round(Buffer.byteLength(fileText, 'utf8') / 1024)} Ko)`);
  console.log(`  version du ${day(version.modifiedTime)} · format ${doc.format} · dataset ${doc.datasetId}`);
  console.log(`  ${verdict.ok ? 'VALIDÉ par l’application' : `REFUSÉ : ${verdict.reason}`} · relecture : ${back.size} collection(s), charges identiques : ${same ? 'oui' : 'NON (ne pas importer)'}`);
  console.log(`  PAGES À COCHER (et rien d’autre) : ${src.pages.join(' · ') || '(à choisir dans la fenêtre)'}`);
  /* ── LE CONTRÔLE QUI ÉVITE UNE SECONDE PERTE ─────────────────────────────
     L'import d'une page REMPLACE la page par celle du fichier. Si une ligne
     d'AUJOURD'HUI n'est pas dans le fichier, elle disparaîtrait : on le dit
     AVANT, ligne par ligne, et on le dit assez fort pour qu'on ne clique pas. */
  let danger = 0;
  dangerTotal += 0;
  /* Les clés du plan sont des NOMS (« devisBc ») : on les résout vers leur
     chemin réel dans la charge (« administration.devisBc ») — sinon on
     comparerait deux pages vides et le contrôle ne dirait rien. */
  const liveKeys = [...pageCountsOf(nowGot.state).keys()];
  (src.keys || []).forEach((w) => {
    const key = liveKeys.find((p) => p === w || p.toLowerCase().endsWith(`.${String(w).toLowerCase()}`)) || w;
    const from = rowsOfPage(built, key);
    const to = rowsOfPage(nowGot.state, key);
    if (!to.size && !from.size) return;
    const lost = [...to.keys()].filter((id) => !from.has(id));
    const gain = [...from.keys()].filter((id) => !to.has(id));
    dangerTotal += lost.length;
    console.log(`  ${key} : aujourd’hui ${to.size} → après import ${from.size} · ramené ${gain.length}${lost.length ? ` · ⚠ PERDU À L’IMPORT ${lost.length}` : ' · rien de perdu'}`);
    lost.slice(0, 10).forEach((id) => console.log(`      ⚠ ligne d’aujourd’hui absente du fichier : « ${to.get(id)} » (id ${id})`));
    if (lost.length > 10) console.log(`      … ${lost.length - 10} autre(s)`);
  });
  made.push(outPath);
}
console.log('\nMarche à suivre — 1) base ouverte → « 📂 Load backup (.json) » → le fichier ci-dessus ;');
console.log('  2) ne cocher QUE les pages annoncées POUR CE fichier (les pages non cochées ne bougent pas) ;');
console.log('  3) « 🔀 Merge the selected pages » (RIEN n’est effacé : le fichier n’AJOUTE que ce qui manque) ·');
console.log('     4) fichier suivant (même geste) · 5) finir par « 💾 Save backup ».');
console.log('  ✓ En « 🔀 Merge », cocher une page que le fichier porte en MOINS que maintenant est SANS danger :');
console.log('    les lignes d’aujourd’hui gardent leur version. « ♻️ Replace the selected pages » reste là pour qui veut');
console.log('    vraiment revenir page entière à la copie du fichier.');
console.log('  ✓ En « 🔀 Merge », « ▸ lines » ouvre la page LIGNE À LIGNE : chaque ligne du fichier s’y coche seule,');
console.log('    et une ligne déjà dans la base y est VERROUILLÉE (reconnue, jamais dupliquée en jumeau).');
console.log('  ✓ Le NOM de la base ouverte ne change pas : un chargement n’apporte que du contenu.');
console.log(dangerTotal
  ? `\n⛔ ${dangerTotal} ligne(s) d’AUJOURD’HUI ne sont dans AUCUN des fichiers ci-dessus : en « ♻️ Replace », les importer telles quelles effacerait ces lignes-là. Faire « 💾 Save backup » d’abord, puis décider page par page (ou rester en « 🔀 Merge », qui ne peut rien effacer).`
  : '\n✔ Aucune ligne d’aujourd’hui ne manque dans les fichiers : ces imports ne peuvent rien effacer.');


