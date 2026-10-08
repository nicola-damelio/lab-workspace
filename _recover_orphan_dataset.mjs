/* =========================================================================
   _recover_orphan_dataset.mjs — RÉCUPÉRER LE CONTENU D'UN DOSSIER DE DATASET
   SUPPRIMÉ, PUIS LE METTRE À LA CORBEILLE.

   LE DÉFAUT (constaté sur le Drive réel le 19/09/2026, et encore le 08/10) :
   le dossier `GEC-UPJV-pp` — un dataset SUPPRIMÉ dans le programme — portait
   TOUT le contenu du dataset vivant `GEC-UPJV-projects` (ses projets, ses
   sauvegardes horodatées `GEC-UPJV-projects_*_backup_*.html`, sa bibliothèque
   de figures commune, ses papiers, son stockage), pendant que le dossier au
   bon nom ne recevait presque rien. La purge automatique (voir
   driveMirror.mirrorPurgeDeletedDatasets, qui reprend les tombes inachevées au
   démarrage) met ce dossier à la corbeille : si on la laisse faire AVANT d'en
   avoir sorti le contenu, tout ce contenu disparaît avec lui.

   CE QUE FAIT CE SCRIPT, dans cet ordre et jamais l'inverse :
     1. il DÉPLACE (par IDENTIFIANT, jamais une copie) tout ce que le dossier
        orphelin porte dans le dossier du dataset VIVANT, en FUSIONNANT les
        conteneurs de même nom (`projects`, `backups`, `storage`… et plus bas
        `projects/<projet>`) — un fichier déjà présent sous le même nom dans la
        destination n'est JAMAIS écrasé : il est signalé et laissé où il est ;
     2. il ne met à la corbeille que ce qui reste VIDE : tant qu'un fichier
        n'a pas pu être déplacé, le dossier d'origine est intact et le script le
        dit. Rien n'est jamais supprimé définitivement : tout part à la
        CORBEILLE Drive (restaurable 30 jours).

   Usage (SANS argument = LECTURE SEULE, le plan est affiché et rien n'est
   modifié) :
     node _recover_orphan_dataset.mjs                       # GEC-UPJV-pp → GEC-UPJV-projects
     node _recover_orphan_dataset.mjs --from=<id|nom> --to=<id|nom>
     node _recover_orphan_dataset.mjs --apply               # exécute le plan
     node _recover_orphan_dataset.mjs --apply --report=tmp_recover.txt

   CE QUE CE SCRIPT NE PEUT PAS FAIRE (dit franchement). La portée `drive.file`
   ne montre QUE les fichiers créés par cette application sous la connexion en
   cours : un dossier peut donc paraître VIDE (aucun enfant listé) et en contenir
   un, créé par une autre connexion (un autre poste, ou une connexion Google
   personnelle). Ce fichier-là est invisible ici — il n'est ni listé ni déplacé —
   et sa présence fait échouer la mise à la corbeille du dossier PARENT avec
   « 403 appNotAuthorizedToChild ». La reprise automatique du programme échouera
   exactement de la même façon : ce dossier-là se finit à la main, dans le Drive.
   ========================================================================= */
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';

register('./_esm_test_hook.mjs', import.meta.url);
const { sanitizeSlug } = await import('./src/utils/driveNaming.js');

const TOKEN_URL = 'https://drive-token-server-763848765523.europe-west1.run.app';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';
const WORKSPACE = 'Lab Workspace';

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
}));
const APPLY = args.get('apply') === 'true';
const FROM = args.get('from') || 'GEC-UPJV-pp';
const TO = args.get('to') || 'GEC-UPJV-projects';

const lines = [];
const say = (s = '') => { lines.push(String(s)); console.log(String(s)); };
const finish = () => {
  const report = args.get('report');
  if (report) { try { writeFileSync(report, lines.join('\n') + '\n'); } catch { /* au mieux */ } }
};

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'workspace' })
}).catch(() => null);
const token = tokenRes ? (await tokenRes.json().catch(() => ({}))).access_token : '';
if (!token) {
  say('PAS DE JETON (le serveur de jetons n’a pas répondu) : rien n’a été lu ni modifié.');
  finish();
  process.exit(0);
}

const api = async (path, opts = {}) => {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
  if (!res.ok) {
    /* Le MOTIF fait partie du diagnostic : « appNotAuthorizedToChild » (motif
       d'un 403 de corbeille) veut dire que ce jeton ne voit pas tous les enfants
       du dossier — la portée `drive.file` ne montre que ce que CETTE application
       a créé, sous CETTE connexion. */
    const body = await res.json().catch(() => ({}));
    const reason = (body && body.error && body.error.errors && body.error.errors[0]
      && body.error.errors[0].reason) || '';
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return res.json();
};
const listAll = async (id) => {
  const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime)');
  const out = [];
  let pageToken = '';
  do {
    const j = await api(`/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};
const isFolder = (n) => n && n.mimeType === FOLDER;
const looksLikeId = (v) => /^[A-Za-z0-9_-]{20,}$/.test(String(v || ''));

/** Le dossier visé : son IDENTIFIANT quand on l'a, sinon son nom exact sous
 *  « Lab Workspace » (même ancrage que le reste de l'application). */
const resolveFolder = async (ref) => {
  if (looksLikeId(ref)) {
    const meta = await api(`/drive/v3/files/${ref}?fields=id,name,mimeType,trashed`).catch(() => null);
    if (meta && meta.id) return { id: String(meta.id), name: String(meta.name || '') };
    return null;
  }
  const q = encodeURIComponent(
    `name='${WORKSPACE}' and mimeType='${FOLDER}' and trashed=false`
  );
  const ws = (await api(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`)).files || [];
  if (!ws.length) return null;
  const wanted = String(ref);
  const found = await listAll(ws[0].id);
  const hit = found.find((f) => isFolder(f) && f.name === wanted)
    || found.find((f) => isFolder(f) && sanitizeSlug(f.name) === sanitizeSlug(wanted));
  return hit ? { id: String(hit.id), name: String(hit.name || '') } : null;
};

/* ── LE PLAN : déplacer, en fusionnant les conteneurs de même nom ─────────── */

const moves = [];       // { id, name, from, to, kind }
const conflicts = [];   // { name, from, to }  (rien n'est touché)
const leftovers = [];   // dossiers d'origine vidés par la fusion → corbeille avec la source
let scanned = 0;

const planMerge = async (fromId, toId, label) => {
  const [fromKids, toKids] = await Promise.all([listAll(fromId), listAll(toId)]);
  scanned += fromKids.length;
  const byName = new Map();
  toKids.forEach((n) => { if (!byName.has(n.name)) byName.set(n.name, n); });
  for (const child of fromKids) {
    if (child.name === '_meta.json') {
      /* Le repère d'identité d'un dossier de l'application : c'est une DONNÉE,
         il suit les autres. */
      byName.delete(child.name);
    }
    const twin = byName.get(child.name);
    if (!twin) {
      byName.delete(child.name);
      moves.push({ id: child.id, name: child.name, from: fromId, to: toId, kind: isFolder(child) ? 'dossier' : 'fichier' });
      continue;
    }
    byName.delete(child.name);
    if (isFolder(child) && isFolder(twin)) {
      /* Deux conteneurs du MÊME nom (projects, backups… ou projects/<projet>) :
         on FUSIONNE — leurs enfants sont déplacés un par un, et le dossier
         d'origine (vide à la fin) part à la corbeille avec la source. */
      leftovers.push({ id: child.id, name: `${label}/${child.name}` });
      await planMerge(child.id, twin.id, `${label}/${child.name}`);
      continue;
    }
    conflicts.push({ name: child.name, from: `${label}/${child.name}`, to: `…/${child.name}`, id: child.id });
  }
};

const moveNode = async (node, toId) => {
  const done = await api(`/drive/v3/files/${node.id}?addParents=${encodeURIComponent(toId)}`
    + `&fields=id,name,parents`, { method: 'PATCH' }).catch((err) => ({ error: err.message }));
  return done && done.error ? String(done.error) : '';
};

/* ── LA SOURCE, LA DESTINATION ───────────────────────────────────────────── */

const source = await resolveFolder(FROM);
const target = await resolveFolder(TO);
if (!source) { say(`✗ Dossier d’origine introuvable : ${FROM}`); finish(); process.exit(0); }
if (!target) { say(`✗ Dossier de destination introuvable : ${TO}`); finish(); process.exit(0); }
say(`Origine      : ${source.name} [${source.id}]`);
say(`Destination  : ${target.name} [${target.id}]`);
if (source.id === target.id) { say('Origine et destination identiques : rien à faire.'); finish(); process.exit(0); }
say('');

await planMerge(source.id, target.id, target.name);

say(`PLAN — ${scanned} élément(s) examiné(s) : ${moves.length} à déplacer, ${conflicts.length} en conflit`);
const show = (list, limit = 40) => {
  list.slice(0, limit).forEach((m) => say(`  • ${m.name} → ${target.name}/${m.name}`));
  if (list.length > limit) say(`  … et ${list.length - limit} autre(s)`);
};
show(moves.filter((m) => m.to === target.id));
const deeper = moves.filter((m) => m.to !== target.id);
if (deeper.length) {
  say(`  (dans les conteneurs fusionnés : ${deeper.length} élément(s), dont`
    + ` ${deeper.filter((m) => m.kind === 'dossier').length} dossier(s))`);
}
for (const c of conflicts) {
  say(`  ⚠ CONFLIT — « ${c.from} » : un élément du même nom existe déjà dans la destination.`
    + ` RIEN n’est écrasé ni supprimé : celui-ci reste dans ${source.name}.`);
}
say('');
if (!APPLY) {
  say('Mode LECTURE SEULE : rien n’a été déplacé ni mis à la corbeille.');
  say(`Relancer avec --apply pour exécuter ce plan (${moves.length} déplacement(s)).`);
  finish();
  process.exit(0);
}

/* ── LE GESTE : déplacer, vérifier, puis (et seulement alors) la corbeille ── */

say('DÉPLACEMENT (par identifiant : aucun doublon, rien de copié)');
let moved = 0;
const failures = [];
for (const m of moves) {
  const err = await moveNode(m, m.to);
  if (err) { failures.push({ ...m, err }); say(`  ✗ ${m.name} : ${err}`); continue; }
  moved += 1;
  if (moved <= 12 || moved % 25 === 0) say(`  ✓ ${m.name} → ${m.to === target.id ? target.name : '(conteneur fusionné)'}`);
}
say(`  ${moved}/${moves.length} élément(s) déplacé(s).`);
if (failures.length) say(`  ⚠ ${failures.length} échec(s) — voir plus haut`);

/* CE QUI RESTE : on compte les FICHIERS encore dans la source. Tant qu'il en
   reste un (conflit ou échec), la source reste INTACTE : on ne met jamais à la
   corbeille un dossier qui porte encore quelque chose. */
const countFilesLeft = async (id) => {
  const kids = await listAll(id);
  let files = 0;
  const emptyFolders = [];
  for (const k of kids) {
    if (isFolder(k)) {
      const inside = await countFilesLeft(k.id);
      files += inside.files;
      if (inside.files === 0) emptyFolders.push(`${k.name}${inside.emptyFolders.length ? ` (${inside.emptyFolders.join(', ')})` : ''}`);
    } else files += 1;
  }
  return { files, emptyFolders };
};
const left = await countFilesLeft(source.id);
say('');
if (left.files > 0 || conflicts.length > 0) {
  say(`⛔ ${left.files} fichier(s) restent dans ${source.name}`
    + `${conflicts.length ? ` (dont ${conflicts.length} en CONFLIT de nom)` : ''} :`
    + ' le dossier n’est PAS mis à la corbeille — rien ne serait perdu, mais rien ne serait rangé non plus.');
  say('Ouvre le Drive et regarde ce qui reste (la liste du plan est plus haut) ; renomme les doublons, puis relance.');
  finish();
  process.exit(0);
}

const empty = await api(`/drive/v3/files/${source.id}?fields=id,name`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
}).catch((err) => ({ error: err.message }));
say('');
if (empty && empty.error) {
  say(`✗ ${source.name} n’a pas pu être mis à la corbeille : ${empty.error}`);
  say('  « appNotAuthorizedToChild » est le cas à connaître : la portée `drive.file`'
    + ' ne montre QUE ce que cette application a créé sous CETTE connexion — un'
    + ' dossier peut donc paraître vide (aucun enfant listé) et en contenir un,'
    + ' créé par une autre connexion. Ce fichier invisible bloque la corbeille du'
    + ' parent — et la reprise automatique du programme échouera de la même façon.');
  say(`  À FINIR À LA MAIN : ouvre « ${source.name} » dans le Drive, vide ce qui reste`
    + ' (déplace-le dans le dataset vivant), puis « Supprimer » le dossier.');
} else {
  say(`🗑 ${source.name} [${source.id}] mis à la corbeille (restaurable 30 jours).`
    + ` Ses conteneurs d’origine, vidés par la fusion, partent avec lui :`
    + ` ${left.emptyFolders.join(', ') || '(aucun)'}.`);
}
say('');
const finalTop = (await listAll(target.id)).map((n) => `${isFolder(n) ? '📁' : '📄'} ${n.name}`);
say(`${target.name} contient maintenant ${finalTop.length} élément(s) :`);
finalTop.slice(0, 30).forEach((l) => say(`  ${l}`));
say('');
say(`Rien n’a été supprimé définitivement, rien n’a été copié : ${moved} élément(s) déplacé(s) par identifiant.`);
finish();
