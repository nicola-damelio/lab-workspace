/* =========================================================================
   _condition_page_test.mjs — LA PAGE SUIT LA CONDITION AFFICHÉE
   (et la dernière modification part même si on ferme pendant le différé).

   Défaut signalé le 20/09/2026 : « la page MD ne s'actualise pas — j'ai chargé
   un PDB et une trajectoire, supprimé une instance, puis dans une fenêtre de
   navigation privée les données étaient DIFFÉRENTES ».

   Cause : changer de condition (onglets « Date / Conditions ») ne REMONTE pas la
   page d'expérience — seul `activeTest` change. Les états propres à une
   condition gardaient donc la valeur de la précédente :
     • la page MD annonçait la trajectoire / la topologie de l'AUTRE condition
       (`✓ Trajectory: <fichier précédent>`) et le viewer 3D rendait l'autre
       système ;
     • la restauration de la nouvelle condition ne partait JAMAIS (les effets
       sortent tôt dès qu'un fichier est déjà « en main ») : un PDB ou un .xtc
       présent sur le Drive n'était pas re-téléchargé ;
     • une fenêtre neuve (privée, autre poste) part de zéro, relit ses fichiers,
       et montrait donc autre chose pour la MÊME condition.

   Deuxième trou, même symptôme : la sauvegarde Firestore est différée (~1,5 s) et
   seul le contenu du Drive était vidé à la fermeture de l'onglet. Un changement
   suivi d'une fermeture (ou d'un passage en arrière-plan) dans cet intervalle
   n'atteignait jamais le cloud — l'autre fenêtre voyait l'état d'AVANT (« une
   condition supprimée qui revient », « le fichier ajouté n'est pas là »).

   Vérifié ici (assertions de source, comme _drive_restore_test.mjs : la
   mécanique vit dans des hooks React, impossibles à monter hors navigateur) :
   la remise à niveau par condition, le relancement des restaurations, le
   portillon NMR et l'envoi immédiat de la sauvegarde qui attend.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MD = readFileSync('src/components/MDSections.jsx', 'utf8');
const NMR = readFileSync('src/components/NMRSections.jsx', 'utf8');
const VIEW = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const APP = readFileSync('src/App.jsx', 'utf8');
const DOC = readFileSync('docs/DRIVE-MIRROR.md', 'utf8');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const countOf = (src, needle) => src.split(needle).length - 1;

/* ══ 1. LA PAGE MD EST CELLE DE LA CONDITION AFFICHÉE ══════════════════════ */

has(MD, 'const mdSetupIdRef = useRef(activeTest.id);',
  '[MD] la page retient la condition qu’elle affiche');
has(MD, 'if (activeTest.id === mdSetupIdRef.current) return;',
  '[MD] …et ne fait rien tant que la condition n’a pas changé');
has(MD, 'mdSetupIdRef.current = activeTest.id;',
  '[MD] le changement de condition est constaté une seule fois');

/* L'état des fichiers est REMIS À CELUI DE LA CONDITION (jamais l'ancien). */
has(MD, 'setTrajectoryFile(localFileCache.get(activeTest.id)?.trajectory || null);',
  '[MD] la trajectoire suit la condition affichée (celle de CETTE condition, ou rien)');
has(MD, 'setStructureFile(localFileCache.get(activeTest.id)?.structure || null);',
  '[MD] la topologie aussi (le viewer 3D ne rend plus l’autre système)');
has(MD, "setTrajDriveMsg('');", '[MD] le message de l’autre condition est effacé');

/* ══ 2. LE VIEWER 3D NMR : MÊME DÉFAUT, MÊME REMISE À NIVEAU ═══════════════ */

has(NMR, 'const nmrStructPageIdRef = useRef(activeTest.id);',
  '[NMR] la page retient la condition qu’elle affiche');
has(NMR, 'const nmrConditionChanged = nmrStructPageIdRef.current !== activeTest.id;',
  '[NMR] le changement de condition est calculé AVANT le portillon du Drive');
has(NMR, 'setStructureFile(nmrLocalFileCache.get(activeTest.id)?.structure || null);',
  '[NMR] le PDB affiché suit la condition (celui de CETTE condition, ou rien)');
has(NMR, 'setStructFileEpoch((n) => n + 1);',
  '[NMR] un jeton relance la restauration depuis la base du navigateur');
has(NMR, '}, [activeTest.id, activeTest.structureFileName, structFileEpoch]);',
  '[NMR] l’effet de restauration dépend du jeton');
has(NMR, 'if (structureFile && !nmrConditionChanged) return false;',
  '[NMR] « déjà en main » ne vaut que pour la condition affichée');
ok(!NMR.includes('    if (structureFile) return false;'),
  '[NMR] le fichier laissé par la condition précédente ne bloque plus le Drive');


/* ══ 3 bis. UN CALCUL LONG ÉCRIT — ET NE PEINT — QUE SUR LA CONDITION
   QU'IL A MESURÉE ════════════════════════════════════════════════════════════ */

const ATM = readFileSync('src/components/AppModules/activeTestModule.jsx', 'utf8');
has(ATM, "const updateActiveTest = (updates, targetTestId = '') => {",
  'le funnel d’écriture accepte une condition CIBLE');
has(ATM, 'const targetId = targetTestId || activeTestId;',
  '…sans cible, c’est la condition affichée qui est écrite (rien ne change)');
has(ATM, 'prev.map((t) => (t.id === targetId ? { ...t, ...updates } : t))',
  '…et c’est bien la cible qui reçoit les valeurs');
has(MD, "const targetTestId = (activeTest && activeTest.id) || '';",
  '[MD] les valeurs d’analyse savent à quelle condition elles appartiennent');
has(MD, 'updateActiveTest({ instances, mdValues }, targetTestId);',
  '[MD] le tableau per-atome écrit sur la condition MESURÉE');
has(MD, 'updateActiveTest({ mdValues }, targetTestId);',
  '…et la couche « md » seule aussi');
has(MD, 'updateActiveTest({ mdAnalysisResult: payload }, runTestId);',
  '[MD] les courbes générales aussi (une analyse dure des minutes)');
has(MD, 'updateActiveTest({ mdContactResult: persist }, runTestId);',
  '[MD] les cartes de contacts aussi');
has(MD, 'mdProfileResult: (outs || []).map', '[MD] les profils de membrane aussi');
has(MD, 'mdDsspResult: (outs || []).map', '[MD] la structure secondaire (DSSP) aussi');
assert.equal(countOf(MD, '}, runTestId);'), 4,
  'les quatre résultats d’analyse partent sur la condition mesurée');
passed += 1;

/* La PEINTURE (état d'écran) reste, elle, sur la page qui a mesuré : sinon une
   analyse terminée après un changement de condition peindrait ses courbes sur
   une autre simulation. */
has(MD, 'const shownTestIdRef = useRef(activeTest && activeTest.id);',
  'chaque section MD sait quelle condition elle affiche');
has(MD, 'shownTestIdRef.current = activeTest && activeTest.id;',
  '…mise à jour à chaque rendu');
has(MD, 'const onMeasuredPage = (runTestId) => shownTestIdRef.current === runTestId;',
  '…et sait si le calcul en cours appartient à la page affichée');
has(MD, "const runTestId = (activeTest && activeTest.id) || '';",
  'chaque calcul retient la condition qu’il mesure');
has(MD, 'if (onMeasuredPage(runTestId)) setCalcData(payload);',
  '[MD] les courbes générales ne se peignent que sur leur condition');
has(MD, 'if (onMeasuredPage(runTestId)) setOutputs(out);',
  '[MD] les cartes de contacts non plus');
has(MD, 'if (onMeasuredPage(runTestId)) setOutputs(outs);',
  '[MD] les profils et le DSSP non plus');
has(DOC, "### Un calcul long écrit sur la condition qu'il a MESURÉE",
  '…et la règle est documentée');


/* ══ 3. LA SAUVEGARDE QUI ATTEND PART QUAND LA PAGE S’EN VA ════════════════ */
has(APP, 'const pendingDatasetSaveRef = useRef(null);',
  'App.jsx sait QUELLE sauvegarde attend son délai');
has(APP, 'pendingDatasetSaveRef.current = runSave;', '…la sauvegarde scientifique s’y inscrit');
has(APP, 'saveTimeoutRef.current = setTimeout(runSave, 1500);',
  '…et reste différée de 1,5 s quand tout va bien');
has(APP, 'pendingDatasetSaveRef.current = null;',
  '[APP] une sauvegarde qui part efface l’attente (jamais deux envois)');
has(APP, 'const flushPendingSave = () => {', '[APP] un vidage explicite de ce qui attend');
has(APP, 'if (!pendingDatasetSaveRef.current) return;',
  '[APP] …qui ne fait rien s’il n’y a rien à envoyer');
has(APP, "window.addEventListener('pagehide', flushPendingSave);",
  '[APP] fermeture de l’onglet : on n’attend pas le délai');
has(APP, "document.addEventListener('visibilitychange', onVisibilityChange);",
  '[APP] passage en arrière-plan aussi');
has(APP, "if (document.visibilityState === 'hidden') flushPendingSave();",
  '[APP] …au moment de partir seulement');
has(APP, 'try { datasetCopyMirrorRef.current.flush(); } catch { /* best-effort */ }',
  '[APP] la copie Drive (re)programmée est poussée dans la foulée');
has(APP, 'if (pendingDatasetSaveRef.current === runSave) pendingDatasetSaveRef.current = null;',
  '[APP] l’effet qui repart ne laisse pas une attente fantôme');
ok(!APP.includes('  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);\n  saveTimeoutRef.current = setTimeout(async () => {'),
  'la sauvegarde scientifique n’est plus un minuteur anonyme (donc vidable)');

/* ══ 4. LE DOCUMENT DIT LA MÊME CHOSE ══════════════════════════════════════ */

has(DOC, "## Une page d'expérience est celle d'UNE condition (et suit la condition affichée)",
  'le défaut et sa correction sont documentés');
has(DOC, "## La dernière modification ne dépend plus d'un minuteur qui ne se déclenchera jamais",
  '…le vidage de la sauvegarde aussi');
has(DOC, '## La copie locale ne prend pas le pas sur ce qui voyage (page MD)',
  '…et la copie locale qui ne masque plus la fiche du test');
has(DOC, 'node _condition_page_test.mjs', '…avec la commande de vérification');

has(MD, "setStructRestoreMsg('');", '[MD] …idem pour la topologie');
has(MD, 'setFileEpoch((n) => n + 1);',
  '[MD] un jeton relance les restaurations pour la condition affichée');

/* Les DEUX restaurations (trajectoire, topologie) repartent sur ce jeton — ET sur
   le NOM et le POINTEUR déclarés : un dataset relu du cloud APRÈS l'affichage de
   la page (fenêtre neuve) doit relancer la recherche, sinon la page restait sur
   « ♻️ Restoring… » sans jamais interroger le Drive (défaut signalé). */
has(MD, '}, [activeTest.id, activeTest.trajectoryFileName, activeTest.trajectoryDriveName, trajPointerId, fileEpoch, driveConnectedAt]);',
  '[MD] la reprise de la trajectoire suit la condition, son nom, son pointeur et le jeton');
has(MD, '}, [activeTest.id, activeTest.structureFileName, activeTest.structureDriveName, structPointerId, fileEpoch, driveConnectedAt]);',
  '[MD] …la topologie aussi');
/* LE NOM DÉCLARÉ N'EST PLUS LE SEUL DÉCLENCHEUR. Un dataset dont la sauvegarde
   en différé a perdu le nom (ou une reprise réussie sur une autre machine) garde
   les octets dans la base du navigateur — sous la clé DE LA CONDITION — ou le
   POINTEUR de la copie de référence. Exiger le nom faisait sortir l'effet tout de
   suite : le fichier était là, la page n'allait jamais le chercher, et le viewer
   3D n'avait donc JAMAIS sa barre de lecture (défaut signalé). */
has(MD, '      if (trajectoryFile) return;                       // déjà en main',
  '[MD] la reprise de la trajectoire ne sort plus de l’effet faute de nom déclaré');
has(MD, '      if (structureFile) return;                        // déjà en main',
  '[MD] …la topologie non plus');
assert.equal(countOf(MD, 'if (!declared && !driveName && !pointer) return;'), 2,
  '[MD] la base du navigateur est interrogée même sans nom déclaré (ni nom, ni nom déposé, ni pointeur = seule raison de ne rien chercher)');
passed += 1;
has(MD, 'const blob = await blobStore.load(trajBlobKey(testId));',
  '[MD] la clé lue est celle de la CONDITION mesurée (jamais celle de la page affichée)');
has(MD, 'const blob = await blobStore.load(structBlobKey(testId));',
  '[MD] …idem pour la topologie');
has(MD, 'if (!declared) updateActiveTest({ trajectoryFileName: restored.name }, testId);',
  '[MD] un nom déclaré PERDU est réécrit sur SA condition (le fichier voyage à nouveau)');
has(MD, 'if (!declared) updateActiveTest({ structureFileName: restored.name }, testId);',
  '[MD] …et pour la topologie');
has(MD, 'if (!declared && !driveName && !pointer) return { ok: false, message: \'\' };',
  '[MD] le bouton « Bring it back » sait reprendre avec un POINTEUR seul (dataset d’avant le nom)');
has(MD, 'const label = declared || driveName || \'the archived trajectory\';',
  '[MD] …et nomme la recherche d’après ce qui existe vraiment (nom déclaré, nom déposé)');
/* « Retirer ce fichier » = l’oublier VRAIMENT : le nom ET le pointeur, sinon la
   reprise ramenait la trajectoire qu’on venait de retirer. */
has(MD, 'trajectoryDrive: null, trajectoryDriveName: null',
  '[MD] retirer la trajectoire efface aussi le pointeur (rien ne « revient tout seul »)');
has(MD, 'structureDrive: null, structureDriveName: null',
  '[MD] …et retirer la topologie aussi');
has(MD, 'const trajDeclared = !!(activeTest.trajectoryFileName || activeTest.trajectoryDriveName || trajPointerId);',
  '[MD] la page sait qu’un fichier est DÉCLARÉ dès qu’un nom OU un pointeur en parle');

/* ══ 5. LE FICHIER VIENT DU DRIVE — ET LA PAGE LE DIT ══════════════════════ */

/* Plus de phrase écrite en dur : le texte affiché suit la recherche réellement
   menée (base du navigateur → Drive, ou « le Drive n'est pas connecté ICI »). */
ok(!MD.includes('The file is being brought back from this browser'),
  '[MD] la phrase « le fichier revient de la base du navigateur » a disparu');
has(MD, "const [trajPhase, setTrajPhase] = useState('browser');",
  '[MD] la reprise de la trajectoire a un état lisible');
has(MD, "const [structPhase, setStructPhase] = useState('browser');",
  '[MD] …la topologie aussi');
has(MD, "const trajSourceHint = trajPhase === 'drive'", '[MD] le texte affiché suit cet état');
has(MD, "setTrajPhase('nocloud');",
  '[MD] sans Drive connecté dans CE navigateur, la page le dit au lieu de promettre');
has(MD, "setTrajDriveMsg(`✅ ${restored.name} brought back from this browser.`);",
  '[MD] …et dit de quelle source le fichier est revenu');
has(MD, 'onClick={() => { restoreTrajectoryFromDrive(); }}',
  '[MD] un geste à la demande pour reprendre la trajectoire depuis le Drive');
has(MD, 'onClick={() => { restoreStructureFromDrive(); }}',
  '[MD] …et pour la topologie');
has(MD, 'const restoreTrajectoryFromDrive = async () => {',
  '[MD] la tentative automatique et le bouton passent par la MÊME fonction');
has(MD, 'const applyReloadedFile = async ({ kind, testId, wantedName, file, paint }) => {',
  '[MD] le fichier ramené est rangé sous la clé de SA condition');
has(MD, "await blobStore.save(kind === 'trajectory' ? trajBlobKey(testId) : structBlobKey(testId), restored);",
  '…jamais sous celle de la condition affichée');
assert.equal(countOf(MD, 'sameRawFileFor(blob.name, declared)'), 2,
  '[MD] la copie de la base du navigateur est reconnue par ses radicaux (nom déposé sur le Drive)');
passed += 1;
has(MD, "import { placeRestorePointer, pointerStillWanted, restoreRawFileFor, sameRawFileFor, takePendingRestorePointer, wantedRawNames } from '../utils/driveRestore';",
  '[MD] la comparaison des noms vit dans le noyau partagé');
has(MD, 'const restoreTargetStillShown = (testId) => mdActiveIdRef.current === testId;',
  '[MD] une reprise qui finit après un changement de condition ne peint pas la nouvelle page');
has(MD, 'const paint = restoreTargetStillShown(testId);',
  '…elle vise la condition qu’elle a lue');
has(NMR, 'if (blob && sameRawFileFor(blob.name, activeTest.structureFileName)) {',
  '[NMR] le viewer 3D reconnaît aussi la copie gardée sous son nom Drive');
has(NMR, "nmrStructRestore.attempt('data-arrived');",
  '[NMR] un nom de structure arrivé après l’affichage relance la recherche');

/* ══ 6. LA BARRE DE LECTURE DE LA TRAJECTOIRE APPARTIENT À LA CONDITION ═════
   Signalé le 20/09/2026 : « le viewer 3D est affiché mais il n'a ni bouton ▶
   Play ni curseur Frame ». La barre n'était rendue que pour un fichier EN MAIN
   (`trajFile || trajectoryFile || trajectorySrc`), donc jamais tant que la
   reprise n'avait pas abouti — et rien à l'écran ne disait qu'une trajectoire
   était déclarée. La page passe maintenant le NOM DÉCLARÉ au viewer : la barre
   apparaît dès qu'une trajectoire existe pour la condition, avec l'état honnête
   (« pas encore là »), et ▶ ne s'active que sur des images réellement lues. */
has(MD, "trajectoryName={activeTest.trajectoryFileName || activeTest.trajectoryDriveName || ''}",
  '[MD] la page annonce au viewer la trajectoire DÉCLARÉE (même pas encore rapatriée)');
has(VIEW, "trajectoryName = '',",
  'le viewer accepte le nom déclaré (même si le fichier n’est pas encore là)');
has(VIEW, "const declaredTrajName = String(trajectoryName || '').trim();",
  '…et le normalise');
has(VIEW, 'const hasTrajSource = !!(trajFile || trajectoryFile || trajectorySrc || declaredTrajName);',
  '…la barre de lecture existe dès qu’une source OU un nom déclaré existe');
has(VIEW, '(trajFile || trajectoryFile || trajectorySrc || declaredTrajName) && (',
  'la barre de lecture (▶ Play + curseur Frame + vitesse) est rendue pour une trajectoire déclarée');
has(VIEW, 'const waitingTrajFile = hasTrajSource && !trajFile && !trajectoryFile && !trajectorySrc',
  '…et l’état « déclarée mais pas encore dans ce navigateur » est calculé');
has(VIEW, '{waitingTrajFile && (',
  '…et DIT à l’écran (aucune barre muette, aucune promesse)');

has(DOC, '## « Le fichier revient de la base du navigateur » — la page dit enfin où elle cherche',
  'la cause et la correction du message trompeur sont documentées');
has(DOC, '## La barre de lecture appartient à la CONDITION, pas seulement au fichier en main',
  '…et la barre de lecture qui n’apparaissait que pour un fichier en main');

console.log(`${passed} passed`);
