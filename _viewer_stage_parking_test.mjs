/* =========================================================================
   _viewer_stage_parking_test.mjs — ⏸ LA VUE DORT QUAND PERSONNE NE LA REGARDE.

   LE RAPPORT DE CETTE SESSION : « the gradient does not work and the program is
   slow even if it does not have processes to do. »

   POURQUOI CE FICHIER EXISTE. La lenteur est MESURÉE, pas supposée : la sonde du
   navigateur (_viewer_bg_live_test.cjs) a montré qu'un viewer monté, au repos,
   ne demande RIEN (0 `requestRender`, 0 mutation du DOM, 0 tâche longue) — et
   que la page ne dort pourtant jamais, parce que NGL 2.4 relance indéfiniment
   DEUX boucles `requestAnimationFrame` (`Viewer.animate`, dont la dernière ligne
   est le `requestAnimationFrame(this.animate)` qui la ressuscite —
   `_ngl_src/viewer__viewer.ts:1015` — et `MouseControls`/`MouseObserver._listen`).
   Avec le « page parking » d'App.jsx, une page QUITTÉE reste montée
   (`display: none`) : son étage continue donc de tourner pour personne.

   CE QUE CE FICHIER VÉRIFIE, sans navigateur :
     1. LA RÈGLE, exécutée (utils/nglStageParking.js) : onglet caché, vue repliée,
        boîte hors de l'écran — chacune parque, et rien d'autre ;
     2. LES DEUX GESTES sur des ÉTAGES FACTICES (aucun NGL ici) : `parkNglStage`
        annule les deux images en attente par `cancelAnimationFrame` — le geste
        que NGL fait lui-même dans ses `dispose()` — et remet `frameRequest` à
        `null` ; `wakeNglStage` repart par les entrées d'NGL (`animate()`,
        `requestRender()`, `_listen()`), et JAMAIS deux fois la même boucle ;
     3. LE CÂBLAGE du viewer (lu dans la source) : les trois déclencheurs, et le
        fait que la mise en veille vit APRÈS la déclaration de `status`.
   Les mesures du NAVIGATEUR (0 image demandée vue cachée, contre ≈300 par 2,5 s
   sans la mise en veille) sont dans _viewer_bg_live_test.cjs — elles, elles ne
   se devinent pas.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAGE_PARKING_REASONS, nglStageParkingDecision, stageLoopsOf, stageLoopState,
  parkNglStage, wakeNglStage,
} from './src/utils/nglStageParking.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ══ 1. LA RÈGLE — exécutée, et seulement elle ════════════════════════════ */
eq(STAGE_PARKING_REASONS, ['onglet caché', 'vue repliée', 'hors écran'],
  'les trois raisons sont NOMMÉES (le relevé les cite, jamais un booléen muet)');
eq(nglStageParkingDecision({}), { park: false, why: '' },
  'une vue visible, dans un onglet au premier plan : on ne parque pas');
eq(nglStageParkingDecision({ onScreen: false }).why, 'hors écran',
  'une boîte qui n’est plus à l’écran parque la vue — c’est le témoin d’une page PARQUÉE (display: none)');
eq(nglStageParkingDecision({ collapsed: true }).why, 'vue repliée',
  'une vue repliée par l’utilisateur parque aussi (0 px de haut : rien à peindre)');
eq(nglStageParkingDecision({ tabHidden: true }).why, 'onglet caché',
  'un onglet au second plan parque aussi');
eq(nglStageParkingDecision({ tabHidden: true, collapsed: true, onScreen: false }).why, 'onglet caché',
  'les raisons se lisent dans l’ORDRE : la première vraie gagne (le relevé est stable)');
ok(nglStageParkingDecision({ onScreen: false }).park === true
  && nglStageParkingDecision({}).park === false,
  'la décision dit AUSSI le geste (`park`), pas seulement la raison');

/* ══ 2. LES DEUX GESTES, SUR DES ÉTAGES FACTICES ══════════════════════════
   Aucun NGL ici : ce sont les PRISES qu'on vérifie — `frameRequest` sur le
   viewer et sur l'observateur de souris, les deux noms qu'NGL annule lui-même
   dans ses `dispose()`. Un `cancelAnimationFrame` FACTICE enregistre les
   identifiants réellement annulés : sans le navigateur, le geste reste mesuré. */
const cancelled = [];
const rafCalls = [];
const realCancel = globalThis.cancelAnimationFrame;
const realRaf = globalThis.requestAnimationFrame;
globalThis.cancelAnimationFrame = (id) => { cancelled.push(id); };
globalThis.requestAnimationFrame = (cb) => { rafCalls.push(cb); return rafCalls.length; };

const fakeStage = (state = {}) => {
  const st = { viewer: { frameRequest: undefined, renders: 0, renderPending: false }, mouseObserver: { frameRequest: undefined, listens: 0 } };
  st.viewer.animate = () => { st.viewer.frameRequest = globalThis.requestAnimationFrame(() => {}); return 'animate'; };
  /* `requestRender` est fidèle à NGL 2.4 : il compte l'appel, et n'arme qu'UNE
     image tant que la précédente est en attente (`this.renderPending || …`). */
  st.viewer.requestRender = () => {
    st.viewer.renders += 1;
    if (st.viewer.renderPending) return 'pending';
    st.viewer.renderPending = true;
    globalThis.requestAnimationFrame(() => { st.viewer.renderPending = false; });
    return 'image';
  };
  st.mouseObserver._listen = () => { st.mouseObserver.frameRequest = globalThis.requestAnimationFrame(() => {}); return 'listen'; };
  Object.assign(st.viewer, state.viewer || {});
  Object.assign(st.mouseObserver, state.observer || {});
  return st;
};

eq(stageLoopsOf(fakeStage()).map((l) => l.loop), ['rendu', 'survol'],
  'un étage a DEUX boucles connues : le rendu (le viewer) et le survol (l’observateur de souris)');
eq(stageLoopsOf(null), [
  { loop: 'rendu', owner: null, id: null, restart: 'animate' },
  { loop: 'survol', owner: null, id: null, restart: 'listen' },
], 'sans étage, aucune boucle n’existe — et rien ne jette');
eq(stageLoopState(fakeStage({ viewer: { frameRequest: 7 }, observer: { frameRequest: 9 } })), { rendu: true, survol: true },
  'l’état d’un étage en marche : deux boucles');
eq(stageLoopState(fakeStage()), { rendu: false, survol: false }, 'au repos avant tout geste : aucune');

/* ⏸ ARRÊTER */
cancelled.length = 0;
const running = fakeStage({ viewer: { frameRequest: 12 }, observer: { frameRequest: 34 } });
eq(parkNglStage(running), ['rendu', 'survol'],
  'la mise en veille annonce CE QU’ELLE A ARRÊTÉ (les deux boucles qui tournaient)');
eq(cancelled, [12, 34], '…en annulant les DEUX images en attente, par `cancelAnimationFrame`');
eq([running.viewer.frameRequest, running.mouseObserver.frameRequest], [null, null],
  '…et en remettant `frameRequest` à `null` : c’est ce qui dit « endormi »');
eq(parkNglStage(running), [], 'la seconde mise en veille ne fait RIEN (aucune boucle à arrêter)');
eq(cancelled, [12, 34], '…donc aucun `cancelAnimationFrame` de plus');

/* ▶ RÉVEILLER */
rafCalls.length = 0;
const slept = fakeStage({ viewer: { frameRequest: null }, observer: { frameRequest: null } });
const woken = wakeNglStage(slept);
eq(woken, ['rendu', 'image', 'survol'],
  'le réveil repart par les TROIS entrées d’NGL : la boucle de rendu, l’image tout de suite, le survol');
ok(Number.isFinite(slept.viewer.frameRequest) && Number.isFinite(slept.mouseObserver.frameRequest),
  '…et les deux boucles sont bien relancées (un `frameRequest` neuf sur chacune)');
eq(slept.viewer.renders, 1, '…avec UNE image demandée (la vue ne montre pas l’image d’avant le sommeil)');
const before = rafCalls.length;
wakeNglStage(slept);
eq(rafCalls.length - before, 0,
  '⚠ un étage DÉJÀ réveillé ne démarre AUCUNE seconde boucle (la boucle de rendu tourne, l’image est déjà en attente)');
eq(wakeNglStage(null), [], 'réveiller un étage absent ne jette pas');
eq(parkNglStage(null), [], '…et parquer non plus');

/* Le geste n'existe pas sans navigateur : on rend les globales et on le dit. */
globalThis.cancelAnimationFrame = undefined;
eq(parkNglStage(fakeStage({ viewer: { frameRequest: 1 } })), [],
  'sans `cancelAnimationFrame`, la mise en veille ne prétend rien avoir arrêté');
globalThis.cancelAnimationFrame = realCancel;
globalThis.requestAnimationFrame = realRaf;

/* ══ 3. LE CÂBLAGE DU VIEWER — lu dans la source ══════════════════════════ */
has("import { nglStageParkingDecision, parkNglStage, wakeNglStage } from '../utils/nglStageParking';",
  'le viewer importe LE module de mise en veille (aucune règle recopiée)');
has('if (want) parkNglStage(stage); else wakeNglStage(stage);',
  '…et il n’y a qu’UNE écriture : parquer ou réveiller, jamais autre chose');
has("document.addEventListener('visibilitychange', onVisibility);",
  'déclencheur 1 : l’onglet qui passe au second plan');
has("io.observe(host);", 'déclencheur 2 : la boîte du viewer (une page parquée est en display:none)');
has('collapsed: viewerCollapsed, onScreen,',
  'déclencheur 3 : la vue repliée par l’utilisateur — et la boîte à l’écran, lus par la règle PURE');
has('if (io) io.disconnect();', '…l’observateur est débranché au démontage');
has("applyParking('');", '⚠ et l’étage est RÉVEILLÉ en sortant (sinon la vue suivante serait muette)');
ok(VIEW.indexOf("import { nglStageParkingDecision, parkNglStage, wakeNglStage }") < VIEW.indexOf('const [status, setStatus]'),
  'l’import est en tête de fichier');
ok(VIEW.indexOf('if (status !== \'ready\') return undefined;') > VIEW.indexOf('const [status, setStatus] = useState(\'idle\');'),
  '⚠⚠ l’EFFET vit APRÈS la déclaration de `status` : son tableau de dépendances est lu pendant le rendu — avant, il lève « Cannot access \'status\' before initialization » (mesuré)');
has("}, [status, viewerCollapsed]);",
  'il ne se refait que sur les deux entrées qui changent la réponse');

/* Le relevé du navigateur, tel que le test de la sonde le cite. */
const PROBE = readFileSync(new URL('./_viewer_bg_live_probe.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ok(PROBE.includes("container.style.display = 'none';"),
  'la sonde du navigateur cache VRAIMENT la vue (le geste du page parking), au lieu de le décrire');
ok(PROBE.includes('PERF.reqs += 1') && PROBE.includes('PERF.clears += 1'),
  '…et elle compte les demandes d’image ET les images peintes (les deux témoins du repos)');

console.log(`_viewer_stage_parking_test.mjs — ${passed} assertions OK (⏸ la mise en veille : la règle exécutée, les deux gestes mesurés sans navigateur, et le câblage du viewer)`);

