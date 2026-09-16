/* =========================================================================
   _doc_responsive_test.mjs — « 📄 Document » et son export s'ADAPTENT à la
   largeur de l'écran.

   Ce qui n'allait pas : la fenêtre d'export était ouverte en 960 px et sa page
   se croyait sur un bureau — sur un téléphone le navigateur la dézoomait, le
   texte devenait minuscule et les marges de 2 cm mangeaient la moitié de
   l'écran. La correction tient en deux endroits, et c'est ici qu'on vérifie
   qu'aucun des deux ne peut plus être « nettoyé » par mégarde :

     1. la PAGE EXPORTÉE (printProjectDoc) : meta viewport, marges en `clamp()`,
        rien ne déborde (images, tableaux, mots longs), règle @media étroite ;
     2. la PAGE À L'ÉCRAN (le document en plein écran) : elle ne défile qu'en
        vertical et le contenu du document se replie.

   Ce qui doit rester INTACT : ce qui part sur le PAPIER. Les règles @media
   print et les marges @page, elles, ne changent pas — un export étroit à
   l'écran doit s'imprimer exactement comme avant.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, what);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
/* Le même test vaut pour les deux feuilles (celle de l'export, celle de
   l'écran) : on ne l'écrit pas deux fois. */
const has = (region, needle, what) => ok(region.includes(needle), what);

/* ── 0. Les deux régions visées, découpées sur des marqueurs robustes ─────── */
const SHEET_START = 'win.document.write(`<!DOCTYPE html>';
const SHEET_END = 'win.document.close();';
const sheet = PAGE.slice(PAGE.indexOf(SHEET_START), PAGE.indexOf(SHEET_END) + SHEET_END.length);
ok(sheet.length > 1000, 'la feuille du document exporté est bien localisée');
has(sheet, SHEET_START, '…depuis l’écriture de la page jusqu’à sa fermeture');
has(sheet, SHEET_END, '…bornes incluses');

const OVERLAY_START = '<div className="fixed inset-0 z-[60] bg-slate-100 overflow-y-auto overflow-x-hidden custom-scrollbar"';
/* La fin de la fenêtre d'export est repérée par le DOCUMENT lui-même : la barre
   d'outils (et son bouton « ⛶ Full screen ») est ainsi DANS la région vérifiée. */
const OVERLAY_END = '<div id="project-doc-container"';
const overlay = PAGE.slice(PAGE.indexOf(OVERLAY_START), PAGE.indexOf(OVERLAY_END));
ok(overlay.length > 300, 'la page « document » plein écran est bien localisée');

/* ── 1. La META VIEWPORT : sans elle, un téléphone dézoome la page ───────── */
has(sheet, '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  'la page exportée déclare la largeur de l’écran (sinon : page « desktop » dézoomée)');
has(sheet, '<meta charset="utf-8" />', '…et elle reste en UTF-8 (accents des titres)');
eq((sheet.match(/<meta name="viewport"/g) || []).length, 1, 'une seule déclaration, pas deux contradictoires');
has(PAGE, "window.open('', '_blank', 'width=960,height=720')",
  'la fenêtre d’export garde sa taille d’ouverture sur un écran de bureau');

/* ── 2. LES MARGES DE LA FEUILLE : elles se réduisent, elles ne rétrécissent
       pas le texte ────────────────────────────────────────────────────────── */
has(sheet, 'margin: 0 auto; max-width: 46rem;', 'la colonne de lecture est bornée (46 rem) et centrée');
has(sheet, 'padding: clamp(0.8rem, 4vw, 2.2cm) clamp(0.9rem, 5vw, 2.2cm);',
  'les marges latérales suivent la largeur (clamp) au lieu d’être fixes à 2,2 cm');

/* Le calcul, tel que le navigateur le fait sur un téléphone de 360 px :
   clamp(0.9rem, 5vw, 2.2cm) → 5vw = 18 px, borné par le plancher de 0,9 rem. */
const paddingAt360 = Math.min(Math.max(0.9 * 16, 0.05 * 360), 2.2 * 37.795);
eq(Math.round(paddingAt360), 18, 'à 360 px de large, la marge vaut 18 px (et non 83 px)');
ok(360 - 2 * paddingAt360 > 300, '…le texte garde donc plus de 300 px de colonne sur un téléphone');

/* ── 3. RIEN NE DÉBORDE : images, formules, tableaux, mots longs ─────────── */
has(sheet, 'overflow-wrap: break-word;', 'un mot très long (URL, séquence) se coupe au lieu de pousser la page');
has(sheet, 'img, svg, canvas, video { max-width: 100%; height: auto; }',
  'images et formules se réduisent à la largeur de la page');
has(sheet, 'table { max-width: 100%; }', 'un tableau large ne dépasse pas la page');
has(sheet, 'pre, code { max-width: 100%; overflow-x: auto; }',
  'un bloc de code large défile DANS SON CADRE');
ok(!/body\s*\{[^}]*?(?<![\w-])width:\s*\d{3,}px/.test(sheet),
  'aucune largeur fixe en pixels sur le corps de la page exportée (la cause du dézoom)');

/* ── 4. LA RÈGLE « ÉCRAN ÉTROIT » de la feuille exportée ─────────────────── */
const SHEET_MEDIA = '@media screen and (max-width: 640px) {';
has(sheet, SHEET_MEDIA, 'la feuille exportée a sa règle pour écran étroit');
const sheetTail = sheet.slice(sheet.indexOf(SHEET_MEDIA));
const sheetMobile = sheetTail.slice(0, sheetTail.indexOf('@media print'));
has(sheetMobile, 'body { font-size: 14px; }', 'le texte est légèrement réduit (la ligne reste lisible)');
has(sheetMobile, 'h1 { font-size: 20px; }', 'les titres suivent la même échelle');
has(sheetMobile, 'table { display: block; overflow-x: auto; }',
  'un tableau large défile dans son cadre au lieu d’être coupé sur le côté');
ok(!/(?<![\w-])width:\s*\d{3,}px/.test(sheetMobile),
  '…sans jamais imposer de largeur fixe supérieure à l’écran (max-width reste permis)');

/* ── 5. CE QUI PART SUR LE PAPIER NE CHANGE PAS ──────────────────────────── */
has(sheet, '@media print {', 'la feuille garde ses règles d’impression');
has(sheet, '@page { margin: 1.6cm 1.5cm; }', 'les marges de la feuille papier sont inchangées');
has(sheet, 'body { padding: 0; max-width: none; font-size: 13px; }',
  'à l’impression, les marges à l’écran sont annulées (la feuille impose les siennes)');
has(sheet, 'table { display: table; width: 100%; }',
  'un tableau redevient un vrai tableau sur le papier (pas de défilement imprimé)');
has(sheet, 'h1, h2 { break-after: avoid; }', 'un titre ne reste pas seul en bas de page');

/* ── 6. LA PAGE À L'ÉCRAN : plein écran, défilement vertical seulement ───── */
has(PAGE, OVERLAY_START, 'la page « document » occupe l’écran et ne défile qu’en vertical');
ok(!/fixed inset-0 z-\[60\][^"]*overflow-x-auto/.test(PAGE),
  '…jamais en horizontal (c’était le contenu coupé sur le côté)');
has(PAGE, 'sm:px-6 sm:py-5 md:px-8 md:py-8', 'ses marges se réduisent aussi sur un téléphone (px-2.5 → sm: → md:)');
has(overlay, '#project-doc-container { overflow-wrap: break-word; }',
  'le document affiché coupe les mots trop longs');
has(overlay, '#project-doc-container table { max-width: 100%; }',
  '…et son tableau ne dépasse pas la page');
has(overlay, '#project-doc-container pre { max-width: 100%; overflow-x: auto; }',
  '…et son bloc de code défile dans son cadre');
has(overlay, '@media (max-width: 640px) {', 'la page à l’écran a elle aussi sa règle pour téléphone');
has(overlay, '#project-doc-container table { display: block; overflow-x: auto; }',
  'où le tableau défile sans être coupé');

/* ── 7. LES CITATIONS RESTENT CLIQUABLES DANS LES DEUX FEUILLES ──────────── */
/* La feuille de l'export est SÉPARÉE de celle de l'application : une règle
   écrite d'un seul côté laissait les [12] sans style — dans un sens comme dans
   l'autre. Voir utils/referenceLinks.js et _reference_links_test.mjs. */
has(sheet, '.cite-ref { color: #2563eb; font-weight: 700; text-decoration: none; }',
  'la feuille exportée connaît la classe des citations liées');
has(overlay, '.cite-ref { color: #2563eb; text-decoration: none; font-weight: 700; }',
  '…et la page à l’écran aussi (« 🔗 Link citations » doit se voir immédiatement)');
has(sheet, 'li:target { background: #fef08a; }',
  'cliquer un [12] met la référence en évidence, à l’écran comme à l’export');

/* ── 8. « ⛶ FULL SCREEN » : LE DOCUMENT S'ÉLARGIT À TOUT L'ÉCRAN ───────────
   Demandé par l'utilisateur : la page « document » occupait déjà l'écran, mais
   sa colonne de lecture restait bornée à 4xl (la moitié d'un grand écran perdue,
   et « ✏️ Edit text » dans une colonne étroite). Le bouton élargit le document à
   tout l'écran et demande le plein écran du navigateur ; « ↙️ Exit » ou Échap
   reviennent à la colonne de lecture — et RIEN de tout cela ne touche la feuille
   imprimée, qui est calculée séparément (voir printProjectDoc). */
has(overlay, '{docFull ? \'↙️ Exit full screen\' : \'⛶ Full screen\'}',
  'la barre d’outils offre « ⛶ Full screen » (et « ↙️ Exit full screen » une fois ouvert)');
has(PAGE, 'const [docFull, setDocFull] = useState(false);', 'l’état du plein écran est celui de la page document');
has(PAGE, '${docFull ? \'max-w-none\' : \'max-w-4xl\'}',
  'la colonne de lecture s’élargit à tout l’écran (max-w-4xl → max-w-none) et revient');
has(PAGE, 'ref={docPaneRef}', 'le volet porte la référence du plein écran (c’est LUI qui passe en plein écran)');
has(PAGE, 'pane.requestFullscreen?.()', 'le plein écran du NAVIGATEUR est demandé (F11 sans quitter la page)');
has(PAGE, "document.fullscreenElement === pane", '…et seul ce volet est refermé, jamais celui d’une autre page');
has(PAGE, "if (e.key === 'Escape') setDocFull(false);", 'Échap referme la colonne élargie');
ok(!/docFull/.test(sheet),
  'la feuille imprimée ne dépend PAS de la largeur d’écran (l’impression ne change pas)');

console.log(`✅ ${passed} tests passés (document exporté et page « document » adaptés à la largeur de l’écran)`);
