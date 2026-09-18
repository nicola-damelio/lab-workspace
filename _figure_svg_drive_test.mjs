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

const total = passed + results.length;
const body = results.length ? results.join('\n') : 'all checks passed';
fs.writeFileSync('_figure_svg_drive_out.txt', `passed ${passed}/${total}\n${body}\n`, 'utf8');
console.log(`passed ${passed}/${total}`);
if (results.length) {
  console.log(body);
  process.exitCode = 1;
}

