/* =========================================================================
   _viewer_keyframes_test.mjs — 🎞 « poses & styles » : capturer une pose,
   morpher vers la suivante, et écrire le morphème en une vidéo.

   LA DEMANDE D'ORIGINE : « a pose/style keyframe system: store several
   snapshots of the position and the styles of a structure, and smoothly
   interpolate between them to export a video ».

   CE QUI EST VÉRIFIÉ ICI :

   1. LES FAITS DU MODULE (src/utils/viewerKeyframes.js), EXÉCUTÉS : les cinq
      façons d'aller d'une pose à la suivante, le mélange HONNÊTE de deux
      photographies (les nombres glissent, les couleurs glissent par leur RVB,
      une rotation est SLERPÉE — le chemin court, jamais par le flip —, ce qui
      ne se mélange pas COUPE au milieu du morphème), la chronologie du film
      (chaque pose est TENUE puis MORPHÉE), l'échantillonneur (« qu'y a-t-il à
      l'écran à t = 3,4 s ? »), le plan lu AVANT le clic (frames, durée, Mbps,
      plafond de frames, timeAt qui visite le premier ET le dernier instant) et
      le codec du magasin du navigateur.
   2. LA POSE D'UNE MOLÉCULE : sa position ET son orientation, lues de la
      matrice monde que NGL affiche (la même décomposition que le fit 🎯), la
      position rapportée par la composante PRÉFÉRÉE — c'est ce que setPosition
      reprend.
   3. LE CÂBLAGE DANS LE VIEWER (lu dans la source) : le panneau 🎞 et ses
      gestes, UNE SEULE fonction met un instant à l'écran (donc le film VU est
      le film ÉCRIT), aucun envoi, l'import qui N'APPLIQUE RIEN, le magasin
      local — et l'ADDITIVITÉ : la 🎬 de la trajectoire est intacte (la queue
      de son finally comprise), et les deux enregistreurs ne se parlent pas.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEYFRAME_EASINGS, KEYFRAME_DEFAULT_EASING, KEYFRAME_EASING_LABELS,
  KEYFRAME_LIMITS, KEYFRAME_DEFAULT_HOLD, KEYFRAME_DEFAULT_MORPH,
  KEYFRAME_MIN_MORPH, KEYFRAME_STORE_VERSION, KEYFRAME_STATE_DROP,
  ease, mixHexColor, normQuat, slerpQuat, mixValue, mixState,
  mixPose, mixPoseList, keyframeLegs, sampleKeyframeFilm, keyframePlan,
  keyframeFilmSummary, keyframePoseOf, normalizeKeyframe, normalizeKeyframeFilm,
  nextKeyframeId, slimKeyframeState, serialiseKeyframeFilm, parseKeyframeFilm,
  VIDEO_FPS_CHOICES, VIDEO_DEFAULT_FPS,
} from './src/utils/viewerKeyframes.js';
import {
  VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_MAX_FRAMES, VIDEO_LONG_RUN_SECONDS,
  videoBitrateOf, videoSecondsText,
} from './src/utils/viewerTrajectoryVideo.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};
const near = (a, b, what, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `${what} (${a} ≠ ${b})`);
  passed += 1;
};
const deep = (a, b, what) => {
  assert.deepEqual(a, b, what);
  passed += 1;
};

/* La source est lue et RAMENÉE À LF : sur Windows le fichier est extrait en
   CRLF, et toutes les aiguilles d'ici — y compris celles qui traversent deux
   lignes, comme les blocs `... } from '...';` — sont écrites avec des LF (la
   convention du dépôt). Sans ça, une aiguille multi-lignes ne trouverait rien
   pour une raison qui n'a rien à voir avec le code vérifié. */
const VIEWER = readFileSync('./src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const hasIn = (src, needle, what) => ok(src.includes(needle), what);
const countIn = (src, needle) => src.split(needle).length - 1;

/* One keyframe as the panel captures it (the module's own normaliser decides
   what a store may hold, so the fixture is written the way the panel writes). */
const kf = (over = {}) => normalizeKeyframe({
  id: over.id,
  name: over.name,
  hold: over.hold === undefined ? 1 : over.hold,
  morph: over.morph === undefined ? 1 : over.morph,
  easing: over.easing || 'linear',
  state: over.state || { bg: '#000000', radius: 0.4, style: 'ribbon' },
  pose: over.pose || [],
});

/* ── 0. Les switches que le panneau offre ───────────────────────────────── */
{
  eq(KEYFRAME_EASINGS.length, 5, 'les cinq façons d\'aller d\'une pose à la suivante sont offertes');
  ok(KEYFRAME_EASINGS.includes('linear') && KEYFRAME_EASINGS.includes('hold'),
    '« linear » et « cut (no move) » sont du voyage');
  ok(KEYFRAME_EASINGS.every((n) => typeof KEYFRAME_EASING_LABELS[n] === 'string'
    && KEYFRAME_EASING_LABELS[n]), 'chaque easing a son nom écrit dans le panneau (aucun select muet)');
  ok(KEYFRAME_EASINGS.includes(KEYFRAME_DEFAULT_EASING),
    'l\'easing par défaut est un easing que le panneau sait afficher');
  eq(KEYFRAME_LIMITS.keys, 40, 'quarante poses : un geste, pas une base de données');
  ok(KEYFRAME_LIMITS.hold[0] === 0 && KEYFRAME_LIMITS.hold[1] > 0, 'une tenue va de 0 s à un plafond');
  ok(KEYFRAME_LIMITS.morph[0] === 0 && KEYFRAME_LIMITS.morph[1] > 0, 'un morphème va de 0 s à un plafond');
  ok(KEYFRAME_DEFAULT_HOLD >= KEYFRAME_LIMITS.hold[0] && KEYFRAME_DEFAULT_HOLD <= KEYFRAME_LIMITS.hold[1],
    'la tenue par défaut tient dans ses bornes');
  ok(KEYFRAME_DEFAULT_MORPH >= KEYFRAME_LIMITS.morph[0] && KEYFRAME_DEFAULT_MORPH <= KEYFRAME_LIMITS.morph[1],
    'le morphème par défaut tient dans ses bornes');
  ok(KEYFRAME_MIN_MORPH > 0 && KEYFRAME_MIN_MORPH < 1,
    'un morphème ne peut pas être nul : l\'échantillonneur a toujours de quoi diviser');
  eq(KEYFRAME_STORE_VERSION, 1, 'le magasin du navigateur est versionné');
  deep([...KEYFRAME_STATE_DROP].sort(), ['pymol', 'savedAt'],
    'une pose ne garde NI la session PyMOL NI le tampon de la capture (tout le reste EST l\'image)');
  ok(VIDEO_FPS_CHOICES.includes(VIDEO_DEFAULT_FPS),
    'le taux par défaut du film est un taux que le panneau offre');
}

/* ── 1. La façon d'aller d'une pose à la suivante ───────────────────────── */
{
  eq(ease('linear', 0.5), 0.5, '« linear » avance d\'un pas constant');
  eq(ease('in', 0.5), 0.25, '« in » démarre lentement (t²)');
  eq(ease('out', 0.5), 0.75, '« out » finit lentement (1 − (1−t)²)');
  near(ease('inOut', 0.5), 0.5, '« smooth » passe par le milieu');
  near(ease('inOut', 0.25), 0.15625, '« smooth » ralentit aux deux bouts');
  ok(ease('inOut', 0.25) < ease('linear', 0.25) && ease('inOut', 0.75) > ease('linear', 0.75),
    '« smooth » est en retard au début et en avance à la fin (c\'est un in-out, pas un linear)');
  eq(ease('hold', 0), 0, '« cut » : rien ne bouge au début');
  eq(ease('hold', 0.99), 0, '« cut » : rien ne bouge jusqu\'au bout');
  eq(ease('hold', 1), 1, '« cut » : la pose suivante arrive d\'un coup, à la fin');
  eq(ease('wobble', 0.25), ease(KEYFRAME_DEFAULT_EASING, 0.25),
    'un nom d\'easing inconnu retombe sur le lisse, il ne casse rien');
  eq(ease('linear', -3), 0, 'un t négatif est ramené à 0');
  eq(ease('linear', 12), 1, 'un t au-delà de 1 est ramené à 1');
  eq(ease('linear', 'nope'), 0, 'un t qui n\'est pas un nombre vaut 0 (jamais NaN à l\'écran)');
  const ramp = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((x) => ease('inOut', x));
  ok(ramp.every((v, i) => i === 0 || v >= ramp[i - 1]), 'le lisse ne recule jamais');
  near(ramp[0], 0, 'le lisse part de 0');
  near(ramp[6], 1, 'le lisse arrive à 1');
}

/* ── 2. Les couleurs glissent, elles ne claquent pas ────────────────────── */
{
  eq(mixHexColor('#000000', '#ffffff', 0.5), '#808080', 'deux couleurs se rencontrent au milieu du RVB');
  eq(mixHexColor('#ff0000', '#ff0000', 0.3), '#ff0000', 'une couleur qui ne change pas ne bouge pas');
  eq(mixHexColor('#ff0000', '#0000ff', 0), '#ff0000', 'à t = 0 la couleur de départ est intacte');
  eq(mixHexColor('#ff0000', '#0000ff', 1), '#0000ff', 'à t = 1 la couleur d\'arrivée est exacte');
  eq(mixHexColor('#ff8800', '#0088ff', 0.5), '#808880',
    'le mélange se fait par canal : le vert (0x88), commun aux deux, ressort intact');
  eq(mixHexColor('#ff8800', '#0088ff', 0.5).length, 7, 'la couleur produite est bien un « #rrggbb »');
  ok(/^#[0-9a-f]{2}[0-9a-f]{2}[0-9a-f]{2}$/.test(mixHexColor('#123456', '#abcdef', 0.37)),
    'un mélange donne TOUJOURS un hexadécimal valide, jamais « #NaN »');
  eq(mixHexColor('red', '#ffffff', 0.25), 'red',
    'une couleur qui n\'est pas un hexadécimal est laissée telle quelle avant le milieu');
  eq(mixHexColor('red', '#ffffff', 0.75), '#ffffff',
    '… et devient celle d\'arrivée après le milieu (une coupe, pas une invention)');
}

/* ── 3. Une rotation suit la sphère, jamais le flip ─────────────────────── */
{
  deep(normQuat([0, 0, 0, 2]), [0, 0, 0, 1], 'une rotation est normalisée avant tout usage');
  eq(normQuat([0, 0, 0, 0]), null, 'quatre zéros ne font pas une rotation (et ne feront jamais un NaN)');
  eq(normQuat([0, 0, 0]), null, 'trois nombres ne font pas une rotation');
  eq(normQuat(['a', 'b', 'c', 'd']), null, 'des mots ne font pas une rotation');
  deep(slerpQuat([0, 0, 0, 1], [0, 0, 0, -1], 0.25), [0, 0, 0, 1],
    'l\'antipode est la MÊME rotation : entre elle et l\'identité, la scène ne tourne pas');
  /* 170° autour de Z : la moitié du chemin, c\'est 85°, jamais 265°. */
  const spin = (85 * Math.PI) / 180;
  const qA = [0, 0, Math.sin(spin), Math.cos(spin)];
  const half = slerpQuat(qA, [0, 0, 0, 1], 0.5);
  near(half[2], Math.sin(spin / 2), '170° vers l\'identité : à mi-chemin la rotation vaut 85°', 1e-3);
  near(half[3], Math.cos(spin / 2), '… et son « w » reste positif : personne n\'est passé par le flip', 1e-3);
  ok(Math.abs(Math.hypot(half[0], half[1], half[2], half[3]) - 1) < 1e-6,
    'un slerp rend une rotation unitaire');
  deep(slerpQuat([0, 0, 0, 1], [0, 0, 0, 0], 0.5), [0, 0, 0, 1],
    'une rotation invalide est ignorée : l\'autre est rendue telle quelle');
  deep(slerpQuat([0, 0, 0, 0], [0, 0, 0, 0], 0.5), [0, 0, 0, 1],
    'deux rotations invalides donnent l\'identité — la vue ne part jamais en vrille');
  deep(slerpQuat([0, 0, 0, 1], [0, 0, 0, 1], 0.7), [0, 0, 0, 1], 'd\'une pose à elle-même : rien ne bouge');
}

/* ── 4. Le mélange d'une photographie, valeur par valeur ───────────────── */
{
  eq(mixValue('radius', 1, 3, 0.5), 2, 'un nombre glisse');
  eq(mixValue('bg', '#000000', '#ffffff', 0.5), '#808080', 'une couleur glisse par son RVB');
  deep(mixValue('radii', [0, 1, 2], [2, 3, 4], 0.5), [1, 2, 3], 'une liste de nombres glisse nombre par nombre');
  const far = [0, 0, Math.sin(85 * Math.PI / 180), Math.cos(85 * Math.PI / 180)];
  const q = mixValue('quaternion', [0, 0, 0, 1], far, 0.5);
  near(q[2], Math.sin(85 * Math.PI / 360), 'quatre nombres sous le nom « quaternion » sont SLERPÉS', 1e-3);
  const w = mixValue('wobble', [0, 0, 0, 1], far, 0.5);
  near(w[2], Math.sin(85 * Math.PI / 180) / 2,
    'quatre nombres sous un autre nom sont une mesure : ils glissent, ils ne tournent pas', 1e-3);
  eq(mixValue('style', 'ribbon', 'spheres', 0.49), 'ribbon',
    'une « semi-VDW » n\'existe pas : un nom de style tient sa valeur avant le milieu');
  eq(mixValue('style', 'ribbon', 'spheres', 0.5), 'spheres', '… et coupe exactement au milieu');
  eq(mixValue('visible', true, false, 0.2), true, 'un drapeau ne se mélange pas, il coupe');
  eq(mixValue('visible', true, false, 0.8), false, '… dans les deux sens');
  eq(mixValue('onlyB', undefined, 7, 0.5), 7, 'un réglage qui n\'existe que d\'un côté est repris tel quel');
  eq(mixValue('onlyA', 7, undefined, 0.5), 7, '… et il ne disparaît pas en chemin');
  deep(mixState({ a: 1 }, { b: 2 }, 0.5), { a: 1, b: 2 },
    'l\'union des clés est parcourue : un réglage ajouté dans une pose est PORTÉ, pas perdu');
  deep(mixState({ n: { x: 0 } }, { n: { x: 10 } }, 0.25), { n: { x: 2.5 } },
    'un sous-objet se mélange clé par clé (les menus et leurs rayons)');
  eq(mixState({ a: 1 }, 'nope', 0.5).a, 1,
    'face à quelque chose qui n\'est pas un objet, la photo valide est gardée');
  const paired = mixState(
    { extras: [{ id: 'x1', opacity: 0.2 }, { id: 'x2', opacity: 0.8 }] },
    { extras: [{ id: 'x2', opacity: 0.2 }] },
    0.5,
  );
  eq(paired.extras.length, 2, 'les molécules ajoutées sont appariées par leur id : rien n\'est inventé ni perdu');
  near(paired.extras.find((x) => x.id === 'x1').opacity, 0.2,
    'une molécule que la pose suivante ne connaît pas reste où elle était');
  near(paired.extras.find((x) => x.id === 'x2').opacity, 0.5, 'celles que les deux connaissent glissent');
}

/* ── 5. Les poses d'une scène entière ──────────────────────────────────── */
{
  const a = { key: 'main', position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  const b = { key: 'main', position: [2, 0, 0], quaternion: [0, 0, 0, 1] };
  const lig = { key: 'lig', position: [5, 0, 0], quaternion: [0, 0, 0, 1] };
  const mixed = mixPoseList([a, lig], [b], 0.5);
  eq(mixed.length, 2, 'les poses des deux photographies sont toutes les deux sur la liste');
  deep(mixed[0].position, [1, 0, 0], 'le centre d\'une molécule glisse');
  eq(mixed[1], lig, 'une molécule que la pose suivante ignore garde EXACTEMENT sa pose capturée');
  const m = mixPose(a, b, 0.25);
  eq(m.key, 'main', 'une pose mélangée garde la clé de sa molécule');
  deep(m.position, [0.5, 0, 0], 'le mélange d\'un centre est linéaire');
  const far = [0, 0, Math.sin(85 * Math.PI / 180), Math.cos(85 * Math.PI / 180)];
  const qq = mixPose(a, { key: 'main', position: [0, 0, 0], quaternion: far }, 0.5);
  near(qq.quaternion[2], Math.sin(85 * Math.PI / 360), 'l\'orientation d\'une molécule est SLERPÉE', 1e-3);
  deep(mixPoseList([], [], 0.5), [], 'deux scènes sans molécule donnent une liste vide, pas une erreur');
  deep(mixPoseList(null, [lig], 0.5), [lig],
    'une liste manquante ne fait pas disparaître les molécules de l\'autre');
}

/* ── 6. La chronologie : chaque pose est TENUE puis MORPHÉE ─────────────── */
{
  const { legs, totalSeconds } = keyframeLegs([
    { hold: 1.5, morph: 2, easing: 'linear' },
    { hold: 1.5, morph: 0, easing: 'linear' },
  ]);
  eq(legs.length, 3, 'deux poses font trois jambes : tenue, morphème, tenue');
  deep(legs.map((l) => l.kind), ['hold', 'morph', 'hold'], 'les jambes s\'enchaînent dans cet ordre');
  eq(legs[0].start, 0, 'la première tenue commence à 0');
  eq(legs[0].end, 1.5, 'elle dure la tenue de sa pose');
  eq(legs[1].start, 1.5, 'le morphème reprend exactement où la tenue s\'arrête');
  eq(legs[1].end, 3.5, 'il dure le morphème de sa pose');
  eq(legs[1].from, 0, 'le morphème va de la pose 0…');
  eq(legs[1].to, 1, '… à la pose 1');
  eq(legs[2].start, 3.5, 'la dernière tenue suit le morphème');
  eq(legs[2].to, 1, 'une jambe de tenue ne va nulle part (from === to)');
  eq(totalSeconds, 5, 'le film dure la somme des jambes (1,5 + 2 + 1,5)');
  eq(legs[1].easing, 'linear', 'chaque jambe porte l\'easing de la pose d\'où elle part');

  const zero = keyframeLegs([{ hold: 0, morph: 1 }, { hold: 1 }]);
  eq(zero.legs.length, 2, 'une tenue de 0 s n\'est pas émise : le morphème démarre aussitôt');
  eq(zero.legs[0].kind, 'morph', 'la jambe suivante prend sa place');
  eq(zero.totalSeconds, 2, 'la durée totale ne compte pas de jambe fantôme');
  eq(keyframeLegs([{ hold: 999, morph: 999 }, { hold: 0 }]).totalSeconds,
    KEYFRAME_LIMITS.hold[1] + KEYFRAME_LIMITS.morph[1],
    'une tenue et un morphème tapés à la main sont ramenés à leurs bornes');
  eq(keyframeLegs([{ hold: -5, morph: -5 }, { hold: 0 }]).totalSeconds, KEYFRAME_MIN_MORPH,
    'un morphème négatif est ramené au minimum : jamais de film de durée nulle');
  eq(keyframeLegs(null).totalSeconds, 0, 'un film sans pose dure 0 s (aucune division par zéro possible)');
  eq(keyframeLegs([]).legs.length, 0, 'une liste vide ne fabrique aucune jambe');
  eq(keyframeLegs([null]).legs[0].kind, 'hold', 'une entrée abîmée retombe sur la tenue par défaut');
  eq(keyframeLegs([null]).legs[0].end, KEYFRAME_DEFAULT_HOLD,
    'un magasin abîmé donne la tenue par défaut, jamais une exception dans le panneau');
  const many = keyframeLegs(Array.from({ length: KEYFRAME_LIMITS.keys }, () => ({ hold: 0, morph: 1 })));
  eq(many.legs.length, KEYFRAME_LIMITS.keys - 1,
    'quarante poses font trente-neuf morphèmes : la dernière est tenue, elle ne morphe vers rien');
}

/* ── 7. « Qu'y a-t-il à l'écran à t secondes ? » ────────────────────────── */
{
  const poseAt = (x) => [{ key: 'main', position: [x, 0, 0], quaternion: [0, 0, 0, 1] }];
  const keys = [
    kf({ id: 'a', hold: 1, morph: 2, easing: 'linear', state: { x: 0, bg: '#000000', style: 'ribbon' }, pose: poseAt(0) }),
    kf({ id: 'b', hold: 1, morph: 0, easing: 'linear', state: { x: 10, bg: '#ffffff', style: 'spheres' }, pose: poseAt(10) }),
  ];
  eq(keyframeLegs(keys).totalSeconds, 4, 'le film de deux poses dure tenue + morphème + tenue (4 s)');

  const held = sampleKeyframeFilm(keys, 0.5);
  eq(held.kind, 'hold', 'à mi-tenue, la scène est TENUE');
  eq(held.state, keys[0].state, 'pendant une tenue, la photo est rendue TELLE QUE capturée (même objet)');
  eq(held.pose, keys[0].pose, '… et les orientations aussi, telles quelles');
  eq(held.at, 0.5, 'l\'échantillon dit à quel instant il a répondu');
  eq(held.totalSeconds, 4, '… et combien de temps dure le film');
  eq(held.t, 0, 'une tenue ne « progresse » pas : t vaut 0 (la photo est rendue telle quelle)');
  near(held.u, 0.5, '… même si la tenue sait où elle en est dans sa propre durée (0,5 s d\'une tenue de 1 s)');

  const start = sampleKeyframeFilm(keys, 1);
  eq(start.kind, 'morph', 'à la frontière, le morphème prend la main');
  eq(start.u, 0, '… à son tout début (aucun saut d\'image)');
  deep(start.state, keys[0].state, 'le premier instant du morphème EST la première pose');
  deep(start.pose[0].position, [0, 0, 0], '… y compris ses positions');

  const mid = sampleKeyframeFilm(keys, 2);
  eq(mid.kind, 'morph', 'au milieu du morphème, on morphe');
  near(mid.u, 0.5, 'u vaut un demi');
  near(mid.t, 0.5, 'avec un easing linéaire, t vaut aussi un demi');
  near(mid.state.x, 5, 'un nombre est à mi-chemin');
  eq(mid.state.bg, '#808080', 'une couleur est à mi-chemin de son RVB');
  eq(mid.state.style, 'spheres',
    'un nom de style n\'est pas inventé : il bascule exactement au milieu du morphème');
  eq(sampleKeyframeFilm(keys, 1.4).state.style, 'ribbon',
    '… et avant le milieu, il tient encore la pose d\'où l\'on part');
  eq(sampleKeyframeFilm(keys, 2.5).state.style, 'spheres', '… après, le style de la pose d\'arrivée');
  near(mid.pose[0].position[0], 5, 'le centre de la molécule est à mi-chemin');
  eq(mid.pose[0].key, 'main', 'la molécule garde sa clé en chemin');

  const smooth = sampleKeyframeFilm([
    kf({ hold: 1, morph: 2, easing: 'inOut', state: { x: 0 } }),
    kf({ hold: 1, morph: 0, state: { x: 10 } }),
  ], 1.5);
  near(smooth.t, 0.15625, 'un film SMOOTH ralentit au début du morphème');
  near(smooth.state.x, 1.5625, '… et le mélange suit cet easing, pas le temps brut');
  const cut = sampleKeyframeFilm([
    kf({ hold: 0, morph: 2, easing: 'hold', state: { style: 'ribbon', x: 0 } }),
    kf({ hold: 1, morph: 0, state: { style: 'spheres', x: 10 } }),
  ], 1.9);
  eq(cut.state.style, 'ribbon', 'un film « cut » ne montre QUE la pose d\'où il part, jusqu\'à la fin');
  eq(cut.state.x, 0, '… et rien de l\'autre ne fuit avant l\'heure');

  const end = sampleKeyframeFilm(keys, 4);
  eq(end.kind, 'hold', 'à la fin du film, la dernière pose est TENUE');
  eq(end.state, keys[1].state, 'la dernière image est EXACTEMENT la dernière pose capturée');
  eq(sampleKeyframeFilm(keys, 999).state, keys[1].state,
    'au-delà de la fin, le film tient sa dernière image (il ne repart pas au début)');
  eq(sampleKeyframeFilm(keys, -3).state, keys[0].state,
    'avant le début, le film montre sa première pose');
  eq(sampleKeyframeFilm(keys, 'nope').state, keys[0].state,
    'un temps illisible retombe sur le début, jamais sur du vide');
  eq(sampleKeyframeFilm([], 0), null, 'un film sans pose ne répond rien (et l\'appelant ne pose rien)');
  const damaged = sampleKeyframeFilm([null], 0);
  ok(!!damaged && damaged.kind === 'hold',
    'une entrée nulle dans la liste ne fait pas LEVER l\'échantillonneur : il tient une image vide');
  eq(sampleKeyframeFilm([keys[0]], 0).state, keys[0].state, 'une seule pose : le film est une image tenue');
  const ramp = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5].map((t) => sampleKeyframeFilm(keys, t).state.x);
  ok(ramp.every((v, i) => i === 0 || v >= ramp[i - 1]), 'le film ne recule jamais dans le temps');
  near(ramp[0], 0, 'au début, le film est à la première pose');
  near(ramp[ramp.length - 1], 10, 'à la fin, il est arrivé à la dernière');
}

/* ── 8. Le plan, lu AVANT le clic ──────────────────────────────────────── */
{
  const keys = [kf({ id: 'a', hold: 0.5, morph: 2, easing: 'linear' }), kf({ id: 'b', hold: 0.5, morph: 0 })];
  const plan = keyframePlan({ keyframes: keys, fps: 10, width: 640, height: 480 });
  ok(plan.ok, 'un film de deux poses sur un canvas qui a une taille est enregistrable');
  eq(plan.reason, '', 'aucune raison de refuser : le panneau n\'a rien à dire');
  eq(plan.totalSeconds, 3, 'la durée du plan est celle de la chronologie (0,5 + 2 + 0,5)');
  eq(plan.frames, 30, '30 frames à 10 fps pour 3 s');
  eq(plan.fps, 10, 'le taux demandé est celui du plan');
  eq(plan.frameMs, 100, 'la frame tient 100 ms (le film est en temps réel)');
  near(plan.seconds, 3, 'la durée écrite est celle des frames');
  eq(plan.secondsText, videoSecondsText(3), 'le texte de durée est celui du chemin commun de la 🎬');
  eq(plan.width, 640, 'la largeur vient du canvas de la scène');
  eq(plan.height, 480, '… et sa hauteur aussi');
  eq(plan.bitrate, videoBitrateOf(640, 480, 10), 'le débit est celui du chemin commun de la 🎬');
  eq(plan.long, false, 'un film de 3 s n\'est pas un film long (le seuil commun n\'est pas atteint)');
  eq(keyframePlan({ keyframes: keys, fps: 10, width: 640, height: 480, bitrate: 4000000 }).bitrate, 4000000,
    'un débit demandé est respecté (le 🎬 et le 🎞 demandent le même)');

  eq(keyframePlan({ keyframes: [], fps: 10, width: 8, height: 8 }).ok, false,
    'sans pose, il n\'y a pas de film');
  ok(keyframePlan({ keyframes: [], fps: 10, width: 8, height: 8 }).reason.includes('two poses'),
    'la raison est ÉCRITE telle quelle : il faut deux poses pour un film');
  eq(keyframePlan({ keyframes: [keys[0]], fps: 10, width: 8, height: 8 }).ok, false,
    'UNE pose n\'est pas un film (on ne morphe vers rien)');
  ok(keyframePlan({ keyframes: [keys[0]], fps: 10, width: 8, height: 8 }).reason.includes('Capture'),
    '… et la raison dit quoi faire : capturer une seconde pose');
  const noSize = keyframePlan({ keyframes: keys, fps: 10, width: 0, height: 480 });
  eq(noSize.ok, false, 'un canvas sans largeur ne peut rien enregistrer');
  ok(noSize.reason.includes('no size'), '… et le plan le dit');
  eq(noSize.width, 0, 'la taille rapportée reste celle du canvas (0)');
  eq(keyframePlan({ keyframes: keys, fps: 0, width: 8, height: 8 }).fps, VIDEO_MIN_FPS,
    'un taux trop bas est ramené au minimum que le panneau offre');
  eq(keyframePlan({ keyframes: keys, fps: 999, width: 8, height: 8 }).fps, VIDEO_MAX_FPS,
    'un taux trop haut est ramené au maximum commun de la 🎬');
  eq(keyframePlan({ keyframes: keys, fps: 'nope', width: 8, height: 8 }).fps, VIDEO_DEFAULT_FPS,
    'un taux illisible retombe sur le taux par défaut');
  eq(keyframePlan({}).ok, false, 'un plan demandé sans rien ne casse pas et ne promet rien');

  const tiny = keyframePlan({ keyframes: [kf({ hold: 0, morph: 0 }), kf({ hold: 0, morph: 0 })], fps: 10, width: 8, height: 8 });
  ok(tiny.totalSeconds >= KEYFRAME_MIN_MORPH,
    'deux poses font TOUJOURS un film d\'au moins KEYFRAME_MIN_MORPH (aucune division par zéro)');
  eq(sampleKeyframeFilm([kf({ hold: 0, morph: 0, state: { x: 0 } }), kf({ hold: 0, morph: 0, state: { x: 1 } })], 0.02).kind,
    'morph', '… et l\'échantillonneur sait le diviser');

  const huge = keyframePlan({
    keyframes: Array.from({ length: KEYFRAME_LIMITS.keys }, () => kf({ hold: 30, morph: 30 })),
    fps: VIDEO_MAX_FPS, width: 640, height: 480,
  });
  eq(huge.ok, false, 'un film qui demanderait trop de frames est refusé AVANT le clic');
  ok(huge.reason.includes(String(VIDEO_MAX_FRAMES)),
    'la raison écrit le plafond de frames, pour que l\'utilisateur sache quoi raccourcir');
  eq(huge.frames, VIDEO_MAX_FRAMES, 'les frames rapportées sont plafonnées');
  /* Un film LONG mais enregistrable (210 s à 1 fps = 210 frames) : le panneau
     doit le signaler, comme la 🎬 signale un run long. */
  const longFilm = keyframePlan({
    keyframes: Array.from({ length: 4 }, () => kf({ hold: 30, morph: 30 })),
    fps: VIDEO_MIN_FPS, width: 640, height: 480,
  });
  ok(longFilm.ok, 'un film de 3 min 30 reste enregistrable');
  ok(longFilm.seconds >= VIDEO_LONG_RUN_SECONDS, '… et il dépasse le seuil de « film long »');
  eq(longFilm.long, true, 'le plan le signale : le panneau prévient avant d\'attendre');
}

/* ── 9. La ligne écrite sous les boutons, et le temps de chaque frame ──── */
{
  const keys = [kf({ id: 'a', hold: 0.5, morph: 2, easing: 'linear' }), kf({ id: 'b', hold: 0.5, morph: 0 })];
  const plan = keyframePlan({ keyframes: keys, fps: 10, width: 640, height: 480 });
  const line = keyframeFilmSummary(2, plan);
  ok(line.includes('2 poses'), 'la ligne dit combien de poses le film tient');
  ok(line.includes('30 frames'), '… combien de frames seront écrites');
  ok(line.includes('10 fps'), '… à quel taux');
  ok(line.includes(plan.secondsText), '… et combien de temps cela dure');
  ok(line.includes('640×480 px'), '… et la taille de ce qui est enregistré');
  ok(line.includes('Mbps'), '… et le débit demandé à l\'encodeur');
  ok(!line.includes('⚠️'), 'une ligne d\'un film possible ne crie pas');
  ok(keyframeFilmSummary(1, { ok: true, frames: 1, fps: 10, secondsText: videoSecondsText(0.1), width: 8, height: 8, bitrate: 1e6 })
    .includes('1 pose · 1 frame at'), 'la ligne écrit « 1 pose » et « 1 frame » au singulier');
  ok(keyframeFilmSummary(2, keyframePlan({ keyframes: [], fps: 10, width: 8, height: 8 })).startsWith('⚠️'),
    'un film impossible est annoncé par la ligne elle-même');
  ok(keyframeFilmSummary(0, null) === '', 'sans plan, il n\'y a rien à dire');

  eq(plan.timeAt(0), 0, 'la frame 0 est le tout premier instant du film');
  near(plan.timeAt(plan.frames - 1), plan.totalSeconds, 'la DERNIÈRE frame est la toute fin du film', 1e-9);
  eq(plan.timeAt(-4), 0, 'une frame négative est ramenée à la première');
  near(plan.timeAt(9999), plan.totalSeconds, 'une frame au-delà est ramenée à la dernière', 1e-9);
  const times = Array.from({ length: plan.frames }, (_, i) => plan.timeAt(i));
  ok(times.every((t, i) => i === 0 || t >= times[i - 1]), 'les instants des frames ne reculent jamais');
  ok(times.every((t) => t >= 0 && t <= plan.totalSeconds), 'aucun instant de frame ne sort du film');
  const first = sampleKeyframeFilm(keys, plan.timeAt(0));
  const last = sampleKeyframeFilm(keys, plan.timeAt(plan.frames - 1));
  eq(first.state, keys[0].state, 'la première frame écrite EST la première pose capturée');
  eq(last.state, keys[1].state, 'la dernière frame écrite EST la dernière pose capturée');
  eq(keyframePlan({ keyframes: [keys[0]], fps: 10, width: 8, height: 8 }).timeAt(0), 0,
    'un plan sans frame répond un temps valable (jamais NaN)');
}

/* ── 10. Le magasin du navigateur : ce qui est écrit est ce qui se relit ── */
{
  const empty = normalizeKeyframeFilm({});
  eq(empty.v, KEYFRAME_STORE_VERSION, 'un film vide est écrit à la version du magasin');
  eq(empty.keys.length, 0, 'un film vide n\'a aucune pose');
  eq(empty.fps, VIDEO_DEFAULT_FPS, '… et prend le taux par défaut');
  eq(empty.easing, KEYFRAME_DEFAULT_EASING, '… et l\'easing par défaut');
  eq(empty.hold, KEYFRAME_DEFAULT_HOLD, '… et la tenue par défaut');
  eq(empty.morph, KEYFRAME_DEFAULT_MORPH, '… et le morphème par défaut');
  eq(normalizeKeyframeFilm(null).keys.length, 0, 'un magasin absent donne un film vide, pas une erreur');

  const bad = normalizeKeyframeFilm({
    fps: 999, easing: 'wobble', hold: 999, morph: -4,
    keys: [{ state: { a: 1 } }, 'nope', 42, ['x'], { nope: true }, null],
  });
  eq(bad.fps, VIDEO_DEFAULT_FPS, 'un taux qui n\'est pas offert par le panneau est remplacé');
  eq(normalizeKeyframeFilm({ fps: VIDEO_FPS_CHOICES[2], keys: [] }).fps, VIDEO_FPS_CHOICES[2],
    'un taux offert par le panneau est gardé tel quel');
  eq(bad.easing, KEYFRAME_DEFAULT_EASING, 'un easing inconnu est remplacé');
  eq(bad.hold, KEYFRAME_LIMITS.hold[1], 'une tenue trop longue est ramenée à sa borne');
  eq(bad.morph, KEYFRAME_LIMITS.morph[0], 'un morphème négatif est ramené à sa borne');
  eq(bad.keys.length, 1, 'les entrées qui ne font pas une pose sont ÉCARTÉES, pas devinées');
  eq(bad.keys[0].state.a, 1, '… et la pose valable, elle, est gardée');
  eq(bad.keys[0].name, 'Pose 1', 'une pose sans nom reçoit son rang');

  const wide = normalizeKeyframeFilm({
    fps: 10,
    keys: Array.from({ length: KEYFRAME_LIMITS.keys + 5 }, (_, i) => ({ state: { i }, name: `P${i}` })),
  });
  eq(wide.keys.length, KEYFRAME_LIMITS.keys,
    'un magasin qui contient plus de poses que la limite est coupé : le panneau ne peut pas montrer ce qu\'il ne sait pas montrer');
  eq(wide.keys[0].name, 'P0', 'les premières poses sont gardées, dans l\'ordre');

  const one = normalizeKeyframe({ state: {}, name: '   ', hold: 'abc', easing: 'wobble', pose: [{ key: 'main' }, 5, {}, { key: 3 }] });
  eq(one.name, 'Pose 1', 'un nom vide est remplacé');
  eq(one.hold, KEYFRAME_DEFAULT_HOLD, 'une tenue illisible retombe sur la tenue par défaut');
  eq(one.easing, KEYFRAME_DEFAULT_EASING, 'un easing illisible retombe sur le lisse');
  eq(one.pose.length, 1, 'seules les poses de molécule qui ont une clé sont gardées');
  eq(one.pose[0].key, 'main', '… et elles gardent leur clé');
  eq(normalizeKeyframe({ nope: true }), null, 'une entrée sans photo n\'est pas une pose');
  eq(normalizeKeyframe(null), null, 'une entrée nulle n\'est pas une pose');
  eq(normalizeKeyframe([{ state: {} }]), null, 'une liste n\'est pas une pose');
  eq(normalizeKeyframe({ state: {}, name: 'x'.repeat(200) }).name.length, 48,
    'un nom trop long est coupé (il doit tenir dans la rangée)');
  ok(nextKeyframeId() !== nextKeyframeId(),
    'deux poses capturées dans la même milliseconde ne partagent pas leur id');
  eq(normalizeKeyframe({ id: 'mine', state: {} }).id, 'mine', 'un id écrit est gardé (les poses ne se ré-identifient pas)');

  const film = normalizeKeyframeFilm({
    fps: 20, easing: 'hold', hold: 2, morph: 1.5,
    keys: [{ id: 'k1', name: 'Start', hold: 1, morph: 3, easing: 'in', state: { bg: '#112233', extras: [{ id: 'x' }] }, pose: [{ key: 'main', position: [1, 2, 3], quaternion: [0, 0, 0, 1] }] }],
  });
  const back = parseKeyframeFilm(serialiseKeyframeFilm(film));
  deep(back, film, 'ce qui est écrit se relit à l\'IDENTIQUE (ids, poses, réglages, poses de molécule)');
  deep(parseKeyframeFilm(serialiseKeyframeFilm(film)).keys[0].pose, film.keys[0].pose,
    '… y compris les positions et les orientations des molécules');
  eq(back.keys[0].id, 'k1', 'un id ne change pas en passant par le magasin (les poses restent les mêmes)');
  deep(parseKeyframeFilm('{oops'), empty, 'un magasin abîmé donne un film vide — il ne bloque JAMAIS le panneau');
  deep(parseKeyframeFilm(''), empty, 'un magasin vide donne un film vide');
  deep(parseKeyframeFilm(null), empty, 'un magasin illisible (rien du tout) donne un film vide');
  deep(parseKeyframeFilm('{"keys":[{"state":{"a":1}}]}').keys[0].state, { a: 1 },
    'un film écrit à la main est lu et normalisé');
  const slim = slimKeyframeState({ pymol: { windows: 1 }, savedAt: 12345, fog: true, radius: 0.3 });
  deep(slim, { fog: true, radius: 0.3 }, 'une pose ne garde ni la session PyMOL ni le tampon de la capture');
  ok(slim.pymol === undefined && slim.savedAt === undefined, '… les deux sont bien absents');
  deep(slimKeyframeState('nope'), {}, 'un setup qui n\'est pas un objet donne un état vide, jamais une exception');
  deep(slimKeyframeState(null), {}, 'un setup absent donne un état vide');
}

/* ── 11. La pose d'une molécule : où elle est ET comment elle est tournée ─ */
{
  /* Une matrice monde 4×4 en colonnes, comme NGL la tient (m[c * 4 + r]). */
  const mat4 = (rot, t = [0, 0, 0]) => [
    rot[0][0], rot[1][0], rot[2][0], 0,
    rot[0][1], rot[1][1], rot[2][1], 0,
    rot[0][2], rot[1][2], rot[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const Z90 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];

  const moved = keyframePoseOf('main', mat4(I, [1, 2, 3]), null, [0, 0, 0]);
  eq(moved.key, 'main', 'une pose de molécule porte la clé de sa molécule (la même que la Molecules bar)');
  deep(moved.position, [1, 2, 3], 'sans position rapportée, la décomposition donne le déplacement monde');
  near(moved.quaternion[3], 1, 'une molécule non tournée garde l\'orientation identité');
  ok(moved.quaternion.every((n) => Number.isFinite(n)), 'la rotation rapportée est faite de nombres finis');
  const same = keyframePoseOf('main', mat4(I, [1, 2, 3]), null, [5, -2, 0.5]);
  deep(same.position, [1, 2, 3],
    'la position rapportée ne dépend pas du centre choisi (c\'est un déplacement, pas une coordonnée absolue)');
  const given = keyframePoseOf('main', mat4(I, [1, 2, 3]), [9, 8, 7], [0, 0, 0]);
  deep(given.position, [9, 8, 7],
    'la position rapportée par la composante est PRÉFÉRÉE : c\'est exactement ce que setPosition reprend');
  deep(keyframePoseOf('main', mat4(I, [1, 2, 3]), [9, 8], [0, 0, 0]).position, [1, 2, 3],
    'une position qui n\'a pas trois nombres est refusée (la décomposition reprend la main)');
  deep(keyframePoseOf('main', mat4(I, [1, 2, 3]), ['a', 'b', 'c'], [0, 0, 0]).position, [1, 2, 3],
    'une position faite de mots est refusée aussi');
  const turned = keyframePoseOf('main', mat4(Z90, [0, 0, 0]), null, [0, 0, 0]);
  near(turned.quaternion[2], Math.SQRT1_2, 'un quart de tour autour de Z est lu dans la matrice', 1e-6);
  near(turned.quaternion[3], Math.SQRT1_2, '… avec le bon signe (le fit et la lecture parlent la même langue)', 1e-6);
  deep(turned.position.map((n) => Math.round(n)), [0, 0, 0],
    'une molécule tournée autour de son centre ne se déplace pas');
  eq(keyframePoseOf(7, mat4(I), null, null).key, '7', 'une clé qui n\'est pas un mot est écrite en texte');
  const centre = keyframePoseOf('main', mat4(Z90, [0, 0, 0]), null, [1, 0, 0]);
  near(centre.position[0], -1, 'tourner autour du centre fait bien bouger le déplacement rapporté');
  eq(keyframePoseOf('main', null, null, null).quaternion.length, 4,
    'une molécule sans matrice rend tout de même quatre nombres (le panneau ne lit jamais undefined)');
  const broken = keyframePoseOf('main', null, null, null);
  ok(slerpQuat(broken.quaternion, [0, 0, 0, 1], 0.5).every((n) => Number.isFinite(n)),
    'une pose illisible ne peint pas de NaN : le mélange retombe sur l\'orientation valable');
  const roundTrip = sampleKeyframeFilm([
    kf({ hold: 0, morph: 1, easing: 'linear', pose: [moved] }),
    kf({ hold: 1, morph: 0, pose: [given] }),
  ], 0.5);
  deep(roundTrip.pose[0].position, [5, 5, 5],
    'deux poses de molécule capturées par ce chemin se morphent : rien ne revient en arrière d\'un coup');
}

/* ── 12. Le panneau 🎞 DANS le viewer : ses gestes, UNE seule mise à l’écran ─
   Les sections ci-dessus ont vérifié le MODULE ; celles-ci vérifient le CÂBLAGE,
   c’est-à-dire ce que le viewer fait de ces cinq fonctions. Un module juste mais
   mal branché ne montre rien : c’est ici que la demande — capturer une pose,
   morpher vers la suivante, écrire le morphème — se joue vraiment. Trois faits :
   les gestes existent UNE fois au niveau du composant ; UNE seule fonction met un
   instant à l’écran (donc le film VU est le film ÉCRIT) ; le film ne part nulle
   part. */
{
  /* Les bornes du sujet : deux marqueurs (l’état / les gestes) et le marqueur
     suivant (le ⬇ PDB), pour que les assertions ci-dessous portent sur le bloc 🎞
     et pas sur le fichier — sinon « six appels » ne dirait rien. */
  const A_STATE = VIEWER.indexOf('/* ---- 🎞 THE POSES & STYLES FILM');
  const A_GEST = VIEWER.indexOf('// ---- 🎞 POSES & STYLES');
  const A_PDB = VIEWER.indexOf('// ---- ⬇ PDB of the structure');
  const A_MEAS = VIEWER.indexOf('// ---- 📏 Measurement helpers');
  ok(A_STATE > 0 && A_MEAS > A_STATE, 'la 🎞 a son bloc d’état, comme la 🎬 de la trajectoire a le sien');
  ok(A_GEST > A_STATE && A_PDB > A_GEST,
    'les gestes de la 🎞 ont leur bloc à EUX (entre l’état et le ⬇ PDB) : il se lit d’un seul tenant');
  const panel = VIEWER.slice(A_GEST, A_PDB);   // les gestes, rien que les gestes
  const store = VIEWER.slice(A_STATE, A_MEAS); // l’état, le plan, le magasin
  ok(panel.length > 8000 && store.length > 3000,
    'les deux blocs sont de vrais blocs (des milliers de caractères, pas trois lignes de commentaire)');

  /* 1. LES GESTES. Un par un, UNE définition, écrite à la colonne du corps du
        composant — donc joignable depuis le JSX. Un geste défini deux fois, ou
        dans une autre portée, est du code que rien n’appelle : ça ne se voit
        qu’en cliquant sur le bouton, c’est-à-dire jamais. */
  const gestures = ['captureKeyframe', 'updateKeyframe', 'recaptureKeyframe', 'removeKeyframe',
    'moveKeyframe', 'duplicateKeyframe', 'clearKeyframes', 'showKeyframe',
    'previewKeyframeFilm', 'stopKeyframeFilm', 'recordKeyframeFilmClick',
    'exportKeyframeFilm', 'importKeyframeFilm', 'captureKeyframePoses',
    'applyKeyframePoses', 'applyKeyframeSample'];
  deep(gestures.filter((n) => countIn(panel, `const ${n} = `) !== 1), [],
    'chaque geste du panneau (capturer, recapturer, se placer, bouger, copier, effacer, jouer, écrire, lire, exporter, importer) est défini une fois dans son bloc');
  deep(gestures.filter((n) => countIn(VIEWER, `const ${n} = `) !== 1), [],
    '… et nulle part ailleurs dans le fichier : aucun geste recopié plus bas qui ne s’exécuterait jamais');
  deep(gestures.filter((n) => !new RegExp(`^const ${n} = `, 'm').test(VIEWER)), [],
    '… et tous à la colonne du corps du composant (pas enfouis dans une autre fonction, où le JSX ne les verrait pas)');
  ok(new RegExp('^const recordTrajectoryVideoClick = ', 'm').test(VIEWER)
    && new RegExp('^const captureViewerSetup = ', 'm').test(VIEWER),
    'c’est bien le niveau où vivent les gestes du viewer qui existaient déjà (🎬, photographie de la scène)');

  /* 2. UNE SEULE FONCTION MET UN INSTANT À L’ÉCRAN. `applyKeyframeSample` est le
        seul endroit qui applique une photographie (applyViewerSetup) ET les
        orientations (applyKeyframePoses) ; ses six appelants — la pose cliquée,
        le début du ▶, sa fin, chaque image du ▶, chaque image du 🔴, et le retour
        de la scène — passent tous par elle. Le film VU est donc littéralement le
        film ÉCRIT : il n’existe pas de second moteur qui pourrait en diverger. */
  eq(countIn(VIEWER, 'applyKeyframeSample('), 6,
    'six endroits du viewer mettent un instant du film à l’écran (la pose, le début et la fin du ▶, chaque image du ▶, chaque image du 🔴, le retour)');
  eq(countIn(panel, 'applyKeyframeSample('), 6, '… et les six sont dans le bloc 🎞 (le panneau ne fuit pas dans le reste du viewer)');
  eq(countIn(VIEWER, 'applyViewerSetup(sample.state)'), 1,
    'une seule fonction écrit la PHOTOGRAPHIE d’un instant (styles, palettes, caméra, position) — et c’est celle-là');
  eq(countIn(VIEWER, 'applyKeyframePoses(sample.pose)'), 1,
    '… et elle écrit les ORIENTATIONS au même endroit, dans le même geste (jamais l’un sans l’autre)');
  eq(countIn(VIEWER, 'sampleKeyframeFilm('), 4,
    'l’échantillonneur du module (« qu’y a-t-il à l’écran à t ? ») est appelé quatre fois : une pose, le début du ▶, sa fin, chaque image du 🔴');
  eq(countIn(panel, 'applyKeyframeSample(sampleKeyframeFilm('), 4,
    '… et ces quatre appels finissent à l’écran par la MÊME fonction : le ▶ de contrôle et le 🔴 lisent la même chronologie');
  ok(panel.includes('presentFrame: (i) => applyKeyframeSample(sampleKeyframeFilm(keys, plan.timeAt(i)))'),
    'l’image i du film écrit est l’instant plan.timeAt(i) du geste — exactement ce que le ▶ montre au même moment');

  /* Le corps d’un geste, du `const` à l’accolade qui le ferme à la colonne 0. */
  const bodyOf = (name) => {
    const rest = panel.slice(panel.indexOf(`const ${name} = `));
    return rest.slice(0, rest.indexOf('\n};'));
  };
  const sample = bodyOf('applyKeyframeSample');
  ok(sample.length > 100 && sample.includes('applyViewerSetup(sample.state)')
    && sample.includes('applyKeyframePoses(sample.pose)'),
    'la fonction qui met un instant à l’écran est courte et fait les deux : la photographie, puis les orientations');
}

/* ── 13. Le panneau 🎞 (suite) : les outils partagés, le magasin, les boutons ─
   Le panneau des poses n’invente ni enregistreur, ni canvas, ni vocabulaire : il
   réutilise ceux du 🎬 de la trajectoire, comme le ✨ Ray réutilise la
   photographie de la scène. Et il ne parle à personne : le film est écrit sur
   l’ordinateur. */
{
  const A_STATE = VIEWER.indexOf('/* ---- 🎞 THE POSES & STYLES FILM');
  const A_GEST = VIEWER.indexOf('// ---- 🎞 POSES & STYLES');
  const A_PDB = VIEWER.indexOf('// ---- ⬇ PDB of the structure');
  const A_MEAS = VIEWER.indexOf('// ---- 📏 Measurement helpers');
  const panel = VIEWER.slice(A_GEST, A_PDB);
  const store = VIEWER.slice(A_STATE, A_MEAS);

  /* 3. UN SEUL MÉCANISME POUR DEUX FILMS. Si le 🎞 avait son propre enregistreur,
     son propre canvas ou sa propre liste de taux, les deux films pourraient
     diverger (l’un écrirait ce que l’autre ne montre pas). */
  eq(countIn(VIEWER, 'recordTrajectoryVideo('), 2,
    'une seule fonction enregistre le canvas : la 🎬 l’appelle, la 🎞 l’appelle aussi — et personne d’autre');
  eq(countIn(VIEWER, 'presentFrame'), 2, '… et les deux la conduisent par un presentFrame (l’image i du film)');
  eq(countIn(VIEWER, 'canvasOfStage('), 3, 'un seul canvasOfStage : le canvas que NGL dessine est lu pareil des deux côtés');
  eq(countIn(VIEWER, 'bestVideoMime'), 3,
    'un seul bestVideoMime (le codec demandé au navigateur) : les deux films écrivent le même genre de fichier');
  eq(countIn(VIEWER, 'videoProgressText('), 2, 'les deux films comptent leurs images avec le même texte');
  eq(countIn(VIEWER, 'videoSecondsText('), 4,
    'la durée d’un film s’écrit partout avec le même texte (la barre, la rangée des poses, le message de fin)');
  eq(countIn(VIEWER, 'VIDEO_FPS_CHOICES.map((f) => <option key={f} value={f}>{f} fps</option>)'), 2,
    'les deux films offrent EXACTEMENT la même liste de taux : un seul vocabulaire, écrit une fois et lu deux fois');
  eq(countIn(VIEWER, 'KEYFRAME_EASINGS.map'), 1,
    'et les cinq façons d’aller d’une pose à la suivante sont offertes une fois, depuis la liste du module');
  hasIn(VIEWER, '<option key={name} value={name}>{KEYFRAME_EASING_LABELS[name] || name}</option>',
    '… chaque easing par le nom que le MODULE lui donne (aucun select muet, aucune sixième façon inventée ici)');
  hasIn(VIEWER, "previewUrlOf, releasePreviewUrl, downloadBlob,\n} from '../utils/viewerRayImage';",
    'un film s’écrit sur l’ordinateur avec le downloadBlob du ✨ Ray : une seule façon de rendre un fichier');
  eq(countIn(panel, 'downloadBlob('), 2, '… et le panneau s’en sert deux fois : le film (.webm) et le film lui-même (.json)');
  eq(countIn(panel, 'molKeysInBar('), 1,
    'les molécules d’une pose sont lues par le même molKeysInBar que la Molecules bar (une seule clé par molécule)');
  eq(countIn(VIEWER, 'nextKeyframeId'), 0,
    'le panneau n’invente pas d’id : le normalisateur du module s’en charge (deux poses ne peuvent pas se confondre)');
  eq(countIn(VIEWER, 'KEYFRAME_MIN_MORPH'), 0,
    '… et il ne rouvre pas à la main les bornes du module (le morphème nul reste impossible)');

  /* 4. RIEN NE PART. Un film de poses est écrit sur l’ordinateur, jamais envoyé :
     c’est la même promesse que celle de la 🎬, écrite dans son panneau. */
  eq(countIn(panel, 'archiveFileToDrive'), 0, 'le panneau 🎞 n’envoie rien vers le Drive (le rapport de session, lui, en a un)');
  eq(countIn(VIEWER, 'fetch(') + countIn(VIEWER, 'XMLHttpRequest') + countIn(VIEWER, 'sendBeacon'), 0,
    '… et ce viewer n’ouvre aucun réseau non plus : le film, ses poses et sa capture ne quittent pas la machine');
  hasIn(VIEWER, 'written on this computer', 'le message de fin DIT où le fichier a été écrit');

  /* 5. LE MAGASIN DU NAVIGATEUR. Une pose qu’on perd en fermant l’onglet n’est pas
     une pose : le film (poses ET réglages) est retenu comme les autres
     préférences du viewer — et un magasin plein ne casse jamais le panneau. */
  eq(countIn(store, 'KEYFRAME_STORE_KEY'), 3, 'le magasin 🎞 a un nom, et c’est par lui qu’il est lu ET écrit');
  hasIn(store, 'try { return parseKeyframeFilm(localStorage.getItem(KEYFRAME_STORE_KEY)); } catch { return normalizeKeyframeFilm({}); }',
    'au premier rendu, le film est relu du navigateur par le normalisateur, et un magasin abîmé rend un film VIDE (jamais une page blanche)');
  hasIn(store, 'try { localStorage.setItem(KEYFRAME_STORE_KEY, serialiseKeyframeFilm(kfFilm)); } catch { /* ignore */ }',
    '… et réécrit à chaque changement du film, sous try/catch (un magasin plein ne bloque pas la capture)');
  eq(countIn(store, 'keyframePlan('), 1, 'le plan de la 🎞 est lu à chaque rendu, exactement comme celui de la 🎬');
  eq(countIn(store, 'canvasOfStage(') + countIn(store, 'videoSupport()'), 2,
    '… sur le canvas que NGL dessine et sur la réponse du navigateur : la ligne dit ce que le clic écrira, avant le clic');
}

/* ── 14. Le panneau 🎞 (fin) : les boutons, et ce que le panneau PROMET ─────
   Un geste que rien n’appelle est un geste mort : chaque geste est branché sur un
   bouton. Et ce que les titres annoncent est vérifié ici comme le reste — un
   panneau qui dit « rien n’est appliqué » doit l’écrire, sinon l’utilisateur
   croit qu’un fichier reçu change sa scène tout seul. */
{
  const A_GEST = VIEWER.indexOf('// ---- 🎞 POSES & STYLES');
  const A_PDB = VIEWER.indexOf('// ---- ⬇ PDB of the structure');
  const panel = VIEWER.slice(A_GEST, A_PDB);

  /* 6. L’IMPORT N’APPLIQUE RIEN. C’est la promesse du panneau, et elle se lit
     dans le corps du geste : pas un seul appel qui mettrait quelque chose à
     l’écran — ranger le film, oui ; peindre la scène, non. */
  const imp = panel.slice(panel.indexOf('const importKeyframeFilm = '));
  const impBody = imp.slice(0, imp.indexOf('\n};'));
  ok(impBody.length > 200 && impBody.includes('parseKeyframeFilm(await chosen.text())'),
    'l’import relit un film écrit par ⬇ Export (le normalisateur du module décide de ce qu’un fichier a le droit d’être)');
  ok(impBody.includes('setKfFilm(film)'), '… et il le RANGE dans le panneau');
  ok(!impBody.includes('applyKeyframeSample') && !impBody.includes('applyViewerSetup')
    && !impBody.includes('showKeyframe'), '… sans rien appliquer : recevoir un film ne change pas la scène');
  ok(impBody.includes("input.value = ''"), '… et le même fichier peut être relu deux fois de suite');
  ok(impBody.includes('nothing is on screen yet'),
    'le message le DIT à l’utilisateur : ▶ pour jouer le film, 👁 pour aller sur une pose');

  /* 7. LE 🔴 REND LA SCÈNE ET N’ÉCRIT QU’UN FICHIER. Le film est un GESTE : après
     lui, la scène doit être exactement là où elle était — sinon enregistrer un
     film changerait le travail en cours. */
  const rec = panel.slice(panel.indexOf('const recordKeyframeFilmClick = '));
  const recBody = rec.slice(0, rec.indexOf('\n};'));
  ok(recBody.includes('await recordTrajectoryVideo({'),
    'le 🔴 écrit avec le MÊME enregistreur que la 🎬 (captureStream + MediaRecorder, image par image)');
  ok(recBody.includes('const back = { state: captureViewerSetup(), pose: captureKeyframePoses() };'),
    '… après avoir photographié la scène (styles ET orientations) avant de commencer');
  ok(recBody.includes('applyKeyframeSample(back)'),
    '… et il la remet EXACTEMENT en place dans son finally : le film ne laisse que le fichier');
  ok(recBody.includes('requestSceneRepaint'),
    'chaque image présentée est peinte avant d’être écrite (l’enregistreur photographie le canvas)');
  ok(recBody.includes('cancelled: () => kfCancelRef.current') && recBody.includes('kfRunRef.current !== run'),
    '⏹ et un nouveau run arrêtent la boucle : un seul film écrit à la fois');
  ok(recBody.includes('downloadBlob(out.blob, name)') && recBody.includes('videoFileName({'),
    'le fichier s’écrit sur l’ordinateur, nommé par la MÊME fonction de nommage que la 🎬');
  ok(recBody.includes("label: `${label}_poses`"),
    '… avec _poses dans son nom : le film de poses et le film du run d’une même scène se reconnaissent');
  ok(recBody.includes('the browser blocked the download'),
    '… et un navigateur qui bloque le téléchargement le DIT (plutôt que de faire croire à un succès)');
}

/* ── 15. Le panneau 🎞 : chaque geste a son bouton, chaque interdit est dit ──
   Suite du câblage : le JSX lui-même. Un geste peut être parfait et jamais
   branché ; un bouton peut être armé alors que le plan ne tient pas. Les deux se
   lisent ici. */
{
  const wired = ['captureKeyframe', 'previewKeyframeFilm', 'recordKeyframeFilmClick',
    'stopKeyframeFilm', 'exportKeyframeFilm', 'clearKeyframes'];
  deep(wired.filter((n) => !VIEWER.includes(`onClick={${n}}`)), [],
    'chaque geste du panneau est branché sur son bouton : aucun geste orphelin (du code que rien ne peut appeler)');
  ok(VIEWER.includes('onChange={importKeyframeFilm}'),
    '… et un film reçu se lit par un fichier .json (le même chemin que les ⚙️ setups nommés)');
  const rows = ['onClick={() => showKeyframe(k)}', 'onClick={() => moveKeyframe(k.id, -1)}',
    'onClick={() => moveKeyframe(k.id, 1)}', 'onClick={() => duplicateKeyframe(k.id)}',
    'onClick={() => recaptureKeyframe(k.id)}', 'onClick={() => removeKeyframe(k.id)}'];
  deep(rows.filter((w) => !VIEWER.includes(w)), [],
    'chaque ligne de pose porte ses six gestes (👁 la montrer, ◀ ▶ la déplacer, ⧉ la copier, 📸 la recapturer, ✕ l’enlever)');
  eq(countIn(VIEWER, 'updateKeyframe(k.id,'), 4,
    '… et ses quatre champs s’éditent sur place (nom, tenue, morphème, easing)');
  hasIn(VIEWER, '＋ Capture this pose', 'le premier geste est dit en clair dans le panneau');
  hasIn(VIEWER, "{kfPreview ? '⏹ Stop the preview' : '▶ Preview the film'}",
    'le ▶ de contrôle change de nom quand il joue : un bouton, deux états, jamais deux boutons');
  hasIn(VIEWER, 'Nothing is applied to the scene when it is read: ▶ plays it, 👁 goes to one pose.',
    'l’import DIT qu’il n’applique rien (l’utilisateur n’a pas à le deviner)');
  hasIn(VIEWER, 'Nothing here is on screen until you press 👁 on a pose, ▶ to play',
    '… et la ligne du panneau le redit : rien n’est à l’écran tant qu’un geste ne le demande pas');
  hasIn(VIEWER, 'disabled={kfBusy || !kfPlanNow.ok || !videoReady.ok}',
    'le 🔴 n’est armé que si le navigateur sait enregistrer ET que le plan tient (le plan est lu avant le clic)');
  hasIn(VIEWER, 'disabled={kfBusy || keyframes.length < 2}',
    'le ▶ de contrôle demande au moins deux poses — un film d’une seule pose ne morphe rien');
  hasIn(VIEWER, "{kfBusy ? '🔴 Writing the film…' : '🔴 Record the film'}",
    'pendant l’écriture, le bouton le dit — et ⏹ n’apparaît qu’alors');
  hasIn(VIEWER, 'The scene comes back exactly where it was, and ⏹ Stop ends the recording WITHOUT writing anything.',
    '⏹ est annoncé pour ce qu’il est : on s’arrête sans rien écrire (le film d’un demi-geste n’est pas le geste)');
  hasIn(VIEWER, 'const { legs, totalSeconds } = keyframeLegs(keyframes);',
    'la rangée des poses lit la chronologie du film (keyframeLegs) — la même que le ▶ et le 🔴, donc elle ne peut pas mentir');
  hasIn(VIEWER, 'The film lasts <b className="font-mono">',
    '… et la durée du film est écrite sous la rangée, dans le même texte que partout ailleurs');
  hasIn(VIEWER, '{keyframes.length} / {KEYFRAME_LIMITS.keys} poses',
    'le panneau montre où en est le film par rapport à la limite du module');
  hasIn(VIEWER, '⬇ Export the film (.json)',
    'le film LUI-MÊME s’exporte : les poses voyagent (ce sont des réglages, pas des coordonnées)');
  hasIn(VIEWER, '🎞 Poses & styles', 'et tout cela vit dans une section du viewer, nommée 🎞');
}

/* ── 16. L’ADDITIVITÉ : la 🎬 de la trajectoire est INTACTE ────────────────
   Le panneau 🎞 a été ajouté À CÔTÉ du 🎬, pas par-dessus : les deux écrivent un
   film du MÊME canvas, et c’est justement pour ça qu’ils ne doivent se disputer
   ni l’état, ni les mots, ni les boutons. C’est le seul endroit du film de poses
   où l’on vérifie ce qui n’a PAS changé — et c’est aussi important que le reste :
   une feature qui casse sa voisine n’est pas une feature. */
{
  const A_TRAJ = VIEWER.indexOf('/* ---- 🎬 SAVE THE RUN AS A VIDEO');
  const A_GEST = VIEWER.indexOf('// ---- 🎞 POSES & STYLES');
  const A_PDB = VIEWER.indexOf('// ---- ⬇ PDB of the structure');
  ok(A_TRAJ > 0 && A_GEST > A_TRAJ,
    'les trois blocs se suivent dans cet ordre : 🎬 (le run), 🎞 (les poses), ⬇ PDB — aucun n’écrase l’autre');
  const traj = VIEWER.slice(A_TRAJ, A_GEST);   // le 🎬 seulement
  const panel = VIEWER.slice(A_GEST, A_PDB);   // le 🎞 seulement

  /* 1. LES DEUX ENREGISTREURS NE SE PARLENT PAS. */
  eq(countIn(traj, 'keyframe'), 0, 'la 🎬 ne connaît pas le mot « keyframe » : deux features, deux blocs');
  eq(countIn(traj, 'kfRunRef') + countIn(traj, 'kfCancelRef') + countIn(traj, 'kfPreviewRef'), 0,
    '… ni une seule des références du panneau 🎞 : le ⏹ de l’un n’arrête pas l’autre par accident');
  eq(countIn(panel, 'trajStatus') + countIn(panel, 'keptFrames') + countIn(panel, 'videoRunRef'), 0,
    '… et le panneau 🎞 ne lit ni l’état de la trajectoire, ni ses images gardées, ni son numéro de run');
  eq(countIn(panel, 'videoBusy') + countIn(panel, 'setVideoBusy'), 0,
    '… ni le drapeau d’enregistrement de la 🎬 : chacun a le sien (kfBusy), donc les deux films ne se bloquent pas l’un l’autre');
  eq(countIn(panel, 'videoFps') + countIn(panel, 'videoStep') + countIn(panel, 'setVideoMsg'), 0,
    '… ni ses préférences, ni ses messages : le panneau 🎞 a les siens (kfFps vit dans le film des poses)');
  eq(countIn(panel, 'toActualFrame') + countIn(panel, 'numFrames'), 0,
    '… et surtout : le film de poses ne DÉPLACE jamais la frame affichée de la trajectoire (un film de poses n’est pas un run)');
  eq(countIn(panel, 'setPlaying('), 2,
    'la 🎞 se contente d’ARRÊTER la lecture de la trajectoire quand elle prend l’image (une seule image à la fois)');

  /* 2. LE GESTE 🎬 LUI-MÊME : même garde, même fin, mêmes mots, mêmes boutons. */
  eq(countIn(VIEWER, 'recordTrajectoryVideoClick'), 2,
    'le geste 🎬 est inchangé : une définition et son bouton — et rien de la 🎞 n’y touche');
  hasIn(traj, 'if (videoBusy) return;', 'la 🎬 garde sa garde d’entrée : un seul enregistrement à la fois');
  eq(countIn(traj, 'setVideoBusy(false)'), 2,
    '… et sa fin retombe des deux côtés (⏹ et la fin normale) : la barre ne reste jamais bloquée');
  eq(countIn(traj, 'finally {'), 1,
    '… dont le finally qui remet le drapeau : c’est lui qui rend la main même quand ça se passe mal');
  eq(countIn(traj, 'presentFrame'), 1, 'la 🎬 conduit toujours l’enregistreur par un index de frame, comme avant');
  hasIn(traj, 'keep this tab in the foreground', 'la 🎬 dit toujours que l’onglet doit rester au premier plan');
  hasIn(VIEWER, 'nothing is uploaded anywhere', '… et que le run, lui non plus, ne part nulle part');
  eq(countIn(traj, 'a film of half a run is not the film of the run'), 3,
    'le ⏹ de la 🎬 dit toujours qu’un demi-run n’est pas le run : ses mots n’ont pas été réécrits');
  eq(countIn(VIEWER, 'the film of half a gesture is not the film of the gesture'), 2,
    '… et le ⏹ de la 🎞 a les SIENS (son message ET son titre) : deux gestes, deux phrases, aucune confusion dans le panneau');
  hasIn(VIEWER, 'onClick={stopTrajectoryVideo}', 'le bouton ⏹ de la 🎬 est toujours là, à sa place');
  hasIn(VIEWER, "{videoBusy ? '🎬 Recording…' : '🎬 Record the run'}", '… et son 🔴 dit toujours ce qu’il fait');
  hasIn(VIEWER, "disabled={videoBusy || trajStatus !== 'ready' || keptFrames === 0 || !videoReady.ok}",
    '… avec exactement la même garde qu’avant (rien à filmer = pas de clic)');
}

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_viewer_keyframes_test.mjs — ${passed} assertions OK (🎞 poses & styles : capturer, morpher, écrire le film)`);









