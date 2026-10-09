/* =========================================================================
   _load_merge_test.mjs — « 📂 Load backup » sur une base d’administration :
   REMPLACER ou FUSIONNER, et la fusion perd-elle quelque chose ?

   Question posée : « je charge une sauvegarde HTML PLUS ANCIENNE sur la page
   d’administration — est-ce que ça fusionne avec les entrées récentes, ou est-ce
   que ça les écrase ? » La réponse est maintenant un CHOIX de la fenêtre
   d’import, et les deux gestes ne se ressemblent pas :

     · ♻️ REPLACE — la page cochée est remplacée par celle du fichier
                    (le comportement historique : une ligne récente que le
                    fichier ignore disparaît) ;
     · 🔀 MERGE   — la BASE OUVERTE fait foi : le fichier n’AJOUTE que ce
                    qu’elle n’a pas encore. Rien n’est jamais effacé.

   Ce que cette suite vérifie, et sur QUOI :

     1. le GESTE, exécuté pour de vrai — `mergeAdministration`,
        `mergeAdminValue` et `mergePreviewOf` (src/utils/loadSelection.js) sont
        importés par le crochet ESM des tests : union par clé d’identité, version
        de la base qui l’emporte, pages NON cochées recopiées, `settings` clé par
        clé, lignes sans identité jamais perdues, doublons ;
     2. l’APERÇU annoncé AVANT de cliquer (« +3 lignes » / « rien de neuf ») ;
     3. le BRANCHEMENT dans App.jsx : le mode, le bouton qui applique LE mode
        choisi, et le compte-rendu d’après coup qui dit que rien n’a été effacé ;
     4. la NON-RÉGRESSION du mode « remplacer » : `filterLoadState` écrase
        toujours (c’est le geste historique, il ne doit pas changer).

   Suite : `node _load_merge_test.mjs` (reprise par _run_all.cjs).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const L = await import('./src/utils/loadSelection.js');

const APP = readFileSync('./src/App.jsx', 'utf8');
const SEL = readFileSync('./src/utils/loadSelection.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected,
    `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. Le geste : la base OUVERTE fait foi ────────────────────────────────
      La base contient une ligne (r2, « Frais mission ») que la sauvegarde
      ancienne ne porte PAS : c’est exactement la ligne qu’un « remplacer »
      ferait disparaître, et que la fusion doit conserver. */
const BASE = {
  recettes: [
    { id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 100 },
    { id: 'r2', ligne: 'Frais mission', type: 'Fonctionnement', montant: 200 },
  ],
  personnel: [{ id: 'p1', nom: 'Alice', dateEmbauche: '2020-01-01' }],
  om: [{ id: 'om1', description: 'Congrès', demandeur: 'Alice', dateMission: '2026-05-01' }],
};
const FILE = {
  recettes: [
    { id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 100 },      // déjà là
    { id: 'r9', ligne: 'Prestation', type: 'Salaire', montant: 300 },  // NOUVELLE
  ],
  personnel: [{ id: 'p1', nom: 'Alice', dateEmbauche: '2020-01-01' }],
  conges: [{ demandeur: 'Bob', dateDebut: '2026-01-01', dateFin: '2026-01-05' }],
};

const m = L.mergeAdministration(BASE, FILE, ['recettes', 'personnel']);
eq(m.administration.recettes.map((r) => r.id), ['r1', 'r2', 'r9'],
  'SEULE la ligne absente est ajoutée : « Frais mission » (r2), saisie depuis la sauvegarde, reste en place');
eq(m.administration.personnel.length, 1, 'une fiche déjà présente ne se dédouble pas');
eq([m.added, m.kept], [1, 2], 'le compte-rendu sépare les lignes AJOUTÉES de celles déjà reconnues');
eq(m.administration.om, BASE.om, 'une page NON cochée est recopiée telle quelle');
eq(m.addedByKey, { recettes: 1, personnel: 0 }, '…et le détail par page dit OÙ la ligne est arrivée');

/* La version de la base l’emporte sur celle du fichier : c’est la ligne la plus
   récente (celle qu’on vient de corriger) qui survit au chargement. */
const m2 = L.mergeAdministration(
  { recettes: [{ id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 999, note: 'corrigée depuis' }] },
  { recettes: [{ id: 'r1', ligne: 'Bourse', type: 'Salaire', montant: 100 }] },
  ['recettes'],
);
eq(m2.administration.recettes[0].montant, 999, 'la version RÉCENTE (base) l’emporte : la fusion n’écrase pas');
eq(m2.administration.recettes[0].note, 'corrigée depuis', '…la correction récente survit à une sauvegarde ancienne');
eq([m2.added, m2.kept], [0, 1], 'rien à ajouter → le compte-rendu le dira (« nothing new »)');

/* Aucune base ouverte (base neuve) : la fusion se réduit à ce que le fichier
   porte — il n’y a rien à écraser. */
const fresh = L.mergeAdministration({}, FILE, ['recettes', 'personnel', 'conges']);
eq(fresh.administration.recettes.length, 2, 'sans base ouverte, la fusion = ce que le fichier porte');
eq(fresh.administration.settings, undefined, '…et elle n’INVENTE aucune page que le fichier ne porte pas');

/* ── 2. Les cas limites de la fusion d’UNE valeur ─────────────────────────── */

/* Ligne sans identité exploitable (aucun champ) : elle est AJOUTÉE. Choisir à sa
   place reviendrait à jeter une ligne que personne ne peut identifier. */
const idless = L.mergeAdminValue('recettes', [], [{ ligne: '', type: '' }, { ligne: '', type: '' }]);
eq(idless.value.length, 2, 'deux lignes sans identité sont gardées (ajoutées) — jamais choisies à leur place');
eq(idless.added, 2, '…et comptées comme ajoutées');

/* Deux fois la même ligne DANS le fichier : une seule entrée (même règle que
   l’assistant d’import : `recordDedupeKey`). */
const twice = L.mergeAdminValue('recettes', [], [
  { ligne: 'Bourse', type: 'Salaire' },
  { ligne: 'Bourse', type: 'Salaire' },
]);
eq(twice.value.length, 1, 'un doublon INTERNE au fichier n’entre qu’une fois');

/* `settings` est un objet : clé par clé, la base l’emporte, le fichier ne
   remplit que ce qui manque (jamais l’écrasement d’une option déjà réglée). */
const st = L.mergeAdminValue('settings',
  { currency: 'EUR', retention: '10 ans' },
  { currency: 'USD', theme: 'light' });
eq(st.value, { currency: 'EUR', retention: '10 ans', theme: 'light' },
  'settings : la base l’emporte clé par clé, le fichier ne remplit que les clés ABSENTES');
eq([st.added, st.kept], [1, 1], '…et le compte-rendu dit ce qui vient du fichier et ce qui était déjà là');

/* Valeur simple : la base l’emporte ; le fichier ne remplit qu’un VIDE. */
eq(L.mergeAdminValue('settings', 'A', 'B').value, 'A', 'une valeur simple : la base l’emporte');
eq(L.mergeAdminValue('settings', '', 'B').value, 'B', '…sauf quand la base n’a rien (le fichier remplit)');


/* ── 3. L’APERÇU de la fenêtre (« +3 lignes ») ──────────────────────────────
      Ce que chaque page cochée apporterait, AVANT de cliquer : c’est la phrase
      qui évite de croire qu’un import ne fait rien. */
const SECTIONS = [
  { id: 'admin:recettes', keys: ['recettes'], unit: 'ligne' },
  { id: 'admin:personnel', keys: ['personnel'], unit: 'ligne' },
  { id: 'admin:conges', keys: ['conges'], unit: 'ligne' },
  { id: 'admin:om', keys: ['om'], unit: 'ligne' },
];
const prev = L.mergePreviewOf(BASE, FILE, SECTIONS, ['admin:recettes', 'admin:personnel', 'admin:conges']);
eq(prev['admin:recettes'], { added: 1, kept: 1 }, 'l’aperçu annonce ce que la page apporterait');
eq(prev['admin:personnel'], { added: 0, kept: 1 }, '…et « rien de neuf » quand le fichier est plus ancien');
eq(prev['admin:conges'], { added: 1, kept: 0 }, 'une page absente de la base est annoncée comme entièrement nouvelle');
ok(!Object.prototype.hasOwnProperty.call(prev, 'admin:om'),
  'une page NON cochée n’est pas annoncée (elle ne bougera pas)');

/* La fusion ne rend JAMAIS une base amputée : toutes ses pages sont recopiées,
   y compris celles que le fichier ne connaît pas — le défaut réparé (une page
   absente du fichier devenait VIDE avec « importer tout »). */
const keepAll = L.mergeAdministration(BASE, FILE, ['recettes']);
eq(Object.keys(keepAll.administration).sort(), ['om', 'personnel', 'recettes'],
  'la fusion conserve les pages que le fichier ne porte pas');

/* ── 4. NON-RÉGRESSION du mode « remplacer » ────────────────────────────────
      Le geste historique ne change pas : la page cochée est CELLE DU FICHIER
      (donc sa ligne r2 disparaît), les pages non cochées ne bougent pas. */
const replaced = L.filterLoadState(
  { administration: FILE },
  [{ id: 'admin:recettes', keys: ['recettes'], count: 2 }],
  ['admin:recettes'],
);
eq(replaced.administration.recettes.length, 2,
  '« remplacer » garde son sens : la page cochée devient celle du fichier');
eq(replaced.administration.recettes.map((r) => r.id), ['r1', 'r9'],
  '…donc la ligne récente absente du fichier est emportée (c’est VOULU en mode remplacer)');
eq(replaced.administration.personnel, undefined, '…et les pages non cochées restent intactes');


/* ── 5. Le BRANCHEMENT : c’est bien le mode choisi qui est appliqué ───────── */
has(SEL, 'export const mergeAdministration', 'la fusion est exportée par loadSelection.js');
has(SEL, 'export const mergePreviewOf', '…avec l’aperçu qui alimente les cases à cocher');
has(SEL, "import { recordDedupeKey, normalizeKey } from '../administration/importUtils';",
  'l’identité d’une ligne est CELLE de l’assistant d’import (une seule règle de dédoublonnage)');
has(APP, 'mergeAdministration, mergePreviewOf,',
  'App.jsx importe les deux fonctions (rien n’est re-défini dans le composant)');
has(APP, "const [loadAdminMode, setLoadAdminMode] = useState('merge');",
  'la fenêtre d’import offre le choix, et son défaut est la fusion (le geste sans perte)');
has(APP, "onClick={() => setLoadAdminMode('replace')}",
  '…le mode « remplacer » reste à un clic (le geste historique)');
has(APP, 'onClick={() => confirmLoad(loadAdminMode)}',
  'le bouton principal applique LE MODE CHOISI (jamais un mode figé)');
has(APP, '🔀 Merge the selected pages (${loadPicked.length})',
  '…et son libellé dit lequel il appliquera');
has(APP, "preview={loadAdminMode === 'merge' ? loadMergePreview : null}",
  'les cases annoncent ce que la FUSION apporterait, page par page');
has(APP, 'describeMergePart(s, preview[s.id])', '…avec la phrase qui lit cet aperçu');
has(APP, "const merging = mode === 'merge';", 'confirmLoad distingue les deux gestes');
has(APP, "title: '🔀 Merge — nothing was erased'",
  'la fusion est RACONTÉE après coup (ce qui a été ajouté, ce qui a été gardé)');
has(APP, "setLoadAdminMode('merge');",
  'chaque fichier rouvert repart du mode sans perte (le choix ne survit pas d’un fichier à l’autre)');
has(APP, 'const merged = mergeAdministration(openBase, pickedAdmin, Object.keys(pickedAdmin));',
  '…et la fusion reçoit LA BASE OUVERTE comme copie qui fait foi');

/* L’ORDRE est la protection : la fusion est décidée AVANT que la base soit
   écrite. L’inverse la prendrait sur une base déjà remplacée. */
const adminStart = APP.indexOf('if (pendingLoad && pendingLoad.isAdmin) {');
const mergeAt = APP.indexOf('const merging = mode === \'merge\';', adminStart);
const writeAt = APP.indexOf('setAdminContent(admin);', adminStart);
ok(adminStart > 0 && mergeAt > adminStart && writeAt > mergeAt,
  'la fusion est décidée AVANT l’écriture de la base (l’ordre EST la protection)');

/* Sans base ouverte, il n’y a rien à fusionner : le fichier se pose sur la
   SEMENCE (collections vides + options par défaut) — la base neuve a toutes ses
   pages, jamais seulement celles du fichier. */
const noBaseAt = APP.indexOf('} else if (merging) {', adminStart);
const seedAt = APP.indexOf('admin = { ...base, ...pickedAdmin };', noBaseAt);
const replaceAt = APP.indexOf('} else {', noBaseAt);
ok(noBaseAt > 0 && seedAt > noBaseAt && seedAt < replaceAt,
  'sans base ouverte, la fusion pose le fichier sur la SEMENCE (une base neuve garde toutes ses pages)');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_load_merge_test.mjs — ${passed} assertions OK (📂 Load backup : 🔀 fusionner sans rien perdre ou ♻️ remplacer, au choix — en fusion, la base ouverte fait foi)`);

