/* ============================================================================
   _docking_linear_bar_test.mjs — LA BARRE DU DOCKING EST LINÉAIRE, LA PAGE SE
   LAISSE DÉFILER PENDANT LA DESCENTE, ET UN STYLE NE PEUT PLUS ÉTEINDRE LA
   RAMPE DU FOND.

   Le rapport de cette session, mot pour mot : « the 3D viewer loses its gradient
   background after a style file loads — and there is no way to restore it » et
   « make the docking-experiment load bar linear with the page scrollable during
   PDB loading ».

   ── A. LA BARRE LINÉAIRE (utils/dockingDeclaredFiles.js) ──────────────────
     1. LE TOTAL EST CONNU AVANT LE PREMIER OCTET : `onProgress(0, N, …)` tombe
        AVANT le premier `fetchText` — la barre du haut (utils/loadProgress.js) a
        donc un pourcentage VRAI dès la première peinture, elle ne pulse pas.
     2. LINÉAIRE : les rapports sont 0, 1, 2 … N — un fichier = un pas, un TOTAL
        CONSTANT (jamais `null` entre deux fichiers, ce qui ferait repulser la
        barre), et le pourcentage qui en découle est monotone.
     3. LA PAGE PEUT PEINDRE : la boucle ATTEND la promesse du rapporteur. C'est
        ce que la page met à profit en y glissant `yieldToPaint()` (voir
        utils/backgroundWork.js) — le fichier suivant ne part PAS tant que la
        peinture n'a pas eu lieu, donc la page se peint et DÉFILE.
     4. ⏹ L'ARRÊT EST RESPECTÉ : `isAborted` est consulté avant chaque fichier ;
        une fois levé, plus aucune requête ne part, et ce qui est DÉJÀ arrivé
        reste dans le résultat (rien n'est jeté).

   ── B. LE CÂBLAGE DE LA PAGE (analyse de source, comme les autres garde-fous)
     `loadProgress.begin('docking structures')`, le `finally` qui libère la barre
     ET le ⏹, `abortControl.register`, et `yieldToPaint` avant/entre les gros
     travaux synchrones (gunzip, JSON.parse, JSON.stringify du magasin).

   ── C. UN STYLE N'ÉTEINT PLUS LA RAMPE DU FOND (NMRMoleculeViewer.jsx)
     Le décor par défaut du viewer est une rampe ÉTEINTE (BG_GRADIENT_DEFAULT_ON),
     donc « un fichier dit on:false » et « un fichier n'en dit rien » sont
     indiscernables : un style enregistré sans rampe ÉTEIGNAIT celle de l'écran, à
     chaque montage du viewer (le rappel automatique d'une expérience) — d'où
     « il n'y a aucun moyen de la retrouver ». La règle est maintenant la même à
     l'ÉCRITURE et à la LECTURE : une rampe éteinte ne voyage pas ; une figure
     enregistrée AVEC sa rampe la ramène quand même (la fonctionnalité est
     intacte : applyViewerSetup applique toujours une rampe PRÉSENTE).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchDeclaredDockingFiles } from './src/utils/dockingDeclaredFiles.js';
import { loadProgressPercent } from './src/utils/loadProgress.js';
import { bgGradientOf } from './src/utils/viewerBackground.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (got, want, what) => {
  assert.deepEqual(got, want, `${what}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  passed += 1;
};

// CRLF → LF : les aiguilles multi-lignes s'écrivent naturellement.
const PAGE = readFileSync('src/components/DockingSections.jsx', 'utf8').replace(/\r\n/g, '\n');
const VIEWER = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const SHELL = readFileSync('src/components/TestShellRenderer.jsx', 'utf8').replace(/\r\n/g, '\n');

const ATOM = 'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N';
/* TROIS fichiers DÉCLARÉS, tous avec leur lien (2 structures + 1 molécule) : le
   total que la barre doit annoncer est donc 3, connu dès la première ligne. */
const TEST = {
  dockingStructures: [
    { name: '8_seletopclusts/cluster_1_model_1.pdb.gz', driveUrl: 'https://drive.google.com/file/d/AAA/view' },
    { name: 'cluster_2_model_1.pdb', driveUrl: 'https://drive.google.com/file/d/BBB/view' }
  ],
  dockingMolecules: [
    { name: 'TAC', fileName: 'conformers_TAC.pdb', segid: 'A', driveUrl: 'https://drive.google.com/file/d/CCC/view' }
  ]
};


/* ── A. LE TÉLÉCHARGEMENT COMPTÉ ─────────────────────────────────────────── */

/* A1. Le total est annoncé AVANT le premier octet, et il vaut le nombre de
   fichiers manquants — les liens déclarés par le dataset le donnent d'avance. */
const timeline = [];
const reports = [];
const fetched = [];
const all = await fetchDeclaredDockingFiles({
  test: TEST,
  have: {},
  fetchText: async (file) => { timeline.push(`fetch:${file.name}`); fetched.push(file.name); return ATOM; },
  onProgress: async (done, total, phase) => {
    timeline.push(`report:${done}/${total}`);
    reports.push({ done, total, phase });
  }
});
eq(timeline[0], 'report:0/3', 'le total (3) est annoncé AVANT le premier téléchargement');
eq(fetched.length, 3, '…et les trois fichiers déclarés descendent bien');
eq(reports.map((r) => r.total), [3, 3, 3, 3], 'le TOTAL est CONSTANT d’un rapport à l’autre (jamais null entre deux → la barre ne pulse pas)');
eq(reports.map((r) => r.done), [0, 1, 2, 3], 'un fichier = UN pas : 0, 1, 2, 3 (la barre est LINÉAIRE)');
eq(loadProgressPercent(reports[0].done, reports[0].total), 0, '0/3 → 0 %');
eq(loadProgressPercent(reports[1].done, reports[1].total), 33, '1/3 → 33 %');
eq(loadProgressPercent(reports[3].done, reports[3].total), 100, '3/3 → 100 %');
ok(reports.every((r, i) => i === 0 || loadProgressPercent(r.done, r.total) >= loadProgressPercent(reports[i - 1].done, reports[i - 1].total)),
  'le pourcentage ne redescend JAMAIS (monotone)');
eq(reports[0].phase, 'File 1 of 3 — 8_seletopclusts/cluster_1_model_1.pdb.gz', 'le rapport NOMME le fichier qui descend');
eq(reports[3].phase, '', '…et le dernier pas n’invente plus de nom (tout est arrivé)');
eq(all.fetched.length, 3, 'le résultat de la fonction est inchangé (mêmes 4 clés, même contenu)');

/* A2. LE CONTRAT DE PEINTURE : la boucle ATTEND ce que rend le rapporteur. Sans
   cela, `yieldToPaint` glissé dans le rapporteur ne servirait à rien et la page
   resterait figée pendant la descente. */
let releaseReport;
const gate = new Promise((resolve) => { releaseReport = resolve; });
const events = [];
const held = fetchDeclaredDockingFiles({
  test: TEST,
  have: {},
  fetchText: async (file) => { events.push(`fetch:${file.name}`); return ATOM; },
  onProgress: async (done) => { events.push(`report:${done}`); if (done === 1) await gate; }
});
await new Promise((resolve) => setTimeout(resolve, 10));   // laisser tourner la boucle
eq(events, ['report:0', 'fetch:8_seletopclusts/cluster_1_model_1.pdb.gz', 'report:1'],
  'la boucle S’ARRÊTE sur le rapporteur (le 2e fichier n’est pas encore demandé)');
releaseReport();
await held;
ok(events.includes('fetch:cluster_2_model_1.pdb'),
  '…et elle repart dès que le rapporteur rend la main (c’est là que la page se peint et se laisse défiler)');

/* A3. ⏹ L’ARRÊT : consulté avant chaque fichier, il n’en lance plus aucun et
   GARDE ce qui est déjà arrivé. */
let stopNow = false;
const afterStop = [];
const aborted = await fetchDeclaredDockingFiles({
  test: TEST,
  have: {},
  fetchText: async (file) => { afterStop.push(file.name); stopNow = true; return ATOM; },
  isAborted: () => stopNow
});
eq(afterStop, ['8_seletopclusts/cluster_1_model_1.pdb.gz'], 'une fois le ⏹ levé, plus aucune requête ne part');
eq(aborted.fetched, ['8_seletopclusts/cluster_1_model_1.pdb.gz'], '…et le fichier déjà arrivé est CONSERVÉ (rien n’est jeté)');
eq(aborted.structures.length, 1, '…il est bel et bien rangé (formes de l’import)');

/* Déjà arrêté AVANT de commencer : rien ne part, rien n’est annoncé. */
let asked = 0;
let announced = 0;
const never = await fetchDeclaredDockingFiles({
  test: TEST,
  have: {},
  fetchText: async () => { asked += 1; return ATOM; },
  onProgress: async () => { announced += 1; },
  isAborted: () => true
});
eq(asked, 0, 'un ⏹ levé avant le premier fichier : aucune requête');
eq(announced, 0, '…et aucun rapport (la barre ne s’allume pas pour rien)');
eq(never, { structures: [], molecules: [], fetched: [], failed: [] }, '…et la forme du résultat ne change pas');

/* Sans rapporteur ni arrêt (les appels historiques), le comportement est celui
   d’avant : c’est ce que garde _docking_virgin_page_test.mjs. */
const silent = await fetchDeclaredDockingFiles({ test: TEST, have: {}, fetchText: async () => ATOM });
eq(Object.keys(silent), ['structures', 'molecules', 'fetched', 'failed'], 'la forme de retour reste à quatre clés (aucune clé de plus)');
eq(silent.fetched.length, 3, '…et le téléchargement se fait normalement');

/* ── B. LE CÂBLAGE DE LA PAGE ────────────────────────────────────────────── */
const has = (needle, what) => ok(PAGE.includes(needle), `${what}\n  introuvable : ${needle}`);
has("const rep = loadProgress.begin('docking structures');", 'la restauration du docking RAPPORTE sa progression (la barre du haut)');
has("abortControl.register('docking structures', () => { cancelled = true; });", '…et elle s’enregistre pour le ⏹ de la barre du haut');
has('unregister();\n      rep.end();', 'la barre ET le ⏹ sont libérés dans le `finally` (aucun ne survit à la restauration, même en cas d’erreur)');
has('onProgress: async (done, total, phase) => {\n        rep.step(done, total, phase);\n        await yieldToPaint();\n      },',
  'le rapporteur donne le compteur RÉEL puis REND LA MAIN (la page se peint entre deux fichiers)');
has('isAborted: () => cancelled', '…et la boucle consulte l’arrêt avant chaque fichier');
has("rep.phase('Looking for the archived copy on Google Drive…')", 'l’archive est annoncée avant d’être téléchargée (lecture + gunzip + parse sont longs)');
has("rep.phase('Saving the structures in this browser…')", '…et le rangement dans la base est annoncé avant son `JSON.stringify`');
ok((PAGE.match(/await yieldToPaint\(\);/g) || []).length >= 4,
  'le fil principal est rendu AVANT chaque gros travail synchrone (archive, magasin local, téléchargements, rangement)');
ok(PAGE.includes('stoppedNote'), 'un arrêt en cours de route est DIT dans le message (avec le compte réel)');

/* La barre du haut elle-même : elle ne prend AUCUN clic (pointer-events-none, la
   page reste donc entièrement cliquable et défilable), sa largeur est animée
   (transition-[width] → un pas linéaire et non un saut), et le chip appelle bien
   le registre d’annulation. */
ok(SHELL.includes('fixed top-0 left-0 right-0 z-[70] no-print pointer-events-none'),
  'la barre du haut ne capte aucun clic : la page reste cliquable et DÉFILABLE pendant le chargement');
ok(SHELL.includes('transition-[width]'), 'sa largeur est animée (la progression par fichier se voit, elle ne saute pas)');
ok(SHELL.includes('abortControl.abortAll()'), '…et son ✕ arrête l’opération par le registre partagé');

/* ── C. UN STYLE N’ÉTEINT PLUS LA RAMPE DU FOND ──────────────────────────── */
const deleteRule = 'if (out.backgroundGradient && !bgGradientOf(out.backgroundGradient).on) delete out.backgroundGradient;';
const readRule = deleteRule.replace(/out\./g, 'src.');
ok(VIEWER.includes(deleteRule), 'À L’ÉCRITURE : une rampe ÉTEINTE ne voyage pas dans un style (captureThemeGlobal)');
ok(VIEWER.includes(readRule), 'À LA LECTURE : un style DÉJÀ enregistré (ou d’un autre build) ne peut pas non plus l’éteindre');
/* Les deux règles sont bien DANS le corps de la bonne fonction (pas ailleurs dans
   le fichier), et celle de la lecture passe AVANT l’application du style. */
const bodyOf = (anchor) => {
  const start = VIEWER.indexOf(anchor);
  assert.ok(start >= 0, `ancre introuvable : ${anchor}`);
  const end = VIEWER.indexOf('\n};', start);
  return VIEWER.slice(start, end > start ? end : VIEWER.length);
};
ok(bodyOf('const captureThemeGlobal = (setup) => {').includes(deleteRule),
  '…la règle d’écriture est dans captureThemeGlobal elle-même');
const applyBody = bodyOf('const applyThemeGlobal = (global) => {');
ok(applyBody.includes(readRule), '…la règle de lecture est dans applyThemeGlobal elle-même');
ok(applyBody.indexOf(readRule) < applyBody.indexOf('return applyViewerSetup('),
  '…et le `delete` passe AVANT l’application du style (l’ordre compte)');
/* Les DEUX modes (thème cumulatif et photographie d’écran) traversent ce seul
   lecteur : le correctif vaut donc pour un fichier importé comme pour le rappel
   automatique d’une expérience — les deux chemins du défaut signalé. */
ok(VIEWER.includes('applyThemeGlobal(th.global);') && VIEWER.includes('applyThemeGlobal(sn.global);'),
  'les deux modes (thème cumulatif · snapshot) passent par le MÊME lecteur d’environnement');
/* La FONCTIONNALITÉ reste entière : une figure enregistrée AVEC sa rampe la
   ramène (c’est la demande d’origine : deux couleurs et leur direction). */
ok(VIEWER.includes("if (s.backgroundGradient && typeof s.backgroundGradient === 'object') setBgGradient(bgGradientOf(s.backgroundGradient));"),
  'une rampe PRÉSENTE dans un fichier / état de figure est toujours appliquée (rien n’est perdu)');

/* Et la règle, sur le VRAI validateur du module (pas sur une copie) : le tableau
   de vérité qui explique le défaut réparé. `bgGradientOf` normalise tout objet
   inconnu — ou RIEN — en une rampe ÉTEINTE (« Un objet inconnu (ou rien) donne le
   dégradé par défaut : éteint »), donc `on:false` et « le champ n'existe pas »
   sont indiscernables POUR LE LECTEUR : c'est exactement pourquoi le champ ne
   doit pas voyager quand il est éteint. */
const styleSnuffsTheRamp = (g) => !!(g && !bgGradientOf(g).on);   // ≡ `if (g && !bgGradientOf(g).on) delete …`
const styleCarriesTheRamp = (g) => !!(g && bgGradientOf(g).on);   // ≡ ce qu’applyViewerSetup applique
eq(styleSnuffsTheRamp({ on: false, to: '#ffffff', angle: 0 }), true,
  'on:false → le champ ÉTAIT retiré du style… c’est ce que la règle fait à l’écriture ET à la lecture');
eq(styleSnuffsTheRamp({ on: true, to: '#94a3b8' }), false, 'on:true → la rampe allumée voyage, elle n’est jamais retirée');
eq(styleSnuffsTheRamp(undefined), false,
  'aucun champ (fichier écrit avant cette fonctionnalité, ou style sans rampe) → rien à retirer');
eq(styleSnuffsTheRamp({ to: '#94a3b8' }), true,
  'un champ sans `on` (fichier ancien / bricolé) est bien « éteint » → il ne l’emporte pas non plus');
eq(styleCarriesTheRamp({ on: true, to: '#94a3b8' }), true, 'ce qui RESTE d’une rampe allumée est bien appliqué (la fonctionnalité vit)');
eq(styleCarriesTheRamp({ on: false, to: '#ffffff' }), false, 'une rampe éteinte n’est jamais appliquée');
eq([bgGradientOf(null).on, bgGradientOf({}).on, bgGradientOf({ to: '#94a3b8' }).on], [false, false, false],
  'le module valide « rien » comme « éteint » : c’est ce qui rendait les deux cas indiscernables (la cause racine)');
eq([bgGradientOf({ on: true }).on, bgGradientOf({ on: 1 }).on], [true, false],
  'seul `on:true` allume (le `1` d’un fichier bricolé ne compte pas)');

console.log(`${passed} passed`);

