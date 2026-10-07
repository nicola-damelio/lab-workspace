/* =========================================================================
   _viewer_film_poses_test.mjs — UNE POSE PORTE AUSSI CE QUE LA BARRE DESSINE, ET LE
   ZOOM EST CELUI DE NGL.

   LA DEMANDE DE CETTE SESSION, mot pour mot :
     · « the movie maker now captures surfaces but it does not manage transitions in
       style ? For example if pose 1 has a surface and pose 2 is ball and stick, the
       movie always shows the style of the first pose also for the second pose. »
       → une pose ne photographiait que l'ENVIRONNEMENT (les six menus de §2, les
       palettes, les rayons, la caméra) : les STYLES DE LA BARRE — un arbre de réglages
       PAR SECTION (« protein · chain A » : style, Color by, rayons, transparence,
       matériau) et le ✔ de chaque espace — n'en faisaient pas partie. Un film reposait
       donc les MÊMES styles du début à la fin, quelle que soit la pose. Ils voyagent
       maintenant avec elle (captureSectionLooksForPose → poseStylesForSections, étape 5
       du lecteur de photographie) ;
     · « Moreover, it does not manage zoom. if pose 2 is zoomed respect to pose 1, the
       zoom remains the same in the movie. »
       → le zoom de NGL n'est PAS `camera.zoom` (le champ de la caméra ORTHOGRAPHIQUE,
       figé à 1 sur une caméra en perspective) mais `viewer.cameraDistance`, écrit par
       `ViewerControls#distance` — le geste de la molette. La pose lit et repose
       maintenant CETTE valeur (sceneZoomDistance), et un morphème la fait GLISSER ;
     · « The saved movie always has a black background … » et « an ellipse that is not
       part of the movie »
       → le fond de la figure est peint dans la toile de film avant la scène
       (filmBackdropColor), vérifié dans _viewer_film_match_test.mjs.

   CE QUI EST VÉRIFIÉ ICI :
   1. `poseStylesForSections` — la règle pure qui retrouve les sections d'une pose (par
      ID d'abord, puis par CLÉ LOCALE), EXÉCUTÉE sur des scènes inventées ;
   2. `mixCamera` — la caméra glisse au lieu de couper au milieu du morphème, et un
      champ qu'une seule pose porte n'est jamais inventé ;
   3. LE MAGASIN D'UNE POSE — `slimKeyframeState` / le .json exporté emportent les
      styles (un film de poses rouvert ailleurs les retrouve) ;
   4. LE CÂBLAGE DU VIEWER — la capture, le lecteur et le zoom de NGL (lus dans la
      source).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  poseStylesForSections, mixCamera, mixValue, mixState, slimKeyframeState,
  KEYFRAME_STATE_DROP, normalizeKeyframeFilm, serialiseKeyframeFilm, parseKeyframeFilm,
} from './src/utils/viewerKeyframes.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
const near = (a, b, what, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `${what} (${a} ≠ ${b})`);
  passed += 1;
};
/* La source est RAMENÉE À LF : sur Windows le fichier est extrait en CRLF et les
   aiguilles multi-lignes d'ici sont écrites avec des LF (la convention du dépôt). */
const VIEW = readFileSync('./src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (needle, what) => {
  assert.ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

/* ── 2. LA CAMÉRA GLISSE, ELLE NE COUPE PAS ──────────────────────────────── */
{
  const spin = (85 * Math.PI) / 180;
  const A = { q: [0, 0, 0, 1], p: [0, 0, 0], zoom: 1, dist: 120 };
  const B = { q: [0, 0, Math.sin(spin), Math.cos(spin)], p: [30, -12, 6], zoom: 1, dist: 30 };
  const mid = mixValue('camera', A, B, 0.5);
  near(mid.dist, 75, 'la DISTANCE de la caméra glisse (c’est le zoom de NGL)');
  near(mid.p[1], -6, 'le déplacement glisse');
  near(mid.q[2], Math.sin(spin / 2), 'la rotation est SLERPÉE (le chemin court), pas moyennée', 1e-3);
  near(mixValue('camera', A, B, 0.25).dist, 97.5, '…dès le premier quart du morphème (aucun saut au milieu)');
  ok(mixValue('camera', A, B, 0.25) !== A, 'le point de vue d’une pose n’est jamais rendu tel quel au milieu du film');
  const state = mixState({ camera: A }, { camera: B }, 0.5);
  near(state.camera.dist, 75, 'et c’est bien la clé « camera » d’une photographie qui passe par cette règle');
  eq(mixCamera({ q: [0, 0, 0, 1], dist: 50 }, { p: [1, 2, 3] }, 0.5).dist, 50,
    'un champ qu’une seule pose porte est repris tel quel (jamais inventé)');
}

/* ── 3. LE MAGASIN D'UNE POSE EMPORTE LES STYLES ─────────────────────────── */
{
  ok(!KEYFRAME_STATE_DROP.includes('sectionLooks'), 'slimKeyframeState ne laisse pas tomber les styles de la barre');
  ok(!KEYFRAME_STATE_DROP.includes('sectionVis'), '…ni le ✔ des espaces');
  const slim = slimKeyframeState({
    catStyles: { protein: {} },
    sectionLooks: { 'main::protein|A': { protein: { general: 'surface' } } },
    sectionVis: { 'main::protein|A': true },
    pymol: { script: 'hide all' },
    savedAt: '2026-01-01T00:00:00.000Z',
  });
  eq(slim.sectionLooks['main::protein|A'].protein.general, 'surface', 'la pose GARDE les styles de la barre');
  eq(slim.sectionVis['main::protein|A'], true, '…et son ✔');
  eq(slim.pymol, undefined, 'la session 🧪 reste la seule chose écartée d’une pose (comme avant)');
  const film = normalizeKeyframeFilm({
    keys: [{
      name: 'Pose 1',
      state: { sectionLooks: { 'main::protein|A': { protein: { general: 'ball+stick' } } }, sectionVis: {} },
    }],
  });
  eq(film.keys[0].state.sectionLooks['main::protein|A'].protein.general, 'ball+stick',
    'un film de poses emporte ses styles (le .json exporté les contient)');
  const round = parseKeyframeFilm(serialiseKeyframeFilm(film));
  eq(round.keys[0].state.sectionVis, {}, '…et ils reviennent tels quels d’un fichier écrit ailleurs');
}

/* ── 1. LA RÈGLE : LES STYLES D'UNE POSE, RETROUVÉS DANS LA SCÈNE PRÉSENTE ── */
{
  const SECTIONS = [
    { id: 'main::protein|A', key: 'protein|A', kind: 'protein' },
    { id: 'mol_7::ligand|LIG', key: 'ligand|LIG', kind: 'ligand' },
  ];
  /* PAR L'ID (le cas d'un film joué sur la scène qui l'a enregistré). */
  const byId = poseStylesForSections(
    { 'main::protein|A': { protein: { general: 'surface', surfaceOpacity: 0.4 } } },
    { 'main::protein|A': false, 'mol_7::ligand|LIG': true },
    SECTIONS,
  );
  eq(byId.looks['main::protein|A'].protein.general, 'surface', 'un arbre de section est retrouvé par son ID');
  eq(byId.vis, { 'main::protein|A': false, 'mol_7::ligand|LIG': true }, '…et les ✔ des espaces');
  ok(byId.looks['mol_7::ligand|LIG'] === undefined,
    'une section que la pose ne connaît pas n’est PAS inventée (elle garde son look)');
  /* PAR LA CLÉ LOCALE — un fichier rechargé garde les ids de sa molécule principale et
     en donne de NEUFS à ses molécules ajoutées : la clé « ligand|LIG » est alors le
     seul fil qui relie la pose à la molécule. C'est la règle des snapshots. */
  const byKey = poseStylesForSections({ 'ligand|LIG': { ligand: { general: 'ball+stick' } } }, null, SECTIONS);
  eq(byKey.looks['mol_7::ligand|LIG'].ligand.general, 'ball+stick',
    '…et par sa CLÉ LOCALE quand le fichier a été rechargé (ids neufs)');
  eq(byKey.vis, null, 'aucun ✔ dans la pose : ce côté n’est pas reposé du tout');
  /* CE QUI N'EST PAS UN ARBRE / UN DRAPEAU EST REFUSÉ : une pose bricolée à la main ne
     peut pas vider la scène de ses styles. */
  eq(poseStylesForSections({ 'main::protein|A': 'surface' }, { 'main::protein|A': 'yes' }, SECTIONS), null,
    'une pose dont les styles ne sont ni des arbres ni des drapeaux n’applique RIEN');
  eq(poseStylesForSections(null, null, SECTIONS), null,
    'une pose enregistrée avant cette session (sans styles) ne touche à rien');
  eq(poseStylesForSections({ 'autre|X': {} }, {}, SECTIONS), null,
    'une pose qui ne reconnaît AUCUNE section de la scène n’applique rien non plus');
  eq(poseStylesForSections({ 'main::protein|A': {} }, {}, []), null, 'une scène sans section non plus');
}

/* ── 4. LE CÂBLAGE DU VIEWER ─────────────────────────────────────────────── */
{
  /* LA CAPTURE : l'arbre EFFECTIF de chaque section (kindLooks compris, sinon une
     section jamais touchée ne pourrait pas être remise sur son défaut) et son ✔. */
  has('sectionLooks: captureSectionLooksForPose(),', 'une photographie de scène porte les styles de la barre');
  has('sectionVis: captureSectionVisForPose(),', '…et le ✔ de chaque espace');
  has('const captureSectionLooksForPose = () => {', 'la capture existe et parcourt les sections de la scène');
  has('out[sec.id] = cloneSectionTree(sectionTreeOf(sec.id, sec.kind));',
    'elle prend l’arbre EFFECTIF (kindLooks compris) et le CLONE : aucune pose ne partage un objet avec la scène');
  has('out[sec.id] = sectionVisible(sec.id, sec.kind);', 'le ✔ enregistré est celui qui est À L’ÉCRAN');
  has('const sceneSectionsFlat = () => {', 'les sections de la scène ont UNE énumération, celle de la barre');
  /* LE LECTEUR : la même règle pour les trois magasins (une pose de film, un setup
     nommé, un snapshot), et AUCUNE réécriture quand rien n'a changé. */
  has('const poseStyles = poseStylesForSections(s.sectionLooks, s.sectionVis, sceneSectionsFlat());',
    'le lecteur retrouve les sections de la scène que la pose connaît');
  has('if (poseStyles.looks) setSectionLooks((prev) => ({ ...prev, ...poseStyles.looks }));',
    '…repose les arbres, FUSIONNÉS sur ce que la barre porte (une section inconnue de la pose garde son look)');
  has('if (poseStyles.vis) setSectionVis((prev) => ({ ...prev, ...poseStyles.vis }));', '…et les ✔');
  has('if (poseSig !== poseStyleSigRef.current) {',
    'une image qui repose le MÊME style n’écrit rien (un film ne re-rend pas la barre 30 fois par seconde)');
  has("const poseStyleSigRef = useRef('');", 'cette mémoire a son propre drapeau');
  has("  poseStyleSigRef.current = '';", 'un geste de la barre la périme (le réglage à la main n’est pas pris pour une pose)');
  /* LE ZOOM : lu et écrit LÀ OÙ NGL LE TIENT — `ViewerControls#cameraDistance`. */
  gone('const v = stageRef.current && stageRef.current.viewer;\n    if (!v) return null;\n    const q =',
    'l’ancienne lecture du point de vue (qui ne lisait que la rotation, la translation et un `camera.zoom` figé) a disparu');
  has('const sceneZoomDistance = (stage) => {', 'le zoom de la scène est lu par sa propre fonction');
  has('? controls.getCameraDistance()', '…par les contrôles de NGL (le geste de la molette)');
  has('const dist = sceneZoomDistance(stage);', 'la pose photographie cette distance');
  has('return { q, p, dist, zoom };', '…à côté de la rotation, du déplacement et de l’ancien champ `zoom`');
  has("if (controls && typeof controls.distance === 'function') controls.distance(dist);",
    'la reposer passe par le MÊME geste (distance → cameraDistance + updateZoom)');
  has('v.cameraDistance = dist;', '…et un NGL sans ViewerControls écrit la même valeur à la main');
  has("if (typeof v.updateZoom === 'function') v.updateZoom();", 'sans oublier la projection');
  has("} else if (Number.isFinite(pose.zoom) && v.camera) v.camera.zoom = pose.zoom;",
    'l’ancien champ `zoom` ne sert plus que de SECOURS (une caméra orthographique, un fichier d’avant) — il ne pilotait rien : il vaut 1 en perspective');
  /* LE RETOUR DE LA SCÈNE : le film rend la scène comme il l'a trouvée — les styles de
     la barre compris, puisqu'ils font maintenant partie de la photographie. */
  has('const back = { state: captureViewerSetup(), pose: captureKeyframePoses() };',
    'l’enregistrement d’un film prend la photo d’AVANT (styles de la barre compris)');
  has('applyKeyframeSample(back, false);', '…et la repose à la fin (et `false` dit que ce retour n’est pas un MOUVEMENT : aucun fondu n’est ouvert par lui)');

}

console.log(`_viewer_film_poses_test.mjs — ${passed} assertions OK (styles de la barre dans une pose · zoom de NGL photographié · caméra qui glisse · câblage)`);
