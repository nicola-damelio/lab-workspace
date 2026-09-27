/* =========================================================================
   _load_progress_bar_test.mjs — LA BARRE DE CHARGEMENT DE LA BARRE DU HAUT, ET
   LE MESSAGE D'ARRÊT QU'ELLE REMPLACE.

   La demande de cette session, mot pour mot :

      « the stop (structure loading) message that appears when loading a
        structure is useless and should be removed. At its place it would be
        more useful a loading bar showing the progression that could be
        inserted in the top bar of the window. »

   CE QUI EST VÉRIFIÉ ICI :

     §1 LE MAGASIN (src/utils/loadProgress.js) EXÉCUTÉ, pas relu : « begin »
        ouvre la barre, « phase » dit ce qu'on fait, « step » donne des
        compteurs RÉELS (le pourcentage n'est rendu que quand le total est
        connu), « end » referme — y compris deux fois. Surtout : un rapporteur
        PÉRIMÉ (l'ancien chargement qui se termine après le nouveau) ne peut ni
        écrire dans l'entrée du nouveau, ni l'effacer ; un auditeur qui jette ne
        casse pas le magasin, et se désabonner désabonne vraiment.
     §2 LE CÂBLAGE DU VIEWER : le chargement d'une structure ET d'une trajectoire
        ouvrent la barre, la nourrissent de leurs étapes, et la referment sur
        CHACUN de leurs chemins de sortie (succès, erreur, annulation,
        démontage).
     §3 LE SHELL : le bouton d'arrêt permanent et son message
        « Stop (structure loading) » ont disparu de tout le dépôt ; la barre,
        elle, se tait quand rien ne tourne, et l'arrêt a migré SUR elle
        (abortControl), pour les opérations qui n'ont pas d'autre bouton.
     §4 LE RENDU RÉEL (Vite build SSR de _load_progress_probe.jsx, exécuté dans
        Node) : cinq états, dont « au repos → RIEN » et « 3 molécules sur 7 →
        43 % », mesurés sur le HTML produit — une consigne peut être écrite dans
        le JSX et ne rien dessiner, c'est le trou que comble ce probe.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu : ${JSON.stringify(a)}`);
  passed += 1;
};

/* Le magasin est importé par son CHEMIN (pas de résolveur ESM maison : il
   n'importe que react, donc le fichier reste lisible tel quel par Node). */
const { loadProgress, loadProgressPercent, useLoadProgress } = await import('./src/utils/loadProgress.js');

/* ══ §1. LE MAGASIN, EXÉCUTÉ ═════════════════════════════════════════════════ */

const empty = loadProgress.snapshot();
eq([empty.active, empty.label, empty.phase, empty.percent], [false, '', '', null],
  'au départ, aucune opération : la barre est muette');
ok(typeof useLoadProgress === 'function', 'le hook React du magasin est exporté (la barre s’y abonne)');

/* Le pourcentage n'est rendu QUE sur des nombres réels. */
eq(loadProgressPercent(3, 7), 43, '3 molécules sur 7 → 43 %');
eq(loadProgressPercent(0, 4), 0, 'aucune molécule faite → 0 %');
eq(loadProgressPercent(4, 4), 100, 'la dernière → 100 %');
eq(loadProgressPercent(5, 4), 100, 'un compteur qui dépasse le total ne dépasse pas 100 %');
eq(loadProgressPercent(-3, 4), 0, '…ni ne descend sous 0 %');
eq(loadProgressPercent('3', '7'), 43, 'des compteurs venus d’un formulaire (chaînes) sont acceptés');
eq([loadProgressPercent(3, 0), loadProgressPercent(3, -1), loadProgressPercent(3, null), loadProgressPercent(3, undefined)],
  [null, null, null, null],
  'un total inconnu → PAS de pourcentage (la barre pulse au lieu de mentir)');

const events = [];
const stopListening = loadProgress.subscribe(() => events.push(loadProgress.snapshot()));
const rep = loadProgress.begin('structure loading');
let snap = loadProgress.snapshot();
eq([snap.active, snap.label, snap.phase, snap.done, snap.total, snap.percent, events.length],
  [true, 'structure loading', '', null, null, null, 1],
  '« begin » ouvre la barre sous le nom de l’opération, et le dit à ses auditeurs');

rep.phase('Reading the file…');
snap = loadProgress.snapshot();
eq([snap.phase, snap.percent], ['Reading the file…', null],
  '« phase » dit ce qu’on fait — sans inventer de pourcentage');

rep.step(3, 7, 'Loading the molecules…');
snap = loadProgress.snapshot();
eq([snap.done, snap.total, snap.percent, snap.phase], [3, 7, 43, 'Loading the molecules…'],
  '« step » donne les compteurs réels ET leur pourcentage, et nomme l’étape');

rep.step(5, 7);
eq(loadProgress.snapshot().phase, 'Loading the molecules…',
  'sans texte, « step » ne change pas le nom de l’étape');

rep.phase('Reading the residues…');
eq([loadProgress.snapshot().done, loadProgress.snapshot().total, loadProgress.snapshot().percent],
  [null, null, null],
  'une étape SANS compteur oublie ceux de l’étape précédente : elle pulse au lieu d’afficher un pourcentage périmé');

/* Un auditeur qui jette ne doit pas casser le magasin. */
const noisy = loadProgress.subscribe(() => { throw new Error('auditeur cassé'); });
rep.step(6, 7);
eq(loadProgress.snapshot().done, 6, 'un auditeur qui jette ne bloque pas le magasin');
noisy();

/* Un rapporteur PÉRIMÉ : celui de l'ancien chargement, qui se termine après. */
const old = loadProgress.begin('structure loading');
const fresh = loadProgress.begin('trajectory loading');
old.phase('Reading the file…');
old.step(1, 2);
eq([loadProgress.snapshot().label, loadProgress.snapshot().done], ['trajectory loading', null],
  'un rapporteur périmé ne RÉÉCRIT pas la barre de l’opération en cours');
old.end();
eq(loadProgress.snapshot().active, true,
  '…et ne l’EFFACE pas non plus quand il se termine après elle');
fresh.end();
eq(loadProgress.snapshot().active, false, 'le rapporteur en cours, lui, referme la barre');

const before = events.length;
fresh.end();
eq(events.length, before, '« end » est idempotent : rien à refermer, rien à annoncer');

/* Les paliers restent dans les bornes, et l'abonnement se défait vraiment. */
const bounded = loadProgress.begin('structure loading');
bounded.step(2, 3, 'Loading the molecules…');
eq(loadProgress.snapshot().percent, 67, '2 sur 3 → 67 %');
stopListening();
const afterUnsubscribe = events.length;
bounded.step(3, 3);
eq(events.length, afterUnsubscribe, 'après désabonnement, plus aucun événement');
loadProgress.clear();
eq(loadProgress.snapshot().active, false, '« clear » oublie l’opération (plus rien ne tourne)');

/* ══ §2. LE CÂBLAGE DU VIEWER ════════════════════════════════════════════════ */

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

has("import { loadProgress } from '../utils/loadProgress';",
  'le viewer importe le magasin de progression');

has("const loadRep = loadProgress.begin('structure loading');",
  'charger une STRUCTURE ouvre la barre');
has("loadRep.phase('Reading the file…');",
  '…d’abord la lecture du fichier (rien à compter)');
has("loadRep.phase('Preparing the structure…');",
  '…puis la préparation de la structure (liaisons, catégories)');
has("loadRep.phase('Building the representations…');",
  '…puis la construction des représentations');
has("loadRep.step(ci + 1, moleculeParts.length, 'Loading the molecules…');",
  '…et les molécules d’un complexe, qui SONT comptables (i sur N)');
has("loadRep.phase('Reading the residues…');",
  '…enfin la lecture des résidus (la bande de séquence)');

has("const loadRep = loadProgress.begin('trajectory loading');",
  'charger une TRAJECTOIRE ouvre la même barre');
has("loadRep.step(done, totalFrames, 'Reading the trajectory…');",
  '…et les images réellement décodées d’un XTC y passent (image i sur N)');

eq((VIEW.match(/loadRep\.end\(\)/g) || []).length, 4,
  'la barre est refermée sur les QUATRE chemins de sortie (succès, erreur, annulation, démontage)');
ok(!VIEW.includes('red "Stop (structure loading)"'),
  'le viewer ne parle plus d’un message d’arrêt rouge (il n’existe plus)');

/* ══ §3. LE SHELL : LE MESSAGE D'ARRÊT REMPLACÉ PAR LA BARRE ═════════════════ */

const SHELL = readFileSync(new URL('./src/components/TestShellRenderer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hasShell = (needle, what) => ok(SHELL.includes(needle), `${what}\n  introuvable : ${needle}`);

hasShell("import { useLoadProgress } from '../utils/loadProgress';",
  'le shell lit la progression partagée');
hasShell('export const GlobalLoadProgress = () => {',
  'la barre du haut est son propre composant (testable au rendu)');
hasShell("const running = prog.active ? prog.label : (active ? label : '');",
  'deux sources : la progression rapportée, sinon le registre d’arrêt');
hasShell('if (!running) return null;   // idle page → nothing at all on screen',
  'AU REPOS, RIEN : le message d’arrêt permanent a bien disparu');
hasShell('role="progressbar"',
  'la barre se déclare comme barre de progression (lecteurs d’écran)');
hasShell('style={{ width: `${percent}%` }}',
  'sa largeur EST la progression rapportée');
hasShell('className="h-full w-1/3 bg-red-500 animate-pulse"',
  'sans compteurs, le remplissage pulse au lieu d’une largeur fausse');
hasShell('onClick={() => abortControl.abortAll()}',
  'l’arrêt a migré SUR la barre (mêmes opérations arrêtables qu’avant)');
hasShell('<GlobalLoadProgress />',
  'le shell la rend en tête de page');
ok(!SHELL.includes('GlobalStopButton'),
  'le bouton d’arrêt permanent, avec son message « Stop (…) », n’existe plus');
ok(!SHELL.includes('Stop (${label})'),
  '…et son texte non plus');
ok(!SHELL.includes('fixed top-2 right-2'),
  '…ni sa pastille figée en haut à droite de chaque page');

/* Aucune autre page ne peut avoir gardé le bouton : on balaie tout src/. */
const srcFiles = (() => {
  const all = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(jsx|js)$/.test(e.name)) all.push(rel);
    }
  };
  walk('./src');
  return all;
})();
const survivors = srcFiles.filter((f) => readFileSync(new URL(f, import.meta.url), 'utf8').includes('GlobalStopButton'));
eq(survivors, [], 'l’ancien bouton d’arrêt permanent ne survit nulle part dans src/');
ok(srcFiles.length > 100, `le balayage a bien vu les sources (fichiers examinés : ${srcFiles.length})`);

/* ══ §4. LE RENDU RÉEL ══════════════════════════════════════════════════════ */

const ENTRY = '_load_progress_probe.jsx';
const OUT_DIR = '_render_progress';
await build({ logLevel: 'error', build: { ssr: ENTRY, outDir: OUT_DIR, emptyOutDir: true, minify: false } });
const built = `${OUT_DIR}/${ENTRY.replace(/\.jsx$/, '.js')}`;
ok(existsSync(built), `${built} doit être construit (sinon rien n’est rendu)`);

let probeOut = '';
let probeExit = 0;
try {
  probeOut = execFileSync(process.execPath, [built], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  probeExit = e.status === undefined ? -1 : e.status;
  probeOut = `${e.stdout || ''}\n${e.stderr || ''}`;
}
const rows = probeOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const rowOf = (state) => rows.find((l) => l.startsWith(`${state} |`)) || '';
eq(rows.length, 6, `le probe rend CINQ états et sa ligne finale\n${rows.join('\n')}`);
ok(probeOut.includes('PROGRESS PROBE OK'),
  `le probe doit finir sur PROGRESS PROBE OK (exit=${probeExit})\n${rows.slice(-4).join('\n')}`);

eq(rowOf('idle'), 'idle | (nothing)',
  'la page au repos ne dessine RIEN — c’est le message d’arrêt permanent qui disparaît');
eq(rowOf('idle-again'), 'idle-again | (nothing)',
  'et elle redevient muette dès que l’opération est terminée');

const counted = rowOf('counted');
ok(counted.includes('Loading the molecules…'), `la barre nomme l’étape en cours\n${counted}`);
ok(/43\s*%/.test(counted), `3 molécules sur 7 se lisent « 43 % »\n${counted}`);
ok(counted.includes('width:43%'), `…et remplissent la barre à 43 %\n${counted}`);
ok(counted.includes('aria-valuenow="43"'), `…pour les lecteurs d’écran aussi\n${counted}`);
ok(!counted.includes('animate-pulse'), 'un pourcentage connu ne fait pas pulser la barre');

const unknown = rowOf('unknown');
ok(unknown.includes('Reading the file…'), `sans compteur, la barre dit ce qu’elle fait\n${unknown}`);
ok(unknown.includes('animate-pulse'), `…et pulse\n${unknown}`);
ok(!/\d+\s*%/.test(unknown), `aucun pourcentage n’est inventé\n${unknown}`);
ok(unknown.includes('aria-label="structure loading — in progress"'),
  `l’état sans compteur est dit tel quel\n${unknown}`);

const registryOnly = rowOf('registry-only');
ok(registryOnly.includes('Calculate all analyses'),
  `une opération sans progression s’annonce quand même (elle reste arrêtable)\n${registryOnly}`);
ok(registryOnly.includes('animate-pulse'), `…en pulsant, faute de compteurs\n${registryOnly}`);

console.log(`_load_progress_bar_test.mjs — ${passed} assertions OK`);





