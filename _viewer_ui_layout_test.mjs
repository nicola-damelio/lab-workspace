/* =========================================================================
   _viewer_ui_layout_test.mjs — l'organisation COMPACTE de l'interface du
   viewer 3D partagé (NMR / MD / Docking).

   Ce qui doit rester vrai :

     • le bouton « ⬇ Minimize » est SEUL tout en haut de la fenêtre (§0) ;
     • la barre de commande tient en TROIS lignes, dans l'ordre demandé :
       1 General (PDB / Load / Trajectory / Clear / Figure) ·
       2 Molecular Styling — ACCORDÉON REPLIÉ PAR DÉFAUT (docking + « Hide
         everything » + SIX menus : A Proteins · B Nucleic acids · C Lipids ·
         D Sugars · E Organic molecules · F Others) ·
       3 Toolbar = Scene | Modify | Analysis | PyMOL sur UNE seule rangée ;
     • l'ancienne section globale « 4 · Labels » a disparu : Residues /
       Residue type / Atom names vivent DANS chaque menu, donc cocher
       « Residues » dans le menu Protéines n'étiquette QUE les protéines ;
     • les lipides sont séparés en headgroups / squelette glycérol / chaînes
       acyle par des sélections NGL par NOM D'ATOME, les sucres ont leur propre
       menu (mot-clé réel `saccharide` + liste de resnames : NGL 2.4 n'a pas de
       mot-clé `carbohydrate`) et le menu des ligands exclut lipides ET sucres ;
     • toute surface « Transparent » fait apparaître un curseur d'opacité
       (0 → 1) et la valeur part dans NGL avec `transparent: true` ;
     • « Clipping: Off » pousse les plans de la caméra aux extrêmes
       (0 · 100000 · 0 Å) pour ne jamais couper un gros complexe, et ◐ Shadows
       allume l'équivalent NGL de l'ambient occlusion (ambiance + sampleLevel) ;
     • la barre ▶ Play · frame slider · speed est bien une BARRE (un commentaire
       JSX, jamais un commentaire brut rendu comme du texte) ;
     • RIEN n'a été perdu : ESP, lumière/ombres, sélections PyMOL, mesure,
       assigned, renumérotation, couleurs, rebuild H, renommage, labels,
       drag, large systems, barre de lecture de trajectoire, repli de la
       séquence ;
     • les nouvelles mailles sont marquées castShadow + receiveShadow.

   Le viewer est un .jsx : il ne s'importe pas sous Node. Les règles sont donc
   vérifiées SUR LA SOURCE — comme les autres garde-fous du dépôt.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

// CRLF → LF so the multi-line needles below can be written naturally.
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── 1. §0 : « Minimize » seul tout en haut ─────────────────────────────── */
const iReturn = VIEW.indexOf('return (\n<div className="flex flex-col gap-2">');
ok(iReturn > 0, 'la racine du viewer est un empilement compact de lignes');
const iMin = VIEW.indexOf('{viewerCollapsed ? \'⬆ Expand viewer\' : \'⬇ Minimize viewer\'}');
const iS1 = VIEW.indexOf('<VSection title="1 · General"');
ok(iMin > iReturn && iMin < iS1, 'le bouton Minimize est rendu AVANT toute autre ligne');
ok(!VIEW.slice(iReturn, iMin).includes('<VSection'), '…et aucune section ne le précède');
ok(VIEW.indexOf('Retract (minimize) the 3D viewer window') > 0, 'son infobulle décrit le repli de la fenêtre');

/* ── 2. Les trois lignes de la barre de commande, dans l'ordre ──────────── */
const order = [
  '<VSection title="1 · General"',
  "{stylingOpen ? '▾' : '▸'} 2 · Molecular Styling",
  '<VSection title="3 · Toolbar"',
];
order.forEach((marker) => has(marker, `ligne « ${marker.replace('<VSection title=', '').replace('"', '')} » présente`));
for (let i = 1; i < order.length; i++) {
  ok(VIEW.indexOf(order[i - 1]) < VIEW.indexOf(order[i]), `la ligne ${i} précède la ligne ${i + 1}`);
}
has('<VSection title="▶ Trajectory playback"', 'la barre de lecture a sa propre section, juste au-dessus du viewer');
// Les quatre sections empilées d'avant n'existent plus : §4 Labels (ses trois
// cases sont dans les menus) et §5/§6/§7, fondus dans la rangée d'outils §3.
gone('<VSection title="4 · Labels"', 'l\'ancienne section « 4 · Labels » est supprimée');
gone('<VSection title="5 · Modify"', 'l\'ancienne section « 5 · Modify » est fondue dans la rangée §3');
gone('<VSection title="6 · Analysis"', 'l\'ancienne section « 6 · Analysis » est fondue dans la rangée §3');
gone('<VSection title="7 · Selections & PyMOL"', 'l\'ancienne section « 7 · Selections & PyMOL » est fondue dans la rangée §3');
// Les quatre groupes sont bien DANS la même rangée, séparés par un filet.
has('>🌫 Scene</span>', '[§3] groupe Scene dans la rangée');
has('>✏️ Modify</span>', '[§3] groupe Modify dans la rangée');
has('>📏 Analysis</span>', '[§3] groupe Analysis dans la rangée');
has('>🧪 PyMOL</span>', '[§3] groupe PyMOL dans la rangée');
ok((VIEW.match(/aria-hidden="true" \/>/g) || []).length >= 3, '[§3] les groupes sont séparés par des filets');

/* ── 2bis. §2 : accordéon REPLIÉ PAR DÉFAUT ─────────────────────────────── */
has('const [stylingOpen, setStylingOpen] = useState(false);', '[§2] replié par défaut');
has('onClick={() => setStylingOpen((v) => !v)}', '[§2] en-tête cliquable');
has('aria-expanded={stylingOpen}', '[§2] l\'en-tête annonce son état');
has('{stylingOpen && (', '[§2] les menus ne sont montés qu\'une fois ouvert');
has('Proteins ${catStyles.protein.backbone} · Nucleic ${catStyles.nucleic.backbone}', '[§2] en-tête replié : résumé des styles courants');

/* ── 2ter. La barre ▶ Play n'est pas remplacée par du texte ─────────────── */
ok(!/\n\/\* ══ ▶ TRAJECTORY PLAYBACK/.test(VIEW),
  'le commentaire de la barre de lecture est un commentaire JSX (sinon il s\'afficherait comme du texte)');
has('{(trajFile || trajectoryFile || trajectorySrc || declaredTrajName) && (', '[barre] condition d\'apparition conservée');
has('onClick={togglePlay}', '[barre] ▶ Play conservé');
has('onChange={handleFrameChange}', '[barre] curseur de frame conservé');

/* ── 3. §1 General : PDB / Load / Trajectory / Clear / Figure ───────────── */
has('📂 PDB file(s)', '[§1] chargement de fichier(s) PDB');
has('onChange={handleFileChange}', '[§1] …branché sur handleFileChange');
has('placeholder="PDB ID or URL"', '[§1] champ PDB ID / URL');
has('onClick={handlePdbIdLoad}', '[§1] bouton Load');
has('📂 Trajectory', '[§1] bouton Trajectory');
has('if (f) handleTrajFileChosen(f);', '[§1] …branché sur handleTrajFileChosen');
has('onClick={handleClearViewer}', '[§1] bouton Clear');
/* 🗑 Delete PDB / ↩ Restore PDB — UN bouton, deux états : le PDB chargé dans
   CETTE section est mis de côté (jamais perdu : le même bouton le ressuscite,
   sa trajectoire avec lui) et la structure de la séquence de la page reprend la
   place pendant ce temps. */
has("const [structOrigin, setStructOrigin] = useState('none');", '[§1] le viewer sait ce qui est à l\'écran (rien / PDB chargé / modèle de la séquence)');
has('const [stashedPdb, setStashedPdb] = useState(null);', '[§1] le PDB mis de côté est gardé — rien n\'est perdu');
has("const pdbAsideIsRestore = !!stashedPdb && structOrigin !== 'external';", '[§1] le bouton suit l\'état réel (deux libellés)');
has('onClick={pdbAsideIsRestore ? restoreStashedPdb : deleteLoadedPdb}', '[§1] un seul bouton : 🗑 Delete PDB ⇄ ↩ Restore PDB');
has("'↩ Restore PDB' : '🗑 Delete PDB'", '[§1] …avec ses deux libellés');
has('const deleteLoadedPdb = () => {', '[§1] suppression du PDB chargé');
has('const restoreStashedPdb = () => {', '[§1] …et sa résurrection');
has('const stash = pdbSourceOfCurrent();', '[§1] la source mise de côté (fichier / URL / texte + trajectoire)');
has('if (traj) setTrajFile(traj);', '[§1] la trajectoire du PDB rangé revient AVEC lui');
has('file: (!text && stashedFile) ? stashedFile : null,', '[§1] la résurrection repasse par l\'entonnoir habituel (fichier / URL / texte)');
has("setStructOrigin('external');", '[§1] un chargement (fichier / URL / src de la page) marque une structure « chargée »');
has("setStructOrigin('generated');", '[§1] …et le modèle déduit de la séquence a son propre marqueur');
has("setStructAsideMsg('');", '[§1] « 🗑 Clear » efface aussi le PDB rangé et son message');
has('onClick={captureScene}', '[§1] bouton Figure');
has('{captureMsg && (', '[§1] message de capture');
// ⬇ PDB — le PDB de CE QUI EST AFFICHÉ : le PdbWriter de NGL lit les atomes de
// la structure avec les coordonnées de la frame courante de la trajectoire.
has('onClick={downloadFramePdb}', '[§1] bouton ⬇ PDB');
has('const downloadFramePdb = async () => {', '[§1] …son implémentation');
has('const writer = new NS.PdbWriter(structure);', '[§1] le fichier est écrit par le PdbWriter de NGL (coordonnées AFFICHÉES)');
has('? `Download a PDB file of the frame displayed right now (frame ${toActualFrame(currentFrame)} of ${numFrames})', '[§1] l’infobulle nomme la frame en cours');
has('const name = frameNo >= 0 ? `${base}_frame_${frameNo}.pdb` : `${base}.pdb`;', '[§1] le nom du fichier porte le numéro de frame');
// Hauteur du canevas : RÉGLABLE (poignée de redimensionnement) mais réduite
// d’un TIERS à l’ouverture d’une page (1000 px → 667 px, 1100 px → 733 px).
has('const OPEN_HEIGHT_FACTOR = 2 / 3;', '[§0] la hauteur d’ouverture est réduite d’un tiers');
has('return Math.max(240, Math.round(wanted * OPEN_HEIGHT_FACTOR));', '[§0] …appliquée à la hauteur demandée par la page');
has('onMouseDown={(e) => { resizeRef.current = { startY: e.clientY, startH: viewH }; e.preventDefault(); }}', '[§0] …la poignée de redimensionnement reste intacte');
// La phrase « Clipping Off = camera bounds… » n’existe plus (elle prenait de la
// place ; le bouton « ↺ No cut (0 · 100000 · 0 Å) » et son infobulle suffisent).
gone('Clipping Off = camera bounds at the extremes', '[§3] la phrase sur le clipping est supprimée');

/* ── 4. §2 : docking, hide everything, cinq menus ───────────────────────── */
has('{(moleculeType === \'protein\' || extraMols.length > 0 || dockStyleMode) && (', '[§2] contrôle Docking conservé');
has('🧬 Docking: {dockStyleMode ? \'On\' : \'Off\'}', '[§2] toggle Docking On/Off');
has('{renderDockRoleSelects(', '[§2] menus Prot: / Lig: du docking');
has('onClick={captureDockStylesFromViewer}', '[§2] 📸 View du docking');
has('{hideAll ? \'👁️ Show default\' : \'🙈 Hide everything\'}', '[§2] Hide everything');

has('label="A · Proteins"', '[§2] menu A · Proteins');
has('label="B · Nucleic acids"', '[§2] menu B · Nucleic acids');
has('label="C · Lipids"', '[§2] menu C · Lipids');
has('label="D · Sugars"', '[§2] menu D · Sugars (nom raccourci)');
has('label="E · Ligands"', '[§2] menu E · Ligands (nom raccourci)');
has('label="F · Others · water"', '[§2] menu F · Others (nom raccourci)');
// Les six menus sont alignés HORIZONTALEMENT : une GRILLE responsive (elle
// retombe sur une colonne quand ça ne rentre pas) et un en-tête sur DEUX
// lignes (nom court au-dessus, résumé limité à deux lignes) au lieu d'un
// bandeau pleine largeur par menu.
has('grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]', '[§2] les menus A–F sont alignés dans une grille');
has('className="w-full grid gap-1 items-start grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]"', '[§2] …une cellule par menu (items-start = les menus fermés restent compacts)');
has('className={`w-full flex flex-col rounded-lg border ${open ? tone.on : tone.off}`}', '[§2] chaque menu occupe sa cellule');
has('break-words line-clamp-2', '[§2] le résumé d’un menu tient sur deux lignes au maximum');

/* ── 5. Les listes d'options demandées, menu par menu ───────────────────── */
// A · Proteins
has('<option value="cartoon">Cartoon</option>', '[A] Backbone : Cartoon');
has('<option value="trace">Trace (C-α)</option>', '[A] Backbone : Trace (C-α)');
has('<option value="tube">Tube</option>', '[A] Backbone : Tube');
has('<option value="hide">Hide</option>', '[A] Backbone : Hide');
has('<option value="licorice">Sticks</option>', '[A] Side chains : Sticks');
has('<option value="line">Lines (saves resources)</option>', '[A] Side chains : Lines (économique)');
has('<option value="spacefill">Spacefill</option>', '[A] Side chains : Spacefill');
has('<option value="solid">Solid</option>', '[A/B/D/E] Surface : Solid');
has('<option value="transparent">Transparent</option>', '[A/B/D/E] Surface : Transparent');
has('<option value="mesh">Mesh (wireframe)</option>', '[A/B/D/E] Surface : Mesh');
has('<option value="esp">Electrostatic Potential (ESP)</option>', '[A/B/D] Surface colour : ESP');
has('🎨 {showColoursPanel ? \'Hide colours\' : \'Colours…\'}', '[A/B] outil Couleurs intégré');
has('🔢 {showRenumberPanel ? \'Hide renumber\' : \'Renumber…\'}', '[A/B] outil Renumber intégré');
// B · Nucleic
has('<option value="trace">Phosphate Trace (P)</option>', '[B] Phosphate Trace');
has('<option value="slab">Filled rings (slabs / boxes)</option>', '[B] Bases : Filled rings');
// C · Lipids
has('<option value="lines">Lines (default)</option>', '[C] Acyl chains : Lines (défaut)');
has('const LIPID_RESNAMES = new Set([', '[C] reconnaissance des lipides par resname (NGL n’a pas de mot-clé « lipid »)');
has('const lipidsFound = Array.isArray((catInfo && catInfo.lipids) || null) ? catInfo.lipids : [];',
  '[C] le menu dit ce qu’il a trouvé (ou qu’il n’y a rien à styler)');
// D · Organic + E · Others
has('<option value="dots">Dots (lightest)</option>', '[F] eau : Dots (le plus léger)');
has('<option value="points">Points (sized)</option>', '[F] eau : Points');
has('label="Water surface"', '[F] surface d’eau (Solid / Transparent / Mesh)');

/* ── 5bis. PART 2 — sélections & rendu avancés ──────────────────────────── */
// 1. Lipides : la liste de resnames demandée + les trois sous-parties par nom
//    d'atome (headgroups / squelette glycérol / chaînes acyle).
has("const lipidRes = '[POPC] or [DPPC] or [DMPC] or [DOPC] or [POPE] or [DOPE] or [CHOL] or [ERG] or [DPPG] or [POPG] or [DLPC] or [MYR] or [STE] or [PAL]';",
  '[lipides] sélection de base par resname');
has("const LIPID_HEAD_ATOMS = '.P or .N or .O1* or .O2* or .O3* or .O4*';", '[lipides] atomes de tête');
has("const LIPID_GLYCEROL_ATOMS = '.C1 or .C2 or .C3 or .O21 or .O31';", '[lipides] squelette glycérol');
has('const lipidSubSelections = (lipidSele, namedAtoms = true) => {', '[lipides] les trois sous-sélections');
has("head: `(${lipidSele}) and (${headAtoms}) and not (${LIPID_GLYCEROL_ATOMS})`", '[lipides] tête sans le squelette');
has("acyl: `(${lipidSele}) and not (${headAtoms} or ${glyAtoms})`", '[lipides] chaînes acyle = ni tête ni squelette');
has('const namedAtoms = nglSeleCountCached(comp.structure, `(${lipidSele}) and (${LIPID_HEAD_ATOMS})`) !== 0;',
  '[lipides] repli sur les éléments si la nomenclature ne suit pas CHARMM/AMBER');
has('label="Glycerol backbone"', '[lipides] menu : squelette glycérol séparé');
has("onChange={(e) => setCatStyle('lipid', 'glycerol', e.target.value)}", '[lipides] …et il est réglable');
// 2. Sucres vs ligands.
has("const SUGAR_RES_SEL = '[GLC] or [NAG] or [MAN] or [BMA] or [SIA] or [GAL] or [FUC]';", '[sucres] liste explicite de resnames');
has('const SUGAR_SEL = `saccharide or ${SUGAR_RES_SEL}`;', '[sucres] mot-clé RÉEL de NGL 2.4 (pas `carbohydrate`) + liste');
has("not (${sugarSele})", '[ligands] le menu des ligands exclut les sucres');
has("addSurface(sugarSele, cs.sugar.surface, 'default', cs.sugar.surfaceOpacity);", '[sucres] surface propre au menu des sucres');
// 3. Surface d'eau + opacité.
has("addSurface('water', cs.other.surface, 'default', cs.other.surfaceOpacity);", '[eau] la surface s’applique à la sélection `water`, toute seule');
has("nglSeleCountCached(comp.structure, 'water') !== 0", '[eau] …même quand les atomes d’eau ne sont dans aucune autre sélection');
has("transparent: true, opacity: op", '[opacité] NGL reçoit transparent: true + opacity');
has("const renderSurfaceOpacity = (cat, label = 'Opacity') => (", '[opacité] un curseur par menu');
has('surface === \'transparent\'', '[opacité] il n’apparaît que pour « Transparent »');
has("{renderSurfaceOpacity('protein')}", '[opacité] menu A');
has("{renderSurfaceOpacity('nucleic')}", '[opacité] menu B');
has("{renderSurfaceOpacity('sugar')}", '[opacité] menu D');
has("{renderSurfaceOpacity('organic')}", '[opacité] menu E');
has("{renderSurfaceOpacity('other', 'Water opacity')}", '[opacité] menu F (eau)');

/* ── 6. Les anciens menus globaux ont bien disparu ──────────────────────── */
gone('Side: Hidden', 'l’ancien menu « Side: » est retiré');
gone('Backbone: Cartoon', 'l’ancien menu « Backbone: » est retiré');
gone('Mol: Ball &amp; Stick', 'l’ancien menu « Mol: » est retiré');
gone('onChange={(e) => setBackboneStyle(e.target.value)}', 'l’état backboneStyle n’est plus piloté par un menu global');
gone('onChange={(e) => setMoleculeStyle(e.target.value)}', 'l’état moleculeStyle n’est plus piloté par un menu global');
ok(!/const \[backboneStyle, setBackboneStyle\]/.test(VIEW), 'l’état global backboneStyle a été remplacé par les menus');
ok(!/const \[moleculeStyle, setMoleculeStyle\]/.test(VIEW), 'l’état global moleculeStyle a été remplacé par les menus');

/* ── 7. Rien n'a été perdu (chaque fonctionnalité garde son contrôle) ───── */
has('onClick={() => espToggle(selectedMolKey)}', '[conservé] bouton ⚡ ESP');
has('onClick={() => espApplyLimits()}', '[conservé] ⚡ Range → Apply');
has('onClick={() => espApplyLimits(50, 50)}', '[conservé] presets ±10/±25/±50');
has('onClick={() => setFogEnabled((v) => !v)}', '[conservé] 🌫 Fog');
has('onClick={() => setShadowOn((v) => !v)}', '[conservé] ◐ Shadows');
has('value={Math.round(shadowDarkness * 100)}', '[conservé] 🌑 Darkness');
has('aria-label="Light azimuth"', '[conservé] 💡 Light (azimut)');
has('aria-label="Light elevation"', '[conservé] 💡 Light (élévation)');
has('installShadowLightRig();', '[conservé] la lumière-clé fixe des ombres');
// Étiquettes 3D : elles vivent désormais DANS chaque menu (l'ancienne section
// « 4 · Labels » est supprimée) — cocher « Residues » dans un menu n'étiquette
// que les atomes de CE menu.
has("{renderCatLabels('protein')}", '[étiquettes] menu A');
has("{renderCatLabels('nucleic')}", '[étiquettes] menu B');
has("{renderCatLabels('lipid')}", '[étiquettes] menu C');
has("{renderCatLabels('sugar')}", '[étiquettes] menu D');
has("{renderCatLabels('organic')}", '[étiquettes] menu E');
has("{renderCatLabels('other')}", '[étiquettes] menu F');
has("setCatLabel(cat, 'residues', e.target.checked)", '[étiquettes] case « Residues » par catégorie');
has("setCatLabel(cat, 'residueType', e.target.checked)", '[étiquettes] case « Residue type » par catégorie');
has("setCatLabel(cat, 'atoms', e.target.checked)", '[étiquettes] case « Atom names » par catégorie');
has('const [catLabels, setCatLabels] = useState(() => loadCatLabels());', '[étiquettes] état par catégorie, persistant');
has('allowed: new Set(indices)', '[étiquettes] build3dLabelMap ne reçoit que les atomes de la catégorie');
has('const atomIndicesForSele = (structure, sele) => {', '[étiquettes] la sélection du menu devient une liste d’indices d’atomes');
has('const routeCategorySelections = (sels, moleculeType) => {', '[rendu] UNE fonction de routage partagée par le rendu ET les étiquettes');
has('onClick={() => setDragMove((v) => !v)}', '[conservé] ✋ Drag');
has('onClick={rebuildHydrogensNow}', '[conservé] ⚗️ Rebuild H');
has('onClick={() => setShowAtomPanel((v) => !v)}', '[conservé] ✏️ panneau Atom names (renommage)');
/* ── La SÉQUENCE de la page donne sa structure ──────────────────────────────
   Une séquence tapée dans « Molecular structure and visualization » (sous-
   section Proteins / DNA / RNA) doit montrer son modèle dès que RIEN n'est
   chargé dans cette section : la page le fournit par `sequenceStructureText`,
   le bouton « 🧬 From sequence » du groupe Modify le reconstruit à la demande,
   et un PDB déjà chargé est rangé (↩ Restore PDB), jamais écrasé. */
has('sequenceStructureText = null,', '[séquence] le modèle déduit de la séquence arrive par la page');
has('sequenceStructureExt = null,', '[séquence] …avec son extension (pdb / sdf)');
has("if (structOrigin === 'external') return;   // un PDB chargé par l'utilisateur occupe l'écran", '[séquence] un PDB chargé garde la priorité');
has('if (sequenceStructureText === lastLoadedTextRef.current) return;', '[séquence] …et le modèle n\'est jamais rechargé deux fois');
has("requestStructureLoad({ file: null, url: null, text: sequenceStructureText, ext: sequenceStructureExt || 'pdb', ts: Date.now() });", '[séquence] il passe par l\'entonnoir habituel (styles, séquence, tables d\'atomes)');
has('onClick={buildFromSequence}', '[modify] bouton 🧬 From sequence');
has('disabled={!sequenceStructureText}', '[modify] …inactif tant qu\'aucune séquence n\'est saisie');
has('const buildFromSequence = () => {', '[modify] …son implémentation (le PDB affiché est rangé, jamais perdu)');
has('🧬 From sequence', '[modify] libellé du bouton');
has('onClick={autoNameFrom2D}', '[conservé] auto-nommage depuis la 2D');
has('onClick={toggleMeasureMode}', '[conservé] 📏 Measure');
has('onClick={clearMeasurements}', '[conservé] ✕ Clear distances');
has('onClick={() => setShowAssignedFlag(!showManualHighlight)}', '[conservé] 🟢 Assigned');
has('onClick={() => setShowPymolPanel((v) => !v)}', '[conservé] 🧪 Selections & PyMOL');
has('onClick={() => applyPyMOLScript(pymolScript)}', '[conservé] exécution du script PyMOL');
has('onChange={(e) => setQualityHigh(e.target.checked)}', '[conservé] option « High quality » PyMOL');
has('value={bgColor}', '[conservé] couleur de fond PyMOL');
has('onClick={() => setShowRenumberPanel((v) => !v)}', '[conservé] 🔢 Renumber');
has('onClick={applyRenumberFrom}', '[conservé] « Renumber from »');
has('helix: parseInt(e.target.value.slice(1), 16)', '[conservé] couleurs 2° structure (hélices)');
has('onChange={(e) => setAssignedAtomColor(parseInt(e.target.value.slice(1), 16))}', '[conservé] couleur des atomes assigned');
has('onClick={() => setViewerCollapsed((v) => !v)}', '[conservé] repli de la fenêtre 3D');
// Le bouton « ✨ Full detail » (et son helper) est SUPPRIMÉ : cliquer dessus
// figeait la visualisation d’un gros système. Le mode léger reste le seul
// rendu possible d’un tel système — c’est ce qui permet de l’afficher du tout.
gone('onClick={useFullDetail}', '[supprimé] le bouton ✨ Full detail n’est plus rendu');
gone('const useFullDetail', '[supprimé] …ni son helper de bascule');
has('there is no « ✨ Full detail » escape hatch any more', '[supprimé] …et le code explique pourquoi');
has('There is no « ✨ Full detail » button any', '[supprimé] le bandeau « large structure » ne le propose plus');
has('onClick={togglePlay}', '[conservé] ▶ Play de la trajectoire');
has('onChange={(e) => setExtraMolStyle(m.id, e.target.value)}', '[conservé] style par molécule (barre Molecules)');
has('onClick={applyActiveStyleToAll}', '[conservé] 🎨 Copy de la barre Molecules');
has('onClick={() => setSelStyles({ ...selStylesRef.current,', '[conservé] styles par sélection (barre Selections)');
has('{selections.map((s) => {', '[conservé] barre verticale des sélections');
has('onClick={handleAbort}', '[conservé] ⏹ Abort');
has("setPymolScript(typeof entry === 'string' ? entry : (entry.script || ''))",
  '[conservé] chargement d’un script PyMOL de la Library');

/* ── 8. ESP branché dans les menus + un seul jeu de limites ─────────────── */
has("setSurfaceColor('protein', e.target.value)", '[ESP] menu A → Surface colour');
has("setSurfaceColor('nucleic', e.target.value)", '[ESP] menu B → Surface colour');
has("setSurfaceColor('organic', e.target.value)", '[ESP] menu D → Surface colour');
has("if (value === 'esp' && (!next.surface || next.surface === 'hide')) next.surface = 'transparent';",
  '[ESP] choisir ESP allume la surface : le choix ne reste jamais sans effet');
has("const espColorParams = () => {", '[ESP] un SEUL générateur de couleurs ESP');
has("return { colorScheme: 'electrostatic', colorScale: 'rwb', colorDomain: [-neg, pos] };",
  '[ESP] même schéma NGL que le bouton ⚡ (electrostatic + rwb + domaine ±kcal/mol)');
has('const colorParams = colorMode === \'esp\' ? espColorParams() : { colorScheme: \'element\' };',
  '[ESP] les surfaces de catégorie réutilisent ce générateur');
has('catEspRepsRef.current.set(comp, []);', '[ESP] les surfaces ESP sont réenregistrées à chaque reconstruction');
has('catEspRepsRef.current.forEach((list) => {', '[ESP] ⚡ Range recolore aussi les surfaces de catégorie');
has('{(espOnSelected || catEspActive) && (', '[ESP] le panneau Range s’affiche pour les deux entrées ESP');
has('colorScheme: \'electrostatic\',\n      colorScale: \'rwb\',', '[ESP] l’overlay ⚡ garde son colorScheme/colorScale');

/* ── 9. §3 Scene : fog, ombres, plan de coupe aux extrêmes quand Off ────── */
has('const CLIP_DEFAULTS = { near: 0, far: 100000, dist: 0 };',
  '[§3] « Off » = plans de la caméra aux extrêmes (0 · 100000 · 0 Å, rien n’est jamais coupé)');
has('const [clipOn, setClipOn] = useState(() => {', '[§3] interrupteur de clipping');
has('✂ Clipping: {clipOn ? \'On\' : \'Off\'}', '[§3] bouton Clipping On/Off');
has('if (c.on) stage.setParameters({ clipNear: c.near, clipFar: c.far, clipDist: c.dist });',
  '[§3] les valeurs choisies sont poussées au stage');
has('else stage.setParameters({ clipNear: CLIP_DEFAULTS.near, clipFar: CLIP_DEFAULTS.far, clipDist: CLIP_DEFAULTS.dist });',
  '[§3] OFF = plus aucune coupe (near 0 / far 100 / 10 Å)');
has('localStorage.setItem(\'labViewerClip\'', '[§3] le réglage est persistant');
has('aria-label="Clipping near"', '[§3] curseur near');
has('aria-label="Clipping far"', '[§3] curseur far');
has('aria-label="Clipping camera distance"', '[§3] curseur clipDist (la vraie cause de la coupe au zoom)');
has('↺ No cut (0 · 100000 · 0 Å)', '[§3] retour aux valeurs extrêmes (aucune coupe)');
has('min="0" max="30" step="0.1" value={clipDist}', '[§3] clipDist descend jusqu’à 0 (plus aucun plancher)');

/* ── 10. Ombres : mailles cast + receive, ET l'équivalent de l'AO ───────── */
has('const flagMeshShadows = (rep) => {', '[ombres] helper de marquage des mailles');
has('o.castShadow = true;\n            o.receiveShadow = true;', '[ombres] cast ET receive sur chaque maille');
has('if (r) { flagMeshShadows(r); reps.push(r); }', '[ombres] appelé pour CHAQUE représentation des menus');
// NGL 2.4 n'a PAS de passe SSAO (vérifié : aucun symbole `ssao` /
// `AmbientOcclusion` dans le build installé) : ◐ Shadows pilote donc
// l'équivalent — ambiance profonde + lumière-clé forte + sur-échantillonnage.
has('const AO_SAMPLE_LEVEL = 2;', '[AO] niveau de sur-échantillonnage de l’équivalent SSAO');
has('sampleLevel: AO_SAMPLE_LEVEL,', '[AO] ◐ Shadows ON → l’ombrage des cavités est sur-échantillonné');
has('        sampleLevel: 0,\n      });', '[AO] Shadows OFF → niveau d’échantillonnage NGL rétabli');
has('ambientIntensity: Math.max(0.12, 0.34 - dark * 0.22)', '[AO] l’ambiance s’assombrit → cavités/crevasses marquées');

/* ── 11. Le rendu suit les menus (et plus les anciens sélecteurs) ───────── */
has('const catStylesRef = useRef(catStyles);', '[rendu] miroir synchrone des styles de catégorie');
has('const buildCategoryReps = (comp) => {', '[rendu] UN constructeur de représentations par catégorie');
has('const applyCurrentStyleTo = useCallback((comp, baseReps) => {', '[rendu] les molécules extra passent par le même constructeur');
has('return buildCategoryReps(comp);', '[rendu] …sans règle différente du rendu principal');
has('const catSelectionsFor = (structure) => {', '[rendu] sélections protein / nucleic / lipid / organic / others');
has("const sels = catSelectionsFor(comp.structure) || fallbackSels;", '[rendu] …réutilisées par le constructeur');
has("else if (bb === 'trace') add('trace', { sele: sels.protein, color: 'residueindex', quality: 'high' });",
  '[rendu] Trace (C-α) = représentation NGL « trace » réelle');
has("if (bases === 'slab') add('base', { sele: sels.nucleic, colorScheme: 'resname' });",
  '[rendu] Filled rings = représentation NGL « base » réelle');
has(": add('surface', { sele, ...colorParams, opacity: 1 });", '[rendu] surface solide');
has("? add('surface', { sele, ...colorParams, wireframe: true, opacity: 1 })", '[rendu] surface « Mesh » = wireframe réel');
has("localStorage.setItem(CAT_STYLE_KEY, JSON.stringify(v))", '[rendu] les cinq menus sont persistants');
has('const [lightRender, setLightRender] = useState(false);', '[rendu] le mode léger des grands systèmes est conservé');
has('[lightRender, largeStyle, showLargeWater, status]', '[rendu] …et se reconstruit comme avant');

/* ── 12. La séquence cliquable est repliable ────────────────────────────── */
has('const [stripCollapsed, setStripCollapsed] = useState(() => {', '[séquence] état de repli');
has('localStorage.setItem(\'labViewerStripCollapsed\'', '[séquence] repli persistant');
has("{stripCollapsed ? '▶' : '◀'}", '[séquence] bouton de repli');
has('strip collapsed — {polyTicks.length} residues', '[séquence] bandeau replié (dit ce qui est masqué)');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_viewer_ui_layout_test.mjs — ${passed} assertions OK`);
