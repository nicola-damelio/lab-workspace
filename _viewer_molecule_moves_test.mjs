/* =========================================================================
   _viewer_molecule_moves_test.mjs — 🖱 DÉPLACER UNE MOLÉCULE DANS UNE STRUCTURE.

   LA QUESTION DE CETTE SESSION : « in case where more molecules are present in one
   pdb, why don't you split the pdb so that you have more separated molecule and I can
   do the move independent or the fit independent? »

   La découpe a été essayée AVANT et elle dessinait tout DEUX FOIS (« I do not
   understand what you did to move the molecules now I have twice as much of
   molecules. ») ; pour un ensemble multi-MODEL, les molécules SONT les images de la
   trajectoire, donc des composantes séparées perdraient le curseur de frames. Ce qui
   est mesuré ici est la réponse retenue : un DÉPLACEMENT RIGIDE PAR MOLÉCULE, appliqué
   aux atomes de la structure, qui peut être REJOUÉ à l'identique (autre image de
   trajectoire, ↺, pose de film).
     §1 LES MATHS (src/utils/viewerMoleculeMoves) : les quaternions, le barycentre, la
        clé d'une molécule — purs, sans NGL ni React ;
     §2 LE MOUVEMENT : tourner autour de SON centre ne fait pas dériver la molécule,
        glisser ne déforme rien, deux crans de rotation s'additionnent, et
        partPositionsInto rejoue le tout depuis les coordonnées d'origine ;
     §3 LES POSES : ce qu'un film garde, ce qui se mélange, ce qui vaut l'identité ;
     §4 LE BRANCHEMENT dans le viewer : la molécule piquée, NGL qui mesure le geste,
        `updateRepresentations({ position: true })`, le ↺, le changement d'image.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  PART_ROTATE_PER_PIXEL, partKeyOf, quatIdentity, quatMul, quatFromAxisAngle,
  rotateVectorByQuat, centroidOf, partMoveIdentity, rotatePartMove, slidePartMove,
  isIdentityMove, partPositionsInto, partPosePartOf, partMoveFromPose, partPosesOf,
} from './src/utils/viewerMoleculeMoves.js';
import {
  keyframePoseOf, mixPose, mixPoseParts, normalizePoseParts, serialiseKeyframeFilm,
  parseKeyframeFilm,
} from './src/utils/viewerKeyframes.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
/* ⚠ 1e-6 par défaut : les positions d'une molécule sortent en Float32 (c'est la
   précision que NGL garde et dessine), donc « le centre n'a pas bougé » se dit à la
   précision du dessin près. Les quaternions, eux, sont en Float64 : les comparaisons
   d'orientation passent explicitement 1e-9. */
const near = (a, b, what, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a}`);
  passed += 1;
};
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
/* ⚠ `gone` — ce qui a été RETIRÉ doit le rester : la pastille du geste de
   placement a disparu cette session (voir plus bas), et un retour silencieux
   d'un bouton retiré est une régression qu'un `has` ne peut pas voir. */
const gone = (needle, what) => {
  assert.ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

/* ── 1. LES MATHS ─────────────────────────────────────────────────────────── */
{
  eq(quatIdentity(), [0, 0, 0, 1], 'l’orientation neutre est un quaternion, comme ceux des poses');
  near(PART_ROTATE_PER_PIXEL, 0.02,
    'le pas de rotation est CELUI DE NGL (rotateSpeed 2,0 × 0,01) : le geste d’une molécule tourne au rythme de celui d’une composante');
  const half = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
  near(half[3], Math.cos(Math.PI / 4), 'un axe unitaire donne le quaternion attendu (partie réelle)');
  near(half[2], Math.sin(Math.PI / 4), '…et sa partie vectorielle');
  eq(quatFromAxisAngle([0, 0, 0], 1), null, 'une direction NULLE ne tourne rien : l’appelant garde son geste NGL');
  eq(quatFromAxisAngle([0, 0, 1], 'x'), null, 'un angle qui n’est pas un nombre non plus');
  const q = quatMul(quatFromAxisAngle([0, 0, 1], 0.3), quatFromAxisAngle([1, 0, 0], 0.7));
  const r = rotateVectorByQuat(q, [1, 0, 0]);
  near(Math.hypot(r[0], r[1], r[2]), 1, 'une rotation ne change pas la longueur d’un vecteur');
  eq(rotateVectorByQuat(quatIdentity(), [2, -3, 4]), [2, -3, 4], 'l’orientation neutre laisse un point où il est');
  eq(rotateVectorByQuat(null, [2, -3, 4]), [2, -3, 4], 'un quaternion illisible aussi (aucun NaN ne sort d’ici)');
  // Un quart de tour autour de Z : x → y.
  const quarter = rotateVectorByQuat(quatFromAxisAngle([0, 0, 1], Math.PI / 2), [1, 0, 0]);
  near(quarter[0], 0, 'un quart de tour autour de Z amène x sur y', 1e-9);
  near(quarter[1], 1, '…doucement : la rotation est bien de 90°, pas de 270°', 1e-9);
  eq(centroidOf([0, 0, 0, 2, 4, 6]), [1, 2, 3], 'le barycentre est la moyenne des coordonnées');
  eq(centroidOf([]), [0, 0, 0], 'aucun atome : un centre neutre, jamais NaN');
}

/* ── 2. LA CLÉ D'UNE MOLÉCULE ─────────────────────────────────────────────── */
{
  const lig = { chain: 'A', model: 0, resnoMin: 601, resnoMax: 601, resnames: ['LIG'], atomCount: 24 };
  const twin = { ...lig, resnoMin: 602, resnoMax: 602 };
  const other = { ...lig, chain: 'B' };
  const model1 = { ...lig, model: 1 };
  ok(partKeyOf(lig) !== partKeyOf(twin),
    'deux copies du même ligand dans la même chaîne sont DEUX molécules (leurs résidus, pas un numéro d’ordre)');

/* ── 3. LE MOUVEMENT : GLISSER, TOURNER, ET REJOUER ───────────────────────── */
{
  // Un triangle, comme une petite molécule : trois atomes, un centre.
  const base = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const pivot = centroidOf(base);
  const at = (flat, i) => [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const move0 = partMoveIdentity('A|0|1-1|LIG|3', pivot);

  eq(Array.from(partPositionsInto(base, move0, null)), Array.from(base),
    'un mouvement À L’ARRÊT rend les coordonnées d’origine telles quelles (rien ne bouge tant que rien n’est fait)');
  eq(Array.from(partPositionsInto(base, null, null)), Array.from(base),
    '…et un mouvement absent aussi (une molécule jamais touchée)');

  const slid = slidePartMove(move0, [1, -2, 0.5]);
  const sp = partPositionsInto(base, slid, null);
  near(sp[3], 3, 'glisser décale TOUS les atomes du même vecteur (x)');
  near(sp[4], -2, '…en y');
  near(sp[5], 0.5, '…en z');
  near(dist(at(sp, 0), at(sp, 1)), dist(at(base, 0), at(base, 1)),
    '…sans déformer la molécule : les distances entre atomes sont conservées');
  const sc = centroidOf(sp);
  near(sc[0], pivot[0] + 1, 'le centre suit le glissement');
  near(sc[1], pivot[1] - 2, '…exactement');

  const axes = { x: [1, 0, 0], y: [0, 1, 0] };   // les directions d'écran, mesurées par le viewer
  const turned = rotatePartMove(move0, axes, 2, 0);   // 2 px vers la droite
  const tp = partPositionsInto(base, turned, null);
  const tc = centroidOf(tp);
  // (1e-6 : les positions sortent en Float32 — la précision des coordonnées que NGL
  // dessine — donc le centre est le même À LA PRÉCISION DU DESSIN près.)
  near(tc[0], pivot[0], 'tourner se fait AUTOUR DE SON PROPRE CENTRE : le centre ne bouge pas', 1e-6);
  near(tc[1], pivot[1], '…ni en y', 1e-6);
  near(dist(at(tp, 0), at(tp, 1)), dist(at(base, 0), at(base, 1)),
    'une rotation ne déforme pas la molécule non plus');
  ok(dist(at(tp, 0), at(base, 0)) > 1e-6, '…mais elle la tourne vraiment (un atome a bougé)');

  // Deux crans de rotation = un cran double : le geste SUIT la souris, sans à-coups
  // ni « retour » au milieu du glisser.
  const once = rotatePartMove(move0, axes, 1, 0);
  const twice = rotatePartMove(once, axes, 1, 0);
  const straight = rotatePartMove(move0, axes, 2, 0);
  twice.q.forEach((n, i) => near(n, straight.q[i], `deux crans de rotation s’additionnent (composante ${i})`, 1e-9));
  // …et rejouer le même mouvement deux fois donne les MÊMES coordonnées (aucune dérive
  // d’un rejeu à l’autre : c’est ce qui rend le rejeu après un changement d’image sûr).
  eq(Array.from(partPositionsInto(base, twice, null)), Array.from(partPositionsInto(base, twice, null)),
    'rejouer un mouvement donne toujours exactement les mêmes coordonnées');

  // Glisser ET tourner se rangent dans deux champs distincts : l’ordre des gestes de
  // l’utilisateur ne change donc pas où la molécule finit (elle est tournée sur
  // elle-même PUIS posée), ce qui est ce qu’on attend d’une molécule.
  const rotThenSlide = slidePartMove(rotatePartMove(move0, axes, 3, -2), [0.5, 1, 0]);
  const slideThenRot = rotatePartMove(slidePartMove(move0, [0.5, 1, 0]), axes, 3, -2);
  eq(Array.from(partPositionsInto(base, rotThenSlide, null)), Array.from(partPositionsInto(base, slideThenRot, null)),
    'tourner puis glisser = glisser puis tourner (l’orientation et la place sont deux réglages indépendants)');

  // Tourner à l’envers ramène la molécule EXACTEMENT où elle était.
  const there = rotatePartMove(move0, axes, 5, 0);
  const back = rotatePartMove(there, axes, -5, 0);
  Array.from(partPositionsInto(base, back, null)).forEach((n, i) => near(n, base[i], 'tourner puis dé-tourner rend la molécule à l’identique', 1e-6));

  // Le mouvement s’applique aux coordonnées qu’on lui donne — celles de l’image

/* ── 4. LES POSES : CE QU'UN FILM GARDE ───────────────────────────────────── */
{
  eq(isIdentityMove(null), true, 'aucun mouvement = à l’arrêt');
  eq(isIdentityMove(partMoveIdentity('k', [1, 2, 3])), true, 'un mouvement neuf est à l’arrêt');
  eq(isIdentityMove(slidePartMove(partMoveIdentity('k', [0, 0, 0]), [0, 0, 0])), true, 'glisser de rien reste à l’arrêt');
  eq(isIdentityMove(slidePartMove(partMoveIdentity('k', [0, 0, 0]), [0, 0.5, 0])), false, 'glisser de quelque chose ne l’est plus');
  eq(isIdentityMove(rotatePartMove(partMoveIdentity('k', [0, 0, 0]), { x: [1, 0, 0], y: [0, 1, 0] }, 0, 0)), true,
    'tourner de zéro pixel non plus');
  eq(isIdentityMove(rotatePartMove(partMoveIdentity('k', [0, 0, 0]), { x: [1, 0, 0], y: [0, 1, 0] }, 0, 1)), false,
    'un pixel vertical, si');

  eq(partPosesOf([]), {}, 'une scène sans molécule touchée n’ajoute RIEN à une pose');
  eq(partPosesOf(null), {}, '…même sans liste du tout');
  const kept = partPosesOf([
    partMoveIdentity('untouched', [1, 1, 1]),
    slidePartMove(partMoveIdentity('lig', [0, 0, 0]), [0, 1, 0]),
  ]);
  eq(Object.keys(kept), ['lig'],
    'seules les molécules DÉPLACÉES entrent dans la pose (une molécule intacte n’alourdit pas le film)');
  eq(kept.lig, { pivot: [0, 0, 0], t: [0, 1, 0], q: [0, 0, 0, 1] },
    'ce qu’une pose garde d’une molécule : son pivot, son déplacement et son orientation — des nombres, rien d’autre');
  eq(JSON.parse(JSON.stringify(kept)), kept, '…donc un film écrit puis relu garde le même mouvement');

/* ── 5. LE FILM : UNE POSE PORTE AUSSI CES MOUVEMENTS ─────────────────────── */
{
  const parts = { 'A|0|601-601|LIG|24': { pivot: [1, 2, 3], t: [4, 0, 0], q: [0, 0, 0, 1] } };
  const bare = keyframePoseOf('main', null, [0, 0, 0], [0, 0, 0]);
  ok(!('parts' in bare), 'une scène sans molécule déplacée produit une pose SANS `parts` (le film reste ce qu’il était)');
  const withParts = keyframePoseOf('main', null, [0, 0, 0], [0, 0, 0], parts);
  eq(withParts.parts, parts, '…et une molécule déplacée voyage avec la pose');
  ok(!('parts' in keyframePoseOf('main', null, [0, 0, 0], [0, 0, 0], {})), 'aucun mouvement : aucun champ');
  eq(normalizePoseParts({ lig: { pivot: [0, 0, 0], t: [0, 0, 0], q: [0, 0, 0, 1] }, bad: 'xx' }),
    { lig: { pivot: [0, 0, 0], t: [0, 0, 0], q: [0, 0, 0, 1] } },
    'une entrée illisible est ignorée (jamais un NaN peint dans la scène)');
  eq(normalizePoseParts({ lig: { pivot: [0, 0], t: [0, 0, 0], q: [0, 0, 0, 1] } }), null,
    '…et une molécule dont le pivot n’a pas trois nombres ne fait pas une pose à moitié');
  const both = mixPoseParts(parts, parts, 0.5);
  eq(both['A|0|601-601|LIG|24'], { pivot: [1, 2, 3], t: [4, 0, 0], q: [0, 0, 0, 1] },
    'd’une pose à elle-même : rien ne bouge');
  const half = mixPoseParts(parts, null, 0.5);
  near(half['A|0|601-601|LIG|24'].t[0], 2,
    'la molécule d’UNE SEULE des deux poses glisse depuis sa place d’origine (la moitié du chemin)');
  eq(half['A|0|601-601|LIG|24'].pivot, [1, 2, 3],
    '…autour de SON pivot (une pose sans mouvement n’a pas de pivot à elle)');
  eq(mixPoseParts(null, null, 0.5), null, 'deux scènes sans molécule déplacée ne fabriquent pas un champ vide');
  const mixed = mixPose(
    { key: 'main', position: [0, 0, 0], quaternion: [0, 0, 0, 1], parts },
    { key: 'main', position: [2, 0, 0], quaternion: [0, 0, 0, 1] },
    0.5,
  );
  eq(mixed.position, [1, 0, 0], 'la position de la composante glisse, comme avant');
  near(mixed.parts['A|0|601-601|LIG|24'].t[0], 2, '…et le mouvement de sa molécule aussi');
  eq(mixPose({ key: 'main', position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    { key: 'main', position: [2, 0, 0], quaternion: [0, 0, 0, 1] }, 0.5).parts, undefined,
    'une scène intacte des deux côtés ne prend pas de champ `parts` (le film reste lisible par une version antérieure)');
  // LE FILM ÉCRIT ET RELU — le mouvement survit au fichier.
  const film = {
    keys: [{
      id: 'a', name: 'A', hold: 1, morph: 1, easing: 'linear',
      state: { bg: '#000000' }, pose: [{ key: 'main', position: [0, 0, 0], quaternion: [0, 0, 0, 1], parts }],
    }],
  };
  eq(parseKeyframeFilm(serialiseKeyframeFilm(film)).keys[0].pose[0].parts, parts,
    'un film écrit puis relu rend la molécule exactement là où la pose l’avait mise');
}

  eq(partMoveFromPose('lig', kept.lig, [9, 9, 9]).pivot, [0, 0, 0], 'une pose relue rend son mouvement tel quel');
  eq(partMoveFromPose('lig', {}, [9, 9, 9]).pivot, [9, 9, 9],
    'une pose SANS pivot (une version antérieure du film) retombe sur le centre de la molécule');
  eq(partMoveFromPose('lig', { pivot: ['x', 0, 0] }, [9, 9, 9]).pivot, [9, 9, 9],
    'un pivot illisible aussi — jamais de NaN dans une scène');
}

  // courante — et à rien d’autre : aucune molécule n’est supposée être à l’origine.
  const wide = partPositionsInto(new Float32Array([10, 10, 10]), slid, null);
  near(wide[0], 11, 'le mouvement part des coordonnées fournies (celles de l’image courante)');
}

  ok(partKeyOf(lig) !== partKeyOf(other), 'deux chaînes aussi');
  ok(partKeyOf(lig) !== partKeyOf(model1), 'deux MODEL aussi (un ensemble NMR = un conformère par clé)');
  eq(partKeyOf(lig), partKeyOf({ ...lig }), 'la même molécule relue donne TOUJOURS la même clé (un film la retrouve après un rechargement)');
  eq(partKeyOf(null), '_|0|0-0|?|0', 'une entité vide a une clé, pas une exception');
}


/* ── 6. LE BRANCHEMENT DANS LE VIEWER ─────────────────────────────────────── */
{
  has("} from '../utils/viewerMoleculeMoves';", 'le viewer importe la règle du déplacement d’une molécule');
  has('const molPartsOf = (comp) => {', 'les molécules d’une structure chargée sont demandées UNE fois (et gardées)');
  has('try { parts = splitStructureIntoMolecules(comp); } catch { parts = []; }',
    '…par la MÊME découpe que partout ailleurs (CONECT · proximité · jamais deux MODEL)');
  has('if (!Array.isArray(parts) || parts.length < 2) parts = [];',
    'une structure d’UNE molécule n’a rien à séparer : le geste reste celui de NGL');
  has('const molPartAt = (comp, atomIndex) => {', 'un atome piqué dit de QUELLE molécule il est');
  has('const partMoveFor = (comp, pi) => {', '…et chaque molécule a SON mouvement, avec ses coordonnées d’origine');
  has('...partMoveIdentity(key, centroidOf(base)),', 'le mouvement tourne autour du CENTRE de la molécule');
  has('const applyPartMove = (comp, rec) => {', 'écrire un mouvement dans la structure est UNE fonction');
  has('ap.positionFromArray(rec.scratch, k * 3);', '…elle écrit les atomes de CETTE molécule');
  has('comp.updateRepresentations({ position: true })',
    '…et demande à NGL de redessiner, exactement comme `panAtom` et comme une image de trajectoire');
  has('const reapplyPartMoves = (comp) => {', 'un changement d’image REJOUE les molécules déplacées');
  has('sig.add(() => { reapplyPartMoves(comp); refreshScenePlates(); });',
    '…au MÊME signal que les plaques, et AVANT elles (elles lisent les coordonnées)');
  has('const restorePartMoves = (comp) => {', 'les coordonnées d’origine peuvent revenir (le ↺)');
  has('if (comp) restorePartMoves(comp);', '…et le ↺ de la structure chargée les remet TOUTES');
  has('const partPosesForPose = () => {', 'une pose de film emporte les molécules déplacées');
  has("key === 'main' ? partPosesForPose() : null,", '…dans la pose de la composante qui les porte');
  has("if (p.key === 'main') applyPartPoses(p.parts);", '…et les repose au morphème suivant');
  has('if (!keys.length) return restorePartMoves(comp) > 0;',
    'une pose SANS molécule déplacée rend la scène telle qu’elle a été chargée');
  has('partMoveRef.current.clear();', 'une nouvelle structure oublie les mouvements de l’ancienne');
  has("const [heldPart, setHeldPart] = useState('');", 'la barre sait quelle molécule la main tient');
  has("pi >= 0 ? { comp, key: 'main', part: pi, anchor: atom.index } : { comp, key: 'main' };",
    'le picking dit la MOLÉCULE, pas seulement la composante');
  has('const screenVector = (comp, atomIndex, dx, dy) => {',
    'le vecteur et les axes du geste sont MESURÉS sur NGL (aucune matrice réécrite ici)');
  has('try { tb.panAtom(dx, dy); } catch {', '…en laissant NGL déplacer un atome du vecteur exact de `panComponent`');
  has('ap.x = x0; ap.y = y0; ap.z = z0;', '…puis en remettant l’atome sonde où il était');
  has('const partStep = (g, dx, dy, how) => {', 'le pas d’un geste sur la molécule tenue est UNE fonction');
  has('g.rec.q = rotatePartMove(g.rec, g.axes, dx, dy).q;', '…qui TOURNE sur ce qu’elle est devenue (pas de retour au milieu du geste)');
  has('g.rec.t = slidePartMove(g.rec, v).t;', '…ou qui GLISSE du vecteur de NGL');
  has("if (g && g.rec && st.transformComponent === g.comp && partStep(g, dx, dy, 'turn')) return;",
    'le glisser-gauche écrit la molécule du FICHIER et s’arrête là');
  has("if (g && g.rec && st.transformComponent === g.comp && partStep(g, dx, dy, 'slide')) return;",
    '…le glisser-droit aussi');
  /* ⚠ LA PASTILLE « 🖱 drag a molecule … » A ÉTÉ RETIRÉE (la demande : « the button
     “drag a molecule: turn · right-drag: slide” seems useless and you can remove
     it ») : le geste reste celui du code ci-dessus, et c'est la ligne ★ de la barre
     — vérifiée juste en dessous — qui dit la molécule tenue pendant qu'elle bouge. */
  gone('🖱 drag a molecule: turn · right-drag: slide',
    'la pastille du geste n’est plus rendue (la demande l’a retirée)');
  has("heldPart ? ` · 🖐 moving « ${heldPart} » ALONE` : ''",
    '…et la ligne ★ dit qu’elle bouge SEULE');
  has("setHeldPart((part && part.label) || '');", '…et son nom vient du NOM de la molécule, pas d’un numéro');
}

/* ── 7. SUR UN VRAI NGL : LE GESTE NE TOUCHE QUE LES ATOMES DE LA MOLÉCULE PRISE ───
   LA QUESTION À LAQUELLE CETTE SECTION RÉPOND, la plus importante du mécanisme :
   quand la main prend un ligand dans un PDB qui porte AUSSI une protéine, quels atomes
   bougent ? La réponse doit être « ceux du ligand, et RIEN d'autre ». Ici la structure
   est réellement parsée par NGL, les molécules sont réellement découpées par la
   fonction du viewer (splitStructureIntoMolecules, extraite et exécutée telle quelle),
   l'écriture passe par les MÊMES appels que le geste (AtomProxy#positionFromArray), et
   l'on compare les coordonnées ATOME PAR ATOME. */
{
  const require = createRequire(import.meta.url);
  const NGL = require('ngl');
  /* NGL lit un Blob à travers FileReader : le navigateur l'a, node non (le même
     bricolage que _viewer_row_bridges_test.mjs, qui charge aussi de vraies structures). */
  if (typeof globalThis.FileReader !== 'function') {
    globalThis.FileReader = class {
      readAsText(blob) {
        Promise.resolve(blob.text()).then((text) => {
          this.result = text;
          if (typeof this.onload === 'function') this.onload({ target: this });
        });
      }
    };
  }
  const RULE = await import('./src/utils/viewerMoleculeParts.js');
  const sliceFn = (marker) => {
    const at = VIEW.indexOf(marker);
    assert.ok(at >= 0, `introuvable dans le viewer : ${marker}`);
    let depth = 0;
    for (let i = at + marker.length - 1; i < VIEW.length; i++) {
      if (VIEW[i] === '{') depth += 1;
      else if (VIEW[i] === '}') { depth -= 1; if (!depth) return `${VIEW.slice(at, i + 1)};`; }
    }
    throw new Error(`accolades non fermées : ${marker}`);
  };
  const splitStructureIntoMolecules = new Function(
    'fragmentMolecules', 'moleculePartNames', 'pdbTextForMolecule', 'MOLECULE_PART_MAX_ATOMS',
    `${sliceFn('const namedPartsOf = (atoms, bonds, modelCount = 1) => {')}\n`
    + `${sliceFn('const splitStructureIntoMolecules = (comp, modelCountHint = 0) => {')}\n`
    + 'return splitStructureIntoMolecules;',
  )(RULE.fragmentMolecules, RULE.moleculePartNames, RULE.pdbTextForMolecule, RULE.MOLECULE_PART_MAX_ATOMS);

  // Une petite protéine (un résidu) ET un ligand, dans la MÊME chaîne A, à 12 Å l'un de
  // l'autre : c'est le cas du rapport (« more molecules in one pdb »).
  const PDB = [
    'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N',
    'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00  0.00           C',
    'ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00  0.00           C',
    'ATOM      4  O   ALA A   1       1.251   2.390   0.000  1.00  0.00           O',
    'HETATM    5  C1  LIG A 601      12.000   0.000   0.000  1.00  0.00           C',
    'HETATM    6  C2  LIG A 601      13.400   0.000   0.000  1.00  0.00           C',
    'HETATM    7  O1  LIG A 601      14.000   1.300   0.000  1.00  0.00           O',
    'END',
  ].join('\n');
  const structure = await NGL.autoLoad(new Blob([PDB], { type: 'text/plain' }), { ext: 'pdb' });
  const comp = { structure };

  const parts = splitStructureIntoMolecules(comp);
  eq(parts.length, 2, 'un PDB qui porte une protéine ET son ligand donne DEUX molécules (sans découper le fichier)');
  const ligPart = parts.find((p) => p.resnames.includes('LIG'));
  const protPart = parts.find((p) => p.resnames.includes('ALA'));
  ok(!!ligPart && !!protPart, '…l’une est le ligand, l’autre la chaîne');
  ok(partKeyOf(ligPart) !== partKeyOf(protPart), '…et leurs clés les distinguent');

  // LES INDICES SONT BIEN DES INDICES D'ATOMES — le principe sur lequel repose tout le
  // geste (un atome piqué → sa molécule) est vérifié sur la vraie structure.
  const byResname = { ALA: [], LIG: [] };
  structure.eachAtom((a) => { if (byResname[a.resname]) byResname[a.resname].push(a.index); });
  eq(ligPart.idxs.slice().sort((x, y) => x - y), byResname.LIG.slice().sort((x, y) => x - y),
    'les indices de la molécule sont EXACTEMENT ceux de ses atomes dans la structure');
  eq(protPart.idxs.slice().sort((x, y) => x - y), byResname.ALA.slice().sort((x, y) => x - y),
    '…et la protéine a les siens');
  eq(ligPart.idxs.length + protPart.idxs.length, structure.atomCount,
    'aucun atome n’est oublié ni pris deux fois entre les deux molécules');

  // ── LE GESTE : glisser le ligand de (3, −1, 2) ────────────────────────────────
  const ap = structure.getAtomProxy();
  const read = () => {
    const flat = new Float32Array(structure.atomCount * 3);
    for (let i = 0; i < structure.atomCount; i++) { ap.index = i; ap.positionToArray(flat, i * 3); }
    return flat;
  };
  const before = read();
  const base = new Float32Array(ligPart.idxs.length * 3);
  ligPart.idxs.forEach((idx, k) => { ap.index = idx; ap.positionToArray(base, k * 3); });
  const rec = { ...partMoveIdentity(partKeyOf(ligPart), centroidOf(base)), base };
  const slid = slidePartMove(rec, [3, -1, 2]);
  const out = partPositionsInto(base, slid, null);
  ligPart.idxs.forEach((idx, k) => { ap.index = idx; ap.positionFromArray(out, k * 3); });
  const after = read();
  let touched = 0;
  for (let i = 0; i < structure.atomCount * 3; i++) if (after[i] !== before[i]) touched += 1;
  eq(touched, ligPart.idxs.length * 3,
    'les coordonnées écrites sont EXACTEMENT celles du ligand (une seule molécule a bougé)');
  byResname.ALA.forEach((idx) => {
    eq([after[idx * 3], after[idx * 3 + 1], after[idx * 3 + 2]], [before[idx * 3], before[idx * 3 + 1], before[idx * 3 + 2]],
      '…la protéine est INTACTE, au bit près');
  });
  byResname.LIG.forEach((idx) => {
    near(after[idx * 3] - before[idx * 3], 3, 'le ligand a suivi le vecteur du geste (x)');
    near(after[idx * 3 + 1] - before[idx * 3 + 1], -1, '…(y)');
    near(after[idx * 3 + 2] - before[idx * 3 + 2], 2, '…(z)');
  });

  // ── LE REJEU : tourner la molécule, la reposer, la rejouer ────────────────────
  const centre = (flat, idxs) => {
    let x = 0; let y = 0; let z = 0;
    idxs.forEach((idx) => { x += flat[idx * 3]; y += flat[idx * 3 + 1]; z += flat[idx * 3 + 2]; });
    return [x / idxs.length, y / idxs.length, z / idxs.length];
  };
  const spun = rotatePartMove(slid, { x: [1, 0, 0], y: [0, 1, 0] }, 40, 15);
  const spunOut = partPositionsInto(base, spun, null);
  ligPart.idxs.forEach((idx, k) => { ap.index = idx; ap.positionFromArray(spunOut, k * 3); });
  const spunBack = read();
  const c0 = centre(before, ligPart.idxs);
  const c1 = centre(spunBack, ligPart.idxs);
  near(c1[0], c0[0] + 3, 'tourner + glisser laisse le centre du ligand là où le glissement l’a mis (x)');
  near(c1[1], c0[1] - 1, '…(y)');
  near(c1[2], c0[2] + 2, '…(z)');
  eq(centre(spunBack, byResname.ALA), centre(before, byResname.ALA),
    '…et le centre de la protéine n’a pas bougé d’un atome');
  // Rejouer EXACTEMENT le même mouvement redonne les mêmes coordonnées (aucune dérive,
  // même après plusieurs écritures dans la structure).
  eq([...partPositionsInto(base, spun, null)], [...spunOut],
    'rejouer un mouvement redonne les MÊMES coordonnées (les coordonnées d’origine sont gardées)');

  // ── LE ↺ : les coordonnées d'origine reviennent telles quelles ────────────────
  ligPart.idxs.forEach((idx, k) => { ap.index = idx; ap.positionFromArray(base, k * 3); });
  eq([...read()], [...before], 'le ↺ (restorePartMoves) rend la structure EXACTEMENT comme chargée');
}

console.log(`✔ _viewer_molecule_moves_test.mjs — ${passed} vérifications`);
