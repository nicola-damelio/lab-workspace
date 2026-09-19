/* =========================================================================
   _figure_svg_drive_test.mjs — « 📷 Save as figure » d'un GRAPHE VECTORIEL.

   LE DÉFAUT. Le bouton sauvait bien l'image dans le navigateur, mais l'envoi
   vers le Drive échouait à chaque fois avec

       Failed to execute 'atob' on 'Window': The string to be decoded is not
       correctly encoded.

   parce qu'un graphe recharts est capturé en SVG et que ChartStarLayer.jsx
   écrit cette capture en data:URL PERCENT-ENCODÉE :

       svgToDataUrl(): 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)

   …alors que le chemin d'envoi supposait du base64 (dataUrlToBlob → atob). Les
   figures de cytométrie restaient donc « drive: false » (pixels dans ce
   navigateur seulement) et ne suivaient pas sur un autre poste.

   Vérifié ici :
     • src/utils/dataUrlBytes.js — le décodeur rend, pour une telle URL,
       EXACTEMENT les octets du XML (accents compris : les libellés portent « · »,
       « µ », « é »), et le chemin base64 reste octet pour octet identique ;
     • les deux appelants (driveUpload.js, nextcloud.js) passent par lui et ne
       font plus de atob() sur une charge utile qui peut ne pas être du base64.
   ========================================================================= */
import fs from 'fs';
import { register } from 'node:module';
import { splitDataUrl, dataUrlMime, base64ToBytes, dataUrlToBytes, dataUrlToBlob }
  from './src/utils/dataUrlBytes.js';

const results = [];
let passed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) results.push(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  else passed += 1;
};
const checkTrue = (name, cond) => check(name, !!cond, true);
const toText = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (s) => new TextEncoder().encode(s);

/* ── 1. l'URL EXACTE que produit le 📷 d'un graphe vectoriel ──────────────── */
// Le XML imite une capture réelle de la page Cytométrie : titre d'expérience
// accentué (le magasin du poste montre « 1D Histogram (Data Analysis) · flow_cyt_… »),
// espaces, guillemets, #, % et < > — tout ce que encodeURIComponent protège.
const XML = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="667" height="260" viewBox="0 0 667 260"',
  ' style="width: 100%; height: 100%; font-family: Inter, sans-serif;">',
  '<title>1D Histogram (Data Analysis) · flow_cyt_p53H_p53R</title>',
  '<text x="10" y="20">µL — 100 % viable ≥ 90&#160;% échantillon</text>',
  '<rect width="100%" height="100%" fill="#f1f5f9"/>',
  '</svg>'
].join('\n');
const SVG_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(XML);

check('[url] le SVG capturé est PERCENT-ENCODÉ (aucun « ;base64 »)',
  {
    headOk: SVG_URL.startsWith('data:image/svg+xml;charset=utf-8,'),
    base64: SVG_URL.includes(';base64'),
    pct: SVG_URL.includes('%3Csvg')
  },
  { headOk: true, base64: false, pct: true });

// Ce que faisait l'ancien code : atob() sur cette charge utile → l'exception.
let atobThrew = false;
try { atob(SVG_URL.slice(SVG_URL.indexOf(',') + 1)); } catch { atobThrew = true; }
checkTrue('[url] atob() sur la charge utile SVG lève « not correctly encoded » (le défaut d’origine)', atobThrew);

/* ── 2. lire l'URL au lieu de deviner l'encodage ─────────────────────────── */
check('[split] type MIME', splitDataUrl(SVG_URL).mime, 'image/svg+xml');
check('[split] marqueur base64 absent', splitDataUrl(SVG_URL).isBase64, false);
check('[mime] type déclaré', dataUrlMime(SVG_URL), 'image/svg+xml');
check('[split] pas une data:URL → null', splitDataUrl('https://drive.google.com/file/d/X/view'), null);


/* ── 3. le chemin base64 ne bouge pas d'un octet ─────────────────────────── */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f, 0x80]);
const PNG_B64 = PNG_BYTES.toString('base64');
const PNG_URL = `data:image/png;base64,${PNG_B64}`;
check('[base64] détecté comme tel', splitDataUrl(PNG_URL).isBase64, true);
check('[base64] octets identiques à Buffer', Array.from(dataUrlToBytes(PNG_URL)), Array.from(PNG_BYTES));
check('[base64] type conservé', dataUrlToBlob(PNG_URL).type, 'image/png');
check('[base64] chemin rapide (atob) utilisé tel quel', Array.from(base64ToBytes(PNG_B64)), Array.from(PNG_BYTES));

/* ── 4. ce que atob() refuse et que le décodeur accepte ──────────────────── */
check('[tolérant] espaces et sauts de ligne',
  Array.from(base64ToBytes(PNG_B64.replace(/(.{4})/g, '$1\n'))), Array.from(PNG_BYTES));
check('[tolérant] alphabet URL-safe (- _)',
  Array.from(base64ToBytes('-_8=')), Array.from(Buffer.from('+/8=', 'base64')));
check('[tolérant] « = » de bourrage absent',
  Array.from(base64ToBytes(PNG_B64.replace(/=+$/, ''))), Array.from(PNG_BYTES));
check('[tolérant] un « % » isolé ne coûte pas l’image',
  toText(dataUrlToBytes('data:image/svg+xml;charset=utf-8,<svg>100%25 et 100%</svg>')), '<svg>100% et 100%</svg>');
check('[tolérant] XML non encodé (sans aucun %)',
  toText(dataUrlToBytes('data:image/svg+xml;utf8,<svg><text>·</text></svg>')), '<svg><text>·</text></svg>');
check('[tolérant] pas une data:URL → les octets de la chaîne (jamais d’exception)',
  Array.from(dataUrlToBytes('pas une url')), Array.from(bytesOf('pas une url')));
check('[tolérant] null → chaîne vide', toText(dataUrlToBytes(null)), '');
check('[tolérant] data:URL sans type', dataUrlToBlob('data:,coucou').type, 'application/octet-stream');

/* ── 5. les appelants utilisent bien ce décodeur ─────────────────────────── */
const DRIVE = fs.readFileSync('src/utils/driveUpload.js', 'utf8');
const NC = fs.readFileSync('src/utils/nextcloud.js', 'utf8');
const LIB = fs.readFileSync('src/utils/figuresLibrary.js', 'utf8');
const STAR = fs.readFileSync('src/components/ChartStarLayer.jsx', 'utf8');
const GEL = fs.readFileSync('src/components/GelScheme.jsx', 'utf8');
// Les trois écrans qui affichent le compte-rendu de « ☁ Save to Drive ».
const PROJ = fs.readFileSync('src/components/AppModules/projectDetailModule.jsx', 'utf8');
const FIG = fs.readFileSync('src/components/FiguresSlides.jsx', 'utf8');
const IB = fs.readFileSync('src/components/ImageBuilder.jsx', 'utf8');

checkTrue('[star] la capture d’un <svg> est la data:URL percent-encodée',
  STAR.includes("return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);"));
checkTrue('[star] le gel « 🧬 » capture de la même façon (même défaut, corrigé aussi)',
  GEL.includes("'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)"));

checkTrue('[drive] dataUrlBytes est importé', DRIVE.includes("from './dataUrlBytes'"));
checkTrue('[drive] dataUrlToBlob délègue au décodeur partagé',
  /export const dataUrlToBlob = \(dataUrl\) => \{[\s\S]{0,200}?dataUrlToBytes\(dataUrl\)/.test(DRIVE));
checkTrue('[drive] plus AUCUN atob( dans dataUrlToBlob',
  !/export const dataUrlToBlob[\s\S]{0,220}?atob\(/.test(DRIVE));
checkTrue('[drive] l’upload accepte toujours un Blob (pas seulement une chaîne)',
  DRIVE.includes("typeof file === 'string' ? dataUrlToBlob(file) : file"));

checkTrue('[nc] dataUrlBytes est importé (module feuille, sans cycle)', NC.includes("from './dataUrlBytes'"));
checkTrue('[nc] ncUploadFile décode via dataUrlToBytes',
  /const mime = mimeType \|\| dataUrlMime\(file\)[^;]*;\s*blob = new Blob\(\[dataUrlToBytes\(file\)\]/.test(NC));
checkTrue('[nc] plus AUCUN atob( dans ncUploadFile',
  !/export const ncUploadFile = async[\s\S]{0,900}?atob\(/.test(NC));

checkTrue('[lib] une figure SVG garde ses pixels vectoriels (url ET full)',
  LIB.includes('const url = isSvg ? srcData : await figureThumb(srcData);')
  && LIB.includes('const full = isSvg ? srcData : srcFull;'));
checkTrue('[lib] uploadFigureToDrive envoie les octets décodés au Drive', LIB.includes('file: dataUrlToBlob(src),'));
checkTrue('[lib] …et la data:URL brute à Nextcloud (décodée par ncUploadFile)', LIB.includes('file: src'));
checkTrue('[lib] aucun atob( dans tout figuresLibrary.js', !/\batob\(/.test(LIB));
checkTrue('[lib] « ☁ Save to Drive » peut rattraper les figures locales',
  LIB.includes('export const pushLibraryToDrive') && LIB.includes('localOnlyLibraryItems(read())'));

/* ── 7. le second effet du défaut : « ☁ Save to Drive » pour rattraper ───────
   Les figures vectorielles restées « drive:false » se rattrapent d'un clic
   (pushLibraryToDrive → uploadFigureToDrive, même chemin corrigé). Mais si le
   fournisseur répond mal sur le moment, le fichier part en FILE DE REPRISE —
   il partira tout seul — alors que l'écran annonçait « N failed — check the
   connection and try again » : on cherche une panne qui n'existe pas. Le
   compte-rendu distingue donc les deux. */
checkTrue('[lib] un envoi mis en file de reprise est compté à part des échecs',
  LIB.includes('const q = takeLastUploadQueueInfo() || {};')
  && LIB.includes('out.queued += 1;')
  && /if \(q\.queued\) \{[\s\S]{0,180}?continue;[\s\S]{0,120}?out\.failed \+= 1;/.test(LIB));
checkTrue('[lib] le compte-rendu porte `queued` (0 quand rien n’est en attente)',
  /const out = \{\s*total: 0,\s*uploaded: 0,\s*failed: 0,\s*queued: 0,/.test(LIB));
checkTrue('[ui] les trois écrans distinguent « en attente » d’un échec',
  [PROJ, FIG, IB].every((s) => s.includes('res.failed === 0 && res.queued === 0')
    && s.includes('res.queued ?') && /\$\{res\.failed \? '⚠' : '⏳'\}/.test(s)));
checkTrue('[ui] …et disent que l’envoi repart tout seul (rien n’est perdu)',
  [PROJ, FIG, IB].every((s) => s.includes('they upload by themselves as soon as')));

check('[bytes] le SVG rend EXACTEMENT le XML du graphe', toText(dataUrlToBytes(SVG_URL)), XML);
checkTrue('[bytes] les accents survivent au décodage (%C2%B7, %C2%B5, %C3%A9)',
  (() => { const t = toText(dataUrlToBytes(SVG_URL)); return t.includes('· flow_cyt') && t.includes('µL') && t.includes('échantillon'); })());
checkTrue('[bytes] le fichier envoyé commence bien par le XML, pas par « data: »',
  toText(dataUrlToBytes(SVG_URL)).startsWith('<svg'));

const svgBlob = dataUrlToBlob(SVG_URL);
check('[blob] type du fichier déposé sur le Drive', svgBlob.type, 'image/svg+xml');
await (async () => {
  const bytes = new Uint8Array(await svgBlob.arrayBuffer());
  check('[blob] contenu du fichier = octets du SVG', toText(bytes), XML);
  // Le SVG porte des caractères hors ASCII (· µ — ≥ é) : « longueur du XML » se
  // compare en OCTETS (UTF-8), pas en unités UTF-16 de la chaîne JS.
  check('[blob] taille = longueur réelle du XML (pas sa version encodée)', bytes.length, bytesOf(XML).length);
  checkTrue('[blob] …donc bien plus courte que la data:URL percent-encodée', bytes.length < SVG_URL.length);
})();

// Le MIME n'est PAS deviné ici : uploadFigureToDrive le DÉCLARE au fournisseur,
// avec le bon nom de fichier (c'est ce qui fait un « …_flow_cyt.svg » sur le
// Drive, pas un « .png » contenant du XML).
checkTrue('[lib] le nom déposé porte l’extension .svg',
  LIB.includes("const ext = isSvg ? 'svg' : (extByMime[mime] || 'png');"));
checkTrue('[lib] le MIME « image/svg+xml » est déclaré au(x) deux fournisseur(s)',
  (LIB.match(/mimeType: isSvg \? 'image\/svg\+xml'/g) || []).length === 2);

/* ── report ─────────────────────────────────────────────────────────────────
   Écrit EN DERNIER : le compte-rendu doit porter TOUS les contrôles (y compris
   ceux des octets ci-dessus) — écrit au milieu du fichier, il annonçait
   « passed 26/26 » pendant qu'un échec plus bas passait inaperçu. Le code de
   sortie le dit maintenant à _run_all.cjs. */
/* ── 8. BOUT EN BOUT : le 📷 d'un graphe de cytométrie arrive sur le Drive ───
   Les sections précédentes regardent le décodeur ; celle-ci suit le GESTE. Le
   bouton ne transmet pas la data:URL telle quelle : uploadFigureToDrive la
   décode (Blob), DÉCLARE « image/svg+xml » et le dossier cible. Un faux Drive
   (crochet _esm_test_hook.mjs, comme _library_restore_test.mjs) retient ce qu'il
   reçoit — c'est la seule façon de voir que le fichier déposé est bien le XML
   et pas « data:image/svg+xml;charset=utf-8,%3Csvg… ». */
register('./_esm_test_hook.mjs', import.meta.url);
const libStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (libStore.has(k) ? libStore.get(k) : null),
  setItem: (k, v) => libStore.set(k, String(v)),
  removeItem: (k) => libStore.delete(k)
};
let sent = null;
globalThis.__driveTestMocks = {
  cloud: true,
  // le VRAI décodeur (driveUpload est remplacé, pas dataUrlBytes) : le Blob reçu
  // est donc celui que le navigateur enverrait.
  dataUrlToBlob: (u) => dataUrlToBlob(u),
  uploadLocalFile: async (arg) => {
    sent = arg;
    return { id: 'SVG1', name: arg.name, driveUrl: 'https://drive.google.com/file/d/SVG1/view' };
  }
};
const LIB_MOD = await import('./src/utils/figuresLibrary.js');
const LABEL = '1D Histogram (Data Analysis) · flow_cyt_p53H_p53R';
const driveItem = await LIB_MOD.uploadFigureToDrive({ full: SVG_URL, label: LABEL, projectName: 'CD project' });
checkTrue('[bout en bout] le fournisseur a bien été appelé', !!sent);
checkTrue('[bout en bout] le nom déposé se termine par « .svg » (pas un .png contenant du XML)',
  /\.svg$/.test(String(sent && sent.name)));
check('[bout en bout] le type est DÉCLARÉ au fournisseur', sent && sent.mimeType, 'image/svg+xml');
check('[bout en bout] le dossier visé', sent && (sent.path || []).join('/'), 'projects/CD_project/images');
checkTrue('[bout en bout] le fichier reçu est un Blob (jamais la chaîne encodée)',
  !!(sent && sent.file instanceof Blob));
check('[bout en bout] type du Blob', sent && sent.file && sent.file.type, 'image/svg+xml');
check('[bout en bout] …et son contenu est EXACTEMENT le XML du graphe',
  toText(new Uint8Array(await sent.file.arrayBuffer())), XML);
check('[bout en bout] l’envoi rend l’URL Drive du fichier',
  driveItem && driveItem.driveUrl, 'https://drive.google.com/file/d/SVG1/view');

// Le geste complet : la figure est SAUVÉE (locale), puis rattrapée par
// « ☁ Save to Drive » — elle doit finir « drive: true » avec son lien.
const entry = LIB_MOD.addProjectLibraryItem('P1', { label: LABEL, url: SVG_URL, full: SVG_URL, drive: false });
const push = await LIB_MOD.pushLibraryToDrive({ scope: 'project', projectId: 'P1', projectName: 'CD project' });
check('[bout en bout] la figure restée locale est reprise', push.total, 1);
check('[bout en bout] …envoyée', push.uploaded, 1);
check('[bout en bout] …sans aucun échec ni mise en attente', [push.failed, push.queued], [0, 0]);
const after = LIB_MOD.readProjectLibrary('P1').find((i) => i.id === entry.id);
check('[bout en bout] l’entrée sait que sa copie est sur le Drive', after && after.drive, true);
checkTrue('[bout en bout] …et pointe sur le fichier envoyé',
  String(after && after.driveUrl).includes('/file/d/SVG1/'));
check('[bout en bout] elle n’est plus « locale seulement »',
  LIB_MOD.localOnlyLibraryCount({ scope: 'project', projectId: 'P1' }), 0);

/* ── 9. UNE FIGURE = UN FICHIER ───────────────────────────────────────────────
   « the same image whatever graph I click ». Le nom déposé n'était fait QUE du
   libellé — or le libellé d'une capture est le TITRE de sa section, donc tous
   les graphes d'une même section, et tous les canvas appelés « Canvas 18/09/
   2026 », déposaient LE MÊME nom. L'envoi ÉCRASE le fichier existant du même
   nom (uploadDriveFileToFolderOnce cherche `name='…'` avant d'écrire) : la
   seconde capture remplaçait la première, toutes les entrées pointaient sur ce
   seul fichier (même la vignette Drive), le sidecar `.meta.json` de la
   composition était partagé — et la fusion des listes, qui reconnaît une figure
   à son id de fichier, fusionnait ces figures distinctes en une seule.

   Le faux fournisseur ci-dessous imite le Drive : un nom déjà déposé garde son
   id (écrasement), un nom nouveau en reçoit un. C'est exactement ce qui
   distingue « deux figures » de « deux copies de la même figure ». */

const cloudNames = [];
const cloudIds = new Map();  // nom du fichier → id Drive (un nom = UN fichier)
const metaById = new Map();  // id Drive → { id, name } (ce que le Drive sait du fichier)
const sidecarsInFolder = new Map(); // nom du sidecar → id Drive (le dossier d'images)
const renames = [];          // [ancien nom, nouveau nom] — les renommages DÉJÀ faits
let cloudSeq = 0;
globalThis.__driveTestMocks.uploadLocalFile = async (arg) => {
  const name = String(arg && arg.name);
  if (!cloudIds.has(name)) { cloudSeq += 1; cloudIds.set(name, `F${cloudSeq}`); }
  cloudNames.push(name);
  const id = cloudIds.get(name);
  metaById.set(id, { id, name });
  if (/\.meta\.json$/i.test(name)) sidecarsInFolder.set(name, id);
  return { id, name, driveUrl: `https://drive.google.com/file/d/${id}/view` };
};
const NAME_LABEL = '1D Histogram (Data Analysis) · flow_cyt_p53H_p53R';
const CHART_1 = { testId: 'T1', testName: 'flow_cyt', instanceName: 'run1', elementKey: `${NAME_LABEL} · Chart · 1` };
const CHART_2 = { testId: 'T1', testName: 'flow_cyt', instanceName: 'run1', elementKey: `${NAME_LABEL} · Chart · 2` };
const publish = (src, extra = {}) => LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: SVG_URL, label: NAME_LABEL, src, ...extra
});

/* 9a. l'empreinte est STABLE, courte, et le nom reste lisible. */
checkTrue('[nom] l’empreinte est courte (≤ 7 caractères)', LIB_MOD.fileTagOf('peu importe').length <= 7);
check('[nom] la même identité donne la même empreinte',
  LIB_MOD.fileTagOf('canvas:cv_1'), LIB_MOD.fileTagOf('canvas:cv_1'));
checkTrue('[nom] deux identités différentes donnent deux empreintes',
  LIB_MOD.fileTagOf('canvas:cv_1') !== LIB_MOD.fileTagOf('canvas:cv_2'));

/* 9b. sans identité, RIEN ne change pour les envois qui n'en ont pas. */
check('[nom] sans identité, le nom reste le libellé slugifié + l’extension',
  LIB_MOD.figureFileName('Fig 1', 'png'), 'Fig_1.png');
checkTrue('[nom] …et l’identité ne sert qu’à le distinguer',
  LIB_MOD.figureFileName('Fig 1', 'png', 'x') !== 'Fig_1.png'
  && /^Fig_1-[0-9a-z]+\.png$/.test(LIB_MOD.figureFileName('Fig 1', 'png', 'x')));

/* 9c. l'identité d'une figure : la composition d'un canvas, sinon l'origine. */
check('[ident] un canvas → sa clé de composition',
  LIB_MOD.figureFileIdentity({ canvasData: { canvasKey: 'cv_1' } }), 'canvas:cv_1');
check('[ident] la composition passe avant l’origine',
  LIB_MOD.figureFileIdentity({ src: CHART_1, canvasData: { canvasKey: 'cv_1' } }), 'canvas:cv_1');
check('[ident] une capture → expérience + instance + graphe',
  LIB_MOD.figureFileIdentity({ src: CHART_1 }), `T1|run1|${CHART_1.elementKey}`);
check('[ident] une image sans origine → aucune identité (nom inchangé)',
  LIB_MOD.figureFileIdentity({ src: null }), '');
check('[ident] …une origine sans graphe non plus',
  LIB_MOD.figureFileIdentity({ src: { testName: 'flow_cyt' } }), '');

/* 9d. le geste : deux graphes de la même section → DEUX fichiers, et leurs
       sidecars de composition aussi. */
const figA = await publish(CHART_1);
const figB = await publish(CHART_2);
checkTrue('[geste] les deux figures sont bien deux entrées', figA.entry.id !== figB.entry.id);
checkTrue('[geste] …deux FICHIERS différents dans le dossier', figA.drive.id !== figB.drive.id);
checkTrue('[geste] …et deux noms de fichier différents',
  cloudNames.length >= 2 && cloudNames[0] !== cloudNames[1]);
checkTrue('[geste] …les sidecars de composition aussi',
  !!String(figA.entry.metaName || '') && String(figA.entry.metaName) !== String(figB.entry.metaName));
checkTrue('[geste] le nom reste lisible (le titre de la section est dedans)',
  /^1D_Histogram_Data_Analysis_flow_cyt_p53H_p53R-[0-9a-z]+\.svg$/.test(String(figA.drive.name)));
checkTrue('[geste] …l’empreinte vient APRÈS le libellé (jamais tronquée)',
  String(figA.drive.name).length > '1D_Histogram_Data_Analysis_flow_cyt_p53H_p53R'.length + 4);

/* 9e. …mais RE-CAPTURER le même graphe réécrit SON fichier (aucune copie de
       plus, ni dans le dossier ni dans la bibliothèque). */
const figA2 = await publish(CHART_1);
check('[geste] re-capture du même graphe → le MÊME fichier', figA2.drive.id, figA.drive.id);

/* 9f. deux canvas du même libellé ne s'écrasent plus (leurs compositions non
       plus : c'était le sidecar qui rendait la mauvaise composition). */
const cvA = await publish(null, { label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_a', objects: [] } });
const cvB = await publish(null, { label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_b', objects: [] } });
checkTrue('[geste] deux canvas du même nom → deux fichiers', cvA.drive.id !== cvB.drive.id);
checkTrue('[geste] …et deux compositions distinctes sur le Drive',
  String(cvA.entry.metaName || '') !== String(cvB.entry.metaName || ''));
const cvA2 = await publish(null, { label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_a', objects: [] } });
check('[geste] le même canvas re-sauvé → le MÊME fichier', cvA2.drive.id, cvA.drive.id);

/* 9g. les autres chemins d'envoi portent la même règle : « ☁ Save to Drive »
       d'une figure restée locale, l'import d'un fichier par l'Image Builder, et
       la copie cloud d'un canvas inséré dans un projet. */
checkTrue('[appelants] ☁ Save to Drive transmet l’identité de l’entrée',
  LIB.includes('identity: figureFileIdentity({ src: item.src, canvasData: item.canvasData })'));
checkTrue('[appelants] la publication aussi',
  LIB.includes("const ident = String(identity || '').trim() || figureFileIdentity({ src, canvasData });"));
checkTrue('[appelants] l’import d’un fichier porte l’identité du FICHIER (nom + taille + date)',
  IB.includes('const identity = `${f.name || \'\'}|${f.size || 0}|${f.lastModified || 0}`;'));
checkTrue('[appelants] …et la transmet à la publication',
  /dataUrl,\r?\n          label,\r?\n          src: null,\r?\n          identity\r?\n        \}\)/.test(IB));
checkTrue('[appelants] la copie cloud d’un canvas inséré porte sa clé de composition',
  IB.includes('identity: figureFileIdentity({ canvasData: { canvasKey } })'));
checkTrue('[appelants] les figures d’un manuscrit portent leur section + leur nom de fichier',
  PROJ.includes('figureImageFor(fig, label, `${place.section || \'\'}|${name || label}`)'));

/* ── 10. LE NOM SUR LE DRIVE SUIT LE NOM DU CANVAS ────────────────────────────
   « I cannot find my renamed canvas in Drive ». Renommer une toile ne changeait
   que le libellé de son ENTRÉE : le fichier du Drive gardait le nom de sa
   première écriture, donc on le cherchait sous un nom qu'il ne portait pas. Et
   comme le nom avait changé, la sauvegarde suivante ne retrouvait plus le
   fichier à écraser : elle en déposait un SECOND et laissait l'ancien, orphelin.

   Le faux Drive ci-dessous sait désormais RENOMMER : le nom change, l'id ne
   bouge pas — c'est exactement ce qui distingue « le même fichier renommé » de
   « un second fichier ». */
globalThis.__driveTestMocks.getDriveFileMeta = async (id) =>
  (metaById.get(String(id)) || { id: String(id), name: '', trashed: false });
globalThis.__driveTestMocks.renameDriveFile = async (id, name) => {
  const key = String(id);
  const before = metaById.get(key) || { id: key, name: '' };
  if (before.name) {
    cloudIds.delete(before.name);
    if (sidecarsInFolder.get(before.name) === key) sidecarsInFolder.delete(before.name);
  }
  metaById.set(key, { id: key, name: String(name) });
  cloudIds.set(String(name), key);
  if (/\.meta\.json$/i.test(String(name))) sidecarsInFolder.set(String(name), key);
  renames.push([before.name, String(name)]);
  return true;
};
globalThis.__driveTestMocks.resolveDrivePathFromNames = async () => ({ leafId: 'images_folder', path: [] });
globalThis.__driveTestMocks.findDriveFileByName = async (name, parent) =>
  (parent === 'images_folder' ? String(sidecarsInFolder.get(String(name)) || '') : '');

/* 10a. les helpers purs du nom (l'extension du fichier ACTUEL est conservée). */
check('[nom] extension lue', LIB_MOD.fileExtensionOf('A.JPG'), 'jpg');
check('[nom] aucune extension', LIB_MOD.fileExtensionOf('A'), '');
check('[nom] la cible garde l’extension du fichier actuel',
  LIB_MOD.figureRenameTarget({ label: 'p53H hist', previousName: 'Canvas_18092026.svg' }).name,
  LIB_MOD.figureFileName('p53H hist', 'svg'));
check('[nom] sans nom connu, l’extension par défaut ne casse pas le nom',
  LIB_MOD.figureRenameTarget({ label: 'p53H hist', previousName: '' }).name,
  LIB_MOD.figureFileName('p53H hist', 'png'));
check('[url] le dernier segment, décodé',
  LIB_MOD.fileNameOfUrl('https://nc/remote.php/dav/files/u/a%20b.svg'), 'a b.svg');
check('[url] remplacer le nom garde le dossier (et la requête)',
  LIB_MOD.urlWithFileName('https://nc/remote.php/dav/files/u/a.svg?x=1', 'b c.svg'),
  'https://nc/remote.php/dav/files/u/b%20c.svg?x=1');

/* 10b. le geste : une toile publiée, puis RENOMMÉE. */
const beforeRename = await publish(null, { label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_ren', objects: [] } });
const oldName = String(beforeRename.drive.name);
const oldSidecar = String(beforeRename.entry.metaName || '');
checkTrue('[rename] le fichier et son sidecar sont sur le faux Drive',
  cloudIds.has(oldName) && cloudIds.has(oldSidecar));
const NEW_LABEL = 'p53H — histograms';
const ren = await LIB_MOD.renameFigureOnDrive({
  scope: 'project', projectId: 'P1', projectName: 'CD project', id: beforeRename.entry.id, label: NEW_LABEL
});
check('[rename] le renommage aboutit', ren.ok, true);
check('[rename] le nom visé = libellé + empreinte de l’identité',
  ren.name, `p53H_histograms-${LIB_MOD.fileTagOf('canvas:cv_ren')}.svg`);
check('[rename] le fichier garde son IDENTIFIANT (les liens des figures ne bougent pas)',
  cloudIds.get(ren.name), beforeRename.drive.id);
check('[rename] l’ancien nom n’existe plus dans le dossier', cloudIds.has(oldName), false);
check('[rename] le nom du fichier a bien changé sur le Drive',
  metaById.get(beforeRename.drive.id).name, ren.name);
check('[rename] le sidecar de composition suit', ren.metaMoved, true);
check('[rename] …sous le nouveau nom d’image', ren.metaName, `${ren.name}.meta.json`);
checkTrue('[rename] …et plus sous l’ancien', cloudIds.has(oldSidecar) === false);
check('[rename] l’entrée sait où est sa composition maintenant',
  (LIB_MOD.readProjectLibrary('P1').find((i) => i.id === beforeRename.entry.id) || {}).metaName,
  `${ren.name}.meta.json`);

/* 10c. idempotence : renommer deux fois avec le MÊME nom ne touche à rien. */
const same = await LIB_MOD.renameFigureOnDrive({
  scope: 'project', projectId: 'P1', projectName: 'CD project', id: beforeRename.entry.id, label: NEW_LABEL
});
check('[rename] déjà sous ce nom → aucun renommage', same.unchanged, true);
check('[rename] …et aucune requête de renommage de plus (l’image + son sidecar)',
  renames.length, 2);

/* 10d. la sauvegarde suivante réécrit LE MÊME fichier (aucune copie nouvelle). */
const saved = await LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: SVG_URL, label: NEW_LABEL, canvasData: { canvasKey: 'cv_ren', objects: [] },
  updateId: beforeRename.entry.id
});
check('[rename] « 💾 Save now » réécrit le fichier renommé', saved.drive.id, beforeRename.drive.id);
check('[rename] …sans renommage supplémentaire (même nom)', renames.length, 2);

/* 10e. RATTRAPAGE : le nom a changé sans que le Drive suive (cloud hors ligne au
        moment du renommage, ou fichier déposé AVANT cette correction). La
        sauvegarde suivante renomme d'abord, puis réécrit CE fichier-là. */
const lag = await publish(null, { label: 'Canvas brouillon', canvasData: { canvasKey: 'cv_lag', objects: [] } });
const lagName = String(lag.drive.name);
LIB_MOD.renameProjectLibraryItem('P1', lag.entry.id, 'Nom tardif');   // le local seul
const caught = await LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: SVG_URL, label: 'Nom tardif', canvasData: { canvasKey: 'cv_lag', objects: [] },
  updateId: lag.entry.id
});
check('[rattrapage] le fichier prend le nom du libellé + l’identité',
  caught.drive.name, `Nom_tardif-${LIB_MOD.fileTagOf('canvas:cv_lag')}.svg`);
check('[rattrapage] …en gardant l’identifiant du fichier (donc aucune copie)',
  caught.drive.id, lag.drive.id);
check('[rattrapage] …et l’ancien nom a disparu du dossier', cloudIds.has(lagName), false);
check('[rattrapage] …le sidecar de composition aussi', cloudIds.has(`${lagName}.meta.json`), false);

/* 10f. les gestes de l'app appellent bien ce renommage — page projet, barre de
        l'éditeur, modale 🖼 Library et bibliothèque de Figures & Slides. */
checkTrue('[appelants] la page projet renomme aussi le fichier du Drive',
  PROJ.includes("renameFigureOnDrive({ scope: 'project', projectId: project.id, projectName: project.name || '', id: c.id, label })"));
checkTrue('[appelants] la barre de l’éditeur aussi (une entrée par portée)',
  IB.includes('renameFigureOnDrive({ ...s, label })'));
checkTrue('[appelants] la modale 🖼 Library aussi',
  IB.includes('renameFigureOnDrive({ ...cloudScope, id, label })'));
checkTrue('[appelants] la bibliothèque de Figures & Slides aussi',
  FIG.includes('renameFigureOnDrive({'));
checkTrue('[appelants] et la sauvegarde rattrape un nom qui n’a pas suivi',
  LIB.includes('await renameFigureOnDrive({ scope, projectId, projectName, id: prevEntry.id, label, identity: ident });'));
checkTrue('[appelants] …les quatre gestes DIsent ce qui est arrivé au fichier',
  PROJ.includes('📁 On Drive, “') && IB.includes('📁 On Drive, “') && FIG.includes('renameFigureOnDrive({'));

/* ── 11. DEUX CAPTURES DU MÊME GRAPHE = DEUX FIGURES SI L'IMAGE CHANGE ───────
   « Image overwrite and preview thumbnail mismatch in the Image Library ».

   Le graphe d'un test est le MÊME conteneur quand on passe l'axe X de DAPI à
   l'annexine : même origine (expérience + instance + « 2D Scatter · Canvas · 1 »),
   donc — avant cette correction — LE MÊME nom de fichier cloud et LA MÊME entrée
   de bibliothèque. La seconde capture écrasait la première (le fichier « DAPI »
   portait désormais l'annexin) et l'entrée, elle, gardait sa vignette d'hier :
   « la vignette montre le graphe DAPI alors que le fichier en porte un autre ».

   L'identité porte désormais l'empreinte du CONTENU (`figureContentTag`, posée
   par le 📷) : une autre image est une AUTRE figure — un fichier de plus, une
   entrée de plus, SA vignette — tandis que re-capturer la MÊME image garde son
   identité et met à jour l'entrée existante au lieu de la dupliquer.

   Vérifié ici sur le VRAI chemin (publishLibraryFigure + le faux Drive). */
const AXIS_XML = XML.replace('1D Histogram (Data Analysis)', '1D Histogram annexin (Data Analysis)');
const AXIS_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(AXIS_XML);
checkTrue('[re-capture] le second graphe est bien un autre contenu', AXIS_URL !== SVG_URL);

/* 11a. l'empreinte du contenu : stable pour une image, autre pour une autre. */
check('[contenu] la même image donne la même empreinte',
  LIB_MOD.figureContentTag(SVG_URL), LIB_MOD.figureContentTag(SVG_URL));
checkTrue('[contenu] une AUTRE image donne une autre empreinte',
  LIB_MOD.figureContentTag(SVG_URL) !== LIB_MOD.figureContentTag(AXIS_URL));
check('[contenu] rien à lire → aucune empreinte (identité inchangée)', LIB_MOD.figureContentTag(''), '');
check('[contenu] …et hors d’une chaîne aussi', LIB_MOD.figureContentTag(null), '');
checkTrue('[contenu] elle est courte (elle entre dans un nom de fichier)',
  LIB_MOD.figureContentTag(SVG_URL).length <= 7);

const CHART_3 = { testId: 'T7', testName: 'flow_cyt', instanceName: 'run9', elementKey: `${NAME_LABEL} · Canvas · 1` };
const DAPI_SRC = { ...CHART_3, contentTag: LIB_MOD.figureContentTag(SVG_URL) };
const ANNEXIN_SRC = { ...CHART_3, contentTag: LIB_MOD.figureContentTag(AXIS_URL) };
const ident3 = LIB_MOD.figureFileIdentity({ src: DAPI_SRC });
check('[re-capture] l’identité du graphe = son origine + son IMAGE',
  ident3, `T7|run9|${CHART_3.elementKey}|${DAPI_SRC.contentTag}`);
checkTrue('[re-capture] une autre image du MÊME graphe n’a pas la même identité',
  LIB_MOD.figureFileIdentity({ src: ANNEXIN_SRC }) !== ident3);
check('[re-capture] sans empreinte (entrée d’hier), l’identité reste celle d’avant',
  LIB_MOD.figureFileIdentity({ src: CHART_3 }), `T7|run9|${CHART_3.elementKey}`);

const capA = await LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: SVG_URL, label: NAME_LABEL, src: DAPI_SRC
});
const found3 = LIB_MOD.findLibraryEntryByIdentity({ scope: 'project', projectId: 'P1', identity: ident3 });
check('[re-capture] la capture suivante retrouve SON entrée', found3 && found3.id, capA.entry.id);
checkTrue('[re-capture] …celle du premier graphe, avec ses pixels d’hier',
  String(found3 && found3.url) === SVG_URL && found3 && found3.drive === true);
check('[re-capture] un graphe jamais capturé ne correspond à rien',
  LIB_MOD.findLibraryEntryByIdentity({ scope: 'project', projectId: 'P1', identity: 'T9|run9|jamais · Canvas · 1' }), null);
check('[re-capture] sans identité, rien ne correspond (nom inchangé → entrée neuve)',
  LIB_MOD.findLibraryEntryByIdentity({ scope: 'project', projectId: 'P1', identity: '' }), null);
check('[re-capture] la portée compte : le fichier d’un canvas vit dans SON dossier',
  LIB_MOD.findLibraryEntryByIdentity({ scope: 'common', identity: ident3 }), null);
/* 11b. l'AXE X CHANGE : c'est une autre image, donc une autre figure — rien
        n'est écrasé, et la vignette de chacune est la sienne. */
const identB = LIB_MOD.figureFileIdentity({ src: ANNEXIN_SRC });
const foundB = LIB_MOD.findLibraryEntryByIdentity({ scope: 'project', projectId: 'P1', identity: identB });
check('[overwrite] l’autre image ne retrouve PAS l’entrée du premier graphe', foundB, null);
const capB = await LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: AXIS_URL, label: NAME_LABEL, src: ANNEXIN_SRC,
  updateId: foundB ? foundB.id : null
});
checkTrue('[overwrite] la seconde capture est une entrée DE PLUS', capB.entry.id !== capA.entry.id);
checkTrue('[overwrite] …et un FICHIER de plus : la première n’est plus écrasée',
  capB.drive.id !== capA.drive.id);
checkTrue('[overwrite] …sous un autre nom (l’empreinte de l’image est dedans)',
  String(capB.drive.name) !== String(capA.drive.name));
checkTrue('[overwrite] la vignette de la NOUVELLE figure est bien l’annexin',
  String(capB.entry.url || '').includes('annexin'));
const dapiAfter = LIB_MOD.readProjectLibrary('P1').find((i) => i.id === capA.entry.id);
checkTrue('[overwrite] la PREMIÈRE figure est intacte (mêmes pixels, même fichier)',
  !!dapiAfter && String(dapiAfter.url) === SVG_URL && dapiAfter.drive === true);
check('[overwrite] les deux captures du même conteneur cohabitent',
  LIB_MOD.readProjectLibrary('P1').filter((i) => i.src && String(i.src.elementKey) === CHART_3.elementKey).length, 2);

/* 11c. …mais re-capturer la MÊME image réécrit SON entrée (aucune copie). */
const capA2 = await LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: SVG_URL, label: NAME_LABEL, src: DAPI_SRC, updateId: capA.entry.id
});
check('[re-capture] même image re-capturée → la même entrée', capA2.entry.id, capA.entry.id);
check('[re-capture] …le même fichier cloud (aucune copie)', capA2.drive.id, capA.drive.id);
check('[re-capture] …et toujours DEUX entrées, pas trois',
  LIB_MOD.readProjectLibrary('P1').filter((i) => i.src && String(i.src.elementKey) === CHART_3.elementKey).length, 2);
check('[re-capture] …la liste porte bien les pixels/vignette d’aujourd’hui',
  String((LIB_MOD.readProjectLibrary('P1').find((i) => i.id === capA.entry.id) || {}).url), SVG_URL);

/* 11d. L'ENTRÉE RETROUVÉE PAR SA COMPOSITION EST VRAIMENT RÉÉCRITE.
   `updateId` peut être périmé (page rechargée, autre poste) alors que la clé de
   composition, elle, retrouve l'entrée : le filtre sur `updateId` ne remplaçait
   alors RIEN dans la liste, tout en annonçant « mise à jour » — les pixels et la
   vignette d'aujourd'hui n'arrivaient jamais dans la liste (« la vignette ne se
   met pas à jour »), alors que le fichier cloud, lui, avait bien été réécrit. */
const rekeyed = await publish(null, { label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_rekey', objects: [] } });
const patched = await LIB_MOD.publishLibraryFigure({
  scope: 'project', projectId: 'P1', projectName: 'CD project',
  dataUrl: AXIS_URL, label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_rekey', objects: [] },
  updateId: 'lib_inexistant'
});
check('[prév. id] l’entrée est retrouvée par sa composition', patched.entry.id, rekeyed.entry.id);
checkTrue('[prév. id] …et la nouvelle image est bien ÉCRITE dans la liste',
  patched.updated === true
  && String((LIB_MOD.readProjectLibrary('P1').find((i) => i.id === rekeyed.entry.id) || {}).url) === AXIS_URL);

/* Le BRANCHEMENT : c'est le 📷 qui pose l'empreinte de l'image (sinon le même
   scénario recommence à chaque capture). */
checkTrue('[star] la capture calcule l’identité de fichier',
  STAR.includes('const ident = figureFileIdentity({ src });'));
checkTrue('[star] …en y mettant l’EMPREINTE DE L’IMAGE capturée (sinon l’axe X changé = la même figure)',
  STAR.includes('contentTag: figureContentTag(url)'));
checkTrue('[star] …l’aide vient du module de bibliothèque',
  STAR.includes('figureContentTag') && STAR.includes('getActiveProjectId, publishLibraryFigure, figureFileIdentity, findLibraryEntryByIdentity,'));
checkTrue('[star] …et le 🔄 Recapture (mise à jour d’une entrée connue) la pose aussi',
  (STAR.match(/contentTag: figureContentTag\(url\)/g) || []).length === 2);
checkTrue('[star] …retrouve l’entrée qui possède déjà ce fichier',
  STAR.includes('findLibraryEntryByIdentity({'));
checkTrue('[star] …et met à jour CETTE entrée (jamais une seconde)',
  STAR.includes('updateId: existing ? existing.id : null'));
checkTrue('[star] …en transmettant l’identité (même nom que le renommage et le 🔄 Recapture)',
  STAR.includes('identity: ident,'));
checkTrue('[star] findLibraryEntryByIdentity est importé du module de bibliothèque',
  STAR.includes('figureFileIdentity, findLibraryEntryByIdentity'));
checkTrue('[star] la barre de statut dit si la figure a été MISE À JOUR ou créée',
  STAR.includes("`📷 Figure ${existing ? 'updated in' : 'saved to'} ${where}${driveMsg}`"));
checkTrue('[lib] l’identité d’une figure porte l’empreinte du contenu (quand elle l’a)',
  LIB.includes('return content ? `${base}|${content}` : base;'));

/* Les pixels INSÉRÉS doivent être ceux du fichier d'aujourd'hui : une figure
   réécrite sur place garde son identifiant, donc la MÊME URL, et le navigateur
   peut en avoir une copie d'avant. */
checkTrue('[lib] la lecture peut ignorer le cache du navigateur',
  LIB.includes("const cacheOpt = fresh ? { cache: 'no-store' } : {};"));
checkTrue('[lib] …en option seulement (les vignettes gardent le cache)',
  LIB.includes('export const resolveImageToDataUrl = async (src, { fresh = false } = {}) => {'));
checkTrue('[builder] insérer une figure lit les pixels SANS le cache (vignette cliquée = image obtenue)',
  IB.includes('resolveImageToDataUrl(fullSrc, { fresh: true })'));
check('[builder] …les trois gestes d’insertion (clic, ➕ Add figure, ↔ Swap)',
  (IB.match(/resolveImageToDataUrl\(fullSrc, \{ fresh: true \}\)/g) || []).length, 3);

const total = passed + results.length;
const body = results.length ? results.join('\n') : 'all checks passed';
fs.writeFileSync('_figure_svg_drive_out.txt', `passed ${passed}/${total}\n${body}\n`, 'utf8');
console.log(`passed ${passed}/${total}`);
if (results.length) {
  console.log(body);
  process.exitCode = 1;
}

