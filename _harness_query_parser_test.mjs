/* =========================================================================
   _harness_query_parser_test.mjs — LE LECTEUR DE REQUÊTES DU FAUX DRIVE.

   POURQUOI CE TEST EXISTE (16/10/2026, demandé) : un faux Drive qui IGNORE une
   clause répond à une AUTRE question que celle posée, et tous les résultats
   qu'il produit deviennent faux — c'est exactement le défaut `splitClauses`
   (`i += String(len-1)` → les clauses après la première étaient perdues). Ce
   test tient donc la règle : AUCUNE clause n'est jamais ignorée ; ce que le
   faux Drive ne comprend pas ou ne modélise pas, il le REFUSE (et le compte).

   Il n'exécute pas l'app : il éprouve la SURFACE DE L'API du faux Drive
   (`fetch` compris — URL, en-têtes, codes), parce que c'est elle que le code
   réel interroge.

   EXÉCUTER : node _harness_query_parser_test.mjs   → exit 0 si tout tient.
   ========================================================================= */
import { createFakeDrive, parseDriveQuery, parseDriveOrderBy, FOLDER_MIME } from './_harness/fake-drive.mjs';

const fails = [];
const ok = (label, cond, detail = '') => {
  if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`   ${cond ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
};

/* ── UN PETIT UNIVERS : deux dossiers du MÊME NOM, sous deux parents ───────── */
const drive = createFakeDrive({ seed: 7 });
const token = drive.registerToken('tok_PARSE', 'PC');
const root = drive.mkFolder('Lab Workspace');
const ds = drive.mkFolder('DS', root);
const proj = drive.mkFolder('Proj', ds);
const alpha = drive.mkFolder('Alpha', proj);                      // l'objet vit ici
drive.mkFile({ name: 'Alpha.json', parent: alpha, text: JSON.stringify({ id: 'e-alpha', name: 'Alpha' }) });
const altrove = drive.mkFolder('Altrove', ds);
const alphaElsewhere = drive.mkFolder('Alpha', altrove);           // MÊME NOM, autre parent
const photo = drive.mkFile({
  name: 'foto.png', parent: alpha, text: 'contenu-de-photo',
  mimeType: 'image/png', appProperties: { kind: 'figure' }
});
const bin = drive.mkFolder('Cestino', ds);
drive.trashNode(bin);

const get = async (params) => {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  return drive.fetch(url.href, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
};
const json = async (params) => {
  const res = await get(params);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
/** Rend '' si la requête passe, sinon le message du refus (HTTP ou exception). */
const refusal = async (params) => {
  try {
    const res = await get(params);
    return res.ok ? '' : `HTTP ${res.status}`;
  } catch (e) { return e.message; }
};
const q = (s) => encodeURIComponent(s);

console.log('A. GRAMMAIRE — chaque clause reconnue est LUE, aucune n’est avalée');
ok("name = 'x'", parseDriveQuery("name='x'").name === 'x');
ok("name contains 'x'", parseDriveQuery("name contains 'x'").nameContains === 'x');
ok("'ID' in parents", parseDriveQuery("'ID' in parents").parentsOf === 'ID');
ok('trashed = false', parseDriveQuery('trashed = false').trashed === false);
ok('trashed = true', parseDriveQuery('trashed = true').trashed === true);
ok("mimeType = dossier", parseDriveQuery(`mimeType='${FOLDER_MIME}'`).folderOnly === true);
ok("mimeType != dossier", parseDriveQuery(`mimeType!='${FOLDER_MIME}'`).mimeTypeNotEquals === FOLDER_MIME);
ok("appProperties has { key/value }",
  parseDriveQuery("appProperties has { key='kind' and value='figure' }").appKey === 'kind');
ok("fullText contains 'x'", parseDriveQuery("fullText contains 'x'").fullText === 'x');
ok('clause avec apostrophe échappée',
  parseDriveQuery("name contains 'Valentine\\'s'").nameContains === "Valentine's");
ok('`q` vide = aucune clause (l’app sonde l’API sans q)',
  parseDriveQuery('').unsupported.length === 0 && parseDriveQuery('').name === null);
ok('clause INCONNUE → refusée (jamais ignorée)',
  parseDriveQuery("starred=true").unsupported.length === 1);
ok('clause MAL FORMÉE (« and » en trop) → refusée',
  parseDriveQuery("name='x' and ").unsupported.length === 1);
ok('guillemet NON FERMÉ → refusée',
  parseDriveQuery("name='x and trashed=false").unsupported.length === 1);
ok('plusieurs `and` de premier niveau : TOUTES les clauses lues (régression splitClauses)',
  (() => { const p = parseDriveQuery("name='x' and 'P' in parents and trashed=false and mimeType='application/json'");
    return p.name === 'x' && p.parentsOf === 'P' && p.trashed === false && p.mimeTypeEquals === 'application/json'; })());
ok("`and` dans une VALEUR ne sépare rien (appProperties)",
  parseDriveQuery("appProperties has { key='k' and value='a and b' }").appValue === 'a and b');
ok('orderBy connu : createdTime desc', parseDriveOrderBy('createdTime desc').length === 1
  && parseDriveOrderBy('createdTime desc')[0].desc === true);
ok('orderBy INCONNU → refusé', parseDriveOrderBy('recency', []).length === 0);

console.log('\nB. SURFACE DE L’API — la requête refusée n’est PAS servie');
ok("clause inconnue (starred=true) → le faux Drive REFUSE",
  (await refusal({ q: 'starred=true' })).length > 0, await refusal({ q: 'starred=true' }));
ok("orderBy inconnu (recency) → REFUSE",
  (await refusal({ q: `'${ds}' in parents and trashed=false`, orderBy: 'recency' })).length > 0);
ok('pageSize=0 → REFUSE (l’API demande 1..1000)',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, pageSize: '0' })).length > 0);
ok('pageSize=abc → REFUSE',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, pageSize: 'abc' })).length > 0);
ok('pageToken inconnu → REFUSE (jeton que le faux n’a pas émis)',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, pageToken: 'zz' })).length > 0);
ok('corpora=drive → REFUSE (Drives partagés non modélisés)',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, corpora: 'drive' })).length > 0);
ok('driveId=… → REFUSE',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, driveId: 'X' })).length > 0);
ok('supportsAllDrives=true → REFUSE',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, supportsAllDrives: 'true' })).length > 0);
ok('spaces=appDataFolder → REFUSE',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, spaces: 'appDataFolder' })).length > 0);
ok('corpora=user (le défaut) → passe',
  (await refusal({ q: `'${ds}' in parents and trashed=false`, corpora: 'user' })) === '');

console.log('\nC. RÉPONSES — ce que le faux rend est ce que l’API rendrait');
const inDs = await json({ q: `'${ds}' in parents and trashed=false` });
ok('liste par parent : exactement les enfants vivants', inDs.files.length === 2,
  `${inDs.files.length} rendu(s) : ${inDs.files.map((f) => f.name).join(', ')}`);
ok('la corbeille n’est PAS rendue sans clause',
  !inDs.files.some((f) => f.name === 'Cestino'));
ok('trashed=true la rend', (await json({ q: `'${ds}' in parents and trashed=true` })).files.length === 1);
const byNameParent = await json({ q: `name='Alpha' and '${altrove}' in parents and trashed=false` });
ok('nom + parent : UN SEUL résultat, le bon (régression du défaut splitClauses)',
  byNameParent.files.length === 1 && byNameParent.files[0].id === alphaElsewhere,
  `${byNameParent.files.length} rendu(s)`);
const nameOnly = await json({ q: "name='Alpha' and trashed=false" });
ok('nom seul : les DEUX dossiers homonymes (le Drive permet les jumeaux)',
  nameOnly.files.length === 2, `${nameOnly.files.length} rendu(s)`);
const onlyFiles = await json({ q: `mimeType!='${FOLDER_MIME}' and '${alpha}' in parents and trashed=false` });
ok("mimeType != dossier : le dossier est exclu (2 fichiers, aucun dossier)",
  onlyFiles.files.length === 2 && onlyFiles.files.some((f) => f.id === photo) && !onlyFiles.files.some((f) => f.id === alpha),
  `${onlyFiles.files.length} rendu(s)`);
const onlyFolders = await json({ q: `mimeType='${FOLDER_MIME}' and '${proj}' in parents and trashed=false` });
ok('mimeType = dossier : seuls les dossiers', onlyFolders.files.length === 1 && onlyFolders.files[0].id === alpha);
const byApp = await json({ q: `appProperties has { key='kind' and value='figure' } and trashed=false` });
ok('appProperties : ne rend que l’objet marqué', byApp.files.length === 1 && byApp.files[0].id === photo);
const byFullText = await json({ q: "fullText contains 'contenu-de-photo' and trashed=false" });
ok('fullText contient : trouvé par le CORPS du fichier (approximation déclarée)',
  byFullText.files.length === 1 && byFullText.files[0].id === photo);
const byFullTextName = await json({ q: "fullText contains 'foto' and trashed=false" });
ok('fullText contient : trouvé aussi par le NOM', byFullTextName.files.length === 1);
const desc = await json({ q: `'${ds}' in parents and trashed=false`, orderBy: 'createdTime desc' });
ok('orderBy=createdTime desc : ordre INVERSÉ (le dernier créé d’abord)',
  desc.files.length === 2 && desc.files[0].id === altrove,
  `ids=${desc.files.map((f) => f.id).join(',')} altrove=${altrove} len=${desc.files.length}`);
const folderMedia = await drive.fetch(
  `https://www.googleapis.com/drive/v3/files/${ds}?alt=media`,
  { headers: { Authorization: `Bearer ${token}` } });
ok('alt=media SUR UN DOSSIER → 400 (jamais une chaîne vide qui passerait pour un JSON)',
  folderMedia.status === 400 && drive.stats.folderDownloads === 1, `HTTP ${folderMedia.status}`);

/* La limite de page : au-delà, l’API COERCE (doc : « values above 1000 will be
   coerced to 1000 ») — ici avec une limite plus basse pour le prouver. */
const small = createFakeDrive({ seed: 9, pageSizeLimit: 3, defaultPageSize: 2 });
const t2 = small.registerToken('tok_SMALL', 'PC');
const r2 = small.mkFolder('r');
for (let i = 0; i < 5; i += 1) small.mkFolder(`f${i}`, r2);
const page = await (await small.fetch(
  `https://www.googleapis.com/drive/v3/files?q=${q(`'${r2}' in parents and trashed=false`)}&pageSize=10`,
  { headers: { Authorization: `Bearer ${t2}` } })).json();
ok('pageSize au-delà de la limite : coercé, jamais une page vide',
  page.files.length === 3 && page.nextPageToken === '3', `${page.files.length} + token « ${page.nextPageToken} »`);

console.log(`\n═══ ESITO : ${fails.length === 0 ? 'toutes les vérifications passent' : `${fails.length} vérification(s) en échec`} ═══`);
if (fails.length) {
  fails.forEach((f) => console.log(`   ✗ ${f}`));
  console.log('   stats du faux : ' + JSON.stringify(drive.stats.unsupportedQueries));
  process.exit(1);
}
console.log('   le faux Drive ne laisse RIEN passer en silence : il refuse et le compte.');
process.exit(0);
