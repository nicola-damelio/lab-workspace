/* =========================================================================
   _viewer_ui_layout_test.mjs — la NOUVELLE ORGANISATION DE L'INTERFACE du
   viewer 3D partagé (NMR / MD / Docking).

   Ce qui doit rester vrai :

     • le bouton « ⬇ Minimize » est SEUL tout en haut de la fenêtre (§0) ;
     • les sept sections numérotées existent, dans l'ordre demandé :
       1 General · 2 Molecular Styling · 3 Scene · 4 Labels · 5 Modify ·
       6 Analysis · 7 Selections & PyMOL ;
     • §2 porte les contrôles Docking, « Hide everything » et CINQ menus
       indépendants par catégorie (A Proteins · B Nucleic acids · C Lipids ·
       D Organic molecules · E Others), avec les listes d'options demandées ;
     • les anciens menus globaux (Side / Backbone / Mol / Large / Water) ont
       disparu de la barre d'outils — leur fonctionnalité vit dans les menus ;
     • RIEN n'a été perdu : ESP, lumière/ombres, sélections PyMOL, mesure,
       assigned, renumérotation, couleurs, rebuild H, renommage, labels,
       drag, large systems, barre de lecture de trajectoire, repli de la
       séquence ;
     • les nouvelles mailles sont marquées castShadow + receiveShadow ;
     • le plan de coupe (clipping) est un NOUVEAU réglage réel (clipNear /
       clipFar / clipDist de NGL 2.4).

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
const iReturn = VIEW.indexOf('return (\n<div className="flex flex-col gap-3">');
ok(iReturn > 0, 'la racine du viewer est un empilement de sections');
const iMin = VIEW.indexOf('{viewerCollapsed ? \'⬆ Expand viewer\' : \'⬇ Minimize viewer\'}');
const iS1 = VIEW.indexOf('<VSection title="1 · General"');
ok(iMin > iReturn && iMin < iS1, 'le bouton Minimize est rendu AVANT toute autre section');
ok(!VIEW.slice(iReturn, iMin).includes('<VSection'), '…et aucune section ne le précède');
ok(VIEW.indexOf('Retract (minimize) the 3D viewer window') > 0, 'son infobulle décrit le repli de la fenêtre');

/* ── 2. Les sept sections, dans l'ordre ─────────────────────────────────── */
const order = [
  '<VSection title="1 · General"',
  '<VSection title="2 · Molecular Styling"',
  '<VSection title="3 · Scene"',
  '<VSection title="4 · Labels"',
  '<VSection title="5 · Modify"',
  '<VSection title="6 · Analysis"',
  '<VSection title="7 · Selections & PyMOL"',
];
order.forEach((marker) => has(marker, `section ${marker.replace('<VSection title=', '').replace('"', '')} présente`));
for (let i = 1; i < order.length; i++) {
  ok(VIEW.indexOf(order[i - 1]) < VIEW.indexOf(order[i]), `la section ${i} précède la section ${i + 1}`);
}
has('<VSection title="▶ Trajectory playback"', 'la barre de lecture a sa propre section, juste au-dessus du viewer');

/* ── 3. §1 General : PDB / Load / Trajectory / Clear / Figure ───────────── */
has('📂 PDB file(s)', '[§1] chargement de fichier(s) PDB');
has('onChange={handleFileChange}', '[§1] …branché sur handleFileChange');
has('placeholder="PDB ID or URL"', '[§1] champ PDB ID / URL');
has('onClick={handlePdbIdLoad}', '[§1] bouton Load');
has('📂 Trajectory', '[§1] bouton Trajectory');
has('if (f) handleTrajFileChosen(f);', '[§1] …branché sur handleTrajFileChosen');
has('onClick={handleClearViewer}', '[§1] bouton Clear');
has('onClick={captureScene}', '[§1] bouton Figure');
has('{captureMsg && (', '[§1] message de capture');

/* ── 4. §2 : docking, hide everything, cinq menus ───────────────────────── */
has('{(moleculeType === \'protein\' || extraMols.length > 0 || dockStyleMode) && (', '[§2] contrôle Docking conservé');
has('🧬 Docking: {dockStyleMode ? \'On\' : \'Off\'}', '[§2] toggle Docking On/Off');
has('{renderDockRoleSelects(', '[§2] menus Prot: / Lig: du docking');
has('onClick={captureDockStylesFromViewer}', '[§2] 📸 View du docking');
has('{hideAll ? \'👁️ Show default\' : \'🙈 Hide everything\'}', '[§2] Hide everything');

has('label="A · Proteins"', '[§2] menu A · Proteins');
has('label="B · Nucleic acids"', '[§2] menu B · Nucleic acids');
has('label="C · Lipids"', '[§2] menu C · Lipids');
has('label="D · Organic molecules (ligands)"', '[§2] menu D · Organic molecules');
has('label="E · Others (ions · solvent / water)"', '[§2] menu E · Others');

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
has('<option value="dots">Dots (lightest)</option>', '[E] eau : Dots (le plus léger)');
has('<option value="points">Points (sized)</option>', '[E] eau : Points');
has('label="Water surface"', '[E] surface d’eau (Solid / Transparent / Mesh)');

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
has('onChange={(e) => setShowResidueNumber(e.target.checked)}', '[conservé] étiquette Residues');
has('onChange={(e) => setShowResidueNumberType(e.target.checked)}', '[conservé] étiquette Residue type');
has('onChange={(e) => setShowAtomLabel(e.target.checked)}', '[conservé] étiquette Atom names');
has('onClick={() => setDragMove((v) => !v)}', '[conservé] ✋ Drag');
has('onClick={rebuildHydrogensNow}', '[conservé] ⚗️ Rebuild H');
has('onClick={() => setShowAtomPanel((v) => !v)}', '[conservé] ✏️ panneau Atom names (renommage)');
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
has('onClick={useFullDetail}', '[conservé] ✨ Full detail (grands systèmes)');
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

/* ── 9. §3 Scene : fog, ombres, NOUVEAU plan de coupe ───────────────────── */
has('const CLIP_DEFAULTS = { near: 0, far: 100, dist: 10 };', '[§3] défauts de clipping = ceux de NGL');
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
has('↺ NGL defaults', '[§3] retour aux valeurs NGL');

/* ── 10. Ombres : les nouvelles mailles sont cast + receive ─────────────── */
has('const flagMeshShadows = (rep) => {', '[ombres] helper de marquage des mailles');
has('o.castShadow = true;\n            o.receiveShadow = true;', '[ombres] cast ET receive sur chaque maille');
has('if (r) { flagMeshShadows(r); reps.push(r); }', '[ombres] appelé pour CHAQUE représentation des menus');

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
