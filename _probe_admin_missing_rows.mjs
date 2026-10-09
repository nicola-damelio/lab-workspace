/* =========================================================================
   _probe_admin_missing_rows.mjs — LECTURE SEULE (aucune écriture, rien n'est
   supprimé ni déplacé sur le Drive ; aucun mot de passe demandé).

   Question : « les remboursements sont revenus — mais d'AUTRES pages ont-elles
   perdu des lignes ? »

   Principe : une base d'administration (comme un dataset scientifique) range
   TOUT son contenu dans la charge du dataset (`{ administration: { … } }`).
   Il suffit donc de comparer des INSTANTANÉS de cette charge :

     1. les SAUVEGARDES — `Lab Workspace/<dataset>/backups/*.json|*.html`
        (hebdomadaires + « 💾 Save backup ») ;
     2. les COPIES DE CONTENU — `Lab Workspace/_workspace/datasets/ds_<id>.json`
        (réécrites à chaque sauvegarde automatique).

   Pour chaque instantané, le script relève — à TOUS les niveaux de la charge —
   les tableaux d'objets identifiés par un `id` (« pages » : reimbursements,
   depenses, om, recettes, tests, projects, …), retient un libellé lisible par
   ligne, et compare UNE RÉFÉRENCE à tous les instantanés antérieurs. La
   référence par défaut est la DERNIÈRE SAUVEGARDE — un instantané COMPLET ; les
   copies de contenu (`--ref=copy` pour les prendre comme référence) ne sont
   qu'un
   indice, car elles peuvent être incomplètes. Il dit alors :

     • les lignes VUES AUTREFOIS ET ABSENTES DE LA RÉFÉRENCE, page par page,
       avec la date du dernier instantané qui les portait encore ;
     • la CHUTE DE COMPTE des pages (compte de la référence < maximum observé) ;
     • les pages dont des lignes ont disparu PUIS sont revenues — le même
       incident, déjà vu (l'auto-sauvegarde réécrit la charge ENTIÈRE : c'est
       le mécanisme qui propage une page vide d'un poste à tous les autres).

   Rien n'est écrit, ni sur le Drive ni ici. Usage :

     node _probe_admin_missing_rows.mjs [--show=30] [--detail=12] [--all]
                                        [--ref=backup|copy] [--inventory] [--revs=N]
                                        [--dataset=<titre ou identifiant>]
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
const SHOW = Number(args.get('show') || 30);
const DETAIL = Number(args.get('detail') || 12);
const ALL = args.has('all');
const WANT = String(args.get('dataset') || '').toLowerCase();
/* Quelle référence ? Par DÉFAUT la dernière SAUVEGARDE : c'est un instantané
   COMPLET (écrit par « 💾 Save backup »). Une copie de contenu (`--ref=copy`
   pour la prendre comme référence) peut être INCOMPLÈTE — elle décrit l'état
   d'UN poste, pas forcément toute la base — donc elle ne sert jamais de
   référence toute seule : elle reste affichée à part, comme indice. */
const REF_KIND = String(args.get('ref') || 'backup').toLowerCase();
/* Une sauvegarde HTML ancienne peut peser plusieurs mégaoctets : au-delà on ne
   la relit pas (elle ne change pas le verdict, et la relire coûte cher). */
const MAX_BYTES = 9 * 1024 * 1024;

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) { console.log('PAS DE JETON : rien n’a été lu.'); process.exit(0); }

const auth = { Authorization: `Bearer ${token}` };
const FIELDS = 'files(id,name,mimeType,size,createdTime,modifiedTime,parents)';

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
const day = (v) => String(v || '').slice(0, 16).replace('T', ' ');

/* ── Ce qu'un instantané porte, et sous quel nom on le reconnaît ────────── */
const LABEL_KEYS = [
  'description', 'beneficiaire', 'beneficiary', 'numOM', 'objet', 'designation',
  'fournisseur', 'intitule', 'libelle', 'name', 'label', 'title', 'nom'
];
const labelOf = (row) => {
  const t = (v) => String(v === undefined || v === null ? '' : v).trim();
  for (const k of LABEL_KEYS) { const s = t(row[k]); if (s) return s; }
  return t(row.id) || '(sans libellé)';
};

/* Un instantané = un état de charge décodé, plus d'où il vient et quand il a
   été écrit. `state` est EXACTEMENT ce que l'application recharge. */
const stateOfBackup = (raw) => {
  const v = B.parseBackupText(raw);
  if (!v.ok || !v.state) return { state: null, why: v.reason || 'refusé' };
  const doc = v.doc || {};
  return { state: v.state, title: doc.title || '', datasetId: doc.datasetId || '', kind: v.kind, savedAt: doc.savedAt || 0 };
};
const stateOfCopy = (raw) => {
  let doc = null;
  try { doc = JSON.parse(raw); } catch { return { state: null, why: 'JSON illisible' }; }
  /* Une copie de contenu est un document `{ kind, at, record: { … } }` — la
     charge vit sous `record` (et non à la racine, comme le laissait croire le
     nom du fichier) : c'est ce qui la faisait passer pour vide. */
  const rec = (doc && doc.record && typeof doc.record === 'object') ? doc.record : (doc || {});
  const payload = typeof rec.payload === 'string' ? rec.payload : '';
  let json = '';
  if (payload) {
    json = LZString.decompressFromUTF16(payload) || LZString.decompressFromBase64(payload) || '';
    if (!json && payload.trimStart().startsWith('{')) json = payload;
  }
  if (!json) return { state: null, why: 'charge absente' };
  let state = null;
  try { state = JSON.parse(json); } catch { return { state: null, why: 'charge illisible' }; }
  return {
    state, at: String((doc && doc.at) || ''),
    title: String(rec.title || rec.datasetTitle || ''),
    datasetId: String(rec.datasetId || rec.id || ''),
    kind: rec.kind || 'copie', savedAt: Number(rec.updatedAt || 0)
  };
};

/* ── Relevé GÉNÉRIQUE : tous les tableaux de la charge, à tous les niveaux ── */
const walk = (state) => {
  const rows = new Map();      // chemin -> Map(id de ligne -> libellé)
  const counts = new Map();    // chemin -> nombre d'éléments (même sans id)
  const visit = (node, path, depth) => {
    if (depth > 7 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      counts.set(path, node.length);
      const ids = new Map();
      node.forEach((it) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) return;
        const id = it.id === undefined || it.id === null ? '' : String(it.id);
        if (id) ids.set(id, labelOf(it));
      });
      if (ids.size) rows.set(path, ids);
      node.forEach((it) => visit(it, `${path}[]`, depth + 1));
      return;
    }
    Object.keys(node).forEach((k) => visit(node[k], path ? `${path}.${k}` : k, depth + 1));
  };
  visit(state, '', 0);
  return { rows, counts };
};

/* ── 1. Les instantanés : sauvegardes + copies de contenu ────────────────── */
console.log('══ 1. Instantanés lus sur le Drive (lecture seule) ══');
const snaps = [];

const backups = (await list("trashed=false and name contains '_backup_'"))
  .filter((f) => f.mimeType !== FOLDER_MIME)
  .sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))
  .slice(0, SHOW);
for (const f of backups) {
  if (Number(f.size || 0) > MAX_BYTES) { console.log(`  · ${f.name} — ${Math.round(Number(f.size) / 1048576)} Mo : non relu`); continue; }
  const got = stateOfBackup(await readText(f.id));
  if (!got.state) { console.log(`  · ${f.name} — ${got.why}`); continue; }
  snaps.push({ src: `sauvegarde`, name: f.name, when: f.createdTime, ...got });
}

const ws = (await list(`trashed=false and mimeType='${FOLDER_MIME}' and name='_workspace'`))[0];
const dsDir = ws ? (await list(`trashed=false and mimeType='${FOLDER_MIME}' and name='datasets' and '${ws.id}' in parents`))[0] : null;
const copies = dsDir ? await list(`trashed=false and '${dsDir.id}' in parents`) : [];
for (const f of copies) {
  const got = stateOfCopy(await readText(f.id));
  if (!got.state) { console.log(`  · ${f.name} — ${got.why}`); continue; }
  snaps.push({ src: 'copie de contenu', name: f.name, fileId: f.id, when: got.at || f.modifiedTime || f.createdTime, ...got });
}

/* L'identifiant d'un dataset se lit à TROIS endroits : la charge (`datasetId`),
   le nom de la copie (`ds_<id>.json`) et le nom d'une sauvegarde
   (« <titre>_<6 derniers caractères de l'id>_backup_<date> »). Ce dernier est ce
   qui rattache l'ancien fichier HTML d'un dataset RENOMMÉ à son groupe — sans
   lui, deux groupes seraient audités séparément et une partie de l'histoire
   (donc des lignes) resterait invisible. */
/* ── L'HISTORIQUE D'UNE COPIE DE CONTENU EST L'HISTORIQUE DE L'ÉTAT VIVANT ──
   Le miroir `_workspace/datasets/ds_<id>.json` est réécrit à CHAQUE
   sauvegarde automatique, et Drive en garde les VERSIONS : une version prise
   AVANT la perte porte donc l'état vivant complet de ce moment-là. C'est
   souvent la seule copie qui contient encore les lignes disparues APRÈS la
   dernière sauvegarde (une sauvegarde vieille de deux jours ne les a jamais
   vues). Lecture seule : on ne touche à aucune version. */
const REVS = Number(args.get('revs') || 0);
const revisionsOf = async (fileId) => {
  const url = `${API}/drive/v3/files/${fileId}/revisions?fields=${encodeURIComponent('revisions(id,modifiedTime,size)')}&pageSize=200`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) return [];
  const got = await res.json().catch(() => ({}));
  return Array.isArray(got.revisions) ? got.revisions : [];
};
const readRevision = async (fileId, revId) => {
  const res = await fetch(`${API}/drive/v3/files/${fileId}/revisions/${encodeURIComponent(revId)}?alt=media`, { headers: auth });
  return res.ok ? res.text() : '';
};
/* Les REVS versions les plus récentes, espacées d'au moins 6 h : l'auto-
   sauvegarde en écrit des dizaines, et deux versions de la même heure ne
   racontent pas deux histoires différentes. */
const withRevisions = async (groupSnaps) => {
  if (!REVS) return groupSnaps;
  const out = [...groupSnaps];
  for (const s of groupSnaps) {
    if (!s.fileId || !/copie/.test(s.src || '')) continue;
    const revs = await revisionsOf(s.fileId);
    if (!revs.length) { console.log(`  · ${s.name} — aucune version accessible`); continue; }
    const sorted = [...revs].sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
    let lastKept = 0;
    let kept = 0;
    for (const rv of sorted) {
      if (kept >= REVS) break;
      const t = Date.parse(rv.modifiedTime) || 0;
      if (!lastKept && Math.abs((Date.parse(s.when) || 0) - t) < 10 * 60 * 1000) { lastKept = t; continue; }
      if (lastKept && lastKept - t < 6 * 3600 * 1000) continue;
      const got = stateOfCopy(await readRevision(s.fileId, rv.id));
      if (!got.state) { console.log(`  · ${s.name} version ${String(rv.modifiedTime).slice(0, 16)} — ${got.why}`); continue; }
      out.push({ src: 'copie (version)', name: `${s.name} · ${String(rv.modifiedTime).slice(0, 16)}`, when: rv.modifiedTime, ...got });
      lastKept = t;
      kept += 1;
    }
  }
  return out;
};

const idFromCopyName = (n) => (/^ds_(ds_\d+)\.json$/i.exec(String(n || '')) || [])[1] || '';
const tagFromBackupName = (n) => String((/_[0-9a-z]{6}_backup_/i.exec(String(n || '')) || [''])[0]).slice(1, 7).toLowerCase();
const tagOf = (v) => String(v || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-6);
const strongKeyOf = (s) => s.datasetId || idFromCopyName(s.name);
const strongByTag = new Map();
snaps.forEach((s) => { const k = strongKeyOf(s); if (k) strongByTag.set(tagOf(k), k); });
snaps.forEach((s) => {
  const strong = strongKeyOf(s);
  if (strong) { s.group = strong; return; }
  const tag = tagFromBackupName(s.name);
  s.group = (tag && strongByTag.get(tag)) || (tag ? `id…${tag}` : `titre:${s.title || s.name}`);
});
const groups = new Map();
snaps.forEach((s) => {
  if (!groups.has(s.group)) groups.set(s.group, []);
  groups.get(s.group).push(s);
});
console.log(`# instantanés relus : ${snaps.length} — ${groups.size} dataset(s)`);
console.log(`  ${[...groups.values()].map((v) => `${v[0].title || v[0].name} (${v.length})`).join(' · ')}`);

/* Le dataset qui porte une charge d'administration, sinon le premier. */
const isAdmin = (s) => !!(s.state && s.state.administration);
const pick = [...groups.entries()].filter(([, v]) => v.some(isAdmin));
const chosen = ALL
  ? [...groups.entries()]
  : (WANT ? [...groups.entries()].filter(([g, v]) => g.toLowerCase().includes(WANT) || String(v[0].title).toLowerCase().includes(WANT)) : pick);
if (!chosen.length) { console.log('\nAucun groupe de dataset à auditer (voir --dataset=).'); process.exit(0); }

/* ── 2. L'audit d'un dataset : référence vs tout ce qui a existé ─────────── */
const audit = (groupSnaps) => {
  const ordered = [...groupSnaps].sort((a, b) => String(a.when).localeCompare(String(b.when)));
  const lastIdx = ordered.length - 1;
  /* ⛔ RÉFÉRENCE = la DERNIÈRE SAUVEGARDE (instantané COMPLET, écrit par
     « 💾 Save backup »). Une copie de contenu peut être INCOMPLÈTE : elle
     décrit l'état d'UN poste, pas forcément toute la base — elle ne sert donc
     jamais de référence par défaut (« --ref=copy » = ancien comportement). */
  let refIdx = lastIdx;
  if (REF_KIND !== 'copy') {
    for (let i = lastIdx; i >= 0; i -= 1) if (ordered[i].src === 'sauvegarde') { refIdx = i; break; }
  }
  const ref = ordered[refIdx];
  const seen = new Map();    // chemin -> Map(id -> { label, idxs:Set })
  const timeline = new Map(); // chemin -> Map(idx instantané -> compte)
  ordered.forEach((snap, i) => {
    const { rows, counts } = walk(snap.state);
    rows.forEach((ids, path) => {
      if (!seen.has(path)) seen.set(path, new Map());
      const bucket = seen.get(path);
      ids.forEach((label, id) => {
        if (bucket.has(id)) bucket.get(id).idxs.add(i);
        else bucket.set(id, { label, idxs: new Set([i]) });
      });
    });
    counts.forEach((n, path) => {
      if (!timeline.has(path)) timeline.set(path, new Map());
      timeline.get(path).set(i, n);
    });
  });
  const refWalk = walk(ref.state);
  /* Le DERNIER instantané (souvent une copie de contenu) sert SEULEMENT à voir
     ce qui a chu APRÈS la référence ; `null` quand la référence est déjà ce
     dernier instantané. */
  const liveWalk = lastIdx === refIdx ? null : walk(ordered[lastIdx].state);
  /* Relevé d'un instantané donné, mémorisé : sert à mesurer ce qu'un fichier ne
     pourra PAS rendre. L'import d'une page REMPLACE la page (« { ...base,
     ...pickedAdmin } ») : ce que le meilleur fichier ne porte pas doit être su
     AVANT de cliquer. */
  const walkCache = new Map();
  const rowsOf = (i, p) => {
    if (!walkCache.has(i)) walkCache.set(i, walk(ordered[i].state));
    return walkCache.get(i).rows.get(p) || new Map();
  };
  const pages = [];
  seen.forEach((bucket, path) => {
    const inRef = refWalk.rows.get(path) || new Map();
    const gone = [];
    let returned = 0;
    bucket.forEach((row, id) => {
      if (inRef.has(id)) {
        for (let i = Math.min(...row.idxs); i < refIdx; i += 1) if (!row.idxs.has(i)) { returned += 1; break; }
        return;
      }
      const last = Math.max(...row.idxs);
      /* Vue APRÈS la référence : la ligne n'est PAS perdue — la référence n'est
         simplement plus la fin de l'histoire (dernière sauvegarde ≠ présent). */
      if (last > refIdx) return;
      gone.push({ id, label: row.label, last, first: Math.min(...row.idxs), lastWhen: ordered[last].when });
    });
    const line = timeline.get(path) || new Map();
    const history = [...line.values()];
    const maxSeen = history.length ? Math.max(...history) : 0;
    const now = line.has(refIdx) ? line.get(refIdx) : 0;
    /* Ce que la RÉFÉRENCE porte et que le DERNIER instantané ne porte plus : la
       chute est POSTÉRIEURE à la dernière sauvegarde — seule cette comparaison
       la montre (c'est le cas d'une page vidée ce matin sur un poste). */
    const lostAfter = [];
    if (liveWalk) {
      const liveRows = liveWalk.rows.get(path) || new Map();
      inRef.forEach((label, id) => { if (!liveRows.has(id)) lostAfter.push(label); });
    }
    const liveNow = liveWalk ? (line.has(lastIdx) ? line.get(lastIdx) : 0) : now;
    /* Le MAXIMUM a-t-il été vu AVANT la référence (vraie chute) ou APRÈS
       (la page a seulement GRANDI : « compte de la référence inférieur » n'est
       alors pas une perte, c'est du contenu ajouté depuis) ? */
    let maxIdx = refIdx;
    let maxVal = -1;
    [...line.keys()].forEach((i) => { const n = line.get(i); if (n > maxVal) { maxVal = n; maxIdx = i; } });
    const grew = maxIdx > refIdx;
    /* Le meilleur instantané POUR CETTE PAGE : le plus fourni en lignes (à
       égalité, le plus ancien), sauvegardes d'abord — c'est de CE fichier-là que
       la page se restaure (📂 Load backup → cocher la page → ♻️ Import). */
    let bestIdx = refIdx;
    let bestCount = now;
    ordered.forEach((snap, i) => {
      if (i === refIdx || (REF_KIND !== 'copy' && snap.src !== 'sauvegarde')) return;
      const n = line.has(i) ? line.get(i) : 0;
      if (n > bestCount) { bestCount = n; bestIdx = i; }
    });
    if (!gone.length && !returned && !lostAfter.length && !(maxSeen > now && !grew)) return;
    /* Ce que le meilleur fichier ne porte pas : à savoir avant de cliquer, car
       l'import REMPLACE la page entière par celle du fichier. */
    const bestRows = rowsOf(bestIdx, path);
    const residual = [...bucket.keys()].filter((id) => !bestRows.has(id)).length;
    pages.push({ path, now, maxSeen, gone, returned, line, ordered, lastIdx, liveNow, lostAfter, bestIdx, bestCount, maxIdx, grew, residual, unionSize: bucket.size });
  });
  pages.sort((a, b) => (b.gone.length - a.gone.length) || (b.maxSeen - b.now) - (a.maxSeen - a.now) || a.path.localeCompare(b.path));
  return { ordered, ref, refIdx, lastIdx, pages, total: seen.size };
};
/* ── 3. Le rapport ───────────────────────────────────────────────────────── */
const historyOf = (page, refIdx) => {
  const seq = [];
  let prev = null;
  page.ordered.forEach((snap, i) => {
    const n = page.line.has(i) ? page.line.get(i) : 0;
    if (prev === null || n !== prev) { seq.push(`${String(snap.when).slice(0, 10)}:${n}`); prev = n; }
  });
  const last = page.line.has(refIdx) ? page.line.get(refIdx) : 0;
  if (!seq.length || Number(seq[seq.length - 1].split(':')[1]) !== last) {
    seq.push(`${String(page.ordered[refIdx].when).slice(0, 10)}:${last}`);
  }
  return seq.join(' → ');
};

const summary = [];
/* Les VERSIONS des copies de contenu (`--revs=N`) s'ajoutent ICI, groupe par
   groupe : relire l'historique de TOUS les datasets coûterait cher pour rien
   (on n'audite qu'un groupe à la fois). */
const chosenPlus = REVS
  ? await Promise.all(chosen.map(async ([g, v]) => [g, await withRevisions(v)]))
  : chosen;
chosenPlus.forEach(([group, groupSnaps]) => {
  const { ordered, ref, refIdx, lastIdx, pages, total } = audit(groupSnaps);
  console.log(`\n══ 2. Audit de « ${ref.title || ref.name} » (${group}) ══`);
  console.log(REF_KIND === 'copy'
    ? `Référence = l’instantané le PLUS RÉCENT (--ref=copy) : ${ref.src} ${ref.name}`
    : `Référence = la DERNIÈRE SAUVEGARDE (instantané COMPLET) : ${ref.src} ${ref.name}`);
  console.log(`   écrit ${day(ref.when)} — ${ordered.length} instantané(s) comparés, du ${day(ordered[0].when)} au ${day(ref.when)}`);
  const liveSnap = ordered[lastIdx];
  if (liveSnap !== ref) {
    console.log(`   ⓘ état le plus récent connu : ${liveSnap.src} ${liveSnap.name} du ${day(liveSnap.when)}`);
    console.log('     (une copie de contenu peut être INCOMPLÈTE : elle est montrée à part, jamais comme référence)');
  }
  if (args.has('inventory')) {
    ordered.forEach((s, i) => {
      const tot = [...walk(s.state).counts.values()].reduce((a, b) => a + b, 0);
      console.log(`   ${String(i).padStart(2)} · ${day(s.when)} · ${s.src} · ${tot} élément(s) · ${s.name}`);
    });
  }
  if (ordered.length < 2) { console.log('   (un seul instantané : rien à comparer)'); return; }

  const suspect = pages.filter((p) => p.gone.length || p.maxSeen > p.now);
  console.log(`   ${total} tableau(x) relevé(s) à tous les niveaux — ${suspect.length} à signaler`);
  if (!suspect.length) {
    console.log('   ✔ rien n’a fondu : la référence porte au moins autant de lignes que tout instantané antérieur');
    return;
  }

  suspect.forEach((p) => {
    const head = p.gone.length
      ? `${p.gone.length} ligne(s) vue(s) avant et ABSENTE(s) de la référence`
      : (p.lostAfter.length
        ? `${p.lostAfter.length} ligne(s) encore dans la référence mais DISPARUE(s) depuis (chute POSTÉRIEURE à la dernière sauvegarde)`
        : 'compte de la référence INFÉRIEUR au maximum observé');
    console.log(`\n   ✖ ${p.path} — ${p.now} ligne(s) dans la référence (maximum vu : ${p.maxSeen}) : ${head}`);
    console.log(`      historique : ${historyOf(p, refIdx)}`);
    if (p.returned) console.log(`      ↺ ${p.returned} ligne(s) ont disparu PUIS sont revenues (le même incident, déjà vu)`);
    console.log(`      état le plus récent (${p.ordered[p.lastIdx].src} du ${day(p.ordered[p.lastIdx].when)}) : ${p.liveNow} ligne(s)`);
    console.log(`      le plus fourni : ${p.ordered[p.bestIdx].src} « ${p.ordered[p.bestIdx].name} » du ${day(p.ordered[p.bestIdx].when)} — ${p.bestCount} ligne(s) → source de restauration de CETTE page`);
    if (p.residual) console.log(`      ⚠ ${p.residual} ligne(s) vues dans l'histoire ne sont PAS dans ce fichier (l'import REMPLACE la page : elles devront venir d'un AUTRE fichier)`);
    if (p.grew) console.log(`      ⤴ la page porte ${p.liveNow - p.now} ligne(s) de PLUS aujourd'hui qu'à la référence — rien de perdu de ce côté`);
    if (p.lostAfter.length) {
      console.log(`      ⚠ ${p.lostAfter.length} ligne(s) encore dans la référence ont disparu DEPUIS :`);
      p.lostAfter.slice(0, DETAIL).forEach((lb) => console.log(`      · « ${String(lb).slice(0, 70)} »`));
      if (p.lostAfter.length > DETAIL) console.log(`      … ${p.lostAfter.length - DETAIL} autre(s) ligne(s)`);
    }
    p.gone.sort((a, b) => b.last - a.last).forEach((row, i) => {
      if (i >= DETAIL) return;
      const recent = row.last >= refIdx - 3 ? ' [CHUTE RÉCENTE]' : '';
      console.log(`      • « ${row.label.slice(0, 70)} » — dernier vu le ${String(row.lastWhen).slice(0, 10)} (premier vu le ${String(ordered[row.first].when).slice(0, 10)}) · id ${row.id}${recent}`);
    });
    if (p.gone.length > DETAIL) {
      console.log(`      … ${p.gone.length - DETAIL} autre(s) ligne(s) — relancer avec --detail=${p.gone.length} pour tout voir`);
    }
  });
  summary.push({ group, title: ref.title || ref.name, suspect, refWhen: ref.when, refKind: ref.src });
});

/* ── 4. Verdict ──────────────────────────────────────────────────────────── */
console.log('\n══ 3. Verdict ══');
const hit = summary.filter((s) => s.suspect.length);
if (!hit.length) {
  console.log('Aucune page ne montre de ligne vue avant et absente de LA RÉFÉRENCE (la dernière sauvegarde).');
  console.log('Si l’application affiche pourtant des manques, c’est que l’état VIVANT (cloud) est plus');
  console.log('pauvre que le dernier fichier écrit : faire « 💾 Save backup » dans la base ouverte, puis');
  console.log('relancer ce script — la référence devient alors cet état vivant.');
} else {
  hit.forEach((s) => {
    const n = s.suspect.reduce((a, p) => a + p.gone.length, 0);
    console.log(`• ${s.title} (${s.group}) — référence ${s.refKind || 'sauvegarde'} du ${day(s.refWhen)} : ${s.suspect.length} page(s) concernée(s), ${n} ligne(s) absente(s)`);
    s.suspect.forEach((p) => console.log(`    ${p.path} : ${p.gone.length || `compte ${p.now} < ${p.maxSeen}`}${p.lostAfter.length ? ` + ${p.lostAfter.length} chu(es) depuis` : ''} · à ce jour ${p.liveNow} · source : ${p.ordered[p.bestIdx].name} (${p.bestCount} lignes)${p.residual ? ` · ⚠ ${p.residual} hors fichier` : ''}${p.grew ? ' · page qui a grandi' : ''}`));
  });
  console.log('\nMarche à suivre (aucune écriture ici) :');
  console.log('  1. dans l’application, base OUVERTE : « 💾 Save backup » — ce fichier devient LA RÉFÉRENCE');
  console.log('     (le nuage) ; relancer ce script : la référence devient ce fichier, donc la comparaison');
  console.log('     porte alors sur AUJOURD’HUI et non plus sur un fichier vieux de quelques jours ;');
  console.log('  2. sur un poste qui montre encore les lignes : « 💾 Save backup » AVANT toute autre chose —');
  console.log('     c’est cette copie-là qui servira de source pour la restauration ;');
  console.log('  3. page concernée par page : « 📂 Load backup (.json / .html) » → cocher CETTE SEULE page');
  console.log('     (l’en-tête annonce son compte) → « 🔀 Merge the selected pages » (mode par défaut : il');
  console.log('     n’AJOUTE que les lignes manquantes) : les autres pages de');
  console.log('     la base ouverte ne bougent pas, et AUCUNE ligne n’est effacée ;');
  console.log('  4. une ligne disparue peut aussi avoir été SUPPRIMÉE volontairement : c’est le « dernier vu »');
  console.log('     qui tranche — une chute groupée le même jour, sur plusieurs pages, ne l’est jamais.');
}
