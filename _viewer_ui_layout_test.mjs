/* =========================================================================
   _viewer_ui_layout_test.mjs — l'organisation COMPACTE de l'interface du
   viewer 3D partagé (NMR / MD / Docking).

   Ce qui doit rester vrai :

     • le bouton « ⬇ Minimize » est SEUL tout en haut de la fenêtre (§0) ;
     • la barre de commande tient en DEUX lignes, dans l'ordre demandé :
       1 General (PDB / Load / Trajectory / Clear / PDB file / Predefined styles) ·
       2 Toolbar = Scene | Modify | Analysis | PyMOL sur UNE seule rangée ;
     • la ligne « 2 · Toolbar » est bien la SECTION 2 : l'ancien §2
       « Molecular Styling » (un accordéon qui ne portait que 🙈 Hide everything ·
       ⚡ ESP · 🔢 Renumber) a été dissous, et ses commandes ont rejoint les groupes
       qui leur correspondent — ✨ Ray AVEC ses associés (résolution · ⬚ alpha ·
       ◐ shadows) dans 🌫 Scene, ⚡ ESP et 🔢 Renumber (bouton ET liste) dans
       ✏️ Modify. Le 📷 Figure et le 🙈 Hide everything de la rangée ont disparu
       (la demande : « il pulsante figure é ridondante come anche il hide
       everything ») — le geste de masquage vit dans la barre des sélections, sur
       le MÊME état `hideAll` ;
     • le STYLING d'une molécule vit dans la barre « Molecules · styling » (à
       droite du canvas) : un ESPACE par molécule (la principale comprise), les
       rangées de son type (une par partie), et son Move X · Y · Z. Les six menus
       de catégorie A–F de l'ancien §2 ont disparu — les tests qui les couvraient
       parlent maintenant des rangées (voir _viewer_style_controls_test.mjs) ;
     • l'ancienne section globale « 4 · Labels » a disparu : Residues /
       Residue type / Atom names vivent DANS l'espace de chaque molécule, donc
       cocher « Residues » sur une protéine n'étiquette QUE cette molécule ;
     • les lipides sont séparés en headgroups / squelette glycérol / chaînes
       acyle par des sélections NGL par NOM D'ATOME (trois RANGÉES de l'espace
       d'un lipide), les sucres ont leur espace (mot-clé réel `saccharide` + liste
       de resnames : NGL 2.4 n'a pas de mot-clé `carbohydrate`) et celui des
       ligands exclut lipides ET sucres ;
     • la transparence d'une rangée EST l'opacité de sa surface (0 → 1), et la
       valeur part dans NGL avec `transparent: true` ;
     • « Clipping: Off » pousse les plans de la caméra aux extrêmes
       (0 · 100000 · 0 Å) pour ne jamais couper un gros complexe, et ◐ Shadows
       allume l'équivalent NGL de l'ambient occlusion — ambiance profonde +
       sur-échantillonnage — dont les nombres vivent dans
       src/utils/viewerLightRig.js (vérifiés par _viewer_light_rig_test.mjs) ;
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

/* ── 2. Les DEUX lignes de la barre de commande, dans l'ordre ───────────── */
// La révison qui a suivi PART 4 a dissous l'ancien §2 « Molecular Styling » (son
// accordéon ne portait que 🙈 Hide everything · ⚡ ESP · 🔢 Renumber) : le tableau
// d'outils est devenu la SECTION 2, et il porte les quatre groupes
// (Scene | Modify | Analysis | PyMOL) sur UNE rangée.
const order = [
  '<VSection title="1 · General"',
  '<VSection title="2 · Toolbar"',
];
order.forEach((marker) => has(marker, `ligne « ${marker.replace('<VSection title=', '').replace('"', '')} » présente`));
for (let i = 1; i < order.length; i++) {
  ok(VIEW.indexOf(order[i - 1]) < VIEW.indexOf(order[i]), `la ligne ${i} précède la ligne ${i + 1}`);
}
has('<VSection title="▶ Trajectory playback"', 'la barre de lecture a sa propre section, juste au-dessus du viewer');
// Les sections empilées d'avant n'existent plus : §2 (dissous), §4 Labels (ses
// trois cases sont dans les menus) et §5/§6/§7, fondus dans la rangée d'outils.
gone('aria-expanded={stylingOpen}', 'plus d’accordéon §2 : les commandes sont dans la rangée 2 · Toolbar');
gone('<VSection title="4 · Labels"', 'l\'ancienne section « 4 · Labels » est supprimée');
gone('<VSection title="5 · Modify"', 'l\'ancienne section « 5 · Modify » est fondue dans la rangée 2 · Toolbar');
gone('<VSection title="6 · Analysis"', 'l\'ancienne section « 6 · Analysis » est fondue dans la rangée 2 · Toolbar');
gone('<VSection title="7 · Selections & PyMOL"', 'l\'ancienne section « 7 · Selections & PyMOL » est fondue dans la rangée 2 · Toolbar');
// Les quatre groupes sont bien DANS la même rangée, séparés par un filet.
has('>🌫 Scene</span>', '[§2] groupe Scene dans la rangée');
has('>✏️ Modify</span>', '[§2] groupe Modify dans la rangée');
has('>📏 Analysis</span>', '[§2] groupe Analysis dans la rangée');
has('>🧪 PyMOL</span>', '[§2] groupe PyMOL dans la rangée');
ok((VIEW.match(/aria-hidden="true" \/>/g) || []).length >= 3, '[§2] les groupes sont séparés par des filets');

/* ── 2bis. LES TROIS GROUPES DEMANDÉS, DANS L'ORDRE ─────────────────────── */
// « quindi toolbar diventa la sezione 2 e contiene separatamente scene, modify e
// analysis » : l'ordonnancement des groupes est donc une règle, pas un hasard.
const iSceneG = VIEW.indexOf('>🌫 Scene</span>');
const iModifyG = VIEW.indexOf('>✏️ Modify</span>');
const iAnalysisG = VIEW.indexOf('>📏 Analysis</span>');
ok(iSceneG > 0 && iSceneG < iModifyG && iModifyG < iAnalysisG,
  '[§2] scene → modify → analysis, séparément et dans cet ordre');
// Les commandes de la « ray » (et ses associés alpha / shadows) sont DANS Scene ;
// ⚡ ESP et 🔢 Renumber sont DANS Modify ; rien n'est monté deux fois.
const iRayBlock = VIEW.indexOf('✨ RAY — the HIGH-RESOLUTION STILL');
ok(iRayBlock > iSceneG && iRayBlock < iModifyG, '[§2] ✨ Ray + ⬚ alpha + ◐ shadows dans le groupe Scene');
ok(VIEW.indexOf('⚡ ESP — the electrostatic-potential surface') > iModifyG
  && VIEW.indexOf('⚡ ESP — the electrostatic-potential surface') < iAnalysisG,
  '[§2] ⚡ ESP dans le groupe Modify');
ok(VIEW.indexOf('🔢 Renumber — the button AND its list live in ✏️ Modify') > iModifyG
  && VIEW.indexOf('🔢 Renumber — the button AND its list live in ✏️ Modify') < iAnalysisG,
  '[§2] 🔢 Renumber ET sa liste dans le groupe Modify');
ok((VIEW.match(/rayMsg && \(/g) || []).length === 1, '[§2] un seul bloc ✨ Ray dans tout le viewer');
ok(VIEW.indexOf('🎨 Background') < iModifyG, '[§2] 🎨 Background reste dans Scene');

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
has('setStructAsideMsg(\'\');', '[§1] « 🗑 Clear » efface aussi le PDB rangé et son message');
/* 📷 FIGURE N'EST PLUS LÀ (la demande : « il pulsante figure é ridondante ») :
   le test garde désormais son DÉPART — bouton, message, handler et import. */
gone('onClick={captureScene}', '[§1] plus de bouton 📷 Figure');
gone('{captureMsg && (', '[§1] plus de message de capture');
gone('const captureScene = async () => {', '[§1] …ni de gestionnaire de capture (aucun code mort)');
gone("from '../utils/figuresLibrary'", '[§1] …ni d’import de la bibliothèque de figures');
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

/* ── 4. §2 : les commandes globales ont changé de section ────────────────── */
// Le bouton « 🧬 Docking » a quitté la toolbar ET la barre Molecules : il n'y
// a plus de mode global à basculer, donc plus d'état dockStyleMode ni de
// fonction applyDockStylesNow. Le style se règle molécule par molécule (barre
// Molecules) ; le look par défaut reste celui des rangées de chaque molécule.
gone('🧬 Docking', '[§2] plus de bouton Docking (retiré partout)');
gone('dockStyleMode', '[§2] …donc plus aucun mode global à basculer');
gone('applyDockStylesNow', '[§2] …ni de fonction qui ré-appliquait le look');
// Le docking n'a PLUS de menus de style à lui : il applique ceux de la section
// — les deux listes « Prot: » / « Lig: » et le bouton 📸 « copier la vue »
// ont disparu avec le module src/utils/dockStyles.js.
gone('renderDockRoleSelects', '[§2] plus de menus Prot: / Lig: propres au docking');
gone('captureDockStylesFromViewer', '[§2] plus de 📸 « copier la vue » du docking');
/* 🙈 HIDE EVERYTHING A QUITTÉ CETTE RANGÉE (la demande : « il pulsante figure é
   ridondante come anche il hide everything ») : le geste vit dans la barre des
   sélections, sur le MÊME état `hideAll`, donc rien n'est perdu — et le test le
   vérifie des deux côtés. */
gone("{hideAll ? '👁️ Show default' : '🙈 Hide everything'}", '[§2] le bouton Hide everything de la rangée a disparu');
has("{hideAll ? 'Show all' : '🙈 Hide all'}", '[barre] …et la barre des sélections garde le geste (même état hideAll)');
has('const [hideAll, setHideAll] = useState(false);', '[§2] l’état, lui, est intact : la barre continue de l’écrire');

// Les six menus A–F (et leur grille de six colonnes) ont DISPARU avec PART 4 : le
// styling de chaque molécule vit dans la barre de droite, un ESPACE par molécule,
// et la rangée 2 · Toolbar ne porte plus que les commandes du viewer.
gone('label="A · Proteins"', '[§2] plus de menu A · Proteins');
gone('label="B · Nucleic acids"', '[§2] …ni B · Nucleic acids');
gone('label="C · Lipids"', '[§2] …ni C · Lipids');
gone('label="D · Sugars"', '[§2] …ni D · Sugars');
gone('label="E · Ligands"', '[§2] …ni E · Ligands');
gone('label="F · Others', '[§2] …ni F · Others');
gone('grid-cols-6', '[§2] …donc plus de grille de six colonnes');
has('className="flex flex-wrap items-center gap-1"', '[§2] sa rangée d’outils est bien une rangée, pas une grille de menus');
// ⚡ ESP et 🔢 Renumber sont dans le groupe ✏️ Modify de cette rangée (la demande) ;
// les panneaux qu’ils ouvrent (⚡ Range, la liste du renumbering) en sont des
// enfants pleine largeur, donc la rangée reste haute d’une ligne quand rien n’est
// ouvert.
has("{espOnSelected ? '⚡ ESP: On' : '⚡ ESP'}", '[Modify] le bouton ⚡ ESP');
has("🔢 Renumber{showRenumberPanel ? ' ▲' : ' ▼'}", '[Modify] le bouton 🔢 Renumber');
has('✏️ Atom names{Object.keys(renames).length', '[Modify] le bouton ✏️ Atom names');
has('{(entry.sections || []).map((sec) => renderSection(sec))}',
  '[barre] …et le styling d’une molécule est rendu par SON espace, à droite');
has('const renderSectionRow = (sec, sub) => {', '[§2] une seule rangée par partie de molécule');

/* ── 5. Le VOCABULAIRE des styles et des colorations ───────────────────── */
// Les listes déroulantes d'une rangée sont construites depuis SA spécification
// (SECTION_SUBSECTIONS) : le style vient de `spec.styles` et son libellé de
// STYLE_LABELS, la coloration de `spec.colors` et de COLOR_LABELS. Un style ne
// peut donc pas être offert là où le rendu ne le connaît pas.
has('{styleOptions.map((s) => <option key={s} value={s}>{styleLabelOf(s)}</option>)}',
  '[rangées] la liste des styles vient de la spécification de la rangée (rendu commun des deux barres)');
has('styleOptions: spec.styles,', '[rangées] …alimentée par la spécification de la rangée');
has('styleLabelOf: (token) => styleLabelFor(kind, token),', '[rangées] …et ses libellés par le vocabulaire du type');
has('{colorOptions.map((c) => <option key={c} value={c}>{COLOR_LABELS[c] || c}</option>)}',
  '[rangées] …et le « Color by » aussi');
has('colorOptions: spec.colors,', '[rangées] …avec la liste de colorations de CETTE rangée');
has("const styleLabelFor = (kind, token) => (kind === 'ion' && token === 'spacefill' ? 'Sphere' : (STYLE_LABELS[token] || token));",
  '[vocabulaire] un ion nomme « spacefill » Sphere');
has("hide: 'Hide',", '[vocabulaire] Hide');
has("cartoon: 'Cartoon',", '[vocabulaire] Cartoon');
has("ribbon: 'Ribbon',", '[vocabulaire] Ribbon');
has("tube: 'Tube',", '[vocabulaire] Tube');
has("trace: 'Phosphate trace (P)',", '[vocabulaire] Trace (P) — le squelette d’un acide nucléique');
has("'ball+stick': 'Balls and sticks',", '[vocabulaire] Ball & stick');
has("licorice: 'Liquorice',", '[vocabulaire] Licorice (= les sticks)');
has("line: 'Lines',", '[vocabulaire] Lines');
has("spacefill: 'CPK',", '[vocabulaire] CPK (= spacefill)');
/* La demande : « dovunque trovi uno stile CPK aggiungi lo stile sphere ». NGL n’a
   ni CPK ni sphere — les deux sont `spacefill` : le mot de PyMOL est donc offert
   PARTOUT où le CPK l’est, et les deux se distinguent par la TAILLE (CPK le
   spacefill compact de la barre, « Sphere » le rayon de Van der Waals entier). */
has("sphere: 'Sphere',", '[vocabulaire] « Sphere » à côté de CPK (le mot de PyMOL)');
has("polymer: ['hide', 'cartoon', 'ribbon', 'tube', 'ball+stick', 'licorice', 'line', 'spacefill', 'sphere'],",
  'chaque rangée qui offrait CPK offre désormais « Sphere »');
has("small: ['hide', 'ball+stick', 'licorice', 'line', 'spacefill', 'sphere', 'surface', 'mesh'],",
  '…y compris les petites molécules (ligand · sucre)');
has("const ATOM_DRAW_STYLES = ['ball+stick', 'licorice', 'line', 'spacefill', 'sphere'];",
  '« sphere » dessine des atomes : il compte pour les ancres de chaîne latérale');
has("case 'sphere': return [{ type: 'spacefill', params: { radiusScale: sphere, scale: 1 } }];",
  '« Sphere » = le même spacefill NGL, au rayon de Van der Waals entier');
has("const styleFamiliesOf = (style) => [...new Set((STYLE_FAMILY_REPS[style] || [])",
  'la rangée de STYLING nomme la famille de matériau qu’elle atteint, comme les rangées de sélection');
// Les deux feuillets : ils ont QUITTÉ la boîte Membrane de GAUCHE, puis la boîte
// entière a été SUPPRIMÉE (la demande) — ils sont des RANGÉES de l’espace
// phospholipides du styling, avec leurs commandes.
gone("{['upper_leaflet', 'lower_leaflet'].map((n) => {", 'plus un seul tick de feuillet dans la boîte Membrane de gauche');
gone('type="checkbox" checked={on}', '…donc plus rien à cocher dans cette boîte');
gone('Styles of the leaflets:', 'la boîte Membrane de gauche a été SUPPRIMÉE (la demande), pas seulement vidée');
gone('rounded-lg border border-teal-200 bg-teal-50/70', '…aucun encart de mesure ne reste dans la barre de gauche');
has('NO « MEMBRANE » BOX IN THIS BAR', 'la barre de gauche ne contient plus que les sélections');
has('const lipidSelectionKeys = () => {', 'la liste vient de la mesure du viewer ET des sélections du script');
has("const renderMembraneSelections = (sec) => {", '…et elle se rend dans l’espace phospholipides');
has("{shown && kind === 'lipid' && sec.id === firstLipidSectionOf(", '…une seule fois par molécule (le premier espace lipidique)');
has('🧫 Membrane · leaflets', 'le groupe s’appelle « Membrane · leaflets »');
// Le bouton « Setup » a été renommé (la demande).
has('🎨 Predefined styles', 'le bouton « Setup » s’appelle « Predefined styles »');
has("surface: 'Surface',", '[vocabulaire] Surface');
has("mesh: 'Mesh surface',", '[vocabulaire] Mesh (wireframe)');
has("base: 'Slabs',", '[vocabulaire] Slabs (la représentation `base` de NGL)');
has("rings: 'Stylized rings (filled plates)',", '[vocabulaire] Stylized rings (plaques pleines)');
has("plates: 'Ring plates',", '[vocabulaire] Ring plates (l’anneau du ribose)');
has("solid: 'Solid',", '[vocabulaire] Solid (une couleur unie)');
has("element: 'Atom type',", '[vocabulaire] Atom type');
has("chain: 'Chain',", '[vocabulaire] Chain');
has("residue: 'Amino acid (residue)',", '[vocabulaire] Amino acid (residue)');
has("sstruc: 'Secondary structure',", '[vocabulaire] Secondary structure');
has("basetype: 'DNA/RNA base',", '[vocabulaire] DNA/RNA base');
has("nucform: 'RNA/DNA conformation',", '[vocabulaire] RNA/DNA conformation');
has("lipidtype: 'Lipid type',", '[vocabulaire] Lipid type');
has("sugar: 'Sugar type',", '[vocabulaire] Sugar type');
has("hydrophobicity: 'Hydrophobicity',", '[vocabulaire] Hydrophobicity');
has("charge: 'Charge',", '[vocabulaire] Charge');
has("esp: 'Electrostatic potential (only surfaces)',", '[vocabulaire] Electrostatic Potential (ESP)');
has("gradient: 'Gradient (first → last)',", '[vocabulaire] Gradient (first → last)');
has("rainbow: 'Rainbow (first → last)',", '[vocabulaire] Rainbow (first → last)');
// Le ↺ d'une rangée, et la roue ⚙ pour les palettes qu'une rangée n'édite pas
// elle-même (les chaînes, les résidus, les sucres, les lipides, les bases…).
has('onReset: () => resetSectionRowLook(sec.id, kind, sub),', '[rangées] ↺ d’une rangée (les défauts de son type)');
has('title="Open the ⚙ settings wheel — the colour of every CHAIN (A · B · C …) has a section of its own there"',
  '[rangées] « Color by : Chain » renvoie à la palette des chaînes de la roue ⚙');

/* ── 5bis. PART 2 — sélections & rendu avancés ──────────────────────────── */
// 1. Lipides : la liste de resnames demandée + les trois sous-parties
//    (headgroups / squelette glycérol / chaînes acyle), classées EN JS puis
//    passées à NGL en `@index` — les règles `.NOM` de NGL 2.4 sont des
//    comparaisons EXACTES (pas de joker `*`), donc « .O1* » ne sélectionnait rien.
has("const lipidRes = '[POPC] or [DPPC] or [DMPC] or [DOPC] or [POPE] or [DOPE] or [CHOL] or [ERG] or [DPPG] or [POPG] or [DLPC] or [MYR] or [STE] or [PAL]';",
  '[lipides] sélection de base par resname');
has("? resnames.map((n) => `[${n}]`).join(' or ')", '[lipides] un resname hors liste entre en `[NOM]` (NGL refuse « resname X »)');
has("const LIPID_GLYCEROL_NAMES = new Set(['C1', 'C2', 'C3', 'O21', 'O31', 'HA', 'HB', 'HS', 'HX', 'HY']);",
  '[lipides] squelette glycérol (nomenclature CHARMM/AMBER)');
has('const LIPID_ACYL_RE = /^(?:C[23]\\d{1,2}|O[23]2)$/;', '[lipides] chaînes acyle = C21… / C31… et les carbonyles O22 / O32');
has("const LIPID_POLAR_ELEMENTS = new Set(['N', 'P', 'O', 'S']);", '[lipides] repli par élément (fichier sans nomenclature)');
has('const lipidGroupOf = (name, element, named = true) => {', '[lipides] UN classificateur, partagé par le rendu et les couleurs');
has('const lipidSubSelections = (structure, lipidSele) => {', '[lipides] les trois sous-sélections, calculées une fois par structure');
has("const sele = (list) => (list.length ? `@${list.join(',')}` : '');", '[lipides] …rendues en sélection `@indices` (le seul joker de noms qui existe)');
has('else if (g === \'acyl\') acyl.push(i);', '[lipides] chaque atome prend exactement une des trois parts');
has('else head.push(i);', '[lipides] la tête est le RESTE : ni chaîne ni squelette → tous ses atomes ET toutes ses liaisons');
has("const LIPID_NAMED_PROBE = new Set(['P', 'N', 'C1', 'C2', 'C3']);",
  '[lipides] ce qui prouve que le fichier suit bien la nomenclature standard');
has('const sub = lipidSubSelections(comp.structure, lipidSele);', '[lipides] le rendu part de la classification');
has('const blank = { head: \'\', glycerol: \'\', acyl: \'\', named: true };',
  '[lipides] aucune visite d’atome (NGL pas prêt) → le drapeau garde sa valeur historique');
has('lipidColorStore.named = sub.named;', '[lipides] …et le panneau de couleurs lit le MÊME drapeau');
has('const col = lipidCol();', '[lipides] la couleur du menu C passe par « Colour by chemical part »');
// Le squelette glycérol n'est plus une option du menu C : c'est une RANGÉE à part
// entière de l'espace d'un lipide (« Glycerol »), avec son propre style, sa propre
// coloration et ses propres rayons.
has("{ sub: 'glycerol', label: 'Glycerol', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'glycerol' },",
  '[lipides] espace : squelette glycérol séparé');
has("onChange={(e) => set('style', e.target.value)}", '[lipides] …et il est réglable');
// 1bis. Les trois parts d'un lipide ne sont plus trois pastilles d'un panneau 🎨 du
// menu C : c'est le « Color by » de chaque rangée (le type de lipide) qui les
// colore, et la roue ⚙ qui édite la palette des types de lipides.
has("const [showLipidColoursPanel, setShowLipidColoursPanel] = useState(false);", '[C] l’ancien panneau de couleurs des lipides');
gone('{renderColoursButton(\'lipid\')}', '[C] …n’est plus rendu (les rangées du lipide parlent pour lui)');
has('Colour by chemical part', '[C] l’interrupteur « Colour by chemical part »');
has("case 'lipidtype': return schemeParam(lipidClassSchemeKey || elementSchemeKey, 'element');",
  '[C] la couleur par partie passe par le schéma des types de lipides');
gone('value={numToHex(catStyles.lipid.headColor)}', '[C] plus de pastille « tête » du vieux panneau');
gone('value={numToHex(catStyles.lipid.glycerolColor)}', '[C] …ni de pastille « squelette »');
gone('value={numToHex(catStyles.lipid.tailColor)}', '[C] …ni de pastille « chaînes »');
gone('onClick={resetLipidColours}', '[C] …ni de son ↺ Reset colours');
has('headColor: DEFAULT_LIPID_COLORS.head,', '[C] les trois couleurs des parts restent définies (schéma lab-lipid-groups)');
has('const lipidGroupsOn = () => !!(cs.lipid && cs.lipid.groupColour && lipidSchemeKey);', '[C] le rendu suit l’interrupteur');
has('registerLipidScheme(NGL);', '[C] le schéma des trois parts est enregistré au démarrage');
has("registerColorScheme(NGL, 'lab-lipid-groups'", '[C] …sous son propre libellé');
// 2. Sucres vs ligands.
has("const SUGAR_RES_SEL = '[GLC] or [NAG] or [MAN] or [BMA] or [SIA] or [NAN] or [GAL] or [FUC]';", '[sucres] liste explicite de resnames (NAN = l\'autre écriture de Neu5Ac)');
has('const SUGAR_SEL = `saccharide or ${SUGAR_RES_SEL}`;', '[sucres] mot-clé RÉEL de NGL 2.4 (pas `carbohydrate`) + liste');
has("not (${sugarSele})", '[ligands] le menu des ligands exclut les sucres');
/* ── 6. Les surfaces : couleur choisie PAR LE MENU (défaut / custom / ESP) ───
   addSurface reçoit désormais la CATÉGORIE : elle lit elle-même le mode de
   surface, la couleur et l'opacité de ce menu, donc les six menus (lipides
   compris) peuvent colorer leur surface — et plus seulement trois d'entre eux. */
has("addSurface(sugarSele, 'sugar', cs.sugar.surfaceOpacity);", '[sucres] surface propre au menu des sucres');
// 3. Surface d'eau + opacité.
has("addSurface('water', 'other', cs.other.surfaceOpacity);", '[eau] la surface s’applique à la sélection `water`, toute seule');
has("nglSeleCountCached(comp.structure, 'water') !== 0", '[eau] …même quand les atomes d’eau ne sont dans aucune autre sélection');
has("transparent: true, opacity: op", '[opacité] NGL reçoit transparent: true + opacity');
// Plus de curseur « Opacity » par menu : la TRANSPARENCE d'une rangée EST
// l'opacité de sa surface (sectionOpacity), et la rangée le DIT quand son style est
// une surface. La surface d'eau, elle, est un des styles de son propre espace.
has('const sectionOpacity = (look) => (', '[opacité] la transparence d’une rangée, en opacité NGL');
has("case 'surface': return [{ type: 'surface', params: { surfaceType: 'av', opacity:", '[opacité] une surface prend l’opacité de sa rangée');
has("case 'mesh': return [{ type: 'surface', params: { surfaceType: 'av', wireframe: true, opacity: 1 } }];",
  '[opacité] « Mesh » est un vrai wireframe, opaque');
has('a surface: the transparency above IS its opacity (100 % = wireframe-visible mesh)',
  '[opacité] la rangée le dit quand son style est une surface');
has("water: [{ sub: 'general', label: 'Water', styles: STYLES.small, colors: COLORS.water, def: { style: 'ball+stick', colorBy: 'element' }, sele: '' }],",
  '[eau] l’eau a son espace, et sa surface est un style de sa rangée');

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
// Les étiquettes 3D vivent maintenant dans l'ESPACE de chaque molécule (l'ancienne
// section « 4 · Labels » et les six menus de catégorie ont disparu) : cocher
// « Residues » dans un espace n'étiquette que les atomes de CETTE molécule.
has('const SECTION_LABEL_DEFAULTS = { residues: false, residueType: false, atoms: false };',
  '[étiquettes] les trois cases, par espace');
has('const setSectionLabel = (id, key, value) => setSectionLabels((prev) => ({', '[étiquettes] UNE écriture par espace');
has('onChange={(e) => setSectionLabel(sec.id, k, e.target.checked)}', '[étiquettes] les trois cases d’un espace');
has('allowed: new Set(indices)', '[étiquettes] build3dLabelMap ne reçoit que les atomes de l’espace');
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
has('onClick={toggleRenumberPanel}', '[conservé] 🔢 Renumber (le panneau unique du viewer)');
has('onClick={applyRenumberFrom}', '[conservé] « Renumber from »');
has("onChange={(e) => setSstrucColour(it.key, parseInt(e.target.value.slice(1), 16))}",
  '[conservé] couleurs 2° structure — la palette est dans la RANGÉE dès que « Secondary structure » est choisi');
has('onClick={() => setSstrucColors({ ...SSTRUC_COLOR_DEFAULTS })}', '[conservé] …et la roue ⚙ les remet à leurs défauts');
// Le contrôle de la couleur des atômes « assigned » a disparu avec les menus : la
// couleur reste celle du réglage enregistré, et le rendu la lit toujours.
gone('onChange={(e) => setAssignedAtomColor(parseInt(', '[supprimé] plus de pastille « couleur des assigned » dans les menus');
has('color: assignedAtomColorRef.current', '[conservé] la couleur des atomes assigned atteint le rendu');
has('onClick={() => setViewerCollapsed((v) => !v)}', '[conservé] repli de la fenêtre 3D');
// Le bouton « ✨ Full detail » (et son helper) est SUPPRIMÉ : cliquer dessus
// figeait la visualisation d'un gros système. Son effet est maintenant
// AUTOMATIQUE — le premier geste de style dans §2 appelle leaveLightMode() et
// redessine le système avec les représentations par catégorie — et la bannière
// « Large structure » qui bloquait les menus a disparu de l'écran (détail dans
// _large_system_style_test.mjs).
gone('onClick={useFullDetail}', '[supprimé] le bouton ✨ Full detail n’est plus rendu');
gone('const useFullDetail', '[supprimé] …ni son helper de bascule');
has('const leaveLightMode = () => {', '[rendu] le geste de style remplace le bouton (sortie du rendu léger)');
has('const setCatStyle = (cat, key, value) => {', '[rendu] …appelé par les six menus de §2');
gone('ℹ️ Large structure', '[supprimé] la bannière « Large structure » ne s’affiche plus au-dessus du 3D');
has('onClick={togglePlay}', '[conservé] ▶ Play de la trajectoire');
// La barre Molecules ne replie plus quatre groupes par molécule : chaque molécule
// a son ESPACE, et le style par molécule est celui de SES rangées — le même geste,
// à la bonne granularité (voir _viewer_color_settings_test.mjs).
has('{(entry.sections || []).map((sec) => renderSection(sec))}', '[conservé] style par molécule (un espace par molécule)');
has('const set = (field, value) => setSectionField(sec.id, kind, sub, field, value);',
  '[conservé] …branché sur setSectionField');
has("onChange={(e) => set('style', e.target.value)}", '[conservé] …le style de la rangée');
has("onChange={(e) => set('colorBy', e.target.value)}", '[conservé] …sa coloration');
has("onChange={(e) => set('opacity', Number(e.target.value))}", '[conservé] …sa transparence');
has('onClick={copySectionsToAll}', '[conservé] 🎨 Copy de la barre Molecules (le look d’une molécule aux autres)');
// La barre Molecules est aussi la maison du SMILES du ligand et du ⚙ des palettes.
has('{shownLigandSmiles && (', '[barre] le SMILES de la molécule / du ligand y est affiché');
has('onClick={copyLigandSmiles}', '[barre] …avec son bouton 📋 (copie)');
has('onClick={() => setSettingsPanelOpen(true)}', '[barre] ⚙ ouvre la roue des réglages');
has('onClick={() => setSelStyles({ ...selStylesRef.current,', '[conservé] styles par sélection (barre Selections)');
// La couleur de surface est une coloration de rangée comme une autre : elle
// choisit « Electrostatic potential (only surfaces) », et c'est le MÊME générateur
// (espColorParams) que le bouton ⚡ qui l’applique.
has("case 'esp': return espColorParams();", '[ESP] la rangée ESP passe par le même générateur');
has('{selections.length > 0 && (', '[conservé] barre verticale des sélections');
has('onClick={handleAbort}', '[conservé] ⏹ Abort');
has("setPymolScript(typeof entry === 'string' ? entry : (entry.script || ''))",
  '[conservé] chargement d’un script PyMOL de la Library');

/* ── 8. ESP branché dans les menus + un seul jeu de limites ─────────────── */
// La couleur de surface est rendue par UN helper partagé, appelé par les six
// menus (setSurfaceColor reçoit donc la catégorie, plus un menu précis).
has("const espColorParams = () => {", '[ESP] un SEUL générateur de couleurs ESP');
has("onChange={(e) => setSurfaceColor(cat, e.target.value)}", '[ESP] …branché sur setSurfaceColor(cat, …)');
has("if ((value === 'esp' || value === 'custom') && (!next.surface || next.surface === 'hide')) next.surface = 'transparent';",
  '[ESP/couleur] choisir ESP ou une couleur unie allume la surface : le choix ne reste jamais sans effet');
has("const espColorParams = () => {", '[ESP] un SEUL générateur de couleurs ESP');
has("return { colorScheme: 'electrostatic', colorScale: 'rwb', colorDomain: [-neg, pos] };",
  '[ESP] même schéma NGL que le bouton ⚡ (electrostatic + rwb + domaine ±kcal/mol)');
has('const colorParams = m.surfaceColor === \'esp\'',
  '[ESP] les surfaces de catégorie réutilisent ce générateur (défaut / custom / ESP)');
has('const customHex = m.surfaceColor === \'custom\' ? flatHex(m.surfaceColorHex) : null;',
  '[couleur] « Custom… » = une couleur unie pour toute la surface du menu');
has('catEspRepsRef.current.set(comp, []);', '[ESP] les surfaces ESP sont réenregistrées à chaque reconstruction');
has('catEspRepsRef.current.forEach((list) => {', '[ESP] ⚡ Range recolore aussi les surfaces de catégorie');
has('{(espOnSelected || catEspActive) && (', '[ESP] le panneau Range s’affiche pour les deux entrées ESP');
has("const r = addRow('surface', { sele, ...espColorParams(), transparent: true, opacity: 0.75 });",
  '[ESP] l’overlay ⚡ garde son colorScheme/colorScale (espColorParams)');

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
// NGL 2.4 n'a PAS de passe SSAO : ◐ Shadows pilote donc l'équivalent — ambiance
// profonde + lumière-clé forte + sur-échantillonnage — et le réglage vit
// maintenant dans src/utils/viewerLightRig.js (avec sa traduction Mol*, où
// l'occlusion est une vraie passe écran) : c'est _viewer_light_rig_test.mjs qui
// l'EXÉCUTE et vérifie chaque nombre.
has("import { LIGHT_RIG, nglKeyLightDirection, nglLightParams } from '../utils/viewerLightRig';",
  '[AO] la rig de lumière est un module à part, avec son propre garde-fou');
has('const installShadowLightRig = useCallback(() => {', '[AO] ◐ Shadows installe la rig (ambiance + lumière-clé)');
has('stage.setParameters(nglLightParams({ shadowOn: on, darkness: dark }));', '[AO] …alimentée par ◐ Shadows et 🌑 Darkness');

/* ── 11. Le rendu suit les menus (et plus les anciens sélecteurs) ───────── */
has('const catStylesRef = useRef(catStyles);', '[rendu] miroir synchrone des styles de catégorie');
has('const buildSectionReps = (comp, sections, trees, opts = {}) => {', '[rendu] UN constructeur de représentations par SECTION');
has('const applyCurrentStyleTo = useCallback((comp, baseReps) => {', '[rendu] les molécules extra passent par le même constructeur');
has('reps = applyCurrentStyleTo(comp, []);', '[rendu] …sans règle différente du rendu principal');
has('const catSelectionsFor = (structure) => {', '[rendu] sélections protein / nucleic / lipid / organic / others');
has("const sels = catSelectionsFor(comp.structure) || fallbackSels;", '[rendu] …réutilisées par le constructeur');
has("else if (bb === 'trace') add('trace', { sele: sels.protein, ...col, quality: 'high' });",
  '[rendu] Trace (C-α) = représentation NGL « trace » réelle (couleur du menu A)');
has("if (bases === 'slab') add('base', { sele: sels.nucleic, ...baseSlabCol, ...stickGeom('nucleic', BASE_BOND_RADIUS) });",
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
