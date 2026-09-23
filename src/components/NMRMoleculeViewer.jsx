import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ensureNGL } from '../utils/ngl';
// The LIGHT RIG of the scene (§3 Scene → « ◐ Shadows » · « 🌑 Darkness » ·
// « 💡 Light »): one single source of truth for the light colour, intensity,
// direction and sampling level — shared with the Mol* translation that draws the
// projected shadows and the ambient occlusion (utils/viewerLightRig.js).
import { LIGHT_RIG, nglKeyLightDirection, nglLightParams } from '../utils/viewerLightRig';
import { computeSmiles3DNameMap } from '../utils/atomNameSync';
import { rebuildProteinHydrogenCoords } from '../utils/rebuildProteinHydrogens';
import { readXtcFrames, countXtcFrames, countXtcFramesInFile } from '../utils/xtcDecoder';
import { abortControl, useAbortControl } from '../utils/abortControl';
// HETATM code → SMILES: the Chemistry Component Dictionary of the RCSB (see
// utils/ligandSmiles.js). A PDB only names its ligand by a 3-letter code, so this
// is where the SMILES of a hand-loaded ligand comes from.
import { cachedLigandSmiles, fetchLigandSmiles } from '../utils/ligandSmiles';
import { archiveFileToDrive } from '../utils/driveUpload';
import { getPymolScripts } from '../utils/pymolScripts';
import { getActiveProjectId, publishLibraryFigure } from '../utils/figuresLibrary';
import { SEQUENCE_NATURES } from '../utils/sequenceNatures';

/* ---- Shared "Assigned atoms" highlight flag ---------------------------------
   The green "assigned atoms" highlight is shown both on the 3D molecule viewer
   (ball+stick representation) and on the SIMULATED SPECTRA (green marks on the
   peaks of manually-assigned atoms). Both read this one flag, so the single
   "🟢 Assigned atoms ON/OFF" button controls them together. */
let showAssignedFlag = true;
const assignedListeners = new Set();

export const getShowAssignedFlag = () => showAssignedFlag;

export const setShowAssignedFlag = (v) => {
  showAssignedFlag = !!v;
  assignedListeners.forEach((fn) => { try { fn(showAssignedFlag); } catch {} });
};

export const useShowAssignedFlag = () => {
  const [v, setV] = useState(getShowAssignedFlag());
  useEffect(() => {
    assignedListeners.add(setV);
    return () => { assignedListeners.delete(setV); };
  }, []);
  return v;
};

// ---- Trajectory frame selection -------------------------------------------
// Frame COUNT is what matters (not file size). Before parsing a trajectory the
// user is always asked how to load it: the full trajectory, the default of
// ~30 representative frames spread across the whole run, or a custom number.
const TARGET_TRAJ_FRAMES = 30;                   // default representative frame count
const TARGET_TRAJ_BYTES = 2 * 1024 * 1024 * 1024;  // 2 GB effective-load cap

const fmtBytesMB = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const fmtBytesGB = (b) => `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;

// Rough bytes/frame estimate per format (coordinates + box + header).
const estimateTrajectoryFrames = (file, atomCount) => {
  const name = (file.name || '').toLowerCase();
  const n = atomCount > 0 ? atomCount : 300; // fallback atom count
  let bytesPerFrame;
  if (name.endsWith('.trr')) bytesPerFrame = n * 3 * 8 + 44;     // doubles
  else if (name.endsWith('.dcd')) bytesPerFrame = n * 3 * 4 + 40; // floats
  else bytesPerFrame = n * 3 * 2 + 48;                            // XTC (compressed ints)
  return {
    estFrames: Math.max(1, Math.round(file.size / Math.max(1, bytesPerFrame))),
    bytesPerFrame
  };
};

// ---- Large-structure handling ----------------------------------------------
// Large systems (e.g. a protein embedded in a lipid bilayer with explicit
// TIP3P water) are loaded in full and rendered in FULL — nothing is deleted.
// Above the thresholds below the default representations switch to ONE
// lightweight style for every atom (see addDefaultReps / the "Large:" selector):
// lines (bonds, the default), spheres or dots. WATER is left out of the default
// view — it dominates the atom count of solvated systems and hides the protein —
// and comes back with the "💧 Water" checkbox.
const LARGE_STRUCT_BYTES = 1.5 * 1024 * 1024;   // ~1.5 MB of structure text
const LARGE_ATOM_COUNT = 25000;                 // lighter rendering above this

/* ============================================================================
   MOLECULAR STYLING — per-CATEGORY presets (section « 2. Molecular Styling »)
   ----------------------------------------------------------------------------
   The old single-row selectors (Side / Backbone / Mol / Large / Water) applied
   ONE style to a whole class of atoms. They are replaced by five independent
   per-category menus — Proteins / Nucleic acids / Lipids / Sugars /
   Organic molecules / Others — so a membrane system can be styled category by
   category (lipids into headgroups / glycerol backbone / acyl chains, sugars
   separately from generic ligands).

   Every token below maps 1:1 to a real NGL 2.4 representation type (verified
   against the representation registry of the installed `ngl` package):

     cartoon · trace · tube · ribbon · licorice · stick · ball+stick · line ·
     spacefill · dot · point · base · surface ({ opacity } / { wireframe }) …

   `trace` is NGL's own spline through the TRACE ATOMS of a polymer, which are
   the residue types' `traceAtomIndex` → CA for amino acids, P for nucleotides
   (AtomProxy#isTrace). It is therefore the honest implementation of
   « Trace (C-alpha) » for proteins and of « Phosphate Trace » for nucleic acids.

   Surfaces: solid = opacity 1, surfaceOpacity (default 0.4) = transparent,
   mesh = wireframe. Whenever a menu is set to « Transparent », an Opacity
   slider (0 → 1) appears next to it and its value is what NGL receives as
   `opacity` (with `transparent: true`).
   `wireframe` is a real Buffer parameter (BufferMaterials 'wireframeMaterial');
   the surface representation only refuses it together with `contour` (volume
   isosurfaces), never for the molecular surfaces built from a structure.
   ============================================================================ */

/* ============================================================================
   WHAT EACH MENU OF §2 CARRIES NOW (one menu per molecule category, A → F)
   ----------------------------------------------------------------------------
   Style + Surface (+ Opacity) as before, PLUS three shared controls that every
   menu owns its own copy of:

     · « Atom colour »      — « Default (element colours) », or ONE flat colour
                              (NGL takes a hex number as `color`). The protein
                              and nucleic BACKBONES keep their rainbow-by-residue
                              default until a colour is chosen.
     · « Surface colour »   — « Default (element colours) », « Custom colour… »
                              or « Electrostatic Potential (ESP) » (menus with a
                              surface). « Custom » is what makes a surface a
                              plain coloured plate.
     · « Sphere radius » /  — two MULTIPLIERS, 1.00 = the NGL default of the
       « Bond radius »        style, so an untouched menu draws exactly what it
                              drew before:
                                Sphere radius → NGL `radiusScale` (spacefill:
                                                × the Van der Waals radius) or
                                                NGL `aspectRatio` (ball+stick
                                                family: atom sphere = aspectRatio
                                                × radiusSize). Licorice is the
                                                exception — NGL pins its
                                                aspectRatio at 1, so there the
                                                spheres follow the bond radius.
                                Bond radius   → NGL `radiusSize` (Å), the CORE
                                                radius of the sticks of ball+stick
                                                / licorice / base, and NGL
                                                `linewidth` for the line styles.

   « LICORICE » is NGL's ONLY stick style: the installed 2.4 build registers
   `ball+stick`, `licorice`, `spacefill`, `line`, `point`, `dot`, `base` … but NO
   `stick` — the old `add('stick', …)` calls therefore threw and the sticks never
   appeared. Every « Sticks » token now really draws licorice (the same visual
   intent, at the app's own stick thickness, and the menu says « Licorice »).

   NUCLEIC ACIDS (menu B) — the 🎨 Colours button of that menu opens a panel of
   its OWN (the protein one, i.e. the helix / sheet / loop colours, made no sense
   there): phosphate backbone · pentose rings · bases. Switching « Colour by
   chemical group » ON colours a nucleic acid by those three groups through ONE
   custom NGL scheme (registered like lab-sstruc, reading a live store, so a
   swatch only re-renders). The classification is the standard nucleotide
   notation: P / OP1 / OP2 / OP3 (and O1P / O2P / O3P) = phosphate, EVERY primed
   atom name (C1'…C5', O2'…O5', O4', H…, and the older `C1*` spelling) = pentose
   ring, everything else (N1…N9, C2 / C4…C8, O2 / O4 / O6, C5M…) = base.

   The Bases dropdown also gained « Stylized rings (filled plates) »: the filled
   rungs of NGL are NOT a plate (its `base` representation is a Ball & Stick over
   the rung atoms), so the viewer draws the plates ITSELF — the ring system of each
   base AND the ribose ring, discovered on the bond graph of the nucleotide, filled
   by a MeshBuffer whose triangles are a fan in the plane of the ring (see
   nucleicRingPlates). That is the viewer's answer to PyMOL's stylized look:
   `set cartoon_ring_mode, 1` + `cartoon_ring_color` + `cartoon_ring_transparency`
   are settings of the 🎨 panel of this menu (one colour per base — or ONE colour —
   and a Ring transparency, 0 = SOLID by default), and the PyMOL panel understands
   those four `set` commands as well. With the backbone on « Cartoon » (the NGL
   nucleic ribbon) that is the classic stylized DNA / RNA ladder: a flat ribbon
   with the solid coloured plates inside it.

   EVERY menu colours BOTH families of representations with the SAME rule
   (catColorParams): « Atom colour » is read once per menu and applies to the ribbon
   (cartoon / ribbon / tube / trace) AND to the atoms / bonds (ball+stick ·
   licorice · lines · spheres) — the classic element colours, ONE flat colour, the
   customisable 2°-structure colours (helix / sheet / loop: moving a swatch switches
   the Proteins menu to that mode, so a chosen colour can never be ignored by the
   rainbow-by-residue default it used to be drawn with) or a two-colour GRADIENT
   along the sequence: from the first to the last residue of every chain, i.e.
   N terminus → C terminus for a protein and 5' → 3' for a nucleic acid. The ramp
   is a home-made scheme reading a live store, whose per-chain residue ranges are
   measured on the structure that is actually drawn (gradientRangesFor), and the ⇄
   button of the menu swaps the two colours.

   LIPIDS (menu C) — exactly the same idea for the three PARTS of a lipid:
   headgroup · glycerol backbone · acyl chains. The 🎨 Colours button of that menu
   opens its own panel, « Colour by chemical part » colours every lipid
   representation through ONE custom scheme (lab-lipid-groups, again a live store),
   and moving a swatch switches the mode on so the choice is never invisible. The
   HEADGROUP IS THE EXCLUSION — every lipid atom that is neither an acyl-chain atom
   nor a backbone atom — so a headgroup drawn as Ball & Stick shows all its atoms
   and all their bonds (naming the head positively left the choline / ethanolamine
   carbons and every head hydrogen out, which cut the head into fragments). Which
   part an atom belongs to is decided in JS (the standard CHARMM / AMBER atom
   names, or an element rule for a file that renames its atoms after their
   element), then handed to NGL as atom INDICES: NGL 2.4's `.NAME` rules are exact
   matches and understand no wildcard, so « .O1* » only ever matched an atom
   literally called O1. ONE classifier drives both the drawing and the colouring.

   Every home-made scheme goes through ONE helper, registerColorScheme: NGL's
   ColormakerRegistry.addScheme wants the DEFINITION first and the LABEL second,
   and an id whose scheme cannot be instantiated is never handed to a
   representation (the caller falls back to a built-in NGL colour). A swapped
   order — as this file once had — registers a class that `.call()`s a string, so
   every representation using that id threw while building and drew nothing.

   GLYCANS & LIPID CLASSES (PART 2.2bis / 2.1bis) — a linked glycan arrives as one
   HETATM residue per sugar and nothing says they belong together, so the
   GLYCOSIDIC bond is read from the topology — from NGL's own bond graph, or, when
   a file carries no CONECT record, from the interatomic distance (the anomeric
   carbon C1, C2 of a sialic acid, within one covalent C–O bond of an oxygen of
   the next sugar — WHATEVER that oxygen is called: O4 · O6 of a hexopyranose, O3
   of a furanose, O8 · O9 of an α2→8 · α2→9 sialic acid) —, the linked monomers are
   merged into ONE entity (« Glycan (linked sugars) », lab-glycans) AND the linkage
   is WRITTEN INTO the structure's bond graph (ensureGlycanBonds), so the drawn
   chain has its connecting stick and every bond reader sees ONE molecule; the
   residue name alone gives the
   lipid's headgroup CLASS (PC · PE · PG · PS · PI · PA · CL · SM · Chol · FA,
   read from the end of the 3-letter code — POPC = DP + PC, TOCL = TO + CL, and
   the short codes POP · DPQ · EPH · PGL · CLR of the request), which is the
   « Lipid class » colouring (lab-lipid-class).

   CONFORMATIONS & MOTIFS (PART 3) — A · B · Z DNA, A · flexible RNA, and the two
   motifs NO file annotates (a G-quadruplex, a hairpin) are read from the
   COORDINATES by pure functions: χ (O4'-C1'-N9-C4 / O4'-C1'-N1-C2) for the
   syn / anti conformation — a syn purine alternating with anti pyrimidines is the
   left-handed Z form —, δ (C5'-C4'-C3'-O3') for the sugar pucker (C3'-endo = the
   A family, C2'-endo = B-DNA or a flexible loop of an RNA) with the C1'-N → P
   distance as the fallback when δ is missing, the Hoogsteen N1···O6 / N2···N7
   distances for the coplanar G-tetrads and their 3.3 – 3.4 Å stacking for the
   quadruplex, and the Watson-Crick / wobble H-bonds plus the P → O3' backbone
   for a hairpin (stem of three pairs, loop of 3 – 10 residues). They are ONE
   custom scheme each — lab-nuc-form and lab-nuc-motif, which hands every
   nucleotide outside a motif its normal 2°-structure colour — and the six form /
   two motif colours are editable in the ⚙ settings wheel.

   SCENE (§3) — the background of the 3D scene is a colour of its own (« 🎨
   Background »), persisted like Fog / Shadows / Clipping, and it is part of a
   saved setup.

   SAVED SETUPS (⚙️ Setup, §1 General) — « Save the visualisation setup »: a NAMED
   snapshot of the whole viewer look (the six menus with their radii and colours,
   the nucleic-acid group colours and the lipid part colours, the label switches,
   the 2°-structure and highlight colours, Fog / Shadows / Clipping / Background /
   quality, the lightweight style of a large system) kept in localStorage,
   listable, loadable, deletable, and exportable / importable as a .json file — so
   a look can be reused on another page or another computer.
   ============================================================================ */
const CAT_STYLE_KEY = 'labViewerCategoryStyles';
// Saved visualisation setups (⚙️ Setup, §1 General). One localStorage entry holds
// a { name → setup } map; a setup is the plain object built by captureViewerSetup
// and read back by applyViewerSetup, with a version so an older file can never
// break the viewer (unknown / missing keys simply keep their default).
const VIEWER_SETUP_KEY = 'labViewerSetups';
const VIEWER_SETUP_VERSION = 1;
// Sphere / bond radius sliders (one pair per menu) — MULTIPLIERS of the style's
// own NGL default: 1.00 leaves the drawing untouched, so a menu that is never
// moved still draws exactly what it drew before (see catRadii for what each
// multiplier drives).
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 3;
const RADIUS_STEP = 0.05;
// The natural CORE radius (Å) of the sticks of each stick style, as NGL 2.4
// defaults them (verified in the installed build: BallAndStickRepresentation#init
// → radiusSize 0.15, BaseRepresentation#init → radiusSize 0.3). « Licorice » is
// the app's own stick thickness — 0.25 Å, the value the protein side chains have
// always used — because licorice IS the stick style NGL really registers (there
// is no `stick` representation in NGL 2.4).
const BALLSTICK_BOND_RADIUS = 0.15;
const LICORICE_BOND_RADIUS = 0.25;
const BASE_BOND_RADIUS = 0.3;
// Flat colour proposed when a menu is switched to « Atom colour : Custom… » — a
// visible, category-flavoured default (blue proteins, violet nucleic acids, amber
// lipids, rose sugars, emerald ligands, sky solvent), and the neutral plate
// proposed for « Surface colour : Custom… ».
const DEFAULT_ATOM_COLORS = {
  protein: 0x3b82f6, nucleic: 0xa855f7, lipid: 0xf59e0b,
  sugar: 0xf43f5e, organic: 0x10b981, other: 0x0ea5e9,
};
// The FIVE base types of « Color by : Base type » (and of the base rings) — the
// list the ⚙ settings wheel draws its swatches from, so the palette, the scheme
// and the wheel can never drift apart.
const BASE_TYPE_ORDER = ['A', 'C', 'G', 'T', 'U'];
const DEFAULT_SURFACE_COLOR = 0xcbd5e1;
// Group colours of the 🔬 Nucleic-acids menu (the 🎨 Colours panel of menu B):
// phosphate backbone · pentose ring · bases.
const DEFAULT_NUCLEIC_COLORS = { phosphate: 0xff922b, pentose: 0x4ea1ff, base: 0xb14aff };
// Group colours of the 🧫 Lipids menu (the 🎨 Colours panel of menu C):
// headgroup · glycerol backbone · acyl chains.
const DEFAULT_LIPID_COLORS = { head: 0xef4444, glycerol: 0x22c55e, acyl: 0x64748b };
// The stylized per-base palette of the Bases option « Stylized rings » — the
// colour that FILLS the inside of the ring of each base.
const BASE_IDENTITY_COLORS = { A: 0x22c55e, C: 0x3b82f6, G: 0xf59e0b, T: 0xec4899, U: 0xef4444 };
// The ⚙ settings wheel edits THIS store (one swatch per base type), and the scheme
// registered below (lab-base-type) reads it live, exactly like lab-elements /
// lab-sugar-identity — so moving a swatch only re-renders the representations.
const baseTypeColorStore = { ...BASE_IDENTITY_COLORS };
const baseTypeColorOf = (base) => {
  const b = String(base || '').trim().toUpperCase();
  const v = baseTypeColorStore[b];
  return Number.isFinite(v) ? v : 0xbdbdbd;
};
// The definition of the scheme (named so a test can extract and really run it).
const defineBaseTypeScheme = () => {
  return function () {
    this.atomColor = function (atom) { return baseTypeColorOf(nucBaseOf(atom && atom.resname)); };
  };
};
let baseTypeSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
const registerBaseTypeScheme = (NGL) => {
  if (baseTypeSchemeKey) return;
  baseTypeSchemeKey = registerColorScheme(NGL, 'lab-base-type', defineBaseTypeScheme());
};
// The two colours of « Atom colour → Gradient » — the gradual colouring of a
// polymer ALONG its sequence: `from` sits on the first residue (the N terminus
// of a protein, the 5' end of a nucleic acid), `to` on the last one (C terminus
// / 3' end). See gradientColorStore / gradientRangesFor (PART 2.1). The ⇄ button
// of the menu swaps the two, which is the whole « reverse » control it needs.
const DEFAULT_GRADIENT_COLORS = { from: 0x2563eb, to: 0xdc2626 };
// The stylized nucleic look (Bases → « Stylized rings ») fills the base rings and
// the ribose ring with a SOLID PLATE (see nucleicRingPlates). 0 = solid, which is
// exactly what « as if they were solid plates » asks for; 0.5 is PyMOL's example
// (set cartoon_ring_transparency, 0.5). The plate colour of one ring is the
// identity of its base (BASE_IDENTITY_COLORS) — or ONE flat colour, i.e. PyMOL's
// set cartoon_ring_color.
const RING_TRANSPARENCY_DEFAULT = 0;
const RING_TRANSPARENCY_MAX = 0.95;   // never fully invisible (a plate that shows nothing is a bug)
// The five fields every menu owns on top of its styles: the atom colour, the
// surface colour and the sphere / bond radius multipliers. ONE factory keeps the
// six entries readable and impossible to half-fill.
const catLook = (atomColorHex) => ({
  atomColor: 'default',
  atomColorHex,
  gradientFrom: DEFAULT_GRADIENT_COLORS.from,
  gradientTo: DEFAULT_GRADIENT_COLORS.to,
  surfaceColor: 'default',
  surfaceColorHex: DEFAULT_SURFACE_COLOR,
  sphereRadius: 1,
  bondRadius: 1,
});
// The six styling menus of §2, in the order they are rendered. ONE list drives
// the defaults, the localStorage merge, the change signature and the menus.
const CAT_STYLE_CATS = ['protein', 'nucleic', 'lipid', 'sugar', 'organic', 'other'];
const DEFAULT_CAT_STYLES = {
  // A. Proteins — backbone + surface (side chains keep their own effect and
  //    their own `sidechainStyle`, so no existing logic is duplicated; they obey
  //    this menu's radius / atom-colour fields).
  protein: { backbone: 'cartoon', surface: 'hide', surfaceOpacity: 0.4, ...catLook(DEFAULT_ATOM_COLORS.protein) },
  // B. Nucleic acids — backbone / bases / surface + the group colours of the
  //    🎨 Colours panel (phosphate · pentose · bases) and its switch, PLUS the
  //    stylized ring plates of « Stylized rings »: their colour mode, their one
  //    flat colour (PyMOL's cartoon_ring_color), their transparency (PyMOL's
  //    cartoon_ring_transparency) and the ribose ring plate switch.
  nucleic: {
    backbone: 'cartoon', bases: 'slab', surface: 'hide', surfaceOpacity: 0.4,
    ...catLook(DEFAULT_ATOM_COLORS.nucleic),
    groupColour: false,
    phosphateColor: DEFAULT_NUCLEIC_COLORS.phosphate,
    pentoseColor: DEFAULT_NUCLEIC_COLORS.pentose,
    baseColor: DEFAULT_NUCLEIC_COLORS.base,
    ringColour: 'base',
    ringColorHex: DEFAULT_NUCLEIC_COLORS.base,
    ringTransparency: RING_TRANSPARENCY_DEFAULT,
    sugarPlate: true,
  },
  // C. Lipids — the three sub-components are styled INDEPENDENTLY (headgroups /
  //    glycerol backbone / acyl chains), see lipidSubSelections below, and the
  //    🎨 Colours panel adds the part colours of that menu. The menu also carries
  //    a surface (hidden by default, like every other menu).
  lipid: {
    head: 'spheres', glycerol: 'ball+stick', tail: 'lines', surface: 'hide', surfaceOpacity: 0.4,
    ...catLook(DEFAULT_ATOM_COLORS.lipid),
    groupColour: false,
    headColor: DEFAULT_LIPID_COLORS.head,
    glycerolColor: DEFAULT_LIPID_COLORS.glycerol,
    tailColor: DEFAULT_LIPID_COLORS.acyl,
  },
  // D. Sugars (carbohydrates) — their own menu, so a glycan is never styled as
  //    a generic ligand.
  sugar: { style: 'ball+stick', surface: 'hide', surfaceOpacity: 0.4, ...catLook(DEFAULT_ATOM_COLORS.sugar) },
  // E. Organic molecules (ligands / small molecules) — style / surface.
  organic: { style: 'ball+stick', surface: 'hide', surfaceOpacity: 0.4, ...catLook(DEFAULT_ATOM_COLORS.organic) },
  // F. Others — ions / water / surface. Water stays HIDDEN by default: that is
  //    exactly what the viewer did before (a protein system drew
  //    `hetero and not water`), and it keeps a solvated box readable.
  other: { ion: 'spheres', water: 'hidden', surface: 'hide', surfaceOpacity: 0.4, ...catLook(DEFAULT_ATOM_COLORS.other) },
};
const cloneCatStyles = () => Object.fromEntries(
  CAT_STYLE_CATS.map((c) => [c, { ...DEFAULT_CAT_STYLES[c] }]),
);
// Restore the saved per-category styles (localStorage, like Fog / Shadows /
// clipping). Unknown keys simply fall back to the default. A LOOK field that the
// entry carries is marked as OVERRIDDEN (see overridesLook): it is a value the
// user chose in that menu, so it must keep following nothing — the fields the
// entry does not carry keep following the general look.
const loadCatStyles = () => {
  const out = cloneCatStyles();
  try {
    const raw = localStorage.getItem(CAT_STYLE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      Object.keys(out).forEach((k) => {
        if (!saved[k] || typeof saved[k] !== 'object') return;
        const ovr = { ...DEFAULT_LOOK_OVERRIDES, ...(saved[k].ovr || null) };
        Object.keys(saved[k]).forEach((field) => {
          if (field === 'ovr') return;
          out[k][field] = saved[k][field];
          if (isLookKey(field)) ovr[field] = true;
        });
        out[k].ovr = ovr;
      });
    }
  } catch { /* first run / private mode → defaults */ }
  return out;
};
const saveCatStyles = (v) => {
  try { localStorage.setItem(CAT_STYLE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
};
// One string that changes whenever ANY category style changes — used as the
// dependency / comparison signature that rebuilds the base representations.
const catStylesSig = (v) => JSON.stringify(CAT_STYLE_CATS.map((c) => (v && v[c]) || DEFAULT_CAT_STYLES[c]));

/* ---- SPHERE / BOND RADIUS of one category ---------------------------------
   The two sliders of every menu of §2 are read here — by the renderer AND by the
   panel itself — as two MULTIPLIERS (1.00 = the NGL default of the style, so a
   menu nobody touched is drawn exactly as before):

     • bond   → NGL `radiusSize` (Å), the CORE radius of the sticks:
                ball+stick · licorice · base (see the *BOND_RADIUS constants), and
                NGL `linewidth` for the line styles;
     • sphere → the radius of the SPHERES alone: NGL `radiusScale` for the
                spacefill styles (× the Van der Waals radius — the documented
                sphere knob of a structure representation) and NGL `aspectRatio`
                for the ball+stick family (documented as the « size difference
                between atom and bond radii »: the atom sphere is
                aspectRatio × radiusSize). Licorice is the ONE exception: NGL pins
                its aspectRatio at 1 so its spheres ARE the bond radius — there the
                Sphere slider therefore only changes the stick thickness, which is
                what licorice is.
   Both values are clamped, so a corrupt / hand-edited localStorage entry can never
   produce an invisible or gigantic drawing. */
const catRadii = (cs) => {
  const c = cs || {};
  const clamp = (v, d) => (Number.isFinite(v) && v > 0 ? Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, v)) : d);
  return { sphere: clamp(c.sphereRadius, 1), bond: clamp(c.bondRadius, 1) };
};

/* ---- Which CHEMICAL GROUP a nucleotide atom name belongs to ----------------
   The classification of the 🔬 Nucleic-acids menu's colour panel. It follows the
   standard nucleotide notation (PDB / CHARMM / AMBER), which is what makes it
   honest on a real file:

     · phosphate — the phosphorus and the oxygens attached to it alone:
                   P · OP1 · OP2 · OP3 · O1P · O2P · O3P (and their hydrogens);
     · pentose   — EVERY primed name: C1' … C5', O2' … O5', O4', H1' … H5'',
                   HO2' / HO3' / HO5' … i.e. the ribose / 2'-deoxyribose ring and
                   its exocyclic CH2-OH. Older files spell the prime `*`
                   (C1*, O4*) — both are accepted;
     · base      — everything else of the nucleotide: N1 / N2 / N3 / N4 / N6 /
                   N7 / N9, C2 / C4 / C5 / C6 / C8, O2 / O4 / O6, C5M / CH3, and
                   the hydrogens of those rings. */
const nucleicGroupOf = (name) => {
  const n = String(name || '').replace(/\s+/g, '').toUpperCase();
  if (!n) return 'base';
  if (/^(P|OP[123]|O[123]P|HOP|HO[123]P[12]?)$/.test(n)) return 'phosphate';
  if (n.indexOf("'") >= 0 || n.indexOf('*') >= 0) return 'pentose';
  return 'base';
};

/* ---- The BASE a nucleic residue carries (Bases → « Stylized rings ») ---------
   The base identity is read from the residue name of the atom, with the standard
   nucleic residue names of every dialect: A / DA / RA / ADE → A, C / DC / RC /
   CYT → C, G / DG / RG / GUA → G, T / DT / THY → T, U / RU / URA → U. ONE reader,
   used by the stylized per-base colour below AND by the conformation classifier
   of PART 3, which has to know a purine from a pyrimidine. */
const nucBaseOf = (resname) => {
  const n = String(resname || '').trim().toUpperCase();
  const m = /^[DR]?([ACGTU])/.exec(n);
  return m ? m[1] : '';
};
const baseIdentityColorOf = (resname) => {
  const b = nucBaseOf(resname);
  return b ? baseTypeColorOf(b) : 0xbdbdbd;
};
// ---- The 20 amino acids of « Color by : Residue » ---------------------------
// ONE swatch per residue (the classic CPK-flavoured residue colours), editable in
// the ⚙ settings wheel like every other palette of the viewer: a protein coloured
// by residue then says the same thing on every page. A nucleic residue takes the
// colour of its BASE (see residueColorOf), because that IS its residue identity.
const RESIDUE_COLOR_PALETTE = {
  ALA: 0x8cff8c, ARG: 0x00007c, ASN: 0xff7c70, ASP: 0xa00042, CYS: 0xffff70,
  GLN: 0xff4c4c, GLU: 0x660000, GLY: 0xffffff, HIS: 0x7070ff, ILE: 0x004c00,
  LEU: 0x455e45, LYS: 0x4747b8, MET: 0xb8a042, PHE: 0x534c52, PRO: 0x525252,
  SER: 0xff7042, THR: 0xb84c00, TRP: 0x4f4600, TYR: 0x8c704c, VAL: 0xff8cff,
};
const RESIDUE_ORDER = Object.keys(RESIDUE_COLOR_PALETTE);
const residueColorStore = { ...RESIDUE_COLOR_PALETTE };
const residueColorOf = (resname) => {
  const n = String(resname || '').trim().toUpperCase();
  if (nucBaseOf(n)) return baseTypeColorOf(nucBaseOf(n));   // A · DA · RA · 5MC …
  const v = residueColorStore[n];
  return Number.isFinite(v) ? v : DEFAULT_ELEMENT_COLOR;
};
// The definition of the scheme (named so a test can extract and really run it).
const defineResidueScheme = () => {
  return function () {
    this.atomColor = function (atom) { return residueColorOf(atom && atom.resname); };
  };
};
let residueSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
const registerResidueScheme = (NGL) => {
  if (residueSchemeKey) return;
  residueSchemeKey = registerColorScheme(NGL, 'lab-residue', defineResidueScheme());
};

/* ---- CHARGE colours (the « Charge » colouring, offered on an ION) -----------
   A PDB file rarely carries a formal charge, so the sign is read from the FILE
   when it has one (MOL2 / PDBQT `formalCharge`) and from the ELEMENT otherwise —
   the alkali and earth-alkali metals and the transition metals are cations, the
   halides and the oxyanions are anions, everything else is neutral. That is
   exactly what tells a Na⁺ from a Cl⁻ in the same solvent, which is the point of
   the colouring. The three colours are editable in the ⚙ settings wheel. */
const CHARGE_ORDER = ['negative', 'neutral', 'positive'];
const CHARGE_COLORS = { negative: 0xdc2626, neutral: 0x94a3b8, positive: 0x2563eb };
const chargeColorStore = { ...CHARGE_COLORS };
const CATION_ELEMENTS = new Set(['LI', 'NA', 'K', 'RB', 'CS', 'MG', 'CA', 'SR', 'BA', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'CD', 'MO', 'CR', 'AL']);
const ANION_ELEMENTS = new Set(['F', 'CL', 'BR', 'I', 'O', 'S', 'N']);
const ionChargeOf = (atom) => {
  const q = atom && atom.formalCharge;
  if (Number.isFinite(q) && q !== 0) return q > 0 ? 'positive' : 'negative';
  const el = String((atom && atom.element) || '').trim().toUpperCase();
  if (CATION_ELEMENTS.has(el)) return 'positive';
  // A residue name is a better witness than the element for an oxyanion (SO4²⁻,
  // NO3⁻, PO4³⁻ keep neutral atoms in the file): the 3-letter code is checked too.
  const res = String((atom && atom.resname) || '').trim().toUpperCase();
  if (/^(SO4|NO3|PO4|CO3|CL|BR|IOD|OH|MN|ZN|CA|NA|K)/.test(res) && ANION_ELEMENTS.has(el)) return 'negative';
  if (res === 'CL' || res === 'BR' || res === 'IOD') return 'negative';
  if (ANION_ELEMENTS.has(el)) return 'negative';
  return 'neutral';
};
const chargeColorOf = (kindOfCharge) => {
  const v = chargeColorStore[kindOfCharge];
  return Number.isFinite(v) ? v : DEFAULT_ELEMENT_COLOR;
};
// The definition of the scheme (named so a test can extract and really run it).
const defineChargeScheme = () => {
  return function () {
    this.atomColor = function (atom) { return chargeColorOf(ionChargeOf(atom)); };
  };
};
let chargeSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
const registerChargeScheme = (NGL) => {
  if (chargeSchemeKey) return;
  chargeSchemeKey = registerColorScheme(NGL, 'lab-charge', defineChargeScheme());
};

/* ---- PART 3 · The FORM of a nucleic acid, read from the coordinates ----------
   No viewer library classifies A · B · Z DNA, A · flexible RNA — or the two
   motifs a file never annotates (a G-quadruplex, a hairpin): the geometry is
   computed here, by PURE functions that take plain { name, x, y, z } records and
   return labels, so a test can run them without NGL and the colour schemes below
   only have to look the answer up.

   Everything starts from ONE record per nucleotide — nucleicResidues builds them
   from a structure:

     { key, resname, resno, chainIndex, residueIndex, atoms, names,
       base: 'A'…'U', purine: bool, rna: bool }

   and from the two torsions that carry the information:

     · χ, the GLYCOSIDIC torsion — O4'-C1'-N9-C4 for a purine, O4'-C1'-N1-C2 for
       a pyrimidine. Every RIGHT-handed form keeps its purines ANTI
       (χ ≈ 180° ± 90°); Z-DNA / Z-RNA flip them to SYN (|χ| < 90°) and alternate
       them with anti pyrimidines — that alternation IS the zig-zag of a
       left-handed helix, so ONE flipped purine is not a form (it is a lesion or
       a loop) and the classifier asks for two of them before it paints a strand
       Z;
     · δ, the backbone torsion C5'-C4'-C3'-O3', which IS the sugar pucker:
       δ < 100° = C3'-endo (the A family), δ > 120° = C2'-endo (B-DNA, and the
       flexible / loop regions of an RNA — a B-form RNA cannot exist, the 2'-OH
       forbids it). When the δ atoms are missing the MolProbity-style FALLBACK
       takes over: the perpendicular distance from the glycosidic C1'-N line to
       the phosphate, more than 2.9 Å being C3'-endo.

   The PRIME is what tells C1' (the sugar) from C1 and O2' (the 2'-OH, i.e. the
   definition of an RNA) from O2 (a base oxygen), so the normaliser only rewrites
   the OLD spelling of it (`C1*` → `C1'`) and never drops it. */
const nucAtomKey = (name) => String(name || '').replace(/\s+/g, '').replace(/\*/g, "'").toUpperCase();
const NUC_PURINE_BASES = new Set(['A', 'G']);
const NUC_CHI_PURINE = ["O4'", "C1'", 'N9', 'C4'];
const NUC_CHI_PYRIMIDINE = ["O4'", "C1'", 'N1', 'C2'];
const NUC_DELTA_ATOMS = ["C5'", "C4'", "C3'", "O3'"];
const NUC_SYN_MAX_DEG = 90;        // |χ| < 90°  → syn   (the Z-form purine)
const NUC_C3_ENDO_MAX_DEG = 100;   // δ < 100°   → C3'-endo (the A family)
const NUC_C2_ENDO_MIN_DEG = 120;   // δ > 120°   → C2'-endo (B-DNA · loop RNA)
const NUC_PUCKER_DIST = 2.9;       // Å — the cut-off of the fallback measure
const NUC_FORM_LABELS = ['a-dna', 'b-dna', 'z-dna', 'a-rna', 'loop-rna', 'z-rna'];
const NUC_FORM_NAMES = {
  'a-dna': 'A-DNA', 'b-dna': 'B-DNA', 'z-dna': 'Z-DNA',
  'a-rna': 'A-RNA', 'loop-rna': 'Flexible / loop RNA', 'z-rna': 'Z-RNA',
};

/* The primitives the two torsions and the two motifs are built from — plain
   [x, y, z] arrays, so the whole classification is a pure function of numbers. */
const vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vecCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vecDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vecLen = (a) => Math.sqrt(vecDot(a, a));
const coordDist = (a, b) => Math.sqrt(((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2) + ((a[2] - b[2]) ** 2));
// The SIGNED dihedral angle of four points (degrees, IUPAC convention: the atoms
// p0 and p3 CIs — eclipsed — at 0°, ANTI — trans — at ±180°), which is the
// convention the χ and δ thresholds of the classification are written in
// (a syn purine is |χ| ≈ 0, an anti one |χ| ≈ 180; a C3'-endo sugar has
// δ ≈ 80 – 100°, a C2'-endo one δ ≈ 140 – 160°). null as soon as one point is
// missing — an incomplete residue must never produce a random conformation.
const torsionDeg = (p0, p1, p2, p3) => {
  if (!p0 || !p1 || !p2 || !p3) return null;
  const b1 = vecSub(p1, p0);
  const b2 = vecSub(p2, p1);
  const b3 = vecSub(p3, p2);
  const n1 = vecCross(b1, b2);
  const n2 = vecCross(b2, b3);
  const len = vecLen(b2);
  if (!vecLen(n1) || !vecLen(n2) || !len) return null;
  const m = vecCross(n1, [b2[0] / len, b2[1] / len, b2[2] / len]);
  return (-Math.atan2(vecDot(m, n2), vecDot(n1, n2)) * 180) / Math.PI;
};
// The perpendicular distance of a point to the LINE a→b — the fallback measure of
// the pucker (the phosphate against the glycosidic bond vector).
const linePointDist = (p, a, b) => {
  const ab = vecSub(b, a);
  const len = vecLen(ab);
  if (!len) return coordDist(p, a);
  const t = vecDot(vecSub(p, a), ab) / (len * len);
  return coordDist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
};
// The distance between two NAMED atoms of two nucleotides (null when absent).
const nucPairDist = (a, n1, b, n2) => {
  const p = a && a.atoms && a.atoms[n1];
  const q = b && b.atoms && b.atoms[n2];
  return p && q ? coordDist(p, q) : null;
};
// The centre of a base (the mean of its ring atoms): ONE point per base, which is
// what says whether four guanines are coplanar and whether two tetrads stack.
const nucBaseCentreOf = (nuc) => {
  const ring = ['N1', 'C2', 'N3', 'C4', 'C5', 'C6']
    .map((n) => (nuc && nuc.atoms ? nuc.atoms[n] : null)).filter(Boolean);
  const pts = ring.length ? ring : Object.values((nuc && nuc.atoms) || {});
  if (!pts.length) return null;
  const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
};
// The best-fit plane of a set of points — its centroid and a unit normal, taken on
// the first non-collinear triple (null when every point is on one line).
const planeOfPoints = (pts) => {
  if (!pts || pts.length < 3 || pts.some((p) => !p)) return null;
  const c = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  const centre = [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      for (let k = j + 1; k < pts.length; k += 1) {
        const n = vecCross(vecSub(pts[j], pts[i]), vecSub(pts[k], pts[i]));
        const len = vecLen(n);
        if (len > 1e-3) return { centre, normal: [n[0] / len, n[1] / len, n[2] / len] };
      }
    }
  }
  return null;
};
// How far the worst point of a set lies from a plane (Infinity without a plane).
const planeDeviation = (plane, pts) => {
  if (!plane) return Infinity;
  return pts.reduce((max, p) => (p ? Math.max(max, Math.abs(vecDot(vecSub(p, plane.centre), plane.normal))) : max), 0);
};

/* ---- PART 3.1 · A · B · Z DNA, A · flexible RNA -----------------------------
   One record per nucleotide, grouped by residue out of plain atom records —
   [{ index, name, resname, resno, chainIndex, residueIndex, x, y, z }], exactly
   what structureAtomRecords builds from an NGL structure (and what a test can
   type by hand). */
const nucleicResidues = (records) => {
  const byRes = new Map();
  (records || []).forEach((a) => {
    if (!a) return;
    const key = `${a.chainIndex}|${a.residueIndex}|${a.resname}|${a.resno}`;
    let r = byRes.get(key);
    if (!r) {
      r = {
        key, resname: a.resname, resno: a.resno,
        chainIndex: a.chainIndex || 0, residueIndex: a.residueIndex || 0,
        atoms: {}, names: new Set(),
      };
      byRes.set(key, r);
    }
    const n = nucAtomKey(a.name);
    if (n) { r.names.add(n); r.atoms[n] = [a.x, a.y, a.z]; }
  });
  const out = Array.from(byRes.values());
  out.forEach((r) => {
    r.base = nucBaseOf(r.resname);
    r.purine = NUC_PURINE_BASES.has(r.base);
    // An RNA is DEFINED by its 2'-OH: the O2' atom is the proof, and the R series
    // of residue names (RA · RC · RG · RU …) is the other way of saying it.
    r.rna = r.names.has("O2'") || /^R/.test(String(r.resname || '').trim().toUpperCase());
  });
  return out;
};
// The χ torsion of ONE nucleotide (degrees), null when an atom is missing.
const nucleicChiOf = (nuc) => {
  const n = nuc && nuc.purine ? NUC_CHI_PURINE : NUC_CHI_PYRIMIDINE;
  const a = (nuc && nuc.atoms) || {};
  return torsionDeg(a[n[0]], a[n[1]], a[n[2]], a[n[3]]);
};
// syn / anti for a PURINE — null for a pyrimidine (χ is not what tells them apart)
// and null when χ cannot be measured.
const nucleicSynOf = (nuc) => {
  if (!nuc || !nuc.purine) return null;
  const chi = nucleicChiOf(nuc);
  return chi == null ? null : Math.abs(chi) < NUC_SYN_MAX_DEG;
};
// The δ torsion of ONE nucleotide — the torsion that IS the sugar pucker.
const nucleicDeltaOf = (nuc) => {
  const a = (nuc && nuc.atoms) || {};
  return torsionDeg(a[NUC_DELTA_ATOMS[0]], a[NUC_DELTA_ATOMS[1]], a[NUC_DELTA_ATOMS[2]], a[NUC_DELTA_ATOMS[3]]);
};
// The fallback measure: the perpendicular distance from the C1'-N1/9 bond vector
// to the phosphate. « The following phosphate » is the P of the NEXT residue of
// the same chain — a nucleotide's own P bridges to the PREVIOUS sugar — and the
// residue's own P is used when the chain ends there.
const nucleicPuckerDistOf = (nuc, nextP) => {
  const a = (nuc && nuc.atoms) || {};
  const c1 = a["C1'"];
  const n = nuc && nuc.purine ? a.N9 : a.N1;
  const p = nextP || a.P;
  return c1 && n && p ? linePointDist(p, c1, n) : null;
};
// The pucker: 'c3' = C3'-endo (the A family), 'c2' = C2'-endo (B-DNA · flexible
// RNA), '' = no measurable geometry. δ decides; when its atoms are missing the
// phosphate is measured against the glycosidic bond vector.
const nucleicPuckerOf = (nuc, nextP) => {
  const d = nucleicDeltaOf(nuc);
  if (d != null) {
    if (d < NUC_C3_ENDO_MAX_DEG) return 'c3';
    if (d > NUC_C2_ENDO_MIN_DEG) return 'c2';
  }
  const dist = nucleicPuckerDistOf(nuc, nextP);
  if (dist == null) return '';
  return dist > NUC_PUCKER_DIST ? 'c3' : 'c2';
};
// The P of the residue that FOLLOWS nucleotide i in its own chain (null at the end
// of a chain — the next chain's first phosphate is a different molecule).
const nextPhosphateOf = (nucleotides, i) => {
  const cur = nucleotides[i];
  const nb = nucleotides[i + 1];
  if (!cur || !nb || nb.chainIndex !== cur.chainIndex) return null;
  return (nb.atoms && nb.atoms.P) || null;
};
// Is the residue at i+dir (same chain) a PYRIMIDINE? — the partner a syn purine
// alternates with in Z-DNA / Z-RNA.
const neighbourPyrimidineOf = (nucleotides, i, dir) => {
  const cur = nucleotides[i];
  const nb = nucleotides[i + dir];
  return !!(cur && nb && nb.chainIndex === cur.chainIndex && nb.base && !nb.purine);
};
// THE classifier: one label per nucleotide ('' when the record is not one), in the
// order of the list (i.e. the sequence order of each chain).
const nucleicForms = (nucleotides) => {
  const list = nucleotides || [];
  const syn = list.map((n) => nucleicSynOf(n));
  const zFlag = list.map(() => false);
  const zRna = list.map(() => false);
  let candidates = 0;
  list.forEach((n, i) => {
    if (!n || !n.purine || syn[i] !== true) return;
    if (neighbourPyrimidineOf(list, i, -1) || neighbourPyrimidineOf(list, i, 1)) {
      zFlag[i] = true;
      zRna[i] = !!n.rna;
      candidates += 1;
    }
  });
  // Z needs an ALTERNATION, never one lone syn purine: with fewer than two
  // candidates the flags are dropped and the strand is read as a right-handed form.
  if (candidates < 2) zFlag.fill(false);
  // The pyrimidines between two flipped purines belong to the same left-handed
  // segment — they are its anti partners.
  list.forEach((n, i) => {
    if (!n || !n.base || n.purine || zFlag[i]) return;
    const before = zFlag[i - 1] && list[i - 1] && list[i - 1].chainIndex === n.chainIndex;
    const after = zFlag[i + 1] && list[i + 1] && list[i + 1].chainIndex === n.chainIndex;
    if (before || after) { zFlag[i] = true; zRna[i] = !!n.rna; }
  });
  return list.map((n, i) => {
    if (!n || !n.base) return '';
    if (zFlag[i]) return zRna[i] ? 'z-rna' : 'z-dna';
    const pucker = nucleicPuckerOf(n, nextPhosphateOf(list, i));
    if (pucker === 'c3') return n.rna ? 'a-rna' : 'a-dna';
    if (pucker === 'c2') return n.rna ? 'loop-rna' : 'b-dna';
    // Nothing measurable — an incomplete file gets the canonical form of its
    // family rather than a blank or a random colour.
    return n.rna ? 'a-rna' : 'b-dna';
  });
};

/* ---- PART 3.2 · The two motifs a PDB file never annotates --------------------
   A G-quadruplex and a hairpin are TOPOLOGY, not sequence: both are found from
   the coordinates alone, with the thresholds below — the Hoogsteen H-bonds and the
   stacking distance for the first, the Watson-Crick / wobble H-bonds, the covalent
   backbone and the loop length for the second. */
const GQUAD_N1_O6_MIN = 2.7;    // Å — the Hoogsteen H-bond N1(G)···O6(G)
const GQUAD_N1_O6_MAX = 3.3;
const GQUAD_N2_N7_MIN = 2.7;    // Å — …and the second one, N2(G)···N7(G)
const GQUAD_N2_N7_MAX = 3.3;
const GQUAD_PLANAR_TOL = 1.5;   // Å — four guanines in a « coplanar ring »
const GQUAD_STACK_MIN = 3.0;    // Å — the inter-plane distance of stacked tetrads
const GQUAD_STACK_MAX = 3.7;    //     (the canonical value is 3.3 – 3.4 Å)
const GQUAD_PARALLEL_MIN = 0.8; //     |cos| of the normals of two parallel planes
const GQUAD_MAX_GUANINES = 80;  //     above that the tetrad search is not run
const WB_PAIR_MAX = 3.5;        // Å — a Watson-Crick / wobble H-bond
const HAIRPIN_STEM_MIN = 3;     // consecutive base pairs that make a stem
const HAIRPIN_LOOP_MIN = 3;     // the unpaired residues of a loop …
const HAIRPIN_LOOP_MAX = 10;    // … and its upper bound
const BACKBONE_BOND_MAX = 1.8;  // Å — the covalent P → O3' bond of two neighbours
// The donor / acceptor atoms of the pairs that count as a stem: the canonical
// Watson-Crick pairs (A–T / A–U · G–C, 'wc') and the G–U wobble ('wobble'). T and
// U are read by the same entries — they pair the same way.
const BASE_PAIR_HBONDS = {
  AU: [['N1', 'N3'], ['N6', 'O4']],
  CG: [['O6', 'N4'], ['N1', 'N3'], ['N2', 'O2']],
  GU: [['O6', 'N3'], ['N1', 'O2'], ['N2', 'O4']],
};
const basePairKeyOf = (b1, b2) => {
  const n = (b) => (b === 'T' ? 'U' : b);
  return [n(b1), n(b2)].filter(Boolean).sort().join('');
};
// 'wc' · 'wobble' · '' — two bases are PAIRED as soon as one donor / acceptor
// distance of their pair sits below the H-bond cut-off.
const basePairKindOf = (a, b) => {
  if (!a || !b) return '';
  const key = basePairKeyOf(a.base, b.base);
  const hb = BASE_PAIR_HBONDS[key];
  if (!hb) return '';
  const best = hb.reduce((min, [n1, n2]) => {
    const d = nucPairDist(a, n1, b, n2);
    return d == null ? min : Math.min(min, d);
  }, Infinity);
  if (!(best <= WB_PAIR_MAX)) return '';
  return key === 'GU' ? 'wobble' : 'wc';
};
// Two guanines are HOOGSTEEN partners when N1···O6 AND N2···N7 both sit in the
// 2.7 – 3.3 Å window — in EITHER direction, since a tetrad is directional.
const hoogsteenPairOf = (ga, gb) => {
  if (!ga || !gb) return false;
  const inRange = (v, lo, hi) => v != null && v >= lo && v <= hi;
  const one = (x, y) => inRange(nucPairDist(x, 'N1', y, 'O6'), GQUAD_N1_O6_MIN, GQUAD_N1_O6_MAX)
    && inRange(nucPairDist(x, 'N2', y, 'N7'), GQUAD_N2_N7_MIN, GQUAD_N2_N7_MAX);
  return one(ga, gb) || one(gb, ga);
};

// The G-TETRADS of a set of guanines (indices into `list`): every CLOSED cycle of
// four distinct guanines whose four sides are Hoogsteen pairs and whose base
// centres are coplanar. The 4-cycles are enumerated as a-b-d-c-a on the Hoogsteen
// graph — a very sparse graph (only real partners are edges), so the walk is
// cheap — and each cycle is kept once.
const gTetradsOf = (list, guanineIdx) => {
  const g = Array.from(guanineIdx || []);
  if (g.length < 4 || g.length > GQUAD_MAX_GUANINES) return [];
  const adj = g.map(() => []);
  const edges = new Set();
  for (let i = 0; i < g.length; i += 1) {
    for (let j = i + 1; j < g.length; j += 1) {
      if (!hoogsteenPairOf(list[g[i]], list[g[j]])) continue;
      adj[i].push(j);
      adj[j].push(i);
      edges.add(`${i}|${j}`);
      edges.add(`${j}|${i}`);
    }
  }
  const seen = new Set();
  const out = [];
  for (let a = 0; a < g.length; a += 1) {
    const na = adj[a];
    for (let x = 0; x < na.length; x += 1) {
      for (let y = x + 1; y < na.length; y += 1) {
        const b = na[x];
        const c = na[y];
        adj[b].forEach((d) => {
          if (d === a || d === b || d === c) return;
          if (!edges.has(`${c}|${d}`)) return;
          const local = [a, b, c, d].sort((p, q) => p - q);
          const key = local.join('|');
          if (seen.has(key)) return;
          seen.add(key);
          const centres = local.map((k) => nucBaseCentreOf(list[g[k]]));
          if (planeDeviation(planeOfPoints(centres), centres) > GQUAD_PLANAR_TOL) return;
          out.push(local.map((k) => g[k]));
        });
      }
    }
  }
  return out;
};
// The guanines of the STACKED tetrads: a G-quadruplex is two or more G-tetrads
// whose planes are parallel and 3.3 – 3.4 Å apart (the stacking distance of the
// tetrads), so a LONE tetrad is never called a quadruplex.
const stackedTetradsOf = (list, tetrads) => {
  const planes = (tetrads || []).map((t) => planeOfPoints(t.map((i) => nucBaseCentreOf(list[i]))));
  const parent = planes.map((_, i) => i);
  const find = (i) => {
    let k = i;
    while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
    return k;
  };
  const union = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < planes.length; i += 1) {
    for (let j = i + 1; j < planes.length; j += 1) {
      const A = planes[i];
      const B = planes[j];
      if (!A || !B) continue;
      if (Math.abs(vecDot(A.normal, B.normal)) < GQUAD_PARALLEL_MIN) continue;
      const gap = Math.abs(vecDot(vecSub(B.centre, A.centre), A.normal));
      if (gap < GQUAD_STACK_MIN || gap > GQUAD_STACK_MAX) continue;
      union(i, j);
    }
  }
  const size = new Map();
  planes.forEach((_, i) => { const r = find(i); size.set(r, (size.get(r) || 0) + 1); });
  const out = new Set();
  planes.forEach((_, i) => {
    if ((size.get(find(i)) || 0) < 2) return;
    (tetrads[i] || []).forEach((idx) => out.add(idx));
  });
  return out;
};

// Is the region from → to ONE continuous strand? Traced on the covalent backbone
// bond P(i+1) — O3'(i), so two strands that merely pass close to each other (a
// dimer, two chains, two molecules) are never read as a hairpin: a hairpin is
// closed by a loop of the SAME strand.
const backboneLinked = (chain, from, to) => {
  for (let k = from; k < to; k += 1) {
    const o3 = chain[k] && chain[k].atoms ? chain[k].atoms["O3'"] : null;
    const p = chain[k + 1] && chain[k + 1].atoms ? chain[k + 1].atoms.P : null;
    if (!o3 || !p) continue;                      // nothing to judge → never reject
    if (coordDist(o3, p) > BACKBONE_BOND_MAX) return false;
  }
  return true;
};
// The hairpins of ONE chain (indices into `chain`): a stem of at least three
// consecutive NESTED base pairs — (i, j), (i+1, j-1), … — whose two strands are
// closed by a loop of 3 to 10 unpaired residues. The stem AND the loop are
// returned, because a hairpin IS the two of them together.
const hairpinResiduesInChain = (chain) => {
  const out = new Set();
  const n = (chain || []).length;
  const paired = (i, j) => (i >= 0 && j < n && i < j ? basePairKindOf(chain[i], chain[j]) : '');
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2 * HAIRPIN_STEM_MIN; j < n; j += 1) {
      if (!paired(i, j)) continue;
      let m = 1;
      while (i + m < j - m && paired(i + m, j - m)) m += 1;
      if (m < HAIRPIN_STEM_MIN) continue;
      const loopLen = j - m - (i + m) + 1;
      if (loopLen < HAIRPIN_LOOP_MIN || loopLen > HAIRPIN_LOOP_MAX) continue;
      if (!backboneLinked(chain, i, j)) continue;
      for (let k = i; k < i + m; k += 1) out.add(k);
      for (let k = j - m + 1; k <= j; k += 1) out.add(k);
      for (let k = i + m; k <= j - m; k += 1) out.add(k);
    }
  }
  return out;
};
// THE motif classifier: { gquad, hairpin, tetrads } — the two Sets hold indices
// into `nucleotides`, so the colour scheme only has to look the residue up.
const nucleicMotifs = (nucleotides) => {
  const list = nucleotides || [];
  const guanineIdx = new Set();
  list.forEach((nn, i) => { if (nn && nn.base === 'G') guanineIdx.add(i); });
  const tetrads = gTetradsOf(list, guanineIdx);
  const gquad = stackedTetradsOf(list, tetrads);
  const hairpin = new Set();
  const byChain = new Map();
  list.forEach((nn, i) => {
    if (!nn || !nn.base) return;
    const k = nn.chainIndex || 0;
    if (!byChain.has(k)) byChain.set(k, []);
    byChain.get(k).push(i);
  });
  byChain.forEach((idxList) => {
    const chain = idxList.map((i) => list[i]);
    hairpinResiduesInChain(chain).forEach((k) => hairpin.add(idxList[k]));
  });
  return { gquad, hairpin, tetrads };
};

/* ---- PART 3.3 · From a structure to the tables the schemes read --------------
   ONE walk per structure (WeakMap cache): its nucleotides, the form of each one
   and the motifs. A colour scheme is asked for a colour once PER ATOM, so nothing
   may be recomputed there — atomColor only looks the residue index up here. */
const structureAtomRecords = (structure, predicate) => {
  const out = [];
  if (!structure || typeof structure.eachAtom !== 'function') return out;
  try {
    structure.eachAtom((a) => {
      if (!a || (predicate && !predicate(a))) return;
      out.push({
        index: a.index,
        name: a.atomname,
        element: a.element,
        resname: a.resname,
        resno: a.resno,
        chainIndex: a.chainIndex != null ? a.chainIndex : (a.chainname || ''),
        residueIndex: a.residueIndex,
        x: a.x, y: a.y, z: a.z,
      });
    });
  } catch { /* NGL not ready (or no structure) → an empty walk */ }
  return out;
};
const nucleicClassCache = new WeakMap();
const nucleicClassFor = (structure) => {
  if (!structure) return null;
  if (nucleicClassCache.has(structure)) return nucleicClassCache.get(structure);
  let out = null;
  try {
    const nucleotides = nucleicResidues(structureAtomRecords(structure, (a) => !!nucBaseOf(a.resname)));
    if (nucleotides.length) {
      const forms = nucleicForms(nucleotides);
      const motifs = nucleicMotifs(nucleotides);
      const formByResidue = new Map();
      const motifByResidue = new Map();
      nucleotides.forEach((nuc, i) => {
        if (forms[i]) formByResidue.set(nuc.residueIndex, forms[i]);
        if (motifs.gquad.has(i)) motifByResidue.set(nuc.residueIndex, 'gquad');
        else if (motifs.hairpin.has(i)) motifByResidue.set(nuc.residueIndex, 'hairpin');
      });
      out = { nucleotides, forms, motifs, formByResidue, motifByResidue };
    }
  } catch { out = null; }
  nucleicClassCache.set(structure, out);
  return out;
};
// How many nucleotides of ONE form / of ONE motif a structure holds — what the
// Nucleic-acids menu prints under its colour selector, and the proof that the
// classification really ran on the file that is on screen.
const nucleicClassCounts = (structure) => {
  const info = nucleicClassFor(structure);
  const forms = {};
  const motifs = {};
  if (info) {
    info.forms.forEach((f) => { if (f) forms[f] = (forms[f] || 0) + 1; });
    info.motifByResidue.forEach((m) => { motifs[m] = (motifs[m] || 0) + 1; });
  }
  return { total: info ? info.nucleotides.length : 0, forms, motifs };
};

/* ---- Saved visualisation setups (⚙️ Setup, §1 General) ---------------------
   One localStorage entry holds a { name → setup } map. A setup is the plain
   object built by captureViewerSetup and read back by applyViewerSetup; the
   version lets a file written by another build be accepted safely — every field is
   merged over the DEFAULT below, so a missing or unknown key can never break the
   viewer. */
const loadViewerSetups = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWER_SETUP_KEY) || 'null');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out = {};
      Object.keys(raw).forEach((k) => {
        const s = raw[k];
        if (s && typeof s === 'object' && s.catStyles) out[k] = s;
      });
      return out;
    }
  } catch { /* first run / private mode → no saved setup */ }
  return {};
};
const saveViewerSetups = (map) => {
  try { localStorage.setItem(VIEWER_SETUP_KEY, JSON.stringify(map || {})); } catch { /* ignore */ }
};

/* ---- Per-category 3D LABELS (the former global « 4 · Labels » section) ------
   Residues / Residue type / Atom names are now three checkboxes INSIDE each
   molecule menu, so « Residues » ticked in the Proteins menu labels PROTEINS
   ONLY. The state is one object per category, persisted like the styles, and
   the label effect builds its text per category with that category's own
   selection (atomIndicesFor → build3dLabelMap). */
const CAT_LABEL_KEY = 'labViewerCategoryLabels';
const CAT_LABEL_DEFAULTS = { residues: false, residueType: false, atoms: false };
const cloneCatLabels = () => Object.fromEntries(
  CAT_STYLE_CATS.map((c) => [c, { ...CAT_LABEL_DEFAULTS }]),
);
const loadCatLabels = () => {
  const out = cloneCatLabels();
  try {
    const raw = localStorage.getItem(CAT_LABEL_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      Object.keys(out).forEach((k) => {
        if (saved[k] && typeof saved[k] === 'object') out[k] = { ...out[k], ...saved[k] };
      });
    }
  } catch { /* first run / private mode → nothing labelled */ }
  return out;
};
const saveCatLabels = (v) => {
  try { localStorage.setItem(CAT_LABEL_KEY, JSON.stringify(v)); } catch { /* ignore */ }
};
// True as soon as ONE category asks for at least one kind of label.
const anyCatLabel = (v) => CAT_STYLE_CATS.some((c) => {
  const l = (v && v[c]) || CAT_LABEL_DEFAULTS;
  return !!(l.residues || l.residueType || l.atoms);
});
// Signature of the label state — the dependency of the label effect.
const catLabelsSig = (v) => JSON.stringify(CAT_STYLE_CATS.map((c) => (v && v[c]) || CAT_LABEL_DEFAULTS));

/* ---- Lipid recognition ----------------------------------------------------
   NGL has NO `lipid` selection keyword (verified: the whole selection keyword
   set is protein / nucleic / rna / dna / polymer / water / helix / sheet / turn
   / backbone / sidechain / all / hetero / ion / saccharide / sugar / bonded /
   ring / aromaticring / metal / polarh / none). Lipids are therefore recognised
   by RESIDUE NAME — exactly like PyMOL's built-in `lipid` selection — so the
   Lipids menu works on the POPC / POPE / CHOL… residues of a membrane system.
   Extend the list here if a system uses another naming scheme. */
const LIPID_RESNAMES = new Set([
  // phosphatidyl-cholines / -ethanolamines / -serines / -glycerols / -acids
  'POPC', 'POPE', 'POPS', 'POPG', 'POPA', 'POPI', 'POPU',
  'PLPC', 'PLPE', 'SOPC', 'SOPE', 'SAPI',
  'DOPC', 'DOPE', 'DOPS', 'DOPG', 'DOPA', 'DOPI',
  'DPPC', 'DPPE', 'DPPS', 'DPPG', 'DPPA', 'DPPI',
  'DSPC', 'DSPE', 'DSPS', 'DSPG', 'DSPA',
  'DMPC', 'DMPE', 'DMPS', 'DMPG', 'DMPA',
  'DLPC', 'DLPE', 'DLPS', 'DLPG',
  'DEPC', 'DEPE', 'DRPC', 'DRPE', 'DAPC', 'SDPC', 'SDPE',
  // sterols
  'CHOL', 'CHL1', 'CHOLESTEROL', 'ERG', 'ERGOSTEROL', 'STIG', 'SITO', 'LANO',
  // glycolipids / sphingolipids / glycerides / cardiolipins / bare heads
  'MGDG', 'DGDG', 'SQDG', 'SM', 'PSM', 'CER', 'DAG', 'TAG', 'MAG', 'CL', 'CDL',
  'PA', 'PC', 'PE', 'PS', 'PG', 'PI',
  // The SHORT headgroup codes of the request — POP · DPQ name a phosphatidyl-
  // choline, EPH a phosphatidyl-ethanolamine, PGL a phosphatidyl-glycerol and
  // CLR a cholesterol. A file written by another lab may use those instead of
  // POPC / DPPC / CHOL (see lipidClassOf, which reads them all as their class).
  'POP', 'DPQ', 'EPH', 'PGL', 'CLR',
]);
const isLipidResname = (name) => LIPID_RESNAMES.has(String(name || '').trim().toUpperCase());

/* ---- PART 2.1bis · WHICH lipid / which headgroup CLASS -----------------------
   NGL has no « lipid » keyword, so the residue name of a HETATM record is the
   only place a file says WHICH lipid a residue is. The standard 3-letter codes
   are therefore mapped to the CLASS of their headgroup — the phosphatidyl-
   cholines (PC), -ethanolamines (PE), -glycerols (PG), -serines (PS), -inositols
   (PI), the phosphatidic acids (PA), the cardiolipins (CL), the sphingomyelins
   (SM), the sterols (Chol) and the bare fatty acids (FA) — which gives the
   Lipids menu a second, chemically meaningful way to colour a bilayer (one
   colour per headgroup class instead of one colour per part).

   The class is read from the END of the code, because that is where the naming
   rules put it: DPPC = DP + PC, POPE = PO + PE, TOCL = TO + CL, DLPS = DL + PS,
   DMPI = DM + PI, PSM = P + SM. The short codes of the request (POP · DPQ = PC,
   EPH = PE, PGL = PG, CLR = Chol) and every sterol / fatty-acid spelling come
   from an explicit table FIRST, so an unusual file still lands in its class. */
const LIPID_CLASS_ALIASES = {
  POP: 'PC', DPQ: 'PC', EPH: 'PE', PGL: 'PG',
  CHOL: 'Chol', CLR: 'Chol', CHO: 'Chol', STIG: 'Chol', SITO: 'Chol', LANO: 'Chol',
  MYR: 'FA', STE: 'FA', PAL: 'FA', OLA: 'FA', PLM: 'FA', LAU: 'FA', ARA: 'FA', LIN: 'FA',
  // The five classes the request names and the old table folded into two: a sterol
  // that is NOT cholesterol (ergosterol), the three acylglycerols (tri- / di- /
  // monoacylglycerol) and the ceramides each get their OWN class, because that is
  // what « Lipid type » has to say about them.
  ERG: 'Erg', DAG: 'DAG', DGA: 'DAG', TAG: 'TAG', TGL: 'TAG', MAG: 'MAG', MGL: 'MAG',
  CER: 'Cer', CDL: 'CL',
};
// The two-letter class the code ends with (longest spelling first, so « PC »
// cannot be read as « C »).
const LIPID_CLASS_SUFFIXES = ['PC', 'PE', 'PG', 'PS', 'PI', 'PA', 'SM', 'CL'];
const lipidClassOf = (resname) => {
  const n = String(resname || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!n) return 'OTHER';
  const alias = LIPID_CLASS_ALIASES[n];
  if (alias) return alias;
  if (n === 'PC' || n === 'PE' || n === 'PG' || n === 'PS' || n === 'PI' || n === 'PA' || n === 'SM' || n === 'CL') return n;
  if (/^(?:CHOL|CHL|ERG|STIG|SITO|LANO|DHC)/.test(n)) return 'Chol';
  const hit = LIPID_CLASS_SUFFIXES.find((s) => n.length > s.length && n.endsWith(s));
  return hit || 'OTHER';
};

// Residue names of the lipids actually present in a structure ([] when none).
// ONE pass and no residue-type API beyond `resname` (the very field the sequence
// strip and the 3D labels already read), so it is cheap and version-proof.
const lipidResnamesIn = (structure) => {
  const found = new Set();
  if (!structure || typeof structure.eachResidue !== 'function') return [];
  try {
    structure.eachResidue((r) => {
      const name = String((r && (r.resname || r.restype)) || '').trim().toUpperCase();
      if (name && isLipidResname(name)) found.add(name);
    });
  } catch { /* best-effort: the Lipids menus simply stay inactive */ }
  return Array.from(found).sort();
};

// `[POPC] or [POPE] or …` — '' when the structure has no lipid. NGL's resname
// term is the BRACKET list (the installed 2.4 build rejects `resname POPC` with
// « resi must be an integer », which silently killed the whole selection).
const lipidResnameSele = (resnames) => (
  Array.isArray(resnames) && resnames.length
    ? resnames.map((n) => `[${n}]`).join(' or ')
    : ''
);

/* ---- PART 2.1 · Lipid sub-components (headgroup / glycerol / acyl chains) ----
   NGL cannot guess what part of a lipid is a headgroup: the Lipids menu must be
   told. The base selection is the resname list below; the three sub-components
   are then CLASSIFIED IN JS (lipidGroupOf, one classifier used by the drawing AND
   by the colour panel) and handed to NGL as atom-INDEX selections:

     · NGL 2.4's `.NAME` rules are EXACT (case-insensitive) comparisons — the
       installed build knows no `*` wildcard, so the earlier « .O1* » / « .C2* »
       rules only ever matched atoms literally called O1 / C2, and the headgroups
       and chains of a real file were never selected as intended;
     · the headgroup IS the EXCLUSION of the two others, so the three parts tile
       every lipid exactly: no atom is drawn twice, none is forgotten, and a
       headgroup drawn as Ball & Stick really contains ALL its atoms and bonds
       (the old positive P · N · O1* list left the choline / ethanolamine carbons
       and every head hydrogen out, which cut the head into fragments). */

const lipidRes = '[POPC] or [DPPC] or [DMPC] or [DOPC] or [POPE] or [DOPE] or [CHOL] or [ERG] or [DPPG] or [POPG] or [DLPC] or [MYR] or [STE] or [PAL]';
// The residue names of the line above — a detected lipid outside this list is
// OR-ed in as an explicit `[NAME]` term (supersets are harmless: NGL simply finds
// no atom for a residue that is not there).
const LIPID_STANDARD_RES = new Set([
  'POPC', 'DPPC', 'DMPC', 'DOPC', 'POPE', 'DOPE', 'CHOL', 'ERG',
  'DPPG', 'POPG', 'DLPC', 'MYR', 'STE', 'PAL',
]);
// ── The standard (CHARMM / AMBER) glycerophospholipid naming ────────────────
// The glycerol backbone: the three carbons C1 · C2 · C3, the two ester oxygens
// the chains hang from (O21 · O31) and their own hydrogens (CHARMM's HA · HB ·
// HS · HX · HY).
const LIPID_GLYCEROL_NAMES = new Set(['C1', 'C2', 'C3', 'O21', 'O31', 'HA', 'HB', 'HS', 'HX', 'HY']);
// An acyl-chain heavy atom of that naming: the sn-1 / sn-2 carbons C21 … C2nn /
// C31 … C3nn and the two ester carbonyl oxygens (the bare C2 / C3 are the
// backbone and are matched above).
const LIPID_ACYL_RE = /^(?:C[23]\d{1,2}|O[23]2)$/;
// The polar elements of the chemistry-free fallback rule.
const LIPID_POLAR_ELEMENTS = new Set(['N', 'P', 'O', 'S']);
// What proves that a file really follows the standard naming: a canonical
// backbone name (or the phosphate / the nitrogen) AND at least one atom named
// after the chain convention above. A file that names its chains differently —
// or renames every atom after its element, like the P8 / C12 / O9 of the DDM and
// DPE molecules of public/structures/example_topology_with_6PMB.pdb — fails the
// test and is classified by ELEMENT instead (see lipidGroupOf).
const LIPID_NAMED_PROBE = new Set(['P', 'N', 'C1', 'C2', 'C3']);
const LIPID_CHAIN_PROBE_RE = /^(?:C[23]\d|O[23]2)$/;

// ── A hydrogen is placed by its BOND, never by its name ─────────────────────
// A force field names the hydrogens of a chain after the POSITION in that chain,
// not after the carbon they hang from. CHARMM36's POPC is the proof: C22 carries
// H2R · H2S, C29 carries H91, C210 H101, C211 H11R · H11S, C216 H16R · H16S ·
// H16T, and the sn-2 chain C32 H2X · H2Y, C33 H3X · H3Y… Reading « H2R » as
// « C2 » therefore sent all 64 chain hydrogens of the file into the glycerol
// skeleton or the headgroup — atoms they sit 5 to 15 Å away from (the report: « in
// phospholipids many hydrogens of acyl chains are attributed to the headgroups or
// (although they are very far) to the glycerol. Why don’t you just identify them if
// they are at bonding distance from the carbons of the acyl chains? »). They ARE.
//
// The covalent radii below turn that question into arithmetic: a X–H bond is 0.96
// (O–H) to 1.35 Å (S–H) long, so twice the radii (plus a generous 1.3) recognises
// the bond with no topology in the file at all — which is what a .gro or a PDB
// without CONECT leaves us.
const LIPID_COVALENT_RADII = {
  H: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57,
  P: 1.07, S: 1.05, CL: 1.02, SE: 1.16, BR: 1.20, I: 1.39,
};
const lipidBondCutoff = (e1, e2) => 1.3 * (
  (LIPID_COVALENT_RADII[e1] || 0.77) + (LIPID_COVALENT_RADII[e2] || 0.77)
);

// The element of an atom, from NGL when it is known and from the leading letter
// of the name otherwise.
const atomElement = (name, element) => {
  const e = String(element || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (e) return e;
  const m = /[A-Za-z]/.exec(String(name || ''));
  return m ? m[0].toUpperCase() : '';
};

/* Which of the three parts of a lipid an atom belongs to — 'head' · 'glycerol' ·
   'acyl'. `named` says whether this structure follows the standard naming above
   (see lipidSubSelections); when it does not, the chemistry-free element rule is
   used: the polar atoms are the headgroup, every carbon / hydrogen a chain. */
const lipidGroupOf = (name, element, named = true) => {
  const n = String(name || '').replace(/\s+/g, '').toUpperCase();
  const e = atomElement(n, element);
  if (!named) return LIPID_POLAR_ELEMENTS.has(e) ? 'head' : 'acyl';
  if (LIPID_GLYCEROL_NAMES.has(n)) return 'glycerol';
  if (LIPID_ACYL_RE.test(n)) return 'acyl';
  // A hydrogen follows the heavy atom its NAME points at — H21A → C21 (a chain
  // carbon), H1A → C1 (the backbone) — which is the only rule that keeps working
  // whatever a force field calls its hydrogens. Any other hydrogen (HN, HO2',
  // HA of a headgroup …) stays with the headgroup, and so does every name we do
  // not recognise: the safe side, since the headgroup is the part that must never
  // lose an atom.
  const h = /^H(\d+)[A-Z]*$/.exec(n);
  if (h) return lipidGroupOf(`C${h[1]}`, '', true);
  return 'head';
};

// The three sub-selections of the lipids of ONE structure, as NGL `@index`
// selections, plus the `named` flag the colour scheme reads. Computed once per
// structure + lipid selection (WeakMap cache), so a rep rebuild never re-walks
// the atoms.
/* The part of every atom of the walk below, kept for the COLOUR scheme: the 🎨
   swatches of menu C must colour exactly what the representations DRAW, so the
   scheme reads these sets instead of re-deriving the part from the atom name —
   the name being what sent a chain hydrogen into the headgroup. Filled by
   lipidSubSelections, which the drawing path runs BEFORE it creates the
   representations (it needs the three selections to build them). */
const lipidPartIndexStore = {
  structure: null, head: null, glycerol: null, acyl: null, named: true,
};

const lipidSubCache = new WeakMap();
const lipidSubSelections = (structure, lipidSele) => {
  const none = { head: '', glycerol: '', acyl: '', named: false };
  if (!structure || !lipidSele) return none;
  let per = lipidSubCache.get(structure);
  if (!per) { per = new Map(); lipidSubCache.set(structure, per); }
  if (per.has(lipidSele)) return per.get(lipidSele);
  const atoms = atomIndicesForSele(structure, lipidSele).map((i) => {
    try {
      const a = structure.getAtomProxy(i);
      return [i, String((a && a.atomname) || ''), (a && a.element) || '',
        (a && a.residueIndex) || 0, (a && a.x) || 0, (a && a.y) || 0, (a && a.z) || 0];
    } catch { return [i, '', '', 0, 0, 0, 0]; }
  });
  // An empty walk (NGL not ready yet, selection matching nothing) says nothing
  // about the file: keep the historical default, so the menu never claims a
  // non-standard naming out of a walk that saw no atom at all.
  if (!atoms.length) {
    const blank = { head: '', glycerol: '', acyl: '', named: true };
    per.set(lipidSele, blank);
    return blank;
  }
  const named = atoms.some(([, n]) => LIPID_NAMED_PROBE.has(n.replace(/\s+/g, '').toUpperCase()))
    && atoms.some(([, n]) => LIPID_CHAIN_PROBE_RE.test(n.replace(/\s+/g, '').toUpperCase()));
  // PASS 1 — the heavy atoms carry the chemistry and are classified by NAME: the
  // backbone (C1 · C2 · C3 · O21 · O31), the chains (C21… · O22 · C31… · O32) and,
  // by exclusion, the headgroup.
  const part = new Map();
  const heavy = [];
  atoms.forEach((a) => {
    if (atomElement(a[1], a[2]) === 'H') return;
    part.set(a[0], lipidGroupOf(a[1], a[2], named));
    heavy.push(a);
  });
  // PASS 2 — every HYDROGEN goes to the part of the heavy atom it is BONDED to:
  // the closest heavy atom of its OWN residue, if it is within bonding distance.
  // The geometry, which no force field's naming can fool.
  atoms.forEach((a) => {
    if (atomElement(a[1], a[2]) !== 'H') return;
    let best = null; let bestD2 = Infinity;
    for (let k = 0; k < heavy.length; k++) {
      const h = heavy[k];
      if (h[3] !== a[3]) continue;        // a hydrogen only bonds inside its residue
      const d2 = (h[4] - a[4]) ** 2 + (h[5] - a[5]) ** 2 + (h[6] - a[6]) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = h; }
    }
    // Nothing at bonding distance (a molecule the box split, a file whose
    // coordinates are missing) → the name rules, so an atom is never lost.
    const cutoff = best ? lipidBondCutoff('H', atomElement(best[1], best[2])) : 0;
    part.set(a[0], best && bestD2 <= cutoff * cutoff
      ? part.get(best[0])
      : lipidGroupOf(a[1], a[2], named));
  });
  const head = []; const glycerol = []; const acyl = [];
  atoms.forEach(([i]) => {
    const g = part.get(i) || 'head';
    if (g === 'glycerol') glycerol.push(i);
    else if (g === 'acyl') acyl.push(i);
    else head.push(i);
  });
  const sele = (list) => (list.length ? `@${list.join(',')}` : '');
  const out = {
    head: sele(head), glycerol: sele(glycerol), acyl: sele(acyl), named,
    headAtoms: new Set(head), glycerolAtoms: new Set(glycerol), acylAtoms: new Set(acyl),
  };
  // The scheme colours from these very sets (see defineLipidGroupsScheme).
  lipidPartIndexStore.structure = structure;
  lipidPartIndexStore.head = out.headAtoms;
  lipidPartIndexStore.glycerol = out.glycerolAtoms;
  lipidPartIndexStore.acyl = out.acylAtoms;
  lipidPartIndexStore.named = named;
  per.set(lipidSele, out);
  return out;
};

// The `[POPC] or …` selection of the lipids of ONE structure: the standard list
// plus any other lipid residue this file declares.
const lipidGroupSele = (resnames) => {
  const extra = lipidResnameSele((resnames || []).filter((n) => !LIPID_STANDARD_RES.has(n)));
  return extra ? `${lipidRes} or ${extra}` : lipidRes;
};

/* ---- PART 2.2 · Sugars (carbohydrates) vs ligands ----------------------------
   NGL 2.4 has NO `carbohydrate` keyword (verified against the keyword table of
   the installed build: SACCHARIDE = SUGAR = 15, and nothing else), so the sugar
   menu uses the real keyword PLUS the explicit residue list. */
const SUGAR_RES_SEL = '[GLC] or [NAG] or [MAN] or [BMA] or [SIA] or [NAN] or [GAL] or [FUC]';
const SUGAR_SEL = `saccharide or ${SUGAR_RES_SEL}`;

/* ---- PART 2.2bis · A glycan is ONE molecule, not N ligands -------------------
   A linked glycan (an N-glycan on an Asn, a glycolipid head, an oligosaccharide)
   arrives as ONE HETATM residue per sugar, and nothing in the file says they
   belong together: NGL would hand the viewer seven little molecules and the
   Sugars menu would colour them as seven strangers. The LINKAGE is therefore read
   from the topology itself — the anomeric carbon of one sugar (C1, or C2 for a
   sialic acid / ketose) covalently bonded to a hydroxyl oxygen of the next one
   (O4 · O6 of a hexopyranose, O3 · O2 of a furanose) — and the bonded monomers
   are merged into ONE entity.

   The bond comes from TWO sources, so it works on every file:

     · the BOND GRAPH NGL built (CONECT records and the residue templates) —
       sugarLinksFromBonds walks the neighbours of the sugar atoms, which is the
       literal reading of the LINK / CONECT records of the request;
     · the interatomic DISTANCE (sugarLinksByDistance), which is what is left when
       a file carries no CONECT record at all — the usual case for a crystal
       structure whose sugars are bare HETATM groups. A glycosidic C–O bond is
       1.42 Å, so the cut-off is 1.8 Å: C1–O4 and C1–O6 are found, a water
       molecule 2.8 Å away is not.

   The dictionary below is the PDB 3-letter code ⇄ conventional short name of the
   sugar types (Glc = GLC, GlcNAc = NAG, Man = MAN, Gal = GAL, Fuc = FUC,
   Neu5Ac = SIA · NAN …), and it is what the glycan labels are written with. */
const SUGAR_NAME_CODES = {
  Glc: ['GLC', 'BGC'],
  GlcNAc: ['NAG', 'NDG'],
  Man: ['MAN', 'BMA'],
  Gal: ['GAL', 'GLA'],
  Fuc: ['FUC'],
  Neu5Ac: ['SIA', 'NAN'],
  Xyl: ['XYP'],
  Rib: ['RIB'],
  Ara: ['ARA'],
  GlcA: ['GCU'],
  IdoA: ['IDR'],
};
// code → short name (GLC → Glc, NAG → GlcNAc, SIA · NAN → Neu5Ac …) — the reverse
// of the dictionary above.
const SUGAR_CODE_NAMES = (() => {
  const out = {};
  Object.keys(SUGAR_NAME_CODES).forEach((short) => {
    SUGAR_NAME_CODES[short].forEach((code) => { out[code] = short; });
  });
  return out;
})();
// The KETOSES: their anomeric carbon is C2, never C1 (a sialic acid carries its
// linkage on C2).
const SUGAR_KETOSE_CODES = new Set(['SIA', 'NAN', 'SLB', 'KDO', 'KDN']);
// The hydroxyl oxygens a glycosidic bond is made to — never O5, the ring oxygen of
// a hexopyranose (no glycoside is made to a ring oxygen; an inter-residue bond to
// one is a wrapped-coordinate artefact, not a linkage). O1–O4 · O6–O9 covers the
// acceptors a file really names: O4 · O6 of the hexopyranoses, and the O7 · O8 ·
// O9 of an α2→8 / α2→9 sialic acid — a polysialic acid is linked through those.
// This is the NAME rule, and it belongs to the detector that reads an existing
// BOND (a LINK / CONECT record names its two atoms, so the linkage can be held
// against the chemistry: no bond to the ring oxygen, none to the nitrogen of an
// N-acetyl). The GEOMETRIC detector below cannot use it — see sugarLinkAtomsOf.
const SUGAR_ACCEPTOR_RE = /^O(?:[1-4]|[6-9])$/;
const SUGAR_LINK_CUTOFF = 1.8;   // Å — a covalent C–O bond (1.42 Å) with margin
// The element letter of one atom — a raw record or an AtomProxy alike; a file that
// carries no element column is read from the atom name, as everywhere else here.
const sugarElementOf = (x) => String(x && x.element != null ? x.element : (x && x.name) || '')
  .trim().toUpperCase().charAt(0);
const sugarCodeOf = (resname) => String(resname == null ? '' : resname).trim().toUpperCase();
const isSugarResidueCode = (resname) => {
  const c = sugarCodeOf(resname);
  if (!c) return false;
  return Object.prototype.hasOwnProperty.call(SUGAR_CODE_NAMES, c) || SUGAR_IDENTITY_CODES.indexOf(c) >= 0;
};
const sugarShortNameOf = (resname) => SUGAR_CODE_NAMES[sugarCodeOf(resname)] || sugarCodeOf(resname) || '?';
// The anomeric carbons of ONE sugar: C1 of an aldose, C2 (then C1) of a ketose.
const sugarAnomericNamesOf = (resname) => (SUGAR_KETOSE_CODES.has(sugarCodeOf(resname)) ? ['C2', 'C1'] : ['C1']);

// Is `x` the anomeric carbon and `y` an acceptor oxygen — i.e. these two atoms ARE
// the two ends of a glycosidic bond? (The element is checked too, so a hydrogen
// called H1 next to a carbon called C1 can never be mistaken for the linkage.)
const sugarLinkEnds = (x, y) => {
  const anomeric = sugarElementOf(x) === 'C' && sugarAnomericNamesOf(x.resname).indexOf(nucAtomKey(x.name)) >= 0;
  const acceptor = sugarElementOf(y) === 'O' && SUGAR_ACCEPTOR_RE.test(nucAtomKey(y.name));
  return anomeric && acceptor;
};
// Two atoms of TWO DIFFERENT sugar residues, bonded: that bond is a glycosidic
// linkage, and the two monomers belong to the same glycan.
const sugarLinkBondOf = (a, b) => {
  if (!a || !b || a.key === b.key) return false;
  if (!isSugarResidueCode(a.resname) || !isSugarResidueCode(b.resname)) return false;
  return sugarLinkEnds(a, b) || sugarLinkEnds(b, a);
};
// The ATOM PAIR of a glycosidic linkage read from the GEOMETRY alone: the anomeric
// carbon of one sugar within one covalent C–O bond of an oxygen of the other. This
// detector is deliberately NAME-AGNOSTIC on the acceptor side, because that name
// depends on the sugar and on whoever wrote the file: O4 · O6 of a hexopyranose, O3
// of a furanose, O8 · O9 of a sialic acid (an α2→8 / α2→9 polysialic acid — the
// polysaccharide of bacterial capsules and of NCAM — is linked through exactly
// those), written with primes, dashes and suffixes no table can enumerate. The
// DISTANCE is the honest filter: at ≤ 1.8 Å a C···O contact IS a covalent bond (a
// C–O single bond is 1.42 Å, the shortest O–H···O hydrogen bond ≈ 2.4 Å), and the
// ring oxygen of one residue cannot sit one bond away from ANOTHER residue's
// anomeric carbon without that bond existing. Returns [anomericCarbon, acceptorOxygen]
// — the two atoms the linkage is made of — or null.
const sugarLinkAtomsOf = (donor, acceptor) => {
  const anomeric = sugarAnomericNamesOf(donor.resname);
  let best = null;
  (donor.atoms || []).forEach((p) => {
    if (sugarElementOf(p) !== 'C' || anomeric.indexOf(nucAtomKey(p.name)) < 0) return;
    (acceptor.atoms || []).forEach((q) => {
      if (sugarElementOf(q) !== 'O') return;
      const d = coordDist([p.x, p.y, p.z], [q.x, q.y, q.z]);
      if (d > SUGAR_LINK_CUTOFF) return;
      if (!best || d < best.d) best = { d, atoms: [p.index, q.index] };
    });
  });
  return best ? best.atoms : null;
};
// The same question WITHOUT a bond graph: two monomers are LINKED when an anomeric
// carbon of one lies within one covalent C–O bond of an oxygen of the other. This
// is the rule that works on a file whose sugars are bare HETATM residues (no CONECT
// record, no templates) — C1–O4 / C1–O6 of the linkage. A link names the two
// MONOMERS it joins (i · j) AND the two ATOMS it is made of (atoms), so the same
// record can GROUP the sugars into one glycan and WRITE the bond between them.
const sugarLinksByDistance = (monomers) => {
  const out = [];
  const list = monomers || [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!a || !b) continue;
      if (!isSugarResidueCode(a.resname) || !isSugarResidueCode(b.resname)) continue;
      const atoms = sugarLinkAtomsOf(a, b) || sugarLinkAtomsOf(b, a);
      if (atoms) out.push({ i, j, atoms });
    }
  }
  return out;
};
// The same links read from the structure's OWN bond graph (the CONECT records and
// the residue templates NGL parsed, plus the linkages ensureGlycanBonds wrote):
// eachBondedAtom gives the neighbours of an atom, so a cross-residue anomeric-C →
// acceptor-O bond is found with no distance guess at all. The two sources are
// merged by the caller (a file usually has one of them, a rich file may have both)
// and both return the SAME record: { i, j, atoms } — the two monomers, and the two
// atoms the bond is made of, the anomeric carbon first.
const sugarLinksFromBonds = (structure, monomers) => {
  const out = [];
  if (!structure || typeof structure.eachAtom !== 'function') return out;
  const byAtom = new Map();
  (monomers || []).forEach((m, mi) => {
    (m.atoms || []).forEach((p) => byAtom.set(p.index, {
      key: `${mi}`, name: p.name, element: p.element, resname: m.resname,
    }));
  });
  if (!byAtom.size) return out;
  const seen = new Set();
  try {
    structure.eachAtom((a) => {
      const own = byAtom.get(a.index);
      if (!own) return;
      a.eachBondedAtom((b) => {
        const other = byAtom.get(b.index);
        if (!other || other.key === own.key) return;
        if (!sugarLinkBondOf(own, other)) return;
        const pair = [own.key, other.key].sort().join('|');
        if (seen.has(pair)) return;
        seen.add(pair);
        // The anomeric carbon first, whichever side of the bond it was seen from.
        const atoms = sugarLinkEnds(own, other) ? [a.index, b.index] : [b.index, a.index];
        out.push({ i: Number(own.key), j: Number(other.key), atoms });
      });
    });
  } catch { /* no bond graph → the distance rule alone */ }
  return out;
};

// « NAG2 → NAG3 → BMA4 » — the sugars of ONE glycan in sequence, named the
// conventional way (Glc · GlcNAc · Neu5Ac …) and numbered as the file numbers them.
const glycanLabel = (members) => (members || [])
  .map((m) => (m ? `${sugarShortNameOf(m.resname)}${m.resno != null ? m.resno : ''}` : '?'))
  .join(' → ');
// The two MONOMERS a link joins. A link is either the { i, j, atoms } record the
// two detectors build, or a bare [i, j] pair of monomer indices — the older shape,
// still accepted so a caller (or a test) can hand the grouping one without the atoms.
const linkMonomerPair = (link) => (Array.isArray(link) ? [link[0], link[1]] : [link && link.i, link && link.j]);
// The glycan ENTITIES of a set of monomers: the monomers grouped by the linkage
// bonds (union-find over the graph the two detectors above built). A branched
// N-glycan becomes ONE entity — the entity is what the UI colours, names and
// counts — while a lone monosaccharide is an entity of its own.
const glycanEntities = (monomers, links) => {
  const list = monomers || [];
  const parent = list.map((_, i) => i);
  const find = (i) => {
    let k = i;
    while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
    return k;
  };
  (links || []).forEach((link) => {
    const [i, j] = linkMonomerPair(link);
    if (!list[i] || !list[j]) return;
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  });
  const groups = new Map();
  list.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  return Array.from(groups.values()).map((members) => ({
    members,
    linked: members.length > 1,
    label: glycanLabel(members.map((i) => list[i])),
  }));
};
// The sugar monomers of ONE structure, as the pure functions above want them: one
// record per sugar residue with its atoms as plain { index, name, element, x, y, z }.
const sugarMonomersOf = (structure) => {
  const byRes = new Map();
  structureAtomRecords(structure, (a) => isSugarResidueCode(a.resname)).forEach((a) => {
    const key = `${a.chainIndex}|${a.residueIndex}|${a.resname}|${a.resno}`;
    let m = byRes.get(key);
    if (!m) {
      m = {
        key, resname: a.resname, resno: a.resno,
        chainIndex: a.chainIndex, residueIndex: a.residueIndex, atoms: [],
      };
      byRes.set(key, m);
    }
    m.atoms.push({ index: a.index, name: a.name, element: a.element, x: a.x, y: a.y, z: a.z });
  });
  return Array.from(byRes.values());
};
const glycanCache = new WeakMap();
// { monomers, entities, byAtom, linkAtoms } for ONE structure — computed once,
// because the colour scheme is asked for a colour once per atom and the grouping is
// a graph walk. byAtom is what the scheme reads: atom index → entity index.
// linkAtoms is the pairs of ATOMS the linkages are made of, once each (both
// detectors see the same C1–O4 bond; a chain of N sugars has N−1 of them) — the
// bonds ensureGlycanBonds writes into the topology.
const glycanEntityMapFor = (structure) => {
  if (!structure) return null;
  if (glycanCache.has(structure)) return glycanCache.get(structure);
  let out = null;
  try {
    const monomers = sugarMonomersOf(structure);
    if (monomers.length) {
      const links = sugarLinksByDistance(monomers).concat(sugarLinksFromBonds(structure, monomers));
      const entities = glycanEntities(monomers, links);
      const byAtom = new Map();
      entities.forEach((e, ei) => e.members.forEach((mi) => {
        (monomers[mi].atoms || []).forEach((p) => byAtom.set(p.index, ei));
      }));
      const linkAtoms = [];
      const seenBonds = new Set();
      links.forEach((link) => {
        const pair = link && link.atoms;
        const i1 = pair && pair[0];
        const i2 = pair && pair[1];
        if (!Number.isFinite(i1) || !Number.isFinite(i2) || i1 === i2) return;
        const key = i1 < i2 ? `${i1}|${i2}` : `${i2}|${i1}`;
        if (seenBonds.has(key)) return;
        seenBonds.add(key);
        linkAtoms.push(i1 < i2 ? [i1, i2] : [i2, i1]);
      });
      out = { monomers, entities, byAtom, linkAtoms };
    }
  } catch { out = null; }
  glycanCache.set(structure, out);
  return out;
};
// THE LINKAGES, WRITTEN INTO THE STRUCTURE'S OWN BOND GRAPH.
// Grouping the sugars is not enough for a DRAWN polysaccharide: the chain needs the
// connecting bond. NGL does infer an inter-residue bond by distance when it parses
// a PDB/GRO/CIF — but that perception is not guaranteed: a het residue that already
// carries SOME explicit bonds is left as it is (`inferBonds:'auto'`), a parser can
// be told `inferBonds:'none'`, two atoms with different altlocs are never
// connected by NGL, and NGL's covalent-radii window (0.92–1.72 Å for a C–O pair) is
// narrower than the 1.8 Å this file reads the linkage with. Writing the bond here
// makes the glycan ONE covalent molecule for EVERY reader at once: the 3D
// representations (ball+stick draws the anomeric-C → acceptor-O stick instead of
// leaving two blobs), the « bonded » selection, a distance measurement across the
// linkage, sugarLinksFromBonds above — which then agrees with the grouping — and the
// CONECT-based molecule split of a multi-molecule PDB. Idempotent: a bond the
// structure already has (which is the usual case, thanks to NGL) is left alone, and
// a file with no sugar linkage adds nothing at all. Called once per load, BEFORE the
// representations are built — a representation reads the bonds when it is created.
const ensureGlycanBonds = (componentOrStructure) => {
  const structure = componentOrStructure && (componentOrStructure.structure || componentOrStructure);
  const info = structure ? glycanEntityMapFor(structure) : null;
  const pairs = info && Array.isArray(info.linkAtoms) ? info.linkAtoms : [];
  const bondStore = structure ? structure.bondStore : null;
  if (!pairs.length || !bondStore || typeof bondStore.addBond !== 'function') return 0;
  let added = 0;
  try {
    const ap1 = structure.getAtomProxy();
    const ap2 = structure.getAtomProxy();
    const atomCount = structure.atomCount || 0;
    pairs.forEach((pair) => {
      const i1 = pair && pair[0];
      const i2 = pair && pair[1];
      if (!Number.isFinite(i1) || !Number.isFinite(i2) || i1 === i2) return;
      if (i1 < 0 || i2 < 0 || i1 >= atomCount || i2 >= atomCount) return;
      ap1.index = i1;
      ap2.index = i2;
      let known = false;
      try { known = ap1.hasBondTo(ap2); } catch { known = false; }
      if (known) return;
      bondStore.addBond(ap1, ap2, 1);   // a glycosidic linkage is a single bond
      added += 1;
    });
    if (added) {
      // The bond hash and the bond set are what eachBondedAtom, the NGL selections
      // and every BondProxy reader walk: a bond added to the store alone would stay
      // invisible to all of them (and bondCount would keep the old total).
      if (typeof structure.finalizeBonds === 'function') structure.finalizeBonds();
      else structure.bondCount = bondStore.count;
    }
  } catch { /* a structure NGL will not let us touch keeps what its file said */ }
  if (info) info.bondsAdded = (info.bondsAdded || 0) + added;
  return added;
};
// What the Sugars menu says about the glycans of the file on screen: one entry per
// entity (its label, its size) plus the two totals — computed ONCE at load time.
const glycanSummaryFor = (structure) => {
  const info = glycanEntityMapFor(structure);
  const entities = (info ? info.entities : []).map((e) => ({ label: e.label, size: e.members.length, linked: e.linked }));
  return {
    total: info ? info.monomers.length : 0,
    linked: entities.filter((e) => e.linked).reduce((n, e) => n + e.size, 0),
    entities,
  };
};


// NGL selection + presence of every CATEGORY of one structure, computed ONCE per
// structure (WeakMap cache) and shared by the renderer and the menus, so a style
// change never re-scans the atoms.
//   protein  → NGL keyword `protein`
//   nucleic  → NGL keyword `nucleic`
//   lipid    → `[POPC] or [DPPC] or …` list of the lipids actually present
//              ('' when none), plus lipidNamed (Part 2.1)
//   organic  → `hetero and not water and not ion` minus those lipids
//   others   → `water or ion`
// Presence counts come from Structure#getAtomSet, the same API the load effect
// already uses for `hasNonProtein`.
const catSeleCache = new WeakMap();
// Self-contained atom-set count (module scope, so it cannot depend on the
// component's own helper closures): NGL 2.4 needs a real NGL.Selection object
// (a raw string is ignored by Structure#getAtomSet) and exposes the size as
// AtomSet#getSize(). 0 = KNOWN empty, -1 = could not be determined → draw.
const nglSeleCount = (structure, sele) => {
  try {
    const NGL = typeof window !== 'undefined' ? window.NGL : null;
    if (!NGL || !NGL.Selection || !structure || !structure.getAtomSet) return -1;
    const set = structure.getAtomSet(new NGL.Selection(sele));
    return set && typeof set.getSize === 'function' ? set.getSize() : -1;
  } catch { return -1; }
};
// Same call, memoised per structure + selection string: the lipid menu asks for
// three sub-component counts on every rep rebuild, and a membrane system must
// not pay for that twice.
const seleCountCache = new WeakMap();
const nglSeleCountCached = (structure, sele) => {
  if (!structure || !sele) return 0;
  let per = seleCountCache.get(structure);
  if (!per) { per = new Map(); seleCountCache.set(structure, per); }
  if (per.has(sele)) return per.get(sele);
  const n = nglSeleCount(structure, sele);
  per.set(sele, n);
  return n;
};
// The atom INDICES a selection resolves to (used by the per-category 3D labels).
// AtomSet#get(i) is the API the NGL surface code itself uses.
const atomIndicesForSele = (structure, sele) => {
  const out = [];
  try {
    const NGL = typeof window !== 'undefined' ? window.NGL : null;
    if (!NGL || !NGL.Selection || !structure || !structure.getAtomSet) return out;
    const set = structure.getAtomSet(new NGL.Selection(sele));
    const n = structure.atomCount || 0;
    for (let i = 0; i < n; i++) if (set.get(i)) out.push(i);
  } catch { /* unknown selection → no label */ }
  return out;
};

/* ---- ONE routing function for the six categories -----------------------------
   Decides what each menu OWNS in this particular structure. The renderer
   (buildCategoryReps) and the per-category 3D labels both call it, so a menu can
   never label or style atoms that another menu owns:
     • a whole-molecule condition (moleculeType organic / sugar / lipid) hands
       `all` to its own menu;
     • a structure with NO polymer at all is a small molecule / glycan / lipid
       system: the ligand fallback is `all and not (polymer, lipid, sugar,
       water, ion)`, so water and ions keep their own menu — including a
       pure-water box (whose surface must still be reachable);
     • otherwise the hetero-based selection of catSelectionsFor is used. */
const routeCategorySelections = (sels, moleculeType) => {
  const s = sels || {};
  const n = s.n || {};
  const mt = moleculeType || 'protein';
  const wholeProtein = mt === 'protein';
  const wholeOrganic = mt === 'organic';
  const wholeSugar = mt === 'sugar';
  const wholeLipid = mt === 'lipid';
  const noPolymer = n.protein === 0 && n.nucleic === 0;
  const lipid = wholeLipid ? 'all' : (s.lipid || '');
  const sugar = wholeSugar ? 'all' : (s.sugar || '');
  const notLigand = [
    'protein', 'nucleic',
    lipid && `(${lipid})`,
    sugar && `(${sugar})`,
    'water', 'ion',
  ].filter(Boolean);
  const ligandAll = `all and not (${notLigand.join(' or ')})`;
  return {
    protein: 'protein',
    nucleic: 'nucleic',
    lipid,
    sugar,
    // Lipids and sugars have their OWN menus, so the ligand menu excludes both.
    organic: (wholeOrganic || noPolymer) ? ligandAll : (s.organic || ''),
    other: n.others === 0 ? '' : (s.others || 'water or ion'),
    wholeProtein, wholeOrganic, wholeSugar, wholeLipid, noPolymer, ligandAll,
  };
};

const catSelectionsFor = (structure) => {
  if (!structure) return null;
  const cached = catSeleCache.get(structure);
  if (cached) return cached;
  const lipids = lipidResnamesIn(structure);
  const lipidSele = lipids.length ? lipidGroupSele(lipids) : '';
  const sugarSele = SUGAR_SEL;
  const organicSele = [
    'hetero', 'not water', 'not ion',
    `not (${sugarSele})`,
    lipidSele ? `not (${lipidSele})` : '',
  ].filter(Boolean).join(' and ');
  const out = {
    protein: 'protein',
    nucleic: 'nucleic',
    lipid: lipidSele,
    sugar: sugarSele,
    organic: organicSele,
    others: 'water or ion',
    lipids,
    // Whether the lipids follow the standard atom naming, i.e. whether the
    // glycerol backbone can be told apart at all (PART 2.1) — the Lipids menu
    // says so instead of offering a part that would draw nothing.
    lipidNamed: lipidSele ? lipidSubSelections(structure, lipidSele).named : false,
    n: {
      protein: nglSeleCount(structure, 'protein'),
      nucleic: nglSeleCount(structure, 'nucleic'),
      others: nglSeleCount(structure, 'water or ion'),
      organic: nglSeleCount(structure, organicSele),
      lipid: lipidSele ? nglSeleCount(structure, lipidSele) : 0,
      sugar: nglSeleCount(structure, sugarSele),
    },
  };
  catSeleCache.set(structure, out);
  return out;
};

// Cast / RECEIVE shadow flags on every mesh a styling menu creates.
// NGL 2.4 supports no shadow maps at all — the renderer never enables
// `renderer.shadowMap`, and the earlier attempt to force real shadow maps made
// the whole molecule disappear (see installShadowLightRig). The scene is shaded
// by the ONE fixed key light instead, and that rig is left untouched. The flags
// below are therefore set on the REAL scene meshes (Buffer#group /
// Buffer#wireframeGroup are the three.js groups NGL adds to the stage) so every
// new mesh is explicitly declared as BOTH a caster and a receiver: they are
// inert with this renderer, and they become effective the moment NGL renders
// shadow maps — no mesh is ever left out of the convention.
const flagMeshShadows = (rep) => {
  try {
    const buffers = (rep && rep.bufferList) || [];
    buffers.forEach((b) => {
      [b && b.group, b && b.wireframeGroup].forEach((group) => {
        if (!group || typeof group.traverse !== 'function') return;
        group.traverse((o) => {
          if (!o) return;
          if (o.isMesh || o.isLine || o.isLineSegments || o.isPoints) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
      });
    });
  } catch { /* best-effort: never let a styling change break the view */ }
};

// Clipping / camera bounds (Scene → « ✂ Clipping »).
// NGL derives the camera frustum from clipNear / clipFar — PERCENTAGES of the
// scene bounding sphere — and floors the near plane by clipDist in Å
// (Viewer#__updateClipping, verified in the installed ngl 2.4):
//   camera.near = cDist − bRadius · (50 − clipNear)/50
//   camera.far  = cDist + bRadius · (clipFar − 50)/50
//   camera.near = max(camera.near, clipDist)
// So « Clipping : Off » does NOT use what looks like a neutral 0 / 100 / 10:
// the 10 Å clipDist floor is exactly what CUTS a large complex as soon as you
// zoom in, and clipFar 100 stops the far plane at the back edge of the sphere.
// OFF therefore forces the camera bounds to the EXTREMES — near 0 (front edge),
// far 100000 (an effectively infinite far plane) and clipDist 0 (no floor at
// all) — so a huge assembly is never cut, at any zoom.
const CLIP_DEFAULTS = { near: 0, far: 100000, dist: 0 };

// Supersampling level used while the « ◐ Shadows » rig is ON — the cavity-shading
// gradients produced by the deep-ambient + strong-key-light rig are sampled
// several times per pixel instead of once, so the AO-like shading of a crevice is
// smooth instead of banded. NGL's stage parameter range is -1 … 5 (NGL 2.4
// StageParameters#sampleLevel); 0 = NGL's own default (sample only while the
// camera is still) and is what Shadows OFF restores. The value now lives in the
// rig itself (LIGHT_RIG.on.sampleLevel, applied by nglLightParams) together with
// its Mol* translation, where the ambient occlusion is a REAL screen-space pass
// (postprocessing.occlusion) instead of NGL's ambient-fill approximation.

const AA3_TO_1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', HSD: 'H', HSE: 'H', HSP: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M',
  PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', CYX: 'C',
  SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z',
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U'
};

/* ---- NATURE of a polymer residue (protein · DNA · RNA) ---------------------
   The 1-letter code alone cannot say WHAT a polymer is: a PDB spells DNA
   `DA · DC · DG · DT` and RNA `A · C · G · U`. The nature is therefore read
   from the residue NAME, and — for the bare base letters and for every
   MODIFIED nucleotide (5MC · PSU · 2MG · OMG …) — from the residue's OWN
   atoms: the 2'-oxygen (O2') is there in a ribose and absent in a deoxyribose,
   which IS the RNA / DNA distinction. No list of modifications to maintain.

   This is what lets the viewer hand its page one sequence PER NATURE (see
   structureSequenceParts) instead of one mixed text, and what groups the
   residue strip: a protein + DNA complex shows each nature under its own
   heading while the 3D view keeps showing the whole file at once. */
const NUCLEIC_1_BY_NAME = {
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', DI: 'I',   // deoxy- prefixes
  RA: 'A', RC: 'C', RG: 'G', RU: 'U',                     // ribo- prefixes
  A: 'A', C: 'C', G: 'G', U: 'U', T: 'T', I: 'I',         // bare base letters
};

const atomNameSet = (names) => {
  if (names instanceof Set) return names;
  const out = new Set();
  (names || []).forEach((n) => {
    const s = String(n || '').toUpperCase().trim();
    if (s) out.add(s);
  });
  return out;
};

// The sugar ring (C1' + a ring neighbour) and the phosphate link (P · O5' · C5')
// together are what make a nucleotide — so a bare sugar of a glycan, which has
// neither, is never mistaken for one.
const hasSugarRing = (atoms) => atoms.has("C1'") && (atoms.has("C2'") || atoms.has("C3'") || atoms.has("O4'"));
const hasPhosphateLink = (atoms) => atoms.has('P') || atoms.has("O5'") || atoms.has("C5'");

const residueNatureOf = (resname, atomNames) => {
  const name = String(resname || '').toUpperCase().trim();
  if (!name) return '';
  const atoms = atomNameSet(atomNames);
  const base = NUCLEIC_1_BY_NAME[name];
  const sugar = hasSugarRing(atoms);
  const explicitNucleic = !!base && name.length > 1;            // DA · DT · RA · 5MC …
  if (explicitNucleic || (sugar && (hasPhosphateLink(atoms) || !!base))) {
    // O2' = ribose ⇒ RNA; its absence (the H2' / H2'' pair of a deoxyribose) ⇒ DNA.
    return (atoms.has("O2'") || atoms.has("HO2'")) ? 'rna' : 'dna';
  }
  if (AA3_TO_1[name]) return 'protein';                        // the 20 + variants (MSE · SEP · PCA …)
  if (atoms.has('CA') && atoms.has('N') && atoms.has('C')) return 'protein';
  return '';                                                   // water · ions · lipids · ligands
};

/* ---- One 1-letter sequence PER NATURE (the handshake with the pages) -------
   `{ protein: { seq, chains }, dna: {…}, rna: {…} }` built from the SAME tick
   list as the residue strip, so what the page stores and what the user clicks
   can never disagree. The page puts each sequence in the field of its own
   nature (see src/utils/sequenceNatures.js) — this only says WHERE a letter
   comes from, never what is drawn: the file stays ONE structure in ONE viewer. */
const structureSequenceParts = (ticks) => {
  const parts = {};
  SEQUENCE_NATURES.forEach((n) => { parts[n] = { seq: '', chains: [], len: 0 }; });
  (Array.isArray(ticks) ? ticks : []).forEach((t) => {
    const nature = SEQUENCE_NATURES.includes(t && t.nature) ? t.nature : '';
    const code = String((t && t.code) || '').toUpperCase();
    if (!nature || !code) return;
    parts[nature].seq += code;
    parts[nature].len += 1;
    const chain = String((t.chainname || t.chainid) || '');
    if (chain && !parts[nature].chains.includes(chain)) parts[nature].chains.push(chain);
  });
  return parts;
};

// 1-letter sequence from an NGL structure. Tries NGL's getSequence() first,
// then falls back to walking the residues (handles .gro topologies and any
// PDB where NGL does not auto-detect the chains as polymers).
const extractStructureSequence = (component) => {
  if (!component || !component.structure) return '';
  if (typeof component.structure.getSequence === 'function') {
    try {
      const arr = component.structure.getSequence();
      if (Array.isArray(arr) && arr.length) {
        const seq = arr
          .map((s) => (s && (s.seq || s.sequence)) || '')
          .join('')
          .replace(/[^A-Za-z]/g, '');
        if (seq) return seq;
      }
    } catch { /* fall through */ }
  }
  let seq = '';
  try {
    component.structure.eachResidue((r) => {
      const name = String((r && (r.resname || r.restype)) || '').toUpperCase();
      const code = AA3_TO_1[name] || (name.length === 1 && /[ACGTU]/.test(name) ? name : '');
      if (code) seq += code;
    });
  } catch { /* fall through */ }
  return seq;
};

// Per-residue "tick" list for the sequence strip above the 3D viewport.
// Iterates the structure's residues in the same order as extractStructureSequence
// so tick index i ↔ residue ri = resno - 1 (the app-wide convention used by
// mapPdbAtomToNmrKeys and the per-atom tables). Also precomputes the PDB atom
// names of each residue in ONE pass so tick clicks never need a full-structure
// atom scan (which can freeze the page on large / multi-model systems).
const collectResidueTicks = (component) => {
  if (!component || !component.structure) return [];
  const out = [];
  const atomsByRes = new Map(); // `${chainid}|${resno}` -> Set(PDB atom names)
  try {
    component.structure.eachAtom((a) => {
      const key = `${String(a.chainid || a.chain || '')}|${a.resno}`;
      if (!atomsByRes.has(key)) atomsByRes.set(key, new Set());
      const nm = String(a.atomname || '').trim();
      if (nm) atomsByRes.get(key).add(nm);
    });
    component.structure.eachResidue((r) => {
      const name = String((r && (r.resname || r.restype)) || '').toUpperCase();
      const code = AA3_TO_1[name] || (name.length === 1 && /[ACGTU]/.test(name) ? name : '');
      const chainid = r && (r.chainid || r.chain) ? String(r.chainid || r.chain) : '';
      // NGL's `chainid` is the chain INDEX; `chainname` is the PDB chain letter
      // (A · B · C) — the one a reader recognises, used by the nature summary.
      const chainname = r && r.chainname != null && String(r.chainname) !== ''
        ? String(r.chainname) : chainid;
      const atomNames = [...(atomsByRes.get(`${chainid}|${r.resno}`) || [])];
      out.push({
        resno: r && r.resno != null ? r.resno : out.length + 1,
        resname: name || String((r && r.restype) || 'UNK'),
        code: code || (name.length === 1 ? name : ''),
        // TRUE only for polymer residues (protein / nucleic). Water, ions,
        // lipids and other hetero have no 1-letter code and are excluded from
        // the sequence strip (they are not part of the polymer "sequence").
        polymer: !!code,
        // WHICH polymer this residue belongs to — 'protein' · 'dna' · 'rna' (or
        // '' for a residue whose nature cannot be read): the strip groups by it
        // and the page stores each nature's sequence in its own field.
        nature: code ? residueNatureOf(name, atomNames) : '',
        chainid,
        chainname,
        atomNames,
      });
    });
  } catch { /* keep partial list */ }
  return out;
};

/* ---- Context-aware 3D atom / residue label generation ----------------------
   Two independent toggles drive the 3D labels:
     showResidueNumber — residue / molecule identifiers (kept sparse in 3D)
     showAtomLabel     — atom names next to each labelled atom
   Text rules by residue category:
     Protein:   resno-only → number on CA · atom-only → atom names (CA, HA, CB)
                both → {resno}{1-letter}{atom} e.g. 114SHA
     DNA/RNA:   resno-only → number on O4' (else P) · atom-only → atom names
                both → {resno}{1-letter}{atom} e.g. 14AN3
     Ligand / non-standard / small molecule:
                resno-only → {resname}{resno} on the central heavy atom
                atom-only  → atom names on heavy atoms
                both       → {resname}{resno}-{atom} e.g. ATP501-O1G
     Water / monatomic ions:
                resno-only → {resname}{resno} (anchor: O / the ion) e.g. HOH201
                atom-only  → element symbol of the heavy atoms (O, Mg)
                both       → {resname}{resno} (kept — the atom would be redundant)
   Labels are returned as { index → text } plus the exact atom-index selection
   so only the labelled atoms are handed to NGL (no empty background plates). */
const LABEL_WATER_NAMES = new Set([
  'HOH', 'WAT', 'H2O', 'OH2', 'SOL', 'TIP', 'TIP3', 'TIP4', 'TIP4P', 'TIP5',
  'SPC', 'SPCE', 'T3P', 'T4P', 'DOD', 'DOD2', 'HHO'
]);
const LABEL_ION_ELEMENTS = new Set([
  'NA', 'MG', 'K', 'CA', 'CL', 'ZN', 'FE', 'MN', 'CU', 'CO', 'NI', 'LI', 'RB',
  'CS', 'BR', 'I', 'F', 'CD', 'HG', 'PB', 'AL', 'BA', 'SR', 'CR', 'MO', 'V'
]);
// …and the RESIDUE names of a single-atom ion. A .gro / a CHARMM topology names its
// ions SOD · CLA · POT …, and NGL reads the ELEMENT out of the ATOM name — which is
// the same word: « SOD » gives the element « S » and « CLA » the element « C », so
// a sodium and a chloride were classified as ORGANIC LIGANDS (they even got the
// « Hydrophobicity » colouring). The residue name is the only honest source there.
const LABEL_ION_RESNAMES = new Set([
  'SOD', 'NA', 'POT', 'K', 'LI', 'LIT', 'RB', 'CS', 'CES',
  'MG', 'MG2', 'CAL', 'CA', 'SR', 'BA', 'ZN', 'ZN2', 'MN', 'FE', 'FE2',
  'CLA', 'CL', 'BR', 'IOD', 'I', 'F',
]);
const LABEL_NUCLEIC_NAMES = new Set(['DA', 'DC', 'DG', 'DT', 'DU', 'A', 'C', 'G', 'T', 'U']);

const properElementSymbol = (el) => {
  const e = String(el || '').trim();
  if (!e) return '';
  return e.length === 1 ? e.toUpperCase() : `${e[0].toUpperCase()}${e.slice(1).toLowerCase()}`;
};

// Classify one residue (its atoms are already gathered) into one of the four
// label categories described above.
const classifyLabelResidue = (resname, atoms) => {
  const name = String(resname || '').toUpperCase();
  if (LABEL_NUCLEIC_NAMES.has(name)) return 'nucleic';
  if (AA3_TO_1[name] && !LABEL_NUCLEIC_NAMES.has(name)) return 'protein';
  if (LABEL_WATER_NAMES.has(name)) return 'water';
  const nonH = atoms.filter((a) => a.el !== 'H');
  if (nonH.length === 1 && atoms.length === 1 && LABEL_ION_ELEMENTS.has(nonH[0].el)) return 'ion';
  return 'ligand';
};

const residueLabelCode = (resname) => {
  const name = String(resname || '').toUpperCase();
  if (LABEL_NUCLEIC_NAMES.has(name)) {
    return name.length === 1 ? name : (AA3_TO_1[name] || name.slice(0, 1));
  }
  return AA3_TO_1[name] || '';
};

/**
 * Compute the 3D label plan for the whole structure.
 * @param {object} component NGL StructureComponent
 * @param {object} opts { showResidueNumber, showAtomLabel, showResidueNumberType,
 *                        atomNameOf, allowed }
 *   `allowed` is an optional Set of atom indices: only those atoms may be
 *   labelled. The per-category menus use it, so « Residues » ticked in the
 *   Proteins menu labels proteins only.
 *   `renumberOf` is the residue renumbering of the 🔢 tool (resno → number shown):
 *   every label follows it, so a renumbering is VISIBLE in the 3D view instead of
 *   only in the rename list (the report: « renumber does not do anything »).
 * @returns {{ labelText: object, indices: number[] }}
 */
const build3dLabelMap = (component, { showResidueNumber, showAtomLabel, showResidueNumberType = false, atomNameOf = null, allowed = null, renumberOf = null }) => {
  const labelText = {};
  const structure = component && component.structure;
  if (!structure) return { labelText, indices: [] };
  const residueMap = new Map(); // `${chain}|${resno}|${resname}` → { atoms, byName, … }

  try {
    structure.eachAtom((a) => {
      const chain = String(a.chainid || a.chain || '');
      const resname = String(a.resname || a.restype || '').toUpperCase();
      const resno = a.resno != null ? a.resno : 0;
      const key = `${chain}|${resno}|${resname}`;
      let entry = residueMap.get(key);
      if (!entry) {
        entry = { chain, resno, resname, atoms: [], byName: new Map() };
        residueMap.set(key, entry);
      }
      const atomName = String(a.atomname || a.name || '').trim();
      const el = String(a.element || '').toUpperCase();
      let disp = atomName;
      if (typeof atomNameOf === 'function') {
        try { disp = String(atomNameOf(a) || '').trim() || atomName; } catch { disp = atomName; }
      }
      const atom = {
        idx: a.index,
        name: atomName.toUpperCase(),
        disp,
        el,
        heavy: el !== 'H',
        x: a.x || 0,
        y: a.y || 0,
        z: a.z || 0
      };
      entry.atoms.push(atom);
      if (!entry.byName.has(atom.name)) entry.byName.set(atom.name, []);
      entry.byName.get(atom.name).push(atom);
    });
  } catch { return { labelText, indices: [] }; }

  const put = (atom, text) => {
    if (allowed && !allowed.has(atom.idx)) return;   // this category does not own the atom
    const t = String(text || '').trim();
    if (t) labelText[atom.idx] = t;
  };

  for (const entry of residueMap.values()) {
    if (!entry.atoms.length) continue;
    const cat = classifyLabelResidue(entry.resname, entry.atoms);
    const code = residueLabelCode(entry.resname);
    const shownResno = typeof renumberOf === 'function' ? renumberOf(entry.resno) : entry.resno;
    const resTag = `${entry.resname}${shownResno}`;
    const resnoStr = String(shownResno);

    if (cat === 'protein' || cat === 'nucleic') {
      // A) proteins / B) nucleic acids — polymer rules.
      const anchorNames = cat === 'protein'
        ? (entry.byName.has('CA') ? ['CA'] : [])
        : (entry.byName.has("O4'") ? ["O4'"] : (entry.byName.has('P') ? ['P'] : []));
      if (showResidueNumber && showAtomLabel) {
        entry.atoms.forEach((at) => put(at, `${resnoStr}${code}${at.disp}`)); // e.g. 114SHA / 14AN3
      } else if (showAtomLabel) {
        entry.atoms.forEach((at) => put(at, at.disp));                        // e.g. CA, HA, CB
      } else if (showResidueNumber) {
        // One label per residue on the anchor atom only (avoids 3D clutter).
        // "Residue type" mode appends the 1-letter code: 114 → 114S / 14 → 14A.
        const resnoLabel = (showResidueNumberType && code) ? `${resnoStr}${code}` : resnoStr;
        anchorNames.forEach((n) => {
          (entry.byName.get(n) || []).forEach((at) => put(at, resnoLabel));   // e.g. 114 / 114S
        });
      }
    } else if (cat === 'ligand') {
      // C) ligands / small molecules / non-standard residues (no 1-letter code).
      // Atom-name modes label EVERY atom — including hydrogens when the
      // structure carries them (their names are 2D-synchronised, e.g. H0a).
      const heavy = entry.atoms.filter((a) => a.heavy);
      const labelAtoms = entry.atoms.length ? entry.atoms : heavy;
      if (showResidueNumber && showAtomLabel) {
        labelAtoms.forEach((at) => put(at, `${resTag}-${at.disp}`));           // e.g. ATP501-O1G / ATP501-H1a
      } else if (showAtomLabel) {
        labelAtoms.forEach((at) => put(at, at.disp || properElementSymbol(at.el)));
      } else if (showResidueNumber) {
        // Single label on the heavy atom closest to the molecule centroid.
        const targets = heavy.length ? heavy : entry.atoms;
        let anchor = targets[0];
        if (targets.length > 1) {
          const n = targets.length;
          const cx = targets.reduce((s, a) => s + a.x, 0) / n;
          const cy = targets.reduce((s, a) => s + a.y, 0) / n;
          const cz = targets.reduce((s, a) => s + a.z, 0) / n;
          let bestD = Infinity;
          targets.forEach((at) => {
            const d = (at.x - cx) ** 2 + (at.y - cy) ** 2 + (at.z - cz) ** 2;
            if (d < bestD) { bestD = d; anchor = at; }
          });
        }
        put(anchor, resTag);                                                  // e.g. ATP501
      }
    } else {
      // D) water / monatomic ions — the residue label is also the molecule.
      const heavy = entry.atoms.filter((a) => a.heavy);
      const anchor = heavy[0] || entry.atoms[0];
      if (showResidueNumber && showAtomLabel) {
        put(anchor, resTag);                                                  // e.g. HOH201, never HOH201-O
      } else if (showAtomLabel) {
        heavy.forEach((at) => put(at, properElementSymbol(at.el)));           // e.g. O, Mg
      } else if (showResidueNumber) {
        put(anchor, resTag);                                                  // e.g. HOH201 / MG301
      }
    }
  }

  const indices = Object.keys(labelText).map(Number).sort((a, b) => a - b);
  return { labelText, indices };
};

// The viewer no longer hides chains on large systems — they are rendered in
// full with lightweight representations (see addDefaultReps). This constant
// simply starts the selection-color block below.
const SELECT_COLOR_HEX = 0xf59e0b;
const MANUAL_COLOR_HEX = 0x16a34a;
// Background colour of the 3D scene (§3 Toolbar → 🌫 Scene → 🎨 Background). It is
// a setting of its own — persisted like Fog / Shadows / Clipping, applied to the
// live stage with `stage.setParameters({ backgroundColor })`, and part of a saved
// setup — while the 🧪 PyMOL panel writes the same state (so both entries agree).
const BG_DEFAULT = '#f8fafc';

// ---- Customisable viewer colours (persisted) --------------------------------
// NGL's built-in "sstruc" colour scheme uses hard-coded colours. To let the user
// pick their own per-element colours (helices / sheets / loops) we register ONE
// custom scheme that reads live from the mutable store below — changing a colour
// only requires re-rendering the affected representations (no re-registration).
//
// ⚠️ ColormakerRegistry.addScheme(DEFINITION, LABEL) — the DEFINITION (the
// function that defines `this.atomColor`) comes FIRST, the LABEL second. Given
// them the other way round (as this viewer used to), NGL stringifies the label
// into the scheme id and builds a class that `.call()`s a string: instantiating
// it throws ("... .call is not a function"), so EVERY representation that asked
// for that id died inside its own build and drew NOTHING — that is how
// « Colour by chemical group » blanked the molecule and how « Stylized rings »
// showed nothing at all. registerColorScheme is now the ONLY caller of
// addScheme: besides the order it also INSTANTIATES the scheme once before
// handing the id out, so an id that cannot produce an atom colour is never used
// (the caller then keeps a built-in NGL colour instead of drawing nothing).
const registerColorScheme = (NGL, label, define) => {
  if (!NGL || !NGL.ColormakerRegistry) return null;
  try {
    const key = NGL.ColormakerRegistry.addScheme(define, label);
    const probe = NGL.ColormakerRegistry.getScheme({ scheme: key });
    return probe && typeof probe.atomColor === 'function' ? key : null;
  } catch { return null; }
};
const sstrucColorStore = { helix: 0xb44a90, sheet: 0xf8d878, loop: 0xe6e6e6 };
// The DEFAULTS of that palette, snapshotted ONCE from the store above (the store is
// mutated by the live effect, so it can never BE the defaults): the ↺ of the ⚙
// settings wheel and the initial state write these — the three colours exist in ONE
// place, so a reset can never drift from the default palette.
const SSTRUC_COLOR_DEFAULTS = { ...sstrucColorStore };
// The three 2°-structure colours as ONE list, with the wording of both surfaces: the
// ⚙ settings wheel, the « Color by » row of the styling bar and the « Atom colour »
// selector of a protein menu all draw their swatches from it — the three places can
// therefore never offer different palettes (the report: « colors for secondary
// structure definition are not present in the setting wheel »).
const SSTRUC_COLOR_ITEMS = [
  { key: 'helix', label: 'Helix', what: 'helices (α · 3₁₀ · π)' },
  { key: 'sheet', label: 'Sheet', what: 'sheets (β strands)' },
  { key: 'loop', label: 'Loop', what: 'loops (coil · turns · bends)' },
];
let sstrucSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The 2°-structure colour of ONE atom, from NGL's own `sstruc` code — factored out
// so the MOTIF scheme (lab-nuc-motif) can hand every nucleotide that is NOT part of
// a G-quadruplex or a hairpin exactly the colour it would have had here.
const sstrucAtomColorOf = (s) => {
  if (s === 'h' || s === 'g' || s === 'i') return sstrucColorStore.helix;   // α / 3₁₀ / π helices
  if (s === 'e' || s === 'b') return sstrucColorStore.sheet;                // β strands / sheets
  return sstrucColorStore.loop;                                             // coil, turns, bends, loops…
};
// The definition of the scheme, NAMED so a test can extract and really run it
// (registerSstrucScheme below is the only place that registers it).
const defineSstrucScheme = () => {
  return function () {
    this.atomColor = function (atom) { return sstrucAtomColorOf(atom && atom.sstruc); };
  };
};
const registerSstrucScheme = (NGL) => {
  if (sstrucSchemeKey) return;
  sstrucSchemeKey = registerColorScheme(NGL, 'lab-sstruc', defineSstrucScheme());
};
const numToHex = (v) => `#${(Number(v) || 0).toString(16).padStart(6, '0')}`;

/* ---- CHAIN colours (« Color by : Chain ») -----------------------------------
   « Color by : Chain » of a protein / a nucleic acid / a lipid row used to be
   NGL's OWN `chainid` scheme: it hands chain 1, 2, 3 … a colour of its internal
   table, and NOTHING in the viewer could ever change it — the report « it is
   possible to color by chain but there is no way to define the color of the
   chain in the setting wheel ». ONE house scheme replaces it, with the same
   contract as every other palette here: the swatches live in a mutable store the
   scheme reads at call time, so moving one re-renders the representations and no
   scheme is ever re-registered. A chain is named by its LETTER (A · B · C …) —
   what a PDB / an mmCIF writes — and any other name (a number, an empty chain, a
   force field's own spelling) takes the grey « other » swatch: a chain the table
   does not know is never black. */
const CHAIN_COLOR_PALETTE = {
  A: 0x4f7fd0, B: 0xd06a2f, C: 0x3fa06a, D: 0xb04fa0,
  E: 0xd0a02f, F: 0x2fa0b0, G: 0xb04f5f, H: 0x6a5fa0,
  other: 0x9aa3ad,
};
// The order the ⚙ wheel draws them in: the eight chain letters, then the grey
// catch-all — the very list the scheme reads, so the two can never disagree.
const CHAIN_COLOR_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'other'];
const chainColorStore = { ...CHAIN_COLOR_PALETTE };
let chainSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The colour of ONE chain, from its NAME — PURE, so a test can run the very rule
// the scheme hands to NGL.
const chainColorOf = (chain) => {
  const c = String(chain == null ? '' : chain).trim().toUpperCase();
  const v = chainColorStore[c];
  return Number.isFinite(v) ? v : CHAIN_COLOR_PALETTE.other;
};
// The definition of the scheme (named so a test can extract and really run it).
const defineChainScheme = () => {
  return function () {
    this.atomColor = function (atom) { return chainColorOf(atom && atom.chainname); };
  };
};
const registerChainScheme = (NGL) => {
  if (chainSchemeKey) return;
  chainSchemeKey = registerColorScheme(NGL, 'lab-chain', defineChainScheme());
};

// ---- Nucleic-acid GROUP colours (🎨 Colours panel of the B menu) ------------
// ONE custom scheme colours a nucleic acid by CHEMICAL GROUP — the phosphate
// backbone, the pentose rings and the bases — which is exactly what the panel of
// menu B offers (the shared panel, i.e. the helix / sheet / loop colours, made no
// sense there). The three values live in this mutable store, fed from
// catStyles.nucleic by an effect, so moving a swatch only re-renders the
// representations — no scheme is ever re-registered (same trick as lab-sstruc).
const nucleicColorStore = {
  phosphate: DEFAULT_NUCLEIC_COLORS.phosphate,
  pentose: DEFAULT_NUCLEIC_COLORS.pentose,
  base: DEFAULT_NUCLEIC_COLORS.base,
};
let nucleicSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme (named so a test can extract and really run it).
const defineNucleicGroupsScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      const g = nucleicGroupOf(atom && atom.atomname);
      if (g === 'phosphate') return nucleicColorStore.phosphate;
      if (g === 'pentose') return nucleicColorStore.pentose;
      return nucleicColorStore.base;
    };
  };
};
const registerNucleicScheme = (NGL) => {
  if (nucleicSchemeKey) return;
  nucleicSchemeKey = registerColorScheme(NGL, 'lab-nucleic-groups', defineNucleicGroupsScheme());
};

// ---- Lipid PART colours (🎨 Colours panel of the C menu) --------------------
// Exactly the same contract, for the three chemical PARTS of a lipid: the polar
// headgroup, the glycerol backbone and the acyl chains (see PART 2.1 for the
// classification). The three values live in this mutable store, fed from
// catStyles.lipid by an effect, so moving a swatch only re-renders the
// representations — no scheme is ever re-registered. `named` is written by the
// renderer, from the very flag the drawn sub-selections were built with, so a
// part can never be DRAWN with one rule and COLOURED with another.
const lipidColorStore = {
  head: DEFAULT_LIPID_COLORS.head,
  glycerol: DEFAULT_LIPID_COLORS.glycerol,
  acyl: DEFAULT_LIPID_COLORS.acyl,
  named: true,
};
let lipidSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme (named so a test can extract and really run it).
const defineLipidGroupsScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      // The walk of the lipids menu (heavy atoms by name, hydrogens by BOND, see
      // lipidSubSelections) is the single source of truth: it is what the
      // representations are built from, so the colours can never disagree with the
      // picture — a chain hydrogen named H2R is drawn as a chain atom AND coloured
      // as one.
      const i = atom && atom.index;
      const store = lipidPartIndexStore;
      if (i !== undefined && store.head
        && (!atom.structure || !store.structure || atom.structure === store.structure)) {
        if (store.acyl.has(i)) return lipidColorStore.acyl;
        if (store.glycerol.has(i)) return lipidColorStore.glycerol;
        if (store.head.has(i)) return lipidColorStore.head;
      }
      // No walk for this atom (another structure, a file the walk never saw): the
      // naming rules, as before.
      const g = lipidGroupOf(atom && atom.atomname, atom && atom.element, lipidColorStore.named);
      if (g === 'glycerol') return lipidColorStore.glycerol;
      if (g === 'acyl') return lipidColorStore.acyl;
      return lipidColorStore.head;
    };
  };
};
const registerLipidScheme = (NGL) => {
  if (lipidSchemeKey) return;
  lipidSchemeKey = registerColorScheme(NGL, 'lab-lipid-groups', defineLipidGroupsScheme());
};

// ---- Stylized per-base colours (Bases → « Stylized rings ») -----------------
// ONE custom scheme colours the base part of a nucleotide by the IDENTITY of its
// base (A · C · G · T · U, see BASE_IDENTITY_COLORS): that is the fill of the
// « Stylized rings » option, which draws the inside of every base ring in the
// colour of that base.
let baseIdentitySchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme (named so a test can extract and really run it).
const defineBaseIdentityScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      return baseIdentityColorOf(atom && atom.resname);
    };
  };
};
const registerBaseIdentityScheme = (NGL) => {
  if (baseIdentitySchemeKey) return;
  baseIdentitySchemeKey = registerColorScheme(NGL, 'lab-base-identity', defineBaseIdentityScheme());
};

// ---- Atom-type (ELEMENT) colours -------------------------------------------
// ONE swatch table colours the atoms of every per-molecule « Atom type »
// colouring (the per-molecule sections of the Molecules panel): the ⚙ settings
// wheel of that panel edits it, and the scheme below reads this mutable store
// live — so moving a swatch only re-renders the representations, exactly like
// lab-sstruc / lab-nucleic-groups / lab-lipid-groups / lab-base-identity. An
// element that is NOT in the table (a metal of an unusual file) keeps a readable
// grey instead of turning black.
const ELEMENT_COLOR_PALETTE = {
  H: 0xe6e6e6, C: 0x9aa3ad, N: 0x2f61d9, O: 0xe23a3a, S: 0xd8c020, P: 0xe08a20,
  F: 0x6fd6a0, Cl: 0x36c23a, Br: 0xa5442b, I: 0x8a2fd0, B: 0xf0a0a0, Se: 0xf0a020,
  Fe: 0xd06a1a, Zn: 0x7d80b0, Mg: 0x8aff00, Ca: 0x3dff00, Na: 0xab5cf2, K: 0x8f40d4,
  // The remaining metals of the request's element list (Cu · Mn · Co · Cr · Mo)
  // and nickel: every one of the 22 elements « Color by : Atom type » names now
  // has its own swatch in the ⚙ settings wheel.
  Cu: 0xc88033, Mn: 0x9c7ac7, Co: 0xf090a0, Cr: 0x8a99c7, Mo: 0x54b5b5, Ni: 0x50d050,
};
// The element swatches the ⚙ settings wheel shows, in the request's order (the
// two extras the palette has always carried — boron, bromine — come last).
const ELEMENT_ORDER = [
  'C', 'H', 'N', 'O', 'P', 'S', 'Ca', 'K', 'Na', 'Cl', 'Mg', 'Fe', 'Zn', 'Cu',
  'Mn', 'I', 'F', 'Co', 'Cr', 'Mo', 'Se', 'Ni', 'B', 'Br',
];
const DEFAULT_ELEMENT_COLOR = 0xb9c2cc;
const elementColorStore = { ...ELEMENT_COLOR_PALETTE };
let elementSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
const elementColorOf = (element) => {
  const raw = element == null ? '' : String(element).trim();
  if (!raw) return DEFAULT_ELEMENT_COLOR;
  const cap = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
  const v = elementColorStore[cap];
  return Number.isFinite(v) ? v : DEFAULT_ELEMENT_COLOR;
};
// The definition of the scheme (named so a test can extract and really run it).
const defineElementScheme = () => {
  return function () {
    this.atomColor = function (atom) { return elementColorOf(atom && atom.element); };
  };
};
const registerElementScheme = (NGL) => {
  if (elementSchemeKey) return;
  elementSchemeKey = registerColorScheme(NGL, 'lab-elements', defineElementScheme());
};

// ---- Sugar IDENTITY colours (the « Sugar type » colouring) ------------------
// The sugars recognised by the S menu (SUGAR_RES_SEL) get ONE colour each, the
// exact counterpart of BASE_IDENTITY_COLORS for the bases — so a glycan can be
// read residue by residue (which sugar is where) instead of all one colour. The
// ⚙ settings wheel of the Molecules panel edits the table.
const SUGAR_IDENTITY_COLORS = {
  GLC: 0x3fbf6f, NAG: 0x2f7fd0, MAN: 0x8a5fd0, BMA: 0xd0a02f,
  GAL: 0xd05f9f, FUC: 0x30b7b7, SIA: 0xd06a40,
  // NAN is the other 3-letter spelling of the SAME sugar (Neu5Ac): the two codes
  // share one colour, because the point of this table is « which sugar is this ».
  NAN: 0xd06a40,
};
/* ---- The sugar TYPES of « Color by : Sugar type » (the ⚙ settings wheel) ----
   The palette is keyed by the CHEMICAL sugar — Glc · GlcNAc · Neu · Kdo … — i.e.
   by the 29 names the request lists, and NOT by the 3-letter code a PDB file
   happens to use: a file may write the same glucose GLC, BGC or GCS, and the
   point of the colouring is « which sugar is this », never « which spelling ».
   SUGAR_TYPE_OF_CODE is what bridges the two: the scheme reads the code of the
   residue, looks the TYPE up here, and paints with the type's swatch. A code that
   is not in the table (a modified sugar) keeps the readable grey. */
const SUGAR_TYPE_ORDER = [
  'Glc', 'Fru', 'Gal', 'Rib', 'dRib', 'Man', 'Ara', 'Xyl', 'Fuc', 'Rha', 'Api', 'All',
  'Alt', 'Gul', 'Ido', 'Tal', 'Psi', 'Sor', 'Tag', 'GlcNAc', 'GalNAc', 'ManNAc',
  'GlcA', 'GalA', 'ManA', 'IdA', 'Mur', 'Neu', 'Kdo',
];
const SUGAR_TYPE_COLORS = {
  Glc: 0x3fbf6f, Fru: 0x7fd03f, Gal: 0xd05f9f, Rib: 0x2fb7d0, dRib: 0x2f7fd0,
  Man: 0x8a5fd0, Ara: 0xc07fd0, Xyl: 0xa0a02f, Fuc: 0x30b7b7, Rha: 0x30b780,
  Api: 0xd06a40, All: 0xbf7f3f, Alt: 0x9f9f5f, Gul: 0x7f9f3f, Ido: 0x5f8f8f,
  Tal: 0xcf9fd0, Psi: 0xbfcf2f, Sor: 0x6fcf8f, Tag: 0xdfaf5f,
  GlcNAc: 0x2f7fd0, GalNAc: 0x2fa0d0, ManNAc: 0x6f5fd0,
  GlcA: 0xd0712f, GalA: 0xd03f6f, ManA: 0xa45fd0, IdA: 0x2f9fd0,
  Mur: 0x8fa02f, Neu: 0xd06a40, Kdo: 0xc0304f,
};
// Best-effort bridge from the 3-letter codes of a PDB file to the types above —
// the standard spellings, the two nomenclatures of the sialic acids, and the
// common modified sugars. An unknown code simply keeps the grey.
const SUGAR_TYPE_OF_CODE = {
  GLC: 'Glc', BGC: 'Glc', GCS: 'Glc', GCU: 'GlcA', GTR: 'GlcA', GCV: 'GlcA',
  NAG: 'GlcNAc', NDG: 'GlcNAc', NGC: 'GalNAc', NMA: 'ManNAc', NAA: 'ManNAc',
  MAN: 'Man', BMA: 'Man', MANA: 'ManA', MA1: 'ManA', FRU: 'Fru', FRC: 'Fru',
  GAL: 'Gal', GLA: 'Gal', GXL: 'Gal', GALA: 'GalA', GAL1: 'GalA',
  RIB: 'Rib', DRI: 'dRib', DRB: 'dRib', ARA: 'Ara', ARB: 'Ara', XYL: 'Xyl', XYS: 'Xyl',
  FUC: 'Fuc', FUL: 'Fuc', RAM: 'Rha', RHA: 'Rha', API: 'Api',
  ALL: 'All', ALT: 'Alt', GUL: 'Gul', GUP: 'Gul', IDO: 'Ido', IDR: 'Ido', IDU: 'IdA',
  TAL: 'Tal', PSI: 'Psi', SOR: 'Sor', TAG: 'Tag',
  MUR: 'Mur', MUB: 'Mur', NAN: 'Neu', SIA: 'Neu', NEU: 'Neu', SLB: 'Neu',
  KDO: 'Kdo', KD2: 'Kdo', KDN: 'Kdo',
};
const sugarTypeColorStore = { ...SUGAR_TYPE_COLORS };
const sugarTypeOf = (resname) => {
  const c = String(resname == null ? '' : resname).trim().toUpperCase();
  return SUGAR_TYPE_OF_CODE[c] || '';
};
const sugarTypeColorOf = (type) => {
  const v = sugarTypeColorStore[type];
  return Number.isFinite(v) ? v : DEFAULT_ELEMENT_COLOR;
};
// The residue codes of the S menu, in the order they are written there — the ⚙
// panel builds its swatch grid from THIS list, so the two can never drift.
const SUGAR_IDENTITY_CODES = (SUGAR_RES_SEL.match(/\[([A-Za-z0-9]{2,3})\]/g) || [])
  .map((s) => s.slice(1, -1));
// ONE table, two spellings: the CODE-level swatches below are the legacy names of
// the same colours as the 29 TYPES of the palette above — the effect at the bottom
// of the viewer keeps a code's swatch equal to its type's, so « GLC » and « Glc »
// can never disagree, and a page that still speaks in 3-letter codes keeps working.
const sugarColorStore = { ...SUGAR_IDENTITY_COLORS };
let sugarSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
const sugarColorOf = (resname) => {
  const r = String(resname == null ? '' : resname).trim().toUpperCase();
  // 1. the CODE-level swatch (kept equal to the TYPE's by the ⚙ effect), 2. the
  // TYPE of that code — the 29 chemical sugars the request names — 3. the grey.
  const v = sugarColorStore[r];
  if (Number.isFinite(v)) return v;
  const type = sugarTypeOf(r);
  return type ? sugarTypeColorOf(type) : DEFAULT_ELEMENT_COLOR;
};
// The definition of the scheme (named so a test can extract and really run it).
const defineSugarIdentityScheme = () => {
  return function () {
    this.atomColor = function (atom) { return sugarColorOf(atom && atom.resname); };
  };
};
const registerSugarScheme = (NGL) => {
  if (sugarSchemeKey) return;
  sugarSchemeKey = registerColorScheme(NGL, 'lab-sugar-identity', defineSugarIdentityScheme());
};

/* ---- GLYCAN entity colours (the « Glycan (linked sugars) » colouring) --------
   The glycan ENTITIES of PART 2.2bis get ONE colour each, so a branched N-glycan
   reads as ONE molecule instead of seven unrelated residues; an isolated
   monosaccharide keeps the per-sugar identity colour of the ⚙ palette, which is
   the honest reading of « this one is linked to nothing ». The grouping is computed
   once per structure (glycanEntityMapFor) and the palette is a live store, exactly
   like lab-elements / lab-sugar-identity: moving a colour repaints, nothing is
   re-registered. */
const GLYCAN_ENTITY_COLORS = [
  0x2f9fd0, 0xd0712f, 0x4cc04a, 0xa45fd0, 0xd03f6f, 0x2fb7a0, 0xc8a92f, 0x7a7fd0,
];
const DEFAULT_GLYCAN_ENTITY_COLOR = DEFAULT_ELEMENT_COLOR;
const glycanColorStore = {
  colors: [...GLYCAN_ENTITY_COLORS],
  isolate: true,   // an isolated sugar keeps its « Sugar type » colour
};
// The colour of entity N, cycling through the palette (an organism with more than
// eight glycans repeats the colours — the labels of the menu tell them apart).
const glycanEntityColorOf = (i) => {
  const c = glycanColorStore.colors;
  if (!Number.isFinite(i) || !c.length) return DEFAULT_GLYCAN_ENTITY_COLOR;
  const v = c[((i % c.length) + c.length) % c.length];
  return Number.isFinite(v) ? v : DEFAULT_GLYCAN_ENTITY_COLOR;
};
let glycanSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme (named so a test can extract and really run it).
const defineGlycanScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      const info = atom && atom.structure ? glycanEntityMapFor(atom.structure) : null;
      const e = info && atom.index != null ? info.byAtom.get(atom.index) : undefined;
      if (e == null) return sugarColorOf(atom && atom.resname);
      const entity = info.entities[e];
      if (glycanColorStore.isolate && entity && !entity.linked) return sugarColorOf(atom.resname);
      return glycanEntityColorOf(e);
    };
  };
};
const registerGlycanScheme = (NGL) => {
  if (glycanSchemeKey) return;
  glycanSchemeKey = registerColorScheme(NGL, 'lab-glycans', defineGlycanScheme());
};

/* ---- Lipid CLASS colours (the « Lipid class » colouring) --------------------
   ONE colour per headgroup class (PART 2.1bis), read from the residue name alone:
   a bilayer can then be read CHEMICALLY — which phospholipid, which sterol, which
   fatty acid — instead of part by part (lab-lipid-groups keeps that reading). */
const LIPID_CLASS_COLORS = {
  PC: 0x2f9fd0, PE: 0x3fbf6f, PG: 0xd03f6f, PS: 0xd8b02f, PI: 0x8a5fd0,
  PA: 0x2fb7b7, CL: 0xd0712f, SM: 0x7a7fd0, Chol: 0xd8d02f, FA: 0xa8b0b8,
  // The five classes the request lists that the old table had no colour for.
  TAG: 0x9f7f2f, DAG: 0xaf9f4f, MAG: 0xbfaf6f, Cer: 0xc07fd0, Erg: 0xe8e02f,
  OTHER: DEFAULT_ELEMENT_COLOR,
};
// The 14 « Lipid type » classes of the request, in ITS order — the ⚙ settings
// wheel builds its swatch grid from THIS list (PA and the grey « OTHER » are kept
// at the end: a file vocabulary has them, the request simply did not name them).
const LIPID_TYPE_ORDER = ['FA', 'TAG', 'PC', 'PE', 'PS', 'PI', 'PG', 'CL', 'SM', 'Chol', 'Erg', 'DAG', 'MAG', 'Cer', 'PA', 'OTHER'];
const lipidClassColorStore = { ...LIPID_CLASS_COLORS };
const lipidClassColorOf = (resname) => {
  const v = lipidClassColorStore[lipidClassOf(resname)];
  return Number.isFinite(v) ? v : DEFAULT_ELEMENT_COLOR;
};
let lipidClassSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
const defineLipidClassScheme = () => {
  return function () {
    this.atomColor = function (atom) { return lipidClassColorOf(atom && atom.resname); };
  };
};
const registerLipidClassScheme = (NGL) => {
  if (lipidClassSchemeKey) return;
  lipidClassSchemeKey = registerColorScheme(NGL, 'lab-lipid-class', defineLipidClassScheme());
};

/* ---- Nucleic-acid FORM colours (the « RNA/DNA conformation » colouring) -------
   A · B · Z DNA, A · flexible RNA — the six forms of PART 3.1 get ONE distinct,
   high-contrast colour each, so a structural transition (A → B, right-handed → Z,
   a rigid stretch → a flexible loop) jumps out of the picture. The classification
   is computed ONCE per structure and cached (nucleicClassFor): the scheme only
   looks the residue index up, and it never throws on an atom that carries no
   structure (registration probe, a test, a colouring of another molecule). */
const DEFAULT_NUCLEIC_FORM_COLORS = {
  'a-dna': 0x2f7fd0, 'b-dna': 0x35b85f, 'z-dna': 0xc0304f,
  'a-rna': 0xf0a020, 'loop-rna': 0x9a5fd0, 'z-rna': 0xff5fa8,
};
const nucleicFormColorStore = { ...DEFAULT_NUCLEIC_FORM_COLORS };
const nucleicFormColorOf = (form) => {
  const v = nucleicFormColorStore[form];
  return Number.isFinite(v) ? v : DEFAULT_ELEMENT_COLOR;
};
let nucleicFormSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme (named so a test can extract and really run it).
const defineNucleicFormScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      const info = atom && atom.structure ? nucleicClassFor(atom.structure) : null;
      const form = info && atom.residueIndex != null ? info.formByResidue.get(atom.residueIndex) : null;
      return nucleicFormColorOf(form);
    };
  };
};
const registerNucleicFormScheme = (NGL) => {
  if (nucleicFormSchemeKey) return;
  nucleicFormSchemeKey = registerColorScheme(NGL, 'lab-nuc-form', defineNucleicFormScheme());
};

/* ---- Nucleic-acid MOTIF colours (G-quadruplex · hairpin) ---------------------
   The two motifs of PART 3.2 are painted with ONE high-contrast colour each, and
   EVERY other nucleotide keeps the 2°-structure colour it would have had
   (sstrucAtomColorOf — the rule of lab-sstruc). That is the point: a quadruplex or
   a hairpin must stand out against the double helices and the single strands
   around it instead of hiding inside a flat colour. The motifs ARE the « 2°
   structure » of a nucleic acid — the category the 🎨 panel of menu B never had,
   because helix / sheet / loop is a protein notion. */
const DEFAULT_NUCLEIC_MOTIF_COLORS = { gquad: 0xff3ec8, hairpin: 0x00d1b2 };
const nucleicMotifColorStore = { ...DEFAULT_NUCLEIC_MOTIF_COLORS };
// null = « this nucleotide is in no motif » → the caller keeps the 2° structure.
const nucleicMotifColorOf = (motif) => {
  const v = nucleicMotifColorStore[motif];
  return Number.isFinite(v) ? v : null;
};
let nucleicMotifSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme (named so a test can extract and really run it).
const defineNucleicMotifScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      const info = atom && atom.structure ? nucleicClassFor(atom.structure) : null;
      const motif = info && atom.residueIndex != null ? info.motifByResidue.get(atom.residueIndex) : null;
      const c = nucleicMotifColorOf(motif);
      if (c != null) return c;
      return sstrucAtomColorOf(atom && atom.sstruc);
    };
  };
};
const registerNucleicMotifScheme = (NGL) => {
  if (nucleicMotifSchemeKey) return;
  nucleicMotifSchemeKey = registerColorScheme(NGL, 'lab-nuc-motif', defineNucleicMotifScheme());
};

/* ---- The two palettes the ⚙ settings wheel edits, PERSISTED -----------------
   The element / sugar tables are the working state of the wheel, so they are
   written to localStorage like every other viewer preference (Fog / Shadows /
   clipping / the six menus): reopening the page must not lose a palette the user
   has tuned. A stored entry is only accepted for a KNOWN key and a finite colour,
   so a hand-edited localStorage value can never add an element or a sugar that the
   schemes do not read, and can never turn an atom black by accident. */
const ELEMENT_COLORS_KEY = 'labViewerElementColors';
const SUGAR_COLORS_KEY = 'labViewerSugarColors';
// The two palette entries of the NUCLEIC reading of PART 3 travel the same way:
// the six form colours (A · B · Z DNA, A · flexible · Z RNA) and the two motif
// colours (G-quadruplex · hairpin).
const NUCLEIC_FORM_COLORS_KEY = 'labViewerNucleicFormColors';
const NUCLEIC_MOTIF_COLORS_KEY = 'labViewerNucleicMotifColors';
// A stored / imported palette is merged over the defaults: only a KNOWN key with a
// FINITE colour is accepted, so a hand-edited localStorage entry (or a setup file
// written by another build) can neither add an element the schemes do not read nor
// turn an atom black by accident. ONE rule, used by the persistence AND by the ⚙️
// saved setups.
const mergePalette = (defaults, raw) => {
  const out = { ...defaults };
  if (raw && typeof raw === 'object') {
    Object.keys(defaults).forEach((k) => {
      const v = raw[k];
      if (Number.isFinite(v)) out[k] = v;
    });
  }
  return out;
};
const loadPalette = (key, defaults) => {
  try {
    return mergePalette(defaults, JSON.parse(localStorage.getItem(key) || 'null'));
  } catch { /* unreadable entry → the defaults */ }
  return { ...defaults };
};
const savePalette = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
};

/* ---- Which NGL colour SCHEME a per-molecule « Colour by » choice is ---------
   The Molecules bar offers the NGL metaphors (chain / residue / hydrophobicity)
   plus the HOUSE ones, and they all have to survive a scheme that could not be
   registered (registerColorScheme returns null then): 'sstruc' keeps the ☽☰Ⰶ
   scheme of the 🎨 panel, 'element' the CUSTOMISABLE element table of the ⚙ wheel
   (lab-elements), 'sugar' the per-sugar identity table (lab-sugar-identity), and
   'glycan' · 'nucform' · 'motif' · 'lipidclass' the four readings PART 2 / PART 3
   added (the linked-sugar entities, the A · B · Z · A-RNA forms, the G-quadruplex
   and hairpin motifs, the phospholipid headgroup classes) — each falling back on
   the closest NGL native scheme, so a molecule is never drawn with no colour at
   all. ONE mapping, called by the main structure and by every loaded molecule. */
const schemeForColorMode = (mode) => {
  if (mode === 'sstruc') return sstrucSchemeKey || 'sstruc';
  if (mode === 'element') return elementSchemeKey || 'element';
  if (mode === 'sugar') return sugarSchemeKey || 'element';
  if (mode === 'glycan') return glycanSchemeKey || 'element';
  if (mode === 'lipidclass') return lipidClassSchemeKey || 'element';
  // The two house palettes a per-molecule colouring can also ask for: the twenty
  // amino acids and the five DNA/RNA bases (their schemes fall back on the native
  // « resname » colouring, so a molecule is never left without a colour).
  if (mode === 'residue') return residueSchemeKey || 'resname';
  if (mode === 'basetype') return baseTypeSchemeKey || 'resname';
  // The two nucleic readings fall back on the 2°-structure colours, never on a
  // flat element colour: a conformation or a motif is a STRUCTURAL notion.
  if (mode === 'nucform') return nucleicFormSchemeKey || sstrucSchemeKey || 'sstruc';
  if (mode === 'motif') return nucleicMotifSchemeKey || sstrucSchemeKey || 'sstruc';
  return mode;
};

/* ══ PART 4 · THE STYLING SECTIONS OF THE MOLECULE BAR ════════════════════════
   The styling of the viewer is not a set of six GLOBAL menus any more: it is ONE
   SECTION PER MOLECULE, and every section carries the sub-sections its KIND of
   molecule owns —

     • protein        → general · backbone · side chains
     • nucleic acid   → general · backbone · DNA/RNA bases · DNA/RNA ribose
     • lipid          → general · phospholipid headgroups · acyl chains · glycerol
     • sugar          → one row (the whole molecule)
     • ligand         → one row
     • water          → one row
     • ion            → one row

   — and each row offers the SAME three commands: a STYLE, a « Color by » and a
   TRANSPARENCY regulator, plus the sphere / bond radii, the 3D labels and the
   renumbering tool the old §2 menus held (nothing is lost, it moved here).

   The styles are the request's vocabulary, mapped on what NGL 2.4 really draws
   (verified in the installed build): « balls and sticks » = ball+stick,
   « liquorice » = licorice (NGL registers no `stick`), « lines » = line,
   « CPK » = spacefill (NGL has no `CPK` representation), « surface » / « mesh
   surface » = surface (av / wireframe), « phosphate trace » = trace,
   « slabs » = the `base` rungs, « stylized rings (filled plates) » and « ring
   plates » = the viewer's own filled MeshBuffer plates (nucleicRingPlates),
   « sphere » (an ion) = spacefill, and « hide » drops the row's representations
   (NGL has no `hide` representation either).

   THE HIERARCHY (the rule of the request): a field set on GENERAL is handed to
   every sub-section of that kind AND makes them FOLLOW it again — General
   overrides / resets the sub-categories — while a field set on ONE sub-section
   only deviates that sub-section from then on (`follow`), and never touches
   General. A value General hands down that a sub-section cannot draw (a
   `surface` style, or « electrostatic potential » on side chains) falls back on
   that sub-section's own default, so the general look can never BREAK a
   sub-category — it can only be narrowed by it.

   All of it is PERSISTED (localStorage, like every other viewer preference), so
   the dropdowns show, after a reload, exactly the look the last session left. */
// The seven kinds of molecule the bar knows, in the order the sections appear.
const MOL_KINDS = ['protein', 'nucleic', 'lipid', 'sugar', 'ligand', 'water', 'ion'];
// The word printed next to the molecule's name in its section header (the request:
// « in the space where you put the molecule classify it as … »).
const MOL_KIND_LABELS = {
  protein: 'protein', nucleic: 'nucleic acid', lipid: 'lipid', sugar: 'sugar',
  ligand: 'ligand', water: 'water', ion: 'ion',
};
// The old CATEGORY of each kind — its flat « Solid » colour, its palettes and its
// 2°-structure colours all come from there, so nothing had to be duplicated.
const KIND_CATEGORY = {
  protein: 'protein', nucleic: 'nucleic', lipid: 'lipid', sugar: 'sugar',
  ligand: 'organic', water: 'other', ion: 'other',
};
// Water and ions are DRAWN OFF when a structure loads: a solvated box or a
// membrane would otherwise block the view (the request). Every other kind is drawn
// at once, and the section's ✔ brings water / ions back.
const KIND_VISIBLE_BY_DEFAULT = {
  protein: true, nucleic: true, lipid: true, sugar: true, ligand: true, water: false, ion: false,
};

// ---- The STYLE vocabulary (the request's wording, NGL's tokens) --------------
const STYLE_LABELS = {
  hide: 'Hide',
  cartoon: 'Cartoon',
  ribbon: 'Ribbon',
  tube: 'Tube',
  trace: 'Phosphate trace (P)',
  'ball+stick': 'Balls and sticks',
  licorice: 'Liquorice',
  line: 'Lines',
  spacefill: 'CPK',
  surface: 'Surface',
  mesh: 'Mesh surface',
  base: 'Slabs',
  rings: 'Stylized rings (filled plates)',
  plates: 'Ring plates',
};
// An ion's spacefill IS its sphere (the request lists « hide, sphere » there).
const styleLabelFor = (kind, token) => (kind === 'ion' && token === 'spacefill' ? 'Sphere' : (STYLE_LABELS[token] || token));
// ---- The « Color by » vocabulary (the request's wording) ---------------------
const COLOR_LABELS = {
  solid: 'Solid',
  element: 'Atom type',
  chain: 'Chain',
  residue: 'Amino acid (residue)',
  sstruc: 'Secondary structure',
  basetype: 'DNA/RNA base',
  nucform: 'RNA/DNA conformation',
  lipidtype: 'Lipid type',
  sugar: 'Sugar type',
  hydrophobicity: 'Hydrophobicity',
  esp: 'Electrostatic potential (only surfaces)',
  gradient: 'Gradient (first → last)',
  rainbow: 'Rainbow (first → last)',
  charge: 'Charge',
};
// The style sets of the request, named after the rows that are allowed to use them.
const STYLES = {
  polymer: ['hide', 'cartoon', 'ribbon', 'tube', 'ball+stick', 'licorice', 'line', 'spacefill'],
  protein: ['hide', 'cartoon', 'ribbon', 'tube', 'ball+stick', 'licorice', 'line', 'spacefill', 'surface', 'mesh'],
  nucleic: ['hide', 'cartoon', 'ribbon', 'tube', 'trace', 'ball+stick', 'licorice', 'line', 'spacefill', 'surface', 'mesh'],
  bases: ['hide', 'base', 'rings', 'ball+stick', 'licorice', 'line', 'spacefill'],
  ribose: ['hide', 'base', 'plates', 'ball+stick', 'licorice', 'line', 'spacefill'],
  sidechains: ['hide', 'ball+stick', 'licorice', 'line', 'spacefill'],
  small: ['hide', 'ball+stick', 'licorice', 'line', 'spacefill', 'surface', 'mesh'],
  ion: ['hide', 'spacefill'],
};
// The styles that DRAW ONE SPHERE / STICK PER ATOM — and therefore need BOTH atoms
// of a bond inside their own selection (see the side-chain ANCHOR of
// buildSectionReps). A ribbon / cartoon / tube / trace walks the polymer itself and
// has no such requirement, so it is not in this list.
const ATOM_DRAW_STYLES = ['ball+stick', 'licorice', 'line', 'spacefill'];
// The « Color by » sets, one per row of the request. NOTE: « Lipid type » is NOT
// offered on water (the request corrected exactly that), and « Charge » exists for
// ions alone — it is what tells a Na⁺ from a Cl⁻ in the same solvent.
const COLORS = {
  protein: ['solid', 'element', 'chain', 'residue', 'sstruc', 'hydrophobicity', 'esp', 'gradient', 'rainbow'],
  proteinBackbone: ['solid', 'element', 'chain', 'residue', 'sstruc'],
  proteinSide: ['solid', 'element', 'chain', 'residue'],
  nucleic: ['solid', 'element', 'chain', 'basetype', 'nucform', 'hydrophobicity', 'esp', 'gradient', 'rainbow'],
  nucleicBackbone: ['solid', 'element', 'chain', 'basetype', 'nucform'],
  nucleicParts: ['solid', 'element', 'chain', 'basetype'],
  lipid: ['solid', 'element', 'chain', 'lipidtype', 'hydrophobicity', 'esp'],
  lipidParts: ['solid', 'element', 'lipidtype'],
  sugar: ['solid', 'element', 'chain', 'sugar', 'hydrophobicity', 'esp'],
  // A LIGAND is not a sugar: offering « Sugar type » on its row was a copy of the
  // sugar list (the report: « in the ligand menu there is color by sugar type
  // (should not be there) ») — the per-sugar identity palette only says something
  // where sugars are drawn, and the Sugars menu is the one that draws them.
  ligand: ['solid', 'element', 'chain', 'hydrophobicity', 'esp'],
  water: ['solid', 'element', 'hydrophobicity', 'esp'],
  ion: ['solid', 'element', 'charge'],
};

/* ---- The SUB-SECTIONS of every kind ----------------------------------------
   `sele` is the NGL selector of the sub-section INSIDE one molecule ('' = the
   whole molecule); the renderer prefixes it with the molecule's own selector, so
   one builder serves the main file, an extra file, a chain and a residue group.
   `def` is the DEFAULT look the request asks for: proteins cartoon (secondary
   structure), DNA cartoon + stylized rings for the bases, balls and sticks for
   the lipids, the sugars and the ligands. */
const SECTION_SUBSECTIONS = {
  protein: [
    { sub: 'general', label: 'General', styles: STYLES.protein, colors: COLORS.protein, def: { style: 'cartoon', colorBy: 'sstruc' }, sele: '' },
    { sub: 'backbone', label: 'Backbone', styles: STYLES.polymer, colors: COLORS.proteinBackbone, def: { style: 'cartoon', colorBy: 'sstruc' }, sele: 'backbone' },
    { sub: 'sidechain', label: 'Side chains', styles: STYLES.sidechains, colors: COLORS.proteinSide, def: { style: 'licorice', colorBy: 'element' }, sele: 'sidechain' },
  ],
  nucleic: [
    { sub: 'general', label: 'General', styles: STYLES.nucleic, colors: COLORS.nucleic, def: { style: 'cartoon', colorBy: 'basetype' }, sele: '' },
    { sub: 'backbone', label: 'Backbone', styles: STYLES.polymer, colors: COLORS.nucleicBackbone, def: { style: 'cartoon', colorBy: 'basetype' }, sele: 'backbone' },
    { sub: 'bases', label: 'DNA/RNA bases', styles: STYLES.bases, colors: COLORS.nucleicParts, def: { style: 'rings', colorBy: 'basetype' }, sele: 'bases' },
    { sub: 'ribose', label: 'DNA/RNA ribose', styles: STYLES.ribose, colors: COLORS.nucleicParts, def: { style: 'plates', colorBy: 'basetype' }, sele: 'ribose' },
  ],
  lipid: [
    { sub: 'general', label: 'General', styles: STYLES.small, colors: COLORS.lipid, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: '' },
    { sub: 'head', label: 'Phospholipid headgroups', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'head' },
    { sub: 'tail', label: 'Acyl chains', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'tail' },
    { sub: 'glycerol', label: 'Glycerol', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'glycerol' },
  ],
  sugar: [{ sub: 'general', label: 'Sugar', styles: STYLES.small, colors: COLORS.sugar, def: { style: 'ball+stick', colorBy: 'element' }, sele: '' }],
  ligand: [{ sub: 'general', label: 'Ligand', styles: STYLES.small, colors: COLORS.ligand, def: { style: 'ball+stick', colorBy: 'element' }, sele: '' }],
  water: [{ sub: 'general', label: 'Water', styles: STYLES.small, colors: COLORS.water, def: { style: 'ball+stick', colorBy: 'element' }, sele: '' }],
  ion: [{ sub: 'general', label: 'Ion', styles: STYLES.ion, colors: COLORS.ion, def: { style: 'spacefill', colorBy: 'element' }, sele: '' }],
};
const subsectionsOf = (kind) => SECTION_SUBSECTIONS[kind] || SECTION_SUBSECTIONS.ligand;
const subsectionSpec = (kind, sub) => subsectionsOf(kind).find((s) => s.sub === sub) || subsectionsOf(kind)[0];

/* ---- The LOOK of one row ---------------------------------------------------
   `style` and `colorBy` are the two dropdowns, `solidColor` the swatch « Solid »
   shows, `opacity` the transparency regulator (0 = opaque, 1 = invisible),
   `sphere` / `bond` the two radius multipliers (1 = the style's own NGL size) and
   `follow` says whether General still hands the look down (the hierarchy). */
const SECTION_LOOK_FIELDS = ['style', 'colorBy', 'solidColor', 'opacity', 'sphere', 'bond'];
const FOLLOW_FIELDS = ['style', 'colorBy', 'opacity', 'sphere', 'bond'];
const defaultLookOf = (kind, sub) => {
  const spec = subsectionSpec(kind, sub);
  return {
    style: spec.def.style,
    colorBy: spec.def.colorBy,
    solidColor: DEFAULT_ATOM_COLORS[KIND_CATEGORY[kind]] || DEFAULT_ELEMENT_COLOR,
    opacity: 0,
    sphere: 1,
    bond: 1,
    follow: sub !== 'general',
  };
};
// Every default look of every kind — the shape the whole bar works on.
const defaultSectionLooks = () => {
  const out = {};
  MOL_KINDS.forEach((k) => {
    out[k] = {};
    subsectionsOf(k).forEach((s) => { out[k][s.sub] = defaultLookOf(k, s.sub); });
  });
  return out;
};

/* ---- PERSISTENCE (localStorage, exactly like the palettes) ------------------
   A stored entry is only accepted for a KNOWN kind / row / field and for a VALID
   value (a style and a colouring that row really offers, a finite colour, an
   opacity in 0 → 1, a radius in RADIUS_MIN → RADIUS_MAX), so a hand-edited
   localStorage value can never draw a style a row does not have. */
const SECTION_STYLES_KEY = 'labViewerSectionStyles';
const mergeSectionLooks = (defaults, raw) => {
  const out = defaults;
  if (!raw || typeof raw !== 'object') return out;
  MOL_KINDS.forEach((k) => {
    const src = raw[k];
    if (!src || typeof src !== 'object') return;
    subsectionsOf(k).forEach((s) => {
      const entry = src[s.sub];
      if (!entry || typeof entry !== 'object') return;
      const spec = subsectionSpec(k, s.sub);
      const dst = out[k][s.sub];
      if (spec.styles.includes(entry.style)) dst.style = entry.style;
      if (spec.colors.includes(entry.colorBy)) dst.colorBy = entry.colorBy;
      if (Number.isFinite(entry.solidColor)) dst.solidColor = entry.solidColor;
      if (Number.isFinite(entry.opacity)) dst.opacity = Math.min(1, Math.max(0, entry.opacity));
      if (Number.isFinite(entry.sphere)) dst.sphere = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, entry.sphere));
      if (Number.isFinite(entry.bond)) dst.bond = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, entry.bond));
      if (typeof entry.follow === 'boolean') dst.follow = entry.follow;
    });
  });
  return out;
};
const loadSectionLooks = () => {
  try {
    return mergeSectionLooks(defaultSectionLooks(), JSON.parse(localStorage.getItem(SECTION_STYLES_KEY) || 'null'));
  } catch { return defaultSectionLooks(); }
};
const saveSectionLooks = (v) => {
  try { localStorage.setItem(SECTION_STYLES_KEY, JSON.stringify(v)); } catch { /* ignore */ }
};
// ONE string that changes whenever ANY look changes — what the renderer compares to
// decide whether the representations must be rebuilt.
const sectionLooksSig = (v) => JSON.stringify(MOL_KINDS.map((k) => [k, v && v[k]]));

/* ---- THE THREE MOVES OF THE HIERARCHY (pure functions) ----------------------
   They are the whole of the General ⇄ sub-category rule, and they are pure, so a
   test can run them on a plain object:
     1. `setGeneralSectionField` — a field set on GENERAL is handed to EVERY row of
        that kind AND makes them follow again (the request's « it should override
        or reset the specific sub-categories »);
     2. `setRowSectionField` — a field set on ONE row deviates that row alone
        (`follow` = false) and never touches General;
     3. `resetSectionRow` / `resetSectionKind` — the ↺ of a row / of a section.
   A value General hands down that a row cannot draw falls back on that row's own
   default (see effectiveSectionLook), so General can never break a sub-category.

   A STYLE OR A COLOURING CHOSEN ON GENERAL IS EXCLUSIVE (the request: « in
   phospholipids, proteins and nucleic acids when general (type or colouring) is
   changed the other molecule parts (backbone, side chain, bases, acyl chain,
   glycerol etc) must be on hide »): describing the WHOLE molecule with one style
   or one colouring and drawing the parts on top of it at the same time gives two
   drawings of the same atoms — the part would even keep the colouring
   « General » has just replaced. Every sub-part is therefore switched to
   « Hide », and it comes back by choosing a style on its OWN row (move 2), which
   is exactly what « deviating from General » means. A hidden part also stops
   FOLLOWING General (`follow: false`), because a row that follows would simply be
   re-drawn with General's style — the hide would last one rebuild. */
const setGeneralSectionField = (looks, kind, field, value) => {
  const out = { ...looks, [kind]: { ...(looks[kind] || {}) } };
  out[kind].general = { ...defaultLookOf(kind, 'general'), ...(out[kind].general || null), [field]: value, follow: false };
  subsectionsOf(kind).forEach((s) => {
    if (s.sub === 'general') return;
    const next = { ...defaultLookOf(kind, s.sub), ...(out[kind][s.sub] || null), follow: true };
    // `follow: false` too: `effectiveSectionLook` hands General's style down to a row
    // that follows — so a hidden row would be RE-DRAWN with General's style the next
    // time it is asked what it really draws. Hiding a part means it stops following
    // until its own row is moved again (or its ↺ resets it), which is what makes
    // « one description of the molecule » hold.
    if (field === 'style' || field === 'colorBy') { next.style = 'hide'; next.follow = false; }
    else if (FOLLOW_FIELDS.includes(field)) next[field] = value;
    out[kind][s.sub] = next;
  });
  return out;
};
const setRowSectionField = (looks, kind, sub, field, value) => {
  if (sub === 'general') return setGeneralSectionField(looks, kind, field, value);
  const spec = subsectionSpec(kind, sub);
  const row = { ...defaultLookOf(kind, sub), ...((looks[kind] || {})[sub] || null), [field]: value };
  if (field === 'style' && !spec.styles.includes(value)) row.style = spec.def.style;
  if (field === 'colorBy' && !spec.colors.includes(value)) row.colorBy = spec.def.colorBy;
  if (FOLLOW_FIELDS.includes(field)) row.follow = false;
  return { ...looks, [kind]: { ...(looks[kind] || {}), [sub]: row } };
};
const resetSectionRow = (looks, kind, sub) => (
  { ...looks, [kind]: { ...(looks[kind] || {}), [sub]: defaultLookOf(kind, sub) } }
);
const resetSectionKind = (looks, kind) => ({
  ...looks,
  [kind]: Object.fromEntries(subsectionsOf(kind).map((s) => [s.sub, defaultLookOf(kind, s.sub)])),
});
// The tree of a NEW section: the persisted look of that kind (⚙ / last session)
// merged over the defaults — so a molecule loads with the look the user last chose.
const initialSectionTree = (kindLooks, kind) => {
  const tree = {};
  tree[kind] = {};
  subsectionsOf(kind).forEach((s) => {
    const saved = (kindLooks && kindLooks[kind] && kindLooks[kind][s.sub]) || null;
    tree[kind][s.sub] = { ...defaultLookOf(kind, s.sub), ...(saved || null), follow: s.sub !== 'general' ? (saved && typeof saved.follow === 'boolean' ? saved.follow : true) : false };
  });
  return tree;
};

/* ---- WHAT ONE ROW REALLY DRAWS ---------------------------------------------
   `general` keeps its own look. Every other row follows General for the fields it
   still follows, and falls back on its own default when General hands down a style
   or a colouring that row does not own. The result is ALWAYS a valid look for the
   row, which is what makes the dropdowns able to show the rendered state. */
const effectiveSectionLook = (looks, kind, sub) => {
  const spec = subsectionSpec(kind, sub);
  const own = { ...defaultLookOf(kind, sub), ...((looks && looks[kind] && looks[kind][sub]) || null) };
  if (sub === 'general' || own.follow !== true) {
    if (!spec.styles.includes(own.style)) own.style = spec.def.style;
    if (!spec.colors.includes(own.colorBy)) own.colorBy = spec.def.colorBy;
    return own;
  }
  const g = { ...defaultLookOf(kind, 'general'), ...((looks && looks[kind] && looks[kind].general) || null) };
  return {
    ...own,
    style: spec.styles.includes(g.style) ? g.style : spec.def.style,
    colorBy: spec.colors.includes(g.colorBy) ? g.colorBy : spec.def.colorBy,
    opacity: g.opacity,
    sphere: g.sphere,
    bond: g.bond,
    follow: true,
  };
};
// Whether a row still follows General — what the « ← General » badge of the row
// says, and what tells the user a value came down from above.
const rowFollowsGeneral = (looks, kind, sub) => (
  sub !== 'general' && ((looks && looks[kind] && looks[kind][sub] && looks[kind][sub].follow) !== false)
);

/* ---- GENERAL look ⇄ per-category look (the override hierarchy) ---------------
   The six menus of §2 share a GENERAL look — atom colour, sphere / bond radius,
   surface colour — and every one of them may OVERRIDE any of those fields. The
   rule is one line per field, implemented ONCE here and used by the six menus, by
   the ↺ of a field and by the ⚙ settings wheel:

     • a field a menu Follows has no life of its own: the general value is written
       into that menu, so the renderer keeps reading catStyles[cat] and NOTHING
       resolves anything at render time;
     • a field the user changed IN A MENU is overridden there: it keeps its value
       when the general look moves, and the small ↺ next to it hands it back;
     • ↺ Reset radii & colours of a menu = « follow the general look again » for
       every field of that menu.

   The FIRST state keeps today's look exactly: the per-category flat colour is the
   menu's own (that is the colour the menus have always proposed for « Custom… »,
   see DEFAULT_ATOM_COLORS) while every other field follows the general look, whose
   defaults are the values the menus already start with. A value found in a saved
   localStorage entry counts as an override too, so an existing user's menus never
   move under their feet. */
const GENERAL_LOOK_KEY = 'labViewerGeneralLook';
const DEFAULT_LOOK_OVERRIDES = { atomColorHex: true };
const DEFAULT_GENERAL_LOOK = {
  atomColor: 'default',
  atomColorHex: DEFAULT_SURFACE_COLOR,
  surfaceColor: 'default',
  surfaceColorHex: DEFAULT_SURFACE_COLOR,
  sphereRadius: 1,
  bondRadius: 1,
  gradientFrom: DEFAULT_GRADIENT_COLORS.from,
  gradientTo: DEFAULT_GRADIENT_COLORS.to,
};
// Every field the general row (and the ⚙ wheel) owns — the ones a menu can inherit.
const LOOK_KEYS = ['atomColor', 'atomColorHex', 'surfaceColor', 'surfaceColorHex', 'sphereRadius', 'bondRadius', 'gradientFrom', 'gradientTo'];
const isLookKey = (key) => LOOK_KEYS.includes(key);
// Does ONE menu OVERRIDE that field, or does it follow the general look? An entry
// without an `ovr` flag (the built-in defaults, or a file written by an older
// build) falls back on DEFAULT_LOOK_OVERRIDES.
const overridesLook = (catEntry, key) => {
  const ovr = (catEntry && catEntry.ovr) || DEFAULT_LOOK_OVERRIDES;
  return !!ovr[key];
};
// The general look as it is really applied: the stored values over the defaults.
const loadGeneralLook = () => {
  const out = { ...DEFAULT_GENERAL_LOOK };
  try {
    const raw = JSON.parse(localStorage.getItem(GENERAL_LOOK_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      LOOK_KEYS.forEach((k) => {
        const v = raw[k];
        if (typeof v === 'string' || Number.isFinite(v)) out[k] = v;
      });
    }
  } catch { /* the defaults */ }
  return out;
};

/* ---- The three moves of the hierarchy, as PURE functions --------------------
   They are the whole of it: the menus, the general row, the ⚙ wheel and the ↺s all
   go through them, and a test can run them for real on a plain object. */

// 1. ONE general field → every menu that Follows it (an override keeps its value).
const applyGeneralField = (catStyles, key, value) => {
  const out = { ...catStyles };
  CAT_STYLE_CATS.forEach((c) => {
    const cur = out[c] || {};
    if (overridesLook(cur, key)) return;   // that menu keeps its own value
    out[c] = { ...cur, [key]: value };
  });
  return out;
};

// 5. ONE end of the gradient ramp → EVERY menu, override or NOT. The ramp is a
//    SINGLE NGL scheme shared by the whole viewer (see gradientColorStore), so the
//    two swatches of the ⚙ wheel (and of the styling bar) must never be blocked by
//    a per-menu override: an `ovr.gradientFrom` left behind by the old §2 menu made
//    the swatches change nothing at all — the report « it is impossible to change
//    the colors of first and last ».
const setGradientPairIn = (catStyles, key, hex) => {
  const out = { ...catStyles };
  CAT_STYLE_CATS.forEach((c) => { out[c] = { ...(out[c] || {}), [key]: hex }; });
  return out;
};

// 2. ONE field of ONE menu → back to the general look (the override is dropped, so
//    the next general change reaches it again).
const yieldLookField = (catStyles, cat, key, generalValue) => {
  const cur = catStyles[cat] || {};
  const ovr = { ...(cur.ovr || DEFAULT_LOOK_OVERRIDES) };
  delete ovr[key];
  return { ...catStyles, [cat]: { ...cur, [key]: generalValue, ovr } };
};

// 3. The WHOLE general look → ONE menu (its ↺ Reset radii & colours): every look
//    field takes the general value and follows it from now on.
const adoptGeneralLook = (catStyles, cat, generalLook) => {
  const entry = { ...(catStyles[cat] || {}), ovr: {} };
  LOOK_KEYS.forEach((k) => { entry[k] = generalLook[k]; });
  return { ...catStyles, [cat]: entry };
};

// 4. The general look back to its DEFAULTS (the ↺ of the general row / the wheel):
//    the fields that follow take the default again, the overrides stay untouched.
const defaultGeneralLookIn = (catStyles) => {
  let out = catStyles;
  LOOK_KEYS.forEach((k) => { out = applyGeneralField(out, k, DEFAULT_GENERAL_LOOK[k]); });
  return out;
};

// ---- A flat colour, as NGL wants it (a hex integer) -------------------------
// ONE reader of « Atom colour : Custom… » — used by every menu and by the
// side-chain effect, so a menu can never be DRAWN with one rule and COLOURED
// with another.
const flatHex = (v) => (Number.isFinite(v) ? v : null);

/* ---- « Atom colour » of ONE menu, for a RIBBON or for ATOMS / BONDS ---------
   Every styling menu offers the same four colouring metaphors, and BOTH families
   of representations obey them — a ribbon (cartoon / ribbon / tube / trace) AND
   the atoms / bonds (ball+stick · licorice · lines · spheres):

     'default'  → the classic look: element colours for the atoms, the rainbow by
                  residue index for the ribbon of a polymer;
     'custom'   → ONE flat colour (the swatch);
     'sstruc'   → the customisable helix / sheet / coil colours (0edf7a, the 🎨
                  panel of menu A), which therefore reach the RIBBON too;
     'gradient' → the two-colour ramp N → C (protein) / 5' → 3' (nucleic acid).

   A scheme that could not be registered returns nothing usable (null id) and the
   caller falls back on the classic look instead of drawing nothing at all.
   `kind` is 'backbone' for the ribbon family, 'atom' for everything else. */
const catColorParams = (m, kind) => {
  const mode = (m && m.atomColor) || 'default';
  if (mode === 'sstruc' && sstrucSchemeKey) return { color: sstrucSchemeKey };
  if (mode === 'gradient' && gradientSchemeKey) return { color: gradientSchemeKey };
  // The palette colourings the ⚙ wheel and PART 2 / PART 3 feed. They all FALL
  // THROUGH when their scheme could not be registered, so the menu keeps the
  // classic element colours (a colouring that failed to register must never draw
  // nothing); the two nucleic ones land on the 2°-structure colours instead,
  // because a conformation / a motif is a structural notion and not an element.
  if (mode === 'element' && elementSchemeKey) return { color: elementSchemeKey };
  // « Chain » — the same EDITABLE palette as the styling-bar rows (lab-chain).
  if (mode === 'chain' && chainSchemeKey) return { color: chainSchemeKey };
  // The two palettes of the request that the menus' « Atom colour » used to be
  // missing: the 20 AMINO ACIDS (lab-residue, the ⚙ palette of « Color by :
  // Amino acid (residue) ») and the five DNA/RNA BASES (lab-base-type, « Color by :
  // DNA/RNA base »). A nucleic residue falls back on its own base inside
  // residueColorOf, so the two readings can never disagree.
  if (mode === 'residue' && residueSchemeKey) return { color: residueSchemeKey };
  if (mode === 'basetype' && baseTypeSchemeKey) return { color: baseTypeSchemeKey };
  if (mode === 'sugar' && sugarSchemeKey) return { color: sugarSchemeKey };
  if (mode === 'glycan' && glycanSchemeKey) return { color: glycanSchemeKey };
  if (mode === 'lipidclass' && lipidClassSchemeKey) return { color: lipidClassSchemeKey };
  if (mode === 'nucform') {
    if (nucleicFormSchemeKey) return { color: nucleicFormSchemeKey };
    if (sstrucSchemeKey) return { color: sstrucSchemeKey };
  }
  if (mode === 'motif') {
    if (nucleicMotifSchemeKey) return { color: nucleicMotifSchemeKey };
    if (sstrucSchemeKey) return { color: sstrucSchemeKey };
  }
  const hex = mode === 'custom' ? flatHex(m && m.atomColorHex) : null;
  if (kind === 'backbone') return hex != null ? { color: hex } : { color: 'residueindex' };
  return hex != null ? { color: hex } : { colorScheme: 'element' };
};

/* ---- Gradual (two-colour) colouring of a polymer ---------------------------
   « Atom colour → Gradient » paints a polymer ALONG its sequence: the first
   colour sits on the first residue — the N terminus of a protein, the 5' end of
   a nucleic acid — and the second on the last one (C terminus / 3' end). The ramp
   is computed PER CHAIN, so every chain of an oligomer runs its own complete
   gradient from its own N to its own C instead of sharing one ramp across the
   whole assembly. The scheme reads this live store (fed by the menu, like
   lab-sstruc / lab-nucleic-groups / lab-lipid-groups): moving a swatch only
   re-renders the representations, no scheme is ever re-registered. The per-chain
   residue ranges are measured on the structure that is actually drawn (see
   gradientRangesFor) — a scheme cannot know what a selection contains. */
const gradientColorStore = {
  from: DEFAULT_GRADIENT_COLORS.from,
  to: DEFAULT_GRADIENT_COLORS.to,
  ranges: null,   // { [chainIndex]: [firstResidueIndex, lastResidueIndex], all: […] }
  // …AND THE RANGES OF EVERY STRUCTURE. `ranges` alone is the ranges of whichever
  // molecule was measured LAST — the store is shared by the whole viewer, so two
  // loaded molecules overwrote each other's ramp and the first one fell flat (the
  // report « the color by gradient does not seem to work in some cases »). The
  // scheme resolves the ranges of the atom's OWN structure from here, and `ranges`
  // stays what a plain test object (no `.structure`) reads.
  byStructure: new WeakMap(),
};
let gradientSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// One colour of the ramp: t = 0 → `from`, t = 1 → `to` (t clamped). PURE, so a
// test can run the very ramp the scheme hands to NGL.
const lerpHexColors = (from, to, t) => {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const ch = (shift) => Math.round((((a >> shift) & 255) * (1 - k)) + (((b >> shift) & 255) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
// The ramp position (0 → 1) of ONE atom inside its own chain. An atom whose chain
// is not in the table (or a chain of one residue, which cannot ramp) takes the
// FIRST colour rather than a random one, and an atom outside the measured range is
// clamped — the colour it produces is therefore always inside the ramp.
const gradientT = (atom) => {
  // The ranges of the atom's OWN structure when the atom carries one (a real NGL
  // AtomProxy does: `atom.structure`) — see gradientColorStore.byStructure.
  const byStructure = gradientColorStore.byStructure;
  const own = byStructure && atom && atom.structure ? byStructure.get(atom.structure) : null;
  const ranges = own || gradientColorStore.ranges;
  const range = ranges && (ranges[atom && atom.chainIndex] || ranges.all);
  const ri = Number(atom && atom.residueIndex);
  if (!range || !Number.isFinite(ri) || !(range[1] > range[0])) return 0;
  return Math.min(1, Math.max(0, (ri - range[0]) / (range[1] - range[0])));
};
// The definition of the scheme, NAMED so a test can extract and really run it.
const defineGradientScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      return lerpHexColors(gradientColorStore.from, gradientColorStore.to, gradientT(atom));
    };
  };
};
const registerGradientScheme = (NGL) => {
  if (gradientSchemeKey) return;
  gradientSchemeKey = registerColorScheme(NGL, 'lab-gradient', defineGradientScheme());
};

/* ══ PART 4.0 · THE ELECTROSTATIC POTENTIAL OF A LIGAND, TOO ══════════════════
   NGL's own `electrostatic` colormaker hands a charge to the atoms of a PROTEIN
   only: its `chargeForAtom` ends on `if (!a.isProtein()) return 0.0`. The surface
   of a docking pose, of a lipid or of a glycan therefore came out uniformly white
   — the report « the electrostatic potential is not calculated in the ligand ».
   The viewer cannot change that rule (it is inside the bundle), so it registers
   its OWN potential scheme, `lab-esp`, which computes exactly the same Coulomb sum
   (same 12 Å cutoff, same ×332 kcal·Å/mol·e), reads the same red → white → blue
   ramp and the same ± limits — but gives EVERY atom a charge:

     1. the FILE's own partial charge when it carries one (PQR · charged MOL2 /
        SDF — NGL keeps it in `atom.partialCharge`), and NGL's CHARMM-derived
        table for a protein, read from NGL's OWN instance so the protein map of
        the viewer does not move by a thousandth;
     2. an ESTIMATE for everything else, read from the ELEMENT alone — a ligand
        usually ships neither charges nor bonds (no CONECT in a PDB), so nothing
        else can be read. The estimate is the electronegativity difference to the
        carbon / hydrogen frame of an organic molecule, q = 0.35 × (2.50 − χ), the
        one constant being calibrated on the CHARMM values of the common groups
        (an alcohol oxygen −0.28, an amide hydrogen +0.26, a carbonyl oxygen
        −0.55). The charges of ONE residue are then shifted so the residue sums to
        zero — a ligand is not an ion;
     3. and for a SINGLE-ATOM residue a formal charge is the honest answer (Na⁺
        +1, Cl⁻ −1, Mg²⁺ +2 …), which is what makes the salt of a membrane system
        show its real pole.

   The estimate is APPROXIMATE — as approximate as NGL's own, which says so in its
   own source — but it is not zero: a red pole sits on every oxygen, a blue one on
   every sodium. A file that carries charges is never estimated. */
const ESP_MAX_RADIUS = 12;            // Å — the cutoff NGL's own scheme uses
const ESP_KCAL = 332;                 // e²/(Å·kcal/mol) — NGL's own conversion factor
const ESP_NEUTRAL_REFERENCE = 2.50;   // the carbon / hydrogen frame of an organic molecule
const ESP_CHARGE_PER_UNIT = 0.35;     // e per Pauling unit (see the calibration above)
// Pauling electronegativities. An element outside the table counts as neutral, so
// an exotic atom never paints a pole that is not there.
const ESP_ELECTRONEGATIVITY = {
  H: 2.20, C: 2.55, N: 3.04, O: 3.44, F: 3.98, P: 2.19, S: 2.58, Cl: 3.16,
  Br: 2.96, I: 2.66, Se: 2.55, B: 2.04, Si: 1.90, As: 2.18, Na: 0.93, K: 0.82,
  Li: 0.98, Rb: 0.82, Cs: 0.79, Mg: 1.31, Ca: 1.00, Sr: 0.95, Ba: 0.89,
  Zn: 1.65, Fe: 1.83, Mn: 1.55, Cu: 1.90, Co: 1.88, Ni: 1.91, Cd: 1.69, Hg: 2.00,
};
// The formal charge of a residue that IS one ion (the 3-letter names a .gro / a
// CHARMM topology uses, plus the bare element spellings).
const ESP_ION_CHARGES = {
  NA: 1, SOD: 1, K: 1, POT: 1, LI: 1, LIT: 1, RB: 1, CS: 1, CES: 1,
  MG: 2, CAL: 2, CA: 2, SR: 2, BA: 2, ZN: 2, MN: 2, FE: 2,
  CL: -1, CLA: -1, BR: -1, I: -1, IOD: -1, F: -1,
};
// The PARTIAL CHARGE of ONE hetero atom, from its element — PURE, so a test can run
// the very rule the scheme uses (and the ONE thing the viewer can honestly say
// about an atom whose bonds the file does not describe).
const espHeteroChargeOf = (element) => {
  const raw = String(element == null ? '' : element).trim();
  if (!raw) return 0;
  const cap = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
  const x = Number.isFinite(ESP_ELECTRONEGATIVITY[cap]) ? ESP_ELECTRONEGATIVITY[cap] : ESP_ELECTRONEGATIVITY[raw.toUpperCase()];
  if (!Number.isFinite(x)) return 0;
  return Math.max(-1, Math.min(1, ESP_CHARGE_PER_UNIT * (ESP_NEUTRAL_REFERENCE - x)));
};
// The charges of ONE structure — the file's / the protein's (NGL) + the estimate.
// Cached per structure: the walk is O(atoms) and a rebuild must never repeat it.
const espChargeCache = new WeakMap();
const espChargesFor = (structure) => {
  const hit = espChargeCache.get(structure);
  if (hit) return hit;
  const NG = typeof window !== 'undefined' ? window.NGL : null;
  if (!NG || !structure || typeof structure.eachAtom !== 'function') return null;
  // NGL's OWN instance first: its `charges` array already holds the file's partial
  // charges AND its CHARMM values for every protein atom, so the protein map of the
  // viewer is kept to the digit (its dummy amide hydrogens included).
  let base = null;
  try { base = NG.ColormakerRegistry.getScheme({ scheme: 'electrostatic', structure }); } catch { base = null; }
  if (!base || !base.charges) return null;
  const charges = new Float32Array(base.charges);
  // …then the atoms NGL left at zero that no file charge describes: the hetero
  // atoms. Two passes, because the estimate of ONE residue is shifted so that the
  // residue sums to zero (an ion is excepted — it keeps its formal charge).
  const own = [];          // [index, residueIndex | null (an ion), charge]
  const sum = new Map();
  const count = new Map();
  structure.eachAtom((a) => {
    const pc = a.partialCharge;
    if (pc !== null && pc !== undefined) return;               // the file's own charge
    if (a.isProtein && a.isProtein()) return;                  // NGL's CHARMM table
    const name = String(a.resname || '').trim().toUpperCase();
    const heavy = String(a.element || '').toUpperCase() !== 'H';
    const formal = heavy ? ESP_ION_CHARGES[name] : undefined;   // Na⁺ · Cl⁻ …
    if (Number.isFinite(formal)) { own.push([a.index, null, formal]); return; }
    const q = espHeteroChargeOf(a.element);
    own.push([a.index, a.residueIndex, q]);
    sum.set(a.residueIndex, (sum.get(a.residueIndex) || 0) + q);
    count.set(a.residueIndex, (count.get(a.residueIndex) || 0) + 1);
  });
  own.forEach(([index, resno, q]) => {
    charges[index] = resno === null ? q : q - (sum.get(resno) || 0) / Math.max(1, count.get(resno) || 1);
  });
  const out = { charges, base, hetero: own.length };
  espChargeCache.set(structure, out);
  return out;
};
let espSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme, NAMED so a test can extract and really run it: it
// is NGL's own positionColor — the same 12 Å Coulomb sum, the same scale — over the
// charge table above.
const defineEspScheme = () => {
  return function (params) {
    const NG = typeof window !== 'undefined' ? window.NGL : null;
    const P = this.parameters || params || {};
    // The ramp and the ± kcal/mol limits, however they arrive: a SURFACE passes them
    // as `scale` / `domain` (Buffer#getColorParams renames colorScale / colorDomain
    // on the way in), a direct getScheme call may pass the color* names — that one
    // wins when it is a real pair, because the base class has already filled `domain`
    // with its own [0, 1] default. 'uniform' — the base default scale — is NOT a
    // scale of this ramp (it paints no colour at all), so it falls back on the red →
    // white → blue one the ⚡ ESP button has always used.
    const domain = Array.isArray(P.colorDomain) && P.colorDomain.every((n) => Number.isFinite(n)) ? P.colorDomain
      : (Array.isArray(P.domain) && P.domain.every((n) => Number.isFinite(n)) ? P.domain : null);
    P.domain = domain || [-50, 50];
    P.scale = typeof P.scale === 'string' && P.scale && P.scale !== 'uniform' ? P.scale : 'rwb';
    const self = this;
    // The ramp is rebuilt whenever the limits or the scale change: NGL can re-apply a
    // `colorDomain` on a LIVE representation, and a scale captured once at
    // construction would keep painting the previous ramp — the ⚡ Range control must
    // always bite.
    let scale = null;
    let scaleKey = '';
    const scaleNow = () => {
      const key = `${P.scale}|${JSON.stringify(P.domain)}`;
      if (!scale || key !== scaleKey) {
        scaleKey = key;
        try { scale = typeof self.getScale === 'function' ? self.getScale() : null; } catch { scale = null; }
      }
      return scale;
    };
    // A colouring NEVER breaks a representation: a scale that cannot paint (an
    // impossible limit, a missing chroma) falls back on the neutral white.
    const ramp = (value) => {
      const sc = scaleNow();
      if (!sc) return 0xffffff;
      try {
        const c = sc(value);
        return Number.isFinite(c) ? c : 0xffffff;
      } catch { return 0xffffff; }
    };
    this.positionColor = () => 0xffffff;    // a structure-less / NGL-less call is white, never black
    // …and `atomColor` too: registerColorScheme INSTANTIATES the scheme once to
    // check that it can produce a colour, and NGL's registry refuses an id whose
    // scheme has no `atomColor` at all (the row would then draw nothing).
    this.atomColor = () => 0xffffff;
    const structure = P.structure;
    if (!NG || !structure) return;
    const data = espChargesFor(structure);
    if (!data) return;
    const charges = data.charges;
    let hash = null;
    try {
      const bbox = structure.getBoundingBox();
      bbox.expandByScalar(ESP_MAX_RADIUS);
      hash = new NG.SpatialHash(structure.atomStore, bbox);
    } catch { hash = null; }
    this.hash = hash;
    this.charges = charges;
    // The dummy N–H hydrogens NGL places on an amide nitrogen belong to the
    // protein's own map: they come from NGL's instance, so its potential is not
    // lost when the viewer paints the surface itself.
    const hHash = data.base.hHash || null;
    const hCharges = data.base.hCharges || [];
    this.positionColor = function (v) {
      let p = 0;
      // `dSq > 0`: a point exactly ON an atom centre would divide by zero (a real
      // surface vertex never is — it sits a vdW radius away — but the guard costs
      // nothing and keeps Infinity out of the colour ramp).
      if (hash) {
        hash.eachWithin(v.x, v.y, v.z, ESP_MAX_RADIUS, (i, dSq) => {
          const q = charges[i];
          if (q && dSq > 0) p += q / dSq;
        });
      }
      if (hHash) {
        hHash.eachWithin(v.x, v.y, v.z, ESP_MAX_RADIUS, (i, dSq) => {
          const q = hCharges[i];
          if (q && dSq > 0) p += q / dSq;
        });
      }
      return ramp(p * ESP_KCAL);
    };
    // …and the same charges colour the ATOMS / the ribbon of a « Surface colour :
    // ESP » row, so a ligand reads red on its oxygens in every style.
    this.atomColor = function (atom) {
      const q = atom && Number.isFinite(atom.index) ? charges[atom.index] : 0;
      return ramp((q || 0) * ESP_KCAL);
    };
  };
};
const registerEspScheme = (NGL) => {
  if (espSchemeKey) return;
  espSchemeKey = registerColorScheme(NGL, 'lab-esp', defineEspScheme());
};
// A real NGL.Selection for a selection string — the module-level twin of
// nglSelection (which lives inside the component). NGL 2.4 `Structure#getAtomSet`
// IGNORES a raw string (it returns the whole atom set): the callers below need a
// Selection INSTANCE. No NGL yet (or a bad expression) → undefined, which NGL
// reads as « every atom » and which never throws.
const toNglSelection = (sele) => {
  try {
    const NG = typeof window !== 'undefined' ? window.NGL : null;
    return NG && NG.Selection ? new NG.Selection(sele) : undefined;
  } catch { return undefined; }
};
// Per-chain residue ranges of ONE selection: what the ramp needs to put the first
// colour on the N / 5' end of EVERY chain. Returns null when nothing could be
// measured (no structure yet, a selection NGL refuses) — the caller then leaves
// the store empty and every atom takes the first colour, never a broken colour.
const gradientRangesFor = (structure, sele) => {
  if (!structure || !sele || typeof structure.eachAtom !== 'function') return null;
  const out = {};
  try {
    structure.eachAtom((a) => {
      const ri = Number(a && a.residueIndex);
      if (!Number.isFinite(ri)) return;
      const ci = (a && a.chainIndex) != null ? a.chainIndex : 'all';
      const cur = out[ci];
      if (!cur) out[ci] = [ri, ri];
      else { if (ri < cur[0]) cur[0] = ri; if (ri > cur[1]) cur[1] = ri; }
      const all = out.all;
      if (!all) out.all = [ri, ri];
      else { if (ri < all[0]) all[0] = ri; if (ri > all[1]) all[1] = ri; }
    }, toNglSelection(sele));
  } catch { return null; }
  return Object.keys(out).length ? out : null;
};

/* ---- FILLED RING PLATES — the stylized nucleic look -------------------------
   PyMOL's stylized DNA / RNA (set cartoon_ring_mode, 1 · cartoon_nucleic_acid_mode
   0 · cartoon_ring_color / cartoon_ring_transparency) draws the BASE RINGS as
   filled plates AND the ribose ring as a plate of its own. NGL has no such
   representation: its `base` representation is a Ball & Stick over the rung atoms
   (`getRungAtomData` / `getRungBondData`), i.e. sticks — which is exactly why
   « Stylized rings » looked like a bundle of sticks and not like plates. The
   viewer therefore builds the plates itself:

     · the rings are DISCOVERED on the bond graph of each chemical group of a
       nucleotide (the base ring system, the pentose ring) — a ring is a shortest
       cycle, and that cycle is returned IN RING ORDER, which is what a plate needs;
     · every ring is triangulated as a FAN from its centroid in the ring's own
       plane (bases and pentoses are planar to within a fraction of an Å, and the
       normal comes from Newell's method, so the plate is perfectly flat);
     · all the plates of ONE component go into ONE NGL MeshBuffer, handed to the
       structure component itself (addBufferRepresentation): the plates then follow
       its matrix (docking poses, extra molecules) and are removed with its other
       representations — nothing is ever left behind.
   Colour and transparency come from the 🎨 panel of the nucleic menu: the viewer's
   answer to cartoon_ring_color / cartoon_ring_transparency. */
const RING_MAX_SIZE = 6;   // the pyrimidine / imidazole six- and five-membered rings
// NGL buffer colours are RGB floats in 0 → 1 (the menus and the colour schemes use
// one hex integer).
const hexToRgb01 = (hex) => {
  const v = Number(hex) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
// The plane normal of a (near) planar ring — Newell's method, exact for a planar
// polygon and stable for a nearly planar one.
const ringPlaneNormal = (pts) => {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const len = Math.sqrt((nx * nx) + (ny * ny) + (nz * nz)) || 1;
  return [nx / len, ny / len, nz / len];
};
// Every ring of 3 → maxSize atoms of ONE bond graph, each one IN RING ORDER.
// `nodes` are the atoms of the ring's chemical group, `neighbours` its adjacency.
// The walk only ever moves to an atom HIGHER than the ring's first one, so a ring
// is met once per starting atom; the sorted key removes the two directions.
const ringCyclesOf = (nodes, neighbours, maxSize = RING_MAX_SIZE) => {
  const rings = new Map();
  const walk = (start, path) => {
    const last = path[path.length - 1];
    (((neighbours || {})[last] || [])).forEach((next) => {
      if (next === start) {
        if (path.length >= 3) rings.set(path.slice().sort((a, b) => a - b).join('-'), path.slice());
        return;
      }
      if (next < start || path.indexOf(next) >= 0 || path.length >= maxSize) return;
      walk(start, path.concat([next]));
    });
  };
  (nodes || []).slice().sort((a, b) => a - b).forEach((node) => walk(node, [node]));
  return [...rings.values()];
};
// ONE ring → the triangles of its plate: a fan from the centroid of the ring, all
// the vertices sharing the ring's own plane normal (so the plates of one base are
// lit exactly like each other). Returns null for a degenerate ring.
const ringPlateTriangles = (points) => {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  const n = pts.length;
  if (n < 3) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const cz = pts.reduce((s, p) => s + p.z, 0) / n;
  const nrm = ringPlaneNormal(pts);
  const position = [];
  const normal = [];
  pts.forEach((p) => { position.push(p.x, p.y, p.z); normal.push(nrm[0], nrm[1], nrm[2]); });
  position.push(cx, cy, cz);   // the centre of the fan is the LAST vertex
  normal.push(nrm[0], nrm[1], nrm[2]);
  const index = [];
  for (let i = 0; i < n; i += 1) index.push(n, i, (i + 1) % n);
  return { position, normal, index };
};

// The colour of the plates of ONE ring. `group` is its chemical group (base /
// pentose, what nucleicGroupOf reads) and `resname` says WHICH base it is.
// Priority: ONE flat ring colour (the menu's « one colour », i.e. PyMOL's
// cartoon_ring_color) → « Colour by chemical group », which recolours the plates
// like every other representation → the identity of the base, the palette that
// makes « Stylized rings » stylized. The ribose plate therefore follows the colour
// of ITS OWN base (they belong to the same nucleotide) unless the two other modes
// say otherwise.
const ringPlateColorOf = (m, resname, group) => {
  const flat = m && m.ringColour === 'custom' ? flatHex(m.ringColorHex) : null;
  if (flat != null) return flat;
  if (m && m.groupColour) {
    if (group === 'pentose' && Number.isFinite(m.pentoseColor)) return m.pentoseColor;
    if (group === 'base' && Number.isFinite(m.baseColor)) return m.baseColor;
  }
  return baseIdentityColorOf(resname);
};
// The plate data of every ring of the nucleic atoms of ONE selection: one
// MeshBuffer worth of vertices, plane normals, per-vertex colours and triangles,
// plus the atom indices of the rings (the outline of the plates is drawn over
// exactly those atoms). Returns null when the selection holds no ring at all.
const nucleicRingPlates = (structure, sele, m) => {
  if (!structure || !sele || typeof structure.eachAtom !== 'function') return null;
  if (!m || m.bases !== 'rings') return null;   // the plates ARE the « Stylized rings » look
  const wantSugar = m.sugarPlate !== false;
  // 1. The heavy atoms of every nucleotide of the selection, sorted into the
  //    chemical groups the plate colouring speaks about (base / pentose).
  const residues = new Map();   // residueIndex → { resname, base: [index…], pentose: […] }
  try {
    structure.eachAtom((a) => {
      if (String(a.element || '').toUpperCase() === 'H') return;   // a ring is heavy atoms
      const group = nucleicGroupOf(a.atomname);
      if (group === 'phosphate') return;                           // the backbone is not a ring
      if (group === 'pentose' && !wantSugar) return;
      const ri = a.residueIndex;
      let res = residues.get(ri);
      if (!res) { res = { resname: a.resname, base: [], pentose: [] }; residues.set(ri, res); }
      res[group].push(a.index);
    }, toNglSelection(sele));
  } catch { return null; }
  if (!residues.size) return null;
  const position = [];
  const normal = [];
  const color = [];
  const index = [];
  const atomIndices = [];
  const seen = new Set();
  residues.forEach((res) => {
    ['base', 'pentose'].forEach((group) => {
      const nodes = res[group];
      if (!nodes || nodes.length < 3) return;
      const inGroup = new Set(nodes);
      const neighbours = {};
      const points = {};
      nodes.forEach((i) => {
        let ap = null;
        try { ap = structure.getAtomProxy(i); } catch { ap = null; }
        if (!ap) return;
        points[i] = { x: ap.x, y: ap.y, z: ap.z };
        const list = [];
        try { ap.eachBondedAtom((b) => { if (b && inGroup.has(b.index)) list.push(b.index); }); } catch { /* no bonds → no ring */ }
        neighbours[i] = list;
      });
      const rgb = hexToRgb01(ringPlateColorOf(m, res.resname, group));
      ringCyclesOf(nodes, neighbours).forEach((ring) => {
        const tri = ringPlateTriangles(ring.map((i) => points[i]));
        if (!tri) return;
        const offset = position.length / 3;
        tri.position.forEach((v) => position.push(v));
        tri.normal.forEach((v) => normal.push(v));
        tri.index.forEach((v) => index.push(offset + v));
        for (let v = 0; v < tri.position.length / 3; v += 1) color.push(rgb[0], rgb[1], rgb[2]);
        ring.forEach((i) => { if (!seen.has(i)) { seen.add(i); atomIndices.push(i); } });
      });
    });
  });
  if (!index.length) return null;
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    color: new Float32Array(color),
    index: new Uint32Array(index),
    atomIndices: atomIndices.sort((a, b) => a - b),
    rings: index.length / 3,          // one fan triangle per ring vertex
  };
};

// ---- PDB atom name → NMR Greek-letter name mapping (Hydrogens) ----
const PDB_TO_NMR = {
H: 'HN',
HN: 'HN',
H1: 'HN',
H2: 'HN',
H3: 'HN',
HA: 'Hα',
HA1: 'Hα1',
HA2: 'Hα2',
HA3: 'Hα2',
HB: 'Hβ',
HB1: 'Hβ1',
HB2: 'Hβ2',
HB3: 'Hβ',
HG: 'Hγ',
HG1: 'Hγ1',
HG2: 'Hγ2',
HG3: 'Hγ',
HG11: 'Hγ1',
HG12: 'Hγ1',
HG13: 'Hγ1',
HG21: 'Hγ2',
HG22: 'Hγ2',
HG23: 'Hγ2',
HD: 'Hδ',
HD1: 'Hδ1',
HD2: 'Hδ2',
HD3: 'Hδ',
HD11: 'Hδ1',
HD12: 'Hδ1',
HD13: 'Hδ1',
HD21: 'Hδ21',
HD22: 'Hδ22',
HE: 'Hε',
HE1: 'Hε1',
HE2: 'Hε2',
HE3: 'Hε3',
HE21: 'Hε21',
HE22: 'Hε22',
HZ: 'Hζ',
HZ1: 'Hζ(NH3)',
HZ2: 'Hζ(NH3)',
HZ3: 'Hζ(NH3)',
HH: 'Hη2',
HH11: 'Hη2',
HH12: 'Hη2',
HH2: 'Hη2',
HH21: 'Hη2',
HH22: 'Hη2',
};

const GREEK_MAP = {
A: 'α',
B: 'β',
G: 'γ',
D: 'δ',
E: 'ε',
Z: 'ζ',
H: 'η',
};

const REVERSE_GREEK = {
α: 'A',
β: 'B',
γ: 'G',
δ: 'D',
ε: 'E',
ζ: 'Z',
η: 'H',
};

// ============================================================================
// PyMOL-style helpers — colour parsing, selection translation, script subset
// ============================================================================
const PYMOL_COLORS = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ff8000', purple: '#800080', pink: '#ff00ff', cyan: '#00ffff',
  marine: '#000080', white: '#ffffff', gray: '#808080', grey: '#808080',
  gray20: '#333333', gray30: '#4d4d4d', gray40: '#666666', gray50: '#808080',
  gray60: '#999999', gray70: '#b3b3b3', gray80: '#cccccc', black: '#000000',
  gold: '#ffd700', salmon: '#fa8072', greencyan: '#00ffcc', tv_red: '#ff0000',
  tv_orange: '#ff8000', tv_yellow: '#ffff00', tv_green: '#00ff00',
  tv_blue: '#0000ff', tv_purple: '#800080', slate: '#708090',
};
const parseColorInt = (c) => {
  const s = String(c || '').trim();
  if (!s) return null;
  if (/^\[/.test(s)) {
    const m = s.match(/\[([^\]]+)\]/);
    if (m) {
      const parts = m[1].split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
      if (parts.length >= 3) return ((parts[0] & 255) << 16) | ((parts[1] & 255) << 8) | (parts[2] & 255);
    }
    return null;
  }
  if (/^#?[0-9a-f]{6}$/i.test(s)) return parseInt(s.replace('#', ''), 16);
  const base = String(s).split('_')[0].toLowerCase();
  return PYMOL_COLORS[base] ? parseInt(PYMOL_COLORS[base].slice(1), 16) : null;
};

/* ---- PyMOL → NGL: the ONE selection bridge ---------------------------------
   PyMOL and NGL do not share a selection grammar, and every difference is
   SILENT — measured on the very NGL 2.4.0 this viewer loads from the CDN:
     • `z>90`       → { resname: "Z>90" }                    → 0 atom, no error;
     • `name CA`    → resname "NAME" or resname "CA"         → 0 atom (PyMOL: Cα);
     • `resn STIG*` → { error: "resi must be an integer" }   → selection lost;
     • `ECL*`/`H*`  → NGL has NO wildcards (exact string compare);
     • `resname`, `atomname`, `chain`, `elem` are not NGL words either: NGL
       spells them as a bare resname, `.CA`, `:A`, `_C`, `1-10`, `@i,j,k`.
   Hence the report « everything is drawn with spheres and the hides do
   nothing »: `hide spheres, membrane and z>90` removed NOTHING (the selection
   was empty), and `show spheres, upper_headgroups` drew WHOLE residues instead
   of the headgroups, because every `name …` constraint was read as a residue
   name. This translator turns a PyMOL expression into what NGL really
   understands and uses the STRUCTURE to resolve the two dimensions NGL cannot
   express at all — wildcards (`*`, `?`) and coordinates (`z>90`).
   PURE: `ctx` is a bag of structure callbacks, so a test runs it on a fake
   structure (_pymol_selection_bridge_test.mjs). */
// A PyMOL predicate keyword → what it becomes. `list` = value-list handling.
const PYMOL_PREDICATES = {
  resn: 'resname', resname: 'resname', resi: 'resno', resid: 'resno', resnum: 'resno',
  residue: 'resno', residues: 'resno', name: 'atomname', atomname: 'atomname',
  atom: 'atomname', chain: 'chainname', elem: 'element', element: 'element',
  type: 'element', chem: 'element', z: 'z', x: 'x', y: 'y',
};
// Bare PyMOL words NGL ALSO understands (each one verified on NGL 2.4.0). A word
// that is neither here nor a predicate above is either one of the macro's own
// named selections (inlined) or a typo — never silently ignored.
const PYMOL_NGL_WORDS = {
  all: 'all', '*': 'all', none: 'none', protein: 'protein', nucleic: 'nucleic',
  rna: 'rna', dna: 'dna', polymer: 'polymer', water: 'water', solvent: 'water',
  ion: 'ion', ions: 'ion', hetatm: 'hetero', hetero: 'hetero', organic: 'hetero',
  backbone: 'backbone', sidechain: 'sidechain', sidechainattached: 'sidechainattached',
  helix: 'helix', sheet: 'sheet', turn: 'turn', loop: 'turn', ring: 'ring',
  aromatic: 'aromatic', aromaticring: 'aromaticring', bonded: 'bonded',
  metal: 'metal', hydrogen: 'hydrogen', hydro: 'hydrogen', saccharide: 'saccharide',
  sugar: 'sugar', ligand: 'ligand', polar: 'polar', nonpolar: 'nonpolar',
  apolar: 'nonpolar', hydrophobic: 'hydrophobic', charged: 'charged',
  acidic: 'acidic', basic: 'basic', small: 'small', cyclic: 'cyclic',
  aliphatic: 'aliphatic', nucleophilic: 'nucleophilic',
};
// PyMOL words with no NGL word at all: rendered as their own definition.
const PYMOL_WORD_CLAUSES = {
  amid: '[ASN,GLN]', amide: '[ASN,GLN]',
  // PyMOL's dotted forms, which the macro language uses everywhere.
  'polymer.protein': 'protein', 'polymer.nucleic': 'nucleic', 'polymer.nucleic.acid': 'nucleic',
};
// `byres` / `bycalpha` are not operators: they wrap the REST of the expression.
const PYMOL_MODIFIERS = { byres: 'byres', bymolecule: 'byres', bymol: 'byres', bycalpha: 'bycalpha' };

/* Tokenise a PyMOL expression: parentheses, the logic operators, the `+` union
   and the coordinate comparisons each become their own token (`z>90` → `z` `>`
   `90`), so the parser never has to look inside a word. */
const tokenizePymolSele = (raw) => String(raw || '')
  .replace(/([()])/g, ' $1 ')
  .replace(/\+/g, ' + ')
  .replace(/,/g, ' , ')
  .replace(/([a-zA-Z]\w*)\s*(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)/g, '$1 $2 $3')
  .trim().split(/\s+/).filter((t) => t !== '');

/* Parse into a small AST. PyMOL binds `+` (the union) INSIDE its predicate and
   then NOT, AND, OR — the same strength NGL uses. The rendered output carries
   explicit parentheses everywhere, so NGL's whitespace-OR can never re-read the
   expression in another way (PyMOL's `A+B and C` is `(A or B) and C`). */
const parsePymolSele = (raw) => {
  const toks = tokenizePymolSele(raw);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (t) => t === 'and' || t === 'or' || t === 'not';
  const parseValues = () => {
    const values = [];
    let expectValue = true;
    while (i < toks.length) {
      const t = toks[i];
      if (t === '+' || t === ',') { i += 1; expectValue = true; continue; }
      if (expectValue && !isOp(t) && t !== '(' && t !== ')') { values.push(t); i += 1; expectValue = false; continue; }
      break;
    }
    return values;
  };
  const parseUnary = () => {
    if (peek() === 'not') { i += 1; return { kind: 'not', child: parseUnary() }; }
    const t = peek();
    if (t === '(') {
      i += 1;
      const node = parseOr();
      if (peek() === ')') i += 1;
      return node;
    }
    if (t === undefined) return { kind: 'none' };
    i += 1;
    const word = String(t).toLowerCase();
    if (PYMOL_MODIFIERS[word]) return { kind: 'mod', mod: PYMOL_MODIFIERS[word], child: parseUnary() };
    const pred = PYMOL_PREDICATES[word];
    if (pred) {
      const values = parseValues();
      // `z > 90` reaches here as two tokens: the operator, then its number.
      if (values.length === 1 && /^(>=|<=|!=|>|<|=)$/.test(String(values[0]))) {
        const cmpValue = parseValues();
        return { kind: 'cmp', pred, op: values[0], value: cmpValue[0] };
      }
      return { kind: 'pred', pred, values };
    }
    if (PYMOL_WORD_CLAUSES[word]) return { kind: 'clause', ngl: PYMOL_WORD_CLAUSES[word] };
    if (PYMOL_NGL_WORDS[word]) return { kind: 'clause', ngl: PYMOL_NGL_WORDS[word] };
    if (/^-?\d+$/.test(word)) return { kind: 'clause', ngl: word };  // PyMOL `1` = residue 1
    return { kind: 'word', word: String(t) };
  };
  const parseAnd = () => {
    const children = [parseUnary()];
    while (peek() === 'and') { i += 1; children.push(parseUnary()); }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };
  // eslint-disable-next-line no-use-before-define
  const parseOr = () => {
    const children = [parseAnd()];
    while (peek() === 'or') { i += 1; children.push(parseAnd()); }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };
  return parseOr();
};

/* Render one AST node as an NGL expression. `ctx` carries the STRUCTURE:
     named     : Map(name → PyMOL expression) — the macro's own selections
     resnames  : the residue names present (wildcards are expanded against them)
     atomnames : the atom names present
     coord     : (axis, op, value) → NGL clause (an `@i,j,k` index list, which
                 is the ONLY way NGL can express a coordinate test)
     byres     : (nglInner, mod) → NGL clause (every atom of the residues the
                 inner selection touches)
     onWarn    : (message) → collected for the macro log / the row's ⚠ */
const PYMOL_WILDCARD_CACHE = new Map();
const pymolPatternToRegex = (pattern) => {
  const key = String(pattern);
  let re = PYMOL_WILDCARD_CACHE.get(key);
  if (!re) {
    const escaped = key.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    re = new RegExp(`^${escaped}$`, 'i');
    PYMOL_WILDCARD_CACHE.set(key, re);
  }
  return re;
};
// PyMOL's `+` list against the structure: `ECL*` becomes the concrete `ECL2`
// (NGL compares residue and atom names EXACTLY — no wildcard, ever).
const expandPymolNames = (values, vocab) => {
  const out = [];
  const seen = new Set();
  (values || []).forEach((v) => {
    const raw = String(v || '').trim();
    if (!raw) return;
    if (!/[*?]/.test(raw)) { if (!seen.has(raw.toUpperCase())) { seen.add(raw.toUpperCase()); out.push(raw.toUpperCase()); } return; }
    const re = pymolPatternToRegex(raw);
    (vocab || []).forEach((name) => {
      if (re.test(name) && !seen.has(name)) { seen.add(name); out.push(name); }
    });
  });
  return out.slice(0, 512);
};
const renderPymolNode = (node, ctx, seen) => {
  const warn = ctx.onWarn || (() => {});
  switch (node.kind) {
    case 'none': return 'none';
    case 'clause': return node.ngl;
    case 'not': return `not (${renderPymolNode(node.child, ctx, seen)})`;
    case 'and': return `(${node.children.map((c) => renderPymolNode(c, ctx, seen)).join(' and ')})`;
    case 'or': return `(${node.children.map((c) => renderPymolNode(c, ctx, seen)).join(' or ')})`;
    case 'mod': {
      const inner = renderPymolNode(node.child, ctx, seen);
      if (typeof ctx.byres !== 'function') { warn(`${node.mod} needs a loaded structure`); return inner; }
      return ctx.byres(inner, node.mod);
    }
    case 'cmp': {
      if (typeof ctx.coord !== 'function' || node.value == null) { warn(`${node.pred}${node.op}${node.value} needs a loaded structure`); return 'none'; }
      return ctx.coord(node.pred, node.op, node.value);
    }
    case 'word': {
      const key = String(node.word).toLowerCase();
      // A RESERVED name (the leaflets the viewer measures itself) wins over the
      // script's own definition: `z>90` is only a way to guess the two leaflets,
      // and the geometry knows it exactly (midplane, thickness, heads).
      const ov = ctx.overrides
        ? (typeof ctx.overrides.get === 'function' ? ctx.overrides.get(key) : ctx.overrides[key])
        : null;
      if (ov) return ov;
      const named = ctx.named;
      if (named && named.has(key)) {
        if (seen.has(key)) { warn(`selon recursif « ${key} »`); return 'none'; }
        seen.add(key);
        const out = renderPymolNode(parsePymolSele(named.get(key)), ctx, seen);
        seen.delete(key);
        return out;
      }
      // An unknown word is what PyMOL itself would refuse: say so, and match
      // nothing rather than matching everything.
      warn(`« ${node.word} » not defined by the script → matches nothing`);
      return 'none';
    }
    case 'pred': {
      const values = node.values || [];
      if (!values.length) return 'none';
      if (node.pred === 'resname') {
        const names = expandPymolNames(values, ctx.resnames || []);
        if (!names.length) { warn(`no residue name matches ${values.join('+')}`); return 'none'; }
        if (names.length === 1 && /^[A-Za-z0-9]{1,4}$/.test(names[0])) return names[0];
        return `[${names.join(',')}]`;
      }
      if (node.pred === 'atomname') {
        const names = expandPymolNames(values, ctx.atomnames || []);
        if (!names.length) { warn(`no atom name matches ${values.join('+')}`); return 'none'; }
        const parts = names.map((n) => `.${n.slice(0, 4)}`);
        return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
      }
      if (node.pred === 'resno') {
        const parts = values.map((v) => String(v).trim()).filter((v) => /^-?\d+(-\d+)?$/.test(v));
        if (!parts.length) return 'none';
        return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
      }
      if (node.pred === 'chainname') {
        const parts = values.map((v) => `:${String(v).trim()}`);
        return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
      }
      if (node.pred === 'element') {
        const parts = values.map((v) => `_${String(v).trim().toUpperCase()}`);
        return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`;
      }
      return 'none';
    }
    default: return 'none';
  }
};

// The ONE entry point of the bridge. No structure at all (a script parsed
// before a molecule is loaded) still translates every keyword — only the
// wildcards and the coordinates then report that they need the structure.
const pymolSeleToNgl = (raw, ctx = {}) => {
  const text = String(raw || '').trim();
  if (!text) return 'all';  // PyMOL: an empty selection argument stands for all
  const ngl = renderPymolNode(parsePymolSele(text), ctx, new Set());
  return ngl || 'none';
};

/* The structure side of the bridge. NGL cannot test a coordinate, so `z>90`
   becomes the atom-index list NGL DOES understand (`@i,j,k` — verified) and
   `byres` becomes the list of every atom of the residues the inner selection
   touches. Both are memoised per structure: a membrane macro asks for the same
   `z>90` a dozen times and the scan must happen once. */
const pymolCtxCache = new WeakMap();
const pymolVocabOf = (structure) => {
  let ctx = pymolCtxCache.get(structure);
  if (!ctx) {
    const resnames = new Set();
    const atomnames = new Set();
    try {
      structure.eachAtom((a) => {
        if (a.resname) resnames.add(String(a.resname).toUpperCase());
        if (a.atomname) atomnames.add(String(a.atomname).toUpperCase());
      });
    } catch { /* an unloaded structure simply has no vocabulary */ }
    ctx = { resnames: [...resnames], atomnames: [...atomnames], clauseCache: new Map() };
    pymolCtxCache.set(structure, ctx);
  }
  return ctx;
};
const pymolCoordClause = (structure, cache, axis, op, value) => {
  const key = `coord:${axis}${op}${value}`;
  if (cache.has(key)) return cache.get(key);
  let out = 'none';
  try {
    const limit = parseFloat(value);
    if (Number.isFinite(limit)) {
      const idx = [];
      structure.eachAtom((a) => {
        const v = Number(axis === 'x' ? a.x : axis === 'y' ? a.y : a.z);
        const hit = op === '>' ? v > limit : op === '>=' ? v >= limit : op === '<' ? v < limit
          : op === '<=' ? v <= limit : op === '=' ? Math.abs(v - limit) < 1e-6 : v !== limit;
        if (hit) idx.push(a.index);
      });
      if (idx.length) out = `@${idx.join(',')}`;
    }
  } catch { out = 'none'; }
  cache.set(key, out);
  return out;
};
const pymolByresClause = (structure, cache, nglInner, mod) => {
  const key = `${mod}:${nglInner}`;
  if (cache.has(key)) return cache.get(key);
  let out = 'none';
  try {
    const NG = typeof window !== 'undefined' ? window.NGL : null;
    if (NG && NG.Selection && structure.getAtomSet) {
      const set = structure.getAtomSet(new NG.Selection(nglInner));
      const residues = new Set();
      const all = [];
      structure.eachAtom((a) => {
        const selected = set && typeof set.get === 'function' ? set.get(a.index) : false;
        if (selected) residues.add(a.residueIndex);
        all.push(a);
      });
      const idx = [];
      all.forEach((a) => {
        if (!residues.has(a.residueIndex)) return;
        if (mod === 'bycalpha') {
          const n = String(a.atomname || '').toUpperCase();
          if (n !== 'CA' && n !== 'BB') return;
        }
        idx.push(a.index);
      });
      if (idx.length) out = `@${idx.join(',')}`;
    }
  } catch { out = 'none'; }
  cache.set(key, out);
  return out;
};
// The viewer's entry point: same translator, with the structure's vocabulary,
// its coordinate index lists and its residue expansion.
const pymolSeleForStructure = (structure, named, raw, onWarn, overrides) => {
  if (!structure || typeof structure.eachAtom !== 'function') return pymolSeleToNgl(raw, { named, onWarn, overrides });
  const base = pymolVocabOf(structure);
  return pymolSeleToNgl(raw, {
    named,
    onWarn,
    overrides,
    resnames: base.resnames,
    atomnames: base.atomnames,
    coord: (axis, op, value) => pymolCoordClause(structure, base.clauseCache, axis, op, value),
    byres: (inner, mod) => pymolByresClause(structure, base.clauseCache, inner, mod),
  });
};

/* ---- Material of the drawn representations ---------------------------------
   NGL 2.4 HAS a material; it is simply not advertised where one looks. The two
   properties PyMOL exposes are declared in the parameter schema of every
   Representation — `roughness: { type: 'range', step: 0.01, max: 1, min: 0,
   buffer: true }` and the same for `metalness` (representation.ts) — stored in
   the buffer parameters (buffer.ts default: roughness 0.4, metalness 0.0, i.e. a
   matte non-metallic surface) and forwarded to the physical shader as uniforms
   (`roughness: { uniform: true }`; the ShaderMaterial is even built with THE SAME
   uniforms object). They can therefore be set through NGL's own `setParameters`
   and the change is applied IN PLACE — no rebuild, no `needsUpdate` — which is
   what makes a live slider possible. 0.4 / 0.0 are exactly the « flat / not
   shiny » the user reported against PyMOL. */
const MATERIAL_PRESETS = {
  auto: null,
  matte: { roughness: 0.95, metalness: 0.0 },
  gloss: { roughness: 0.35, metalness: 0.15 },
  metallic: { roughness: 0.18, metalness: 0.85 },
  glass: { roughness: 0.08, metalness: 0.0, opacity: 0.45 },
};
// The four material families the user asked for, and the rep TYPES that belong to
// each. These are the strings NGL itself uses (`this.type = 'spacefill'`, …): the
// guard _viewer_materials_test.mjs reads the list out of the installed ngl and
// fails if one of them ever stops existing, so no family can go silently dead.
const MATERIAL_KINDS = [
  { key: 'spheres', label: 'Spheres', reps: ['spacefill'] },
  { key: 'sticks', label: 'Bonds', reps: ['licorice', 'ball+stick', 'hyperball'] },
  { key: 'cartoon', label: 'Cartoon', reps: ['cartoon', 'ribbon', 'tube', 'trace', 'rope', 'backbone', 'rocket'] },
  { key: 'surface', label: 'Surface', reps: ['surface'] },
];
const MATERIAL_KIND_OF_REP = MATERIAL_KINDS.reduce((acc, k) => {
  k.reps.forEach((r) => { acc[r] = k.key; });
  return acc;
}, {});
const MATERIALS_KEY = 'labViewerMaterials';
// Effective value of one property: an explicit number wins over the preset.
const materialValueOf = (mat, kind, prop) => {
  const m = (mat && mat[kind]) || {};
  if (m[prop] != null && Number.isFinite(Number(m[prop]))) return Number(m[prop]);
  const preset = MATERIAL_PRESETS[m.preset] || null;
  if (preset && preset[prop] != null) return preset[prop];
  return null;
};
/* THE ELEMENT, NOT THE REPRESENTATION — this was the whole materials bug.
   `component.addRepresentation(type, params)` does NOT return the representation:
   it returns a RepresentationElement that WRAPS it (ngl 2.4.0, component.ts:
   `new RepresentationElement(this.stage, repr, p, this)`, and that is what goes
   into reprList and what every ref of this viewer holds). An element is not a
   representation: it carries `name = repr.type` — the rep type — while its own
   `type` is the constant 'representation', it exposes the wrapped object as the
   public `repr`, and it has NO `geometryList`. The previous implementation walked
   `element.geometryList` (looking for three.js geometries to poke shader
   uniforms): on an element that list does not exist, so it returned in silence
   and NO material was ever applied. */
const reprOfElement = (el) => (el && (el.repr || (typeof el.getRepresentation === 'function' ? el.getRepresentation() : null))) || null;
/* The rep TYPE of an element: its constructor sets `name` to repr.type, and
   getType() gives the same answer if a future NGL stops filling `name`. Note the
   element's own `type` is 'representation' — the opposite of useful here. */
const repTypeOfElement = (el) => String((el && (el.name || (typeof el.getType === 'function' && el.getType()))) || '');
// Through NGL's own parameters — the block above lists the source lines that prove
// it is applied in place (no rebuild, no uniform poking).
const applyMaterialToRep = (el, mat) => {
  if (!el || !mat) return;
  const kind = MATERIAL_KIND_OF_REP[repTypeOfElement(el)];
  if (!kind) return;   // a rep with no material (line, point, label, slice) is skipped
  const params = {};
  const roughness = materialValueOf(mat, kind, 'roughness');
  const metalness = materialValueOf(mat, kind, 'metalness');
  const opacity = materialValueOf(mat, kind, 'opacity');
  if (roughness != null) params.roughness = roughness;
  if (metalness != null) params.metalness = metalness;
  if (opacity != null) params.opacity = opacity;
  // « auto » asks for nothing: NGL's own rough, non-metallic material stays.
  if (!Object.keys(params).length) return;
  const repr = reprOfElement(el);
  if (!repr || typeof repr.setParameters !== 'function') return;
  try { repr.setParameters(params); } catch { /* never break the scene for a look */ }
};

/* ---- Which leaflet is which, from the GEOMETRY -----------------------------
   `z>90` is how membrane macros split the two leaflets, and it breaks as soon as
   the file is not centred on z=90 or is oriented along another axis — the user's
   own remark: « z was a way to tell the upper leaflet from the lower one; if you
   can tell them apart, z is not needed ». Geometry says it with no assumption:
     • a bilayer is a SLAB, so the axis along which the lipid atoms are the
       THINNEST is the membrane normal, whatever the orientation of the file;
     • the two leaflets are the two clusters of each residue's OUTERMOST atom on
       that normal (the head), so 1-D k-means gives the two head planes and
       their midpoint is the MIDPLANE (returned, in Å, so the user can check it);
     • a residue is UPPER when its head is above that plane, and its headgroup is
       the set of its atoms the very classifier of the Lipids menu
       (lipidGroupOf) reads as « head » — the two menus can never disagree.
   Returns null when the structure holds no membrane. The four result clauses are
   then published as ready-made selections (upper_leaflet, lower_leaflet,
   upper_headgroups, lower_headgroups): a macro may use those names directly, and
   the Selections bar lets the user draw them to see which is which.  */
const meanOf = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
const resnoRangesClause = (numbers) => {
  const sorted = [...new Set((numbers || []).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let k = 1; k <= sorted.length; k += 1) {
    const v = sorted[k];
    if (v === prev + 1) { prev = v; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = v;
    prev = v;
  }
  return parts.join(' or ');
};
const membraneLeafletsOf = (structure) => {
  if (!structure || typeof structure.eachAtom !== 'function') return null;
  const atoms = [];
  try {
    structure.eachAtom((a) => {
      if (!isLipidResname(a.resname)) return;
      atoms.push({
        i: a.index,
        ri: a.residueIndex,
        resno: Number(a.resno),
        resname: String(a.resname).toUpperCase(),
        head: lipidGroupOf(a.atomname, a.element) === 'head',
        x: Number(a.x) || 0,
        y: Number(a.y) || 0,
        z: Number(a.z) || 0,
      });
    });
  } catch { return null; }
  // A handful of lipid atoms is a ligand, not a bilayer.
  if (atoms.length < 40) return null;
  const varianceOf = (key) => {
    const vals = atoms.map((a) => a[key]);
    const m = meanOf(vals);
    return meanOf(vals.map((v) => (v - m) * (v - m)));
  };
  let axis = 'x';
  ['y', 'z'].forEach((k) => { if (varianceOf(k) < varianceOf(axis)) axis = k; });
  const proj = (a) => (axis === 'x' ? a.x : axis === 'y' ? a.y : a.z);
  const byResidue = new Map();
  atoms.forEach((a) => {
    let r = byResidue.get(a.ri);
    if (!r) { r = { resno: a.resno, resname: a.resname, atoms: [], headAtoms: [], anchor: 0 }; byResidue.set(a.ri, r); }
    r.atoms.push(a);
    if (a.head) r.headAtoms.push(a);
  });
  const residues = [...byResidue.values()];
  if (residues.length < 4) return null;
  const centre = meanOf(atoms.map(proj));
  residues.forEach((r) => {
    // the head is the atom the furthest from the membrane centre
    let best = r.atoms[0];
    let bestD = -1;
    r.atoms.forEach((a) => { const d = Math.abs(proj(a) - centre); if (d > bestD) { bestD = d; best = a; } });
    r.anchor = proj(best);
  });
  let c1 = Math.min(...residues.map((r) => r.anchor));
  let c2 = Math.max(...residues.map((r) => r.anchor));
  if (!(c2 - c1 > 4)) return null;  // one single layer: no bilayer
  for (let it = 0; it < 24; it += 1) {
    const g1 = [];
    const g2 = [];
    residues.forEach((r) => (Math.abs(r.anchor - c1) <= Math.abs(r.anchor - c2) ? g1 : g2).push(r.anchor));
    if (!g1.length || !g2.length) break;
    const n1 = meanOf(g1);
    const n2 = meanOf(g2);
    const settled = Math.abs(n1 - c1) < 0.01 && Math.abs(n2 - c2) < 0.01;
    c1 = n1;
    c2 = n2;
    if (settled) break;
  }
  const midplane = (c1 + c2) / 2;
  const upper = residues.filter((r) => r.anchor >= midplane);
  const lower = residues.filter((r) => r.anchor < midplane);
  if (!upper.length || !lower.length) return null;
  const sideOf = (rs) => ({
    residues: rs.length,
    atoms: rs.reduce((s, r) => s + r.atoms.length, 0),
    clause: `(${resnoRangesClause(rs.map((r) => r.resno))}) and ([${[...new Set(rs.map((r) => r.resname))].join(',')}])`,
    headIndices: rs.flatMap((r) => r.headAtoms.map((a) => a.i)),
  });
  return { axis, midplane, thickness: Math.abs(c2 - c1), upper: sideOf(upper), lower: sideOf(lower) };
};

const normalizeStructureSource = (raw) => {
const value = (raw || '').trim();
if (!value) return null;
// NOTE: Google-Drive link loading was removed — structures are uploaded from
// the PC (and archived to Drive automatically), so pasting a Drive link as the
// source is no longer needed. PDB IDs, rcsb: and plain https URLs still work.
if (/^(https?:|blob:|data:)/i.test(value)) {
const path = value.split(/[?#]/)[0];
const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
if (ext === 'pdb' || ext === 'ent') return { url: value, params: { ext: 'pdb' } };
if (ext === 'gro') return { url: value, params: { ext: 'gro' } };
if (ext === 'cif' || ext === 'mmcif') return { url: value, params: { ext: 'cif' } };
if (ext === 'bcif') return { url: value, params: { ext: 'bcif' } };
if (ext === 'mol2') return { url: value, params: { ext: 'mol2' } };
if (ext === 'sdf') return { url: value, params: { ext: 'sdf' } };
const guessed = /bcif/i.test(value) ? 'bcif' : /cif/i.test(value) ? 'cif' : 'pdb';
return { url: value, params: { ext: guessed } };
}
if (/^rcsb:/i.test(value)) return { url: value };
if (/^[0-9a-z]{4}$/i.test(value)) {
const id = value.toUpperCase();
return { url: `https://files.rcsb.org/download/${id}.cif`, params: { ext: 'cif' } };
}
return { url: value };
};

const getCarbonName = (molType, char, atom) => {
if (!atom) return null;
if (
atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') ||
atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')
) {
return null;
}
if (molType === 'organic') {
return atom.replace('H', 'C').replace(/[a-z]+$/, '');
}
if (molType === 'protein') {
if (atom === 'Hε' && char === 'R') return null;
if (char === 'W' && atom === 'Hδ1') return null;
if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
const cName = atom.replace('H', 'C').replace(/\d+$/, '');
if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) {
return atom.replace('H', 'C');
}
return cName;
}
return atom.replace('H', 'C');
};

const buildKeys = (ri, tokens, molType, char) => {
const set = new Set();
(tokens || []).forEach((tok) => {
const variants = new Set([tok]);
if (/\d$/.test(tok)) {
[1, 2].forEach((n) => variants.add(tok + n));
const stripped = tok.replace(/\d+$/, '');
if (stripped !== tok && stripped.length > 1) variants.add(stripped);
}
variants.forEach((v) => {
set.add(`${ri}-${v}`);
if (v.startsWith('H')) {
const c = getCarbonName(molType, char, v);
if (c) set.add(`${ri}-${c}`);
}
});
});
return [...set];
};

const NUCLEIC_NMR_ALIASES = { "HO2'": "OH2'", H71: 'H7(CH3)', H72: 'H7(CH3)', H73: 'H7(CH3)' };

const mapPdbAtomToNmrKeys = (atomname, resno, parsedSeq, moleculeType, namingConvention = 'nmr') => {
const ri = resno - 1;
if (!parsedSeq || ri < 0 || ri >= parsedSeq.length) return null;
const res = parsedSeq[ri];
if (!res) return null;
const upper = (atomname || '').trim().toUpperCase();
let nmrAtom;
if (namingConvention === 'pdb') {
if (upper === 'H') nmrAtom = 'HN';
else nmrAtom = upper;
} else if (moleculeType === 'dna' || moleculeType === 'rna') {
nmrAtom = NUCLEIC_NMR_ALIASES[upper] || upper;
} else {
nmrAtom = PDB_TO_NMR[upper];
if (!nmrAtom) {
if (upper === 'N') nmrAtom = 'N';
else if (upper === 'CA') nmrAtom = 'Cα';
else if (upper === 'C') nmrAtom = "C'";
else if (upper === 'CB') nmrAtom = 'Cβ';
else if (upper === 'O') nmrAtom = 'O';
else {
const match = upper.match(/^([CNO])([ABGDEZH])(\d*)$/);
nmrAtom = match ? `${match[1]}${GREEK_MAP[match[2]]}${match[3]}` : upper;
}
}
}
const tokens = [nmrAtom];
if (moleculeType === 'dna' || moleculeType === 'rna') tokens.push(`${nmrAtom}`);
const keys = buildKeys(ri, tokens, moleculeType, res.char);
return { ri, keys, label: `${res.id || res.char}${resno} ${nmrAtom}`, nmrAtom };
};

const mapAtomToNmrKeys = (atom, parsedSeq, moleculeType, namingConvention) => {
if (moleculeType === 'organic') {
const nmrAtom = getOrganicAtomName(atom);
const keys = buildKeys(0, [nmrAtom], 'organic', 'O');
return { ri: 0, keys, label: `Org ${nmrAtom}`, nmrAtom };
}
return mapPdbAtomToNmrKeys(atom.atomname, atom.resno, parsedSeq, moleculeType, namingConvention);
};

// ================= RDKit Helper Functions =================
const computeMorganRanks = (elements, bonds) => {
  const n = elements.length;
  const isHeavy = elements.map((e) => e !== 'H');
  const heavyIdx = [];
  elements.forEach((e, i) => { if (e !== 'H') heavyIdx.push(i); });
  const m = heavyIdx.length;
  const posOf = {};
  heavyIdx.forEach((gi, k) => { posOf[gi] = k; });
  const adj = Array.from({ length: m }, () => []);
  const hCount = new Array(m).fill(0);
  bonds.forEach(([a, b]) => {
    const ah = isHeavy[a], bh = isHeavy[b];
    if (ah && bh) { adj[posOf[a]].push(posOf[b]); adj[posOf[b]].push(posOf[a]); }
    else if (ah && !bh) hCount[posOf[a]]++;
    else if (!ah && bh) hCount[posOf[b]]++;
  });
  let sig = heavyIdx.map((gi, k) => `${elements[gi]}_${hCount[k]}`);
  for (let iter = 0; iter < n; iter++) {
    const next = sig.map((s, i) => {
      const neighbors = adj[i].map((j) => sig[j]).sort().join(',');
      const str = s + '|' + neighbors;
      let hash = 0;
      for (let k = 0; k < str.length; k++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(k);
        hash |= 0;
      }
      return Math.abs(hash).toString(36) + '_' + elements[heavyIdx[i]];
    });
    const converged = next.join(';') === sig.join(';');
    sig = next;
    if (converged) break;
  }
  const order = Array.from({ length: m }, (_, k) => k).sort((x, y) =>
    sig[x] < sig[y] ? -1 : sig[x] > sig[y] ? 1 : x - y
  );
  const ranks = new Array(n).fill(-1);
  order.forEach((k, r) => { ranks[heavyIdx[k]] = r; });
  return ranks;
};


const _organicNamingCache = new WeakMap();
const getOrganicNaming = (structure) => {
  if (_organicNamingCache.has(structure)) return _organicNamingCache.get(structure);
  const elements = [];
  const bondPairs = [];
  structure.eachAtom((a) => { elements[a.index] = a.element || 'C'; });
  structure.eachAtom((a) => {
    a.eachBondedAtom((b) => { if (a.index < b.index) bondPairs.push([a.index, b.index]); });
  });
  const n = elements.length;
  const ranks = computeMorganRanks(elements, bondPairs);
  const parent = new Array(n).fill(-1);
  bondPairs.forEach(([x, y]) => {
    if (elements[x] === 'H' && elements[y] !== 'H') parent[x] = y;
    if (elements[y] === 'H' && elements[x] !== 'H') parent[y] = x;
  });
  
  const names = new Array(n);
  for (let i = 0; i < n; i++) {
    if (elements[i] !== 'H') {
      names[i] = `${elements[i]}${ranks[i] >= 0 ? ranks[i] : i}`;
    } else {
      const pr = parent[i] >= 0 ? ranks[parent[i]] : null;
      // Removed suffix logic to match 2D viewer and avoid a,b,c clutter for equivalent protons
      names[i] = pr !== null ? `H${pr}` : `H${i}`;
    }
  }
  
  _organicNamingCache.set(structure, names);
  return names;
};

const getOrganicAtomName = (atom) => {
const names = getOrganicNaming(atom.structure);
return names[atom.index] || `X${atom.index}`;
};

// NGL is loaded via the shared loader in ../utils/ngl.js (see import above).

// ================= TRAJECTORY HELPERS =================
const getTrajectoryObject = (component) => {
if (!component) return null;
if (Array.isArray(component.trajList) && component.trajList.length > 0) {
const tComp = component.trajList[component.trajList.length - 1];
return tComp.trajectory || tComp;
}
if (Array.isArray(component.trajectories) && component.trajectories.length > 0) {
return component.trajectories[component.trajectories.length - 1];
}
return null;
};

const getNumFrames = (traj) => {
if (!traj) return 0;
return (
traj.frameCount || traj.numframes || traj.nFrames ||
(traj.trajectory && (traj.trajectory.frameCount || traj.trajectory.numframes || traj.trajectory.nFrames)) ||
(traj.trajectoryPlayer && (traj.trajectoryPlayer.frameCount || traj.trajectoryPlayer.numframes)) ||
0
);
};

const setFrameSafe = (traj, frame) => {
if (!traj) return;
try {
if (typeof traj.setFrame === 'function') traj.setFrame(frame);
else if (traj.trajectory && typeof traj.trajectory.setFrame === 'function') traj.trajectory.setFrame(frame);
} catch {}
};

/** Split a text PDB file into one Blob per MOLECULE (connected fragment).
 *  Atoms are grouped by COVALENT connectivity scoped to their MODEL record:
 *  CONECT bonds first, then implicit bonds by proximity (≤ 2.0 Å, via a
 *  spatial grid). This separates:
 *   - distinct chains (protein + ligand chain, complexes),
 *   - separate molecules that share ONE chain (receptor + ligand in chain A),
 *   - multimeric complexes held together only by non-covalent contacts,
 *   - overlapping conformers of a multi-MODEL PDB (NMR ensembles / docking
 *     clusters) — bonds never cross MODEL boundaries, so conformers with
 *     identical/overlapping coordinates are never merged into a single blob.
 *  Pure-water fragments are skipped, so a hydrated protein does not explode
 *  into dozens of tiny "molecule" entries. Returns [] when the file has 0/1
 *  molecules or cannot be read — the caller keeps the whole structure.
 *  Deterministic text parsing — independent of NGL internals. */
const splitPdbFileIntoMolecules = async (file) => {
  if (!file) return [];
  let text = '';
  try { text = await file.text(); } catch { return []; }
  const lines = String(text || '').split(/\r?\n/);

  const atoms = [];                 // { line, chain, resname, model, x, y, z }
  const conectBonds = [];           // [i, j] pairs into `atoms`
  const conectIndex = new Map();    // serial -> first atom index (bonds are
                                    // same-MODEL filtered below, so restarted
                                    // serials can never merge two conformers)
  let model = 0;                    // 0-based index of the MODEL block owning the current atoms
  let blocksSeen = 0;               // number of MODEL records seen so far
  for (const line of lines) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'MODEL') {
      model = blocksSeen;   // the next block gets the next 0-based index
      blocksSeen += 1;
      continue;
    }
    if (rec === 'ATOM' || rec === 'HETATM') {
      const serial = parseInt(line.slice(6, 11), 10);
      const idx = atoms.length;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue; // invalid coords
      atoms.push({
        line,
        chain: line.slice(21, 22).trim() || '_',
        resname: line.slice(17, 20).trim(),
        model,
        x, y, z
      });
      if (Number.isFinite(serial) && !conectIndex.has(serial)) conectIndex.set(serial, idx);
    } else if (rec === 'CONECT') {
      const serial = parseInt(line.slice(6, 11), 10);
      const a = conectIndex.get(serial);
      if (a === undefined) continue;
      for (let s = 11; s + 5 <= line.length; s += 5) {
        const bs = parseInt(line.slice(s, s + 5), 10);
        const b = conectIndex.get(bs);
        if (b === undefined) continue;
        conectBonds.push([a, b]);
      }
    }
  }
  if (atoms.length === 0) return [];
  const modelCount = blocksSeen > 0 ? blocksSeen : 1;  // 1 = no MODEL records (single model)

  const parent = atoms.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  // CONECT bonds are only valid INSIDE one MODEL — serial numbers may repeat
  // across conformers, and a bond between different models would merge them.
  conectBonds.forEach(([a, b]) => { if (atoms[a].model === atoms[b].model) union(a, b); });

  // Implicit covalent bonds by proximity — spatial grid keeps this O(n).
  // Same-MODEL rule again: overlapping conformers of an ensemble never merge.
  const BOND_DIST = 2.0;
  const grid = new Map();
  const cellKey = (cx, cy, cz) => `${cx}|${cy}|${cz}`;
  atoms.forEach((a, i) => {
    const key = cellKey(Math.floor(a.x / BOND_DIST), Math.floor(a.y / BOND_DIST), Math.floor(a.z / BOND_DIST));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const cx = Math.floor(a.x / BOND_DIST), cy = Math.floor(a.y / BOND_DIST), cz = Math.floor(a.z / BOND_DIST);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = atoms[j];
            if (a.model !== b.model) continue;
            const ddx = a.x - b.x, ddy = a.y - b.y, ddz = a.z - b.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= BOND_DIST * BOND_DIST) union(i, j);
          }
        }
      }
    }
  }

  // Group by root; skip pure-water fragments; cap the number of entries.
  const groups = new Map();
  atoms.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  // Each connectivity part is further split by CHAIN, so a multi-chain complex
  // (receptor + partner chains of a docking pose, etc.) exposes EVERY chain as
  // its own entry in the Molecules selector — each can be shown/hidden, styled
  // and coloured independently.
  const parts = [];
  groups.forEach((idxs) => {
    if (parts.length >= 30) return;
    const byChain = new Map();
    idxs.forEach((i) => {
      const c = atoms[i].chain || '_';
      if (!byChain.has(c)) byChain.set(c, []);
      byChain.get(c).push(i);
    });
    byChain.forEach((cidxs) => {
      if (parts.length >= 30) return;
      const pureWater = cidxs.every((i) => atoms[i].resname === 'HOH' || atoms[i].resname === 'WAT');
      if (pureWater) return;
      parts.push({
        chainId: atoms[cidxs[0]].chain,
        model: atoms[cidxs[0]].model,
        modelCount,
        blob: new Blob([cidxs.map((i) => atoms[i].line).join('\n') + '\nEND\n'], { type: 'text/plain' })
      });
    });
  });
  return parts;
};

// Reverse map: NMR-style atom name → possible PDB atom names. Built once so
// highlight selection strings never re-scan PDB_TO_NMR per atom key (that is
// what made buildSele quadratic-ish for thousands of manual keys).
const NMR_TO_PDB_NAMES = (() => {
  const m = new Map();
  Object.entries(PDB_TO_NMR).forEach(([pdb, nmr]) => {
    if (!m.has(nmr)) m.set(nmr, []);
    m.get(nmr).push(pdb);
  });
  return m;
})();

// Build an NGL selection string from atom keys ("ri-atom"). Shared by the amber
// (selected) and green (manually-assigned) highlights so neither effect has to
// duplicate the logic. Builds SELECTION TEXT only — the caller picks the
// representation. Fast even for thousands of keys.
const buildNglSele = (keys, structure, moleculeType, namingConvention) => {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const parts = [];
  let organicNameToIndex = null;
  const getOrganicNameToIndexMap = () => {
    if (organicNameToIndex) return organicNameToIndex;
    organicNameToIndex = {};
    try { structure.eachAtom((a) => { organicNameToIndex[getOrganicAtomName(a)] = a.index; }); } catch { organicNameToIndex = {}; }
    return organicNameToIndex;
  };

  keys.forEach((k) => {
    const dashIdx = String(k).indexOf('-');
    if (dashIdx < 0) return;
    const ri = parseInt(String(k).substring(0, dashIdx), 10);
    if (!Number.isFinite(ri)) return;
    const atomName = String(k).substring(dashIdx + 1).trim();
    const resno = ri + 1;

    if (moleculeType === 'organic') {
      const map = getOrganicNameToIndexMap();
      if (Object.prototype.hasOwnProperty.call(map, atomName)) parts.push(`@${map[atomName]}`);
      return;
    }

    // MD / PDB naming convention
    if (namingConvention === 'pdb') {
      const seleParts = [`${resno} and .${atomName}`];
      if (atomName === 'HN') seleParts.push(`${resno} and .H`);
      if (atomName === 'H') seleParts.push(`${resno} and .HN`);
      if (atomName === 'HA') seleParts.push(`${resno} and (.HA1 or .HA2 or .HA3)`);
      if (['HA1', 'HA2', 'HA3'].includes(atomName)) seleParts.push(`${resno} and .HA`);
      parts.push(`(${seleParts.join(' or ')})`);
      return;
    }

    if (moleculeType === 'dna' || moleculeType === 'rna') {
      const names = [atomName];
      if (atomName === "OH2'") names.push("HO2'");
      if (atomName === 'H7(CH3)') names.push('H71', 'H72', 'H73');
      names.forEach((pn) => parts.push(`${resno} and .${pn}`));
      return;
    }

    const pdbNames = (NMR_TO_PDB_NAMES.get(atomName) || []).slice();
    if (atomName === 'N') pdbNames.push('N');
    else if (atomName === 'Cα') pdbNames.push('CA');
    else if (atomName === 'Cβ') pdbNames.push('CB');
    else if (atomName === "C'") pdbNames.push('C');
    else if (atomName === 'O') pdbNames.push('O');
    else {
      const match = atomName.match(/^([CNO])([αβγδεζη])(\d*)$/);
      if (match) pdbNames.push(`${match[1]}${REVERSE_GREEK[match[2]]}${match[3]}`);
    }
    if (atomName.startsWith('H') && atomName.length > 1 && REVERSE_GREEK[atomName[1]]) {
      const base = `H${REVERSE_GREEK[atomName[1]]}`;
      pdbNames.push(base, `${base}1`, `${base}2`, `${base}3`);
    }
    if (pdbNames.length === 0) pdbNames.push(atomName);
    pdbNames.forEach((pn) => parts.push(`${resno} and .${pn}`));
  });

  return parts.length > 0 ? parts.join(' or ') : null;
};

/* ============================================================================
   TOOLBAR BUILDING BLOCKS — the viewer UI is organised in a few numbered
   ROWS, so the command bar never eats the 3D canvas:
     §0 Window (alone, top) · §1 General · §2 Molecular Styling (COLLAPSED by
     default) · §3 Toolbar = Scene | Modify | Analysis | PyMOL in ONE row.
   Inside §2 there is one ACCORDION MENU per molecule category (A Proteins ·
   B Nucleic acids · C Lipids · D Sugars · E Organic molecules · F Others), and
   every menu carries its own 3D-label switches (Residues / Residue type /
   Atom names) because the old global « 4 · Labels » row is gone.
   These tiny presentational components keep every row identical.
   ============================================================================ */
const VSection = ({ title, hint, right = null, children }) => (
  <section className="flex flex-col gap-1 bg-slate-50/80 border border-slate-200 rounded-lg px-1.5 py-1">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] font-black text-slate-700 uppercase tracking-wide whitespace-nowrap">{title}</span>
      {hint && <span className="text-[9px] text-slate-400 truncate hidden lg:inline">{hint}</span>}
      {right}
    </div>
    <div className="flex flex-wrap items-center gap-1">{children}</div>
  </section>
);

/* One menu of §2 (A–F). The SIX menus have to hold on ONE LINE, so a closed
   button carries NOTHING but the menu name: the summary line that used to sit
   under it is gone from the interface (its live text stays in the button's
   tooltip, and the §2 header keeps summarising all six menus at once).
   The component returns a FRAGMENT, so inside the §2 grid its two children are
   grid items themselves:
     • the button, pinned to row 1 — the six of them ARE that line;
     • the parameters, which are no longer squeezed into the button's cell: they
       take the FULL WIDTH of row 2 (`col-span-full row-start-2`), right under
       the line of menus, and unfold HORIZONTALLY (flex-wrap: one « label +
       control » pair after the other). An open menu therefore costs two or
       three compact lines instead of a tall column that pushed the five other
       menus onto other rows.
   The placement is explicit (row 1 / row 2), so it does not depend on the
   auto-flow of whichever menu happens to be open. */
const VMenu = ({ open, onToggle, id, label, summary, accent = 'blue', children }) => {
  const tone = {
    blue: { on: 'border-blue-400 bg-blue-50/60', off: 'border-slate-200 bg-white', text: 'text-blue-800' },
    violet: { on: 'border-violet-400 bg-violet-50/60', off: 'border-slate-200 bg-white', text: 'text-violet-800' },
    amber: { on: 'border-amber-400 bg-amber-50/60', off: 'border-slate-200 bg-white', text: 'text-amber-800' },
    emerald: { on: 'border-emerald-400 bg-emerald-50/60', off: 'border-slate-200 bg-white', text: 'text-emerald-800' },
    sky: { on: 'border-sky-400 bg-sky-50/60', off: 'border-slate-200 bg-white', text: 'text-sky-800' },
    rose: { on: 'border-rose-400 bg-rose-50/60', off: 'border-slate-200 bg-white', text: 'text-rose-800' },
  }[accent] || {};
  return (
    <>
      <button type="button" id={id} onClick={onToggle} title={summary} aria-expanded={open}
        className={`row-start-1 w-full min-w-0 flex items-center justify-between gap-1 rounded-lg border px-1.5 py-1 text-left transition-colors ${open ? tone.on : tone.off} ${tone.text}`}>
        <span className="text-[11px] font-black leading-tight break-words">{label}</span>
        <span className="text-[10px] font-black shrink-0 leading-tight">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className={`col-span-full row-start-2 w-full rounded-lg border px-2 py-1.5 flex flex-wrap items-start gap-x-4 gap-y-1.5 ${tone.on}`}>
          <span className={`text-[11px] font-black leading-tight whitespace-nowrap ${tone.text}`}>{label}</span>
          {children}
        </div>
      )}
    </>
  );
};

// One labelled row of a menu (Surface · Colour · …).
const VRow = ({ label, title, children }) => (
  <div className="flex flex-wrap items-center gap-1.5" title={title}>
    <span className="text-[10px] font-black text-slate-500 uppercase w-[7rem] shrink-0 whitespace-nowrap">{label}</span>
    {children}
  </div>
);

// A compact dropdown of a menu (the same look everywhere).
const VSel = ({ value, onChange, title, width = 'w-40', disabled = false, children }) => (
  <select value={value} onChange={onChange} title={title} disabled={disabled}
    className={`border border-slate-300 rounded-md px-1.5 py-1 text-[11px] bg-white outline-none focus:border-blue-500 h-7 ${width} disabled:opacity-40 disabled:cursor-not-allowed`}>
    {children}
  </select>
);

/* The style / colour options of the Molecules bar — ONE list each, rendered for
   the main structure AND for every loaded molecule, so a per-molecule control can
   never offer a style in one row and not in another. « Sticks » is NGL's licorice
   (NGL 2.4 has no `stick` representation: asking for one used to draw nothing). */
const MOL_STYLE_OPTIONS = (
  <>
    <option value="auto">Auto</option>
    <option value="cartoon">Cartoon</option>
    <option value="ribbon">Ribbon</option>
    <option value="ball+stick">Ball &amp; stick</option>
    <option value="sticks">Sticks</option>
    <option value="lines">Lines</option>
    <option value="spheres">Spheres</option>
    <option value="surface">Surface</option>
  </>
);
const MOL_COLOR_OPTIONS = (
  <>
    <option value="solid">Solid</option>
    <option value="element">Atom type</option>
    <option value="sugar">Sugar type</option>
    <option value="glycan">Glycan (linked sugars)</option>
    <option value="nucform">RNA/DNA conformation</option>
    <option value="motif">2° structure + motifs</option>
    <option value="lipidclass">Lipid class</option>
    <option value="chainid">Chain</option>
    <option value="resname">Residue</option>
    <option value="sstruc">2° structure</option>
    <option value="hydrophobicity">Hydrophobicity</option>
  </>
);

/* One FOLD of one molecule in the Molecules bar (Style · Colour · Transp · Move).
   The bar is 20 rem wide and lists every loaded structure, so a molecule cannot
   afford four stacked rows of controls: each group is a disclosure that carries
   its CURRENT value in the button itself (and in its tooltip), and only the open
   group renders its controls — one at a time per molecule, like the six menus of
   §2. A folded molecule therefore still says exactly how it is drawn. */
const MolFold = ({ open, onToggle, label, summary }) => (
  <button type="button" onClick={onToggle} aria-expanded={open} title={summary}
    className={`flex-1 min-w-0 flex items-center justify-between gap-0.5 px-1 py-0.5 rounded border text-[10px] font-bold transition-colors ${open ? 'bg-blue-100 border-blue-400 text-blue-800' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
    <span className="truncate">{label}</span>
    <span className="shrink-0">{open ? '▴' : '▾'}</span>
  </button>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================
/* ---- The residues the 🔢 renumbering tool lists ------------------------------
   ONE walk of a structure → the residues the viewer shows for renumbering, in the
   order the atoms come: [{ resno, resname, count }]. It fills the state the panel
   reads AND is what the panel itself calls when that state is still empty (see
   ensureResidueInfo), so the 🔢 button can never open an empty panel. PURE on a
   structure, so a test can run it on a plain object. */
const collectResidues = (structure) => {
  const out = [];
  if (!structure || typeof structure.eachAtom !== 'function') return out;
  const seen = new Map();
  try {
    structure.eachAtom((a) => {
      const rawResno = a.resno != null ? Number(a.resno) : 0;
      let entry = seen.get(rawResno);
      if (!entry) {
        entry = { resno: rawResno, resname: a.resname || '', count: 0 };
        seen.set(rawResno, entry);
        out.push(entry);
      }
      entry.count += 1;
    });
  } catch { /* a structure that cannot be walked lists nothing */ }
  return out;
};

const NMRMoleculeViewer = ({
src,
structureText,
structureTextExt,
// Structure built by the PAGE from the sequence typed on it (protein / DNA /
// RNA). It is served whenever the viewer has NOTHING loaded of its own — a
// sequence entered in the page must show its model — and it is rebuilt on
// demand by « 🧬 Build from sequence » (Modify group). A PDB the user loaded
// still wins on screen; the model simply stays one click away.
sequenceStructureText = null,
sequenceStructureExt = null,
externalLoading = false,
externalError = null,
structureFileData,
structureFileName,
structureFile,
structureFormat = 'auto',
trajectorySrc,
trajectoryFile,
trajectoryName = '',   // nom DÉCLARÉ sur l'expérience (même si le fichier n'est pas encore là)
trajectoryFallbacks = [],
trajectoryFormat = 'xtc',
onStructureFile,
onStructureSrc,
onTrajectoryFile,
driveNaming = null,   // naming context → archive chosen structure files to Drive
onAtomClick,
selectedKeys,
manualKeys = [],
moleculeType = 'protein',
smiles = '',
// SMILES of the DOCKED ligand (a docking run keeps the receptor in `src` and the
// ligand's SMILES on the experiment): it is what the Molecules bar shows in its
// SMILES fold when the page provides no `smiles` of its own. When NEITHER is
// given, the viewer resolves the SMILES of the ligand the structure really
// declares (its HETATM code, via the RCSB Chemical Component Dictionary — see
// utils/ligandSmiles.js) and reports it back through `onLigandSmiles`, so the page
// can keep it in its own condition.
ligandSmiles = '',
onLigandSmiles,
parsedSeq = [],
residueOffset = 0,
atomRenames,
onAtomRenames,
namingConvention = 'nmr',
resRenumber,
onResRenumber,
onStructureSequence,
height = '520px',
}) => {
// 3D viewport height — the viewer is RESIZABLE via the drag handle below it.
// OPENING A PAGE starts the canvas a THIRD SHORTER than the height the page
// asks for (NMR asks 1000 px, DNA/RNA 1100 px): the command bars above and the
// plots below then all fit on screen, and the drag handle still sets whatever
// the user wants for that page — the adjustable height itself is unchanged.
const OPEN_HEIGHT_FACTOR = 2 / 3;   // −1/3 at page open
const [viewH, setViewH] = useState(() => {
  const m = /^(\d+)/.exec(String(height || '520px'));
  const wanted = m ? parseInt(m[1], 10) : 520;
  return Math.max(240, Math.round(wanted * OPEN_HEIGHT_FACTOR));
});
const resizeRef = useRef(null); // { startY, startH } while dragging

// ---- Retractable viewer window ----
// "⬇ Minimize" collapses the 3D viewport to a thin bar (the stage stays
// mounted, so the structure and trajectory are never lost); "⬆ Expand"
// restores it and tells NGL that the canvas size changed.
const [viewerCollapsed, setViewerCollapsed] = useState(false);
// §2 « Molecular Styling » is an ACCORDION that starts COLLAPSED: the command
// bar must never push the 3D canvas off-screen, and the menus are a
// "configure once" tool (the summary line on the header keeps saying what the
// current styles are, so a closed section is never silent).
const [stylingOpen, setStylingOpen] = useState(false);
/* ⚙ SETTINGS WHEEL of the Molecules bar. It owns the two EDITABLE palettes the
   per-molecule colourings read (« Atom type » → the element table, « Sugar type »
   → the per-sugar identity table) plus the gradient pair that every menu shares.
   The palettes are React state (so the wheel updates at once and the swatch grid
   is never stale) and an effect copies them into the mutable stores the NGL
   schemes read — the very stores the wheels' comments have always described. */
const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
// The styling bar of PART 4 (the ONLY styling UI) collapses to a thin tab, so the
// whole canvas is free again without losing anything — persisted like the rest.
const [molBarCollapsed, setMolBarCollapsed] = useState(() => {
  try { return localStorage.getItem('labViewerStylingBarCollapsed') === 'on'; } catch { return false; }
});
useEffect(() => {
  try { localStorage.setItem('labViewerStylingBarCollapsed', molBarCollapsed ? 'on' : 'off'); } catch { /* ignore */ }
}, [molBarCollapsed]);
// The Selections bar is the OTHER half of the styling UI and lives on the LEFT of
// the canvas (the styling bar keeps the right side): the selections a PyMOL script
// defines, each with its own styles. Collapsed and persisted the same way, so the
// two panels never fight for the same corner.
const [selBarCollapsed, setSelBarCollapsed] = useState(() => {
  try { return localStorage.getItem('labViewerSelBarCollapsed') === 'on'; } catch { return false; }
});
useEffect(() => {
  try { localStorage.setItem('labViewerSelBarCollapsed', selBarCollapsed ? 'on' : 'off'); } catch { /* ignore */ }
}, [selBarCollapsed]);
// The NEW palettes of the request, edited by the same ⚙ wheel and read live by the
// schemes: the 20 residues, the 5 base types, the 3 charges, the 14 lipid classes and
// the 29 sugar types (the wheel's own state, persisted like the two originals).
const [residueColors, setResidueColors] = useState(() => loadPalette('labViewerResidueColors', RESIDUE_COLOR_PALETTE));
const [baseTypeColors, setBaseTypeColors] = useState(() => loadPalette('labViewerBaseTypeColors', BASE_IDENTITY_COLORS));
const [chargeColors, setChargeColors] = useState(() => loadPalette('labViewerChargeColors', CHARGE_COLORS));
const [lipidTypeColors, setLipidTypeColors] = useState(() => loadPalette('labViewerLipidTypeColors', LIPID_CLASS_COLORS));
const [sugarTypeColors, setSugarTypeColors] = useState(() => loadPalette('labViewerSugarTypeColors', SUGAR_TYPE_COLORS));
// 🔗 The CHAIN palette (« Color by : Chain ») — React state (the ⚙ wheel repaints at
// once), persisted like the others, and copied into the mutable store the lab-chain
// scheme reads (see the effect below): ONE palette, so the wheel and every coloured
// molecule can never disagree.
const [chainColors, setChainColors] = useState(() => loadPalette('labViewerChainColors', CHAIN_COLOR_PALETTE));
const [elementColors, setElementColors] = useState(() => loadPalette(ELEMENT_COLORS_KEY, ELEMENT_COLOR_PALETTE));
const [sugarColors, setSugarColors] = useState(() => loadPalette(SUGAR_COLORS_KEY, SUGAR_IDENTITY_COLORS));
// The NUCLEIC reading of PART 3 has its own two palettes in the same wheel: the six
// forms and the two motifs, each one a colour the user can tune (a form that is
// hard to tell from another is exactly what a good palette fixes).
const [nucleicFormColors, setNucleicFormColors] = useState(() => loadPalette(NUCLEIC_FORM_COLORS_KEY, DEFAULT_NUCLEIC_FORM_COLORS));
const [nucleicMotifColors, setNucleicMotifColors] = useState(() => loadPalette(NUCLEIC_MOTIF_COLORS_KEY, DEFAULT_NUCLEIC_MOTIF_COLORS));
// ONE swatch = ONE entry of the palette (the element is the key, the hex the value).
const setElementColor = (el, hex) => setElementColors((prev) => ({ ...prev, [el]: hex }));
const setSugarColor = (res, hex) => setSugarColors((prev) => ({ ...prev, [res]: hex }));
const resetElementColors = () => setElementColors({ ...ELEMENT_COLOR_PALETTE });
const resetSugarColors = () => setSugarColors({ ...SUGAR_IDENTITY_COLORS });
// ONE swatch of the nucleic palettes (the key is the FORM · 'gquad' · 'hairpin').
const setNucleicFormColor = (form, hex) => setNucleicFormColors((prev) => ({ ...prev, [form]: hex }));
const setNucleicMotifColor = (motif, hex) => setNucleicMotifColors((prev) => ({ ...prev, [motif]: hex }));
const resetNucleicFormColors = () => setNucleicFormColors({ ...DEFAULT_NUCLEIC_FORM_COLORS });
const resetNucleicMotifColors = () => setNucleicMotifColors({ ...DEFAULT_NUCLEIC_MOTIF_COLORS });
const [captureMsg, setCaptureMsg] = useState('');
// Message of the §1 « ⬇ PDB » button (structure / current-frame snapshot).
const [pdbMsg, setPdbMsg] = useState('');
useEffect(() => {
  const move = (ev) => {
    if (!resizeRef.current) return;
    const dh = ev.clientY - resizeRef.current.startY;
    setViewH(Math.max(240, Math.min(2400, resizeRef.current.startH + dh)));
  };
  const up = () => { resizeRef.current = null; };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  return () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
}, []);

// NGL must be told when the container grew/shrunk (it only auto-listens to
// window resizes, not to our drag handle).
useEffect(() => {
  try { if (stageRef.current) stageRef.current.handleResize(); } catch {}
}, [viewH]);

// When the viewer is re-expanded after being minimized (canvas height went
// 0 → viewH), NGL must be told the size changed or the picture stays blank.
useEffect(() => {
  if (viewerCollapsed) return;
  try {
    if (stageRef.current) {
      stageRef.current.handleResize();
      if (stageRef.current.viewer) stageRef.current.viewer.requestRender();
    }
  } catch { /* ignore */ }
}, [viewerCollapsed]);

const containerRef = useRef(null);
const stageRef = useRef(null);
const stageReadyRef = useRef(null);
const componentRef = useRef(null);
const highlightCompRef = useRef(null);
const manualHighlightCompRef = useRef(null);
const stripHighlightCompRef = useRef(null);   // whole-residue amber highlight from a tick click
const stripResidueRiRef = useRef(null);       // residue index (ri) selected via the strip
const manualSigRef = useRef('');              // signature of the last green "assigned atoms" highlight
const manualSigCompRef = useRef(null);        // the component that signature was built for (structure reload)
const labelCompRef = useRef(null);
const sidechainCompRef = useRef(null);
const abortRef = useRef(null); // { token, label, cancel } of the active long-running operation (structure / trajectory load)

const [file, setFile] = useState(null);
const [pdbId, setPdbId] = useState('');
const [pendingFileBatch, setPendingFileBatch] = useState(null); // File[] waiting for the "replace or keep both?" choice
const [pendingSrc, setPendingSrc] = useState(null); // a PDB code / URL waiting for the "replace or keep both?" choice
const lastAskedSrcRef = useRef(null); // last PDB code/URL we asked about, so the same value is never asked twice
const [dragMove, setDragMove] = useState(false); // move the selected structure with the mouse instead of typing X/Y/Z
const dragMoveRef = useRef(null); // { comp, pos, last } — active mouse drag-to-move session
const [loadRequest, setLoadRequest] = useState(null);
const [status, setStatus] = useState('idle');
const statusRef = useRef(status); // mirror for event handlers (file-change dialog)
statusRef.current = status;
const [errorMsg, setErrorMsg] = useState('');
const showManualHighlight = useShowAssignedFlag(); // green "assigned" atoms toggle (shared with the simulated spectra)
const [hoverInfo, setHoverInfo] = useState(null);
// Per-CATEGORY 3D labels (the former global « 4 · Labels » section): each
// molecule menu carries its own Residues / Residue type / Atom names switches,
// so « Residues » ticked in the Proteins menu labels PROTEINS ONLY. The label
// text itself stays context-aware (see build3dLabelMap): protein / nucleic
// rules for the polymer menus, the residue tag for ligands, {resname}{resno}
// for water and ions.
const [catLabels, setCatLabels] = useState(() => loadCatLabels());
const catLabelsRef = useRef(catLabels);
catLabelsRef.current = catLabels;
// Update ONE switch of ONE category (every menu goes through this) and persist.
const setCatLabel = (cat, key, value) => setCatLabels((prev) => {
  const next = { ...prev, [cat]: { ...(prev[cat] || CAT_LABEL_DEFAULTS), [key]: value } };
  saveCatLabels(next);
  return next;
});
const anyLabelOn = anyCatLabel(catLabels);
const catLabelSig = catLabelsSig(catLabels);

// ---- 📏 Atom distance measurement ----------------------------------------
// While ON, clicking TWO atoms draws an NGL "distance" representation between
// them — a line with a live label in Å (labelUnit 'angstrom'). Each completed
// pair immediately accepts the next one, so you can walk along a chain of
// distances. The drawn lines are normal NGL representations that survive
// rotation/zoom and are removed with ✕ (or automatically when a structure is
// reloaded / the viewer is cleared).
const [measureMode, setMeasureMode] = useState(false);
const [measurePending, setMeasurePending] = useState(null); // label of the 1st picked atom, awaiting the 2nd
const [measureInfo, setMeasureInfo] = useState('');         // instruction / last-action status line
const measureModeRef = useRef(false);
measureModeRef.current = measureMode;
const measurePendingRef = useRef(null); // { comp, atomIndex, label } of the 1st picked atom
const measureRepsRef = useRef([]);      // [{ comp, elem }] NGL 'distance' representations that were drawn
const [rebuildMsg, setRebuildMsg] = useState('');
const rebuildMsgTimerRef = useRef(null);
const flashRebuildMsg = (m) => {
  setRebuildMsg(m);
  clearTimeout(rebuildMsgTimerRef.current);
  rebuildMsgTimerRef.current = setTimeout(() => setRebuildMsg(''), 6000);
};

// ---- 2D↔3D atom-name synchronisation ---------------------------------------
// Holds the map { NGL atom index → 2D SMILES atom name } for organic/lipid/
// sugar molecules generated from `smiles`. The label pipeline reads this map
// (see displayAtomName) so the 3D labels display EXACTLY the names assigned
// by the 2D formula — the 2D generation code is never modified.
const [smilesNameMap, setSmilesNameMap] = useState(null);
const smilesNameMapRef = useRef(null);
smilesNameMapRef.current = smilesNameMap;
const [sidechainStyle, setSidechainStyle] = useState('licorice');
// Visualization style of every molecule CATEGORY (Proteins / Nucleic acids /
// Lipids / Organic molecules / Others) — replaces the old global Side /
// Backbone / Mol / Large / Water selectors. Persisted like Fog / Shadows.
const [catStyles, setCatStyles] = useState(() => loadCatStyles());
const catStylesRef = useRef(catStyles);
catStylesRef.current = catStyles;

/* ---- THE STYLING SECTIONS (PART 4) — the state behind the molecule bar -------
   `sectionLooks` holds ONE TREE PER SECTION — the look of every row of that
   molecule — and `kindLooks` is the PERSISTED look of every KIND, i.e. the look a
   NEW molecule of that kind opens with (it follows the last choice, so the
   dropdowns always show what is really drawn). `sectionVis` is the ✔ of a section
   (water and ions start switched OFF), and `sectionCatalog` is what the sections of
   every loaded molecule ARE — enumerated once per structure by
   listMoleculeSections, so the renderer and the bar read the very same list. */
const [kindLooks, setKindLooks] = useState(() => loadSectionLooks());
const kindLooksRef = useRef(kindLooks);
kindLooksRef.current = kindLooks;
const [sectionLooks, setSectionLooks] = useState({});   // { sectionId: tree }
const sectionLooksRef = useRef(sectionLooks);
sectionLooksRef.current = sectionLooks;
const [sectionVis, setSectionVis] = useState({});       // { sectionId: bool }
const sectionVisRef = useRef(sectionVis);
sectionVisRef.current = sectionVis;
// The 3D labels of ONE molecule section (the request: the label switches of the old
// §2 menus are imported here, one set PER SECTION, so « Residues » ticked on chain A
// labels chain A only). Default: nothing labelled.
const SECTION_LABEL_DEFAULTS = { residues: false, residueType: false, atoms: false };
const [sectionLabels, setSectionLabels] = useState({});  // { sectionId: {residues, atoms, residueType} }
const sectionLabelsRef = useRef(sectionLabels);
sectionLabelsRef.current = sectionLabels;
const setSectionLabel = (id, key, value) => setSectionLabels((prev) => ({
  ...prev,
  [id]: { ...SECTION_LABEL_DEFAULTS, ...(prev[id] || null), [key]: value },
}));
const [sectionCatalog, setSectionCatalog] = useState({});   // { molKey: { name, sections } }
const sectionCatalogRef = useRef(sectionCatalog);
sectionCatalogRef.current = sectionCatalog;
const sectionCatalogSigRef = useRef('');
// The ✏️ name a molecule shows in its section header (the file, the extra's name).
const molNamesRef = useRef({ main: 'Main' });
// The tree of ONE section: the one the user has built, or — first time — the look
// the KIND was left with (kindLooks), which is what makes a fresh load open with
// the last session's choices AND report them in the dropdowns.
const sectionTreeOf = (id, kind) => sectionLooksRef.current[id] || initialSectionTree(kindLooksRef.current, kind);
// The sections of ONE component: enumerated once per structure (the renderer runs on
// every rebuild), remembered in a ref for the renderer and in the state for the bar.
// A section id is GLOBALLY unique — `<molecule>::<section key>` — so its look and
// its ✔ survive a rebuild and never collide with another molecule's.
const ensureSections = (comp, molKey) => {
  const structure = comp && comp.structure;
  if (!structure) return [];
  const cached = sectionCatalogRef.current[molKey];
  if (cached && cached.structure === structure) return cached.sections;
  const sections = listMoleculeSections(structure).map((s) => ({ ...s, id: `${molKey}::${s.key}` }));
  const entry = { structure, name: molNamesRef.current[molKey] || 'Main', sections };
  const next = { ...sectionCatalogRef.current, [molKey]: entry };
  sectionCatalogRef.current = next;
  const sig = Object.keys(next).map((k) => `${k}:${(next[k].sections || []).map((s) => s.id).join('|')}`).join(';');
  if (sig !== sectionCatalogSigRef.current) {
    sectionCatalogSigRef.current = sig;
    setSectionCatalog(next);
  }
  return sections;
};
// The trees of every section of ONE component, as buildSectionReps wants them.
const sectionTreesOf = (sections) => {
  const out = {};
  (sections || []).forEach((s) => { out[s.id] = sectionTreeOf(s.id, s.kind); });
  return out;
};
// The sections switched OFF (the ✔ of the bar): a molecule of water / an ion is off
// until its ✔ is ticked (the request: a solvated box must not block the view).
// The set holds the GLOBAL ids of the sections (`<molecule>::<key>`, see
// ensureSections) — the very keys the bar writes with toggleSectionVisible — and
// buildSectionReps accepts them as well as the bare local keys.
const hiddenSectionIds = (sections) => {
  const set = new Set();
  (sections || []).forEach((s) => {
    const v = sectionVisRef.current[s.id];
    if ((v === undefined ? KIND_VISIBLE_BY_DEFAULT[s.kind] : v) === false) set.add(s.id);
  });
  return set;
};
// ONE row changed in the bar: the whole hierarchy goes through the two pure moves of
// PART 4 (setRowSectionField / setGeneralSectionField). The persisted look of the
// KIND follows the change, so the next molecule of that kind opens the same way.
const setSectionField = (id, kind, sub, field, value) => {
  leaveLightMode();
  const nextTree = setRowSectionField(sectionTreeOf(id, kind), kind, sub, field, value);
  setSectionLooks((prev) => ({ ...prev, [id]: nextTree }));
  setKindLooks((prev) => {
    const next = { ...prev, [kind]: nextTree[kind] };
    saveSectionLooks(next);
    kindLooksRef.current = next;
    return next;
  });
};
// ↺ ONE row / ↺ the whole section: back to the DEFAULTS of that kind.
const resetSectionRowLook = (id, kind, sub) => {
  leaveLightMode();
  const nextTree = resetSectionRow(sectionTreeOf(id, kind), kind, sub);
  setSectionLooks((prev) => ({ ...prev, [id]: nextTree }));
};
const resetSectionKindLook = (id, kind) => {
  leaveLightMode();
  const nextTree = resetSectionKind(sectionTreeOf(id, kind), kind);
  setSectionLooks((prev) => ({ ...prev, [id]: nextTree }));
};
// The ✔ of ONE section (water / ions start OFF).
const sectionVisible = (id, kind) => {
  const v = sectionVis[id];
  return v === undefined ? KIND_VISIBLE_BY_DEFAULT[kind] !== false : v !== false;
};
const toggleSectionVisible = (id, kind) => {
  leaveLightMode();
  setSectionVis((prev) => ({ ...prev, [id]: !sectionVisible(id, kind) }));
};
// 🎨 Copy — hand the look of ONE molecule to every OTHER molecule of the bar.
const copySectionsToAll = () => {
  const source = sectionCatalogRef.current[selectedMolKey];
  if (!source) return;
  const srcById = {};
  (source.sections || []).forEach((s) => { srcById[s.key] = sectionTreeOf(s.id, s.kind); });
  const looks = { ...sectionLooksRef.current };
  Object.keys(sectionCatalogRef.current).forEach((molKey) => {
    if (molKey === selectedMolKey) return;
    (sectionCatalogRef.current[molKey].sections || []).forEach((s) => {
      if (srcById[s.key]) looks[s.id] = srcById[s.key];
    });
  });
  setSectionLooks(looks);
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};
// ---- « Molecules » entries of the bar (extra structures / PDB MODELs) ----
// extraMols = extra loaded structure files (each its own NGL component); the
// "Molecules" selector shows exactly one at a time. Multi-MODEL PDB files
// (NMR ensembles / docking clusters) are split into one entry per MODEL by the
// main-load effect, so they appear in the same "Molecules" selector. Each entry
// also carries its own style/color overrides ({ style, color }) so every chain /
// molecule can be rendered independently from the global selectors.
// It is DECLARED HERE, before the name-sync effect right below, because that
// effect reads it in its dependency array — a read that happens DURING render:
// declaring the state further down threw « Cannot access 'extraMols' before
// initialization » and crashed every page opening the viewer (e.g. docking).
const [extraMols, setExtraMols] = useState([]);    // [{ id, name, style, color }]

// ONE signature of EVERY styling choice of the bar — the persisted per-kind looks,
// the per-molecule trees, the ✔ of the sections and the sections themselves. The
// rebuild effects compare it, so a change to any dropdown rebuilds exactly once and
// a change to nothing rebuilds nothing. The two ends of the GRADIENT ramp are part
// of it: the ramp is an NGL scheme read at render time, so a swatch only reaches the
// screen if the representations are rebuilt (see setGradientPair).
const gradientRampSignature = `${Number.isFinite((catStyles.protein || {}).gradientFrom) ? catStyles.protein.gradientFrom : ''}/${Number.isFinite((catStyles.protein || {}).gradientTo) ? catStyles.protein.gradientTo : ''}`;
const styleSignature = `${sectionLooksSig(kindLooks)}|${JSON.stringify(sectionLooks)}|${JSON.stringify(sectionVis)}|${Object.keys(sectionCatalog).map((k) => `${k}:${(sectionCatalog[k].sections || []).map((s) => s.id).join('|')}`).join(';')}|ramp:${gradientRampSignature}`;
// The NAME every molecule shows in its space: the main structure takes its file
// name, an extra molecule its own — kept in a ref the section enumeration reads, and
// pushed into the catalog when it changes so the bar never shows a stale name.
useEffect(() => {
  const names = { main: file ? `Main (${file.name})` : 'Main' };
  extraMols.forEach((m) => { names[m.id] = m.name; });
  molNamesRef.current = names;
  const next = { ...sectionCatalogRef.current };
  let changed = false;
  Object.keys(next).forEach((k) => {
    const name = names[k];
    if (name && next[k].name !== name) { next[k] = { ...next[k], name }; changed = true; }
  });
  if (changed) { sectionCatalogRef.current = next; setSectionCatalog(next); }
}, [file, extraMols]);
// Update ONE field of ONE category (every menu goes through this). A change made
// here IS a styling choice, so it also leaves the fast starting layout of a large
// system (leaveLightMode): the menu the user just moved is really applied.
const setCatStyle = (cat, key, value) => {
  leaveLightMode();
  setCatStyles((prev) => {
    const cur = prev[cat] || {};
    const next = { ...cur, [key]: value };
    // A LOOK field changed FROM THIS MENU stops following the general look: it is
    // that menu's own choice from now on (the ↺ beside it hands it back).
    if (isLookKey(key)) next.ovr = { ...(cur.ovr || DEFAULT_LOOK_OVERRIDES), [key]: true };
    return { ...prev, [cat]: next };
  });
};
// Pick a surface COLOUR. A colouring needs a surface to sit on — both ESP and a
// Custom colour switch the surface ON (transparent) when it is hidden, so the
// choice is never silently invisible. A colour is a styling choice too, so it
// leaves the lightweight layout as well.
const setSurfaceColor = (cat, value) => {
  leaveLightMode();
  setCatStyles((prev) => {
    const cur = prev[cat] || {};
    const next = { ...cur, surfaceColor: value };
    if ((value === 'esp' || value === 'custom') && (!next.surface || next.surface === 'hide')) next.surface = 'transparent';
    next.ovr = { ...(cur.ovr || DEFAULT_LOOK_OVERRIDES), surfaceColor: true };
    return { ...prev, [cat]: next };
  });
};
/* ---- The GENERAL look of §2 (the override hierarchy) ------------------------
   It is the ONE place a change reaches all six menus at once: a field written
   here is stored as the general value AND pushed into every menu that Follows it
   (overridesLook), while a menu that overrides that field keeps its own value
   untouched. It is persisted on its own (labViewerGeneralLook) and it also feeds
   the gradient ramp of the whole viewer — one pair of colours, one scheme. */
const [generalLook, setGeneralLook] = useState(() => loadGeneralLook());
const setGeneralLookField = (key, value) => {
  leaveLightMode();   // the general look is a styling choice, not only a colour
  setGeneralLook((prev) => ({ ...prev, [key]: value }));
  setCatStyles((prev) => applyGeneralField(prev, key, value));
};
// Hand ONE field of ONE menu back to the general look: it takes the general value
// again and the override flag is dropped, so the next general change reaches it.
const followGeneralLook = (cat, key) => {
  leaveLightMode();
  setCatStyles((prev) => yieldLookField(prev, cat, key, generalLook[key]));
};
const followsGeneral = (cat, key) => !overridesLook(catStyles[cat], key);
// The two ends of the gradient ramp, as the ⚙ wheel shows them (one pair shared
// by every menu: the ramp is a single NGL scheme, see gradientColorStore).
const gradientPair = {
  from: Number.isFinite((catStyles.protein || {}).gradientFrom) ? catStyles.protein.gradientFrom : DEFAULT_GRADIENT_COLORS.from,
  to: Number.isFinite((catStyles.protein || {}).gradientTo) ? catStyles.protein.gradientTo : DEFAULT_GRADIENT_COLORS.to,
};
// Write BOTH ends of the ramp through the general look AND into every menu, so the
// six menus follow, the reference feed (catStyles.protein) sees the new pair, and
// the ⚙ swatches can never be blocked by an old per-menu override (setGradientPairIn).
const setGradientPair = (key, hex) => {
  setGeneralLookField(key, hex);                                // the general value + every menu that Follows
  setCatStyles((prev) => setGradientPairIn(prev, key, hex));     // …and EVERY other menu, override or not
};
// ⇄ reverses the ramp (the ramp itself always runs first residue → last; swapping
// its two ends is what « reverse » means — same rule as the menu's ⇄ button).
const swapGeneralGradient = () => {
  const { from, to } = gradientPair;
  setGradientPair('gradientFrom', to);
  setGradientPair('gradientTo', from);
};
// ↺ Put the GENERAL look back to its defaults: every menu that Follows a field
// takes the default again (a menu that overrides it keeps its own value).
const resetGeneralLook = () => {
  leaveLightMode();
  setGeneralLook({ ...DEFAULT_GENERAL_LOOK });
  setCatStyles((prev) => defaultGeneralLookIn(prev));
};
// Open/closed state of the five styling menus (accordion: one at a time) and of
// the residue-sequence strip above the viewport (collapsible: it used to eat
// too much room on long sequences).
const [openMenu, setOpenMenu] = useState(null);
const [stripCollapsed, setStripCollapsed] = useState(() => {
  try { return localStorage.getItem('labViewerStripCollapsed') === 'on'; } catch { return false; }
});

// ---- Multiple structures & multi-model PDB (docking clusters: HADDOCK/AutoDock) ----
// `extraMols` / `setExtraMols` are declared ABOVE, just before the name-sync
// effect that lists them (a dependency array is read during render, so the state
// binding must exist before it).
const [visibleMolKeys, setVisibleMolKeys] = useState(() => new Set(['main'])); // multi-select: which structures are shown
const [selectedMolKey, setSelectedMolKey] = useState('main'); // active entry in the Molecules bar (click → select + centre)
// Per-molecule overrides for the MAIN structure — same controls as the extra
// structures (style / colour / transparency). "auto" follows the global
// Backbone / Molecule Style selectors (the classic main rendering).
const [mainMol, setMainMol] = useState({ style: 'auto', color: '', colorMode: 'element', transparency: 0 });
const mainMolRef = useRef(mainMol);
mainMolRef.current = mainMol;
const [mainPos, setMainPos] = useState([0, 0, 0]); // main structure translation (Å), settable via Move X/Y/Z or ✋ Drag
// Which FOLD of which molecule is open in the Molecules bar — one group at a
// time per molecule (Style · Colour · Transp · Move), so the bar stays compact
// however many structures are loaded. Keyed by the molecule key ('main' or an
// extra structure id), and forgotten when that molecule is deleted.
const [molFold, setMolFold] = useState({});   // { [molKey]: 'style' | 'color' | 'transp' | 'move' }
const toggleMolFold = (key, section) => setMolFold((prev) => ({ ...prev, [key]: prev[key] === section ? null : section }));
const foldOpen = (key, section) => molFold[key] === section;
const [residueTicks, setResidueTicks] = useState([]); // [{ resno, resname, code, chainid }] — sequence strip above the 3D view
const extraCompsRef = useRef([]);                  // [{ id, name, comp, baseReps, style, color }]
// "⚡ ESP" electrostatic-potential overlay — an optional extra NGL `surface`
// representation per molecule component, coloured by NGL's built-in
// "electrostatic" colour scheme. It is kept apart from the per-molecule base
// representations so the overlay SURVIVES style rebuilds (only the base reps are
// removed there) and is forgotten together with its component.
const espRepsRef = useRef({});                     // molKey → the live ESP surface representation
const [espMolKeys, setEspMolKeys] = useState(() => new Set()); // molecules currently showing an ESP overlay
// Colour-scale limits for the ⚡ ESP ramp, in kcal/mol: potentials ≤ −neg are
// full red (negative), 0 is white (neutral) and ≥ +pos are full blue
// (positive). NGL's own default domain is ±50, which is so wide that most of a
// surface looks white; a tighter range (default ±15) makes the red/blue poles
// clearly visible. Saved so the choice persists across pages.
const [espLimits, setEspLimits] = useState(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('labViewerEspLimits') || 'null');
    if (Array.isArray(raw) && raw.length === 2 && raw.every((n) => Number.isFinite(n) && n > 0)) {
      return [Math.min(500, Math.max(0.5, raw[0])), Math.min(500, Math.max(0.5, raw[1]))];
    }
  } catch { /* ignore */ }
  return [15, 15];
});
const espLimitsRef = useRef(espLimits);
espLimitsRef.current = espLimits;
useEffect(() => {
  try { localStorage.setItem('labViewerEspLimits', JSON.stringify(espLimits)); } catch { /* ignore */ }
}, [espLimits]);
// Files chosen as "additional molecules" that must wait until the MAIN structure
// has finished loading — the main load calls stage.removeAllComponents(), which
// would wipe any component added concurrently. They are flushed once the main
// structure is ready (status === 'ready'), then cleared.
const pendingExtraFilesRef = useRef([]);           // [{ file, n }]

// Remove every extra uploaded molecule (its NGL components). Called at the START
// of any new main-structure load — NOT after it — so a freshly-selected batch
// of files is never wiped by the main load that runs concurrently with them.
const clearExtraMolecules = useCallback(() => {
  extraCompsRef.current.forEach(({ comp }) => {
    try { if (stageRef.current) stageRef.current.removeComponent(comp); } catch {}
  });
  extraCompsRef.current = [];
  pendingExtraFilesRef.current = [];
  setExtraMols([]);
  setVisibleMolKeys(new Set(['main']));
  setSelectedMolKey('main');
}, []);

// ---- Atom renaming (3D, post-generation) ----
const [renames, setRenames] = useState(() => (atomRenames && typeof atomRenames === 'object' ? { ...atomRenames } : {}));
const renamesRef = useRef(renames);
renamesRef.current = renames;

// ---- Residue renumbering (3D labels / analysis numbering) ----
// Map of { originalResno: newResno } — lets the user renumber residues when a
// PDB does not start at 1 (or any custom renumbering).
const [renumberMap, setRenumberMap] = useState(() => (resRenumber && typeof resRenumber === 'object' ? { ...resRenumber } : {}));
const [showRenumberPanel, setShowRenumberPanel] = useState(false);
const [residueInfo, setResidueInfo] = useState([]); // [{ resno, resname, count }]
const [renumberFrom, setRenumberFrom] = useState(1); // starting number for "Renumber from"
const displayResno = (resno) => {
  const v = renumberMap[String(resno)];
  return v != null ? v : resno;
};
const commitRenumber = (next) => {
  setRenumberMap(next);
  if (typeof onResRenumber === 'function') onResRenumber(next);
};
// The 🔢 panel must NEVER open empty. The state below is filled by the effect that
// collects the atoms of the structure, but a click on 🔢 has to work even when that
// effect has not run (or has been swallowed): this walks the structure ON DEMAND and
// returns the residue list, so the button always shows its specification — the report
// was « the renumber key does not do anything nor show specifications ».
const ensureResidueInfo = () => {
  const structure = componentRef.current && componentRef.current.structure;
  const list = collectResidues(structure);
  if (list.length) setResidueInfo(list);
  return list.length ? list : residueInfo;
};
const toggleRenumberPanel = () => {
  ensureResidueInfo();
  setShowRenumberPanel((v) => !v);
};

// Renumber every residue consecutively starting from the user-chosen number
// (residue 1 → start, residue 2 → start+1, …). The list it walks comes from the
// state, or straight from the structure when the state is still empty.
const applyRenumberFrom = () => {
  const start = parseInt(renumberFrom, 10);
  if (!Number.isFinite(start)) return;
  const list = residueInfo.length ? residueInfo : ensureResidueInfo();
  const next = {};
  list.forEach((r, i) => { next[String(r.resno)] = start + i; });
  commitRenumber(next);
};

// Sync externally-provided residue renumbering (e.g. restored from the active test)
useEffect(() => {
  if (resRenumber && typeof resRenumber === 'object') {
    setRenumberMap((prev) => {
      const next = { ...resRenumber };
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }
}, [resRenumber]);

// ---- Lightweight-rendering mode (large structures) -------------------------
// Large systems (protein in membrane + explicit solvent) are rendered in FULL
// but START with lightweight instanced representations, so the structure is
// visible at once instead of waiting for 100 000 atoms to be styled. This flag
// therefore describes the STARTING layout only: the first styling gesture in
// §2 « Molecular Styling » (a category menu, the side-chain selector, a colour
// swatch, the docking role styles) calls leaveLightMode() and the system is
// re-drawn with the per-category representations the user asked for. There is
// no « ✨ Full detail » button any more — the gesture itself is the switch.
const [lightRender, setLightRender] = useState(false);  // true → lightweight starting reps for big systems
const [lightInfo, setLightInfo] = useState(null);       // { nAtoms, size } → said in the « Large system » row
const lightRenderRef = useRef(false);                   // synchronous mirror for addDefaultReps / sidechain effect
lightRenderRef.current = lightRender;

// Leave the fast starting layout for good. Every styling control calls this
// BEFORE applying the chosen value, so the rebuild it triggers (the lightRender
// effect below, or the catStyles effect) already draws the category
// representations: the menu the user just touched is really applied to a large
// system — no button, and nothing to unlock by hand.
const leaveLightMode = () => {
  if (!lightRenderRef.current) return;   // already drawn with the real styles
  lightRenderRef.current = false;        // read synchronously by addDefaultReps
  setLightRender(false);                 // → the effect below rebuilds the main structure
};
// Water is NOT drawn in lightweight mode by default (it dominates the atom
// count of membrane systems); a checkbox re-enables it as tiny spheres.
const [showLargeWater, setShowLargeWater] = useState(false);
const showLargeWaterRef = useRef(false);
showLargeWaterRef.current = showLargeWater;
// Whether the loaded structure contains any non-protein atoms (ligands,
// lipids, ions, water) — controls the "Molecule Style" dropdown visibility.
const [hasNonProtein, setHasNonProtein] = useState(false);
// Per-CATEGORY content of the loaded structure: atom counts of protein /
// nucleic / others (water + ions) / organic (ligands) / lipid plus the lipid
// residue names that were recognised. Filled by catSelectionsFor on load, and
// used by the styling menus to state what each one can act on (and to keep the
// Lipids menu honest when a file contains no lipid at all).
const [catInfo, setCatInfo] = useState(null);
// The per-category styles of the five styling menus are saved on every change —
// Fog / Shadows / clipping use the same localStorage convention.
useEffect(() => { saveCatStyles(catStyles); }, [catStyles]);
// How the atoms of a large system are drawn in lightweight mode — ONE style for
// everything: 'lines' (bonds, the default: the cheapest style that still shows
// the shape), 'spheres' (instanced spacefill) or 'dots' (one point per atom —
// the absolute lightest). Water is excluded from the default view whatever the
// style (see addDefaultReps / the "💧 Water" checkbox).
const [largeStyle, setLargeStyle] = useState('lines');
const largeStyleRef = useRef('lines');
largeStyleRef.current = largeStyle;

// Rebuild the base representations when the lightweight mode is LEFT (a styling
// gesture on a large system — see leaveLightMode) or when the large-style
// selector / the 💧 Water checkbox of the §2 → F · Others row changes.
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready') return;
  baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
  baseCompsRef.current = [];
  buildMainReps();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [lightRender, largeStyle, showLargeWater, status]);

// (The former « ✨ Full detail » helper lived here. The button is gone, and its
// single useful effect now happens by itself: leaveLightMode(), called by the
// styling controls, rebuilds the main structure with the category
// representations. A large system keeps its fast starting look until it is
// actually asked to look like something else, so the §2 → F · Others
// « Large system » row is no longer a lock — it only describes that start.)
const [renameMode, setRenameMode] = useState(false);
const [renameTarget, setRenameTarget] = useState(null); // atom index being renamed
const [renameDraft, setRenameDraft] = useState('');
const [atomList, setAtomList] = useState([]);          // [{ idx, element, name, resno, resname }]
const [atomSearch, setAtomSearch] = useState('');
const [showAtomPanel, setShowAtomPanel] = useState(false);

// ---- Customisable colours (secondary structure + residue highlights) ----
// Persisted like the fog/shadow preferences; changing them re-renders the
// affected representations (see the deps of the selection / highlight effects).
const [showColoursPanel, setShowColoursPanel] = useState(false);
// The 🔬 Nucleic-acids menu (B) has a colour panel of its OWN: the shared panel
// above is about protein secondary structure (helix / sheet / loop) and had no
// meaning for a nucleic acid. This one recolours the three chemical groups —
// phosphate backbone · pentose rings · bases (see the lab-nucleic-groups scheme).
const [showNucleicColoursPanel, setShowNucleicColoursPanel] = useState(false);
// …and the 🧫 Lipids menu (C) has a third one: the three chemical PARTS of a
// lipid — headgroup · glycerol backbone · acyl chains (see the lab-lipid-groups
// scheme). Same panel, same behaviour, amber instead of violet.
const [showLipidColoursPanel, setShowLipidColoursPanel] = useState(false);
// ⚙️ Setup (§1 General) — NAMED snapshots of the whole visualisation setup: the
// saved map, the name being typed, the open/closed state of the panel and its
// feedback line (see captureViewerSetup / applyViewerSetup below).
const [showSetupPanel, setShowSetupPanel] = useState(false);
const [viewerSetups, setViewerSetups] = useState(() => loadViewerSetups());
const [setupName, setSetupName] = useState('');
const [setupMsg, setSetupMsg] = useState('');
const setupMsgTimerRef = useRef(null);   // the “✓ saved / applied” line clears itself
const [sstrucColors, setSstrucColors] = useState(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('labViewerSstrucColors') || 'null');
    if (raw && typeof raw === 'object') {
      return {
        helix: raw.helix || SSTRUC_COLOR_DEFAULTS.helix,
        sheet: raw.sheet || SSTRUC_COLOR_DEFAULTS.sheet,
        loop: raw.loop || SSTRUC_COLOR_DEFAULTS.loop,
      };
    }
  } catch { /* fall through to defaults */ }
  return { ...SSTRUC_COLOR_DEFAULTS };
});
const [selectedResidueColor, setSelectedResidueColor] = useState(() => {
  try { const v = parseInt(localStorage.getItem('labViewerSelResColor') || '', 16); if (Number.isFinite(v) && v >= 0) return v; } catch { /* default */ }
  return SELECT_COLOR_HEX;
});
const [assignedAtomColor, setAssignedAtomColor] = useState(() => {
  try { const v = parseInt(localStorage.getItem('labViewerAssignedColor') || '', 16); if (Number.isFinite(v) && v >= 0) return v; } catch { /* default */ }
  return MANUAL_COLOR_HEX;
});
const selectedResidueColorRef = useRef(selectedResidueColor);
selectedResidueColorRef.current = selectedResidueColor;
const assignedAtomColorRef = useRef(assignedAtomColor);
assignedAtomColorRef.current = assignedAtomColor;

// ---- PyMOL-style selections & effects ----
const [selections, setSelections] = useState([]);      // [{ name, expr }]
const [selStyles, setSelStyles] = useState({});        // key -> { cartoon, ribbon, tube, stick, sphere, surface, color, colorMode, transparency, sphereScale, hideFor, mat }
// PyMOL's `set … , <selection>` commands are NOT looks: they are properties of
// the ATOMS they name (« set sphere_scale, 0.6, headgroups » changes the beads
// of the headgroups wherever they are drawn, now and later). They used to be
// stored as a look keyed on their own expression — a row with no style at all —
// so the macro's 0.6 / 0.8 beads never reached the beads the script drew. They
// are kept aside here and SPLIT by the renderer.
const [selOverrides, setSelOverrides] = useState([]);  // [{ kind, value, sel }]
// ── The leaflets the viewer MEASURES on the loaded structure ────────────────
// Not `z>90`: the normal axis, the midplane and the two head clusters come from
// the geometry (see membraneLeafletsOf), and the four resulting selections —
// upper_leaflet · lower_leaflet · upper_headgroups · lower_headgroups — are
// usable in a macro like any other name, listed in the Selections bar, and
// drawn there to show which is which.
const [membraneSele, setMembraneSele] = useState({});
const [membraneInfo, setMembraneInfo] = useState(null);
// Material of the four representation families (spheres, bonds, cartoon,
// surface): NGL's own shader has roughness/metalness/opacity uniforms that its
// API does not expose (see MATERIAL_PRESETS). Persisted like the rest.
const [matSettings, setMatSettings] = useState(() => {
  try {
    const raw = localStorage.getItem(MATERIALS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
});
const [pymolActive, setPymolActive] = useState(false);
const [pymolScript, setPymolScript] = useState('');
const [pymolLog, setPymolLog] = useState('');
const [showPymolPanel, setShowPymolPanel] = useState(false);
const [autoShowSel, setAutoShowSel] = useState(true); // auto-visibility of parsed selections
const [hideAll, setHideAll] = useState(false);        // remove every representation
const [bgColor, setBgColor] = useState(() => {
  // Restored from localStorage like Fog / Shadows / Clipping, so a chosen
  // background survives a reload; anything unexpected falls back to the default.
  try {
    const v = localStorage.getItem('labViewerBg');
    if (/^#[0-9a-fA-F]{6}$/.test(v || '')) return v;
  } catch { /* private mode → default */ }
  return BG_DEFAULT;
});
const [qualityHigh, setQualityHigh] = useState(false);

// ---- Depth fog ----
// NGL's default depth fog (fogNear 50 / fogFar 100) fades distant atoms toward
// the background colour — a grey "haze" that many users find distracting. OFF by
// default; the "🌫 Fog" toolbar button re-enables it. The choice is persisted in
// localStorage so it sticks across pages and reloads.
const [fogEnabled, setFogEnabled] = useState(() => {
  try { return localStorage.getItem('labViewerFog') === 'on'; } catch { return false; }
});
const fogEnabledRef = useRef(fogEnabled);
fogEnabledRef.current = fogEnabled;

// Enable/disable NGL's depth fog on the live stage. NGL 2.4 recomputes
// scene.fog.near/far on EVERY render from parameters.fogNear/fogFar
// (Viewer.__updateClipping) and its on-screen label system dereferences
// scene.fog directly — so we must NEVER detach the fog object (that throws
// inside the render loop and freezes the whole viewer). Instead we push the
// fog transition beyond the far edge of the molecule: in the default
// "scene/relative" clip mode
//   fogNear = cDist − bRadius·(50 − fogNear)/50
// so fogNear=100 → the transition starts at cDist + bRadius (the far edge of
// the bounding sphere) → smoothstep = 0 for every atom → no visible fog, and
// the labels stay fully opaque. Re-enabling restores the NGL defaults (50/100).
const applyFog = useCallback(() => {
  const stage = stageRef.current;
  if (!stage) return;
  try {
    stage.setParameters(fogEnabledRef.current ? { fogNear: 50, fogFar: 100 } : { fogNear: 100, fogFar: 101 });
  } catch { /* ignore */ }
}, []);

// ---- Clipping plane (Scene → « ✂ Clipping ») -------------------------------
// NGL clips the scene with the camera near / far planes, derived in the default
// 'scene' + 'relative' clip mode from clipNear / clipFar (percentages of the
// scene bounding sphere) and floored by clipDist in Å (Viewer#__updateClipping,
// verified in the installed ngl 2.4):
//   camera.near = cDist − bRadius·(50 − clipNear)/50   (then max with clipDist)
//   camera.far  = cDist + bRadius·(clipFar − 50)/50
// The clipDist floor is exactly what CUTS a large complex when you zoom in close
// (everything nearer than clipDist to the camera disappears) and clipFar 100
// stops the far plane at the back edge of the sphere. « Off » therefore forces
// the camera bounds to the EXTREMES — CLIP_DEFAULTS = near 0 · far 100000 ·
// dist 0 — so nothing is ever cut, and « On » lets the three values be adjusted
// to keep a big assembly whole at any zoom. Persisted like Fog / Shadows.
const [clipOn, setClipOn] = useState(() => {
  try { return /^on/.test(String(localStorage.getItem('labViewerClip') || '')); } catch { return false; }
});
const [clipNear, setClipNear] = useState(() => {
  try { const m = /^on:(-?[\d.]+):/.exec(String(localStorage.getItem('labViewerClip') || '')); return m ? Number(m[1]) : CLIP_DEFAULTS.near; } catch { return CLIP_DEFAULTS.near; }
});
const [clipFar, setClipFar] = useState(() => {
  try { const m = /^on:-?[\d.]+:(-?[\d.]+):/.exec(String(localStorage.getItem('labViewerClip') || '')); return m ? Number(m[1]) : CLIP_DEFAULTS.far; } catch { return CLIP_DEFAULTS.far; }
});
const [clipDist, setClipDist] = useState(() => {
  try { const m = /^on:-?[\d.]+:-?[\d.]+:(-?[\d.]+)$/.exec(String(localStorage.getItem('labViewerClip') || '')); return m ? Number(m[1]) : CLIP_DEFAULTS.dist; } catch { return CLIP_DEFAULTS.dist; }
});
const clipRef = useRef({ on: clipOn, near: clipNear, far: clipFar, dist: clipDist });
clipRef.current = { on: clipOn, near: clipNear, far: clipFar, dist: clipDist };

// Push the clipping parameters to the live stage (called on every change AND
// right after the stage is created).
const applyClip = useCallback(() => {
  const stage = stageRef.current;
  if (!stage) return;
  const c = clipRef.current || {};
  try {
    if (c.on) stage.setParameters({ clipNear: c.near, clipFar: c.far, clipDist: c.dist });
    else stage.setParameters({ clipNear: CLIP_DEFAULTS.near, clipFar: CLIP_DEFAULTS.far, clipDist: CLIP_DEFAULTS.dist });
  } catch { /* ignore */ }
}, []);

useEffect(() => {
  try {
    localStorage.setItem('labViewerClip', clipOn ? `on:${clipNear}:${clipFar}:${clipDist}` : 'off');
  } catch { /* ignore */ }
  applyClip();
}, [clipOn, clipNear, clipFar, clipDist, applyClip]);

// ---- Shadows ----
// Persisted like the fog preference. True cast shadows would need real WebGL
// shadow maps, which NGL's renderer does not support — enabling them made the
// whole molecule disappear. NGL *does* shade every atom with a real
// physically-based directional light, but it re-aims that light at the camera
// every frame, so the default look is a flat "headlight" that never produces
// any lit/shaded sides (that is what read as washed-out/diffused). The Shadows
// toggle therefore locks that one light in place — a single fixed key light
// whose direction is aimed with the Azimuth / Elevation controls shown while
// Shadows is ON — so every surface that turns away from the light genuinely
// falls into shade as the model is rotated. The Darkness slider then only
// raises the CONTRAST between the lit and the shaded sides: the key light gets
// brighter while the fill light gets dimmer. Both lights stay pure white, so
// element / residue colours are never tinted or warmed.
const [shadowOn, setShadowOn] = useState(() => {
  try { return String(localStorage.getItem('labViewerShadows') || '').startsWith('on'); } catch { return false; }
});
const [shadowDarkness, setShadowDarkness] = useState(() => {
  try {
    const v = localStorage.getItem('labViewerShadows') || '';
    const m = /on:(\d+)/.exec(v);
    return m ? Math.min(1, Math.max(0, parseInt(m[1], 10) / 100)) : 0.5;
  } catch { return 0.5; }
});
// Direction of the fixed key light around the molecule, in degrees.
// Azimuth 0° = light behind the camera (flat), 90° = hard left, 180° = front;
// elevation 0° = horizon, 90° = straight above. The defaults (25° / 28°)
// reproduce the original "up, left and slightly toward the camera" key light.
const [shadowAz, setShadowAz] = useState(() => {
  try {
    const v = parseFloat(localStorage.getItem('labViewerShadowAz') || '25');
    return Number.isFinite(v) ? Math.min(360, Math.max(0, Math.round(v))) : 25;
  } catch { return 25; }
});
const [shadowEl, setShadowEl] = useState(() => {
  try {
    const v = parseFloat(localStorage.getItem('labViewerShadowEl') || '28');
    return Number.isFinite(v) ? Math.min(90, Math.max(-90, Math.round(v))) : 28;
  } catch { return 28; }
});
const shadowOnRef = useRef(shadowOn);
const shadowDarknessRef = useRef(shadowDarkness);
const shadowDirRef = useRef({ az: shadowAz, el: shadowEl });
shadowOnRef.current = shadowOn;
shadowDarknessRef.current = shadowDarkness;
shadowDirRef.current = { az: shadowAz, el: shadowEl };

// Install a one-time rig on the NGL viewer's light. NGL's render loop calls
// Viewer.__updateLights() every frame and parks its directional light on the
// camera position (the headlight). When Shadows is ON we re-park that same
// light at a FIXED world position right after NGL moves it, so it behaves like
// a single lamp standing next to the model: its direction no longer follows the
// camera (it follows the Azimuth / Elevation controls instead), and rotating
// the molecule sweeps genuinely lit / genuinely shaded faces across the
// structure. When the toggle is OFF we leave NGL's even, camera-linked
// lighting untouched.
const installShadowLightRig = useCallback(() => {
  const stage = stageRef.current;
  const viewer = stage && stage.viewer;
  if (!viewer || !viewer.directionalLight || viewer.__shadowLightRigInstalled) return;
  viewer.__shadowLightRigInstalled = true;
  const origUpdateLights = viewer.__updateLights ? viewer.__updateLights.bind(viewer) : null;
  viewer.__updateLights = function nglFixedKeyLight() {
    if (origUpdateLights) origUpdateLights(); // colour/intensity + camera headlight
    try {
      if (!shadowOnRef.current) return; // OFF → keep NGL's even headlight
      const light = this.directionalLight;
      if (!light) return;
      // Unit direction FROM the molecule centre TOWARD the key light in world
      // space, derived from the Azimuth / Elevation controls — the SAME vector the
      // Mol* translation turns into its spherical lamp coordinates (see
      // utils/viewerLightRig.js): az=0 keeps the light behind the camera (flat),
      // turning it swings the shade across the model, el lifts the lamp.
      const d0 = shadowDirRef.current || {};
      const { x, y, z } = nglKeyLightDirection(d0.az, d0.el);
      // Park the light far outside the model (100× the bounding box, like NGL
      // does) so the rays are effectively parallel — a crisp "sun" direction.
      const d = Math.max(1, this.boundingBoxLength || 1) * LIGHT_RIG.lampDistanceInBoundingBoxes;
      light.position.set(x * d, y * d, z * d);
    } catch { /* best-effort */ }
  };
}, []);

const setMeshShadows = () => { /* no-op — the light rig in installShadowLightRig replaces real shadow maps */ };
const shadowRepsHook = () => { /* no-op — the light rig in installShadowLightRig replaces real shadow maps */ };

const applyShadowSettings = useCallback(() => {
  const stage = stageRef.current;
  if (!stage || !stage.viewer) return;
  try {
    const on = shadowOnRef.current;
    const dark = Math.min(1, Math.max(0, shadowDarknessRef.current));
    // Shadows ON: ONE fixed key light (aimed via the Azimuth / Elevation
    // controls). Darkness only raises the dark-vs-light CONTRAST — the key light
    // gets brighter while the ambient fill gets dimmer. The lights are pure
    // white, so colours are never tinted (the old warm-golden key / cool-blue
    // fill is gone — it read as "a red light was added"). The fill is floored so
    // the shadow side never goes fully black.
    //
    // AMBIENT OCCLUSION: NGL 2.4 ships NO screen-space ambient-occlusion pass
    // (verified in the installed build: `ssao` / `AmbientOcclusion` do not exist
    // anywhere — only three.js's unused AO-map shader chunk, which needs an AO
    // texture no structure rendering ever binds). The equivalent NGL exposes is
    // its AMBIENT term: the ambient light is added uniformly, so lowering
    // `ambientIntensity` while raising `lightIntensity` darkens every face the key
    // light does not reach — crevices, cavities and the inner side of a folded
    // chain lose their fill and read as cavity shading and depth, exactly what AO
    // is used for; `sampleLevel` is raised so those gradients are supersampled.
    // Mol* owns the REAL pass (postprocessing.occlusion, 'on' in the rig) and is
    // what the engine swap will drive.
    //
    // Both branches feed on the rig (utils/viewerLightRig.js): the call below
    // returns exactly the payload this function used to build inline, so the NGL
    // look and its Mol* translation can never drift apart.
    stage.setParameters(nglLightParams({ shadowOn: on, darkness: dark }));
    installShadowLightRig();
    try { if (stage.viewer.requestRender) stage.viewer.requestRender(); } catch {}
  } catch { /* best-effort */ }
}, [installShadowLightRig]);

// Persist + apply the shadow preferences whenever they change.
useEffect(() => {
  try { localStorage.setItem('labViewerShadows', shadowOn ? `on:${Math.round(shadowDarkness * 100)}` : 'off'); } catch { /* ignore */ }
  applyShadowSettings();
}, [shadowOn, shadowDarkness, applyShadowSettings]);

// Persist the light direction and re-render one frame so the fixed key light
// visibly moves while the Azimuth / Elevation sliders are dragged.
useEffect(() => {
  try { localStorage.setItem('labViewerShadowAz', String(Math.round(shadowAz))); } catch { /* ignore */ }
}, [shadowAz]);
useEffect(() => {
  try { localStorage.setItem('labViewerShadowEl', String(Math.round(shadowEl))); } catch { /* ignore */ }
}, [shadowEl]);
useEffect(() => {
  if (!shadowOn) return;
  try {
    const v = stageRef.current && stageRef.current.viewer;
    if (v && v.requestRender) v.requestRender();
  } catch { /* ignore */ }
}, [shadowAz, shadowEl, shadowOn]);

// Persist the customisable viewer colours + feed the live NGL scheme store.
useEffect(() => {
  try { localStorage.setItem('labViewerSstrucColors', JSON.stringify(sstrucColors)); } catch { /* ignore */ }
  sstrucColorStore.helix = sstrucColors.helix;
  sstrucColorStore.sheet = sstrucColors.sheet;
  sstrucColorStore.loop = sstrucColors.loop;
}, [sstrucColors]);
/* The palettes of the request feed their live stores exactly the same way: the ten
   ⚙ wheel palettes are React state (so the wheel updates at once) and these effects
   copy them into the mutable stores the NGL schemes read — moving a swatch repaints
   every molecule that uses that colouring, and NO scheme is ever re-registered.
   Everything is persisted (localStorage) like the rest of the viewer's preferences. */
useEffect(() => {
  try { localStorage.setItem('labViewerResidueColors', JSON.stringify(residueColors)); } catch { /* ignore */ }
  Object.keys(RESIDUE_COLOR_PALETTE).forEach((k) => { if (Number.isFinite(residueColors[k])) residueColorStore[k] = residueColors[k]; });
}, [residueColors]);
useEffect(() => {
  try { localStorage.setItem('labViewerBaseTypeColors', JSON.stringify(baseTypeColors)); } catch { /* ignore */ }
  Object.keys(BASE_IDENTITY_COLORS).forEach((k) => { if (Number.isFinite(baseTypeColors[k])) baseTypeColorStore[k] = baseTypeColors[k]; });
}, [baseTypeColors]);
useEffect(() => {
  try { localStorage.setItem('labViewerChargeColors', JSON.stringify(chargeColors)); } catch { /* ignore */ }
  Object.keys(CHARGE_COLORS).forEach((k) => { if (Number.isFinite(chargeColors[k])) chargeColorStore[k] = chargeColors[k]; });
}, [chargeColors]);
useEffect(() => {
  try { localStorage.setItem('labViewerLipidTypeColors', JSON.stringify(lipidTypeColors)); } catch { /* ignore */ }
  Object.keys(LIPID_CLASS_COLORS).forEach((k) => { if (Number.isFinite(lipidTypeColors[k])) lipidClassColorStore[k] = lipidTypeColors[k]; });
}, [lipidTypeColors]);
useEffect(() => {
  try { localStorage.setItem('labViewerSugarTypeColors', JSON.stringify(sugarTypeColors)); } catch { /* ignore */ }
  Object.keys(SUGAR_TYPE_COLORS).forEach((k) => { if (Number.isFinite(sugarTypeColors[k])) sugarTypeColorStore[k] = sugarTypeColors[k]; });
  // …and every 3-letter CODE of a type follows its type's swatch, so the two
  // spellings of the same palette can never drift apart (GLC ⇄ Glc, NAG ⇄ GlcNAc,
  // SIA / NAN ⇄ Neu, BMA ⇄ Man …).
  Object.keys(SUGAR_TYPE_OF_CODE).forEach((code) => {
    const type = SUGAR_TYPE_OF_CODE[code];
    if (Number.isFinite(sugarTypeColors[type])) sugarColorStore[code] = sugarTypeColors[type];
  });
}, [sugarTypeColors]);
// 🔗 Feed the CHAIN palette from the ⚙ wheel: the lab-chain scheme reads this store
// live, so moving a swatch repaints every molecule coloured by « Chain » at once —
// no scheme is ever re-registered (the report: « it is possible to color by chain
// but there is no way to define the color of the chain in the setting wheel »).
useEffect(() => {
  try { localStorage.setItem('labViewerChainColors', JSON.stringify(chainColors)); } catch { /* ignore */ }
  Object.keys(CHAIN_COLOR_PALETTE).forEach((k) => { if (Number.isFinite(chainColors[k])) chainColorStore[k] = chainColors[k]; });
}, [chainColors]);
// Feed the 🔬 NUCLEIC-ACID group-colour scheme from its menu (menu B): the three
// swatches (phosphate backbone / pentose ring / bases) live in catStyles.nucleic,
// so they are persisted with the menus, captured by a saved setup, and a swatch
// only re-renders the representatives — the scheme reads this store live.
useEffect(() => {
  const n = catStyles.nucleic || {};
  if (Number.isFinite(n.phosphateColor)) nucleicColorStore.phosphate = n.phosphateColor;
  if (Number.isFinite(n.pentoseColor)) nucleicColorStore.pentose = n.pentoseColor;
  if (Number.isFinite(n.baseColor)) nucleicColorStore.base = n.baseColor;
}, [catStyles]);
// The 🧫 LIPID parts are fed exactly the same way (see lipidColorStore). Its
// `named` flag is NOT set here: it belongs to the loaded structure and is written
// by the renderer (buildCategoryReps), from the very flag that built the drawn
// sub-selections.
useEffect(() => {
  const l = catStyles.lipid || {};
  if (Number.isFinite(l.headColor)) lipidColorStore.head = l.headColor;
  if (Number.isFinite(l.glycerolColor)) lipidColorStore.glycerol = l.glycerolColor;
  if (Number.isFinite(l.tailColor)) lipidColorStore.acyl = l.tailColor;
}, [catStyles]);
// The two-colour RAMP is fed the same way — and it HAS to be: the « Gradient »
// colour mode returns the lab-gradient scheme (see catColorParams), whose
// atomColor calls lerpHexColors on gradientColorStore.from/to. Without this the
// two swatches of the menu would paint the default pair and nothing else. The
// protein entry is the reference: the ⚙ settings wheel of the Molecules panel
// writes the SAME pair to every category, so one feed is enough for the whole
// viewer (the ramp is one global scheme, see gradientRangesFor).
useEffect(() => {
  const g = catStyles.protein || {};
  gradientColorStore.from = Number.isFinite(g.gradientFrom) ? g.gradientFrom : DEFAULT_GRADIENT_COLORS.from;
  gradientColorStore.to = Number.isFinite(g.gradientTo) ? g.gradientTo : DEFAULT_GRADIENT_COLORS.to;
}, [catStyles]);
// ⚙ The TWO palettes of the settings wheel feed their schemes' stores exactly the
// same way: the wheel's swatches are the only writer, the store is the live value
// the registered scheme reads (lab-elements · lab-sugar-identity) and NO scheme is
// ever re-registered — moving a swatch repaints the representations that use it
// (the schemes are evaluated per atom at render time). They are persisted with the
// rest of the viewer's preferences, so a tuned palette survives the page.
useEffect(() => {
  Object.assign(elementColorStore, elementColors);
  savePalette(ELEMENT_COLORS_KEY, elementColors);
}, [elementColors]);
useEffect(() => {
  Object.assign(sugarColorStore, sugarColors);
  savePalette(SUGAR_COLORS_KEY, sugarColors);
}, [sugarColors]);
useEffect(() => {
  Object.assign(nucleicFormColorStore, nucleicFormColors);
  savePalette(NUCLEIC_FORM_COLORS_KEY, nucleicFormColors);
}, [nucleicFormColors]);
useEffect(() => {
  Object.assign(nucleicMotifColorStore, nucleicMotifColors);
  savePalette(NUCLEIC_MOTIF_COLORS_KEY, nucleicMotifColors);
}, [nucleicMotifColors]);
// The GENERAL look is persisted too — it is what the six menus follow.
useEffect(() => { try { localStorage.setItem(GENERAL_LOOK_KEY, JSON.stringify(generalLook)); } catch { /* ignore */ } }, [generalLook]);
useEffect(() => { try { localStorage.setItem('labViewerSelResColor', selectedResidueColor.toString(16)); } catch { /* ignore */ } }, [selectedResidueColor]);
useEffect(() => { try { localStorage.setItem('labViewerAssignedColor', assignedAtomColor.toString(16)); } catch { /* ignore */ } }, [assignedAtomColor]);

const persistRenames = (next) => {
  setRenames(next);
  if (typeof onAtomRenames === 'function') onAtomRenames(next);
};
const displayAtomName = (atom) => {
  if (!atom) return '';
  const idx = typeof atom.index === 'number' ? atom.index : -1;
  const over = renamesRef.current[idx];
  if (over && String(over).trim()) return String(over).trim();
  // 2D↔3D atom-name synchronisation: for SMILES-generated organic molecules the
  // 3D labels must show exactly the names assigned by the 2D formula. The map
  // is computed once per structure in the effect above; 2D generation is
  // never modified.
  if (['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current)) {
    const synced = smilesNameMapRef.current && smilesNameMapRef.current[idx];
    if (synced) return synced;
  }
  // For organic/lipid/sugar molecules, use the same connectivity-based name as
  // the 2D structure (so the 3D labels automatically match the 2D formula).
  if (['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current)) {
    try { return getOrganicAtomName(atom); } catch { /* fall through */ }
  }
  return atom.atomname || atom.name || '';
};

// ---- Trajectory State ----
const [trajFile, setTrajFile] = useState(null);
const [trajAborted, setTrajAborted] = useState(false); // true while the user aborted the trajectory (blocks auto-reload from props)
const [trajStatus, setTrajStatus] = useState('none');
const [trajError, setTrajError] = useState('');
const [numFrames, setNumFrames] = useState(0);
const [trajTotal, setTrajTotal] = useState(0); // total frames of the trajectory being loaded (for the live counter)
const [currentFrame, setCurrentFrame] = useState(0);
const [playing, setPlaying] = useState(false);
const [speed, setSpeed] = useState(10);
const [stride, setStride] = useState(1);        // play every Nth frame (keeps total time)
const [maxFrames, setMaxFrames] = useState(0);  // 0 = keep all frames
const [pendingTraj, setPendingTraj] = useState(null); // { file, estFrames, suggested, over2G } awaiting user confirmation
const [trajFrameCount, setTrajFrameCount] = useState(TARGET_TRAJ_FRAMES);
const trajRef = useRef(null);
const lastChosenTrajRef = useRef(null);                // guards the async XTC exact-count scan
const blobUrlsRef = useRef([]);

// Number of frames we actually step through (the trajectory's total time span is
// preserved because we jump by `effStride` frames each step). When a "Max frames"
// cap is set, the stride is raised automatically so the full time range still fits
// inside the cap.
const effStride = numFrames > 0 && maxFrames > 0
  ? Math.max(stride, Math.ceil(numFrames / Math.max(1, maxFrames)))
  : stride;
const keptFrames = numFrames > 0 ? Math.max(1, Math.ceil(numFrames / effStride)) : 0;
const toActualFrame = (keptIdx) => Math.min(numFrames - 1, keptIdx * effStride);

/* LA BARRE DE LECTURE APPARTIENT À LA CONDITION, PAS SEULEMENT AU FICHIER EN
   MAIN. Une trajectoire DÉCLARÉE (`trajectoryName`, le nom resté sur la
   condition ou le nom de la copie de référence) mais pas encore rapatriée dans
   ce navigateur laissait l'utilisateur devant un viewer sans la moindre barre :
   rien ne disait qu'une trajectoire existait, ni que la page était en train de
   la reprendre du Drive. La barre est donc affichée dès qu'une trajectoire est
   déclarée, avec l'état honnête (« pas encore là »), et ▶ ne s'active que quand
   les images sont réellement chargées. */
const declaredTrajName = String(trajectoryName || '').trim();
const hasTrajSource = !!(trajFile || trajectoryFile || trajectorySrc || declaredTrajName);
const waitingTrajFile = hasTrajSource && !trajFile && !trajectoryFile && !trajectorySrc
  && !!declaredTrajName && trajStatus !== 'loading' && trajStatus !== 'ready' && trajStatus !== 'error';

const parsedSeqRef = useRef(parsedSeq);
const moleculeTypeRef = useRef(moleculeType);
const onAtomClickRef = useRef(onAtomClick);
const selectedKeysRef = useRef(selectedKeys);
const residueOffsetRef = useRef(residueOffset);
const namingConventionRef = useRef(namingConvention);
const anchorTickRef = useRef(null);          // last strip tick clicked — Shift+click selects the range [anchor → click]
const [multiSelectActive, setMultiSelectActive] = useState(false);
const renameModeRef = useRef(renameMode);
renameModeRef.current = renameMode;
const displayNameRef = useRef(displayAtomName);
displayNameRef.current = displayAtomName;
// Signature of the last base-representation rebuild: a change in ANY category
// style (Proteins / Nucleic / Lipids / Organic / Others) rebuilds them.
const prevCatSigRef = useRef(catStylesSig(catStyles));

useEffect(() => {
parsedSeqRef.current = parsedSeq;
moleculeTypeRef.current = moleculeType;
onAtomClickRef.current = onAtomClick;
selectedKeysRef.current = selectedKeys;
residueOffsetRef.current = residueOffset;
namingConventionRef.current = namingConvention;
}, [parsedSeq, moleculeType, onAtomClick, selectedKeys, residueOffset, namingConvention]);

// ---- 📏 Measurement helpers -----------------------------------------------
// The stage-signal handlers below run against refs (never stale props), so the
// helpers here only touch refs / stable setters.
const atomPickName = (atom) => {
  if (!atom) return '';
  try {
    const mapped = mapAtomToNmrKeys(atom, parsedSeqRef.current, moleculeTypeRef.current, namingConventionRef.current);
    if (mapped && mapped.label) return mapped.label;
  } catch { /* fall through to the raw PDB name */ }
  return `${atom.resname || ''} ${atom.resno || ''} ${displayNameRef.current(atom)}`.trim();
};

const addDistanceMeasurement = (comp, aIndex, bIndex, aLabel, bLabel) => {
  if (!comp || !Number.isInteger(aIndex) || !Number.isInteger(bIndex)) return false;
  try {
    const elem = comp.addRepresentation('distance', {
      atomPair: [[aIndex, bIndex]],  // pair of NGL atom indices → one line + one label
      labelUnit: 'angstrom',         // label text becomes e.g. "2.13 Å"
      labelVisible: true,
      labelSize: 1.0,
      labelColor: 0xdc2626,
      color: 0xdc2626,               // red dashed line
      linewidth: 3,
      lineOpacity: 0.9,
      opacity: 1,
      visible: true,
    });
    if (elem) {
      measureRepsRef.current.push({ comp, elem });
      setMeasureInfo(`✓ ${aLabel} — ${bLabel}: distance drawn. Click 2 more atoms for another.`);
      return true;
    }
  } catch (e) { console.warn('Distance measurement failed:', e); }
  return false;
};

const clearMeasurements = () => {
  measurePendingRef.current = null;
  setMeasurePending(null);
  const reps = measureRepsRef.current;
  measureRepsRef.current = [];
  reps.forEach(({ comp, elem }) => {
    try { if (comp && elem) comp.removeRepresentation(elem); } catch { /* component may already be disposed */ }
    try { if (elem && typeof elem.dispose === 'function') elem.dispose(); } catch { /* idempotent */ }
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
  setMeasureInfo('');
};

const toggleMeasureMode = () => {
  const next = !measureModeRef.current;
  setMeasureMode(next);
  measureModeRef.current = next;
  if (!next) {
    measurePendingRef.current = null;
    setMeasurePending(null);
    setMeasureInfo('');
  } else {
    setMeasureInfo('📏 Measure ON — click two atoms to show the distance between them.');
  }
};

useEffect(() => {
let cancelled = false;
stageReadyRef.current = (async () => {
const NGL = await Promise.race([
ensureNGL(),
new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out loading the NGL viewer library (20s).')), 20000)),
]);
if (cancelled || !containerRef.current) return null;
registerSstrucScheme(NGL); // customisable per-element 2°-structure colours (helix/sheet/loop)
registerNucleicScheme(NGL);      // 🔬 nucleic acids by chemical group (phosphate / pentose / bases)
registerBaseIdentityScheme(NGL); // 🧬 stylized base rings (one colour per base: A · C · G · T · U)
registerLipidScheme(NGL);        // 🧫 lipids by chemical part (headgroup / glycerol backbone / chains)
registerGradientScheme(NGL);     // 🌈 gradual ribbon colours (two colours, N→C / 5'→3')
registerChainScheme(NGL);        // 🔗 one editable colour per CHAIN (lab-chain)
registerEspScheme(NGL);          // ⚡ the potential of a ligand too (lab-esp)
registerElementScheme(NGL);      // ⚙ atom-type palette (editable in the settings wheel)
registerSugarScheme(NGL);        // ⚙ per-sugar identity colours (editable in the settings wheel)
registerGlycanScheme(NGL);       // 🍬 one colour per LINKED glycan entity (PART 2.2bis)
registerLipidClassScheme(NGL);   // 🧫 one colour per headgroup CLASS (PC · PE · PG · Chol…)
registerNucleicFormScheme(NGL);  // 🧬 A · B · Z DNA / A · flexible RNA (PART 3.1)
registerNucleicMotifScheme(NGL); // 🧬 G-quadruplex · hairpin over the 2° structure (PART 3.2)
// The three palettes the « Color by » lists of the styling bar added (PART 4): the
// residues, the base types and the CHARGE of an ion — all editable in the ⚙ wheel.
registerResidueScheme(NGL);      // 🧬 one colour per residue (nucleic = its base)
registerBaseTypeScheme(NGL);     // 🧬 one colour per BASE TYPE (A · C · G · T · U)
registerChargeScheme(NGL);       // ⚡ − / 0 / + of an ion
const stage = new NGL.Stage(containerRef.current, { backgroundColor: '#f8fafc' });
stageRef.current = stage;
applyFog(); // honour the user's fog preference (off by default) right away
applyClip(); // honour the user's clipping-plane preference (off by default)
applyShadowSettings(); // honour the user's shadow preference (off by default)

stage.signals.clicked.add((pickingProxy) => {
if (!pickingProxy || !pickingProxy.atom) return;
const atom = pickingProxy.atom;
// 📏 Measure mode: clicks pick distance endpoints instead of selecting atoms.
if (measureModeRef.current) {
  const comp = pickingProxy.component;
  if (!comp) return;
  const label = atomPickName(atom);
  const pending = measurePendingRef.current;
  if (!pending) {
    measurePendingRef.current = { comp, atomIndex: atom.index, label };
    setMeasurePending(label);
    setMeasureInfo(`1st atom: ${label} — now click the 2nd atom.`);
    return;
  }
  if (pending.comp !== comp) {
    setMeasureInfo('⚠ The two atoms belong to different structures — pick both atoms in the same molecule.');
    return;
  }
  if (pending.atomIndex === atom.index) {
    measurePendingRef.current = null; // re-clicking the same atom cancels the pending pick
    setMeasurePending(null);
    setMeasureInfo('Measure — click two atoms to show the distance between them.');
    return;
  }
  measurePendingRef.current = null;
  setMeasurePending(null);
  addDistanceMeasurement(comp, pending.atomIndex, atom.index, pending.label, label);
  return; // measuring replaces atom-click selection
}
if (renameModeRef.current) {
setRenameTarget(atom.index);
setRenameDraft(displayNameRef.current(atom));
return;
}
const mapped = mapAtomToNmrKeys(atom, parsedSeqRef.current, moleculeTypeRef.current, namingConventionRef.current);
if (mapped && onAtomClickRef.current) onAtomClickRef.current(mapped.ri, mapped.keys);
stripResidueRiRef.current = null; // a viewport click is per-atom, not a strip click
});

let lastHover = null;
stage.signals.hovered.add((pickingProxy) => {
if (!pickingProxy || !pickingProxy.atom) {
if (lastHover !== null) { lastHover = null; setHoverInfo(null); }
return;
}
const atom = pickingProxy.atom;
const mapped = mapAtomToNmrKeys(atom, parsedSeqRef.current, moleculeTypeRef.current, namingConventionRef.current);
const label = mapped ? mapped.label : `${atom.resname || ''} ${atom.resno || ''} ${displayNameRef.current(atom)}`.trim();
if (label !== lastHover) { lastHover = label; setHoverInfo(label); }
});

return stage;
})().catch((err) => {
if (!cancelled) {
setErrorMsg(err?.message || 'Failed to initialize the NGL viewer.');
setStatus('error');
}
return null;
});

return () => {
cancelled = true;
stageReadyRef.current = null;
if (stageRef.current) {
stageRef.current.dispose();
stageRef.current = null;
}
blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
blobUrlsRef.current = [];
};
}, [applyFog, applyClip, applyShadowSettings]); // applyFog/applyClip/applyShadowSettings are stable useCallbacks — the effect still runs once

const [manualOverride, setManualOverride] = useState(false);
const lastLoadedTextRef = useRef(null);
const loadedPdbTextRef = useRef(null); // raw PDB text of the currently loaded structure (rebuild-H source)
const lastSeenSrcRef = useRef(undefined);
const lastSeenTextRef = useRef(undefined);

// ── WHAT IS ON SCREEN, AND WHERE IT CAME FROM ────────────────────────────────
//   'none'      nothing (empty viewer)
//   'external'  a structure the user LOADED (file, PDB ID / URL, file or src
//               handed over by the page)
//   'generated' the model built from the sequence typed on the page
// It drives the « 🗑 Delete PDB / ↩ Restore PDB » toggle of §1 General and lets
// the sequence model come back by itself whenever the viewer is empty.
const [structOrigin, setStructOrigin] = useState('none');
// The PDB put aside by « 🗑 Delete PDB »: everything needed to bring it back
// (file / URL / text, its extension and name) plus the trajectory that goes
// with it.
const [stashedPdb, setStashedPdb] = useState(null);
// Feedback of the two new gestures — « 🗑 Delete / ↩ Restore PDB » (§1 General)
// and « 🧬 Build from sequence » (Modify group). Each one times out on its own.
const [structAsideMsg, setStructAsideMsg] = useState('');
const structAsideTimerRef = useRef(null);
const flashStructAsideMsg = (m) => {
  setStructAsideMsg(m);
  clearTimeout(structAsideTimerRef.current);
  structAsideTimerRef.current = setTimeout(() => setStructAsideMsg(''), 6000);
};
const [seqBuildMsg, setSeqBuildMsg] = useState('');
const seqBuildTimerRef = useRef(null);
const flashSeqBuildMsg = (m) => {
  setSeqBuildMsg(m);
  clearTimeout(seqBuildTimerRef.current);
  seqBuildTimerRef.current = setTimeout(() => setSeqBuildMsg(''), 6000);
};
// The « 🗑 Delete PDB / ↩ Restore PDB » toggle of §1 General: the button DELETES
// while a PDB the user loaded is on screen, and RESTORES once that PDB has been
// put aside (and nothing else has taken its place on screen since).
const pdbAsideIsRestore = !!stashedPdb && structOrigin !== 'external';
const pdbAsideVisible = structOrigin === 'external' || !!stashedPdb;

useEffect(() => {
if (src !== lastSeenSrcRef.current) {
lastSeenSrcRef.current = src;
if (src) setManualOverride(false);
}
}, [src]);

// Load structure from an external data-URL (e.g. file picked in the MD page)
const lastSeenFileDataRef = useRef(undefined);
useEffect(() => {
if (structureFileData === lastSeenFileDataRef.current) return;
lastSeenFileDataRef.current = structureFileData;
if (!structureFileData) return;
// A raw File supplied by the parent (e.g. restored from IndexedDB on reload)
// takes precedence over the base64 data URL.
if (structureFile) return;
// Old datasets may carry a "[…] omitted" marker instead of a data URL (Stage 5
// of compressDatasetForSave replaced the long base64 before this fix). Skip it
// so we never feed a marker into atob() — the restore-from-IndexedDB path or a
// fresh upload will provide the real file.
if (!String(structureFileData).startsWith('data:')) return;
// If this data URL is just the ECHO of the file the user picked in this viewer
// (the parent stored it back via onStructureFile — e.g. the MD page persists
// the topology), there is nothing to reload: reloading would call
// clearExtraMolecules() and wipe the additional molecules chosen in the same
// batch. The structure is already being loaded from the original File.
try {
  const activeFile = loadRequest && loadRequest.file;
  if (activeFile && structureFileName && String(activeFile.name || '') === String(structureFileName)) return;
} catch { /* keep going */ }
clearExtraMolecules();
setManualOverride(true);
setStructOrigin('external');
setFile(null);
try {
const [meta, b64] = String(structureFileData).split(',');
const mime = /data:([^;,]+)/.exec(meta)?.[1] || 'application/octet-stream';
const bin = atob(b64);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
const blob = new Blob([bytes], { type: mime });
const fakeFile = new File([blob], structureFileName || 'structure.pdb', { type: mime });
requestStructureLoad({ file: fakeFile, url: null, ts: Date.now() });
} catch {
setErrorMsg('Failed to decode structure file data.');
setStatus('error');
}
}, [structureFileData, structureFileName, structureFormat, loadRequest, clearExtraMolecules, structureFile]);

// Load a structure File handed back by the parent (MD page) — e.g. restored
// from IndexedDB after a reload. Large topology files (.gro/.pdb/.cif) are
// never persisted as base64 in the dataset payload, so on reload the parent
// provides the raw File instead of structureFileData.
const lastSeenStructFileRef = useRef(undefined);
useEffect(() => {
if (!structureFile) return;
const token = `${structureFile.name || ''}|${structureFile.size || 0}|${structureFile.lastModified || 0}`;
if (token === lastSeenStructFileRef.current) return;
lastSeenStructFileRef.current = token;
try {
  const activeFile = loadRequest && loadRequest.file;
  if (activeFile && String(activeFile.name || '') === String(structureFile.name || '')) return; // echo of the file the viewer just picked
} catch { /* keep going */ }
clearExtraMolecules();
setManualOverride(true);
setStructOrigin('external');
setFile(null);
requestStructureLoad({ file: structureFile, url: null, ts: Date.now() });
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [structureFile, loadRequest, clearExtraMolecules]);

useEffect(() => {
if (structureText !== lastSeenTextRef.current) {
lastSeenTextRef.current = structureText;
if (structureText) setManualOverride(false);
}
}, [structureText]);

useEffect(() => {
if (manualOverride) return;
if (!structureText) {
  // Parent stopped providing a generated/text structure. If no other source
  // (PDB code/URL, file) is taking over, empty the viewer instead of leaving a
  // stale structure on screen — this replaces the old "remount on source
  // change" behaviour so PDB/URL changes can instead go through the
  // "replace or keep both?" prompt without destroying the viewer.
  const hadText = !!lastLoadedTextRef.current;
  lastLoadedTextRef.current = null;
  if (!src && !structureFile && !structureFileData && hadText && statusRef.current !== 'loading') {
    clearExtraMolecules();
    try { if (stageRef.current) stageRef.current.removeAllComponents(); } catch {}
    clearMeasurements(); // drawn distance lines die with their component
    componentRef.current = null;
    highlightCompRef.current = null;
    manualHighlightCompRef.current = null;
    labelCompRef.current = null;
    sidechainCompRef.current = null;
    setSelections([]);
    setResidueTicks([]);
    setLightRender(false);
    setLightInfo(null);
    setHasNonProtein(false);
    setStatus('idle');
    setErrorMsg('');
    try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
  }
  return;
}
if (structureText !== lastLoadedTextRef.current) {
lastLoadedTextRef.current = structureText;
clearExtraMolecules();
setFile(null);
setStructOrigin('generated');
requestStructureLoad({ file: null, url: null, text: structureText, ext: structureTextExt || 'pdb', ts: Date.now() });
}
}, [structureText, structureTextExt, manualOverride, clearExtraMolecules, src, structureFile, structureFileData]);

/* ── LA STRUCTURE DE LA SÉQUENCE, QUAND RIEN N'EST CHARGÉ ────────────────────
   Une séquence tapée dans la page (« Molecular structure and visualization »,
   sous-section Proteins / DNA / RNA) doit donner sa structure, exactement comme
   une structure qu'on charge : la page fournit ce modèle en permanence
   (`sequenceStructureText`) et le viewer ne s'en sert que si RIEN d'autre
   n'occupe l'écran. Toute autre source garde la priorité :
     • le texte servi par la page est chargé par l'effet ci-dessus (déclaré
       AVANT celui-ci, il pose `lastLoadedTextRef`) ;
     • un PDB déclaré (`src`), un fichier (`structureFile` / `structureFileData`)
       a son propre effet, déclaré APRÈS : c'est lui qui gagne le `loadRequest`
       quand plusieurs sources arrivent dans le même rendu.
   Le modèle suit aussi la séquence : éditer la séquence pendant qu'il est à
   l'écran le reconstruit, et « 🧬 Build from sequence » (groupe Modify) le
   redemande à tout moment. */
useEffect(() => {
  if (structOrigin === 'external') return;   // un PDB chargé par l'utilisateur occupe l'écran
  if (!sequenceStructureText) return;        // pas de séquence sur la page : rien à bâtir
  if (sequenceStructureText === lastLoadedTextRef.current) return;  // c'est DÉJÀ ce modèle qui est affiché
  if (loadRequest && loadRequest.text === sequenceStructureText) return;  // …ou il est en train de charger
  lastLoadedTextRef.current = sequenceStructureText;
  setStructOrigin('generated');
  console.log('🧬 Nothing loaded in the viewer — showing the structure built from the page sequence.');
  requestStructureLoad({ file: null, url: null, text: sequenceStructureText, ext: sequenceStructureExt || 'pdb', ts: Date.now() });
}, [structOrigin, sequenceStructureText, sequenceStructureExt, loadRequest]);

useEffect(() => {
if (!src) return;
  const s = String(src || '').trim();
  // Only meaningful sources (a real 4-letter PDB code, rcsb:, or an
  // http(s)/blob/data URL) trigger a load — partial typing in the
  // "PDB ID / URL" box is ignored until it becomes a real source.
  const isReal = /^(https?:|blob:|data:)/i.test(s) || /^rcsb:/i.test(s) || /^[0-9a-z]{4}$/i.test(s);
  if (!isReal) return;
  if (s === lastAskedSrcRef.current) return; // already asked about / loaded this source
  // A structure is already on screen (from a file, a generated structure, or a
  // previous source) — ask whether to REPLACE it or KEEP BOTH, exactly like the
  // multi-file upload flow. The same value is asked only once.
  if (componentRef.current && statusRef.current === 'ready') {
    lastAskedSrcRef.current = s;
    setPendingSrc(s);
    return;
  }
  lastAskedSrcRef.current = s;
  setFile(null);
  clearExtraMolecules();
  setStructOrigin('external');
  setLoadRequest({ file: null, url: src, ts: Date.now() });
}, [src, clearExtraMolecules]);

useEffect(() => {
if (manualOverride || structureText || loadRequest) return;
if (externalLoading) { setStatus('loading'); setErrorMsg(''); }
else if (externalError) { setStatus('error'); setErrorMsg(externalError); }
}, [externalLoading, externalError, structureText, loadRequest, manualOverride]);

// ── Shared helpers of the per-category menus ────────────────────────────────
// `catEspRepsRef` remembers the category SURFACES that were coloured with the
// electrostatic-potential scheme, per component, so the ⚡ Range control
// (espApplyLimits) re-colours them live together with the ⚡ ESP overlay.
const catEspRepsRef = useRef(new Map());
// The exact ESP colouring used by the ⚡ ESP overlay: the viewer's OWN potential
// scheme (`lab-esp`, see PART 4.0 — it charges the hetero atoms NGL leaves at zero,
// which is what makes a ligand show a potential at all) pinned to the red → white →
// blue ramp (rwb) and driven by the user's ±kcal/mol limits — shared, so
// « Surface Color: ESP » and the ⚡ button can never drift apart. NGL's own
// 'electrostatic' scheme is the fallback, so a scheme that could not be registered
// still paints a surface (the protein one, exactly as before).
const espColorParams = () => {
  const prev = espLimitsRef.current || [15, 15];
  const neg = Math.min(500, Math.max(0.5, Number(prev[0]) || 15));
  const pos = Math.min(500, Math.max(0.5, Number(prev[1]) || 15));
  if (espSchemeKey) return { color: espSchemeKey, colorScale: 'rwb', colorDomain: [-neg, pos] };
  return { colorScheme: 'electrostatic', colorScale: 'rwb', colorDomain: [-neg, pos] };
};

/* ══ PART 4.1 · WHAT ONE ROW HANDS TO NGL ════════════════════════════════════ */
// The « Color by » of ONE row, as the parameters a representation takes: a `color`
// when a registered house scheme (or ONE flat colour) is used, a `colorScheme` for
// NGL's own metaphors. Every house scheme FALLS BACK on the closest native one, so
// a row is never drawn with no colour at all.
const schemeParam = (key, fallback) => (key ? { color: key } : { colorScheme: fallback });
const sectionColorParams = (look, kind) => {
  const mode = (look && look.colorBy) || 'element';
  const solid = Number.isFinite(look && look.solidColor)
    ? look.solidColor
    : (DEFAULT_ATOM_COLORS[KIND_CATEGORY[kind]] || DEFAULT_ELEMENT_COLOR);
  switch (mode) {
    case 'solid': return { color: solid };
    case 'element': return schemeParam(elementSchemeKey, 'element');
    // « Chain » (a protein / a nucleic acid / a lipid row) — the EDITABLE chain
    // palette of the ⚙ wheel (lab-chain), with NGL's own `chainid` as the fallback:
    // the report was « it is possible to color by chain but there is no way to
    // define the color of the chain in the setting wheel ».
    case 'chain': return schemeParam(chainSchemeKey, 'chainid');
    case 'residue': return schemeParam(residueSchemeKey, 'resname');
    case 'basetype': return schemeParam(baseTypeSchemeKey, 'resname');
    case 'sstruc': return schemeParam(sstrucSchemeKey, 'sstruc');
    case 'nucform': return schemeParam(nucleicFormSchemeKey || sstrucSchemeKey, 'sstruc');
    case 'lipidtype': return schemeParam(lipidClassSchemeKey || elementSchemeKey, 'element');
    case 'sugar': return schemeParam(sugarSchemeKey, 'element');
    case 'charge': return schemeParam(chargeSchemeKey || elementSchemeKey, 'element');
    case 'hydrophobicity': return { colorScheme: 'hydrophobicity' };
    // « Rainbow (first → last) » is the rainbow BY RESIDUE. NGL has NO `rainbow`
    // COLORMAKER — « rainbow » is one of its color SCALES (the registry only holds
    // `residueindex`, `sstruc`, `hydrophobicity`, …) — so asking for
    // `colorScheme: 'rainbow'` made NGL throw inside addRepresentation and the row
    // drew NOTHING at all: the report « rainbow does not color ». The rainbow by
    // residue IS `residueindex`, whose own default scale is "rainbow" (red → blue);
    // the scale is pinned here so the colouring can never drift to Spectral.
    case 'rainbow': return { colorScheme: 'residueindex', colorScale: 'rainbow' };
    case 'gradient': return gradientSchemeKey ? { color: gradientSchemeKey } : { colorScheme: 'residueindex' };
    // « Electrostatic potential » is the ONLY colouring NGL can paint on a surface:
    // the renderer therefore ALSO adds a translucent ESP surface to that row (see
    // buildSectionReps), which is what the request's wording says.
    case 'esp': return espColorParams();
    default: return { colorScheme: 'element' };
  }
};
// The transparency regulator as NGL wants it: the row stores 0 = opaque → 1 = gone.
const sectionOpacity = (look) => (
  1 - Math.min(1, Math.max(0, Number.isFinite(look && look.opacity) ? look.opacity : 0))
);

/* The representation(s) of ONE style, with the geometry of the row's two radius
   multipliers (1.00 = the style's own NGL size). Returns [] for « hide », and []
   for the two plate styles, whose MeshBuffer the caller builds (a plate is not a
   representation NGL knows). The surface styles take the row's transparency as
   their opacity; every other style gets it merged by the caller. */
const sectionStyleReps = (style, kind, look) => {
  const sphere = Number.isFinite(look && look.sphere) ? look.sphere : 1;
  const bond = Number.isFinite(look && look.bond) ? look.bond : 1;
  switch (style) {
    case 'hide': return [];
    case 'cartoon': return [{ type: 'cartoon', params: { quality: 'high' } }];
    case 'ribbon': return [{ type: 'ribbon', params: {} }];
    case 'tube': return [{ type: 'cartoon', params: { radius: 0.3, quality: 'high' } }];
    case 'trace': return [{ type: 'trace', params: { quality: 'high' } }];
    case 'ball+stick': return [{ type: 'ball+stick', params: { multipleBond: true, aspectRatio: 1.1 * sphere, radiusSize: BALLSTICK_BOND_RADIUS * bond } }];
    case 'licorice': return [{ type: 'licorice', params: { radiusSize: LICORICE_BOND_RADIUS * bond } }];
    case 'line': return [{ type: 'line', params: { linewidth: Math.max(1, Math.round(2 * bond)) } }];
    // « CPK » IS spacefill, and an ION's « sphere » is the same representation
    // drawn at its full Van der Waals radius (an ion has no bonds to speak of).
    case 'spacefill': return [{ type: 'spacefill', params: { radiusScale: sphere, scale: kind === 'ion' ? 1 : 0.6 } }];
    case 'base': return [{ type: 'base', params: { radiusSize: BASE_BOND_RADIUS * bond } }];
    case 'surface': return [{ type: 'surface', params: { surfaceType: 'av', opacity: Number((1 - Math.min(1, Math.max(0, (look && look.opacity) || 0))).toFixed(3)) } }];
    case 'mesh': return [{ type: 'surface', params: { surfaceType: 'av', wireframe: true, opacity: 1 } }];
    default: return [];   // rings / plates — MeshBuffers, built by the caller
  }
};

/* ══ PART 4.2 · THE SELECTOR OF ONE ROW, AND THE SECTIONS OF A MOLECULE ══════ */
// The chemical groups of every nucleotide of ONE structure, as atom-index lists
// (cached: the walk is O(atoms) and a rebuild must never repeat it).
const nucleicGroupCache = new WeakMap();
const nucleicGroupIndicesIn = (structure) => {
  const hit = nucleicGroupCache.get(structure);
  if (hit) return hit;
  const out = { phosphate: [], pentose: [], base: [] };
  try {
    structure.eachAtom((a) => {
      if (String(a.element || '').toUpperCase() === 'H') return;
      out[nucleicGroupOf(a.atomname)].push(a.index);
    });
  } catch { /* no structure → empty groups */ }
  nucleicGroupCache.set(structure, out);
  return out;
};
// ONE molecule's atom indices (cached by selector): the group lists above cover the
// WHOLE structure, and this is what restricts them to the section's molecule — the
// bases row of chain B must never draw the bases of chain A.
const moleculeIndexCache = new WeakMap();
const moleculeIndicesOf = (structure, sele) => {
  let per = moleculeIndexCache.get(structure);
  if (!per) { per = new Map(); moleculeIndexCache.set(structure, per); }
  if (!per.has(sele)) per.set(sele, new Set(atomIndicesForSele(structure, sele || 'all')));
  return per.get(sele);
};
// An NGL `@index` list — '' when there is no atom (the row then draws nothing).
const indexSele = (list) => (list && list.length ? `@${list.join(',')}` : '');
// The indices of ONE group of ONE molecule (base / pentose / phosphate).
const nucleotideGroupSele = (structure, sec, group) => {
  const all = nucleicGroupIndicesIn(structure)[group] || [];
  const own = moleculeIndicesOf(structure, sec.sele);
  return indexSele(all.filter((i) => own.has(i)));
};
// The NGL selector of ONE ROW of ONE section — the molecule's own selector, then the
// atoms that row owns. '' means « this row has nothing to draw here », and it is
// what keeps a row that the molecule does not have (side chains of a ligand) empty
// instead of drawing the whole molecule.
const sectionRowSele = (structure, sec, sub, opts = {}) => {
  const base = sec.sele || 'all';
  if (sub === 'general') return base;
  if (sec.kind === 'protein') {
    // `opts.anchorSideChains`: the side chains are drawn as ATOMS while the backbone
    // is too (Ball & Stick · Licorice · Lines · Spheres) — see ATOM_DRAW_STYLES.
    // NGL draws a bond only when BOTH of its atoms are inside the selection, and its
    // `sidechain` keyword EXCLUDES the CA that a side chain hangs from: CB, CG, …
    // were therefore drawn with no bond to the backbone, and every side chain FLOATED
    // beside the chain (the report: « the side chains are not attached to the
    // backbone — bond with the backbone must be included »). The CA then belongs to
    // the SIDE-CHAIN row and is taken out of the backbone row, so the CB–CA bond is
    // drawn inside ONE representation, no atom is drawn twice, and the backbone stays
    // connected by its own C–N peptide bonds. A ribbony backbone is left untouched:
    // the ribbon itself walks through the CAs.
    if (sub === 'sidechain') {
      return opts.anchorSideChains ? `${base} and (sidechain or .CA)` : `${base} and sidechain`;
    }
    return opts.anchorSideChains ? `${base} and backbone and not .CA` : `${base} and backbone`;
  }
  if (sec.kind === 'nucleic') {
    if (sub === 'bases') return nucleotideGroupSele(structure, sec, 'base');
    if (sub === 'ribose') return nucleotideGroupSele(structure, sec, 'pentose');
    return `${base} and backbone`;
  }
  if (sec.kind === 'lipid') {
    // The three parts of a lipid, as the `@index` lists lipidSubSelections reads from
    // the standard atom naming (PART 2.1); an unknown naming still tiles the lipid by
    // element, so the headgroup can never lose an atom.
    const parts = lipidSubSelections(structure, base);
    if (sub === 'head') return parts.head || '';
    if (sub === 'tail') return parts.acyl || '';
    if (sub === 'glycerol') return parts.glycerol || '';
  }
  return base;
};

/* ONE pass over the residues of a component → its SECTIONS, in the order of
   MOL_KINDS. A molecule IS (the request's layout):
     • a CHAIN for a protein and for a nucleic acid — « keep one by one »: a file
       with two proteins gives two sections, one per chain;
     • a GLYCAN ENTITY for a sugar — a linked N-glycan is ONE molecule (PART 2.2bis);
     • a RESIDUE NAME for a lipid, a ligand and an ion — a bilayer of POPC + POPE
       gives exactly TWO sections however many thousand lipids it holds, and each
       says ×N (the request: « do as with water »);
     • the whole SOLVENT for water — ONE section, whatever the box holds.
   The section's `sele` is the NGL selector of that molecule INSIDE its component,
   which is why the same renderer serves the main file, an extra file and a chain. */
const chainSeleOf = (chain) => (chain ? `:${chain}` : '');
// A comma-separated residue-number list — always valid NGL, whatever the file's
// numbering (the viewer never assumes the 1 → N convention).
const resnoListOf = (resnos) => {
  const list = Array.from(new Set((resnos || []).filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
  return list.join(',');
};
const classifySectionResidue = (r) => {
  const name = r.resname;
  if (LABEL_WATER_NAMES.has(name)) return 'water';
  const nature = residueNatureOf(name, r.atomNames);
  if (nature === 'protein') return 'protein';
  if (nature === 'dna' || nature === 'rna') return 'nucleic';
  if (isLipidResname(name)) return 'lipid';
  if (isSugarResidueCode(name)) return 'sugar';
  const heavy = Array.from(r.elements).filter((e) => e && e !== 'H' && e !== 'D');
  if (heavy.length === 1 && r.count === 1) {
    if (LABEL_ION_ELEMENTS.has(heavy[0])) return 'ion';
    // …and when the ELEMENT was only guessed out of the atom name (a .gro writes
    // « SOD » / « CLA »), the RESIDUE name is what says « this is one ion ».
    if (LABEL_ION_RESNAMES.has(String(name).trim().toUpperCase())) return 'ion';
  }
  return 'ligand';
};
const listMoleculeSections = (structure) => {
  if (!structure) return [];
  const residues = new Map();
  try {
    structure.eachAtom((a) => {
      const chain = String(a.chainname || a.chainid || '');
      const resname = String(a.resname || a.restype || '').toUpperCase();
      const resno = a.resno != null ? a.resno : 0;
      const key = `${chain}|${resno}|${resname}`;
      let r = residues.get(key);
      if (!r) {
        r = { chain, resno, resname, atomNames: new Set(), elements: new Set(), count: 0 };
        residues.set(key, r);
      }
      r.count += 1;
      r.atomNames.add(String(a.atomname || a.name || '').trim().toUpperCase());
      r.elements.add(String(a.element || '').toUpperCase());
    });
  } catch { return []; }

  const out = [];
  const water = [];
  const chains = new Map();   // `${chain}|${kind}` → { chain, kind, dna: [], rna: [] }
  const grouped = new Map();  // `${kind}|${resname}` → { kind, resname, resnos: [] }
  residues.forEach((r) => {
    const kind = classifySectionResidue(r);
    if (kind === 'water') { water.push(r); return; }
    if (kind === 'protein' || kind === 'nucleic') {
      const gk = `${r.chain}|${kind}`;
      let g = chains.get(gk);
      if (!g) { g = { chain: r.chain, kind, dna: [], rna: [] }; chains.set(gk, g); }
      if (kind === 'nucleic') {
        const nature = residueNatureOf(r.resname, r.atomNames);
        (nature === 'rna' ? g.rna : g.dna).push(r.resno);
      }
      return;
    }
    const gk = `${kind}|${r.resname}`;
    let g = grouped.get(gk);
    if (!g) { g = { kind, resname: r.resname, resnos: [] }; grouped.set(gk, g); }
    g.resnos.push(r.resno);
  });
  // ---- PART 4.2b · the sections of the polymers and of the small molecules ----
  // Proteins and nucleic acids: ONE SECTION PER CHAIN.
  const chainRows = Array.from(chains.values());
  chainRows.filter((g) => g.kind === 'protein').forEach((g) => {
    out.push({
      key: `protein|${g.chain}`,
      kind: 'protein',
      name: g.chain ? `Chain ${g.chain}` : 'Protein',
      detail: '',
      sele: g.chain ? `:${g.chain} and protein` : 'protein',
      count: 1,
    });
  });
  chainRows.filter((g) => g.kind === 'nucleic').forEach((g) => {
    const mixed = g.dna.length > 0 && g.rna.length > 0;
    [['dna', g.dna], ['rna', g.rna]].filter(([, list]) => list.length).forEach(([nature, list]) => {
      out.push({
        key: `nucleic|${g.chain}|${mixed ? nature : 'all'}`,
        kind: 'nucleic',
        name: g.chain ? `Chain ${g.chain}` : 'Nucleic acid',
        detail: nature === 'dna' ? 'DNA' : 'RNA',
        // ONE nature in the chain → the NGL keyword (short and exact); a chain that
        // carries both → the residue list of that nature alone (the dna / rna
        // keywords of NGL do not know the modified residues this viewer reads).
        sele: !mixed
          ? (g.chain ? `:${g.chain} and nucleic` : 'nucleic')
          : `:${g.chain} and ${resnoListOf(list)}`,
        count: list.length,
      });
    });
  });
  // Sugars: ONE SECTION PER GLYCAN ENTITY (a linked glycan IS one molecule).
  const glycan = glycanEntityMapFor(structure);
  if (glycan && Array.isArray(glycan.entities)) {
    glycan.entities.forEach((e, i) => {
      const members = (e.members || []).map((mi) => glycan.monomers[mi]).filter(Boolean);
      if (!members.length) return;
      let chainName = '';
      try { chainName = String(structure.getChainProxy(members[0].chainIndex).chainname || ''); } catch { chainName = ''; }
      out.push({
        key: `sugar|entity${i}`,
        kind: 'sugar',
        name: e.label || `Glycan ${i + 1}`,
        detail: e.linked ? `${members.length} linked sugars` : 'monosaccharide',
        sele: `${chainName ? `:${chainName} and ` : ''}${resnoListOf(members.map((m) => m.resno))}`,
        count: members.length,
      });
    });
  }
  // Lipids · ligands · ions: ONE SECTION PER RESIDUE NAME (×N molecules in it).
  grouped.forEach((g) => {
    out.push({
      key: `${g.kind}|${g.resname}`,
      kind: g.kind,
      name: g.resname,
      detail: '',
      sele: `[${g.resname}]`,
      count: g.resnos.length,
    });
  });
  // Water: ONE section for the whole solvent.
  if (water.length) {
    out.push({ key: 'water|all', kind: 'water', name: 'Water', detail: '', sele: 'water', count: water.length });
  }
  // The order of the bar: MOL_KINDS, then the name — an order a reload keeps.
  return out.sort((a, b) => (
    MOL_KINDS.indexOf(a.kind) - MOL_KINDS.indexOf(b.kind)
    || String(a.name).localeCompare(String(b.name))
  ));
};

/* ══ PART 4.3 · THE RENDERER — ONE MOLECULE SECTION BEHIND THE OTHER ══════════ */
// Draws every section of ONE component from its tree of looks, and returns the
// representations it added so the caller removes exactly those again. The plates of
// « Stylized rings (filled plates) » / « Ring plates » are MeshBuffers handed to the
// component itself (they follow its matrix and go away with its reps), and the
// surface « Electrostatic potential (only surfaces) » needs is added ON TOP of the
// row's own style — NGL can paint that colouring on a surface, nowhere else.
const buildSectionReps = (comp, sections, trees, opts = {}) => {
  const reps = [];
  if (!comp || !comp.structure || !Array.isArray(sections)) return reps;
  const structure = comp.structure;
  const hidden = opts.hidden || null;      // the section IDS switched OFF (the ✔ of the bar)
  const espOut = opts.espReps || null;     // where the ESP surfaces are remembered
  // EVERY section has its OWN tree of looks (that is what makes two proteins of the
  // same file independent); a section without one falls back on the kind's look.
  const treeOf = (sec) => (trees && trees[sec.id]) || opts.fallbackTree || {};
  /* THE TWO-COLOUR RAMP IS MEASURED BEFORE ANYTHING IS DRAWN. A representation
     reads its colours when NGL BUILDS it, and this builder used to fill the store
     only at the very end of the loop: the first build therefore ran with
     `ranges` = null — every atom took the FIRST colour and the ramp appeared only
     on the NEXT rebuild, when the ranges of the previous one were still in the
     store. That is the report « the color by gradient does not seem to work in some
     cases ». Walking the looks once here costs one pass over the polymer (exactly
     what the measurement itself costs) and the sections' selections are known
     before the loop.
     The ranges are also remembered PER STRUCTURE (byStructure), so a second loaded
     molecule can no longer flatten the ramp of the first. */
  const gradientRows = [];
  sections.forEach((sec) => {
    if (hidden && (hidden.has(sec.id) || hidden.has(sec.key))) return;
    subsectionsOf(sec.kind).forEach((sp) => {
      const look = effectiveSectionLook(treeOf(sec), sec.kind, sp.sub);
      if (look.style !== 'hide' && look.colorBy === 'gradient') gradientRows.push(sec.sele);
    });
  });
  gradientColorStore.ranges = gradientRows.length
    ? gradientRangesFor(structure, gradientRows.join(' or '))
    : null;
  if (gradientColorStore.byStructure) gradientColorStore.byStructure.set(structure, gradientColorStore.ranges);
  const add = (type, params) => {
    let r = null;
    try {
      r = comp.addRepresentation(type, params);
      if (r) { flagMeshShadows(r); reps.push(r); }
    } catch { r = null; /* a style that cannot be drawn never breaks the view */ }
    return r;
  };
  // The filled plates of one row: a MeshBuffer (NGL has no plate representation).
  // The colour of a plate is the identity of its base — the palette of the ⚙ wheel —
  // or the row's ONE flat colour for « Solid »; the OUTLINE sticks above carry the
  // row's own colouring, whatever it is.
  const addPlates = (sele, look, sub) => {
    const NG = typeof window !== 'undefined' ? window.NGL : null;
    if (!NG || typeof NG.MeshBuffer !== 'function') return null;
    const data = nucleicRingPlates(structure, sele, {
      bases: 'rings',
      ringColour: look.colorBy === 'solid' ? 'custom' : 'base',
      ringColorHex: Number.isFinite(look.solidColor) ? look.solidColor : DEFAULT_NUCLEIC_COLORS.base,
      // The bases row fills the BASE rings and the ribose row the PENTOSE rings; the
      // selection handed in already restricts the walk to that row's own atoms.
      sugarPlate: sub === 'ribose',
      groupColour: false,
    });
    if (!data || !data.rings) return null;
    try {
      const mesh = new NG.MeshBuffer({ position: data.position, normal: data.normal, color: data.color, index: data.index });
      const rep = comp.addBufferRepresentation(mesh, { opacity: sectionOpacity(look), side: 'double' });
      if (rep) { flagMeshShadows(rep); reps.push(rep); }
      return { data, rep };
    } catch { return null; /* the plates are a bonus: never break the view */ }
  };
  sections.forEach((sec) => {
    // The ✔ of the bar is keyed by the GLOBAL id of a section (`<molecule>::<key>`,
    // see ensureSections), while a caller that enumerates a structure by hand hands
    // the bare keys over: BOTH forms switch a section OFF. Comparing the set of ids
    // with the local key made the ✔ a NO-OP — `main::water|all` never matched the key
    // `water|all` — so unticking a molecule (or leaving water / ions unticked, which
    // KIND_VISIBLE_BY_DEFAULT asks for) drew it all the same.
    if (hidden && (hidden.has(sec.id) || hidden.has(sec.key))) return;
    // Every row's look of THIS section, computed ONCE: the side-chain ANCHOR below
    // needs the backbone look and the side-chain look together.
    const subLooks = {};
    subsectionsOf(sec.kind).forEach((sp) => { subLooks[sp.sub] = effectiveSectionLook(treeOf(sec), sec.kind, sp.sub); });
    // A protein whose BACKBONE and SIDE CHAINS are BOTH drawn as atoms hands the CA
    // to the side-chain row (see sectionRowSele), so the two rows join at the CB–CA
    // bond instead of showing floating side chains.
    const anchorSideChains = sec.kind === 'protein'
      && !!subLooks.sidechain && subLooks.sidechain.style !== 'hide'
      && ATOM_DRAW_STYLES.includes(subLooks.sidechain.style)
      && !!subLooks.backbone && ATOM_DRAW_STYLES.includes(subLooks.backbone.style);
    subsectionsOf(sec.kind).forEach((spec) => {
      const look = subLooks[spec.sub];
      if (look.style === 'hide') return;
      const sele = sectionRowSele(structure, sec, spec.sub, { anchorSideChains });
      if (!sele) return;
      const colorParams = sectionColorParams(look, sec.kind);
      const opacity = sectionOpacity(look);
      if (look.style === 'rings' || look.style === 'plates') {
        const plates = addPlates(sele, look, spec.sub);
        const idx = plates && plates.data ? plates.data.atomIndices : null;
        if (idx && idx.length) {
          add('licorice', { sele: `@${idx.join(',')}`, ...colorParams, radiusSize: LICORICE_BOND_RADIUS * 0.6 * (Number.isFinite(look.bond) ? look.bond : 1), opacity });
        }
      } else {
        sectionStyleReps(look.style, sec.kind, look).forEach(({ type, params }) => {
          add(type, {
            sele, ...colorParams, ...params,
            // The transparency regulator reaches EVERY style (the surface styles
            // already carry their own opacity from sectionStyleReps).
            opacity: params.opacity != null ? params.opacity : opacity,
          });
        });
      }
      // « Electrostatic potential (only surfaces) »: the colouring needs a surface,
      // so a translucent one is added on top of the row's own style.
      if (look.colorBy === 'esp' && look.style !== 'surface' && look.style !== 'mesh') {
        const r = add('surface', { sele, ...espColorParams(), transparent: true, opacity: 0.75 });
        if (r && espOut) {
          const prev = espOut.get(comp) || [];
          prev.push(r);
          espOut.set(comp, prev);
        }
      }
    });
  });
  return reps;
};

// ONE function draws the whole structure from the six category menus, so the
// main structure, every extra molecule and every split chain obey the same
// menus. It returns the list of representations it added (base + surfaces) so
// the caller can remove exactly those again.
//
// Selections come from catSelectionsFor, routed by routeCategorySelections:
//   protein · nucleic · lipid (the standard resname list) · sugar (NGL
//   `saccharide` + an explicit carbohydrate resname list) · organic (hetero
//   minus water / ions / lipids / sugars) · others (water or ion).
// The Lipids menu works on three INDEPENDENT sub-selections (headgroups /
// glycerol backbone / acyl chains — see lipidSubSelections), and a component
// that holds NO polymer hands the ligand fallback `all and not (polymer, lipid,
// sugar, water, ion)` to the Organic menu, while water and ions keep the Others
// menu — including its water SURFACE, which is applied on its own so a solvent
// shell can be drawn even with the water atoms hidden.
//
// Surfaces are ordinary NGL `surface` representations — solid (opacity 1),
// transparent (`transparent: true` + the menu's Opacity slider) or mesh
// (wireframe) — and « Surface Color: ESP » reuses the EXISTING
// electrostatic-potential colouring (same colour scale and ±kcal/mol domain as
// the ⚡ ESP button), so both ESP entry points stay in sync.
const buildCategoryReps = (comp) => {
  const reps = [];
  if (!comp || !comp.structure) return reps;
  const cs = catStylesRef.current || DEFAULT_CAT_STYLES;
  const fallbackSels = {
    protein: 'protein', nucleic: 'nucleic', lipid: '', sugar: SUGAR_SEL,
    organic: 'hetero and not water and not ion', others: 'water or ion', lipids: [],
    n: { protein: -1, nucleic: -1, others: -1, organic: -1, lipid: -1, sugar: -1 },
  };
  const sels = catSelectionsFor(comp.structure) || fallbackSels;
  const route = routeCategorySelections(sels, moleculeTypeRef.current || 'protein');
  const organicSele = route.organic;
  const lipidSele = route.lipid;
  const sugarSele = route.sugar;
  const othersSele = route.other;

  const add = (type, params) => {
    let r = null;
    try {
      r = comp.addRepresentation(type, params);
      if (r) { flagMeshShadows(r); reps.push(r); }
    } catch { r = null; /* style best-effort: a bad token never breaks the view */ }
    return r;
  };
  // ── The colour / radius fields of the six menus, read once per rebuild ─────
  // The colour of ONE menu comes from catColorParams (module level): the same
  // four metaphors — default (element colours / rainbow by residue), ONE flat
  // colour, the 2°-structure colours, the sequence gradient — serve the RIBBON
  // family (`backboneCol`) and the atoms / bonds (`atomCol`), so a menu can never
  // be drawn with one rule and coloured with another.
  const atomCol = (cat) => catColorParams(cs[cat], 'atom');
  const backboneCol = (cat) => catColorParams(cs[cat], 'backbone');
  // 🔬 Menu B — « Colour by chemical group » (🎨 Colours panel of that menu): the
  // phosphate backbone, the pentose rings and the bases each take their own colour
  // through the lab-nucleic-groups scheme.
  const nucleicGroupsOn = () => !!(cs.nucleic && cs.nucleic.groupColour && nucleicSchemeKey);
  const nucleicCol = () => (nucleicGroupsOn() ? { color: nucleicSchemeKey } : atomCol('nucleic'));
  // The INSIDE of the base rings of « Stylized rings »: one colour per base.
  const baseIdentityCol = () => (baseIdentitySchemeKey ? { color: baseIdentitySchemeKey } : { colorScheme: 'resname' });
  // The plates of « Stylized rings » are FILLED surfaces (see nucleicRingPlates):
  // their colour follows the 🎨 panel of this menu — one colour per base, ONE flat
  // colour (⭘ « One colour », i.e. PyMOL's cartoon_ring_color) or the group
  // colours — and their transparency is the menu's Ring transparency, i.e. PyMOL's
  // cartoon_ring_transparency. 1 − t: NGL wants an opacity.
  const ringOpacity = () => {
    const t = Number(cs.nucleic && cs.nucleic.ringTransparency);
    const v = Number.isFinite(t) ? Math.min(RING_TRANSPARENCY_MAX, Math.max(0, t)) : RING_TRANSPARENCY_DEFAULT;
    return 1 - v;
  };
  // The outline of the plates (a thin stick over the ring atoms) takes the SAME
  // colour as the plates wherever a colour SCHEME can express it — the group
  // colours, or the identity of each base — and the flat colour otherwise.
  const ringLineCol = () => {
    const m = cs.nucleic || {};
    if (m.ringColour === 'custom') return catColorParams({ atomColor: 'custom', atomColorHex: m.ringColorHex }, 'atom');
    if (m.groupColour && nucleicSchemeKey) return { color: nucleicSchemeKey };
    return baseIdentityCol();
  };
  // 🧫 Menu C — « Colour by chemical part »: the headgroups, the glycerol
  // backbones and the acyl chains each take their own colour through the
  // lab-lipid-groups scheme (the same three groups the sub-selections draw).
  const lipidGroupsOn = () => !!(cs.lipid && cs.lipid.groupColour && lipidSchemeKey);
  const lipidCol = () => (lipidGroupsOn() ? { color: lipidSchemeKey } : atomCol('lipid'));
  // Bond radius (Å, from the menu's multiplier — see catRadii) ready for a style,
  // and the same multiplier applied to the width of a line style.
  const stickGeom = (cat, naturalBond) => ({ radiusSize: naturalBond * catRadii(cs[cat]).bond });
  const lineGeom = (cat) => ({ linewidth: Math.max(1, Math.round(2 * catRadii(cs[cat]).bond)) });
  // Solid / transparent / mesh surfaces, in the category's own selection.
  // `opacityValue` is the menu's Opacity slider (0 → 1, default 0.4) and is only
  // used by the Transparent mode: NGL receives `transparent: true` + `opacity`.
  // The surface COLOUR comes from the same menu (element colours by default, a
  // flat colour for « Custom… », ESP for « Electrostatic Potential »).
  const addSurface = (sele, cat, opacityValue) => {
    const m = cs[cat] || {};
    const mode = m.surface;
    if (!sele || !mode || mode === 'hide') return;
    const customHex = m.surfaceColor === 'custom' ? flatHex(m.surfaceColorHex) : null;
    const colorParams = m.surfaceColor === 'esp'
      ? espColorParams()
      : (customHex != null ? { color: customHex } : { colorScheme: 'element' });
    const op = Math.min(1, Math.max(0, Number.isFinite(opacityValue) ? opacityValue : 0.4));
    const r = mode === 'mesh'
      ? add('surface', { sele, ...colorParams, wireframe: true, opacity: 1 })
      : mode === 'transparent'
        ? add('surface', { sele, ...colorParams, transparent: true, opacity: op })
        : add('surface', { sele, ...colorParams, opacity: 1 });
    // Remember the ESP-coloured surfaces so the ⚡ Range control re-colours them
    // live, exactly like the ⚡ ESP overlay (espApplyLimits).
    if (r && m.surfaceColor === 'esp') {
      const prev = catEspRepsRef.current.get(comp) || [];
      prev.push(r);
      catEspRepsRef.current.set(comp, prev);
    }
  };

  // ── The FILLED RING PLATES of « Stylized rings » ───────────────────────────
  // One MeshBuffer for every ring of the nucleic atoms of the selection (the base
  // ring system AND the ribose ring, see nucleicRingPlates), handed to THIS
  // component with addBufferRepresentation: the plates follow its matrix (a docking
  // pose, an extra molecule) and are removed with its other representations. NGL
  // draws a MeshBuffer double-sided, so `side: 'double'` is what makes a plate look
  // solid from both faces — and `opacity` < 1 is what makes it transparent
  // (Buffer#transparent = opacity < 1 || forceTransparent), i.e. the Ring
  // transparency of the menu. Returns the ring atom indices (the outline is drawn
  // over exactly those atoms), or null when there is nothing to fill.
  const addRingPlates = (sele) => {
    if (!sele) return null;
    const NG = typeof window !== 'undefined' ? window.NGL : null;
    const data = nucleicRingPlates(comp.structure, sele, cs.nucleic);
    if (!data || !data.rings || !NG || typeof NG.MeshBuffer !== 'function') return null;
    try {
      const mesh = new NG.MeshBuffer({ position: data.position, normal: data.normal, color: data.color, index: data.index });
      const rep = comp.addBufferRepresentation(mesh, { opacity: ringOpacity(), side: 'double' });
      if (rep) { flagMeshShadows(rep); reps.push(rep); }
      return { data, rep };
    } catch { return null; /* the plates are a bonus: never break the view */ }
  };

  // The two-colour ramp reads the per-chain ranges of what is DRAWN — and only
  // when a menu actually asks for it (the walk costs one pass over the polymer).
  if ((cs.protein && cs.protein.atomColor === 'gradient') || (cs.nucleic && cs.nucleic.atomColor === 'gradient')) {
    const polySele = [sels.protein, sels.nucleic].filter(Boolean).join(' or ') || 'polymer';
    gradientColorStore.ranges = gradientRangesFor(comp.structure, polySele);
  } else {
    gradientColorStore.ranges = null;
  }
  // Per structure too, so another loaded molecule's ramps can never be read here
  // (and this structure's can never be flattened by the next one — see
  // gradientColorStore.byStructure).
  if (gradientColorStore.byStructure) gradientColorStore.byStructure.set(comp.structure, gradientColorStore.ranges);

  // Fresh ESP-surface registry for this component: the caller removes the
  // previous representations right before calling this builder.
  catEspRepsRef.current.set(comp, []);

  // ---- A. Proteins ---------------------------------------------------------
  if (sels.n.protein !== 0) {
    const bb = cs.protein.backbone || 'cartoon';
    const col = backboneCol('protein');
    const g = catRadii(cs.protein);
    if (bb === 'cartoon') add('cartoon', { sele: sels.protein, ...col, quality: 'high' });
    else if (bb === 'trace') add('trace', { sele: sels.protein, ...col, quality: 'high' });
    else if (bb === 'tube') add('cartoon', { sele: sels.protein, ...col, radius: 0.3, quality: 'high' });
    else if (bb === 'ribbon') add('ribbon', { sele: sels.protein, ...col });
    // Ball & Stick / Sticks: the ATOM spheres keep the style's own aspect ratio,
    // scaled by the menu's Sphere radius, and the sticks take its Bond radius.
    else if (bb === 'ball+stick') add('ball+stick', { sele: sels.protein, ...atomCol('protein'), multipleBond: true, aspectRatio: 1.1 * g.sphere, ...stickGeom('protein', BALLSTICK_BOND_RADIUS) });
    else if (bb === 'sticks') add('ball+stick', { sele: 'protein and not sidechain', ...atomCol('protein'), multipleBond: true, aspectRatio: 1.1 * g.sphere, ...stickGeom('protein', BALLSTICK_BOND_RADIUS) });
    // Licorice — the stick style NGL really registers (there is no `stick`): atoms
    // and sticks share ONE radius, so the Bond radius is what acts on it.
    else if (bb === 'licorice') add('licorice', { sele: sels.protein, ...atomCol('protein'), ...stickGeom('protein', LICORICE_BOND_RADIUS) });
    else if (bb === 'lines') add('line', { sele: sels.protein, ...atomCol('protein'), ...lineGeom('protein') });
    else if (bb === 'spheres') add('spacefill', { sele: sels.protein, ...atomCol('protein'), radiusScale: g.sphere, scale: 0.6 });
    addSurface(sels.protein, 'protein', cs.protein.surfaceOpacity);
  }

  // ---- B. Nucleic acids ----------------------------------------------------
  if (sels.n.nucleic !== 0) {
    const nb = cs.nucleic.backbone || 'cartoon';
    const g = catRadii(cs.nucleic);
    // Colours of this menu: the three GROUPS of the 🎨 panel when its switch is
    // on (phosphate / pentose / bases), the classic look otherwise (rainbow by
    // residue index for the ribbon, NGL's resname palette for the base rungs).
    const stickCol = nucleicCol();
    const bbCol = nucleicGroupsOn() ? stickCol : backboneCol('nucleic');
    if (nb === 'cartoon') add('cartoon', { sele: sels.nucleic, ...bbCol, quality: 'high' });
    else if (nb === 'trace') add('trace', { sele: sels.nucleic, ...bbCol, quality: 'high' });
    else if (nb === 'tube') add('cartoon', { sele: sels.nucleic, ...bbCol, radius: 0.3, quality: 'high' });
    else if (nb === 'ribbon') add('ribbon', { sele: sels.nucleic, ...bbCol });
    else if (nb === 'licorice') add('licorice', { sele: sels.nucleic, ...stickCol, ...stickGeom('nucleic', LICORICE_BOND_RADIUS) });
    else if (nb === 'ball+stick') add('ball+stick', { sele: sels.nucleic, ...stickCol, multipleBond: true, aspectRatio: 1.1 * g.sphere, ...stickGeom('nucleic', BALLSTICK_BOND_RADIUS) });
    else if (nb === 'lines') add('line', { sele: sels.nucleic, ...stickCol, ...lineGeom('nucleic') });
    else if (nb === 'spheres') add('spacefill', { sele: sels.nucleic, ...stickCol, radiusScale: g.sphere, scale: 0.6 });
    // Bases: NGL's own `base` representation draws the filled base rungs (the
    // slabs / boxes of the DNA / RNA ladder); when the group colouring is ON the
    // rungs take the panel's « Bases » colour instead of the resname palette.
    const bases = cs.nucleic.bases || 'slab';
    const baseSlabCol = nucleicGroupsOn() ? { color: nucleicSchemeKey } : { colorScheme: 'resname' };
    if (bases === 'slab') add('base', { sele: sels.nucleic, ...baseSlabCol, ...stickGeom('nucleic', BASE_BOND_RADIUS) });
    // Stylized rings — the ONE style that colours the INSIDE of the rings, as
    // PyMOL's « set cartoon_ring_mode, 1 » does: the base rings AND the ribose ring
    // are FILLED PLATES (a MeshBuffer, see nucleicRingPlates), each base keeping its
    // own colour, and a thin stick draws the outline of exactly those rings. The
    // plates obey the menu's Ring colour / Ring transparency; « Sugar ring plates »
    // of the 🎨 panel decides whether the pentose ring is filled too.
    else if (bases === 'rings') {
      const plates = addRingPlates(sels.nucleic);
      const ringIdx = plates && plates.data ? plates.data.atomIndices : null;
      if (ringIdx && ringIdx.length) {
        add('licorice', { sele: `@${ringIdx.join(',')}`, ...ringLineCol(), radiusSize: LICORICE_BOND_RADIUS * 0.6 * g.bond });
      } else {
        // No plate could be built (a file without bonds, a modified base NGL does
        // not know): the base atoms keep their outlines, so the style still shows.
        add('licorice', { sele: 'nucleic and sidechain', ...ringLineCol(), radiusSize: LICORICE_BOND_RADIUS * 0.6 * g.bond });
      }
    }
    // « Sticks » IS licorice: NGL 2.4 registers no `stick` representation, so the
    // old add('stick', …) threw and the sticks never appeared at all.
    else if (bases === 'sticks') add('licorice', { sele: 'nucleic and sidechain', ...stickCol, ...stickGeom('nucleic', LICORICE_BOND_RADIUS) });
    else if (bases === 'lines') add('line', { sele: 'nucleic and sidechain', ...stickCol, ...lineGeom('nucleic') });
    else if (bases === 'spheres') add('spacefill', { sele: 'nucleic and sidechain', ...stickCol, radiusScale: g.sphere, scale: 0.6 });
    addSurface(sels.nucleic, 'nucleic', cs.nucleic.surfaceOpacity);
  }

  // ---- C. Lipids — headgroups / glycerol backbone / acyl chains ------------
  // THREE independent sub-selections of the same lipid group (PART 2.1). The
  // chemical part of every atom is decided in JS (lipidGroupOf) and handed to NGL
  // as `@index` lists, because NGL's `.NAME` rules are exact matches without any
  // wildcard. The headgroup is the EXCLUSION of the two other parts, so the three
  // selections tile the lipids exactly — no atom drawn twice, none forgotten, and
  // a headgroup shown as Ball & Stick keeps all its atoms and all their bonds.
  if (lipidSele) {
    const sub = lipidSubSelections(comp.structure, lipidSele);
    lipidColorStore.named = sub.named; // the 🎨 panel colours with the SAME rule
    const head = cs.lipid.head || 'spheres';
    const glycerol = cs.lipid.glycerol || 'ball+stick';
    const tail = cs.lipid.tail || 'lines';
    const col = lipidCol();
    const g = catRadii(cs.lipid);
    // One shared writer: every sub-component accepts the same style tokens, and
    // they all obey the menu's Atom colour / Sphere radius / Bond radius.
    const drawSub = (sele, style, ballAspect) => {
      if (!sele || !style || style === 'hide') return;
      if (style === 'ball+stick') add('ball+stick', { sele, ...col, multipleBond: true, aspectRatio: ballAspect * g.sphere, ...stickGeom('lipid', BALLSTICK_BOND_RADIUS) });
      else if (style === 'licorice') add('licorice', { sele, ...col, ...stickGeom('lipid', LICORICE_BOND_RADIUS) });
      // NGL 2.4 registers NO `stick` representation (ball+stick · licorice only):
      // the old add('stick', …) threw, so « Sticks » really means licorice.
      else if (style === 'stick' || style === 'sticks') add('licorice', { sele, ...col, ...stickGeom('lipid', LICORICE_BOND_RADIUS) });
      else if (style === 'lines' || style === 'line') add('line', { sele, ...col, ...lineGeom('lipid') });
      else if (style === 'spheres') add('spacefill', { sele, ...col, radiusScale: g.sphere, scale: 0.4 });
      else add('spacefill', { sele, ...col, radiusScale: g.sphere, scale: 0.6 });
    };
    // Headgroups = EVERY atom that is neither an acyl-chain atom nor a backbone
    // atom (the phosphate, the choline / ethanolamine part and their hydrogens).
    drawSub(sub.head, head, 1.3);
    // Glycerol backbone = the three carbons, their ester oxygens and hydrogens.
    drawSub(sub.glycerol, glycerol, 1.2);
    // Acyl chains = the two sn-1 / sn-2 chains (carbons, carbonyls, hydrogens).
    drawSub(sub.acyl, tail, 1.2);
    // The bilayer can also be shown as one surface (hidden by default), with the
    // menu's own colour — solid / transparent / mesh, exactly like the other menus.
    addSurface(lipidSele, 'lipid', cs.lipid.surfaceOpacity);
  }

  // ---- D. Sugars (carbohydrates) ------------------------------------------
  // NGL has no `carbohydrate` keyword: `saccharide` (the real keyword) OR the
  // explicit GLC / NAG / MAN / BMA / SIA / GAL / FUC list (SUGAR_SEL) — and the
  // ligand menu excludes exactly this selection, so a glycan is never styled as
  // a generic ligand.
  if (sugarSele && (route.wholeSugar || sels.n.sugar !== 0)) {
    const st = cs.sugar.style || 'ball+stick';
    const col = atomCol('sugar');
    const g = catRadii(cs.sugar);
    if (st === 'ball+stick') add('ball+stick', { sele: sugarSele, ...col, multipleBond: true, aspectRatio: 1.3 * g.sphere, ...stickGeom('sugar', BALLSTICK_BOND_RADIUS) });
    else if (st === 'licorice') add('licorice', { sele: sugarSele, ...col, ...stickGeom('sugar', LICORICE_BOND_RADIUS) });
    // « Sticks » = licorice: NGL registers no `stick` representation (a `stick`
    // style silently drew NOTHING before this).
    else if (st === 'sticks') add('licorice', { sele: sugarSele, ...col, ...stickGeom('sugar', LICORICE_BOND_RADIUS) });
    else if (st === 'spacefill') add('spacefill', { sele: sugarSele, ...col, radiusScale: g.sphere, scale: 0.7 });
    else if (st === 'lines') add('line', { sele: sugarSele, ...col, ...lineGeom('sugar') });
    else if (st === 'spheres') add('spacefill', { sele: sugarSele, ...col, radiusScale: g.sphere, scale: 0.6 });
    else if (st === 'surface') add('surface', { sele: sugarSele, ...col });
    addSurface(sugarSele, 'sugar', cs.sugar.surfaceOpacity);
  }

  // ---- E. Organic molecules (ligands / small molecules) --------------------
  if (organicSele && (route.wholeOrganic || route.noPolymer || sels.n.organic !== 0)) {
    const st = cs.organic.style || 'ball+stick';
    const col = atomCol('organic');
    const g = catRadii(cs.organic);
    if (st === 'ball+stick') add('ball+stick', { sele: organicSele, ...col, multipleBond: true, aspectRatio: 1.3 * g.sphere, ...stickGeom('organic', BALLSTICK_BOND_RADIUS) });
    else if (st === 'licorice') add('licorice', { sele: organicSele, ...col, ...stickGeom('organic', LICORICE_BOND_RADIUS) });
    // « Sticks » = licorice (NGL registers no `stick` representation).
    else if (st === 'sticks') add('licorice', { sele: organicSele, ...col, ...stickGeom('organic', LICORICE_BOND_RADIUS) });
    else if (st === 'spacefill') add('spacefill', { sele: organicSele, ...col, radiusScale: g.sphere, scale: 0.7 });
    else if (st === 'lines') add('line', { sele: organicSele, ...col, ...lineGeom('organic') });
    else if (st === 'spheres') add('spacefill', { sele: organicSele, ...col, radiusScale: g.sphere, scale: 0.6 });
    else if (st === 'surface') add('surface', { sele: organicSele, ...col });
    addSurface(organicSele, 'organic', cs.organic.surfaceOpacity);
  }

  // ---- F. Others (ions / water — and, on its own, the water surface) --------
  if (othersSele) {
    const ion = cs.other.ion || 'spheres';
    const col = atomCol('other');
    const g = catRadii(cs.other);
    if (ion === 'spheres') add('spacefill', { sele: 'ion', ...col, radiusScale: g.sphere, scale: 0.8 });
    else if (ion === 'ball+stick') add('ball+stick', { sele: 'ion', ...col, multipleBond: true, aspectRatio: 2.0 * g.sphere, ...stickGeom('other', BALLSTICK_BOND_RADIUS) });
    else if (ion === 'lines') add('line', { sele: 'ion', ...col, ...lineGeom('other') });
    else if (ion === 'dots') add('dot', { sele: 'ion', ...col });
    const water = cs.other.water || 'hidden';
    if (water === 'dots') add('dot', { sele: 'water', ...col });
    else if (water === 'points') add('point', { sele: 'water', ...col, pointSize: 1 * g.sphere, sizeAttenuation: true });
    else if (water === 'lines') add('line', { sele: 'water', ...col, ...lineGeom('other') });
    else if (water === 'spheres') add('spacefill', { sele: 'water', ...col, radiusScale: g.sphere, scale: 0.25 });
    else if (water === 'ball+stick') add('ball+stick', { sele: 'water', ...col, multipleBond: true, aspectRatio: 2.0 * g.sphere, ...stickGeom('other', BALLSTICK_BOND_RADIUS) });
  }
  // Water SURFACE — applied on its own, never inside the block above: the solvent
  // shell must be drawable as a solid / transparent / mesh surface even when the
  // water ATOMS are hidden (« Surface » in the Others menu), and even in a system
  // where the water is not part of any other selection (a pure-water box).
  if (cs.other.surface && cs.other.surface !== 'hide'
      && nglSeleCountCached(comp.structure, 'water') !== 0) {
    addSurface('water', 'other', cs.other.surfaceOpacity);
  }

  return reps;
};

// Add the default (backbone + sidechain + hetero) representations, honouring the
// current "Backbone" style selector. Called on load and when restoring from "Hide all".
const addDefaultReps = (component, molKey = 'main') => {
  if (!component || !component.structure) return;
  // `baseCompsRef.current` is the ONLY handle on the representations of the main
  // structure: whatever leaves that list can never be removed again — the scene
  // keeps drawing it for ever. `buildMainReps` used to call this function TWICE,
  // so the second call erased the first batch from the list while its
  // representations were still on screen: every styling gesture then redrew a
  // fresh batch UNDER a stale one, and the stale one kept showing the OLD state.
  // That is why unticking a molecule still drew it, why a surface could not be
  // made to go away and why the menus looked dead (« hide still does not hide »,
  // « nothing seems to work although the layout is good »). Drop what is still
  // tracked BEFORE the list is rebuilt, so the list can never lose a live rep.
  if (component === componentRef.current) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
  }
  baseCompsRef.current = [];
  const trackBase = (r) => { if (r) baseCompsRef.current.push(r); };
  // THE SECTIONS ARE ENUMERATED EVEN WHEN THE SYSTEM IS DRAWN LIGHTWEIGHT. The
  // styling bar of a molecule is built from `sectionCatalog`, and that catalogue
  // was only ever fed below — i.e. only in the non-light path: a large system (a
  // membrane protein with its lipids and its water, a solvated box) therefore
  // opened with an EMPTY bar (« Load a structure: one space appears here for every
  // molecule it holds ») and NO styling control at all, which is exactly the
  // report « the viewer did not store phospholipids in the styling window. they
  // were ignored ». Enumerating the sections costs one walk over the residues and
  // changes nothing to what is drawn.
  ensureSections(component, molKey);
  // Large systems START here: keep the whole structure visible, but draw
  // EVERYTHING with the same lightweight style chosen in "Large:" — lines
  // (bonds, the default), spheres (instanced spacefill) or dots (one point per
  // atom, the lightest). WATER IS NOT DRAWN by default: solvated / membrane
  // systems are dominated by water, which hides the protein and is the main
  // cause of the sluggish view; the "💧 Water" checkbox brings it back with the
  // same lightweight style. This block is only the STARTING layout: the first
  // styling choice made in §2 leaves it (leaveLightMode) for the per-category
  // representations below — that is what keeps the menus from being ignored.
  if (lightRenderRef.current) {
    const ls = largeStyleRef.current || 'lines';
    const sele = showLargeWaterRef.current ? 'all' : 'not water';
    try {
      if (ls === 'spheres') trackBase(component.addRepresentation('spacefill', { sele, colorScheme: 'element', scale: 0.25, quality: 'low' }));
      else if (ls === 'dots') trackBase(component.addRepresentation('dot', { sele, colorScheme: 'element' }));
      else trackBase(component.addRepresentation('line', { sele, colorScheme: 'element' }));
    } catch { /* lightweight style best-effort */ }
    return;
  }
  // THE SECTIONS (PART 4): every molecule of this component draws its own rows —
  // its style, its « Color by » and its transparency regulator — and every mesh the
  // rows create is flagged to cast AND receive shadows (flagMeshShadows).
  rebuildSectionsOf(component, molKey).forEach(trackBase);
};

// ✏️ WHICH molecule a component IS in the bar ('main' or the id of an extra): the
// ONE lookup the section renderer needs, so every call site keeps its old shape.
const molKeyOfComp = (comp) => {
  if (!comp) return 'main';
  if (comp === componentRef.current) return 'main';
  const hit = (extraCompsRef.current || []).find((e) => e && e.comp === comp);
  return hit ? hit.id : 'main';
};
// Rebuild EVERY representation of ONE component from its sections (PART 4). The
// sections are enumerated once per structure (ensureSections), each one carries its
// own tree of looks, and the ESP surfaces « Electrostatic potential » needs are
// registered for the ⚡ Range control. ONE builder for the main structure, an extra
// file and a chain — the bar can never style one molecule with another's rules.
const rebuildSectionsOf = (comp, molKey) => {
  if (!comp || !comp.structure) return [];
  const sections = ensureSections(comp, molKey);
  catEspRepsRef.current.set(comp, []);
  return buildSectionReps(comp, sections, sectionTreesOf(sections), {
    hidden: hiddenSectionIds(sections),
    espReps: catEspRepsRef.current,
  });
};

// Apply the CURRENT styles of the sections to ANY component — the main structure OR
// an extra molecule / chain — so changing a row updates everything, not just the
// main structure. Returns the list of representation objects added (the caller keeps
// them, so a later rebuild can remove exactly its own).
const applyCurrentStyleTo = useCallback((comp, baseReps) => {
  if (!comp || !comp.structure) return baseReps || [];
  (baseReps || []).forEach((r) => { try { comp.removeRepresentation(r); } catch {} });
  return rebuildSectionsOf(comp, molKeyOfComp(comp));
}, []);

// Build a proper NGL.Selection object. In NGL 2.4 `Structure#getAtomSet` IGNORES
// raw strings (it returns the full atom set) — it needs a Selection instance.
const nglSelection = (sele) => {
  try {
    if (typeof window !== 'undefined' && window.NGL && window.NGL.Selection) return new window.NGL.Selection(sele);
  } catch {}
  return null;
};
// NGL 2.4 `StructureSet` exposes the atom count as getSize() (a popcount), not
// `.count` / `.size` / `.length`.
const atomSetSize = (set) => (set && typeof set.getSize === 'function' ? set.getSize() : 0);

// Build the MAIN structure's base representations. PART 4 draws EVERY molecule —
// the main one included — from its own styling SECTIONS (rebuildSectionsOf → the
// per-molecule spaces of the « Molecules · styling » bar), so there is no
// per-molecule style override any more: `mainMolRef.style` and the old « auto »
// branch of section §2 are gone with buildCategoryReps. Selections / highlights
// live on the same component, so only the tracked base representations are
// replaced — never everything.
const buildMainReps = () => {
  const comp = componentRef.current;
  if (!comp || !comp.structure) return;
  baseCompsRef.current.forEach((r) => { try { comp.removeRepresentation(r); } catch {} });
  baseCompsRef.current = [];
  // The previous ESP-coloured category surfaces of the main component are gone
  // (they were part of baseCompsRef) — re-create them from scratch.
  catEspRepsRef.current.delete(comp);
  // ONE batch, for good: this call used to be duplicated, and the second batch
  // silently took the place of the first in `baseCompsRef` (addDefaultReps resets
  // the list) — the first one stayed on screen for ever, drawn with the styles of
  // the moment it was created. Every later gesture only restyled the tracked
  // batch, so the scene kept showing the previous state (the reported « hide does
  // not hide », « there is no way to remove a surface »).
  addDefaultReps(comp, 'main');
};

// ── ⚡ ESP — electrostatic-potential surface overlay ──────────────────────────
// NGL ships a built-in "electrostatic" colour scheme (registered in its
// ColormakerRegistry) that colours each surface vertex by the Coulombic
// potential of the partial charges. We pin its scale to the red → white → blue
// ramp (colorScale 'rwb') and drive the domain with the user's chosen limits
// (colorDomain, kcal/mol): ≤ −limit → full red (negative), 0 → white
// (neutral), ≥ +limit → full blue (positive). NGL's own default domain (±50)
// is so wide it leaves most of the surface near-white; the adjustable limits
// exist precisely to zoom the ramp onto the structure and see the red and blue
// poles. Partial charges are read from the input when the file/parser provides
// them (PQR, charged MOL2/SDF, …); a PROTEIN keeps NGL's CHARMM-derived table for
// its backbone + key side-chain atoms, and everything else (a docking pose, a
// lipid, a glycan, an ion) is ESTIMATED — see PART 4.0. Each molecule component
// (the main structure or any extra / model / chain) can have one overlay — it
// is a normal representation but tracked separately from the per-molecule base
// reps, so a style change never removes it accidentally.
const espAddSurfaceRep = (comp) => {
  if (!comp || !comp.structure) return null;
  try {
    // 'not water' skips the noisy solvent shell of membrane / water-heavy files;
    // opacity < 1 keeps the cartoon / atoms legible underneath the map.
    // The colouring is espColorParams(): the viewer's OWN `lab-esp` scheme, which
    // charges the hetero atoms NGL leaves at zero (see PART 4.0) — a docking pose
    // or a lipid really shows its red and blue poles now.
    return comp.addRepresentation('surface', {
      sele: 'not water',
      ...espColorParams(),
      opacity: 0.85
    });
  } catch { return null; }
};

// Re-colour every live ESP overlay with the chosen limits. When numbers are
// passed (presets) they win; otherwise the current input state is used. This
// goes through each representation's own setParameters({ colorDomain }) — NGL's
// "update color" path — so the surface geometry is NOT recomputed, only the
// red/white/blue ramp is re-applied (cheap and instant).
const espApplyLimits = (nl, pl) => {
  const prev = espLimitsRef.current || [15, 15];
  const nv = Number.isFinite(nl) ? nl : Number(prev[0]);
  const pv = Number.isFinite(pl) ? pl : Number(prev[1]);
  const neg = Math.min(500, Math.max(0.5, Number.isFinite(nv) && nv > 0 ? nv : 15));
  const pos = Math.min(500, Math.max(0.5, Number.isFinite(pv) && pv > 0 ? pv : 15));
  // Keep the inputs in sync with what was actually applied (presets included).
  setEspLimits([neg, pos]);
  const keys = Object.keys(espRepsRef.current);
  keys.forEach((key) => {
    const rep = espRepsRef.current[key];
    if (!rep) return;
    try { rep.setParameters({ colorScale: 'rwb', colorDomain: [-neg, pos] }); } catch { /* best-effort */ }
  });
  // …and every per-CATEGORY surface built with « Surface Color: ESP »
  // (Proteins / Nucleic acids / Organic molecules): same ramp, same limits, so
  // the ⚡ Range control drives both ESP entry points at once.
  catEspRepsRef.current.forEach((list) => {
    (list || []).forEach((rep) => {
      if (!rep) return;
      try { rep.setParameters({ colorScale: 'rwb', colorDomain: [-neg, pos] }); } catch { /* best-effort */ }
    });
  });
  if (keys.length || catEspRepsRef.current.size) {
    try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch { /* ignore */ }
  }
};

// Pressing Enter in a limit box applies the range immediately.
const espApplyLimitsOnEnter = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    espApplyLimits();
  }
};

const resolveMolComp = (key) => {
  if (!key || key === 'main') return componentRef.current;
  const entry = extraCompsRef.current.find((e) => e.id === key);
  return entry ? entry.comp : null;
};

const espEnable = (key) => {
  const comp = resolveMolComp(key);
  if (!comp || !comp.structure || espRepsRef.current[key]) return;
  const rep = espAddSurfaceRep(comp);
  if (!rep) return;
  espRepsRef.current[key] = rep;
  setEspMolKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  // Make sure the molecule is actually on screen — the surface overlay on a
  // hidden extra molecule would otherwise be invisible (the visibility effect
  // below flips its component on once its key enters visibleMolKeys).
  if (key !== 'main') {
    setVisibleMolKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

const espDisable = (key) => {
  const rep = espRepsRef.current[key];
  if (rep) {
    const comp = resolveMolComp(key);
    try { if (comp) comp.removeRepresentation(rep); } catch {}
  }
  delete espRepsRef.current[key];
  setEspMolKeys((prev) => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

const espForget = (key) => {
  // Bookkeeping-only removal: the component (and therefore its representations)
  // is already gone or about to be destroyed (new load / clear / delete).
  if (!(key in espRepsRef.current)) return;
  delete espRepsRef.current[key];
  setEspMolKeys((prev) => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
};

const espResetAll = () => {
  Object.keys(espRepsRef.current).forEach(espForget);
};

const espToggle = (key) => {
  if (espRepsRef.current[key]) espDisable(key);
  else espEnable(key);
};

// Load ONE chain of a multi-chain PDB as its own (hidden) NGL component and add
// it to the Molecules selector. Called by the main-load effect after the whole
// structure is parsed.
const loadChainMolecule = useCallback(async (blob, name, ci) => {
  const stage = stageRef.current;
  if (!stage) return;
  try {
    const comp = await stage.loadFile(blob, { ext: 'pdb' });
    try { ensureGlycanBonds(comp); } catch { /* best-effort (PART 2.2bis) */ }
    const baseReps = applyCurrentStyleTo(comp, []);
    shadowRepsHook(comp);
    if (shadowOnRef.current) setMeshShadows(comp);
    extraCompsRef.current.push({ id: `chain_${Date.now()}_${ci}`, name, comp, baseReps, style: 'auto', color: '', colorMode: 'element', transparency: 0, position: [0, 0, 0] });
    try { comp.setVisibility(false); } catch {}
  } catch { /* chain load failed — keep it inside the main component */ }
}, [applyCurrentStyleTo]);

// Main structure load
useEffect(() => {
if (!loadRequest || (!loadRequest.file && !loadRequest.url && !loadRequest.text)) return;
let cancelled = false;
const abortToken = {};
abortRef.current = {
  token: abortToken,
  label: 'structure loading',
  cancel: () => {
    cancelled = true;
    setStatus('idle');
    setErrorMsg('');
    setLoadRequest(null);
    componentRef.current = null;
    setSelections([]);
    setResidueTicks([]);
    stripResidueRiRef.current = null;
    setLightRender(false);
    setLightInfo(null);
    setHasNonProtein(false);
    setCatInfo(null);
    try { if (stageRef.current) stageRef.current.removeAllComponents(); } catch {}
    clearMeasurements(); // distance lines belong to the removed components
  }
};
const unregisterAbort = abortControl.register('structure loading', () => {
  if (abortRef.current && abortRef.current.token === abortToken) {
    const a = abortRef.current;
    abortRef.current = null;
    a.cancel();
  }
});
setStatus('loading');
setErrorMsg('');
setTrajFile(null);
setTrajStatus('none');
// Release the global ⏹ Stop registration as soon as the structure finishes
// loading (success or error) — otherwise the red "Stop (structure loading)"
// pill stays visible forever after a completed load.
const finishStructLoad = () => {
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};
setNumFrames(0);
setCurrentFrame(0);
setPlaying(false);
setTrajError('');
trajRef.current = null;

const run = async () => {
try {
const stage = await stageReadyRef.current;
if (cancelled || !stage) return;
stage.removeAllComponents();
clearMeasurements(); // any previously drawn distance lines are gone too
componentRef.current = null;
espResetAll(); // every previous component (and its ⚡ ESP overlay) is gone
highlightCompRef.current = null;
manualHighlightCompRef.current = null;
labelCompRef.current = null;
sidechainCompRef.current = null;

let component;
loadedPdbTextRef.current = null;
if (loadRequest.file) {
  const fname = String((loadRequest.file && loadRequest.file.name) || '').toLowerCase();
  if (fname.endsWith('.pdb') || fname.endsWith('.ent')) {
    try { loadedPdbTextRef.current = await loadRequest.file.text(); } catch { /* keep null */ }
  }
  component = await stage.loadFile(loadRequest.file);
} else if (loadRequest.text) {
  if (['pdb', 'ent'].includes(String(loadRequest.ext || '').toLowerCase())) loadedPdbTextRef.current = loadRequest.text;
  const blob = new Blob([loadRequest.text], { type: 'text/plain' });
  component = await stage.loadFile(blob, { ext: loadRequest.ext || 'pdb' });
} else {
const target = normalizeStructureSource(loadRequest.url);
if (!target) throw new Error('No structure URL or PDB ID provided');
try {
component = target.params ? await stage.loadFile(target.url, target.params) : await stage.loadFile(target.url);
} catch (firstErr) {
if (cancelled) throw firstErr;
let loaded = false;
if (target.fallbacks && Array.isArray(target.fallbacks)) {
for (const fb of target.fallbacks) {
if (cancelled) throw firstErr;
try {
component = fb.params ? await stage.loadFile(fb.url, fb.params) : await stage.loadFile(fb.url);
loaded = true;
break;
} catch { /* try next fallback */ }
}
}
if (!loaded) {
const raw = (loadRequest.url || '').trim();
const idMatch = raw.match(/([0-9][A-Za-z0-9]{3})(?:\.[A-Za-z0-9]+)?\/?$/);
if (idMatch) {
const id = idMatch[1].toUpperCase();
try {
component = await stage.loadFile(`https://files.rcsb.org/download/${id}.pdb`, { ext: 'pdb' });
} catch (secondErr) {
if (cancelled) throw secondErr;
component = await stage.loadFile(`rcsb://${id}`);
}
} else {
throw firstErr;
}
}
}
}

if (cancelled) return;
componentRef.current = component;

// What the FILE did not say about the sugars — the glycosidic linkages of a
// polysaccharide — is written into the bond graph NOW, before a single
// representation exists: NGL infers a linkage bond from the distance when it
// parses a PDB (and this is a no-op then), but a file whose het residues carry
// their own explicit bonds, an `inferBonds` that skipped them or an alternate
// conformation NGL refuses to connect all leave the chain unlinked. See PART 2.2bis.
try { ensureGlycanBonds(component); } catch { /* best-effort — the grouping stands on its own */ }

// Note: NGL viewer structures from PDB/SDF already contain hydrogens when generated correctly.
// We skip addHydrogens() to prevent "is not a function" errors in this NGL version.

// Large systems (e.g. a protein in a lipid bilayer with explicit solvent):
// load everything and render it ALL, but with lightweight instanced
// representations (protein cartoon + spacefill) so the browser does not freeze.
const nAtoms = component.structure ? component.structure.atomCount : 0;
const bigSource = (loadRequest && loadRequest.size) >= LARGE_STRUCT_BYTES;
const isLarge = nAtoms > LARGE_ATOM_COUNT || bigSource;
lightRenderRef.current = isLarge;
setLightRender(isLarge);
if (isLarge) {
  setLightInfo({ nAtoms, size: loadRequest && loadRequest.size ? loadRequest.size : 0 });
} else {
  setLightInfo(null);
}
// Whether this structure contains any non-protein atoms — shows the "Molecule
// Style" dropdown so ligands/lipids/water inside a protein complex can be styled.
let nonProtein = false;
try {
  const h = component.structure.getAtomSet(nglSelection('hetero and not water'));
  const w = component.structure.getAtomSet(nglSelection('water'));
  nonProtein = atomSetSize(h) > 0 || atomSetSize(w) > 0;
} catch { nonProtein = false; }
setHasNonProtein(nonProtein);
// Per-CATEGORY content of THIS structure (protein / nucleic / lipids / organic /
// others) → the five styling menus say what they can act on, and the Lipids menu
// stays honest when the file contains no recognised lipid residue.
try {
  const cs2 = catSelectionsFor(component.structure);
  // …plus the two readings of PART 2 / PART 3, computed ONCE here — the menus print
  // them and the schemes would otherwise have to walk the atoms again: the GLYCAN
  // ENTITIES of the sugars (one per linked glycan) and the FORM / MOTIF counts of
  // the nucleic acids (A · B · Z DNA, A · flexible RNA, G-quadruplex, hairpin).
  setCatInfo(cs2 ? {
    ...cs2.n,
    lipids: cs2.lipids,
    lipidNamed: cs2.lipidNamed,
    glycans: glycanSummaryFor(component.structure),
    nucleicClasses: nucleicClassCounts(component.structure),
  } : null);
} catch { setCatInfo(null); }
buildMainReps();
shadowRepsHook(component);
if (shadowOnRef.current) setMeshShadows(component);

// Multi-MODEL PDB files (ensembles / docking clusters / NMR structures):
// NGL 2.4.0 does not expose structure.frameCount (and StructureComponent has
// no setFrame), so the MODEL count comes from structure.modelStore.count —
// the number of MODEL records the PDB parser created. The per-MODEL /
// per-molecule text split below exposes each entry in the Molecules selector.
let nglModelCount = 0;
try {
  nglModelCount = component.structure && component.structure.modelStore
    ? component.structure.modelStore.count : 0;
} catch { nglModelCount = 0; }

// Multi-molecule / multi-MODEL PDB (complexes, docking poses, NMR ensembles):
// expose each MOLECULE — or each MODEL conformer — as its own entry in the
// Molecules selector so the partners can be viewed alone or together. Uses the
// PDB TEXT (deterministic, NGL-version independent) with connectivity from
// CONECT + proximity, scoped to MODEL records. Non-PDB inputs are skipped.
try {
  const srcFile = loadRequest && loadRequest.file;
  const textIsPdb = !!(loadRequest && loadRequest.text && ['pdb', 'ent'].includes(String(loadRequest.ext || '').toLowerCase()));
  if (srcFile || textIsPdb) {
    const isPdb = srcFile
      ? /\.(pdb|ent)$/i.test(String(srcFile.name || ''))
      : textIsPdb;
    if (isPdb) {
      const srcForSplit = srcFile || new Blob([loadRequest.text], { type: 'text/plain' });
      const moleculeParts = await splitPdbFileIntoMolecules(srcForSplit);
      if (moleculeParts.length > 1) {
        const multiModel = nglModelCount > 1 || (moleculeParts[0] && moleculeParts[0].modelCount > 1);
        const perModelCounts = new Map();
        moleculeParts.forEach((p) => perModelCounts.set(p.model, (perModelCounts.get(p.model) || 0) + 1));
        const onePartPerModel = moleculeParts.every((p) => perModelCounts.get(p.model) === 1);
        for (let ci = 0; ci < moleculeParts.length; ci++) {
          const part = moleculeParts[ci];
          const label = multiModel
            ? `${onePartPerModel ? `Model ${part.model + 1}` : `Molecule ${ci + 1} (Model ${part.model + 1})`}${part.chainId && part.chainId !== '_' ? ` · ${part.chainId}` : ''}`
            : (part.chainId && part.chainId !== '_' ? `Chain ${part.chainId}` : `Molecule ${ci + 1}`);
          await loadChainMolecule(part.blob, label, ci);
        }
        setExtraMols(extraMolsSnapshot());
      }
    }
  }
} catch { /* molecule splitting failed — keep the whole structure as one component */ }

// Residue ticks (resno / resname / 1-letter code / NATURE per residue) — built
// ONCE here, because the strip AND the sequence handshake below both need them.
const ticks = collectResidueTicks(component);
setResidueTicks(ticks);
stripResidueRiRef.current = null;

// Expose the sequence parsed from the structure so the pages can auto-fill the
// sequence fields when they are empty (enables the per-atom table). The SECOND
// argument splits that sequence BY NATURE — { protein: …, dna: …, rna: … } — so
// a page stores a nucleic-acid sequence in the DNA / RNA field instead of the
// Proteins one (see src/utils/sequenceNatures.js). The whole file keeps being
// drawn in THIS viewer: the split only says where a letter comes from.
if (typeof onStructureSequence === 'function') {
const seq = extractStructureSequence(component);
const parts = structureSequenceParts(ticks);
if (seq || parts.protein.seq || parts.dna.seq || parts.rna.seq) onStructureSequence(seq, parts);
}

component.autoView();
requestAnimationFrame(() => {
if (cancelled || !stageRef.current) return;
try { stageRef.current.handleResize(); } catch {}
try { component.autoView(); } catch {}
});

if (!(component.structure ? component.structure.atomCount : 0)) {
throw new Error('The structure loaded but contains no atoms (empty/invalid file content).');
}
setStatus('ready');
applyShadowSettings(); // (re)configure the light/shadow map now that the bbox is known
finishStructLoad();
} catch (err) {
if (!cancelled) {
const raw = (err && err.message ? String(err.message) : '').trim();
setErrorMsg(raw || 'Failed to load structure.');
setResidueTicks([]);
stripResidueRiRef.current = null;
finishStructLoad();
setStatus('error');
}
}
};
run();
return () => {
  cancelled = true;
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [loadRequest, applyShadowSettings]);

// ---- Trajectory Loading Effect ----
useEffect(() => {
if (trajAborted) return; // user aborted the trajectory — do not auto-reload (e.g. from props)
const component = componentRef.current;
if (!component || status !== 'ready') return;
const targetSrc = trajFile || trajectoryFile || trajectorySrc;
if (!targetSrc) return;
let cancelled = false;
const abortToken = {};
abortRef.current = {
  token: abortToken,
  label: 'trajectory loading',
  cancel: () => {
    cancelled = true;
    setTrajAborted(true); // block auto-reload (e.g. from the trajectorySrc prop) until the user picks a new trajectory
    setTrajStatus('idle');
    setTrajError('');
    setPlaying(false);
    setNumFrames(0);
    setTrajTotal(0);
    setCurrentFrame(0);
    trajRef.current = null;
    setTrajFile(null);
    try { if (componentRef.current && typeof componentRef.current.removeAllTrajectories === 'function') componentRef.current.removeAllTrajectories(); } catch {}
  }
};
const unregisterAbort = abortControl.register('trajectory loading', () => {
  if (abortRef.current && abortRef.current.token === abortToken) {
    const a = abortRef.current;
    abortRef.current = null;
    a.cancel();
  }
});
setTrajStatus('loading');
setTrajError('');
setNumFrames(0);
setTrajTotal(0);
setCurrentFrame(0);
setPlaying(false);

// Release the global ⏹ Stop registration as soon as the trajectory finishes
// (success or failure) — otherwise the red "Stop (trajectory loading)" pill
// stays visible forever after a completed load.
const finishTrajLoad = () => {
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};

const initTraj = async () => {
try {
const NGL = await ensureNGL();
if (cancelled) return;
let targetCand = targetSrc;
let ext = trajectoryFormat || 'xtc';
let srcFile = null;
if (typeof targetSrc === 'object' && targetSrc instanceof File) {
  srcFile = targetSrc;
  const fileParts = targetSrc.name.split('.');
  ext = fileParts.length > 1 ? fileParts.pop().toLowerCase() : ext;
  if (ext !== 'xtc') {
    // Non-XTC files still go through NGL (blob URL), exactly as before.
    targetCand = URL.createObjectURL(targetSrc);
    blobUrlsRef.current.push(targetCand);
  }
}

// ---- Native incremental XTC decode (local .xtc files) ---------------------
// NGL's own parse of a large XTC is all-or-nothing and reports no per-frame
// progress. Decoding the file natively here lets the UI show a live
// "N / total frames loaded" counter and stay responsive (the generator
// yields between frames, so the Abort button keeps working).
if (ext === 'xtc' && srcFile) {
  const ab = await srcFile.arrayBuffer();
  if (cancelled) return;
  const { totalFrames } = countXtcFrames(ab);
  if (totalFrames > 0) setTrajTotal(totalFrames);
  const coords = [];
  const boxes = [];
  const times = [];
  let done = 0;
  for await (const fr of readXtcFrames(ab)) {
    if (cancelled) return;
    coords.push(fr.coords);
    boxes.push(fr.box);
    times.push(fr.time);
    done++;
    if (done === totalFrames || done % 20 === 0) {
      // Keep the counter honest: the header-scan total is only an estimate —
      // the decoded count is authoritative, so the total shown must never lag
      // behind (otherwise the live counter would claim "more than total").
      setNumFrames(done);
      if (totalFrames <= 0 || done > totalFrames) setTrajTotal(done);
      await new Promise((r) => setTimeout(r, 0)); // let React repaint + honour aborts
    }
  }
  if (cancelled) return;
  if (done === 0) {
    throw new Error('Trajectory contains 0 readable frames. Verify that the PDB and XTC have the exact same atom count.');
  }
  // The actually decoded frame count is the authoritative total.
  setNumFrames(done);
  setTrajTotal(done);
  const frames = new NGL.Frames(srcFile.name, srcFile.name);
  frames.coordinates = coords;
  frames.boxes = boxes;
  frames.times = times;
  frames.timeOffset = times[0] || 0;
  frames.deltaTime = times.length > 1 ? times[1] - times[0] : 1;
  setNumFrames(done);
  const trajComp = component.addTrajectory(frames);
  const traj = (trajComp && trajComp.trajectory) || getTrajectoryObject(component);
  if (!traj) throw new Error('Could not attach trajectory');
  trajRef.current = traj;
  try { if (typeof traj._setFrameCount === 'function') traj._setFrameCount(done); } catch {}
  setCurrentFrame(0);
  setTrajStatus('ready');
  finishTrajLoad();
  return;
}

const candidates = [
targetCand,
...(Array.isArray(trajectoryFallbacks) ? trajectoryFallbacks : []),
].filter(Boolean);
let frames = null;
let lastTrajErr = null;
for (const cand of candidates) {
if (cancelled) return;
try {
frames = await NGL.autoLoad(cand, { ext });
if (frames) break;
} catch (e) { lastTrajErr = e; }
}
if (!frames) throw lastTrajErr || new Error('Could not parse trajectory frames from any candidate URL');

if (cancelled) return;
const trajComp = component.addTrajectory(frames);
const traj = (trajComp && trajComp.trajectory) || getTrajectoryObject(component);
if (traj) {
trajRef.current = traj;
const initialFrames = getNumFrames(traj);
if (initialFrames > 0) {
setNumFrames(initialFrames);
setCurrentFrame(0);
setTrajStatus('ready');
finishTrajLoad();
} else {
const checkInterval = setInterval(() => {
const nf = getNumFrames(traj);
if (nf > 0) {
setNumFrames(nf);
setCurrentFrame(0);
setTrajStatus('ready');
finishTrajLoad();
clearInterval(checkInterval);
}
}, 250);
setTimeout(() => {
clearInterval(checkInterval);
if (getNumFrames(traj) === 0 && !cancelled) {
setTrajStatus('error');
setTrajError('Trajectory loaded but contains 0 frames. Verify that the PDB and XTC have the exact same atom count.');
finishTrajLoad();
}
}, 10000);
}
} else {
throw new Error('Could not attach trajectory');
}
} catch (err) {
if (!cancelled) {
setTrajStatus('error');
setTrajError(err?.message || 'Failed to load trajectory. Check matching atom count.');
finishTrajLoad();
}
}
};
initTraj();
return () => {
  cancelled = true;
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};
}, [trajFile, trajectoryFile, trajectorySrc, trajectoryFormat, status, trajAborted]);

// ---- Trajectory Playback Loop ----
useEffect(() => {
if (!playing || !trajRef.current || keptFrames === 0) return;
const interval = Math.max(16, 1000 / speed);
const id = setInterval(() => {
setCurrentFrame((prev) => {
const next = (prev + 1) % keptFrames;
setFrameSafe(trajRef.current, toActualFrame(next));
return next;
});
}, interval);
return () => clearInterval(id);
}, [playing, speed, keptFrames, stride, numFrames, maxFrames]);

/* PLAYBACK IS NOT AN OPERATION TO ABORT (the report: « When I play a md run I have
   an annoying window on top saying to abort it but it makes no sense because I can
   simply stop it. the trajectory has already been loaded. »). This effect used to
   register « trajectory playback » with the global abort registry, so the
   always-visible ⏹ Stop pill of the shell turned red and pulsing with
   « Stop (trajectory playback) » on top of the page for the whole run — while the
   playback row of the viewer already carries ▶ / ⏸ and the trajectory is loaded.
   The registry is for the LONG operations that can freeze a page (a structure / a
   trajectory LOAD, an MD analysis, a DSSP run): those keep registering, playback
   does not. */


const togglePlay = () => {
if (trajStatus !== 'ready' || keptFrames === 0) return;
setPlaying((p) => !p);
};

const handleFrameChange = (e) => {
const idx = parseInt(e.target.value, 10);
if (Number.isNaN(idx)) return;
setCurrentFrame(idx);
setFrameSafe(trajRef.current, toActualFrame(idx));
};

// ---- ⬇ PDB of the structure / of the frame ON SCREEN -----------------------
// §1 · General. NGL's own PdbWriter walks the atoms of the loaded structure and
// writes the coordinates NGL is displaying RIGHT NOW — AtomProxy x/y/z follow
// the active trajectory frame — together with resname / chain / resno /
// element / occupancy, so the file is exactly the picture on screen (one MD
// snapshot) and can be re-opened in PyMOL, VMD or back in this viewer. Without
// a trajectory it simply saves the loaded structure. The frame number is both
// written in the REMARK lines and appended to the file name.
const downloadFramePdb = async () => {
  const component = componentRef.current;
  const structure = component && component.structure;
  if (!structure) {
    setPdbMsg('⚠️ Load a structure first');
    return;
  }
  const onFrame = !!trajRef.current;
  const frameNo = onFrame ? toActualFrame(currentFrame) : -1;
  try {
    const NS = await ensureNGL();
    const writer = new NS.PdbWriter(structure);
    const text = writer.getData();
    const base = String(
      (file && file.name) || (structure.name || '') || trajectoryName || 'structure'
    ).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'structure';
    const name = frameNo >= 0 ? `${base}_frame_${frameNo}.pdb` : `${base}.pdb`;
    const blob = new Blob([text], { type: 'chemical/x-pdb' });
    const url = URL.createObjectURL(blob);
    blobUrlsRef.current.push(url); // released with the viewer's other blob URLs
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPdbMsg(frameNo >= 0
      ? `⬇ ${name} — frame ${frameNo} of ${numFrames}`
      : `⬇ ${name}`);
  } catch (err) {
    setPdbMsg(`⚠️ ${(err && err.message) || 'Could not write the PDB file'}`);
  }
};

// ---- Large-trajectory confirmation ----------------------------------------
const handleTrajFileChosen = (f) => {
if (!f) return;
setTrajAborted(false); // a fresh user-selected trajectory is always allowed
const structure = componentRef.current && componentRef.current.structure;
const atomCount = structure ? structure.atomCount : 0;
const name = (f.name || '').toLowerCase();
const isTraj = name.endsWith('.xtc') || name.endsWith('.trr') || name.endsWith('.dcd') || name.endsWith('.nc');
if (!isTraj) {
setTrajFile(f);
onTrajectoryFile?.(f);
return;
}
// Always ask the user how to load the trajectory — frame COUNT matters, not
// file size. Representative frames are spread evenly over the whole run.
const { estFrames, bytesPerFrame } = estimateTrajectoryFrames(f, atomCount);
const finalizePendingTraj = (est, bpf) => {
  const over2G = f.size > TARGET_TRAJ_BYTES;
  let suggested = 1;
  if (est > TARGET_TRAJ_FRAMES) {
    suggested = Math.min(1000, Math.max(1, Math.ceil(est / TARGET_TRAJ_FRAMES)));
  }
  if (over2G) {
    // Recalculate the stride so the effective loaded data stays under ~2 GB.
    const keepFrames = Math.max(1, Math.floor(TARGET_TRAJ_BYTES / Math.max(1, bpf)));
    suggested = Math.max(suggested, Math.min(1000, Math.max(1, Math.ceil(est / keepFrames))));
  }
  setTrajFrameCount(Math.min(TARGET_TRAJ_FRAMES, est));
  setPendingTraj({ file: f, estFrames: est, suggested, over2G });
};
if (name.endsWith('.xtc')) {
  // XTC frame count can be read exactly from the file headers (fast chunked
  // scan, no decompression) — show the real number in the confirmation dialog.
  lastChosenTrajRef.current = f;
  countXtcFramesInFile(f)
    .then(({ totalFrames }) => {
      if (lastChosenTrajRef.current !== f) return; // stale: user already moved on
      const est = totalFrames > 0 ? totalFrames : estFrames;
      const bpf = totalFrames > 0 ? Math.max(1, f.size / totalFrames) : bytesPerFrame;
      finalizePendingTraj(est, bpf);
    })
    .catch(() => { if (lastChosenTrajRef.current === f) finalizePendingTraj(estFrames, bytesPerFrame); });
} else {
  finalizePendingTraj(estFrames, bytesPerFrame);
}
};

const acceptTrajReduction = () => {
if (!pendingTraj) return;
setTrajAborted(false); // a fresh user-selected trajectory is always allowed
const target = Math.min(Math.max(1, parseInt(trajFrameCount, 10) || TARGET_TRAJ_FRAMES), Math.max(1, pendingTraj.estFrames));
const strideNeeded = Math.max(1, Math.ceil(pendingTraj.estFrames / Math.max(1, target)));
setStride(strideNeeded);
setMaxFrames(target);
setTrajFile(pendingTraj.file);
onTrajectoryFile?.(pendingTraj.file);
setPendingTraj(null);
};

const loadTrajWithoutReduction = () => {
if (!pendingTraj) return;
setTrajAborted(false); // a fresh user-selected trajectory is always allowed
setTrajFile(pendingTraj.file);
onTrajectoryFile?.(pendingTraj.file);
setPendingTraj(null);
};

// ---- Structure load funnel -------------------------------------------------
// Every structure source goes through here. The size is tagged onto the load
// request so the load effect can auto-hide all but the first chain on very
// large systems (the structure is still loaded in full for the analysis).
const requestStructureLoad = (payload) => {
const file = payload.file;
const size = file ? file.size : (payload.text ? payload.text.length : 0);
setLoadRequest({ ...payload, size });
};

// Sync externally-provided atom renames (e.g. restored from the active test)
useEffect(() => {
  if (atomRenames && typeof atomRenames === 'object') {
    setRenames((prev) => {
      const next = { ...prev, ...atomRenames };
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }
}, [atomRenames]);

// Collect the atom list once the structure is ready (for the rename panel)
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready' || !component.structure) return;
  const list = [];
  try {
    component.structure.eachAtom((a) => {
      const rawResno = a.resno != null ? Number(a.resno) : 0;
      list.push({ idx: a.index, element: a.element || '', name: a.atomname || '', resno: displayResno(rawResno), rawResno, resname: a.resname || '' });
    });
  } catch {}
  setAtomList(list);
  setResidueInfo(collectResidues(component.structure));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, renumberMap]);

// ---- PyMOL-style selections & effects ----
const selCompsRef = useRef({});       // key -> [representations]
const baseCompsRef = useRef([]);      // default representations added at load
const selStylesRef = useRef(selStyles);
selStylesRef.current = selStyles;
// The `set` commands of the running macro (atom properties) and the material
// settings — read inside the rendering effect.
const selOverridesRef = useRef(selOverrides);
selOverridesRef.current = selOverrides;
const matSettingsRef = useRef(matSettings);
matSettingsRef.current = matSettings;
const membraneSeleRef = useRef(membraneSele);
membraneSeleRef.current = membraneSele;

/* The membrane of the loaded structure, measured once per load: the normal
   axis, the midplane (Å) and the four reserved selections. A macro that
   defines `upper_leaflet` with `z>90` still gets THIS one (the measurement is
   exact, the z guess is not) — and the macro log says so. */
useEffect(() => {
  if (status !== 'ready') { setMembraneSele({}); setMembraneInfo(null); return; }
  const component = componentRef.current;
  const structure = component && component.structure ? component.structure : null;
  const m = membraneLeafletsOf(structure);
  if (!m) { setMembraneSele({}); setMembraneInfo(null); return; }
  const headClause = (side) => (side.headIndices.length ? `@${side.headIndices.join(',')}` : 'none');
  setMembraneSele({
    upper_leaflet: m.upper.clause,
    lower_leaflet: m.lower.clause,
    upper_headgroups: headClause(m.upper),
    lower_headgroups: headClause(m.lower),
  });
  setMembraneInfo({
    axis: m.axis,
    midplane: m.midplane,
    thickness: m.thickness,
    upperAtoms: m.upper.atoms,
    lowerAtoms: m.lower.atoms,
    upperResidues: m.upper.residues,
    lowerResidues: m.lower.residues,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status]);
// The styling SIGNATURE the running PyMOL script itself produced. A script may
// write §2 values (cartoon_ring_mode …): that first change is ITS own and is
// adopted here. Any LATER change is the user's, and then §2 takes the main
// structure back — this is what stops a macro from freezing the six menus.
const pymolOwnSigRef = useRef(null);

// ONE expansion for every PyMOL expression — through the REAL bridge (see
// pymolSeleToNgl at module scope): the macro's own selections are inlined like
// PyMOL sets, and every predicate is translated into what NGL really reads
// (`resn`→a bare resname, `name`→`.CA`, `resi`→`1-10`, `chain`→`:A`, `elem`→`_C`,
// `z>90`→an atom-index list, jokers expanded against THIS structure).
// A style key and the « hide » expression subtracted from it go through the
// SAME function, so they can never resolve to different atoms. The warnings the
// bridge emits (a residue name the structure has not, a coordinate without a
// structure) are collected per expression and shown as a ⚠ on the row: an empty
// selection may no longer happen in silence.
const seleExprCacheRef = useRef(new Map());
const seleCacheStructRef = useRef(null);
const usedTranslateWarnRef = useRef(new Map());
const namedSeleMap = () => {
  const m = new Map();
  selections.forEach((s) => { if (s && s.name) m.set(String(s.name).toLowerCase(), s.expr); });
  return m;
};
const expandSelectionExpr = (raw) => {
  const text = String(raw || '');
  if (!text) return 'all';
  const component = componentRef.current;
  const structure = component && component.structure ? component.structure : null;
  if (seleCacheStructRef.current !== structure) {
    seleCacheStructRef.current = structure;
    seleExprCacheRef.current.clear();
    usedTranslateWarnRef.current.clear();
  }
  const cache = seleExprCacheRef.current;
  if (cache.has(text)) return cache.get(text);
  const warns = [];
  const ngl = pymolSeleForStructure(structure, namedSeleMap(), text, (m) => warns.push(m), membraneSeleRef.current);
  if (warns.length) usedTranslateWarnRef.current.set(text, warns);
  else usedTranslateWarnRef.current.delete(text);
  if (cache.size > 400) cache.clear();
  cache.set(text, ngl);
  return ngl;
};

// Resolved NGL expression for a selection key (named selection or raw expr),
// with references to other named selections expanded inline (like PyMOL sets).
const selKeyExpr = (key) => {
  // A MEASURED leaflet wins over anything the script (or the user) wrote for
  // that name: it is the exact geometry, not a `z>90` guess.
  const geo = membraneSeleRef.current[key];
  if (geo) return geo;
  const named = selections.find((s) => s.name === key);
  return expandSelectionExpr(named ? named.expr : key);
};

// Number of atoms matching a selection key (null when unsupported by NGL).
const selectionAtomCount = (key) => {
  const component = componentRef.current;
  if (!component || !component.structure) return null;
  try {
    const sel = component.structure.getSelection(selKeyExpr(key));
    return sel.count != null ? sel.count : (sel.length != null ? sel.length : null);
  } catch {
    return null;
  }
};

/* ---- A GESTURE IN THE SELECTIONS BAR IS PyMOL'S LAST COMMAND ---------------
   PyMOL styles live on ATOMS, not on selections: `show sphere, resn POPC+…`
   followed by `show spheres, upper_headgroups` draws the SAME headgroup atoms
   twice, and `hide spheres, POPC` then takes them away for good. The viewer,
   on the other hand, drew one representation per ROW, so unchecking « sphere »
   on one row left the identical beads of every other row on screen — the user
   sees nothing happen (« la finestra di sinistra non ha il controllo sulla
   molecola: POPC reste en sphères »), while the row it was clicked on really
   had lost its own spheres.
   The fix keeps the row model (one row = one look) but gives the GESTURE the
   weight of a last command: it writes this row's own PyMOL expression into the
   `hideFor` of every OTHER row that draws the same STYLE — and the renderer
   already subtracts those atom by atom (`exclusionOf` → `and not (…)`). Showing
   the style again removes the entry, so the gesture is reversible, and the row
   that was clicked keeps its own `hideFor` (the script's later hides are not
   forgotten). */
const toggleSelStyle = (key, style) => {
  const all = selStylesRef.current || {};
  const cur = all[key] || {};
  const on = !cur[style];
  // The row's own expression, as written by the script: a named selection's
  // expression, or the raw key itself. Re-expanded by the bridge when rendered.
  const named = selections.find((s) => s.name === key);
  const raw = (named && named.expr) || key;
  if (!raw || raw === 'all') { setSelStyles({ ...all, [key]: { ...cur, [style]: on } }); return; }
  const next = { ...all, [key]: { ...cur, [style]: on } };
  Object.keys(next).forEach((other) => {
    if (other === key) return;
    const st = next[other] || {};
    const list = (st.hideFor && st.hideFor[style]) || [];
    // Hiding: only a row that DRAWS this style could put the atoms back on
    // screen, so only those are touched. Showing: every row is cleaned, whatever
    // it draws — that is what makes the gesture reversible.
    if (!on && !st[style] && !list.length) return;
    const kept = list.filter((h) => h !== raw);
    const updated = on ? kept : [...kept, raw];
    const hideFor = { ...(st.hideFor || {}) };
    if (updated.length) hideFor[style] = updated; else delete hideFor[style];
    const clean = { ...st };
    delete clean.hideFor;
    next[other] = Object.keys(hideFor).length ? { ...clean, hideFor } : clean;
  });
  setSelStyles(next);
};

// PDB anchor atoms used to build a SMALL, page-friendly key set when a residue
// tick is clicked. Keeping selectedAtomKeys small (≈ the size of a normal 3D
// atom click) avoids heavy re-renders in the spectra / per-atom tables; the WHOLE
// residue is still highlighted in 3D via a single-clause NGL representation.
const RESIDUE_ANCHOR_ATOMS = {
  protein: ['N', 'CA', 'C', 'O', 'CB'],
  dna: ['P', "O5'", "C5'", "C1'", "O3'"],
  rna: ['P', "O5'", "C5'", "C1'", "O3'"],
};

// Build the atom keys for one residue tick (single click, multi toggle or
// Shift+click range selection). Uses the atom names precomputed in
// collectResidueTicks — NO full-structure atom scan per click.
const computeResidueKeys = (tick) => {
  const ri = tick.resno - 1;
  const seq = Array.isArray(parsedSeqRef.current) ? parsedSeqRef.current : [];
  const anchors = RESIDUE_ANCHOR_ATOMS[moleculeTypeRef.current] || ['N', 'CA', 'C', 'O'];
  const keys = [];
  (tick.atomNames || []).forEach((an) => {
    const upper = String(an || '').trim().toUpperCase();
    if (!anchors.includes(upper)) return;
    if (seq.length && ri >= 0 && ri < seq.length) {
      const mapped = mapPdbAtomToNmrKeys(an, tick.resno, seq, moleculeTypeRef.current, namingConventionRef.current);
      if (mapped && Array.isArray(mapped.keys) && mapped.keys.length) {
        mapped.keys.forEach((k) => { if (!keys.includes(k)) keys.push(k); });
        return;
      }
    }
    if (!keys.includes(`${ri}-${upper}`)) keys.push(`${ri}-${upper}`);
  });
  if (keys.length === 0) {
    const anchor = moleculeTypeRef.current === 'dna' || moleculeTypeRef.current === 'rna' ? 'P' : 'CA';
    keys.push(`${ri}-${anchor}`);
  }
  return keys;
};

// Merge addKeys into an existing key selection. toggle=true flips each key
// (add if missing, remove if present) — used for Ctrl/Cmd and "⊞ multi" clicks.
const mergeKeys = (baseKeys, addKeys, toggle) => {
  const set = new Set(Array.isArray(baseKeys) ? baseKeys : []);
  (addKeys || []).forEach((k) => {
    if (toggle && set.has(k)) set.delete(k);
    else set.add(k);
  });
  return Array.from(set);
};

// Click a residue tick in the sequence strip:
//   - plain click  → select ONLY that residue (a second click on the same
//     residue clears it — handled by the page's handleAtomClick)
//   - Ctrl/Cmd/Shift click or the "⊞ multi" toggle → toggle that residue in/out
//     of the current multi-residue selection
//   - Shift click (after any strip click) → select the whole RANGE from the
//     last-clicked residue up to this one, added to the selection — handy for
//     highlighting a binding site / loop without clicking every residue.
const handleResidueTickClick = (tick, e = {}) => {
  const ri = tick.resno - 1;
  stripResidueRiRef.current = ri;
  if (!onAtomClickRef.current) return;

  const additive = multiSelectActive || e.ctrlKey || e.metaKey || e.shiftKey;

  // Shift+click range selection within the same chain: [anchor … clicked].
  if (e.shiftKey && anchorTickRef.current && anchorTickRef.current.chainid === tick.chainid) {
    const polyTicks = (Array.isArray(residueTicks) ? residueTicks : []).filter((r) => r.polymer);
    const ti = polyTicks.findIndex((t) => t.chainid === tick.chainid && t.resno === tick.resno);
    const ai = polyTicks.findIndex((t) => t.chainid === tick.chainid && t.resno === anchorTickRef.current.resno);
    if (ti >= 0 && ai >= 0) {
      const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
      const addKeys = [];
      for (let i = lo; i <= hi; i++) {
        computeResidueKeys(polyTicks[i]).forEach((k) => { if (!addKeys.includes(k)) addKeys.push(k); });
      }
      onAtomClickRef.current(ri, mergeKeys(selectedKeysRef.current, addKeys, false));
      anchorTickRef.current = tick;
      return;
    }
  }

  const keys = computeResidueKeys(tick);
  if (additive) onAtomClickRef.current(ri, mergeKeys(selectedKeysRef.current, keys, true));
  else onAtomClickRef.current(ri, keys);
  anchorTickRef.current = tick;
};

// "✕ clear" button in the sequence strip — drop the whole residue selection.
const clearResidueSelection = () => {
  stripResidueRiRef.current = null;
  anchorTickRef.current = null;
  if (onAtomClickRef.current) onAtomClickRef.current(0, []);
};

// Rebuild all selection representations from selStyles.
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready') return;
  // "Hide everything" / a running PyMOL script takes over the whole main view —
  // drop the ⚡ ESP overlay as well so the scene truly clears. Re-enabling
  // Hide-all / PyMOL restores the base representations only; the user then
  // re-clicks ⚡ ESP if the surface map is still wanted.
  if (hideAll || pymolActive) espDisable('main');
  Object.keys(selCompsRef.current).forEach((k) => {
    (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch {} });
  });
  selCompsRef.current = {};
  // Base representations: removed in "hide all" or PyMOL-script mode, and rebuilt
  // when ANY look of the styling sections changes (PART 4) or when restoring from
  // "hide all". The signature covers the persisted per-kind looks, the per-molecule
  // trees, the ✔ of the sections and the sections themselves.
  const catSig = styleSignature;
  const styleChanged = prevCatSigRef.current !== catSig;
  // A PyMOL script's scene is NOT above the styling menus: while it is active,
  // touching ANY §2 styling control hands the main structure back to §2 (the
  // script's own selections keep their styles). The FIRST signature seen after a
  // script run is the script's own (it may set §2 values) — a later one is the
  // user's. Before this, running a macro froze the six menus until « Clear »:
  // the report « after launching the macro the molecular styling has no effect
  // on the loaded molecule any more ».
  if (pymolActive) {
    if (pymolOwnSigRef.current == null) pymolOwnSigRef.current = catSig;
    else if (pymolOwnSigRef.current !== catSig) {
      pymolOwnSigRef.current = null;
      setPymolActive(false);
      setPymolLog((l) => `${l ? `${l}\n` : ''}• §2 styling changed → the Molecular Styling look takes the main structure back (the script's own selections keep their styles).`);
    }
  } else pymolOwnSigRef.current = null;
  if (hideAll || pymolActive) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    baseCompsRef.current = [];
  } else if (styleChanged || baseCompsRef.current.length === 0) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    baseCompsRef.current = [];
    buildMainReps();
  }
  prevCatSigRef.current = catSig;
  if (hideAll) return;
  const styles = selStylesRef.current || {};
  Object.keys(styles).forEach((key) => {
    const st = styles[key] || {};
    const expr = selKeyExpr(key);
    if (!expr || expr === '') return;
    // Hidden selections keep NO representations — "🙈 Hide" removes them.
    if (st.hidden) { selCompsRef.current[key] = []; return; }
    // Colouring metaphor: a NGL colorScheme (element/chain/resname/…) or a plain
    // solid colour when "Solid" is selected — through the ONE mapping the whole
    // viewer shares (schemeForColorMode), so the palettes of the ⚙ settings wheel
    // are honoured here too.
    const colorScheme = st.colorMode && st.colorMode !== 'solid'
      ? schemeForColorMode(st.colorMode)
      : undefined;
    const color = colorScheme ? undefined : (st.color != null ? st.color : undefined);
    const opacity = st.transparency != null ? Math.max(0, Math.min(1, 1 - st.transparency)) : undefined;
    const reps = [];
    // ── Ordered « show » / « hide » — PyMOL: the LAST command wins ────────────
    // A style the script showed keeps only the atoms that no LATER
    // « hide <style>, … » took away: « hide spheres, membrane and z>90 » really
    // removes the upper leaflet from « show sphere, resn POPC+… ». Before this,
    // the two commands were two independent keys and those spheres stayed on
    // screen for ever — the report « the spheres remain even when I remove them ».
    const exclusionOf = (style) => {
      const list = (st.hideFor && st.hideFor[style]) || [];
      const parts = list.map((h) => `(${expandSelectionExpr(h)})`).filter((p) => p && p !== '(all)');
      return parts.length ? parts.join(' or ') : '';
    };
    const addSele = (type, params, seleBase, style) => {
      const ex = style ? exclusionOf(style) : '';
      const sele = ex ? `(${seleBase}) and not (${ex})` : seleBase;
      try { reps.push(component.addRepresentation(type, { sele, color, colorScheme, ...params })); } catch {}
    };
    const add = (type, params, style) => addSele(type, params, expr, style);
    // ── PyMOL's `set … , <selection>`: an ATOM property, not a look ──────────
    // « set sphere_scale, 0.6, upper_headgroups » + « set sphere_transparency,
    // 0.8, upper_headgroups » must reach the beads of the upper headgroups that
    // the script drew with ANOTHER expression (« show spheres, upper_headgroups »
    // after « show sphere, resn POPC+… »). One NGL representation carries ONE
    // scale and ONE opacity, so the rep is SPLIT: one slice per override
    // selection (the last `set` per property wins, as in PyMOL) plus the rest of
    // the atoms with the look's own values. `beads` = the sphere rep, for which
    // `set sphere_scale` and `set sphere_transparency` also count.
    const overrideSlicesFor = (beads) => {
      const order = [];
      const bySel = new Map();
      (selOverridesRef.current || []).forEach((o) => {
        if (!o || !o.sel) return;
        const isSphere = o.kind === 'sphereScale' || o.kind === 'sphereOpacity';
        if (!beads && isSphere) return;
        const ngl = expandSelectionExpr(o.sel);
        if (!ngl || ngl === 'none' || ngl === 'all') return;
        if (!bySel.has(ngl)) { bySel.set(ngl, {}); order.push(ngl); }
        const slot = bySel.get(ngl);
        if (o.kind === 'sphereScale') slot.scale = o.value;
        else if (o.kind === 'sphereOpacity') slot.sphereOpacity = o.value;
        else slot.opacity = o.value;
      });
      return order.slice(0, 12).map((ngl) => ({ ngl, ...bySel.get(ngl) }));
    };
    const addWithOverrides = (type, style, baseParams, beads) => {
      const slices = overrideSlicesFor(beads);
      if (!slices.length) { add(type, baseParams, style); return; }
      const used = [];
      slices.forEach((s) => {
        const notUsed = used.length ? ` and not (${used.join(' or ')})` : '';
        const p = { ...baseParams };
        if (beads && s.scale != null) p.scale = s.scale;
        const op = beads ? (s.sphereOpacity != null ? s.sphereOpacity : s.opacity) : s.opacity;
        if (op != null) p.opacity = op;
        addSele(type, p, `(${expr}) and (${s.ngl})${notUsed}`, style);
        used.push(s.ngl);
      });
      const rest = used.join(' or ');
      addSele(type, baseParams, rest ? `(${expr}) and not (${rest})` : expr, style);
    };
    if (st.cartoon) addWithOverrides('cartoon', 'cartoon', { colorScheme, opacity }, false);
    if (st.ribbon) addWithOverrides('ribbon', 'ribbon', { colorScheme, opacity }, false);
    if (st.tube) addWithOverrides('tube', 'tube', { colorScheme, opacity }, false);
    if (st.sphere) addWithOverrides('spacefill', 'sphere', { scale: st.sphereScale || 1, colorScheme, opacity, multipleBond: true }, true);
    if (st.ball) addWithOverrides('ball+stick', 'ball', { colorScheme, opacity, multipleBond: true, aspectRatio: 1.3 }, false);
    // « Sticks » of a selection / molecule is licorice (NGL has no `stick` rep).
    if (st.stick) addWithOverrides('licorice', 'stick', { colorScheme, opacity, multipleBond: true, radiusSize: LICORICE_BOND_RADIUS }, false);
    if (st.surface) addWithOverrides('surface', 'surface', { colorScheme, opacity: opacity != null ? opacity : 0.5 }, false);
    // A PyMOL script that asked for « set cartoon_ring_mode, 1 » also gets the
    // FILLED RING PLATES of its own nucleic selections: in PyMOL mode the §2 menus
    // are off (the script owns the scene), so the stylized look has to be built
    // here too — with the very same plate builder (nucleicRingPlates) and the same
    // colours / transparency as the 🎨 panel of the nucleic menu. A selection with
    // no ring at all (a protein) simply adds nothing.
    if (pymolActive && catStylesRef.current.nucleic && catStylesRef.current.nucleic.bases === 'rings') {
      try {
        const m = catStylesRef.current.nucleic;
        const NG = typeof window !== 'undefined' ? window.NGL : null;
        const data = nucleicRingPlates(component.structure, expr, m);
        if (NG && data && data.rings) {
          const mesh = new NG.MeshBuffer({ position: data.position, normal: data.normal, color: data.color, index: data.index });
          const t = Number(m.ringTransparency);
          const op = 1 - (Number.isFinite(t) ? Math.min(RING_TRANSPARENCY_MAX, Math.max(0, t)) : 0);
          const rep = component.addBufferRepresentation(mesh, { opacity: op, side: 'double' });
          if (rep) { flagMeshShadows(rep); reps.push(rep); }
          // The outline of the plates, over EXACTLY the ring atoms and in the same
          // colour as the plates — the same rule as ringLineCol in the §2 renderer.
          if (data.atomIndices.length) {
            const lineCol = m.ringColour === 'custom' && Number.isFinite(m.ringColorHex)
              ? { color: m.ringColorHex }
              : (m.groupColour && nucleicSchemeKey ? { color: nucleicSchemeKey }
                : (baseIdentitySchemeKey ? { color: baseIdentitySchemeKey } : { colorScheme: 'resname' }));
            try {
              reps.push(component.addRepresentation('licorice', {
                sele: `@${data.atomIndices.join(',')}`,
                opacity,
                multipleBond: true,
                radiusSize: LICORICE_BOND_RADIUS * 0.6,
                ...lineCol,
              }));
            } catch { /* the outline is a bonus too */ }
          }
        }
      } catch { /* the plates are a bonus: never break the script rendering */ }
    }
    selCompsRef.current[key] = reps;
  });
  return () => {
    Object.keys(selCompsRef.current).forEach((k) => {
      (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    });
    selCompsRef.current = {};
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, selections, selStyles, pymolActive, hideAll, styleSignature, sstrucColors]);

// ── Material: applied AFTER the representations exist ────────────────────────
// roughness / metalness / opacity live in NGL's shader UNIFORMS, not in its
// parameters (see MATERIAL_PRESETS), so every rebuild loses them: this effect
// re-applies the four family settings to each representation of each component,
// as soon as anything is redrawn or a slider moves.
const applyMaterialsToScene = () => {
  const mat = matSettingsRef.current || {};
  const comps = [componentRef.current]
    .concat((extraCompsRef.current || []).map((e) => e && e.comp))
    .filter(Boolean);
  comps.forEach((comp) => {
    if (typeof comp.eachRepresentation !== 'function') return;
    try { comp.eachRepresentation((rep) => applyMaterialToRep(rep, mat)); } catch { /* ignore */ }
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch { /* ignore */ }
};
useEffect(() => {
  applyMaterialsToScene();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [matSettings, status, selStyles, pymolActive, hideAll, styleSignature]);

// The material of the four families survives a reload like every other look.
useEffect(() => {
  try { localStorage.setItem(MATERIALS_KEY, JSON.stringify(matSettings || {})); } catch { /* ignore */ }
}, [matSettings]);

const setMatPreset = (kind, preset) => setMatSettings((prev) => ({ ...prev, [kind]: { preset } }));
const setMatValue = (kind, prop, value) => setMatSettings((prev) => ({ ...prev, [kind]: { ...(prev[kind] || {}), [prop]: value } }));
// NGL's own material is the rough, non-metallic one: that is what « auto »
// shows on the sliders until the user moves them.
const matSliderValue = (kind, prop) => {
  const v = materialValueOf(matSettings, kind, prop);
  if (v != null) return v;
  return prop === 'metalness' ? 0 : 1;
};

// Re-apply the styling sections to EVERY extra molecule / chain when one of them
// changes — so a dropdown of the bar works for all loaded structures, not just the
// main one. Each extra keeps its OWN sections (its own look per row), and its
// per-molecule position is untouched.
useEffect(() => {
  if (status !== 'ready') return;
  extraCompsRef.current.forEach((entry) => {
    if (!entry || !entry.comp) return;
    // « 🙈 Hide everything » / a PyMOL script owns the whole scene: an EXTRA
    // molecule drops its representations too. The button promises « all molecules »,
    // and until this branch existed it only cleared the main structure, so every
    // structure added with « Add structure » / a chain stayed on screen. The ⚡ ESP
    // overlay of an extra is its own representation — dropped as well (the main
    // structure does the same through espDisable('main')). Turning Hide-all off
    // rebuilds the extras from their own sections, exactly as before.
    if (hideAll || pymolActive) {
      (entry.baseReps || []).forEach((r) => { try { entry.comp.removeRepresentation(r); } catch {} });
      entry.baseReps = [];
      espDisable(entry.id);
      return;
    }
    entry.baseReps = applyCurrentStyleTo(entry.comp, entry.baseReps || []);
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [styleSignature, status, applyCurrentStyleTo, sstrucColors, hideAll, pymolActive]);

// Background colour + quality ("ray shadows" approximation)
useEffect(() => {
  const stage = stageRef.current;
  if (!stage) return;
  try { stage.setParameters({ backgroundColor: bgColor }); } catch {}
  try { stage.setQuality(qualityHigh ? 'high' : 'medium'); } catch {}
  // setBackground re-colours the fog; re-apply the user's fog preference after
  // any background/quality change so a toggled-off fog stays off.
  applyFog();
}, [bgColor, qualityHigh, status, applyFog]);

// Persist the background colour of the scene (§3 Scene → 🎨 Background) so the
// chosen colour survives a reload / another page — the effect above pushes it to
// the live stage, this one remembers it.
useEffect(() => {
  try { localStorage.setItem('labViewerBg', bgColor); } catch { /* ignore */ }
}, [bgColor]);

// Persist the fog preference and apply it to the live stage whenever it changes.
useEffect(() => {
  try { localStorage.setItem('labViewerFog', fogEnabled ? 'on' : 'off'); } catch { /* ignore */ }
  applyFog();
}, [fogEnabled, applyFog]);

/* ---- ONE name for a PyMOL style token -----------------------------------------
   PyMOL accepts « sphere » / « spheres », « stick » / « sticks », « ball+stick » /
   « ball_and_stick », « line » / « lines » / « dots » … for the SAME style. The
   parser normalises it HERE, so one style is written one way, and the ordered
   « show / hide » rule can match the two spellings (see styleHidesAfter): a
   « hide sticks, … » really undoes the « show stick, … » it follows. Returns null
   for a token the viewer does not draw (`all`, `everything`, `labels` …).
   PURE — the guard test runs it on a real macro. */
const pymolStyleToken = (st) => {
  const s = String(st || '').toLowerCase();
  if (s === 'sphere' || s === 'spheres') return 'sphere';
  if (s === 'stick' || s === 'sticks') return 'stick';
  if (s === 'ball' || s === 'ball+stick' || s === 'ball_and_stick' || s === 'ballandstick') return 'ball';
  if (s === 'cartoon') return 'cartoon';
  if (s === 'ribbon') return 'ribbon';
  if (s === 'tube') return 'tube';
  if (s === 'surface') return 'surface';
  if (s === 'line' || s === 'lines' || s === 'dots') return 'line';
  return null;
};

const parsePyMOL = (text) => {
  const sels = [];
  const acts = [];
  const colorDefs = {};
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = (raw.split('#')[0] || '').trim();
    if (!line) return;
    // PyMOL puts the command AND its first argument before the first comma,
    // e.g. "select water, resn TIP3", "show sphere, resn POPC", "set sphere_scale, 1.0, sel".
    const commaIdx = line.indexOf(',');
    const head = (commaIdx >= 0 ? line.slice(0, commaIdx) : line).trim();
    const rest = commaIdx >= 0 ? line.slice(commaIdx + 1).split(',').map((p) => p.trim()) : [];
    const cmdMatch = head.match(/^([A-Za-z_.]+)\s*(.*)$/);
    const cmd = (cmdMatch ? cmdMatch[1] : head).toLowerCase();
    const arg1 = (cmdMatch ? cmdMatch[2] : '').trim();

    if (cmd === 'select') {
      // select <name>, <expr>   (the name is arg1)
      const name = arg1 || rest[0] || '';
      const expr = arg1 ? rest.join(',') : rest.slice(1).join(',');
      if (name && expr) sels.push({ name, expr });
    } else if (cmd === 'set_color') {
      const m = line.match(/set_color\s+(\S+)\s*,\s*\[([^\]]+)\]/i);
      if (m) {
        const rgb = m[2].split(/[\s,]+/).map(Number);
        if (rgb.length >= 3) colorDefs[m[1].trim()] = ((rgb[0] & 255) << 16) | ((rgb[1] & 255) << 8) | (rgb[2] & 255);
      }
    } else if (cmd === 'show' || cmd === 'hide') {
      // The style token is NORMALISED at parse time (pymolStyleToken): PyMOL's
      // « spheres » / « sticks » / « ball+stick » become ONE token, so the
      // ordered « show / hide » rule can match a « hide spheres, … » to the
      // « show sphere, … » it undoes. 'all' / 'everything' keep their name.
      const rawStyle = (arg1 || rest[0] || 'all').toLowerCase();
      const style = pymolStyleToken(rawStyle) || rawStyle;
      const sel = (arg1 ? rest[0] : rest[1]) || 'all';
      acts.push({ type: cmd, style, sel });
    } else if (cmd === 'color') {
      const color = arg1 || rest[0];
      const sel = (arg1 ? rest[0] : rest[1]) || 'all';
      acts.push({ type: 'color', color, sel });
    } else if (cmd === 'bg_color') {
      acts.push({ type: 'bg_color', color: arg1 || rest[0] });
    } else if (cmd === 'cartoon') {
      const mode = (arg1 || 'automatic').toLowerCase();
      const sel = (arg1 ? rest[0] : rest[1]) || 'all';
      acts.push({ type: 'cartoon', mode, sel });
    } else if (cmd === 'surface') {
      acts.push({ type: 'surface', sel: arg1 || rest[0] || 'all' });
    } else if (cmd === 'set') {
      const prop = (arg1 || '').toLowerCase();
      const val = rest[0];
      const sel = rest[1] || 'all';
      if (prop === 'sphere_scale') acts.push({ type: 'sphere_scale', val: parseFloat(val), sel });
      else if (prop === 'transparency') acts.push({ type: 'transparency', val: parseFloat(val), sel });
      else if (prop === 'sphere_transparency') acts.push({ type: 'sphere_transparency', val: parseFloat(val), sel });
      // ── The FOUR PyMOL settings of the stylized nucleic look ──────────────
      // « set cartoon_ring_mode, 1 » (filled base / sugar ring plates),
      // « set cartoon_nucleic_acid_mode, 0 » (the flat ribbon through the
      // backbone), « set cartoon_ring_color, red » and
      // « set cartoon_ring_transparency, 0.5 » — the recipe this viewer now
      // implements with its own filled MeshBuffer plates (nucleicRingPlates).
      else if (prop === 'cartoon_ring_mode') acts.push({ type: 'ring_mode', val: parseInt(val, 10) });
      else if (prop === 'cartoon_nucleic_acid_mode') acts.push({ type: 'nucleic_acid_mode', val: parseInt(val, 10) });
      else if (prop === 'cartoon_ring_color') acts.push({ type: 'ring_color', color: val });
      else if (prop === 'cartoon_ring_transparency') acts.push({ type: 'ring_transparency', val: parseFloat(val) });
    } else if (cmd === 'spectrum') {
      acts.push({ type: 'spectrum', sel: rest[2] || 'all' });
    } else if (cmd.startsWith('util.ray_shadows') || /util\.ray_shadows/.test(line)) {
      acts.push({ type: 'ray_shadows' });
    } else if (cmd === 'dist') {
      acts.push({ type: 'dist' }); // distance objects are reported, not drawn
    }
  });
  return { sels, acts, colorDefs };
};

/* ---- Ordered « show » / « hide » — the ONE rule of the PyMOL semantics --------
   PyMOL keeps ONE state per atom and per style: the LAST command wins. The viewer
   stores one look per selection, so a « show sphere, resn POPC+…+PSM » followed by
   « hide spheres, membrane and z>90 » left every sphere on screen (two independent
   keys). `styleHidesAfter` answers the only question the renderer asks: for the
   show at `index`, which LATER hides of that same style must be subtracted? PURE —
   _pymol_selections_test.mjs runs it on a real macro. */
const styleHidesAfter = (acts, index, style) => (Array.isArray(acts) ? acts : [])
  .slice(index + 1)
  .filter((a) => a && a.type === 'hide' && a.style === style)
  .map((a) => a.sel)
  .filter((s) => !!s);

// Does the script OWN the scene? « hide all » is the statement that says so: the
// script then draws everything it wants itself, and the viewer must NOT add its
// own auto-shown spheres on top (the report « everything is drawn with spheres »).
const scriptHidesAll = (acts) => (Array.isArray(acts) ? acts : [])
  .some((a) => a && a.type === 'hide' && (a.style === 'all' || a.style === 'everything'));

const applyPyMOLScript = (text) => {
  const log = [];
  try {
    const { sels, acts, colorDefs } = parsePyMOL(text);
    const names = new Set(sels.map((s) => s.name));
    const nextSels = [
      ...selections.filter((s) => !names.has(s.name)),
      ...sels,
    ];
    setSelections(nextSels);
    // The four MEASURED leaflet names win over the script's own definitions
    // (`membrane and z>90`): the geometry of this structure is exact, z is not.
    const overriddenLeaflets = sels.filter((s) => membraneSeleRef.current[String(s.name).toLowerCase()]);
    if (overriddenLeaflets.length) {
      log.push(`• ${overriddenLeaflets.map((s) => s.name).join(', ')}: the MEASURED leaflet of this structure is used (axis ${membraneInfo ? membraneInfo.axis : '?'}, midplane ${membraneInfo ? membraneInfo.midplane.toFixed(1) : '?'} Å) instead of the script's own definition.`);
    }
    // ONE normalisation of a PyMOL style token, shared with parsePyMOL
    // (pymolStyleToken): a « hide sticks » meets the « show stick » it undoes.
    const styleOf = pymolStyleToken;
    const next = { ...selStylesRef.current };
    // The `set` commands of THIS script (atom properties, see selOverrides).
    const ovs = [];
    // Reset every selection the script mentions to "hidden", then apply commands
    sels.forEach((s) => {
      const cur = next[s.name] || {};
      next[s.name] = { ...cur, cartoon: false, ribbon: false, tube: false, ball: false, stick: false, sphere: false, surface: false };
    });
    acts.forEach((a, ai) => {
      const key = names.has(a.sel) ? a.sel : (a.sel === 'all' ? 'all' : a.sel);
      const cur = next[key] || {};
      if (a.type === 'show' || a.type === 'hide') {
        const st = styleOf(a.style);
        if (st) {
          // A « show » remembers the LATER hides of its own style: the renderer
          // subtracts them atom by atom (see exclusionOf) — PyMOL's last-wins.
          const hideFor = a.type === 'show'
            ? { ...(cur.hideFor || {}), [st]: styleHidesAfter(acts, ai, st) }
            : (cur.hideFor || undefined);
          next[key] = { ...cur, [st]: a.type === 'show', ...(hideFor ? { hideFor } : {}) };
        }
        if (a.style === 'everything' || a.style === 'all') {
          next[key] = { ...(next[key] || cur), cartoon: a.type === 'show', ribbon: a.type === 'show', tube: a.type === 'show', ball: a.type === 'show', stick: a.type === 'show', sphere: a.type === 'show', surface: a.type === 'show' };
        }
      } else if (a.type === 'color') {
        const c = colorDefs[a.color] || parseColorInt(a.color);
        if (c != null) next[key] = { ...cur, color: c };
      } else if (a.type === 'sphere_scale') {
        // An ATOM property, not a look (see selOverrides): « set sphere_scale,
        // 0.6, upper_headgroups » must resize the beads the script drew there —
        // even when the `show` that drew them names another expression.
        const v = Number.isFinite(a.val) ? a.val : 1;
        ovs.push({ kind: 'sphereScale', value: Math.max(0, Math.min(5, v)), sel: a.sel });
        log.push(`• set sphere_scale, ${a.val}, ${a.sel} → those beads are drawn at ${v}`);
      } else if (a.type === 'transparency' || a.type === 'sphere_transparency') {
        const t = Math.max(0, Math.min(1, Number.isFinite(a.val) ? a.val : 0));
        ovs.push({ kind: a.type === 'sphere_transparency' ? 'sphereOpacity' : 'opacity', value: 1 - t, sel: a.sel });
        log.push(`• set ${a.type === 'sphere_transparency' ? 'sphere_transparency' : 'transparency'}, ${a.val}, ${a.sel} → opacity ${(1 - t).toFixed(2)}`);
      } else if (a.type === 'bg_color') {
        const c = colorDefs[a.color] || parseColorInt(a.color);
        if (c != null) setBgColor(`#${c.toString(16).padStart(6, '0')}`);
      } else if (a.type === 'ray_shadows') {
        setQualityHigh(true);
        log.push('• util.ray_shadows → rendering quality set to High');
      } else if (a.type === 'dist') {
        log.push('• dist (distance measurements) are not drawn in the viewer');
      } else if (a.type === 'cartoon') {
        next[key] = { ...cur, cartoon: true };
      } else if (a.type === 'surface') {
        next[key] = { ...cur, surface: true };
      } else if (a.type === 'spectrum') {
        next[key] = { ...cur, colorMode: 'residueindex' };
        log.push('• spectrum → per-residue rainbow colouring applied');
      } else if (a.type === 'ring_mode') {
        // PyMOL: 0 = no rings at all, 1 = FILLED ring plates (the stylized look,
        // and the only mode the viewer can really draw as plates), 2 / 3 = ball &
        // stick over the rings — which IS the « Licorice » bases style here. Any
        // other mode falls back on the filled plates.
        if (a.val === 0 || a.val === 2 || a.val === 3) {
          setCatStyle('nucleic', 'bases', 'sticks');
          log.push(`• set cartoon_ring_mode, ${a.val} → no filled plates (Bases: Licorice)`);
        } else {
          setCatStyle('nucleic', 'bases', 'rings');
          log.push(`• set cartoon_ring_mode, ${a.val} → filled ring plates (Bases: Stylized rings)`);
        }
      } else if (a.type === 'nucleic_acid_mode') {
        // NGL's nucleic cartoon has ONE ribbon geometry: mode 0 (the default and
        // the mode of the PyMOL recipe) is the flat ribbon through the backbone.
        // 1 asks for a thin tube and 2 for the phosphate trace, both of which the
        // viewer really has; anything else keeps the flat ribbon.
        const bb = a.val === 1 ? 'tube' : a.val === 2 ? 'trace' : 'cartoon';
        setCatStyle('nucleic', 'backbone', bb);
        log.push(`• set cartoon_nucleic_acid_mode, ${a.val} → nucleic backbone = ${bb}`);
      } else if (a.type === 'ring_color') {
        const c = colorDefs[a.color] ? colorDefs[a.color] : parseColorInt(a.color);
        if (c != null) {
          setCatStyle('nucleic', 'ringColour', 'custom');
          setCatStyle('nucleic', 'ringColorHex', c);
          log.push(`• set cartoon_ring_color, ${a.color} → every ring plate takes that colour`);
        } else {
          setCatStyle('nucleic', 'ringColour', 'base');
          log.push('• set cartoon_ring_color → one colour per base (A · C · G · T · U)');
        }
      } else if (a.type === 'ring_transparency') {
        const t = Math.max(0, Math.min(RING_TRANSPARENCY_MAX, Number.isFinite(parseFloat(a.val)) ? parseFloat(a.val) : 0));
        setCatStyle('nucleic', 'ringTransparency', t);
        log.push(`• set cartoon_ring_transparency, ${a.val} → ring plates at ${t.toFixed(2)}`);
      }
    });
    setSelStyles(next);
    // The atom-level `set`s of this script replace the previous script's ones.
    setSelOverrides(ovs);
    setPymolActive(true);
    setHideAll(false);
    // A fresh script opens a fresh « the script owns §2 » window (see the styling
    // effect): its own §2 writes are adopted, the user's next change hands back.
    pymolOwnSigRef.current = null;
    // Reproduce every selection the script defines: selections that received no
    // explicit style from the script are shown as a subtle semi-transparent
    // sphere so the user can see exactly which atoms each one captures.
    // The script's own « hide all » says it owns the scene: the auto-show of the
    // parsed selections is then SKIPPED, otherwise a macro with its 75 helper
    // selections (POPC · POPS · … headgroups · membrane) drowned the real look
    // under ~65 auto-sphere blobs — the report « everything is drawn with spheres ».
    const ownsScene = scriptHidesAll(acts);
    if (autoShowSel && sels.length) {
      if (ownsScene) {
        log.push('• « hide all » in the script → auto-show skipped (the script owns the scene).');
        setSelStyles({ ...next });
      } else {
        const PAL = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a3e635', '#f472b6', '#6366f1', '#84cc16', '#eab308', '#0ea5e9', '#f43f5e'];
        let ci = 0;
        const shown = {};
        Object.keys(next).forEach((k) => {
          const s = next[k] || {};
          if (s.cartoon || s.ribbon || s.tube || s.ball || s.stick || s.sphere || s.surface) shown[k] = true;
        });
        const patch = {};
        sels.forEach((s) => {
          if (shown[s.name]) return;
          patch[s.name] = { ...(next[s.name] || {}), sphere: true, transparency: 0.6, sphereScale: 0.6, color: parseInt(PAL[ci % PAL.length].slice(1), 16) };
          ci++;
        });
        Object.assign(next, patch);
        setSelStyles({ ...next });
        log.push(`• Auto-shown ${Object.keys(patch).length} selection(s) as subtle spheres (toggle in the list below).`);
      }
    } else {
      setSelStyles(next);
    }
    log.push(`✓ Parsed ${sels.length} selection(s) and ${acts.length} command(s).`);
  } catch (e) {
    log.push(`⚠️ ${e?.message || 'Failed to parse script.'}`);
  }
  setPymolLog(log.join('\n'));
};

const clearPyMOL = () => {
  setSelections([]);
  setSelStyles({});
  setSelOverrides([]);
  setPymolActive(false);
  setPymolLog('');
  setPymolScript('');
};

// Atom rename helpers
const applyRename = () => {
  if (renameTarget === null) return;
  const val = renameDraft.trim();
  const next = { ...renames };
  if (val) next[renameTarget] = val; else delete next[renameTarget];
  persistRenames(next);
  setRenameTarget(null);
  setRenameDraft('');
};
const autoNameFrom2D = () => {
  const component = componentRef.current;
  if (!component || !component.structure) return;
  const next = {};
  try {
    component.structure.eachAtom((a) => {
      next[a.index] = getOrganicAtomName(a);
    });
  } catch {}
  persistRenames(next);
};
const clearRenames = () => persistRenames({});

// ---- Build the 2D↔3D atom-name map (organic molecules from SMILES) ---------
// Runs when a structure is ready and `smiles` is known; the resulting map is
// consumed by displayAtomName → the 3D labels render synchronised names. The
// 2D formula generation pipeline is never touched.
useEffect(() => {
const organicLike = ['organic', 'lipid', 'sugar'].includes(moleculeType);
const component = componentRef.current;
if (!organicLike || !String(smiles || '').trim() || status !== 'ready' || !component) {
  setSmilesNameMap(null);
  return;
}
let cancelled = false;
computeSmiles3DNameMap(component, smiles)
  .then(({ map }) => {
    if (cancelled) return;
    const next = map && Object.keys(map).length ? map : null;
    setSmilesNameMap((prev) => {
      const a = prev ? JSON.stringify(prev) : '';
      const b = next ? JSON.stringify(next) : '';
      return a === b ? prev : next;
    });
  })
  .catch(() => { if (!cancelled) setSmilesNameMap(null); });
return () => { cancelled = true; };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [moleculeType, smiles, status]);

// 3D atom / residue labels — PER MOLECULE SECTION (PART 4).
// Every section of the bar owns three switches (Residues · Residue type · Atom
// names), and the atoms they may label are EXACTLY the atoms of that molecule — the
// same NGL selector its rows are drawn with, so « Residues » ticked on chain A of a
// complex labels chain A and nothing else. The text itself is computed per atom in
// build3dLabelMap (context-aware: protein / nucleic / ligand / water / ion rules) and
// rendered by ONE NGL "label" representation that selects EXACTLY the labelled atoms
// (via an atom-index selection @a,b,c), so no empty labels are ever created. Styling
// keeps the glyphs billboarded (NGL text sprites always face the camera), pulled
// slightly toward the camera (zOffset) with depth testing disabled so they never clip
// inside atom spheres or bonds. Glyphs are BLACK with a subtle WHITE stroke halo and
// NO background plate — readable against bright, complex structures.
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;
const clearLabels = () => {
if (labelCompRef.current) {
try { component.removeRepresentation(labelCompRef.current); } catch {}
labelCompRef.current = null;
}
};
clearLabels();
const sections = (sectionCatalogRef.current.main && sectionCatalogRef.current.main.sections) || [];
const asked = sections.filter((sec) => {
  const l = sectionLabelsRef.current[sec.id];
  return !!l && (l.residues || l.atoms);
});
if (!asked.length) return clearLabels;
try {
const labelText = {};
const indexSet = new Set();
asked.forEach((sec) => {
  const l = { ...SECTION_LABEL_DEFAULTS, ...(sectionLabelsRef.current[sec.id] || null) };
  const indices = atomIndicesForSele(component.structure, sec.sele);
  if (!indices.length) return;
  const sub = build3dLabelMap(component, {
    showResidueNumber: !!l.residues,
    showAtomLabel: !!l.atoms,
    showResidueNumberType: !!l.residueType,
    atomNameOf: (atom) => displayNameRef.current(atom),
    allowed: new Set(indices),
    // The 🔢 renumbering reaches the LABELS too: the numbers drawn on the structure
    // are the renumbered ones (and `renumberMap` is in this effect's dependencies, so
    // a renumbering repaints them).
    renumberOf: displayResno,
  });
  sub.indices.forEach((idx) => {
    labelText[idx] = sub.labelText[idx];
    indexSet.add(idx);
  });
});
const indices = Array.from(indexSet).sort((a, b) => a - b);
if (indices.length) {
labelCompRef.current = component.addRepresentation('label', {
sele: `@${indices.join(',')}`,       // only the labelled atoms
labelType: 'text',                     // per-atom strings keyed by atom index
labelText,
labelGrouping: 'atom',
color: 0x000000,                       // black glyphs
fontFamily: 'sans-serif',
fontStyle: 'normal',
fontWeight: 'bold',
// Larger, uniform text size (was radius 1.0) with a constant on-screen
// size so labels stay readable at any zoom level.
radiusType: 'size', radius: 1.6, scale: 1.0,
fixedSize: true,
// Billboard sprites always face the camera; depth testing off plus a
// slight forward push keep them clear of the VdW spheres and bonds.
depthTest: false,
zOffset: 0.5,
xOffset: 0.35, yOffset: 0.55,          // shift off the exact atom centre
attachment: 'bottom-left',
// Legibility WITHOUT a background plate: a subtle white stroke halo keeps
// the black text readable on any structure colour behind it.
showBackground: false,
showBorder: true, borderColor: 0xffffff, borderWidth: 0.22,
opacity: 1,
visible: true,
});
}
} catch { /* label rendering is best-effort — never break the viewer */ }
return clearLabels;
}, [JSON.stringify(sectionLabels), status, renames, smilesNameMap, moleculeType, JSON.stringify(renumberMap)]);

// The side chains are a ROW of a protein section now (« Side chains » of PART 4):
// their style, colour, radii and transparency all come from that row, so the old
// separate side-chain effect (and its `sidechainStyle` selector) is gone — there is
// ONE place a protein's look is decided, and it is the molecule's own section.

// Highlight the SELECTED atoms / residues (amber). Runs on every selection
// change (residue-strip clicks, atom clicks in the 3D view). Kept SEPARATE from
// the green "assigned atoms" highlight below so that clicking a residue NEVER
// rebuilds that (potentially huge) representation.
//
// Speed notes:
//  - Strip clicks use whole-residue clauses; resno alone can match SEVERAL
//    residues when the file mixes molecule types (protein + phospholipid +
//    water), so the residue NAME is pinned too.
//  - Large highlights fall back to `spacefill` (GPU-instanced, no bond map):
//    NGL's ball+stick needs the full-structure bond list, and computing it on a
//    big MD system blocks the page for seconds.
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;

if (highlightCompRef.current) {
try { component.removeRepresentation(highlightCompRef.current); } catch {}
highlightCompRef.current = null;
}
if (stripHighlightCompRef.current) {
try { component.removeRepresentation(stripHighlightCompRef.current); } catch {}
stripHighlightCompRef.current = null;
}

const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
if (sel.length === 0) return;

try {
const stripRi = stripResidueRiRef.current;
const isStripMode = stripRi !== null && Array.isArray(residueTicks) && sel.every((k) => {
  const riK = parseInt(String(k).split('-')[0], 10);
  return Number.isFinite(riK) && !!residueTicks[riK];
});

if (isStripMode) {
  const resSet = new Map(); // `${chainid}|${resno}|${resname}` → whole-residue NGL clause
  let approxAtoms = 0;
  sel.forEach((k) => {
    const riK = parseInt(String(k).split('-')[0], 10);
    if (!Number.isFinite(riK)) return;
    const t = residueTicks[riK];
    if (!t) return;
    approxAtoms += (t.atomNames || []).length;
    const chainClause = t.chainid ? `:${t.chainid}` : '';
    // resno alone can match SEVERAL residues when the file mixes molecule types
    // (e.g. a membrane MD system: protein + phospholipid + water). A phospholipid
    // with the same residue number would be highlighted too. Pin the residue
    // NAME as well so only the clicked residue is highlighted.
    resSet.set(`${t.chainid}|${t.resno}|${t.resname}`, `${chainClause} and ${t.resno} and resn ${t.resname}`);
  });
  const selParts = Array.from(resSet.values());
  if (selParts.length > 0) {
    // Lightweight mode → instanced spheres: ball+stick would force NGL to
    // compute the full-structure bond list (seconds of freeze on a big system).
    const useSphere = lightRenderRef.current || approxAtoms > 1500;
    stripHighlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {
      sele: selParts.join(' or '),
      color: selectedResidueColorRef.current, aspectRatio: 1.5, radius: useSphere ? (approxAtoms > 1500 ? 0.3 : 0.4) : 0.4,
    });
  }
} else {
  const selSele = buildNglSele(sel, component.structure, moleculeTypeRef.current, namingConventionRef.current);
  if (selSele) {
    // Same bond-map reasoning as above: spheres when in lightweight mode.
    const useSphere = lightRenderRef.current;
    highlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {
      sele: selSele, color: selectedResidueColorRef.current, aspectRatio: 1.5, radius: useSphere ? 0.5 : 0.4,
    });
  }
}
} catch { /* selection highlight is best-effort */ }
}, [selectedKeys, status, residueTicks, selectedResidueColor]);

// Highlight the MANUALLY-ASSIGNED atoms (green "🟢 Assigned atoms"). Lives in its
// own effect so a selection click does not rebuild this representation — on a
// fully analysed MD/NMR page it can contain thousands of atoms. A signature
// guard also skips rebuilds when the parent passes a fresh (but identical)
// manualKeys array on unrelated re-renders, and tracks the component identity so
// a newly loaded structure always gets its green highlight rebuilt.
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;

const sig = showManualHighlight
  ? `${Array.isArray(manualKeys) ? manualKeys.length : 0}|${Array.isArray(manualKeys) ? manualKeys.join(',') : ''}`
  : '';
if (sig === manualSigRef.current && manualHighlightCompRef.current && manualSigCompRef.current === component) return;
manualSigRef.current = sig;
manualSigCompRef.current = component;

if (manualHighlightCompRef.current) {
try { component.removeRepresentation(manualHighlightCompRef.current); } catch {}
manualHighlightCompRef.current = null;
}

const man = Array.isArray(manualKeys) ? manualKeys : [];
if (man.length === 0 || !showManualHighlight) return;
try {
const manSele = buildNglSele(man, component.structure, moleculeTypeRef.current, namingConventionRef.current);
if (manSele) {
  // Large assigned sets (or lightweight mode) → instanced spheres, no bond map.
  const useSphere = lightRenderRef.current || man.length > 1500;
  manualHighlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {
    sele: manSele, color: assignedAtomColorRef.current, aspectRatio: 1.5, radius: useSphere ? (man.length > 1500 ? 0.3 : 0.4) : 0.4,
  });
}
} catch { /* manual highlight is best-effort */ }
}, [manualKeys, showManualHighlight, status, assignedAtomColor]);

// Load an additional structure file as its own NGL component (hidden by default —
// the "Molecules" selector reveals one at a time).
const loadExtraMolecule = useCallback(async (file, n) => {
try {
  const stage = stageRef.current;
  if (!stage) return;
  const comp = await stage.loadFile(file);
  try { ensureGlycanBonds(comp); } catch { /* best-effort (PART 2.2bis) */ }
  // Style it with the §2 « Molecular Styling » menus (the same renderer as the
  // main structure) so extra molecules follow the user's choices and never look
  // like a gray blob.
  const baseReps = applyCurrentStyleTo(comp, []);
  shadowRepsHook(comp);
  if (shadowOnRef.current) setMeshShadows(comp);
  const name = file.name || `Molecule ${n}`;
  const id = `mol_${Date.now()}_${n}`;
  extraCompsRef.current.push({ id, name, comp, baseReps, style: 'auto', color: '', colorMode: 'element', transparency: 0, position: [0, 0, 0] });
  setExtraMols(extraMolsSnapshot());
  try { comp.setVisibility(false); } catch {}
  // NOTE: no comp.autoView() here — the extra is HIDDEN and autoView would move
  // the camera away from the main structure. The camera is re-centred on the
  // main one after a flush; the Molecules bar (right side) toggles visibility.
} catch (err) {
  console.warn('Could not load additional molecule:', err && err.message);
}
}, [applyCurrentStyleTo]);

// Snapshot of the Molecules-bar entries (used by every setExtraMols call).
const extraMolsSnapshot = () => extraCompsRef.current.map(({ id, name, style, color, colorMode, transparency, position }) => ({ id, name, style, color, colorMode, transparency, position }));

// Per-extra-structure style/color overrides. Each entry in the Molecules bar can
// be rendered independently: "auto" follows the §2 « Molecular Styling » menus;
// anything else rebuilds that component with ONE chosen style, colour
// metaphor (atom type / chain / residue / 2° structure / hydrophobicity / solid),
// solid colour and transparency.
const restyleExtraMol = (id) => {
  const entry = extraCompsRef.current.find((e) => e.id === id);
  const comp = entry && entry.comp;
  if (!comp || !comp.structure) return;
  try { comp.removeAllRepresentations(); } catch {}
  // The component's ESP-coloured category surfaces die with its
  // representations — drop the registry entry so the ⚡ Range control never
  // touches a removed representation.
  catEspRepsRef.current.delete(comp);
  let reps = [];
  const st = entry || {};
  const style = st.style;
  if (!style || style === 'auto') {
    // "auto" = the §2 « Molecular Styling » look (buildCategoryReps), exactly
    // like the main structure: ONE builder draws every molecule.
    reps = applyCurrentStyleTo(comp, []);
  } else {
    // Colouring metaphor — a NGL colorScheme, or a plain solid colour when
    // "Solid" is selected (mirrors the Selections panel), resolved by the SAME
    // mapping as the main structure and the selections.
    const colorScheme = st.colorMode && st.colorMode !== 'solid'
      ? schemeForColorMode(st.colorMode)
      : undefined;
    const color = colorScheme ? undefined : (st.color != null ? st.color : undefined);
    const opacity = st.transparency != null ? Math.max(0, Math.min(1, 1 - st.transparency)) : undefined;
    const opts = { colorScheme, color, opacity };
    try {
      if (style === 'cartoon') reps.push(comp.addRepresentation('cartoon', { colorScheme, color, opacity }));
      else if (style === 'ribbon') reps.push(comp.addRepresentation('ribbon', { colorScheme, color, opacity }));
      else if (style === 'ball+stick') reps.push(comp.addRepresentation('ball+stick', { ...opts, multipleBond: true, aspectRatio: 1.3 }));
      else if (style === 'sticks') reps.push(comp.addRepresentation('licorice', { ...opts, multipleBond: true, radiusSize: LICORICE_BOND_RADIUS }));
      else if (style === 'lines') reps.push(comp.addRepresentation('line', { ...opts }));
      else if (style === 'spheres') reps.push(comp.addRepresentation('spacefill', { ...opts, scale: 0.6 }));
      else if (style === 'surface') reps.push(comp.addRepresentation('surface', { ...opts }));
    } catch { /* style best-effort */ }
  }
  entry.baseReps = reps;
  // restyleExtraMol removes EVERY representation of the component (see above);
  // an enabled ⚡ ESP overlay is a separate representation, so re-create it here
  // after the chosen style has been (re)built.
  if (espRepsRef.current[id]) {
    const espRep = espAddSurfaceRep(comp);
    if (espRep) espRepsRef.current[id] = espRep;
    else espForget(id);
  }
  if (shadowOnRef.current) setMeshShadows(comp);
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

const setExtraMolStyle = (id, style) => {
  leaveLightMode();   // the Molecules bar redraws
  extraCompsRef.current.forEach((e) => { if (e.id === id) e.style = style; });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

const setExtraMolColor = (id, color) => {
  leaveLightMode();   // the Molecules bar redraws
  extraCompsRef.current.forEach((e) => { if (e.id === id) { e.color = color; e.colorMode = 'solid'; } });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

const setExtraMolColorMode = (id, mode) => {
  leaveLightMode();   // the Molecules bar redraws
  extraCompsRef.current.forEach((e) => { if (e.id === id) e.colorMode = mode; });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

const setExtraMolTransparency = (id, t) => {
  leaveLightMode();   // the Molecules bar redraws
  extraCompsRef.current.forEach((e) => { if (e.id === id) e.transparency = t; });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

// Move ONE structure independently: translate its NGL component along an axis
// (position is stored in Ångström, in the structure's own coordinate system).
const setExtraMolPosition = (id, axis, value) => {
  const entry = extraCompsRef.current.find((e) => e.id === id);
  if (!entry) return;
  const pos = (entry.position || [0, 0, 0]).slice();
  pos[axis] = Number(value) || 0;
  entry.position = pos;
  setExtraMols(extraMolsSnapshot());
  try {
    const comp = entry.comp;
    if (comp && typeof comp.setPosition === 'function') {
      comp.setPosition(pos);
      if (typeof comp.updateMatrix === 'function') comp.updateMatrix();
      if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender();
    }
  } catch { /* position best-effort */ }
};

const resetExtraMolPosition = (id) => {
  const entry = extraCompsRef.current.find((e) => e.id === id);
  if (!entry) return;
  entry.position = [0, 0, 0];
  setExtraMols(extraMolsSnapshot());
  try {
    const comp = entry.comp;
    if (comp && typeof comp.setPosition === 'function') {
      comp.setPosition([0, 0, 0]);
      if (typeof comp.updateMatrix === 'function') comp.updateMatrix();
      if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender();
    }
  } catch { /* best-effort */ }
};

/* ── The four FOLDED control groups of ONE molecule in the Molecules bar ──────
   Style · Colour · Transp · Move — ONE implementation, called for the main
   structure and for every loaded molecule, so the main and the extras can never
   drift apart (the bar used to repeat the same four rows twice). Each group is a
   disclosure holding ONE line, so a molecule costs one row instead of four and
   twenty structures still fit in the bar; only the open group renders its
   controls (one at a time per molecule), exactly like the six menus of §2, and
   its button carries the CURRENT value (Style « auto », Colour « element »,
   « Transp 30% ») so a folded molecule is never silent.
   `moveFields` is what really differs between a molecule of its own file and the
   main structure: the same X / Y / Z numbers, but on that molecule's component. */
/* ── ONE ROW OF ONE MOLECULE SECTION (PART 4) ────────────────────────────────
   The three commands of the request, for the row they belong to: a STYLE, a
   « Color by » and a TRANSPARENCY regulator — plus the sphere / bond radii of that
   row and the ↺ that puts the row back to its defaults. ONE implementation for every
   kind: the styles and the colourings come from SECTION_SUBSECTIONS, so a row can
   never offer a control in one molecule and not in another. */
const renderSectionRow = (sec, sub) => {
  const kind = sec.kind;
  const spec = subsectionSpec(kind, sub);
  const tree = sectionTreeOf(sec.id, kind);
  const look = effectiveSectionLook(tree, kind, sub);
  const follows = rowFollowsGeneral(tree, kind, sub);
  const set = (field, value) => setSectionField(sec.id, kind, sub, field, value);
  const isSurface = look.style === 'surface' || look.style === 'mesh';
  const isPlates = look.style === 'rings' || look.style === 'plates';
  return (
    <div key={`${sec.id}|${sub}`} className="rounded border border-slate-200 bg-white/85 px-1 py-0.5 flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-bold text-slate-700 w-[74px] shrink-0 truncate"
          title={`${sec.name} · ${spec.label} — ${MOL_KIND_LABELS[kind]}`}>{spec.label}</span>
        <select value={look.style} onChange={(e) => set('style', e.target.value)}
          className="border border-slate-300 rounded text-[10px] py-0.5 px-0.5 flex-1 min-w-0 bg-white"
          title={`Style of « ${spec.label} » — every style this row can draw`}>
          {spec.styles.map((s) => <option key={s} value={s}>{styleLabelFor(kind, s)}</option>)}
        </select>
        <select value={look.colorBy} onChange={(e) => set('colorBy', e.target.value)}
          className="border border-slate-300 rounded text-[10px] py-0.5 px-0.5 flex-1 min-w-0 bg-white"
          title={`« Color by » of « ${spec.label} » — « Electrostatic potential » paints a surface and nothing else`}>
          {spec.colors.map((c) => <option key={c} value={c}>{COLOR_LABELS[c]}</option>)}
        </select>
        {look.colorBy === 'solid' && (
          <input type="color" value={numToHex(look.solidColor)}
            onChange={(e) => set('solidColor', parseInt(e.target.value.slice(1), 16))}
            className="w-5 h-5 rounded border cursor-pointer shrink-0" title="The ONE colour of « Solid »" />
        )}
        {/* The two ends of the RAMP, right where « Gradient (first → last) » was
            chosen: the pair is ONE NGL scheme shared by the whole viewer, so the
            swatches write the global pair (the same ⚙ ones) and the row repaints —
            before this, no control of the bar could change them at all (the report:
            « it is impossible to change the colors of first and last »). */}
        {look.colorBy === 'gradient' && (
          <>
            <input type="color" value={numToHex(gradientPair.from)}
              onChange={(e) => setGradientPair('gradientFrom', parseInt(e.target.value.slice(1), 16))}
              className="w-5 h-5 rounded border cursor-pointer shrink-0"
              title="Colour of the FIRST residue of every chain (N terminus · 5' end)" />
            <span className="text-[9px] font-bold text-slate-400 shrink-0">→</span>
            <input type="color" value={numToHex(gradientPair.to)}
              onChange={(e) => setGradientPair('gradientTo', parseInt(e.target.value.slice(1), 16))}
              className="w-5 h-5 rounded border cursor-pointer shrink-0"
              title="Colour of the LAST residue of every chain (C terminus · 3' end)" />
            <button type="button" onClick={swapGeneralGradient}
              className="text-[10px] font-bold text-slate-500 hover:text-slate-800 shrink-0"
              title="⇄ Reverse the ramp (swap the two colours) — the ramp is always drawn from the first residue to the last">⇄</button>
          </>
        )}
        {/* The 2°-structure palette RIGHT WHERE « Secondary structure » was chosen:
            helix · sheet · loop. Like the ramp, the lab-sstruc scheme reads ONE live
            store for the whole viewer, so these swatches write the very colours the
            ⚙ wheel edits — until now the row showed no control at all for this
            colouring, and the legacy menu sent the user to a 🎨 panel that no longer
            exists (the report: « colors for secondary structure definition are not
            present in the setting wheel »). */}
        {look.colorBy === 'sstruc' && (
          <>
            {SSTRUC_COLOR_ITEMS.map((it) => (
              <input key={it.key} type="color" value={numToHex(sstrucColors[it.key])}
                onChange={(e) => setSstrucColour(it.key, parseInt(e.target.value.slice(1), 16))}
                className="w-5 h-5 rounded border border-slate-300 cursor-pointer shrink-0"
                title={`Colour of the ${it.what} — the 2°-structure palette (helix · sheet · loop) every molecule coloured by « Secondary structure » reads, as the ⚙ wheel does`} />
            ))}
            <button type="button" onClick={() => setSettingsPanelOpen(true)}
              className="px-1 py-0.5 text-[10px] font-bold rounded border bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100 shrink-0"
              title="Open the ⚙ settings wheel — « Secondary structure » has a section of its own there (helix · sheet · loop)">
              ⚙</button>
          </>
        )}
        {/* « Color by : Chain » — the palette of the ⚙ wheel (lab-chain: the eight
            chain letters A → H plus the grey « other »). The ROW points at it (eight
            swatches do not fit in one row), and the wheel section is where a chain
            colour is really defined — the report: « it is possible to color by chain
            but there is no way to define the color of the chain in the setting wheel ». */}
        {look.colorBy === 'chain' && (
          <button type="button" onClick={() => setSettingsPanelOpen(true)}
            className="px-1 py-0.5 text-[10px] font-bold rounded border bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100 shrink-0"
            title="Open the ⚙ settings wheel — the colour of every CHAIN (A · B · C …) has a section of its own there">
            ⚙</button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-slate-400 font-bold shrink-0"
          title="Transparency regulator of THIS row: 0 % = opaque, 100 % = invisible (NGL opacity)">Transp</span>
        <input type="range" min="0" max="1" step="0.05" value={look.opacity}
          onChange={(e) => set('opacity', Number(e.target.value))}
          className="accent-blue-600 w-16" aria-label={`${spec.label} transparency`} />
        <span className="text-[9px] text-slate-500 w-7">{Math.round(look.opacity * 100)}%</span>
        <span className="text-[9px] text-slate-400 font-bold shrink-0" title="Sphere radius — a multiplier of the style's own atom size (1.00 = untouched)">R◯</span>
        <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={RADIUS_STEP} value={look.sphere}
          onChange={(e) => set('sphere', Number(e.target.value))}
          className="accent-slate-600 w-12" aria-label={`${spec.label} sphere radius`} />
        <span className="text-[9px] text-slate-400 font-bold shrink-0" title="Bond radius — a multiplier of the style's own stick thickness (1.00 = untouched)">R—</span>
        <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={RADIUS_STEP} value={look.bond}
          onChange={(e) => set('bond', Number(e.target.value))}
          className="accent-slate-600 w-12" aria-label={`${spec.label} bond radius`} />
        {follows && (
          <span className="text-[9px] text-blue-600 font-black shrink-0"
            title="This row FOLLOWS the General row of this molecule: General hands its style, its colour, its transparency and its radii down. Touching any control here deviates this row alone.">← G</span>
        )}
        <button type="button" onClick={() => resetSectionRowLook(sec.id, kind, sub)}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-800 shrink-0 ml-auto"
          title="↺ Put THIS row back to the defaults of its kind">↺</button>
      </div>
      {isSurface && (
        <span className="text-[9px] text-slate-400 italic">a surface: the transparency above IS its opacity (100 % = wireframe-visible mesh)</span>
      )}
      {isPlates && (
        <span className="text-[9px] text-slate-400 italic">filled ring plates (a MeshBuffer the viewer builds) — the outline sticks carry the colouring above</span>
      )}
      {look.colorBy === 'esp' && (
        <span className="text-[9px] text-slate-400 italic">NGL paints this colouring on a surface only — one is added on top of this row</span>
      )}
      {/* A HIDDEN PART SAYS SO. Choosing a style or a colouring on the General row
          switches every other row of this molecule to « Hide » (see
          setGeneralSectionField), and a row the user hid with its own selector
          looks the same: either way the row is empty, and either way the style
          selector above it is the way back. */}
      {look.style === 'hide' && sub !== 'general' && (
        <span className="text-[9px] text-slate-400 italic">hidden — choose a style here to bring this part back</span>
      )}
    </div>
  );
};

/* ── The 🔢 RENUMBERING TOOL — ONE implementation, opened by the 🔢 of a molecule's
   header AND by the 🔢 of §2, so the two buttons show the same specification. It
   used to exist in §2 alone: the bar's 🔢 toggled a panel that only §2 could draw,
   and that panel rendered NOTHING AT ALL whenever `residueInfo` was still empty —
   « the renumber key does not do anything nor show specifications ». The list is now
   taken from the state, or walked ON DEMAND from the structure (ensureResidueInfo),
   and every row shows the number it will take, so the renumbering is readable. */
const renderRenumberPanel = () => {
  if (!showRenumberPanel) return null;
  const list = residueInfo.length ? residueInfo : ensureResidueInfo();
  if (!list.length) {
    return (
      <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-2 text-[10px] text-slate-500 italic w-full">
        no residue to renumber — load a structure first
      </div>
    );
  }
  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto w-full">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] font-bold text-slate-400 uppercase">Residue → new number</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={renumberFrom}
            onChange={(e) => setRenumberFrom(e.target.value)}
            className="border border-slate-300 rounded px-1 py-0.5 w-12 text-right outline-none focus:border-blue-500 text-[10px] font-mono"
            title="Starting number"
          />
          <button
            type="button"
            onClick={applyRenumberFrom}
            className="text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded whitespace-nowrap"
            title="Renumber all residues consecutively starting from this number (no manual per-residue edits needed)"
          >
            Renumber from
          </button>
          <button
            type="button"
            onClick={() => commitRenumber({})}
            className="text-[9px] font-bold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded"
            title="Clear renumbering (restore original numbers)"
          >
            Clear
          </button>
        </div>
      </div>
      {list.map((r, i) => (
        <div key={r.resno} className="flex items-center gap-1.5 text-[10px] font-mono text-slate-600">
          <span className="w-3 text-slate-400">{i + 1}.</span>
          <span className="flex-1 truncate">{r.resname}{r.resno} → {displayResno(r.resno)}</span>
          <input
            type="number"
            value={renumberMap[String(r.resno)] !== undefined && renumberMap[String(r.resno)] !== '' ? renumberMap[String(r.resno)] : r.resno}
            onChange={(e) => {
              const nv = parseInt(e.target.value, 10);
              commitRenumber({ ...renumberMap, [String(r.resno)]: Number.isFinite(nv) ? nv : '' });
            }}
            className="border border-slate-300 rounded px-1 py-0.5 w-16 text-right outline-none focus:border-blue-500"
            title="New residue number (blank = keep the original)"
          />
        </div>
      ))}
      <span className="text-[9px] text-slate-400 italic">
        These numbers are the ones the 3D labels and the residue strip draw; « Renumber from »
        numbers every residue above consecutively, « Clear » puts the original numbers back.
      </span>
    </div>
  );
};

/* ── ONE MOLECULE OF THE BAR (PART 4) ────────────────────────────────────────
   The request's layout, literally: ONE SPACE PER LOADED MOLECULE — its name, the
   KIND it was classified as (protein · nucleic acid · lipid · ligand · sugar ·
   water · ion), the ✔ that draws it and how many molecules share the space (×N for
   a lipid / a ligand / an ion, which are grouped by residue name) — and, inside,
   EXACTLY the rows that kind owns: the two proteins of a file are two spaces, each
   with its own General / Backbone / Side chains. The 3D labels, the ↺ and the
   renumbering tool of the molecule live at the bottom of the space, and a Move row
   shifts the whole molecule (X · Y · Z or the mouse). */
const renderSection = (sec) => {
  const kind = sec.kind;
  const labels = { ...SECTION_LABEL_DEFAULTS, ...(sectionLabels[sec.id] || null) };
  const shown = sectionVisible(sec.id, kind);
  return (
    <div key={sec.id} className={`rounded border px-1 py-0.5 flex flex-col gap-0.5 ${selectedMolKey === sec.id ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200'}`}>
      <div className="flex items-center gap-1">
        <input type="checkbox" checked={shown} onChange={() => toggleSectionVisible(sec.id, kind)}
          className="accent-blue-600 w-3.5 h-3.5 shrink-0"
          title={`Draw « ${sec.name} » (${MOL_KIND_LABELS[kind]}) — unticked hides the whole molecule, exactly like the old « Hide » style`} />
        <span className="text-[10px] font-black text-slate-700 truncate flex-1"
          title={`${sec.name} — ${MOL_KIND_LABELS[kind]}${sec.detail ? ` · ${sec.detail}` : ''}${sec.count > 1 ? ` · ${sec.count} molecules` : ''}`}>
          {sec.name}
        </span>
        <span className="text-[9px] font-bold px-1 rounded bg-slate-100 text-slate-600 shrink-0"
          title="The kind of molecule this space styles — it is what decides which rows appear inside">{MOL_KIND_LABELS[kind]}{sec.detail ? ` · ${sec.detail}` : ''}</span>
        {sec.count > 1 && (
          <span className="text-[9px] text-slate-400 font-bold shrink-0" title={`${sec.count} molecules of this kind share this space`}>×{sec.count}</span>
        )}
        {/* 🔎 ZOOM ON THIS MOLECULE ALONE (the request): NGL's autoView() takes the
            section's own selector, so the camera frames that molecule and not the
            whole file. */}
        <button type="button" onClick={() => zoomSection(sec)}
          className="text-[10px] font-bold text-slate-500 hover:text-blue-700 shrink-0"
          title={`🔎 Zoom on « ${sec.name} » — centre the camera on THIS molecule (the file may hold several)`}>🔎</button>
      </div>
      {shown && subsectionsOf(kind).map((s) => renderSectionRow(sec, s.sub))}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-bold text-slate-400 shrink-0" title="3D labels of THIS molecule alone">🏷</span>
        {[['residues', 'Residues'], ['residueType', 'Type'], ['atoms', 'Atoms']].map(([k, l]) => (
          <label key={k} className="flex items-center gap-0.5 text-[9px] font-bold text-slate-500 cursor-pointer"
            title={`Label the ${l.toLowerCase()} of ${sec.name} only (the label text stays context-aware: protein / nucleic / ligand / water / ion)`}>
            <input type="checkbox" checked={!!labels[k]} onChange={(e) => setSectionLabel(sec.id, k, e.target.checked)} className="accent-blue-600 w-3 h-3" />
            {l}
          </label>
        ))}
        <button type="button" onClick={toggleRenumberPanel}
          className="text-[9px] font-bold text-slate-500 hover:text-slate-800 shrink-0 ml-auto"
          title="🔢 Renumber the residues of this structure (the panel opens right below, and the 3D labels and the residue strip follow the new numbers)">🔢</button>
        <button type="button" onClick={() => resetSectionKindLook(sec.id, kind)}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-800 shrink-0"
          title="↺ Put every row of this molecule back to the defaults of its kind">↺</button>
      </div>
      {/* The renumbering tool of THIS molecule, opened by the 🔢 above: the panel is
          rendered where the button is, so « nothing happens » can no longer be the
          answer (see renderRenumberPanel). */}
      {renderRenumberPanel()}
    </div>
  );
};

// Move / reset the MAIN structure by typing X/Y/Z (the same controls the extra
// molecules have). The main's NGL component is moved independently.
const setMainPosition = (axis, value) => {
  const next = [mainPos[0] || 0, mainPos[1] || 0, mainPos[2] || 0];
  next[axis] = Number(value) || 0;
  setMainPos(next);
  try {
    const comp = componentRef.current;
    if (comp && typeof comp.setPosition === 'function') {
      comp.setPosition(next);
      if (typeof comp.updateMatrix === 'function') comp.updateMatrix();
      if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender();
    }
  } catch { /* position best-effort */ }
};
const resetMainPosition = () => {
  setMainPos([0, 0, 0]);
  try {
    const comp = componentRef.current;
    if (comp && typeof comp.setPosition === 'function') {
      comp.setPosition([0, 0, 0]);
      if (typeof comp.updateMatrix === 'function') comp.updateMatrix();
      if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender();
    }
  } catch { /* position best-effort */ }
};

// Apply the ACTIVE (selected) molecule's rendering — style / colour / colour
// mode / transparency — to every other loaded structure (the "🎨 Copy" button
// in the Molecules bar). Useful for a series of docked structures that should
// all look the same as the one currently on screen.
const applyActiveStyleToAll = () => {
  let src = null;
  if (selectedMolKey === 'main') {
    src = {
      style: mainMolRef.current.style || 'auto',
      color: mainMolRef.current.color || '',
      colorMode: mainMolRef.current.colorMode || 'element',
      transparency: mainMolRef.current.transparency || 0,
    };
  } else {
    const entry = extraCompsRef.current.find((e) => e.id === selectedMolKey);
    if (entry) {
      src = {
        style: entry.style || 'auto',
        color: entry.color || '',
        colorMode: entry.colorMode || 'element',
        transparency: entry.transparency || 0,
      };
    }
  }
  if (!src) return;
  if (selectedMolKey !== 'main') {
    setMainMol((m) => ({ ...m, ...src }));
  }
  extraCompsRef.current.forEach((e) => {
    if (e.id === selectedMolKey) return;
    e.style = src.style;
    e.color = src.color;
    e.colorMode = src.colorMode;
    e.transparency = src.transparency;
    restyleExtraMol(e.id);
  });
  setExtraMols(extraMolsSnapshot());
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

// ---- Move the selected structure with the MOUSE (drag-to-move) --------------
// Convert a screen-pixel delta into a world-space translation at the depth of
// the structure, so dragging the mouse slides the selected molecule on screen.
const worldDeltaForScreen = (dxPx, dyPx) => {
  const stage = stageRef.current;
  const viewer = stage && stage.viewer;
  if (!viewer || !viewer.camera) return [0, 0, 0];
  try {
    const canvas = stage.container && stage.container.querySelector('canvas');
    const h = canvas ? canvas.clientHeight : 300;
    const cam = viewer.camera;
    const v3 = cam.position.constructor;
    const dir = cam.getWorldDirection(new v3());
    const right = new v3().crossVectors(dir, cam.up).normalize();
    const up = new v3().crossVectors(right, dir).normalize();
    const fov = (cam.fov || 40) * Math.PI / 180;
    const dist = cam.position.length() || 100;
    const wpp = (2 * Math.tan(fov / 2) * dist) / Math.max(1, h);
    const dxW = dxPx * wpp, dyW = -dyPx * wpp;
    return [right.x * dxW + up.x * dyW, right.y * dxW + up.y * dyW, right.z * dxW + up.z * dyW];
  } catch { return [0, 0, 0]; }
};

const dragMoveComp = () => (selectedMolKey === 'main'
  ? componentRef.current
  : (extraCompsRef.current.find((x) => x.id === selectedMolKey) || {}).comp);

const dragMoveOnDown = (e) => {
  e.preventDefault();
  const comp = dragMoveComp();
  if (!comp || typeof comp.setPosition !== 'function') return;
  const p = comp.position || { x: 0, y: 0, z: 0 };
  dragMoveRef.current = { comp, pos: [p.x || 0, p.y || 0, p.z || 0], last: { x: e.clientX, y: e.clientY } };
  window.addEventListener('mousemove', dragMoveOnMove);
  window.addEventListener('mouseup', dragMoveOnUp);
};

const dragMoveOnMove = (e) => {
  const d = dragMoveRef.current;
  if (!d) return;
  const dx = e.clientX - d.last.x;
  const dy = e.clientY - d.last.y;
  d.last = { x: e.clientX, y: e.clientY };
  if (!dx && !dy) return;
  const [wx, wy, wz] = worldDeltaForScreen(dx, dy);
  d.pos = [d.pos[0] + wx, d.pos[1] + wy, d.pos[2] + wz];
  try {
    d.comp.setPosition(d.pos);
    if (typeof d.comp.updateMatrix === 'function') d.comp.updateMatrix();
  } catch { /* best-effort */ }
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

const dragMoveOnUp = () => {
  window.removeEventListener('mousemove', dragMoveOnMove);
  window.removeEventListener('mouseup', dragMoveOnUp);
  const d = dragMoveRef.current;
  dragMoveRef.current = null;
  if (!d) return;
  // Sync the Molecules-bar X/Y/Z inputs with the dragged position (extras AND
  // the main structure — both have Move controls now).
  const entry = extraCompsRef.current.find((x) => x.comp === d.comp);
  if (entry) { entry.position = d.pos; setExtraMols(extraMolsSnapshot()); }
  else if (d.comp === componentRef.current) { setMainPos([d.pos[0] || 0, d.pos[1] || 0, d.pos[2] || 0]); }
};

// Delete ONE extra structure (its NGL component + Molecules-bar entry).
const deleteExtraMol = (id) => {
  const idx = extraCompsRef.current.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const [entry] = extraCompsRef.current.splice(idx, 1);
  try { if (stageRef.current) stageRef.current.removeComponent(entry.comp); } catch {}
  espForget(id); // the ⚡ ESP overlay (if any) was destroyed with the component
  setExtraMols(extraMolsSnapshot());
  setVisibleMolKeys((prev) => { const n = new Set(prev); n.delete(id); return n; });
  if (selectedMolKey === id) setSelectedMolKey('main');
  // Its fold state goes with it (the Molecules bar keys the folds by molecule id).
  setMolFold((prev) => { const n = { ...prev }; delete n[id]; return n; });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

// Select + centre the view on one structure (click its row in the Molecules bar).
const autoViewMol = (key) => {
  setSelectedMolKey(key);
  const comp = key === 'main' ? componentRef.current : (extraCompsRef.current.find((e) => e.id === key) || {}).comp;
  try { if (comp) comp.autoView(); } catch {}
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

/* 🔎 ZOOM ON ONE MOLECULE OF THE STYLING BAR (the request: « For each molecule in
   the molecules styling add a button zoom to zoom on that molecule »). NGL's
   `autoView()` takes a SELECTION: the section's own selector is what frames THAT
   molecule alone — a glycan, an ion type, a ligand or a whole chain — instead of
   the whole file, which is what the 🔎 of the molecule header already does. A
   section whose selector NGL refuses (an unusual residue name) falls back on the
   whole molecule, so the button always does something.
   The molecule is selected at the same time, so the ESP / the MolFold panels
   follow the zoom (they work on the selected molecule). */
const zoomSection = (sec) => {
  const molKey = String((sec && sec.id) || '').split('::')[0] || 'main';
  setSelectedMolKey(molKey);
  const comp = resolveMolComp(molKey);
  if (!comp) return;
  try { comp.autoView(sec && sec.sele ? sec.sele : undefined); } catch { try { comp.autoView(); } catch { /* ignore */ } }
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch { /* ignore */ }
};

// Flush the pending extra files once the MAIN structure is ready. This runs
// AFTER the main load has called stage.removeAllComponents(), so the extras can
// never be wiped by it. Then re-centre the camera on the main structure.
useEffect(() => {
  if (status !== 'ready') return;
  const pending = pendingExtraFilesRef.current;
  if (!pending || pending.length === 0) return;
  pendingExtraFilesRef.current = [];
  pending.forEach(({ file, n }) => { loadExtraMolecule(file, n); });
  try { if (componentRef.current) componentRef.current.autoView(); } catch {}
  try { if (stageRef.current) stageRef.current.handleResize(); } catch {}
}, [status, loadExtraMolecule]);

// Load one structure file as an EXTRA entry (no main-load side effects): if the
// file is a multi-chain/multi-molecule PDB, each chain/molecule gets its own
// entry in the Molecules bar; otherwise the whole file is one entry.
const loadExtraStructureFile = useCallback(async (file) => {
  const baseName = String(file && file.name || 'Structure').replace(/\.[^.]+$/, '');
  try {
    const stage = stageRef.current;
    if (!stage) return;
    if (file && /\.(pdb|ent)$/i.test(String(file.name || ''))) {
      const parts = await splitPdbFileIntoMolecules(file);
      if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          const nm = p.chainId && p.chainId !== '_' ? `Chain ${p.chainId}` : `Molecule ${i + 1}`;
          await loadChainMolecule(p.blob, `${baseName} · ${nm}`, i);
        }
        return;
      }
    }
    await loadExtraMolecule(file, 0);
  } catch { /* best-effort */ }
}, [loadChainMolecule, loadExtraMolecule]);

// Full replace: the first file becomes the new MAIN structure, the rest become
// additional molecules (this is the classic multi-file behaviour).
const doReplaceLoad = useCallback((files) => {
  clearExtraMolecules();
  setManualOverride(true);
  setStructOrigin('external');
  setTrajFile(null);
  const [first, ...rest] = files;
  setFile(first);
  setPdbId('');
  requestStructureLoad({ file: first, url: null, ts: Date.now() });
  onStructureFile?.(first);   // share the chosen topology with the analysis sections
  // Le fichier PRINCIPAL est archivé par la PAGE quand elle fournit
  // `onStructureFile` (NMR, MD) : elle y joint le POINTEUR de restauration
  // (`structureDrive`) qui permet de le retrouver depuis un autre poste. Ici on
  // n'envoie donc que ce que personne d'autre n'envoie : le fichier principal
  // pour les pages qui n'ont pas de handler (Docking) et, plus bas, les
  // molécules supplémentaires — sinon le même fichier partait deux fois et
  // pouvait se dupliquer sur le Drive (deux envois du même nom en parallèle).
  if (driveNaming && !onStructureFile) archiveFileToDrive({ file: first, ctx: driveNaming }).catch(() => {});
  // Additional structures (docking complexes / clusters / poses) are loaded as
  // separate NGL components and shown via the "Molecules" bar (right side,
  // multi-select — any combination can be displayed together).
  // They are deferred (pendingExtraFilesRef) until the MAIN structure is ready:
  // the main load calls stage.removeAllComponents(), which would wipe any
  // component added while it runs.
  pendingExtraFilesRef.current = rest.map((f, i) => ({ file: f, n: i + 1 }));
  rest.forEach((f) => {
    if (driveNaming) archiveFileToDrive({ file: f, ctx: driveNaming }).catch(() => {});
  });
}, [onStructureFile, driveNaming, clearExtraMolecules]);

// Keep the current structure AND add the picked file(s) alongside it.
const doKeepBoth = useCallback(async (files) => {
  setPendingFileBatch(null);
  if (!stageRef.current) { doReplaceLoad(files); return; }
  for (const f of files) {
    await loadExtraStructureFile(f);
    if (driveNaming) archiveFileToDrive({ file: f, ctx: driveNaming }).catch(() => {});
  }
  setExtraMols(extraMolsSnapshot());
  // Show the newly kept structures right away.
  setVisibleMolKeys((prev) => {
    const n = new Set(prev);
    extraCompsRef.current.forEach((x) => n.add(x.id));
    return n;
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
}, [doReplaceLoad, driveNaming, loadExtraStructureFile]);

// Load a PDB code / URL as an EXTRA molecule (its own NGL component, hidden by
// default — the Molecules bar reveals it). Mirrors the main-load resolution,
// including the PDB-ID fallbacks.
const loadExtraStructureUrl = useCallback(async (rawSrc, n = 0) => {
  try {
    const stage = stageRef.current;
    if (!stage) return;
    const target = normalizeStructureSource(rawSrc);
    if (!target) throw new Error('No structure URL or PDB ID provided');
    let comp;
    try {
      comp = target.params ? await stage.loadFile(target.url, target.params) : await stage.loadFile(target.url);
    } catch (firstErr) {
      const idMatch = String(rawSrc || '').trim().match(/([0-9][A-Za-z0-9]{3})(?:\.[A-Za-z0-9]+)?\/?$/);
      if (idMatch) {
        const id = idMatch[1].toUpperCase();
        try { comp = await stage.loadFile(`https://files.rcsb.org/download/${id}.pdb`, { ext: 'pdb' }); }
        catch { comp = await stage.loadFile(`rcsb://${id}`); }
      } else {
        throw firstErr;
      }
    }
    if (!comp || !comp.structure) return;
    try { ensureGlycanBonds(comp); } catch { /* best-effort (PART 2.2bis) */ }
    // The same §2 « Molecular Styling » look as the main structure.
    const baseReps = applyCurrentStyleTo(comp, []);
    shadowRepsHook(comp);
    if (shadowOnRef.current) setMeshShadows(comp);
    const s = String(rawSrc || '').trim();
    const label = /^[0-9a-z]{4}$/i.test(s)
      ? `PDB ${s.toUpperCase()}`
      : (s.split(/[?#]/)[0].split('/').pop() || `Structure ${n}`);
    const id = `mol_${Date.now()}_${n}`;
    extraCompsRef.current.push({ id, name: label, comp, baseReps, style: 'auto', color: '', colorMode: 'element', transparency: 0, position: [0, 0, 0] });
    setExtraMols(extraMolsSnapshot());
    try { comp.setVisibility(false); } catch {}
  } catch (err) {
    console.warn('Could not load structure source:', err && err.message);
    setErrorMsg(`Could not load "${String(rawSrc || '').trim()}": ${(err && err.message) || 'failed'}`);
  }
}, [applyCurrentStyleTo]);

// A new PDB code / URL was given while a structure is already loaded — replace
// the current structure with it (it becomes the new main structure).
const doReplaceSrc = useCallback((rawSrc) => {
  setPendingSrc(null);
  clearExtraMolecules();
  setManualOverride(true);
  setStructOrigin('external');
  setFile(null);
  setTrajFile(null);
  requestStructureLoad({ file: null, url: rawSrc, ts: Date.now() });
  if (typeof onStructureSrc === 'function') onStructureSrc(String(rawSrc || '').trim());
}, [clearExtraMolecules, onStructureSrc]);

// Keep the current structure AND add the PDB code / URL as an additional
// molecule (appears in the Molecules bar, visible right away).
const doKeepBothSrc = useCallback(async (rawSrc) => {
  setPendingSrc(null);
  if (typeof onStructureSrc === 'function') onStructureSrc(String(rawSrc || '').trim());
  if (!stageRef.current) { doReplaceSrc(rawSrc); return; }
  await loadExtraStructureUrl(rawSrc, (Date.now() % 10000));
  const entry = extraCompsRef.current[extraCompsRef.current.length - 1];
  if (entry) setVisibleMolKeys((prev) => new Set([...prev, entry.id]));
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
}, [doReplaceSrc, loadExtraStructureUrl, onStructureSrc]);

const handleFileChange = useCallback((e) => {
const files = Array.from(e.target.files || []);
if (files.length === 0) return;
e.target.value = '';
// If a structure is already shown, let the user choose between replacing it or
// keeping both (loading the new file(s) as additional molecules).
const alreadyLoaded = !!componentRef.current && statusRef.current === 'ready';
if (alreadyLoaded) { setPendingFileBatch(files); return; }
doReplaceLoad(files);
}, [doReplaceLoad]);

// Show/hide any combination of loaded structures (main + extra uploaded files).
// Only the selected molecules are displayed; the rest stay hidden.
const toggleMol = (key) => {
setVisibleMolKeys((prev) => {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
});
};
// Apply the molecule visibility to the NGL components whenever the selection changes.
useEffect(() => {
const show = (k) => visibleMolKeys.has(k);
try { if (componentRef.current) componentRef.current.setVisibility(show('main')); } catch {}
extraCompsRef.current.forEach(({ id, comp }) => {
  try { comp.setVisibility(show(id)); } catch {}
});
try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
}, [visibleMolKeys]);

const handlePdbIdLoad = useCallback(() => {
const value = pdbId.trim();
if (!value) return;
// If a structure is already on screen, ask whether to replace it or keep both
// (same flow as the file uploads and the parent-supplied PDB code / URL).
if (componentRef.current && statusRef.current === 'ready' && lastAskedSrcRef.current !== value) {
  lastAskedSrcRef.current = value;
  setPendingSrc(value);
  return;
}
clearExtraMolecules();
setManualOverride(true);
setStructOrigin('external');
setFile(null);
setTrajFile(null);
setLoadRequest({ file: null, url: value, ts: Date.now() });
onStructureSrc?.(value);   // share the web/PDB topology with the analysis sections
}, [pdbId, onStructureSrc, clearExtraMolecules]);

// ---- Empty the viewer completely ----
// Removes every loaded structure (main + extras), clears the residue strip, the
// Molecules / Selections bars and any trajectory, cancels in-flight loads, and
// returns the viewer to its empty idle state so a brand-new molecule can be
// loaded (nothing from the previous molecule remains on screen).
const handleClearViewer = () => {
  abortControl.abortAll();
  clearExtraMolecules();
  try { if (stageRef.current) stageRef.current.removeAllComponents(); } catch {}
  clearMeasurements(); // distance lines belong to the removed components
  espResetAll(); // every component (and its ⚡ ESP overlay) is gone now
  componentRef.current = null;
  highlightCompRef.current = null;
  manualHighlightCompRef.current = null;
  stripHighlightCompRef.current = null;
  stripResidueRiRef.current = null;
  labelCompRef.current = null;
  sidechainCompRef.current = null;
  selCompsRef.current = {};
  baseCompsRef.current = [];
  setFile(null);
  loadedPdbTextRef.current = null;
  setPdbId('');
  setLoadRequest(null);
  // « 🗑 Clear » vide le viewer POUR DE BON : un PDB rangé par « 🗑 Delete PDB »
  // est oublié lui aussi (rien ne « revient tout seul »). La page reprend la
  // main : sa structure générée — ou le modèle de sa séquence — est resservi,
  // exactement comme si l'on ouvrait la page pour la première fois.
  setStructOrigin('none');
  setStashedPdb(null);
  setStructAsideMsg('');
  setManualOverride(false);
  lastLoadedTextRef.current = null;
  setStatus('idle');
  setErrorMsg('');
  setResidueTicks([]);
  setSelections([]);
  setSelStyles({});
  setPymolActive(false);
  setPymolLog('');
  setPymolScript('');
  setShowPymolPanel(false);
  setHideAll(false);
  setHoverInfo(null);
  setHasNonProtein(false);
  setCatInfo(null);
  setTrajFile(null);
  setTrajAborted(false); // a fresh trajectory pick is always allowed again
  setTrajStatus('none');
  setTrajError('');
  setPlaying(false);
  setNumFrames(0);
  setCurrentFrame(0);
  setPendingTraj(null);
  setExtraMols([]);
  setVisibleMolKeys(new Set(['main']));
  try { if (stageRef.current && typeof stageRef.current.handleResize === 'function') stageRef.current.handleResize(); } catch {}
};

/* ── §1 General · « 🗑 Delete PDB » / « ↩ Restore PDB » ──────────────────────
   Un PDB chargé ici (fichier, PDB ID / URL, fichier fourni par la page) peut
   être RETIRÉ du viewer sans rien perdre : sa source est mise de côté et le
   même bouton le RESSUSCITE ensuite — le fichier / l'URL / le texte repasse par
   l'entonnoir habituel (donc les styles, la séquence, les tables d'atomes se
   reconstruisent comme pour n'importe quel chargement) et la trajectoire qui
   allait avec revient avec lui. Dès que le PDB est rangé, la structure de la
   séquence de la page reprend sa place : c'est le geste « je veux voir le
   modèle, pas le PDB ». */
const pdbSourceOfCurrent = () => {
  const source = loadRequest || {};
  const traj = trajFile || trajectoryFile || null;
  const ext = source.ext && String(source.ext).toLowerCase() !== 'auto'
    ? String(source.ext).toLowerCase()
    : 'pdb';
  return {
    file: source.file || file || structureFile || null,
    url: (!source.file && (source.url || lastAskedSrcRef.current)) || null,
    text: source.text || loadedPdbTextRef.current || null,
    ext,
    name: (source.file && source.file.name) || structureFileName || (source.url ? String(source.url) : '') || 'the loaded structure',
    traj,
    trajName: (traj && traj.name) || '',
  };
};

const deleteLoadedPdb = () => {
  if (structOrigin !== 'external') return;
  const stash = pdbSourceOfCurrent();
  if (!stash.file && !stash.url && !stash.text) {
    flashStructAsideMsg('⚠️ Nothing to put aside — load a PDB with 📂 PDB file(s) or a PDB ID / URL first.');
    return;
  }
  abortControl.abortAll();
  clearExtraMolecules();
  try { if (stageRef.current) stageRef.current.removeAllComponents(); } catch {}
  clearMeasurements();          // distance lines belong to the removed components
  espResetAll();                // …and so do the ⚡ ESP overlays
  componentRef.current = null;
  highlightCompRef.current = null;
  manualHighlightCompRef.current = null;
  stripHighlightCompRef.current = null;
  stripResidueRiRef.current = null;
  labelCompRef.current = null;
  sidechainCompRef.current = null;
  loadedPdbTextRef.current = null;
  lastLoadedTextRef.current = null;
  setFile(null);
  setPdbId('');
  setLoadRequest(null);
  setStatus('idle');
  setErrorMsg('');
  setSelections([]);
  setResidueTicks([]);
  setHasNonProtein(false);
  setCatInfo(null);
  setTrajFile(null);            // the trajectory goes with the PDB (kept in the stash)
  setTrajStatus('none');
  setNumFrames(0);
  setCurrentFrame(0);
  setPlaying(false);
  setManualOverride(false);     // the page may serve its own structure again
  setStashedPdb(stash);
  if (sequenceStructureText) {
    // The sequence typed on the page takes the PDB's place, right away.
    lastLoadedTextRef.current = sequenceStructureText;
    setStructOrigin('generated');
    requestStructureLoad({ file: null, url: null, text: sequenceStructureText, ext: sequenceStructureExt || 'pdb', ts: Date.now() });
    flashStructAsideMsg(`🗑 ${stash.name} deleted — the structure built from the sequence is shown instead. Click ↩ Restore PDB to bring it back.`);
  } else {
    setStructOrigin('none');
    flashStructAsideMsg(`🗑 ${stash.name} deleted — click ↩ Restore PDB to bring it back.`);
  }
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

const restoreStashedPdb = () => {
  if (!stashedPdb) return;
  const { file: stashedFile, url, text, ext, name, traj } = stashedPdb;
  abortControl.abortAll();
  clearExtraMolecules();
  lastLoadedTextRef.current = null;
  setManualOverride(true);
  setStructOrigin('external');
  setFile(stashedFile || null);
  setPdbId(url || '');
  setStashedPdb(null);
  // Les OCTETS affichés gagnent sur le fichier d'origine : un jeu d'hydrogènes
  // reconstruit (⚗️ Rebuild H) ou un PDB retouché revient tel qu'il était.
  requestStructureLoad({
    file: (!text && stashedFile) ? stashedFile : null,
    url: (!text && !stashedFile) ? (url || null) : null,
    text: text || null,
    ext: ext || 'pdb',
    ts: Date.now(),
  });
  // Sa trajectoire revient avec lui : l'effet de trajectoire la rattache dès que
  // la structure est « ready ».
  if (traj) setTrajFile(traj);
  flashStructAsideMsg(`↩ ${name} restored${traj ? ` with its trajectory (${traj.name || 'trajectory'})` : ''}.`);
};

/* ── ✏️ Modify · « 🧬 Build from sequence » ──────────────────────────────────
   Reconstruit la structure À PARTIR DE LA SÉQUENCE tapée dans la page, à tout
   moment — même quand un PDB est chargé : le PDB est alors rangé (mêmes règles
   que « 🗑 Delete PDB ») et le bouton ↩ Restore PDB de §1 General le ramène. Le
   texte est fabriqué par la page (proteinSequenceToPdbText /
   nucleicSequenceToPdbText) : aucun aller-retour réseau. */
const buildFromSequence = () => {
  if (!sequenceStructureText) {
    flashSeqBuildMsg('⚠️ No sequence on this page — type the Protein / DNA / RNA sequence in “Molecular structure and visualization” first.');
    return;
  }
  if (structOrigin === 'external' && !stashedPdb) {
    const stash = pdbSourceOfCurrent();
    if (stash.file || stash.url || stash.text) setStashedPdb(stash);
  }
  abortControl.abortAll();
  clearExtraMolecules();
  setFile(null);
  setPdbId('');
  setManualOverride(false);
  setStructOrigin('generated');
  lastLoadedTextRef.current = sequenceStructureText;
  requestStructureLoad({ file: null, url: null, text: sequenceStructureText, ext: sequenceStructureExt || 'pdb', ts: Date.now() });
  const atoms = (sequenceStructureText.match(/^(ATOM|HETATM)/gm) || []).length;
  flashSeqBuildMsg(`🧬 Structure rebuilt from the sequence — ${atoms.toLocaleString()} atoms, ${sequenceStructureText.length.toLocaleString()} PDB characters.`);
};

// ---- Abort the current long-running operation (vertical-bar / global Stop) ----
// Stops trajectory playback, closes the frame-selection modal and cancels the
// active structure / trajectory load so the UI returns to a usable state.
// `abortSnap` is the SHARED registry seen from React (useAbortControl): it is what
// tells the vertical bar whether a long operation is really running — a structure /
// a trajectory LOAD, an MD analysis, a DSSP run — and never a playback, which stops
// with its own ▶ / ⏸ button (the report: an « Abort » panel popping up over the
// canvas for a whole MD run « makes no sense because I can simply stop it »).
const abortSnap = useAbortControl();
const runningAbort = abortSnap.active ? { label: abortSnap.label } : null;
const handleAbort = () => {
  setPlaying(false);
  setPendingTraj(null);
  abortControl.abortAll();
  if (abortRef.current) {
    const a = abortRef.current;
    abortRef.current = null;
    a.cancel();
  }
};

// ---- ⚗️ Physical hydrogen rebuild ------------------------------------------
// "Delete the hydrogens, then add them again": re-derives every H coordinate of
// the loaded PDB from its own heavy atoms (ideal bond lengths/angles, all atom
// NAMES preserved, heavy atoms untouched) and reloads the text through the same
// pipeline as any structure, so labels / highlights / measurements rebuild on
// the new geometry.
const rebuildHydrogensNow = async () => {
  if (!stageRef.current || !componentRef.current) {
    flashRebuildMsg('⚠️ Load a structure first — nothing to rebuild yet.');
    return;
  }
  const raw = loadedPdbTextRef.current;
  if (!raw) {
    flashRebuildMsg('⚠️ Hydrogen rebuild needs the loaded PDB text (use the 📂 PDB file button or a generated peptide). PDB-ID / URL downloads can’t be edited in the viewer.');
    return;
  }
  const result = rebuildProteinHydrogenCoords(raw);
  if (!result.ok) {
    flashRebuildMsg(`⚠️ ${result.message}`);
    return;
  }
  loadedPdbTextRef.current = result.text;
  if (result.moved > 0) {
    requestStructureLoad({ file: null, url: null, text: result.text, ext: 'pdb', ts: Date.now() });
  }
  const suffix = result.moved > 0
    ? `moved ${result.moved} hydrogen${result.moved === 1 ? '' : 's'} to ideal geometry`
    : 'all hydrogens were already at ideal positions';
  flashRebuildMsg(`⚗️ Hydrogens rebuilt across ${result.residues} residues (${result.rebuilt} re-placed, names kept) — ${suffix}.`);
};

// ---- Capture the current 3D scene as a figure -------------------------------
// Uses NGL's makeImage (reliable WebGL screenshot), falls back to the raw
// canvas, then stores the image in the Figures library (Publications page).
const captureScene = async () => {
  const stage = stageRef.current;
  if (!stage) { setCaptureMsg('⚠️ No 3D scene to capture'); setTimeout(() => setCaptureMsg(''), 3500); return; }
  let url = '';
  try {
    if (typeof stage.makeImage === 'function') {
      const canvas = stage.makeImage();
      if (canvas && typeof canvas.toDataURL === 'function') url = canvas.toDataURL('image/png');
    }
  } catch { /* fall through to the raw canvas */ }
  if (!url) {
    try {
      const cv = stage.viewer && stage.viewer.container ? stage.viewer.container.querySelector('canvas') : null;
      if (cv) url = cv.toDataURL('image/png');
    } catch { /* ignore */ }
  }
  if (!url) { setCaptureMsg('⚠️ Could not capture the 3D scene'); setTimeout(() => setCaptureMsg(''), 3500); return; }
  const label = `Structure${file ? ` · ${file.name}` : pdbId ? ` · ${pdbId}` : ''}`;
  const pid = getActiveProjectId();
  // The real capture is stored on Google Drive (projects/<project>/images, and
  // projects/_unassigned/images when no project is open); only a small local
  // preview stays in the browser.
  await publishLibraryFigure({ scope: pid ? 'project' : 'common', projectId: pid, dataUrl: url, label });
  if (pid) {
    setCaptureMsg(`✓ 3D structure saved to the project library (Publications → Figures & Slides · ${pid}) and on Google Drive`);
  } else {
    setCaptureMsg('✓ 3D structure saved to the common Figures library (Publications → Figures & Slides) and on Google Drive');
  }
  setTimeout(() => setCaptureMsg(''), 5000);
};

// ⚡ ESP targets the molecule currently selected in the Molecules bar.
const espTargetComp = status === 'ready' ? resolveMolComp(selectedMolKey) : null;
const espOnSelected = espMolKeys.has(selectedMolKey);
const espTargetName = selectedMolKey === 'main'
  ? 'the main structure'
  : String((extraMols.find((m) => m.id === selectedMolKey) || {}).name || 'the selected molecule');
const espBtnTitle = !espTargetComp
  ? 'Load a structure first — ⚡ ESP colours the selected molecule’s surface by electrostatic potential'
  : espOnSelected
    ? `Remove the electrostatic-potential surface from ${espTargetName}`
    : `Add a translucent surface coloured by electrostatic potential to ${espTargetName} — red = negative, white ≈ neutral, blue = positive. Once it is ON, a ⚡ Range control appears so you can set the limits (kcal/mol) and make the red / blue poles clearly visible. Partial charges come from the file when it provides them (PQR / charged MOL2 · SDF); otherwise NGL falls back to its CHARMM-derived charges for proteins. Click again to hide the surface.`;

/* ── SMILES of the molecule at hand (organic conditions and docked ligands) ────
   The viewer already RECEIVES the SMILES — the page passes the one of the
   condition (NMR organic molecule) and a docking run passes its ligand's — and
   uses it to name the 3D atoms from the 2D formula (see computeSmiles3DNameMap).
   Until now it was never SHOWN: the Molecules bar displays it, one click away from
   the clipboard, so a ligand can be identified / pasted into a drawing tool or a
   report without leaving the page. `smiles` wins when both are given (it is the
   molecule the page is really about). */
const ligandSmilesText = String(smiles || ligandSmiles || '').trim();
/* ── LE SMILES VIENT AUSSI DU FICHIER LUI-MÊME (HETATM → RCSB CCD) ───────────
   Un PDB standard n'écrit AUCUNE chaîne SMILES : il ne nomme son ligand que par le
   code à 3 lettres de ses enregistrements HETATM. Quand la page n'en fournit pas
   (un PDB chargé à la main, un fichier de docking sans métadonnée), le viewer
   demande le SMILES au Chemical Component Dictionary du RCSB pour le code du
   ligand qu'il a RÉELLEMENT trouvé (les sections « ligand » de sa barre) — et
   affiche d'où il vient. `onLigandSmiles` permet à la page de le ranger dans sa
   condition (voir utils/ligandSmiles.js). */
const [ligandFromPdb, setLigandFromPdb] = useState(null);   // { code, smiles, name, source, loading, error }
const onLigandSmilesRef = useRef(onLigandSmiles);
onLigandSmilesRef.current = onLigandSmiles;
const ligandCodesOfLoaded = (() => {
  const out = [];
  Object.keys(sectionCatalog).forEach((molKey) => {
    (sectionCatalog[molKey].sections || []).forEach((s) => {
      if (s.kind !== 'ligand') return;
      const code = String(s.name || '').trim().toUpperCase();
      if (code && !out.includes(code)) out.push(code);
    });
  });
  return out;
})();
const ligandCodesKey = ligandCodesOfLoaded.join(',');
useEffect(() => {
  if (ligandSmilesText || !ligandCodesKey) { setLigandFromPdb(null); return; }
  const code = ligandCodesOfLoaded[0];
  const hit = cachedLigandSmiles(code);
  if (hit) { setLigandFromPdb(hit); onLigandSmilesRef.current?.(hit); return; }
  let cancelled = false;
  setLigandFromPdb({ code, loading: true });
  fetchLigandSmiles(code)
    .then((info) => {
      if (cancelled) return;
      setLigandFromPdb(info);
      onLigandSmilesRef.current?.(info);
    })
    .catch((err) => { if (!cancelled) setLigandFromPdb({ code, error: (err && err.message) || 'could not be resolved' }); });
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ligandCodesKey, ligandSmilesText]);
// The SMILES the bar shows: the page's own, or the one the dictionary resolved.
const shownLigandSmiles = ligandSmilesText || (ligandFromPdb && ligandFromPdb.smiles) || '';
const ligandSmilesSource = ligandSmilesText
  ? null
  : (ligandFromPdb && ligandFromPdb.smiles
    ? `resolved for the HETATM code ${ligandFromPdb.code} by the ${ligandFromPdb.source || 'RCSB dictionary'}${ligandFromPdb.name ? ` (${ligandFromPdb.name})` : ''}`
    : null);
// The chains the LOADED molecules really carry — what the ⚙ wheel's « Chains »
// section names, so the user knows which swatch to move. The section catalogue keys
// a protein / a nucleic acid section `<kind>|<chain>` (see listMoleculeSections); a
// chain with no name at all takes the palette's grey « other ».
const loadedChainLetters = (() => {
  const out = [];
  Object.keys(sectionCatalog).forEach((molKey) => {
    (sectionCatalog[molKey].sections || []).forEach((s) => {
      if (s.kind !== 'protein' && s.kind !== 'nucleic') return;
      const letter = String(s.key).split('|')[1] || '';
      if (!out.includes(letter || 'other')) out.push(letter || 'other');
    });
  });
  return out.sort().join(' · ');
})();
const [smilesMsg, setSmilesMsg] = useState('');
const smilesMsgTimerRef = useRef(null);
const copyLigandSmiles = async () => {
  let okCopy = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shownLigandSmiles || ligandSmilesText);
      okCopy = true;
    }
  } catch { /* clipboard refused (insecure context / permission) → say so */ }
  setSmilesMsg(okCopy ? '✓ copied' : 'select & copy');
  clearTimeout(smilesMsgTimerRef.current);
  smilesMsgTimerRef.current = setTimeout(() => setSmilesMsg(''), 3000);
};
// The styling bar of the viewer (PART 4) is open as soon as a structure is loaded —
// it is the ONLY styling UI now — and the user can COLLAPSE it with its ◀ button so
// the whole canvas is free again (the ⚙ wheel and the ligand's SMILES live in it, so
// its state is remembered like every other viewer preference).
const molBarOpen = status === 'ready' && !molBarCollapsed;

// ── §2 menu helpers (derived, read-only) ───────────────────────────────────
// Lipids are recognised by residue name (see LIPID_RESNAMES): catInfo.lipids
// lists what was found, so the Lipids menu can say what it will act on — or
// state honestly that this structure has no lipid it can style.
const lipidsFound = Array.isArray((catInfo && catInfo.lipids) || null) ? catInfo.lipids : [];
const wholeMoleculeIsOne = moleculeType === 'lipid' || moleculeType === 'organic' || moleculeType === 'sugar';
const lipidMenuInactive = lipidsFound.length === 0 && !wholeMoleculeIsOne;
const lipidHint = lipidMenuInactive
  ? 'no lipid residue recognised in this structure (POPC / POPE / CHOL / DPPC …) — nothing to draw'
  : (lipidsFound.length
    ? `found: ${lipidsFound.slice(0, 6).join(', ')}${lipidsFound.length > 6 ? '…' : ''}`
    : 'the whole structure is one lipid');
// Whether the three parts can be told apart at all: the standard atom naming
// (PART 2.1) is what makes the glycerol / acyl-chain split possible, so the menu
// line and the 🎨 panel both say which rule THIS file is being read with.
const lipidNamingHint = (lipidsFound.length > 0 && catInfo && catInfo.lipidNamed === false)
  ? ' This file does not use the standard lipid atom naming, so the parts are read by ELEMENT — the polar atoms (N · P · O · S) are the headgroup, the carbons and hydrogens the chains — and the glycerol backbone is not separated.'
  : '';
// The headgroup CLASS of every lipid this file declares (PART 2.1bis) — what
// « Lipid class » paints, and the shortest way of saying what mixture the bilayer
// actually is (which phospholipid, which sterol).
const lipidClassHint = lipidsFound.length
  ? `classes: ${lipidsFound.slice(0, 8).map((n) => `${n} = ${lipidClassOf(n)}`).join(' · ')}`
  : '';
// Sugars: the menu says what it will act on (NGL keyword `saccharide` + the
// explicit GLC / NAG / MAN / BMA / SIA / GAL / FUC list).
const sugarCount = (catInfo && catInfo.n && Number.isFinite(catInfo.n.sugar)) ? catInfo.n.sugar : -1;
const sugarHint = moleculeType === 'sugar'
  ? 'this condition IS a sugar — the whole structure is styled here'
  : sugarCount === 0
    ? 'no carbohydrate recognised in this structure (saccharide / GLC / NAG / MAN …) — nothing to draw'
    : sugarCount > 0
      ? `${sugarCount} sugar atom(s) recognised`
      : 'carbohydrates are recognised by the NGL keyword « saccharide » + an explicit residue list';
// The GLYCANS of this file (PART 2.2bis): the sugars that are covalently linked
// into one molecule are printed as ONE entity — « NAG2 → NAG3 → BMA4 » — because
// that IS the entity the « Glycan (linked sugars) » colouring paints, instead of
// the seven unrelated residues the file declares.
const glycanInfo = (catInfo && catInfo.glycans) || null;
const glycanList = glycanInfo && Array.isArray(glycanInfo.entities) ? glycanInfo.entities : [];
const glycanHint = glycanList.length
  ? (glycanList.some((g) => g.linked)
    ? `linked glycans: ${glycanList.filter((g) => g.linked).map((g) => `${g.label} (${g.size} sugars)`).join(' · ')}${glycanList.some((g) => !g.linked) ? ' — plus isolated ' + glycanList.filter((g) => !g.linked).map((g) => g.label).join(' · ') : ''}`
    : `only isolated monosaccharides (${glycanList.map((g) => g.label).join(' · ')}) — each keeps its « Sugar type » colour`)
  : '';
// The CONFORMATION of the nucleic acids of this file (PART 3): the menu prints the
// count of every form it found and of the two motifs, so the user can see that the
// classification ran (and what it saw) before choosing the colouring.
const nucleicInfo = (catInfo && catInfo.nucleicClasses) || null;
const nucleicFormList = nucleicInfo && nucleicInfo.forms
  ? NUC_FORM_LABELS.filter((f) => nucleicInfo.forms[f] > 0).map((f) => `${NUC_FORM_NAMES[f]} ×${nucleicInfo.forms[f]}`)
  : [];
const nucleicMotifList = nucleicInfo && nucleicInfo.motifs
  ? [['gquad', 'G-quadruplex'], ['hairpin', 'hairpin']]
    .filter(([k]) => nucleicInfo.motifs[k] > 0).map(([k, n]) => `${n} ×${nucleicInfo.motifs[k]}`)
  : [];
const nucleicClassHint = nucleicFormList.length
  ? `from the coordinates: ${nucleicFormList.join(' · ')}${nucleicMotifList.length ? ` — motifs: ${nucleicMotifList.join(' · ')}` : ''}`
  : '';
// A per-category surface coloured by ESP shows the ⚡ Range control too, so the
// red/blue limits are always reachable, whichever ESP entry point was used.
const catEspActive = ['protein', 'nucleic', 'organic'].some((c) => {
  const s = catStyles[c] || {};
  return s.surfaceColor === 'esp' && !!s.surface && s.surface !== 'hide';
});

/* ── Two shared render helpers of the styling menus ───────────────────────── */
// « Transparent » alone is not enough: EVERY menu whose surface mode is
// transparent shows an Opacity slider (0 → 1) and the value is what NGL gets
// (with transparent: true, see addSurface).
const renderSurfaceOpacity = (cat, label = 'Opacity') => (
  (catStyles[cat] && catStyles[cat].surface === 'transparent') ? (
    <VRow label={label} title="Opacity of this transparent surface — passed to NGL as opacity (with transparent: true). 0 = invisible, 1 = solid.">
      <input type="range" min="0" max="1" step="0.05"
        value={Number.isFinite(catStyles[cat].surfaceOpacity) ? catStyles[cat].surfaceOpacity : 0.4}
        onChange={(e) => setCatStyle(cat, 'surfaceOpacity', Number(e.target.value))}
        className="w-32 accent-slate-600" aria-label={`${label} — surface opacity`} />
      <span className="text-[10px] text-slate-500 w-10">
        {(Number.isFinite(catStyles[cat].surfaceOpacity) ? catStyles[cat].surfaceOpacity : 0.4).toFixed(2)}
      </span>
    </VRow>
  ) : null
);

// The three 3D-label switches of ONE menu (the former global « 4 · Labels »
// section). Ticking « Residues » inside the Proteins menu labels PROTEINS ONLY:
// the label effect builds each category with that category's own selection.
const renderCatLabels = (cat) => {
  const l = catLabels[cat] || CAT_LABEL_DEFAULTS;
  return (
    <VRow label="3D labels" title="What is written in the 3D view for THIS molecule category only. « Residues » = the residue / molecule identifiers (proteins: one number on each CA; DNA/RNA: on O4' or P; ligands: the residue tag at the molecule centre; water / ions: the residue name + number). « Residue type » appends the 1-letter code (10 → 10A). « Atom names » writes the atom name next to each atom of this category.">
      <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 cursor-pointer whitespace-nowrap" title={`Label the residue / molecule numbers of this menu's own molecules only (${cat})`}>
        <input type="checkbox" checked={!!l.residues}
          onChange={(e) => setCatLabel(cat, 'residues', e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-600" />
        Residues
      </label>
      <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 cursor-pointer whitespace-nowrap" title={`Append the 1-letter residue code to those numbers (10 → 10A) for this menu's own molecules only (${cat})`}>
        <input type="checkbox" checked={!!l.residueType}
          onChange={(e) => setCatLabel(cat, 'residueType', e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-600" />
        Residue type
      </label>
      <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 cursor-pointer whitespace-nowrap" title={`Show the atom name next to each atom of this menu's own molecules only (${cat}) — e.g. CA, HA, CB, O1G`}>
        <input type="checkbox" checked={!!l.atoms}
          onChange={(e) => setCatLabel(cat, 'atoms', e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-600" />
        Atom names
      </label>
    </VRow>
  );
};

/* ── The three shared controls of every menu (radii · atom colour · surface
   colour) and the 🎨 button — ONE implementation each, called by the six menus,
   so a control can never be forgotten in one menu and present in another, and
   nothing can drift from the renderer (buildCategoryReps reads those same fields). */

// Sphere / bond radius of ONE menu: two sliders, 1.00 = the style's own NGL size.
const renderCatRadii = (cat) => {
  const g = catRadii(catStyles[cat]);
  return (
    <>
      <VRow label="Sphere radius" title="Radius of the SPHERES of THIS menu only, as a multiplier of the style's own size (1.00 = untouched). Spacefill (Spheres): it scales the Van der Waals radius (NGL radiusScale). Ball & Stick: NGL's aspectRatio — the size difference between its atom spheres and its sticks. Licorice draws its atoms AT the bond radius (NGL pins aspectRatio to 1), so there only the Bond slider thickens it — that IS licorice.">
        <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={RADIUS_STEP} value={g.sphere}
          onChange={(e) => setCatStyle(cat, 'sphereRadius', Number(e.target.value))}
          className="w-28 accent-slate-600" aria-label={`${cat} — sphere radius`} />
        <span className="text-[10px] text-slate-500 w-10">{g.sphere.toFixed(2)}×</span>
        {renderFollowGeneral(cat, 'sphereRadius', 'sphere radius')}
      </VRow>
      <VRow label="Bond radius" title="Thickness of the STICKS of THIS menu only, as a multiplier of the style's own radius (1.00 = untouched). It is NGL's radiusSize in Å: 0.15 Å for Ball & Stick, 0.25 Å for Licorice (the stick thickness this viewer has always used for the side chains) and 0.3 Å for the base rungs. The line styles use it as their line width.">
        <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={RADIUS_STEP} value={g.bond}
          onChange={(e) => setCatStyle(cat, 'bondRadius', Number(e.target.value))}
          className="w-28 accent-slate-600" aria-label={`${cat} — bond radius`} />
        <span className="text-[10px] text-slate-500 w-10">{g.bond.toFixed(2)}×</span>
        {renderFollowGeneral(cat, 'bondRadius', 'bond radius')}
      </VRow>
    </>
  );
};

// Atom colour of ONE menu. ONE selector carries every colouring metaphor the
// renderer understands (catColorParams): the element colours (default), the
// customisable 2°-structure colours of the protein menu, the two-colour GRADIENT
// along the sequence (N → C terminus / 5' → 3' end) and ONE flat colour.
const renderAtomColour = (cat) => {
  const m = catStyles[cat] || {};
  const mode = m.atomColor || 'default';
  const custom = mode === 'custom';
  const gradient = mode === 'gradient';
  const sstruc = mode === 'sstruc';
  const hex = Number.isFinite(m.atomColorHex) ? m.atomColorHex : DEFAULT_ATOM_COLORS[cat];
  // The ramp is ONE NGL scheme for the WHOLE viewer (gradientColorStore): this menu
  // shows and edits the GLOBAL pair. Writing it per category (which is what the
  // swatches used to do) left every menu except the protein one doing nothing at all.
  const from = gradientPair.from;
  const to = gradientPair.to;
  // The ramp always runs from the FIRST residue to the last (N terminus → C
  // terminus, 5' → 3'): the ⇄ button is what reverses it, by swapping the two.
  const swap = swapGeneralGradient;
  const gradientLabel = cat === 'protein' ? 'Gradient (N → C terminus)'
    : cat === 'nucleic' ? "Gradient (5' → 3' end)"
      : 'Gradient (per chain)';
  // A ramp follows a SEQUENCE: it is offered on the two POLYMER menus (a protein,
  // a nucleic acid). On a menu whose molecules are single residues (a lipid, a
  // sugar, a ligand, water) every residue would simply take the first colour, so
  // the option is not offered there — and a value coming from elsewhere falls back
  // on « Default » in the selector instead of showing a choice that does not exist.
  const showGradient = cat === 'protein' || cat === 'nucleic';
  // The per-sugar identity palette only says something where sugars are drawn:
  // the S menu (the ligands menu EXCLUDES sugars by construction).
  const showSugar = cat === 'sugar';
  // The LINKED-SUGAR reading lives in the same menu; the headgroup CLASS only in
  // the Lipids menu (a residue name is what carries it); and the two NUCLEIC
  // readings — the A · B · Z forms and the G-quadruplex / hairpin motifs of PART 3
  // — only in the Nucleic-acids menu, where the classification actually runs.
  const showGlycan = cat === 'sugar';
  const showLipidClass = cat === 'lipid';
  const showNucleicReading = cat === 'nucleic';
  const paletteOpen = mode === 'element' || mode === 'residue' || mode === 'basetype'
    || mode === 'sugar' || mode === 'nucform' || mode === 'motif' || mode === 'sstruc';
  return (
    <VRow label="Atom colour" title="Colour of EVERYTHING this menu draws — its ribbon (cartoon / ribbon / tube / trace) AND its atoms / bonds (Ball & Stick · Licorice · Lines · Spheres). « Default » keeps the classic colouring — element colours, and the rainbow by residue index for the protein / nucleic backbones. « Secondary structure » paints the helices, the sheets and the loops with the three colours of the ⚙ settings wheel — its swatches stand right here, in the « Color by » row of the styling bar, and in the wheel's own « Secondary structure » section. « Atom-type palette » uses the EDITABLE element table of the ⚙ settings wheel; « Amino acid » the 20 residue colours of the same wheel; « DNA/RNA base » its five base colours (A · C · G · T · U — also the colour that fills the stylized ring plates); « Sugar type » the per-sugar identity colours of the same wheel (GLC · NAG · MAN · BMA · SIA · GAL · FUC — anything else keeps the readable grey). « Gradient » runs a two-colour ramp ALONG the sequence, from the first residue to the last of every chain (N → C terminus for proteins, 5' → 3' end for nucleic acids). « Custom… » paints the whole menu with ONE colour (the swatch on the right).">
      <VSel value={!showGradient && mode === 'gradient' ? 'default' : mode}
        onChange={(e) => {
          const v = e.target.value;
          setCatStyle(cat, 'atomColor', v);
          if (v === 'custom' && !Number.isFinite(m.atomColorHex)) setCatStyle(cat, 'atomColorHex', DEFAULT_ATOM_COLORS[cat]);
        }}
        title={`${cat} atom colouring`} width="w-44">
        <option value="default">Default (element colours)</option>
        <option value="element">Atom-type palette (⚙)</option>
        {cat === 'protein' && <option value="residue">Amino acid (⚙ palette)</option>}
        {showNucleicReading && <option value="basetype">DNA/RNA base (⚙ palette)</option>}
        {showSugar && <option value="sugar">Sugar type (⚙ palette)</option>}
        {showGlycan && <option value="glycan">Glycan (linked sugars)</option>}
        {showLipidClass && <option value="lipidclass">Lipid class (headgroup)</option>}
        {showNucleicReading && <option value="nucform">RNA/DNA conformation</option>}
        {showNucleicReading && <option value="motif">2° structure + motifs (G4 · hairpin)</option>}
        {cat === 'protein' && <option value="sstruc">Secondary structure</option>}
        {showGradient && <option value="gradient">{gradientLabel}</option>}
        <option value="custom">Custom colour…</option>
      </VSel>
      {paletteOpen && (
        <button type="button" onClick={() => setSettingsPanelOpen(true)}
          className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
          title="Edit this palette (one colour per element · per sugar residue · per nucleotide form or motif) in the ⚙ settings wheel — the change repaints every molecule that uses it">
          ⚙ Palette…
        </button>
      )}
      {renderFollowGeneral(cat, 'atomColor', 'atom colour')}
      {custom && (
        <input type="color" value={numToHex(hex)}
          onChange={(e) => setCatStyle(cat, 'atomColorHex', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border border-slate-300 cursor-pointer" title="Colour of every atom drawn by this menu" />
      )}
      {custom && renderFollowGeneral(cat, 'atomColorHex', 'flat atom colour')}
      {gradient && (
        <>
          <input type="color" value={numToHex(from)}
            onChange={(e) => setGradientPair('gradientFrom', parseInt(e.target.value.slice(1), 16))}
            className="w-8 h-7 rounded border border-slate-300 cursor-pointer"
            title={cat === 'nucleic' ? "Colour of the FIRST residue of every chain (the 5' end)" : 'Colour of the FIRST residue of every chain (the N terminus)'} />
          <span className="text-[10px] font-bold text-slate-400">→</span>
          <input type="color" value={numToHex(to)}
            onChange={(e) => setGradientPair('gradientTo', parseInt(e.target.value.slice(1), 16))}
            className="w-8 h-7 rounded border border-slate-300 cursor-pointer"
            title={cat === 'nucleic' ? "Colour of the LAST residue of every chain (the 3' end)" : 'Colour of the LAST residue of every chain (the C terminus)'} />
          <button type="button" onClick={swap}
            className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Swap the two colours (the ramp is always drawn from the first residue to the last)">
            ⇄
          </button>
        </>
      )}
      {sstruc && (
        <>
          {/* The three colours RIGHT HERE: the 🎨 panel this row used to send the user
              to is not rendered any more, so choosing « Secondary structure » left the
              helix / sheet / loop colours with no control at all — the report. The ⚙
              button opens the settings wheel, where the palette has a section of its
              own; the swatches write through setSstrucColour, the ONE writer of this
              palette (it also switches this menu to « Secondary structure » and leaves
              the lightweight style, so the colour is really visible). */}
          {SSTRUC_COLOR_ITEMS.map((it) => (
            <input key={it.key} type="color" value={numToHex(sstrucColors[it.key])}
              onChange={(e) => setSstrucColour(it.key, parseInt(e.target.value.slice(1), 16))}
              className="w-7 h-7 rounded border border-slate-300 cursor-pointer"
              title={`Colour of the ${it.what} — writing it switches this menu to « Secondary structure » so the ribbon AND the atoms really take it`} />
          ))}
          <button type="button" onClick={() => setSettingsPanelOpen(true)}
            className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Open the ⚙ settings wheel — the three helix / sheet / loop colours have a « Secondary structure » section of their own there">
            ⚙ Colours…
          </button>
        </>
      )}
    </VRow>
  );
};

// Surface colour of ONE menu: element colours, ONE flat colour, or the ESP
// colouring (the shared ⚡ generator and its ±kcal/mol limits).
const renderSurfaceColour = (cat, label) => {
  const m = catStyles[cat] || {};
  const custom = m.surfaceColor === 'custom';
  const hex = Number.isFinite(m.surfaceColorHex) ? m.surfaceColorHex : DEFAULT_SURFACE_COLOR;
  return (
    <VRow label="Surface colour" title={`Colour of the ${label} SURFACE. « Default » = element colours; « Custom… » = one flat colour (the swatch on the right); « Electrostatic Potential » reuses the EXISTING ESP colouring (NGL 'electrostatic' scheme, red → white → blue) with the ±kcal/mol limits of the ⚡ Range control, and it switches the surface on if it was hidden.`}>
      <VSel value={m.surfaceColor || 'default'} onChange={(e) => setSurfaceColor(cat, e.target.value)}
        title={`${label} surface colouring`} width="w-56">
        <option value="default">Default (element colours)</option>
        <option value="custom">Custom colour…</option>
        <option value="esp">Electrostatic Potential (ESP)</option>
      </VSel>
      {renderFollowGeneral(cat, 'surfaceColor', 'surface colour')}
      {custom && (
        <input type="color" value={numToHex(hex)}
          onChange={(e) => setCatStyle(cat, 'surfaceColorHex', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border border-slate-300 cursor-pointer" title="Colour of the whole surface of this menu" />
      )}
    </VRow>
  );
};

// ↺ of ONE menu: it follows the GENERAL look again — every look field of this
// menu takes the general value and stops overriding it, so the radius / colour it
// shows is the general one and it keeps following future general changes. The
// styles themselves are never touched (only colours and radii are).
const resetCatLook = (cat) => setCatStyles((prev) => adoptGeneralLook(prev, cat, generalLook));

/* The little ↺ of ONE FIELD of ONE menu: it hands that field back to the general
   look (and only exists while the menu really overrides it — a field that follows
   the general row is marked « · General » instead, so the state of every field is
   readable at a glance). ONE implementation, used by the radii, the atom colour
   and the surface colour of all six menus. */
const renderFollowGeneral = (cat, key, label) => (
  followsGeneral(cat, key)
    ? (
      <span className="text-[10px] font-bold text-slate-400"
        title={`This menu follows the general ${label} (the ⚙ General look row of §2)`}>
        · General
      </span>
    )
    : (
      <button type="button" onClick={() => followGeneralLook(cat, key)}
        className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-500 hover:bg-slate-100"
        title={`This menu overrides the general ${label} — click to follow the general look again`}>
        ↺ General
      </button>
    )
);

// The 🎨 button of a menu — ONE implementation, three panels: menu A opens the
// protein panel (2° structure + highlights), menu B its nucleic-acid one
// (phosphate / pentose / bases) and menu C the lipid one (headgroup / glycerol
// backbone / acyl chains).
const renderColoursButton = (cat) => {
  const open = cat === 'nucleic' ? showNucleicColoursPanel
    : cat === 'lipid' ? showLipidColoursPanel
      : showColoursPanel;
  const toggle = cat === 'nucleic' ? () => setShowNucleicColoursPanel((v) => !v)
    : cat === 'lipid' ? () => setShowLipidColoursPanel((v) => !v)
      : () => setShowColoursPanel((v) => !v);
  const title = cat === 'nucleic'
    ? 'Colours of the NUCLEIC ACID itself: phosphate backbone · pentose rings · bases. The panel opens at the end of « 2 · Molecular Styling », and its switch colours every nucleic representation by those three chemical groups.'
    : cat === 'lipid'
      ? 'Colours of the LIPID itself: headgroup · glycerol backbone · acyl chains. The panel opens at the end of « 2 · Molecular Styling », and its switch colours every lipid representation by those three chemical parts (the headgroup is everything that is neither a chain nor the backbone).'
      : 'Secondary-structure colours (helix / sheet / loop) and the highlight colours — the full panel opens at the end of « 2 · Molecular Styling ».';
  return (
    <button type="button" onClick={toggle}
      className={`px-2 py-1 text-[10px] font-bold rounded border ${open ? 'bg-rose-100 border-rose-400 text-rose-900' : 'bg-white border-rose-300 text-rose-700 hover:bg-rose-50'}`}
      title={title}>
      🎨 {open ? 'Hide colours' : 'Colours…'}
    </button>
  );
};

/* ── ⚙️ SETUP — save / load the whole visualisation setup ────────────────────
   A setup is EVERY setting that makes the picture what it is: the six menus (their
   styles, their sphere / bond radii, their atom and surface colours, the nucleic
   group colours), the three 3D-label switches of each menu, the side-chain style,
   the 2°-structure colours, the two highlight colours, Fog, Shadows (with darkness
   and light direction), Clipping, the background colour, the quality flag and the
   lightweight style of a large system. It is kept under a NAME in localStorage,
   exportable as a .json file and readable anywhere — applyViewerSetup merges every
   field over the defaults, so a file written by another build can never break the
   viewer, and the whole thing is a styling gesture (it leaves the lightweight
   layout of a large system so the menus really apply). */
const captureViewerSetup = () => ({
  v: VIEWER_SETUP_VERSION,
  catStyles,
  catLabels,
  sidechainStyle,
  sstrucColors,
  selectedResidueColor,
  assignedAtomColor,
  fog: fogEnabled,
  shadows: { on: shadowOn, darkness: shadowDarkness, az: shadowAz, el: shadowEl },
  clip: { on: clipOn, near: clipNear, far: clipFar, dist: clipDist },
  background: bgColor,
  quality: qualityHigh,
  large: { style: largeStyle, water: showLargeWater },
  // The ⚙ settings wheel belongs to « the whole visualisation setup » too: the two
  // palettes and the general look travel with a saved setup (they are validated on
  // the way back in, like every other field of the file).
  generalLook,
  palettes: {
    elements: elementColors,
    sugars: sugarColors,
    nucleicForms: nucleicFormColors,
    nucleicMotifs: nucleicMotifColors,
    chains: chainColors,
  },
  savedAt: new Date().toISOString(),
});

const applyViewerSetup = (s) => {
  if (!s || typeof s !== 'object') return false;
  leaveLightMode();
  const nextStyles = cloneCatStyles();
  CAT_STYLE_CATS.forEach((c) => {
    nextStyles[c] = { ...nextStyles[c], ...((s.catStyles && s.catStyles[c]) || {}) };
  });
  setCatStyles(nextStyles);
  const nextLabels = {};
  CAT_STYLE_CATS.forEach((c) => {
    nextLabels[c] = { ...CAT_LABEL_DEFAULTS, ...((s.catLabels && s.catLabels[c]) || {}) };
  });
  setCatLabels(nextLabels);
  saveCatLabels(nextLabels);
  if (typeof s.sidechainStyle === 'string') setSidechainStyle(s.sidechainStyle);
  if (s.sstrucColors && typeof s.sstrucColors === 'object') setSstrucColors((c) => ({ ...c, ...s.sstrucColors }));
  if (Number.isFinite(s.selectedResidueColor)) setSelectedResidueColor(s.selectedResidueColor);
  if (Number.isFinite(s.assignedAtomColor)) setAssignedAtomColor(s.assignedAtomColor);
  if (typeof s.fog === 'boolean') setFogEnabled(s.fog);
  const sh = s.shadows || {};
  if (typeof sh.on === 'boolean') setShadowOn(sh.on);
  if (Number.isFinite(sh.darkness)) setShadowDarkness(sh.darkness);
  if (Number.isFinite(sh.az)) setShadowAz(sh.az);
  if (Number.isFinite(sh.el)) setShadowEl(sh.el);
  const cl = s.clip || {};
  if (typeof cl.on === 'boolean') setClipOn(cl.on);
  if (Number.isFinite(cl.near)) setClipNear(cl.near);
  if (Number.isFinite(cl.far)) setClipFar(cl.far);
  if (Number.isFinite(cl.dist)) setClipDist(cl.dist);
  if (typeof s.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.background)) setBgColor(s.background);
  if (typeof s.quality === 'boolean') setQualityHigh(s.quality);
  const lg = s.large || {};
  if (typeof lg.style === 'string') setLargeStyle(lg.style);
  if (typeof lg.water === 'boolean') setShowLargeWater(lg.water);
  // ⚙ The settings wheel: the two palettes (validated by mergePalette, so an
  // unknown key or a non-colour is simply ignored) and the general look.
  const pal = s.palettes || {};
  if (pal.elements) setElementColors((p) => mergePalette(ELEMENT_COLOR_PALETTE, { ...p, ...pal.elements }));
  if (pal.sugars) setSugarColors((p) => mergePalette(SUGAR_IDENTITY_COLORS, { ...p, ...pal.sugars }));
  if (pal.chains) setChainColors((p) => mergePalette(CHAIN_COLOR_PALETTE, { ...p, ...pal.chains }));
  if (pal.nucleicForms) setNucleicFormColors((p) => mergePalette(DEFAULT_NUCLEIC_FORM_COLORS, { ...p, ...pal.nucleicForms }));
  if (pal.nucleicMotifs) setNucleicMotifColors((p) => mergePalette(DEFAULT_NUCLEIC_MOTIF_COLORS, { ...p, ...pal.nucleicMotifs }));
  if (s.generalLook && typeof s.generalLook === 'object') {
    setGeneralLook((prev) => {
      const next = { ...prev };
      LOOK_KEYS.forEach((k) => {
        const v = s.generalLook[k];
        if (typeof v === 'string' || Number.isFinite(v)) next[k] = v;
      });
      return next;
    });
  }
  return true;
};

// Feedback line of the ⚙️ panel (clears itself after a few seconds).
const flashSetupMsg = (m) => {
  setSetupMsg(m);
  clearTimeout(setupMsgTimerRef.current);
  setupMsgTimerRef.current = setTimeout(() => setSetupMsg(''), 4000);
};
// 💾 Save the setup currently on screen under the typed name (or « Setup n »).
const saveCurrentSetup = () => {
  const name = String(setupName || '').trim() || `Setup ${Object.keys(viewerSetups).length + 1}`;
  const next = { ...viewerSetups, [name]: captureViewerSetup() };
  setViewerSetups(next);
  saveViewerSetups(next);
  setSetupName(name);
  flashSetupMsg(`✓ “${name}” saved`);
};
const loadSetup = (name) => {
  const s = viewerSetups[name];
  if (!s) { flashSetupMsg('no such setup'); return; }
  applyViewerSetup(s);
  setSetupName(name);
  flashSetupMsg(`✓ “${name}” applied`);
};
const deleteSetup = (name) => {
  const next = { ...viewerSetups };
  delete next[name];
  setViewerSetups(next);
  saveViewerSetups(next);
  flashSetupMsg(`“${name}” deleted`);
};
// ⬇ Export as a .json file — re-importable on another page / another computer.
const exportSetup = (name) => {
  const s = viewerSetups[name];
  if (!s) { flashSetupMsg('no such setup'); return; }
  try {
    const blob = new Blob([JSON.stringify({ name, setup: s }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `viewer-setup-${name.replace(/[^\w.-]+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashSetupMsg(`✓ “${name}” exported`);
  } catch { flashSetupMsg('export failed'); }
};
// ⬆ Import a setup file: the name inside the file wins, and the setup is applied
// at once so the effect is visible. A file from another build is accepted (every
// field is merged over the defaults by applyViewerSetup).
const importSetupFile = (file) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result || ''));
      const s = raw && raw.setup ? raw.setup : raw;
      if (!s || typeof s !== 'object' || !s.catStyles) throw new Error('not a viewer setup');
      const name = String((raw && raw.name) || file.name.replace(/\.json$/i, '')).trim() || 'Imported setup';
      const next = { ...viewerSetups, [name]: s };
      setViewerSetups(next);
      saveViewerSetups(next);
      applyViewerSetup(s);
      setSetupName(name);
      flashSetupMsg(`✓ “${name}” imported and applied`);
    } catch (err) {
      flashSetupMsg(`import failed: ${(err && err.message) || 'bad file'}`);
    }
  };
  reader.onerror = () => flashSetupMsg('import failed: could not read the file');
  reader.readAsText(file);
};

// A swatch of the 🔬 nucleic-acid panel: it sets the colour AND switches « Colour
// by chemical group » ON, so the choice is never invisible (same rule as the ESP
// choice switching its surface on). ↺ puts the three group colours back.
const setNucleicColour = (key, hex) => setCatStyles((prev) => ({
  ...prev,
  nucleic: { ...(prev.nucleic || {}), [key]: hex, groupColour: true },
}));
// ⚠️ The three colours are stored under their « …Color » keys, so the reset must
// write those: spreading DEFAULT_NUCLEIC_COLORS alone (its keys are the palette
// names phosphate / pentose / base) added three useless keys and left the
// swatches exactly where they were.
const resetNucleicColours = () => setCatStyles((prev) => ({
  ...prev,
  nucleic: {
    ...(prev.nucleic || {}),
    phosphateColor: DEFAULT_NUCLEIC_COLORS.phosphate,
    pentoseColor: DEFAULT_NUCLEIC_COLORS.pentose,
    baseColor: DEFAULT_NUCLEIC_COLORS.base,
    // …and the RING PLATES of « Stylized rings » back to per-base colours, solid.
    ringColour: 'base',
    ringColorHex: DEFAULT_NUCLEIC_COLORS.base,
    ringTransparency: RING_TRANSPARENCY_DEFAULT,
  },
}));
// The 🎨 panel of menu A (proteins): a swatch writes the colour AND switches the
// menu to « Secondary structure », so the ribbon AND the atoms really take it.
// BEFORE this, moving a swatch only changed a colour that the classic rendering
// (rainbow by residue) never used — which is exactly why a custom helix / sheet /
// loop colour looked IGNORED in the ribbons.
const setSstrucColour = (key, hex) => {
  leaveLightMode();   // it changes what is drawn, not only a colour
  setSstrucColors((c) => ({ ...c, [key]: hex }));
  setCatStyles((prev) => ({ ...prev, protein: { ...(prev.protein || {}), atomColor: 'sstruc' } }));
};
// The FILLED PLATES of « Stylized rings » — their ONE colour, their transparency
// and the ribose ring plate. Each of them switches the Bases style to « Stylized
// rings », because a ring setting on a menu that draws no ring would be invisible
// (same rule as a swatch switching « Colour by chemical group » on).
const setRingPlate = (patch) => {
  leaveLightMode();   // the plates ARE a rendering choice
  setCatStyles((prev) => ({
    ...prev,
    nucleic: { ...(prev.nucleic || {}), bases: 'rings', ...patch },
  }));
};
// The same pair for the 🧫 Lipids menu (C): a swatch switches « Colour by chemical
// part » ON — the choice is never invisible — and ↺ puts the three parts back.
const setLipidColour = (key, hex) => setCatStyles((prev) => ({
  ...prev,
  lipid: { ...(prev.lipid || {}), [key]: hex, groupColour: true },
}));
const resetLipidColours = () => setCatStyles((prev) => ({
  ...prev,
  lipid: {
    ...(prev.lipid || {}),
    headColor: DEFAULT_LIPID_COLORS.head,
    glycerolColor: DEFAULT_LIPID_COLORS.glycerol,
    tailColor: DEFAULT_LIPID_COLORS.acyl,
  },
}));

return (
<div className="flex flex-col gap-2">

{/* ══ 0 · WINDOW — « ⬇ Minimize » alone at the very top ═════════════════════
    The control that shrinks the viewer's footprint stands on its own row,
    above every other control: it is about the WINDOW itself, not about the
    molecule. The floating ▼ inside the viewport (and the « viewer minimized »
    bar) still do the same thing, so the button is never out of reach. */}
<div className="flex items-center justify-end gap-2">
  <button
    type="button"
    onClick={() => setViewerCollapsed((v) => !v)}
    title={viewerCollapsed ? 'Restore the 3D viewer window' : 'Retract (minimize) the 3D viewer window — the structure stays loaded, only the tall canvas collapses to a thin bar'}
    className={`text-xs font-bold px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap ${viewerCollapsed ? 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}
  >
    {viewerCollapsed ? '⬆ Expand viewer' : '⬇ Minimize viewer'}
  </button>
</div>

{/* ══ 1 · GENERAL — what gets loaded / cleared and the figure ════════════════ */}
<VSection title="1 · General" hint="structure · trajectory · clear · figure">
<label
title="Load structure file(s) from your computer — the first is the main structure, the rest appear in the Molecules bar (right side, multi-select)"
className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold px-2 py-1 rounded-md text-[11px] shadow-sm transition-colors inline-flex items-center gap-1 h-7"
>
📂 PDB file(s)
<input
type="file"
accept=".pdb,.gro,.cif,.bcif,.ent,.mol2,.sdf"
multiple
onChange={handleFileChange}
className="hidden"
/>
</label>
<div className="flex items-center gap-1">
<input
type="text"
value={pdbId}
onChange={(e) => setPdbId(e.target.value)}
onKeyDown={(e) => {
if (e.key === 'Enter') handlePdbIdLoad();
}}
placeholder="PDB ID or URL"
title="Load from a PDB ID (e.g. 1TUP), rcsb: or a plain https URL"
className="border border-slate-300 rounded-md px-2 py-1 text-[11px] w-28 bg-white outline-none focus:border-blue-500 font-mono h-7"
/>
<button
type="button"
onClick={handlePdbIdLoad}
className="bg-slate-600 hover:bg-slate-700 text-white font-bold px-2 py-1 rounded-md text-[11px] shadow-sm transition-colors h-7"
>
Load
</button>
</div>
{file && (
<span title={file.name} className="text-[10px] text-slate-500 max-w-[120px] truncate">
{file.name}
</span>
)}
<label
title="Load a trajectory (XTC/TRR/DCD) to animate the structure"
className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1 rounded-md text-[11px] shadow-sm transition-colors inline-flex items-center gap-1 h-7"
>
📂 Trajectory
<input
type="file"
accept=".xtc,.trr,.dcd"
onChange={(e) => {
const f = e.target.files && e.target.files[0];
if (f) handleTrajFileChosen(f);
e.target.value = '';
}}
className="hidden"
/>
</label>
{(trajFile || trajectoryFile) && (
<span title={(trajFile || trajectoryFile).name} className="text-[10px] text-slate-500 max-w-[110px] truncate">
{(trajFile || trajectoryFile).name}
</span>
)}
{/* ⬇ PDB — the structure as a file, with the coordinates of the frame the
    ▶ playback bar is displaying right now (a trajectory snapshot); without a
    trajectory it simply saves the loaded structure. See downloadFramePdb. */}
<button
type="button"
onClick={downloadFramePdb}
disabled={status !== 'ready'}
title={trajStatus === 'ready'
  ? `Download a PDB file of the frame displayed right now (frame ${toActualFrame(currentFrame)} of ${numFrames}) — the structure's own names / residues / chains with the coordinates of that snapshot`
  : 'Download the loaded structure as a PDB file (load a trajectory to save the frame on screen instead)'}
className="px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap bg-white border-teal-300 text-teal-700 hover:bg-teal-50 disabled:opacity-40 disabled:cursor-not-allowed"
>
⬇ PDB{trajStatus === 'ready' ? ' (frame)' : ''}
</button>
{pdbMsg && (
<span className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-2 py-1 max-w-[320px] truncate" title={pdbMsg}>{pdbMsg}</span>
)}
{(file || residueTicks.length > 0 || extraMols.length > 0 || trajFile || trajectoryFile || status === 'ready' || status === 'loading' || status === 'error') && (
<button
type="button"
onClick={handleClearViewer}
title="Empty the viewer completely (remove all molecules, the sequence strip and any trajectory) so you can load a fresh molecule"
className="px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 bg-white border-red-300 text-red-600 hover:bg-red-50 whitespace-nowrap"
>
🗑 Clear
</button>
)}
{/* 🗑 Delete PDB / ↩ Restore PDB — ONE button, two states: it removes the PDB
    loaded in THIS section (nothing else: the trajectory goes with it) and, once
    the PDB is aside, it brings it back EXACTLY as it was. Deleting a PDB when a
    sequence is typed on the page shows the structure built from that sequence
    instead — the usual « I want the model, not the PDB » gesture. */}
{pdbAsideVisible && (
<button
type="button"
onClick={pdbAsideIsRestore ? restoreStashedPdb : deleteLoadedPdb}
title={pdbAsideIsRestore
  ? `Bring back ${(stashedPdb && stashedPdb.name) || 'the PDB'} that was deleted — the file / URL / model is loaded again, with the trajectory it had.`
  : 'Remove the PDB loaded in this section (nothing is lost: the button then says ↩ Restore PDB and brings it back as it was). If a sequence is typed on the page, its own structure is shown in the meantime.'}
className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${pdbAsideIsRestore ? 'bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'bg-white border-red-300 text-red-600 hover:bg-red-50'}`}
>
{pdbAsideIsRestore ? '↩ Restore PDB' : '🗑 Delete PDB'}
</button>
)}
{structAsideMsg && (
<span className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 max-w-[380px] truncate" title={structAsideMsg}>{structAsideMsg}</span>
)}
<button
type="button"
onClick={captureScene}
title="Save the current 3D view as a figure — it goes to the Figures library (Publications → Figures & Slides)"
className="px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap bg-white border-indigo-300 text-indigo-600 hover:bg-indigo-50"
>
📷 Figure
</button>
{captureMsg && (
<span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1">{captureMsg}</span>
)}
{/* ⚙️ SETUP — save / load the WHOLE visualisation setup under a name (see
    captureViewerSetup): the six menus with their radii, colours and group
    colours, the 3D-label switches, the side-chain style, the 2°-structure and
    highlight colours, Fog / Shadows / Clipping / Background / quality and the
    lightweight style of a large system. Stored in localStorage (listable,
    loadable, deletable) and exportable / importable as a .json file, so a look
    can be reused on another page or another computer. */}
<button type="button" onClick={() => setShowSetupPanel((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${showSetupPanel ? 'bg-teal-100 border-teal-400 text-teal-900' : 'bg-white border-teal-300 text-teal-700 hover:bg-teal-50'}`}
  title={Object.keys(viewerSetups).length
    ? `Save / load the visualisation setup — ${Object.keys(viewerSetups).length} setup(s) saved: ${Object.keys(viewerSetups).join(' · ')}`
    : 'Save the whole visualisation setup (styles of the six menus, their sphere / bond radius and colours, the nucleic-acid group colours, the labels, Fog / Shadows / Clipping / Background, the ligand / water styles…) under a name, and load it back later — or export it as a .json file'}>
  ⚙️ Setup{Object.keys(viewerSetups).length ? ` (${Object.keys(viewerSetups).length})` : ''}
</button>
{setupMsg && (
<span className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-2 py-1">{setupMsg}</span>
)}
{showSetupPanel && (
<div className="w-full bg-teal-50/50 border border-teal-200 rounded-lg px-2 py-2 flex flex-wrap items-center gap-2">
  <span className="text-[10px] font-black text-teal-800 uppercase tracking-wide whitespace-nowrap">Visualisation setup</span>
  <input value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="Setup name"
    title="Name of the setup — 💾 saves the CURRENT look under this name (an existing name is overwritten)"
    className="border border-teal-300 rounded-md px-1.5 py-1 text-[11px] bg-white outline-none focus:border-teal-500 h-7 w-40" />
  <button type="button" onClick={saveCurrentSetup}
    className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-teal-400 text-teal-800 hover:bg-teal-100 h-7"
    title="Save the setup currently on screen under this name">
    💾 Save
  </button>
  <select value="" onChange={(e) => { if (e.target.value) loadSetup(e.target.value); }}
    title="Load a saved setup — it replaces the current styles, colours, radii and scene settings"
    className="border border-teal-300 rounded-md px-1.5 py-1 text-[11px] bg-white outline-none focus:border-teal-500 h-7 w-40">
    <option value="">📂 Load…</option>
    {Object.keys(viewerSetups).sort().map((n) => <option key={n} value={n}>{n}</option>)}
  </select>
  <button type="button"
    onClick={() => (viewerSetups[setupName] ? deleteSetup(setupName) : flashSetupMsg('type the name of the setup to delete'))}
    className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-red-300 text-red-600 hover:bg-red-50 h-7"
    title="Delete the setup whose name is written on the left">
    🗑 Delete
  </button>
  <button type="button"
    onClick={() => (viewerSetups[setupName] ? exportSetup(setupName) : flashSetupMsg('type the name of the setup to export'))}
    className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-teal-300 text-teal-700 hover:bg-teal-100 h-7"
    title="Download this setup as a .json file — it can be imported on another page or another computer">
    ⬇ Export
  </button>
  <label className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-teal-300 text-teal-700 hover:bg-teal-100 h-7 flex items-center gap-1 cursor-pointer"
    title="Import a setup .json file — it is saved under the name it carries and applied at once">
    ⬆ Import
    <input type="file" accept=".json,application/json" className="hidden"
      onChange={(e) => { importSetupFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
  </label>
  <span className="text-[10px] text-slate-500 italic">
    {Object.keys(viewerSetups).length
      ? `saved: ${Object.keys(viewerSetups).sort().join(' · ')} — ⬇ exports the one named on the left`
      : 'no setup saved yet — type a name and press 💾 Save'}
  </span>
</div>
)}
</VSection>

{/* ══ 2 · THE VIEWER TOOLS OF §2 ═════════════════════════════════════════════
   The styling itself is NOT here any more: it lives in the MOLECULE STYLING BAR
   on the right of the canvas (PART 4) — one space per loaded molecule, each with
   the Style / « Color by » / Transparency commands of its own kind, its two radii
   and its 3D labels. What remains in this row is what belongs to the SCENE as a
   whole: « 🙈 Hide everything », the ⚡ electrostatic-potential overlay of the
   selected molecule (with its kcal/mol range) and the 🔢 renumbering tool. The 🎨
   colour panels are GONE — every palette is edited in the ⚙ settings wheel of the
   styling bar, which is exactly where the colourings read them from.
   NOTE: this comment MUST stay inside the braces of a JSX comment. Written as a
   bare block comment between two elements it is NOT a comment for JSX: it is TEXT,
   and the whole paragraph was rendered in the middle of the viewer. */}
<section className="flex flex-col gap-1 bg-slate-50/80 border border-slate-200 rounded-lg px-1.5 py-1">
<button
type="button"
onClick={() => setStylingOpen((v) => !v)}
aria-expanded={stylingOpen}
title={stylingOpen ? 'Collapse the molecular-styling menus — the current styles stay applied' : 'Expand the molecular-styling menus (one per molecule category: proteins · nucleic acids · lipids · sugars · ligands · solvent)'}
className={`w-full flex flex-wrap items-center gap-2 text-left transition-colors ${stylingOpen ? 'text-blue-800' : 'text-slate-700 hover:text-blue-800'}`}
>
<span className="text-[9px] font-bold text-slate-500 truncate flex-1">
{`The styling of every molecule lives in the bar on the right of the canvas — one space per molecule: ${Object.keys(sectionCatalog).length} space(s)${anyLabelOn ? ' · 3D labels on' : ''}${hasNonProtein ? ' · this file also contains ligands / lipids / sugars / ions / water' : ''}`}
</span>
<span className="text-[9px] font-black uppercase tracking-wide text-slate-400 shrink-0">{stylingOpen ? '▲ collapse' : '▼ expand'}</span>
</button>
{stylingOpen && (
<div className="flex flex-wrap items-center gap-1">

{/* 🙈 Hide everything — one click removes every representation (base, side
    chains, selections, ESP); 👁️ Show default rebuilds them from the menus. */}
<button type="button" onClick={() => setHideAll((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${hideAll ? 'bg-red-100 border-red-400 text-red-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="Hide every representation of the whole scene (all molecules, side chains, selections, ESP surfaces). Click again to restore them exactly as the styling menus describe.">
  {hideAll ? '👁️ Show default' : '🙈 Hide everything'}
</button>

{/* ── end of the A–F grid ───────────────────────────────────────────────── */}

<button
type="button"
onClick={() => espToggle(selectedMolKey)}
disabled={!espTargetComp}
title={espBtnTitle}
className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${espOnSelected ? 'bg-fuchsia-100 border-fuchsia-400 text-fuchsia-800 hover:bg-fuchsia-200' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
>
{espOnSelected ? '⚡ ESP: On' : '⚡ ESP'}
</button>
{(espOnSelected || catEspActive) && (
  <div className="flex items-center gap-1.5 bg-white border border-fuchsia-200 rounded-lg px-2 py-1 text-[10px] text-slate-600 h-8 whitespace-nowrap" title="Electrostatic colour-scale limits in kcal/mol. Surface potentials at or below −N are drawn full RED (negative), 0 is white (neutral) and at or above +P full BLUE (positive). NGL's default ±50 is so wide that most surfaces look white — tighten the range to make the red and blue poles visible. Applies live (no surface rebuild) via Apply / Enter.">
    <span className="font-black text-fuchsia-700 uppercase tracking-wide">⚡ Range</span>
    <span className="font-bold text-red-600">−</span>
    <input
      type="number"
      min="0.5"
      max="500"
      step="1"
      value={Math.round(espLimits[0] * 10) / 10}
      onChange={(e) => { const v = parseFloat(e.target.value); setEspLimits((p) => [Number.isFinite(v) && v > 0 ? Math.min(500, v) : p[0], p[1]]); }}
      onKeyDown={espApplyLimitsOnEnter}
      className="w-12 border border-slate-300 rounded px-1 py-0.5 text-right outline-none focus:border-fuchsia-400 text-[10px] font-mono"
      aria-label="Negative ESP limit (red)"
    />
    <span className="text-slate-400 font-bold">0</span>
    <span className="font-bold text-blue-600">+</span>
    <input
      type="number"
      min="0.5"
      max="500"
      step="1"
      value={Math.round(espLimits[1] * 10) / 10}
      onChange={(e) => { const v = parseFloat(e.target.value); setEspLimits((p) => [p[0], Number.isFinite(v) && v > 0 ? Math.min(500, v) : p[1]]); }}
      onKeyDown={espApplyLimitsOnEnter}
      className="w-12 border border-slate-300 rounded px-1 py-0.5 text-right outline-none focus:border-fuchsia-400 text-[10px] font-mono"
      aria-label="Positive ESP limit (blue)"
    />
    <span>kcal/mol</span>
    <button type="button" onClick={() => espApplyLimits()} className="px-1.5 py-0.5 rounded border bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700 hover:bg-fuchsia-100 font-bold">Apply</button>
    <button type="button" onClick={() => espApplyLimits(10, 10)} className="px-1.5 py-0.5 rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold" title="Preset: red ≤ −10, blue ≥ +10 kcal/mol">±10</button>
    <button type="button" onClick={() => espApplyLimits(25, 25)} className="px-1.5 py-0.5 rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold" title="Preset: red ≤ −25, blue ≥ +25 kcal/mol">±25</button>
    <button type="button" onClick={() => espApplyLimits(50, 50)} className="px-1.5 py-0.5 rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold" title="NGL's original wide range ±50 — only the strongest charges reach red/blue">±50</button>
  </div>
)}

{captureMsg && (
<span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1">{captureMsg}</span>
)}

{/* Residue renumbering */}
<div className="flex flex-col gap-1">
<button
type="button"
onClick={toggleRenumberPanel}
title="🔢 Renumber the residues (the panel below lists every residue and the number it will take; the 3D labels and the residue strip follow it)"
className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-md px-2 py-1.5 h-8 whitespace-nowrap"
>
🔢 Renumber{showRenumberPanel ? ' ▲' : ' ▼'}
</button>
{/* The ONE renumbering panel of the viewer (see renderRenumberPanel) — the same
    specification the 🔢 of a molecule's header opens. */}
{renderRenumberPanel()}
</div>
</div>
)}
</section>

{/* ══ 3 · TOOLBAR — Scene | Modify | Analysis | PyMOL, ONE horizontal row ════
    The four groups that used to be four stacked sections (§3 / §5 / §6 / §7 —
    and the old §4 Labels row, whose three switches now live inside each
    molecule menu) are ONE wrapped row, each group introduced by a small chip and
    separated by a hairline. The expanded panels (✏️ Atom names, 🧪 PyMOL, the
    clipping sliders) are full-width children of this same section, so the bar
    stays one row tall while nothing is open.
    • Scene: 🌫 Fog · 🎨 Background · ◐ Shadows (+ 🌑 Darkness / 💡 Light) · ✂ Clipping
    • Modify: ✋ Drag · ⚗️ Rebuild H · ✏️ Atom names
    • Analysis: 📏 Measure · 🟢 Assigned
    • PyMOL: 🧪 Selections & PyMOL
    The lighting rig is untouched: Shadows locks NGL's single light in place and
    the Darkness / Light sliders aim it (and now also drive the AMBIENT-OCCLUSION
    equivalent, see applyShadowSettings). ✂ Clipping pushed OFF sets the camera
    bounds to the EXTREMES (near 0 · far 100000 · dist 0) so a large complex is
    never cut. */}
<VSection title="3 · Toolbar" hint="scene · modify · analysis · PyMOL">
<span className="text-[9px] font-black text-sky-700 uppercase tracking-wide whitespace-nowrap">🌫 Scene</span>
<button type="button" onClick={() => setFogEnabled((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 ${fogEnabled ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="NGL's default depth fog fades distant atoms toward the background (a grey haze). Toggle it off for a crisp image — the setting is saved and persists across pages.">
  🌫 Fog: {fogEnabled ? 'On' : 'Off'}
</button>
{/* 🎨 BACKGROUND — the colour of the 3D scene itself (§3 Scene). It is applied to
    the live stage (stage.setParameters({ backgroundColor })), persists like the
    fog / shadows / clipping, and travels inside a ⚙️ saved setup. The 🧪 PyMOL
    panel writes this very same state, so the two entries never disagree. */}
<label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 whitespace-nowrap" title="Background colour of the 3D scene — the colour the depth fog fades toward. Saved and persistent across pages, and part of a ⚙️ setup.">
  🎨 Background
  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
    className="w-8 h-6 border border-slate-300 rounded cursor-pointer" aria-label="Background colour" />
</label>
<button type="button" onClick={() => setBgColor(BG_DEFAULT)}
  className="px-1.5 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
  title={`Back to the default background (${BG_DEFAULT})`}>
  ↺
</button>
<button type="button" onClick={() => setShadowOn((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 ${shadowOn ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="Shadows: swaps NGL's flat camera-lit look for ONE fixed key light whose direction you aim (Azimuth / Elevation appear while ON), so every side of the structure that turns away from the light falls into real shade as you rotate. The Darkness slider then only raises the dark↔light contrast — the light stays pure white, so colours are never tinted. Shadows also switches on the AMBIENT-OCCLUSION equivalent: NGL 2.4 has no SSAO pass, so the cavity shading comes from the deep-ambient + strong-key-light rig with supersampled shading (sampleLevel), which is what makes crevices and the inner sides of a fold read as depth. (True WebGL shadow maps aren't supported by NGL — trying them made the molecule disappear. Every mesh is still flagged cast+receive shadows, see flagMeshShadows.)">
  ◐ Shadows: {shadowOn ? 'On' : 'Off'}
</button>
{shadowOn && (
  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 whitespace-nowrap" title="Darkness — contrast only: the lit side gets brighter and the shaded side darker, with no colour change (the key light is pure white and only the light/ambient INTENSITIES move). This is also what deepens the ambient-occlusion-like cavity shading.">
    🌑 Darkness
    <input type="range" min="0" max="100" value={Math.round(shadowDarkness * 100)} onChange={(e) => setShadowDarkness(Number(e.target.value) / 100)} className="w-20 accent-slate-700" />
    <span className="text-[10px] text-slate-500 w-8">{Math.round(shadowDarkness * 100)}%</span>
  </label>
)}
{shadowOn && (
  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 whitespace-nowrap" title="Light direction — aim the fixed key light (and therefore where the shadows fall). Azimuth 0° = light behind the camera (flat), 90° = screen-left, 180° = facing the camera; Elevation is the height above/below the horizon. The shade follows live while you drag.">
    💡 Light
    <input type="range" min="0" max="360" value={shadowAz} onChange={(e) => setShadowAz(Number(e.target.value))} className="w-16 accent-slate-700" aria-label="Light azimuth" />
    <span className="text-[10px] text-slate-500 w-8">{shadowAz}°</span>
    <span className="text-slate-400">/</span>
    <input type="range" min="-90" max="90" value={shadowEl} onChange={(e) => setShadowEl(Number(e.target.value))} className="w-16 accent-slate-700" aria-label="Light elevation" />
    <span className="text-[10px] text-slate-500 w-8">{shadowEl}°</span>
  </label>
)}
<button type="button" onClick={() => setClipOn((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${clipOn ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="Clipping plane. NGL clips the scene with the camera near / far planes: clipNear / clipFar are percentages of the scene bounding sphere and clipDist is the closest the near plane may come to the camera — exactly what CUTS a big complex when you zoom in. OFF = the camera bounds are pushed to the EXTREMES (near 0 · far 100000 · dist 0), so nothing is ever cut at any zoom. ON = your own values below.">
  ✂ Clipping: {clipOn ? 'On' : 'Off'}
</button>
{clipOn && (
  <>
    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 whitespace-nowrap" title="clipNear — how much is cut in FRONT of the molecule, as a percentage of the bounding sphere. 0 cuts nothing (the near plane sits on the front edge of the sphere); positive values bring the near plane closer to the molecule.">
      near
      <input type="range" min="-50" max="50" step="1" value={clipNear} onChange={(e) => setClipNear(Number(e.target.value))} className="w-20 accent-emerald-600" aria-label="Clipping near" />
      <span className="text-[10px] text-slate-500 w-10">{clipNear}%</span>
    </label>
    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 whitespace-nowrap" title="clipFar — how far BEHIND the molecule the far plane sits, as a percentage of the bounding sphere. 50 = the centre of the sphere, 100 = its back edge, 150 = one radius further; « Off » uses 100000 (effectively infinite).">
      far
      <input type="range" min="50" max="150" step="1" value={clipFar} onChange={(e) => setClipFar(Number(e.target.value))} className="w-20 accent-emerald-600" aria-label="Clipping far" />
      <span className="text-[10px] text-slate-500 w-10">{clipFar}%</span>
    </label>
    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-700 whitespace-nowrap" title="clipDist — the MINIMUM distance (Å) between the camera and the near plane. NGL floors the near plane with it, which is what cuts a large complex when you zoom in: 0 removes the floor completely (that is what « Off » uses).">
      cam. near
      <input type="range" min="0" max="30" step="0.1" value={clipDist} onChange={(e) => setClipDist(Math.max(0, Number(e.target.value)))} className="w-20 accent-emerald-600" aria-label="Clipping camera distance" />
      <span className="text-[10px] text-slate-500 w-12">{clipDist} Å</span>
    </label>
    <button type="button"
      onClick={() => { setClipNear(CLIP_DEFAULTS.near); setClipFar(CLIP_DEFAULTS.far); setClipDist(CLIP_DEFAULTS.dist); }}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      title="Back to the « no cut » extremes: clipNear 0 · clipFar 100000 · clipDist 0 Å">
      ↺ No cut (0 · 100000 · 0 Å)
    </button>
  </>
)}
{/* ── Modify ─────────────────────────────────────────────────────────────── */}
<span className="w-px h-6 bg-slate-200 shrink-0" aria-hidden="true" />
<span className="text-[9px] font-black text-amber-700 uppercase tracking-wide whitespace-nowrap">✏️ Modify</span>
{/* 🧬 From sequence — the page's sequence (Proteins / DNA / RNA) becomes a 3D
    structure at any moment, even over a loaded PDB (which is put aside: the
    ↩ Restore PDB button of §1 General brings it back). No network round trip:
    the page builds the backbone from the sequence and the secondary structure
    painted on it. */}
<button
type="button"
onClick={buildFromSequence}
disabled={!sequenceStructureText}
title="Build the 3D structure from the sequence typed in “Molecular structure and visualization” (Proteins / DNA / RNA) — the model the viewer shows whenever no PDB is loaded. A PDB already on screen is put aside, not lost: ↩ Restore PDB (§1 General) brings it back."
className="px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed"
>
🧬 From sequence
</button>
{seqBuildMsg && (
<span title={seqBuildMsg} className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 h-7 inline-flex items-center max-w-[380px] truncate">
{seqBuildMsg}
</span>
)}
<button type="button" onClick={() => setDragMove((v) => !v)}
  disabled={status !== 'ready'}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${dragMove ? 'bg-amber-400 border-amber-500 text-amber-950' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed'}`}
  title="Move the selected structure with the mouse instead of typing X/Y/Z. When ON, dragging in the viewer slides the SELECTED structure (rotate/zoom is suspended) — one molecule at a time.">
  ✋ Drag: {dragMove ? 'On' : 'Off'}
</button>
<button
type="button"
onClick={rebuildHydrogensNow}
title="Delete every hydrogen of the peptide and re-place them with ideal bond lengths and angles (N–H ≈ 1.01 Å, C–H ≈ 1.09 Å…). All atom names are kept and no heavy atom moves — the rebuild works on generated structures and on PDB files you load with the 📂 button."
className="px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap bg-white border-slate-300 text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700"
>
⚗️ Rebuild H
</button>
{rebuildMsg && (
<span title={rebuildMsg} className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1 h-7 inline-flex items-center max-w-[380px] truncate">
{rebuildMsg}
</span>
)}

{/* ✏️ Atom names (rename) — the control of the Modify group; its panel is a
    full-width child of the toolbar so the row itself stays one line tall. */}
<button type="button" onClick={() => setShowAtomPanel((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 ${showAtomPanel ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="Rename the atoms of the 3D structure (organic molecules included): click-to-rename in the 3D view, auto-naming from the 2D formula, or edit the name list directly. The 2D formula is never touched.">
  ✏️ Atom names{Object.keys(renames).length ? ` (${Object.keys(renames).length})` : ''}
</button>
{showAtomPanel && (
  <div className="w-full bg-amber-50/40 border border-amber-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-black text-amber-700 uppercase tracking-wide">Atom names (3D only — the 2D formula is not touched)</span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setRenameMode((v) => !v)}
          className={`px-2 py-1 text-[10px] font-bold rounded border ${renameMode ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-100'}`}>
          {renameMode ? '● Click an atom…' : 'Click-to-rename'}
        </button>
        <button type="button" onClick={autoNameFrom2D} className="px-2 py-1 text-xs font-bold rounded bg-white border border-amber-300 text-amber-700 hover:bg-amber-100">Auto-name (2D)</button>
        <button type="button" onClick={clearRenames} className="px-2 py-1 text-xs font-bold rounded bg-white border border-red-300 text-red-600 hover:bg-red-50">Clear overrides</button>
      </div>
    </div>
    <p className="text-[10px] text-slate-500">
      {renameMode ? 'Click any atom in the 3D viewer, then type its new name below.' : 'Search the atom list and edit names directly. Changes are stored with the test and persist.'}
    </p>
    {renameTarget !== null && (
      <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-lg p-2">
        <span className="text-xs font-bold text-slate-700">Atom #{renameTarget}:</span>
        <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyRename(); }} className="border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-amber-500" />
        <button type="button" onClick={applyRename} className="px-2 py-1 text-xs font-bold rounded bg-amber-600 text-white">OK</button>
        <button type="button" onClick={() => setRenameTarget(null)} className="px-2 py-1 text-[10px] font-bold rounded bg-slate-200 text-slate-700">Cancel</button>
      </div>
    )}
    <div className="flex items-center gap-2">
      <input value={atomSearch} onChange={(e) => setAtomSearch(e.target.value)} placeholder="Filter atoms…" className="border border-slate-300 rounded px-2 py-1 text-xs w-44 outline-none focus:border-amber-500" />
      <span className="text-[10px] text-slate-400">{atomList.length} atoms</span>
    </div>
    <div className="max-h-48 overflow-y-auto custom-scrollbar border border-amber-200 rounded-lg bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-amber-50">
          <tr>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">#</th>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">El</th>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">Current</th>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">New name</th>
          </tr>
        </thead>
        <tbody>
          {atomList
            .filter((a) => !atomSearch || (a.name || '').toLowerCase().includes(atomSearch.toLowerCase()) || (renames[a.idx] || '').toLowerCase().includes(atomSearch.toLowerCase()))
            .slice(0, 200)
            .map((a) => (
              <tr key={a.idx} className="border-t border-amber-100">
                <td className="px-2 py-1 text-slate-400">{a.idx}</td>
                <td className="px-2 py-1 font-bold text-slate-600">{a.element}</td>
                <td className="px-2 py-1 font-mono text-slate-500">{a.name}</td>
                <td className="px-2 py-1">
                  <input value={renames[a.idx] || a.name} onChange={(e) => { const next = { ...renames }; if (e.target.value.trim()) next[a.idx] = e.target.value; else delete next[a.idx]; persistRenames(next); }} className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-amber-500" />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{/* ── Analysis ───────────────────────────────────────────────────────────── */}
<span className="w-px h-6 bg-slate-200 shrink-0" aria-hidden="true" />
<span className="text-[9px] font-black text-rose-700 uppercase tracking-wide whitespace-nowrap">📏 Analysis</span>
<button
type="button"
onClick={toggleMeasureMode}
title={measureMode ? '📏 Measure is ON — click any two atoms to draw the distance between them (shown in Å). Click again to stop measuring; drawn distances stay visible.' : 'Measure atom distances: click any two atoms to draw the distance between them, with a live label in Å (NGL distance representation).'}
className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${measureMode ? 'bg-rose-50 border-rose-400 text-rose-700 ring-1 ring-rose-200' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
>
{measureMode ? '📏 Measuring…' : '📏 Measure'}
</button>
{measureMode && (
<span title={measureInfo || 'Click two atoms to measure the distance between them'} className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1 h-7 inline-flex items-center max-w-[320px] truncate">
{measureInfo || (measurePending ? `1st atom: ${measurePending} — click the 2nd…` : 'Click two atoms…')}
</span>
)}
{(measureRepsRef.current.length > 0 || measurePending) && (
<button
type="button"
onClick={clearMeasurements}
className="px-2 py-1 text-[11px] font-bold rounded-md border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 h-7 whitespace-nowrap"
title={measurePending ? 'Cancel the pending first atom and remove all drawn distance measurements' : 'Remove all drawn distance measurements'}
>
✕ Clear distances
</button>
)}
<button
type="button"
onClick={() => setShowAssignedFlag(!showManualHighlight)}
title="Show / hide the green highlight on the atoms assigned by NMR"
className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${showManualHighlight ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
>
{showManualHighlight ? '🟢 Assigned: On' : '⚪ Assigned: Off'}
</button>

{/* ── PyMOL ──────────────────────────────────────────────────────────────── */}
<span className="w-px h-6 bg-slate-200 shrink-0" aria-hidden="true" />
<span className="text-[9px] font-black text-violet-700 uppercase tracking-wide whitespace-nowrap">🧪 PyMOL</span>
<button type="button" onClick={() => setShowPymolPanel((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 ${showPymolPanel ? 'bg-violet-100 border-violet-400 text-violet-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="Paste or load a PyMOL script (select / show / hide / color / set sphere_scale·transparency / bg_color / cartoon · ribbon · tube / surface / spectrum / util.ray_shadows). Every selection the script defines — and every look it creates on a raw expression — appears in the Selections bar on the LEFT of the 3D viewer (◀ collapses it).">
  🧪 Selections & PyMOL
</button>
{showPymolPanel && (
  <div className="w-full bg-violet-50/40 border border-violet-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-black text-violet-700 uppercase tracking-wide">Selections & PyMOL</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => applyPyMOLScript(pymolScript)} className="px-2 py-1 text-[10px] font-bold rounded bg-violet-600 text-white hover:bg-violet-700">▶ Run script</button>
        <button type="button" onClick={clearPyMOL} className="px-2 py-1 text-xs font-bold rounded bg-white border border-red-300 text-red-600 hover:bg-red-50">Clear</button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Load script</label>
      <select
        value=""
        onChange={(e) => {
          const n = e.target.value;
          e.target.value = '';
          if (!n) return;
          const entry = getPymolScripts()[n];
          if (entry) setPymolScript(typeof entry === 'string' ? entry : (entry.script || ''));
        }}
        title="Load a script saved in the Library (Library → PyMOL Scripts) into the editor, then press Run"
        className="border border-violet-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-violet-500"
      >
        <option value="">— Library scripts —</option>
        {Object.entries(getPymolScripts()).map(([n]) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <span className="text-[9px] text-slate-400">saved in <b>Library → PyMOL Scripts</b></span>
    </div>
    <label className="text-[10px] font-bold text-slate-500 uppercase">Paste a PyMOL script (select / show / hide / color / set sphere_scale·transparency·cartoon_ring_mode·cartoon_ring_color·cartoon_ring_transparency·cartoon_nucleic_acid_mode / bg_color / cartoon · ribbon · tube / surface / spectrum / util.ray_shadows)</label>
    <textarea value={pymolScript} onChange={(e) => setPymolScript(e.target.value)} rows={6}
      className="w-full border border-violet-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-violet-500 bg-white"
      placeholder={'select peptide, polymer.protein\nshow cartoon, peptide\ncolor gold, name CA and peptide\nset sphere_scale, 0.6, headgroups\nset sphere_transparency, 0.3, upper_headgroups\nbg_color white'} />
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold text-slate-500 uppercase">Effects</span>
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={autoShowSel} onChange={(e) => setAutoShowSel(e.target.checked)} className="accent-violet-600" /> Auto-show parsed selections</label>
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={qualityHigh} onChange={(e) => setQualityHigh(e.target.checked)} className="accent-violet-600" /> High quality (ray-shadows approx.)</label>
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">BG <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-6 border border-slate-300 rounded cursor-pointer" /></label>
    </div>
    {pymolLog && <pre className="text-xs text-slate-700 bg-white border border-violet-200 rounded-lg p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">{pymolLog}</pre>}
    {selections.length > 0 && (
      <p className="text-[10px] text-violet-600 font-bold">
        ✓ {selections.length} selection(s) parsed — the Selections bar is on the LEFT of the 3D viewer (◀ collapses it).
        Touching any styling control of §2 hands the main structure back to the styling sections, so a macro never freezes them.
      </p>
    )}
  </div>
)}
</VSection>

{/* (The global Side / Backbone / Mol / Large / Water selectors and the docking
    row that used to sit here are gone: their functionality now lives in the
    SIX per-category menus of §2 — Large + 💧 Water inside « F · Others » —
    and the docking controls at the top of the §2 panel. No capability was
    removed.) */}

{/* Read the trajectory bar as a BAR, not as text: the banner below must stay a
    JSX comment (curly braces around the block comment). A bare block comment
    sitting between two JSX expressions is rendered as LITERAL TEXT and replaces
    the whole ▶ Play · frame slider · speed bar with its own description. */}

{/* ══ ▶ TRAJECTORY PLAYBACK — ▶ Play · frame slider · speed ═════════════════
   Sits directly above the 3D viewer (it drives it) and appears as soon as a
   trajectory exists for the CONDITION (a loaded file, a URL, or simply the name
   declared on the experiment): the bar is never silent, and ▶ only wakes up
   once the frames are really in the browser. */}
{(trajFile || trajectoryFile || trajectorySrc || declaredTrajName) && (
<VSection title="▶ Trajectory playback" hint="▶ Play · frame slider · speed — this condition's own trajectory">
<div className="flex flex-wrap items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 w-full">
<button
type="button"
onClick={togglePlay}
disabled={trajStatus !== 'ready' || keptFrames === 0}
className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-3 py-1 rounded-md text-[11px] shadow-sm transition-colors inline-flex items-center gap-1 h-7 whitespace-nowrap"
>
{playing ? '⏸ Pause' : '▶ Play'}
</button>
<div className="flex items-center gap-2 flex-1 min-w-[200px]">
<span className="text-[10px] font-bold text-indigo-700 whitespace-nowrap">Frame</span>
<input
type="range"
min={0}
max={Math.max(0, keptFrames - 1)}
value={currentFrame}
onChange={handleFrameChange}
disabled={trajStatus !== 'ready' || keptFrames === 0}
className="flex-1 accent-indigo-600"
/>
<span className="text-[10px] font-mono font-bold text-indigo-800 whitespace-nowrap">
{currentFrame} / {Math.max(0, keptFrames - 1)}
</span>
</div>
<div className="flex items-center gap-1.5">
<label className="text-[10px] font-bold text-indigo-700 uppercase">Speed</label>
<select
value={speed}
onChange={(e) => setSpeed(Number(e.target.value) || 10)}
className="border border-indigo-300 rounded-md px-1.5 py-0.5 text-[11px] bg-white outline-none focus:border-indigo-500 h-7"
>
{[1, 5, 10, 20, 30, 60].map((s) => <option key={s} value={s}>{s} fps</option>)}
</select>
</div>
<span className="flex-1 min-w-[160px] text-[10px] font-bold leading-tight">
{trajStatus === 'loading' && (
  <span className="text-indigo-600">
    ⏳ Loading trajectory ({trajectoryFormat.toUpperCase()})…
    {numFrames > 0 && (
      <span className="text-indigo-500 font-mono font-semibold">
        {' '}{trajTotal > 0
          ? `${Math.min(numFrames, trajTotal).toLocaleString()} / ${trajTotal.toLocaleString()}`
          : `${numFrames.toLocaleString()}`} frames loaded
      </span>
    )}
  </span>
)}
{trajStatus === 'ready' && (
  <span className="text-emerald-600">
    ✓ {trajectoryFormat.toUpperCase()}: {numFrames} frames total → playing {keptFrames} (stride {effStride})
  </span>
)}
{trajStatus === 'error' && <span className="text-red-600">⚠️ {trajError}</span>}
{waitingTrajFile && (
  <span className="text-amber-700">
    ⏳ “{declaredTrajName}” is declared on this experiment but is not loaded in this browser yet — press
    “⬇️ Bring it back from Google Drive” on the page (the reference copy), or pick the file here with 📂 Trajectory.
    ▶ turns on as soon as the frames are read.
  </span>
)}
</span>
</div>
</VSection>
)}

{/* Residue sequence strip — click a tick to select that whole residue.
    Only POLYMER residues (protein / nucleic) are shown: water, ions and
    phospholipids/lipids are not part of the sequence and are excluded. */}
{residueTicks.length > 0 && moleculeType !== 'organic' && (() => {
  const polyTicks = residueTicks.filter((r) => r.polymer);
  if (polyTicks.length === 0) return null;
  // ONE heading per NATURE — but only when the file really holds more than one
  // polymer kind: a protein + DNA complex reads « Proteins » / « DNA » / « RNA »
  // above its own residues, exactly like the page stores each nature's sequence
  // in its own field. The file itself stays ONE structure, drawn in THIS viewer.
  const polyGroups = [
    { key: 'protein', label: 'Proteins' },
    { key: 'dna', label: 'DNA' },
    { key: 'rna', label: 'RNA' },
    { key: '', label: 'Polymer' },     // a polymer whose nature cannot be read
  ].map((g) => ({ ...g, ticks: polyTicks.filter((r) => (r.nature || '') === g.key) }))
   .filter((g) => g.ticks.length > 0);
  const multiNature = polyGroups.length > 1;
  const thinStepFor = (n) => (n > 900 ? 5 : n > 450 ? 3 : n > 200 ? 2 : 1);
  // The tick buttons themselves — identical markup, whichever group holds them.
  const ticksRow = (ticks) => {
    const thinStep = thinStepFor(ticks.length);
    return (
    <div className="flex gap-0.5 overflow-x-auto custom-scrollbar items-stretch py-0.5">
      {ticks.map((r, i) => {
        if (thinStep > 1 && i % thinStep !== 0) return null;
        const isSel = selectedKeys && selectedKeys.some((k) => parseInt(String(k).split('-')[0], 10) === r.resno - 1);
        return (
          <button key={`${r.chainid}-${r.resno}`} type="button"
            onClick={(e) => handleResidueTickClick(r, e)}
            title={`${r.resname} ${displayResno(r.resno)}${r.chainid ? ` (chain ${r.chainid})` : ''} — click to select, Ctrl/Cmd/Shift-click to add to a multi-residue selection, Shift+click after another tick to select a range`}
            className={`w-7 h-9 shrink-0 rounded-md border flex flex-col items-center justify-center gap-px leading-none transition-colors ${isSel ? 'bg-amber-400 border-amber-600' : 'bg-white border-slate-300 hover:border-amber-400 hover:bg-amber-50'}`}>
            {/* The number written on the tick is the RENUMBERED one (🔢 Renumber);
                the selection it drives keeps using the ORIGINAL resno — that is the
                numbering NGL knows. */}
            <span className="text-[6px] font-bold text-slate-400 leading-none">{displayResno(r.resno)}</span>
            <span className={`text-[10px] font-black leading-none ${isSel ? 'text-amber-950' : 'text-slate-700'}`}>{r.code || (r.resname ? r.resname.slice(0, 1) : '?')}</span>
          </button>
        );
      })}
    </div>
    );
  };
  return (
  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5">
    <button type="button"
      onClick={() => setStripCollapsed((v) => {
        const nv = !v;
        try { localStorage.setItem('labViewerStripCollapsed', nv ? 'on' : 'off'); } catch { /* ignore */ }
        return nv;
      })}
      title={stripCollapsed ? 'Show the residue strip (click a tick to select that residue)' : 'Collapse the residue strip — it can take a lot of room on long sequences'}
      className={`w-5 h-9 shrink-0 rounded-md border text-[9px] font-black leading-none transition-colors ${stripCollapsed ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-slate-300 text-slate-600 hover:bg-amber-50 hover:border-amber-400'}`}>
      {stripCollapsed ? '▶' : '◀'}
    </button>
    <span className="text-[9px] font-black text-slate-500 uppercase shrink-0">Residues</span>
    {stripCollapsed ? (
      <span className="text-[10px] text-slate-400 italic truncate">
        strip collapsed — {polyTicks.length} residues{selectedKeys && selectedKeys.length ? ` · ${selectedKeys.length} atom(s) selected` : ''} · click ▶ to show it again
      </span>
    ) : (
    <>
    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
      {polyGroups.map((g) => (
        <div key={g.key || 'other'} className="flex items-center gap-1 min-w-0">
          {multiNature && (
            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wide text-right shrink-0 w-12"
              title={`${g.ticks.length} residue(s) of this file's ${g.label === 'Polymer' ? 'unclassified polymers' : g.label}`}>
              {g.label}
            </span>
          )}
          {ticksRow(g.ticks)}
        </div>
      ))}
    </div>
    <div className="flex items-center gap-1 shrink-0">
      <button type="button"
        onClick={() => setMultiSelectActive((v) => !v)}
        title="Toggle multi-residue selection — each click then adds/removes that residue instead of replacing the selection (Ctrl/Cmd/Shift-click always toggles)"
        className={`px-1.5 py-1 rounded-md border text-[9px] font-black leading-none transition-colors ${multiSelectActive ? 'bg-amber-400 border-amber-600 text-amber-950' : 'bg-white border-slate-300 text-slate-600 hover:bg-amber-50 hover:border-amber-400'}`}>
        {multiSelectActive ? '⊞ multi ON' : '⊞ multi'}
      </button>
      {(selectedKeys && selectedKeys.length > 0) && (
        <button type="button"
          onClick={clearResidueSelection}
          title="Clear the current residue selection"
          className="px-1.5 py-1 rounded-md border bg-white border-slate-300 text-slate-600 text-[9px] font-black leading-none hover:bg-red-50 hover:border-red-300 hover:text-red-600">
          ✕ clear
        </button>
      )}
    </div>
    </>
    )}
  </div>
  );
})()}

{/* (The information banner that used to sit here is GONE. It announced the
    lightweight starting layout of a large system and told the user to tick
    💧 Water; those facts now live in the tooltip of the §2 → F · Others
    « Large system » row, next to the controls that change that layout. And
    there is nothing left to announce anyway: §2 « Molecular Styling » works on
    a large system simply by being used — the first styling gesture leaves the
    lightweight starting layout (see leaveLightMode), so no menu is ignored and
    there is nothing to unlock by hand. */}

{viewerCollapsed && (
<div className="flex items-center justify-between border border-dashed border-slate-300 rounded-xl bg-slate-50 px-3 py-2.5">
  <span className="text-xs font-bold text-slate-500">🧬 3D viewer minimized — the structure stays loaded.</span>
  <button type="button" onClick={() => setViewerCollapsed(false)}
    className="text-xs font-bold px-2.5 py-1 rounded-md bg-sky-600 text-white border border-sky-600 hover:bg-sky-700 transition-colors">
    ▲ Expand viewer
  </button>
</div>
)}

{/* 3D Viewport — retractable: "⬇ Minimize" collapses it to a thin bar. The
    container stays MOUNTED (height 0) so the NGL stage, structure and
    trajectory are preserved; only the tall canvas is hidden. */}
<div
className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
style={{ height: (viewerCollapsed ? 0 : viewH) + 'px' }}
>
<div ref={containerRef} className="w-full h-full" />

{/* Mouse drag-to-move overlay — when "✋ Drag" is enabled, it captures the mouse
    (so NGL's rotate/zoom is suspended) and slides the SELECTED structure. */}
{dragMove && (
  <div
    className="absolute inset-0 z-20"
    style={{ cursor: 'move' }}
    onMouseDown={dragMoveOnDown}
    onMouseMove={dragMoveOnMove}
    onMouseUp={dragMoveOnUp}
    title="Drag with the mouse to move the selected structure — toggle off to rotate/zoom again"
  />
)}

{/* Soft edge vignette — a subtle framing cue drawn above the canvas. The real
    shadow impression now comes from the FIXED key light (installShadowLightRig);
    this overlay only stops the dark corners from competing with the lit centre.
    Multiply blend + a soft multi-stop falloff keep it from reading as a flat
    dark rectangle. It is pure neutral grey (no blue cast) and its intensity
    still scales gently with the Darkness slider. */}
{shadowOn && (
  <div
    className="pointer-events-none absolute inset-0 z-10"
    style={{
      mixBlendMode: 'multiply',
      background: `radial-gradient(ellipse at 50% 40%, rgba(30,30,30,0) 45%, rgba(30,30,30,${0.04 + (shadowDarkness || 0) * 0.06}) 72%, rgba(30,30,30,${0.12 + (shadowDarkness || 0) * 0.18}) 100%)`,
    }}
  />
)}

{/* Floating retract control — top-left of the 3D viewport, always visible
    (above the status overlays). Mirrors the "⬇ Minimize" toolbar button. */}
<button
type="button"
onClick={() => setViewerCollapsed(true)}
title="Retract (minimize) the 3D viewer window — the structure stays loaded, only the tall canvas collapses to a thin bar"
className="absolute top-2 left-2 z-40 w-7 h-7 rounded-md bg-white/90 border border-slate-300 text-slate-600 text-xs font-black hover:bg-slate-100 shadow-sm flex items-center justify-center"
>
▼
</button>

{/* ▶ The tab that brings the styling bar back once it is collapsed (PART 4) — the
    bar is the ONLY styling UI of the viewer, so it must always be reachable. */}
{status === 'ready' && molBarCollapsed && (
  <button type="button" onClick={() => setMolBarCollapsed(false)}
    className="absolute top-2 right-2 z-40 px-2 h-7 rounded-md bg-white/90 border border-blue-300 text-blue-700 text-[10px] font-black hover:bg-blue-50 shadow-sm flex items-center justify-center"
    title="Open the styling bar — one space per loaded molecule (style · color by · transparency)">
    ◀ Styling
  </button>
)}

{/* THE MOLECULE STYLING BAR (right side, collapsible) — PART 4. ONE SPACE PER
    LOADED MOLECULE — INCLUDING A LARGE SYSTEM: the sections are enumerated at load
    every time, so a membrane protein with its lipids and its water opens with its
    spaces in the bar (before, the lightweight starting layout skipped that walk and
    the bar stayed EMPTY — the report « the viewer did not store phospholipids in
    the styling window. they were ignored »). Each space carries the rows its KIND
    owns (protein: general / backbone / side chains · nucleic acid: general /
    backbone / bases / ribose · lipid: general / headgroups / acyl chains / glycerol
    · sugar, ligand, water, ion: one row), and every row carries its Style, its
    « Color by » and its transparency regulator. A style or a colouring chosen on
    GENERAL switches the other rows to « Hide » (the request), so one drawing of the
    molecule is on screen at a time.
    It REPLACES the old « Molecules » window (whose Docking on/off is gone for good)
    and is also the home of the ligand's SMILES and of the ⚙ settings wheel. */}
{molBarOpen && (
  <div className="absolute top-2 right-2 bottom-2 w-96 z-40 flex flex-col gap-2 bg-white/95 border border-blue-200 rounded-xl shadow-lg p-2 overflow-hidden">
    <div className="flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] font-black text-blue-700 uppercase tracking-wide">Molecules · styling</span>
      <span className="flex gap-1">
        <button type="button" onClick={() => setMolBarCollapsed(true)}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
          title="Collapse the styling bar (▶ brings it back) — the styles stay applied">▶</button>
        {/* ⚙ The settings wheel of the viewer: every palette the colourings read —
            atom types, residues, base types, secondary structure, CHAINS, DNA
            conformation, lipids, sugars, charges, the gradient pair and the glycan
            colours. */}
        <button type="button" onClick={() => setSettingsPanelOpen(true)}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-slate-400 text-slate-700 hover:bg-slate-100"
          title="⚙ Settings — edit every palette this viewer colours with: atom types · residues · base types · secondary structure · chain colours · DNA/RNA conformation · lipid types · sugar types · charges · the gradient pair · the glycan colours">
          ⚙</button>
        <button type="button"
          onClick={() => setVisibleMolKeys(new Set(extraCompsRef.current.map(({ id }) => id).concat(['main'])))}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-blue-300 text-blue-600 hover:bg-blue-50"
          title="Show every structure">All</button>
        <button type="button"
          onClick={() => setVisibleMolKeys(new Set(['main']))}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-slate-300 text-slate-500 hover:bg-slate-50"
          title="Show only the main structure">Main</button>
        <button type="button" onClick={copySectionsToAll}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          title="🎨 Copy the look of the ACTIVE molecule to every OTHER molecule of the bar — every row whose kind it shares (chain A's protein rows go to chain B, and so on). Handy for a series of docked structures that should look the same">
          🎨 Copy</button>
      </span>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1 min-h-0">
      {Object.keys(sectionCatalog).length === 0 && (
        <p className="text-[10px] text-slate-400 italic">
          Load a structure: one space appears here for every molecule it holds, with the styling of its own kind.
        </p>
      )}
      {Object.keys(sectionCatalog).map((molKey) => {
        const entry = sectionCatalog[molKey];
        const extra = extraMols.find((m) => m.id === molKey);
        return (
          <div key={molKey} className="rounded border border-slate-300 bg-slate-50/70 p-1 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => autoViewMol(molKey)}
                className="text-[10px] font-black text-slate-700 truncate flex-1 text-left hover:text-blue-700"
                title={`${entry.name} — click to select & centre it`}>{entry.name}</button>
              {extra && (
                <button type="button" onClick={(e) => { e.stopPropagation(); deleteExtraMol(extra.id); }}
                  className="text-red-400 hover:text-red-600 font-bold text-[10px] px-1 shrink-0" title="Delete this structure">🗑</button>
              )}
            </div>
            {/* Move the WHOLE molecule: every row of every section follows the
                matrix of that molecule's NGL component. */}
            <div className="flex items-center gap-1" title="Shift the whole molecule along X · Y · Z (Å), or move it with the mouse (✋ Drag)">
              <span className="text-[9px] text-slate-400 font-bold shrink-0">Move</span>
              {['X', 'Y', 'Z'].map((ax, ai) => (
                <label key={ax} className="flex items-center gap-0.5 text-[9px] text-slate-400 font-bold">
                  {ax}
                  <input type="number" step="1"
                    value={extra ? ((extra.position && extra.position[ai]) || 0) : (mainPos[ai] || 0)}
                    onChange={(e) => (extra ? setExtraMolPosition(extra.id, ai, e.target.value) : setMainPosition(ai, e.target.value))}
                    className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-11" />
                </label>
              ))}
              <button type="button" onClick={() => (extra ? resetExtraMolPosition(extra.id) : resetMainPosition())}
                className="text-[10px] font-bold text-slate-500 hover:text-slate-800" title="Back to the origin">↺</button>
              <label className="flex items-center gap-1 text-[9px] font-bold text-slate-500 cursor-pointer ml-auto">
                <input type="checkbox" checked={dragMove} onClick={() => setDragMove((v) => !v)} className="accent-blue-600 w-3 h-3" />
                ✋ Drag
              </label>
            </div>
            {(entry.sections || []).map((sec) => renderSection(sec))}
          </div>
        );
      })}
      {/* SMILES of the molecule at hand (an organic condition, the ligand of a
          docking run, OR the ligand a loaded PDB declares by its HETATM code —
          see utils/ligandSmiles.js and the RCSB Chemical Component Dictionary).
          It is FOLDED, with a 📋 button, so a ligand can be identified or pasted
          into a drawing tool / a report from the page — and it says where it came
          from when the dictionary resolved it. */}
      {shownLigandSmiles && (
        <div className="rounded border border-emerald-200 bg-emerald-50/60 px-1 py-0.5">
          <MolFold open={foldOpen('main', 'smiles')} onToggle={() => toggleMolFold('main', 'smiles')}
            label={`SMILES${smilesMsg ? ` ${smilesMsg}` : ''}`}
            summary={ligandSmilesSource
              ? `The SMILES of the organic ligand — ${ligandSmilesSource}. Click to show the string, then 📋 to copy it`
              : `The SMILES of ${smiles ? 'this molecule' : 'the docked ligand'} — click to show the string, then 📋 to copy it`} />
          {foldOpen('main', 'smiles') && (
            <div className="flex flex-col gap-0.5 mt-0.5">
              <div className="flex items-start gap-1">
                <code className="flex-1 min-w-0 break-all text-[10px] font-mono text-slate-700 bg-white border border-slate-200 rounded px-1 py-0.5 max-h-28 overflow-y-auto custom-scrollbar"
                  title={shownLigandSmiles}>{shownLigandSmiles}</code>
                <button type="button" onClick={copyLigandSmiles}
                  className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded border bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                  title="Copy the SMILES to the clipboard">
                  📋</button>
              </div>
              {ligandSmilesSource && (
                <span className="text-[9px] text-emerald-800 italic">🔎 {ligandSmilesSource}</span>
              )}
            </div>
          )}
        </div>
      )}
      {/* A ligand the dictionary could not resolve says WHY (its code is unknown
          there, or the network is out) instead of staying silent. */}
      {!shownLigandSmiles && ligandFromPdb && (ligandFromPdb.loading || ligandFromPdb.error) && (
        <div className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[9px] text-slate-500"
          title="The ligand is named by its HETATM code only: the viewer asks the RCSB Chemical Component Dictionary for its SMILES (utils/ligandSmiles.js)">
          {ligandFromPdb.loading
            ? <>🧪 ligand <b>{ligandFromPdb.code}</b>: asking the RCSB dictionary for its SMILES…</>
            : <>🧪 ligand <b>{ligandFromPdb.code}</b>: {ligandFromPdb.error}</>}
        </div>
      )}
    </div>
  </div>
)}

{/* ⚙ SETTINGS WHEEL — the colours the per-molecule colourings and the six §2
    menus actually read. ONE modal, four palettes:
      • the ATOM TYPES (one colour per element) — the table behind « Atom type »
        in the Molecules bar (lab-elements) and « Atom-type palette (⚙) » in a
        menu; an element missing from it keeps a readable grey;
      • the AMINO ACIDS (one colour per residue), the DNA/RNA BASES, the SECONDARY
        STRUCTURE (helix · sheet · loop — a SECTION OF ITS OWN: it used to hide
        inside the DNA/RNA-base one, and the report could not find those three
        colours anywhere), the CHAINS (one colour per chain letter, plus the grey
        « other » — « Color by : Chain » used to paint with NGL's own table, which
        NO control of the viewer could change), the CHARGE of an ion and the 16
        LIPID TYPES — the palettes the « Color by » rows of the styling bar read;
      • the SUGAR TYPES (one colour per sugar residue) — behind « Sugar type »
        (lab-sugar-identity), built from the very list the Sugars menu selects on,
        so the two can never drift apart;
      • the NUCLEOTIDE FORMS and MOTIFS — behind « RNA/DNA conformation »
        (lab-nuc-form) and « 2° structure + motifs » (lab-nuc-motif, PART 3): the
        six A · B · Z DNA / A · flexible · Z RNA colours and the two high-contrast
        motif colours a G-quadruplex and a hairpin stand out with;
      • the GRADIENT pair and the GENERAL look the six menus share — the override
        hierarchy: the wheel writes the general value, and only the menus that
        override that field keep their own.
    Every change is persisted and REPAINTS the representations (the schemes read
    these stores live): no scheme is ever re-registered, nothing is rebuilt. */}
{settingsPanelOpen && (
<div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(3px)' }}>
  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
    <div className="px-4 py-3 bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-start justify-between gap-3 shrink-0">
      <div>
        <h3 className="text-sm font-black uppercase tracking-wide">⚙ Molecule colour settings</h3>
        <p className="text-[11px] text-slate-200 mt-0.5">
          The palettes the colourings read — atom types · amino acids (the 20 residues) · secondary structure (helix · sheet · loop, its own section) · chains (color by chain) · DNA/RNA bases · charge · the 29 sugar types · the 16 lipid types · the DNA/RNA conformations and motifs · the gradient pair. Moving a swatch repaints every molecule that uses it, at once.
        </p>
      </div>
      <button type="button" onClick={() => setSettingsPanelOpen(false)}
        className="text-white/80 hover:text-white font-black text-sm px-2 py-0.5 rounded border border-white/30 hover:bg-white/10"
        title="Close the settings wheel">✕</button>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Atom types (element colours)</span>
          <button type="button" onClick={resetElementColors}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put every element back to its default colour">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Atom type » (the « Color by » option of every row of the styling bar) paints: one colour per element. The list is the request's: {ELEMENT_ORDER.join(' · ')}. An element that is NOT in the table (a metal of an unusual file) keeps a readable grey instead of turning black. Saved like every other viewer preference.
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
          {ELEMENT_ORDER.map((el) => (
            <label key={el} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50"
              title={`Colour of every ${el} atom`}>
              <input type="color" value={numToHex(elementColors[el])}
                onChange={(e) => setElementColor(el, parseInt(e.target.value.slice(1), 16))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${el} colour`} />
              <span className="text-[10px] font-bold text-slate-600">{el}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Amino acids · the 20 residues</span>
          <button type="button" onClick={() => setResidueColors({ ...RESIDUE_COLOR_PALETTE })}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put every residue back to its default colour">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Color by : Amino acid (residue) » of a protein — and « Amino acid » in the « Atom colour » selector of its menu — paints: one swatch per residue, {RESIDUE_ORDER.join(' · ')}. A NUCLEIC residue takes the colour of its BASE (the DNA/RNA base palette just below), because that IS its residue identity.
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
          {RESIDUE_ORDER.map((res) => (
            <label key={res} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50" title={`Colour of every ${res} residue`}>
              <input type="color" value={numToHex(residueColors[res])}
                onChange={(e) => setResidueColors((p) => ({ ...p, [res]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${res} colour`} />
              <span className="text-[10px] font-bold text-slate-600">{res}</span>
            </label>
          ))}
        </div>
      </section>
      {/* The 2°-structure palette gets a section of ITS OWN. It used to be squeezed
          into the DNA/RNA-base one, under a header that began with « DNA/RNA bases »
          — so a protein user looking for « the colours of secondary structure » could
          not find them, and the colouring is offered in the styling bar with a
          definition control nowhere (the report). */}
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Secondary structure · helix / sheet / loop</span>
          <button type="button" onClick={() => setSstrucColors({ ...SSTRUC_COLOR_DEFAULTS })}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put the three 2°-structure colours back to their defaults">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Color by : Secondary structure » paints — {SSTRUC_COLOR_ITEMS.map((it) => it.label.toLowerCase()).join(' · ')}. NGL's own `sstruc` codes decide which one an atom takes (h · g · i = helix, e · b = sheet, everything else — coil · turns · bends — = loop), and the ribbon of a nucleic acid as well as the two motifs of PART 3 fall back on these same three colours. The swatches stand here, in the « Color by » row of the styling bar (they appear as soon as « Secondary structure » is chosen) and in the « Atom colour » selector of a protein menu — ONE palette, three places.
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
          {SSTRUC_COLOR_ITEMS.map((it) => (
            <label key={it.key} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50" title={`Colour of the ${it.what}`}>
              <input type="color" value={numToHex(sstrucColors[it.key])}
                onChange={(e) => setSstrucColors((c) => ({ ...c, [it.key]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${it.label} colour`} />
              <span className="text-[10px] font-bold text-slate-600">{it.label}</span>
            </label>
          ))}
        </div>
      </section>
      {/* « Color by : Chain » paints with NGL's own `chainid` table, which NO control
          of the viewer could change — the report: « it is possible to color by chain
          but there is no way to define the color of the chain in the setting wheel ».
          The scheme is the viewer's own (lab-chain) and reads exactly these swatches:
          one per chain LETTER, plus the grey « other » for a chain whose name is not
          a letter (a number, an empty chain, a force-field spelling). The colour is
          read from the chain's NAME, so chain A keeps its colour from file to file. */}
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Chains · color by chain</span>
          <button type="button" onClick={() => setChainColors({ ...CHAIN_COLOR_PALETTE })}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put the chain colours back to their defaults">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Color by : Chain » paints on a protein / a nucleic acid / a lipid row: one colour per chain, read from the chain's NAME. {loadedChainLetters ? <>The loaded file(s) carry: <b>{loadedChainLetters}</b>.</> : 'No chain is loaded yet.'} A chain the table does not know (a number, an empty name) takes the grey « other ».
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5">
          {CHAIN_COLOR_ORDER.map((c) => (
            <label key={c} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50"
              title={c === 'other' ? 'Colour of a chain whose name is not one of the letters above' : `Colour of chain ${c} of every molecule`}>
              <input type="color" value={numToHex(chainColors[c])}
                onChange={(e) => setChainColors((p) => ({ ...p, [c]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`chain ${c} colour`} />
              <span className="text-[10px] font-bold text-slate-600 truncate">{c === 'other' ? 'other' : `Chain ${c}`}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">DNA/RNA bases · charge</span>
          <button type="button" onClick={() => { setBaseTypeColors({ ...BASE_IDENTITY_COLORS }); setChargeColors({ ...CHARGE_COLORS }); }}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put these two palettes back to their defaults">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Color by : DNA/RNA base » of a nucleic acid — and « DNA/RNA base » in the « Atom colour » selector of its menu — paints: the five bases {BASE_TYPE_ORDER.join(' · ')} (also the colour that fills the stylized ring plates). Then what « Charge » paints on an ion: a PDB file rarely carries a formal charge, so the sign is read from the file when it has one and from the element otherwise. (The helix / sheet / loop colours of « Secondary structure » have their own section just above.)
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
          {BASE_TYPE_ORDER.map((b) => (
            <label key={`base-${b}`} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50" title={`Colour of every ${b} base`}>
              <input type="color" value={numToHex(baseTypeColors[b])}
                onChange={(e) => setBaseTypeColors((p) => ({ ...p, [b]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${b} base colour`} />
              <span className="text-[10px] font-bold text-slate-600">{b}</span>
            </label>
          ))}
          {CHARGE_ORDER.map((c) => (
            <label key={c} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50" title={`Colour of a ${c} atom / ion`}>
              <input type="color" value={numToHex(chargeColors[c])}
                onChange={(e) => setChargeColors((p) => ({ ...p, [c]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${c} charge colour`} />
              <span className="text-[10px] font-bold text-slate-600">{c === 'negative' ? '−' : c === 'positive' ? '+' : '0'}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Sugar types</span>
          <button type="button" onClick={() => setSugarTypeColors({ ...SUGAR_TYPE_COLORS })}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put every sugar type back to its default colour">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Sugar type » paints — the 29 CHEMICAL sugars of the request, not the 3-letter code a file happens to use (a file may write the same glucose GLC, BGC or GCS). A code the table below does not know keeps the readable grey.
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
          {SUGAR_TYPE_ORDER.map((t) => (
            <label key={t} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50"
              title={`Colour of the ${t} sugars (every code that IS ${t}: ${Object.keys(SUGAR_TYPE_OF_CODE).filter((c) => SUGAR_TYPE_OF_CODE[c] === t).join(' · ') || '—'})`}>
              <input type="color" value={numToHex(sugarTypeColors[t])}
                onChange={(e) => setSugarTypeColors((p) => ({ ...p, [t]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${t} colour`} />
              <span className="text-[10px] font-bold text-slate-600 truncate">{t}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Lipid types</span>
          <button type="button" onClick={() => setLipidTypeColors({ ...LIPID_CLASS_COLORS })}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put every lipid class back to its default colour">
            ↺ Defaults
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          What « Lipid type » paints, read from the END of the residue name (POPC = PO + PC, TOCL = TO + CL, ERG = ergosterol, TAG / DAG / MAG = the three acylglycerols, CER = a ceramide): the 14 classes of the request. « PA » and the grey « OTHER » are kept at the end — a file vocabulary has them, the request simply did not name them.
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
          {LIPID_TYPE_ORDER.map((k) => (
            <label key={k} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50" title={`Colour of the ${k} lipids`}>
              <input type="color" value={numToHex(lipidTypeColors[k])}
                onChange={(e) => setLipidTypeColors((p) => ({ ...p, [k]: parseInt(e.target.value.slice(1), 16) }))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${k} colour`} />
              <span className="text-[10px] font-bold text-slate-600">{k}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Nucleotide conformations &amp; motifs</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={resetNucleicFormColors}
              className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
              title="Put the six conformation colours back to their defaults">
              ↺ Forms
            </button>
            <button type="button" onClick={resetNucleicMotifColors}
              className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
              title="Put the two motif colours back to their defaults">
              ↺ Motifs
            </button>
          </div>
        </div>
        <p className="text-[10px] text-slate-500">
          What « RNA/DNA conformation » paints: each nucleotide is classified from the COORDINATES — χ (O4'-C1'-N9/N1: a syn purine alternating with pyrimidines is the left-handed Z form), δ (C5'-C4'-C3'-O3': C3'-endo is the A family, C2'-endo B-DNA or a flexible loop of an RNA) and, when δ is missing, the distance from the C1'-N line to the phosphate. What « 2° structure + motifs » paints: a nucleotide inside a G-quadruplex or a hairpin takes the colour below, every other one keeps its 2°-structure colour.
        </p>
        <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1.5">
          {NUC_FORM_LABELS.map((form) => (
            <label key={form} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50"
              title={`Colour of the ${NUC_FORM_NAMES[form]} nucleotides`}>
              <input type="color" value={numToHex(nucleicFormColors[form])}
                onChange={(e) => setNucleicFormColor(form, parseInt(e.target.value.slice(1), 16))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${NUC_FORM_NAMES[form]} colour`} />
              <span className="text-[10px] font-bold text-slate-600">{NUC_FORM_NAMES[form]}</span>
            </label>
          ))}
          {['gquad', 'hairpin'].map((motif) => (
            <label key={motif} className="flex items-center gap-1 border border-slate-200 rounded px-1 py-0.5 bg-slate-50"
              title={`Colour of the ${motif === 'gquad' ? 'G-quadruplex' : 'hairpin'} nucleotides (every other one keeps its 2°-structure colour)`}>
              <input type="color" value={numToHex(nucleicMotifColors[motif])}
                onChange={(e) => setNucleicMotifColor(motif, parseInt(e.target.value.slice(1), 16))}
                className="w-6 h-5 rounded border border-slate-300 cursor-pointer" aria-label={`${motif} colour`} />
              <span className="text-[10px] font-bold text-slate-600">{motif === 'gquad' ? 'G4' : 'Hairpin'}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">Gradient &amp; general look</span>
        <p className="text-[10px] text-slate-500">
          The ramp runs from the FIRST residue of every chain to the last (N → C terminus, 5' → 3' end); ⇄ reverses it. The pair is global — one NGL scheme — and it is the general value the six menus follow.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
            First →&nbsp;last
            <input type="color" value={numToHex(gradientPair.from)}
              onChange={(e) => setGradientPair('gradientFrom', parseInt(e.target.value.slice(1), 16))}
              className="w-7 h-6 rounded border border-slate-300 cursor-pointer" title="Colour of the FIRST residue of every chain" />
            <span className="text-[10px] font-bold text-slate-400">→</span>
            <input type="color" value={numToHex(gradientPair.to)}
              onChange={(e) => setGradientPair('gradientTo', parseInt(e.target.value.slice(1), 16))}
              className="w-7 h-6 rounded border border-slate-300 cursor-pointer" title="Colour of the LAST residue of every chain" />
          </label>
          <button type="button" onClick={swapGeneralGradient}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Reverse the ramp (swap the two colours)">⇄ Reverse</button>
          <button type="button" onClick={resetGeneralLook}
            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
            title="Put the general look (atom colour · radii · surface colour · gradient) back to its defaults — a menu that overrides a field keeps its own value">
            ↺ Default general look
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          General now: <b>{generalLook.atomColor}</b> atoms · radii <b>{Number(generalLook.sphereRadius).toFixed(2)}×</b> / <b>{Number(generalLook.bondRadius).toFixed(2)}×</b> · <b>{generalLook.surfaceColor}</b> surfaces. A menu that overrides a field shows « ↺ General » beside it, and one that follows shows « · General »; the full control lives in §2 → « ⚙ General look ».
        </p>
      </section>
    </div>
    <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] text-slate-400">Saved with the viewer's preferences (element palette · amino-acid palette · DNA/RNA base and 2°-structure colours · chain colours · sugar palette · lipid types · nucleotide forms &amp; motifs · general look).</span>
      <button type="button" onClick={() => setSettingsPanelOpen(false)}
        className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-900">Done</button>
    </div>
  </div>
</div>
)}

{/* Vertical selections bar (right side of the viewer) — also hosts the Abort button
    when a LONG OPERATION is really running. It used to open on `playing` alone: a
    trajectory being PLAYED showed a red « ⏹ Abort » panel over the canvas, which
    made no sense — the run is loaded and playback stops with its own ▶ / ⏸ button
    (the report). The panel now appears for the selections and for a structure /
    trajectory LOAD in progress, and its Abort button only exists while such a load
    is abortable. */}
{/* ▶ The tab that brings the SELECTIONS bar back once it is collapsed — the same
    gesture as the styling bar on the right. This bar is the LEFT one: every
    selection a PyMOL script defines, each with its own styles. */}
{status === 'ready' && selBarCollapsed && (selections.length > 0 || !!membraneInfo) && (
  <button type="button" onClick={() => setSelBarCollapsed(false)}
    className="absolute top-11 left-2 z-40 px-2 h-7 rounded-md bg-white/90 border border-violet-300 text-violet-700 text-[10px] font-black hover:bg-violet-50 shadow-sm flex items-center justify-center"
    title={`Open the selections bar — ${selections.length} selection(s)${membraneInfo ? ', membrane measured' : ''}, each with its own styles`}>
    ▶ Selections
  </button>
)}

{(selections.length > 0 || !!membraneInfo || status === 'loading' || trajStatus === 'loading') && !selBarCollapsed && (
  <div className="absolute top-11 left-2 bottom-2 w-64 z-30 flex flex-col gap-2 bg-white/95 border border-violet-200 rounded-xl shadow-xl p-2 overflow-hidden">
    {/* ── The membrane the viewer MEASURED on this structure ──────────────────
        `z>90` (the way membrane macros usually split the two leaflets) depends on
        the file being centred and oriented on z. The geometry does not: the
        normal axis, the midplane and the two clusters of headgroups are measured
        at load (membraneLeafletsOf), published as four ready-made selections and
        drawn here in one click, so the user SEES which leaflet is which — and a
        macro may use those names directly. */}
    {membraneInfo && (
      <div className="shrink-0 rounded-lg border border-teal-200 bg-teal-50/70 p-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-black text-teal-800 uppercase tracking-wide">Membrane</span>
          <span className="text-[9px] text-teal-700 font-mono"
            title={`Measured normal axis, midplane and head-to-head thickness of this bilayer`}>
            {membraneInfo.axis} · mid {membraneInfo.midplane.toFixed(1)} Å · {membraneInfo.thickness.toFixed(1)} Å
          </span>
        </div>
        <div className="flex items-center gap-1 flex-wrap mt-1">
          {['upper_leaflet', 'lower_leaflet', 'upper_headgroups', 'lower_headgroups'].map((n) => {
            const on = !!(selStyles[n] && (selStyles[n].sphere || selStyles[n].ball || selStyles[n].stick));
            return (
              <button key={n} type="button"
                onClick={() => setSelStyles({ ...selStylesRef.current, [n]: { ...(selStylesRef.current[n] || {}), sphere: !on } })}
                className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-300 hover:bg-teal-100'}`}
                title={n === 'upper_headgroups' || n === 'lower_headgroups'
                  ? `Draw the headgroups of the ${n.startsWith('upper') ? 'upper' : 'lower'} leaflet as beads (measured, not z>90)`
                  : `Draw the ${n.startsWith('upper') ? 'upper' : 'lower'} leaflet as beads — the two leaflets are told apart by geometry, whatever the orientation of the file`}>
                {n.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
        <div className="text-[9px] text-teal-700 mt-1 leading-snug">
          upper {membraneInfo.upperAtoms} atoms / {membraneInfo.upperResidues} lipids · lower {membraneInfo.lowerAtoms} / {membraneInfo.lowerResidues}.
          The four names work in a PyMOL script as well ({'`'}upper_leaflet{'`'}, {'`'}lower_headgroups{'`'}…), and a script that defines them with {'`'}z&gt;90{'`'} now gets this measurement instead.
        </div>
      </div>
    )}
    {selections.length > 0 && (
    <>
    <div className="flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] font-black text-violet-700 uppercase tracking-wide">Selections</span>
      <span className="flex items-center gap-1">
      <button type="button" onClick={() => setSelBarCollapsed(true)}
        className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
        title="Collapse the selections bar (▶ brings it back) — the styles stay applied">
        ◀</button>
      <button type="button" onClick={() => setHideAll((v) => !v)}
        className={`px-2 py-0.5 text-[9px] font-bold rounded border ${hideAll ? 'bg-red-600 text-white border-red-600' : 'bg-white border-red-300 text-red-600 hover:bg-red-50'}`}
        title={hideAll ? 'Show everything again' : 'Hide every representation'}>
        {hideAll ? 'Show all' : '🙈 Hide all'}
      </button>
      </span>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 min-h-0">
      {[
        // 1. The selections the script NAMED (« select water, resn TIP3 »).
        ...selections.map((s) => ({ ...s, raw: false })),
        // 2. The looks the script created on a RAW EXPRESSION — « show sphere, resn
        //    POPC+POPE+… » is one of them. They used to be INVISIBLE here, so the
        //    spheres of a macro could not be switched off by hand at all: the
        //    report « the spheres remain even when I remove them ». Every look now
        //    has a row, and ✕ removes it.
        ...Object.keys(selStyles)
          .filter((k) => k !== 'all' && !selections.some((s) => s.name === k))
          .map((k) => ({ name: k, expr: k, raw: true })),
      ].map((s) => {
        const st = selStyles[s.name] || {};
        const n = selectionAtomCount(s.name);
        // ⚠ when the expression could NOT be resolved (a residue name this
        // structure has not, a coordinate test without a structure): an empty
        // selection must never be silent again — that silence is exactly what
        // the report « everything is in spheres / the hides do nothing » was.
        const warns = usedTranslateWarnRef.current.get(s.expr) || [];
        return (
          <div key={s.name} className="flex flex-col gap-1 border border-slate-100 rounded-lg p-1.5 bg-white">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-xs font-bold truncate ${st.hidden ? 'text-slate-400 line-through' : 'text-slate-800'}`}
                title={`${s.raw ? `Raw script expression: ${s.expr}` : s.expr}${warns.length ? `\n⚠ ${warns.join('\n⚠ ')}` : ''}`}>
                {s.raw ? '⌗ ' : ''}{s.name}
                {warns.length ? <span className="text-amber-500 ml-1" title={warns.join(' · ')}>⚠</span> : null}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-slate-400 font-mono">{n != null ? `${n} atoms` : '—'}</span>
                {st.hideFor && Object.values(st.hideFor).some((l) => Array.isArray(l) && l.length > 0) && (
                  <span className="text-[9px] font-bold text-slate-400 cursor-help"
                    title={`The script hides part of this selection ${Object.entries(st.hideFor).map(([k, l]) => `${k}: ${(l || []).join(' · ')}`).join(' | ')} — the ordered « show / hide » of PyMOL, subtracted atom by atom`}>
                    −{Object.values(st.hideFor).reduce((a, l) => a + ((l || []).length), 0)}
                  </span>
                )}
                <button type="button"
                  onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), hidden: !st.hidden } })}
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${st.hidden ? 'bg-red-600 text-white border-red-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-red-50'}`}
                  title={st.hidden ? 'Show this selection again' : 'Hide this selection (removes its representations)'}>
                  {st.hidden ? '👁 Show' : '🙈 Hide'}
                </button>
                <button type="button"
                  onClick={() => { const nx = { ...selStylesRef.current }; delete nx[s.name]; setSelStyles(nx); }}
                  className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-slate-50 text-slate-500 border-slate-200 hover:bg-red-50 hover:text-red-600"
                  title="Remove this look for good (the selection itself stays: re-run the script to get its look back)">
                  ✕
                </button>
              </div>
            </div>
            {!st.hidden && (
              <>
            <div className="flex items-center gap-1 flex-wrap">
              {['cartoon', 'ribbon', 'tube', 'ball', 'stick', 'sphere', 'surface'].map((style) => (
                <button key={style} type="button"
                  onClick={() => toggleSelStyle(s.name, style)}
                  title={`${st[style] ? 'Hide' : 'Show'} « ${style === 'ball' ? 'ball+stick' : style} » on the atoms of this row — and on THOSE atoms: the other rows that draw the same style lose them too, exactly like the last command of PyMOL`}
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${st[style] ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-violet-50'}`}>
                  {style === 'ball' ? 'ball+stick' : style}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Colour</span>
              <select value={st.colorMode || 'solid'}
                onChange={(e) => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), colorMode: e.target.value } })}
                className="text-[10px] border border-slate-300 rounded bg-white text-slate-600 outline-none focus:border-violet-500 h-6"
                title="Colouring metaphor">
                <option value="solid">Solid</option>
                <option value="element">Atom type</option>
                <option value="chainid">Chain</option>
                <option value="resname">Residue</option>
                <option value="sstruc">2° structure</option>
                <option value="hydrophobicity">Hydrophobicity</option>
              </select>
              <input type="color" value={st.color != null ? `#${st.color.toString(16).padStart(6, '0')}` : '#000000'}
                disabled={(st.colorMode || 'solid') !== 'solid'}
                onChange={(e) => { const c = parseInt(e.target.value.slice(1), 16); setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), color: c } }); }}
                className={`w-6 h-6 border border-slate-300 rounded cursor-pointer ${(st.colorMode || 'solid') !== 'solid' ? 'opacity-30 cursor-not-allowed' : ''}`}
                title="Solid colour (used when Colour = Solid)" />
            </div>
            <label className="flex items-center gap-1 text-[10px] text-slate-500">
              transp
              <input type="range" min="0" max="1" step="0.05" value={st.transparency || 0}
                onChange={(e) => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), transparency: parseFloat(e.target.value) } })}
                className="accent-violet-600 w-full" />
            </label>
              </>
            )}
          </div>
        );
      })}
    </div>
    </>
    )}
    {/* ── MATERIAL of the four representation families ────────────────────────
        PyMOL's spheres look glossier/metallic than NGL's default flat surface.
        NGL 2.4 does have the two properties PyMOL exposes — `roughness` and
        `metalness`, parameters of every Representation, forwarded to the physical
        shader as uniforms — they are only absent from NGL's own docs. The viewer
        sets them through `repr.setParameters`, so spheres, bonds, cartoon and
        surface each take their own material, live, without rebuilding anything,
        and the choice is persisted. « auto » keeps NGL's own material (roughness
        0.4, metalness 0.0). */ }
    <details className="shrink-0 border-t border-slate-100 pt-1.5">
      <summary className="text-[10px] font-black text-slate-600 uppercase cursor-pointer select-none"
        title="Material of the spheres, the bonds, the cartoon and the surface — roughness (r) and metalness (m), NGL's own material parameters">
        🎛 Material
      </summary>
      <div className="mt-1 flex flex-col gap-1">
        {MATERIAL_KINDS.map(({ key, label }) => {
          const preset = (matSettings[key] && matSettings[key].preset) || 'auto';
          return (
            <div key={key} className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-slate-500 w-10 shrink-0">{label}</span>
              <select value={preset} onChange={(e) => setMatPreset(key, e.target.value)}
                className="text-[9px] border border-slate-300 rounded bg-white text-slate-600 h-5"
                title={`Material of the ${label.toLowerCase()}: auto = NGL's own rough surface, matte, gloss, metallic, glass (translucent)`}>
                {['auto', 'matte', 'gloss', 'metallic', 'glass'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="range" min="0" max="1" step="0.05" value={matSliderValue(key, 'roughness')}
                onChange={(e) => setMatValue(key, 'roughness', parseFloat(e.target.value))}
                className="accent-violet-600 w-12" title="roughness — 0 = mirror smooth, 1 = fully matte (NGL's default)" />
              <input type="range" min="0" max="1" step="0.05" value={matSliderValue(key, 'metalness')}
                onChange={(e) => setMatValue(key, 'metalness', parseFloat(e.target.value))}
                className="accent-violet-600 w-12" title="metalness — 0 = organic/plastic, 1 = metal" />
              <span className="text-[8px] text-slate-400 font-mono w-10 shrink-0"
                title="roughness / metalness currently applied">
                {(matSliderValue(key, 'roughness')).toFixed(2)}/{(matSliderValue(key, 'metalness')).toFixed(2)}
              </span>
            </div>
          );
        })}
        <div className="text-[9px] text-slate-400 leading-snug">
          r/m = roughness / metalness. Moving a slider overrides the preset for that family only; the per-selection
          <span className="font-bold"> transp </span> slider (above) sets its own opacity.
        </div>
      </div>
    </details>
    {/* The ⏹ of a REAL long operation only (a structure / trajectory load): a
        trajectory that is merely PLAYING is stopped by its own ▶ / ⏸ button, so no
        Abort panel is drawn for it. */}
    {runningAbort && (
      <div className="shrink-0 border-t border-slate-100 pt-1.5 mt-1">
        <button type="button" onClick={handleAbort}
          className="w-full px-2 py-1 text-xs font-bold rounded-lg border transition-colors bg-red-600 text-white border-red-600 hover:bg-red-700"
          title={`Abort: ${runningAbort.label}`}>
          ⏹ Abort ({runningAbort.label})
        </button>
      </div>
    )}
  </div>
)}

{hoverInfo && status === 'ready' && (
<div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm pointer-events-none z-10">
{hoverInfo}
</div>
)}
{status === 'loading' && (
<div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
<div className="text-center">
<div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
<p className="text-sm text-slate-500 font-bold">Loading structure…</p>
</div>
</div>
)}
{status === 'error' && (
<div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20 p-4">
<div className="text-center max-w-md">
<p className="text-red-600 text-sm font-bold mb-1">
⚠️ Failed to load structure
</p>
<p className="text-slate-500 text-xs">{errorMsg}</p>
</div>
</div>
)}
{status === 'idle' && (
<div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
<div className="text-center text-slate-400">
<p className="text-4xl mb-2">🧬</p>
<p className="text-sm font-bold">
Load a PDB file, enter a PDB ID, or paste a structure URL
</p>
<p className="text-xs mt-1">
Tip: you cannot paste a local file path — use the file picker button above
</p>
</div>
</div>
)}
</div>

{/* Vertical resize handle — drag to make the 3D viewer taller/shorter */}
<div
  onMouseDown={(e) => { resizeRef.current = { startY: e.clientY, startH: viewH }; e.preventDefault(); }}
  className="h-4 -mt-1 cursor-row-resize flex items-center justify-center select-none text-slate-300 hover:text-slate-500 active:text-slate-600 transition-colors"
  title={`Drag to resize the 3D viewer (currently ${viewH} px)`}
>
  <span className="text-[11px] leading-none tracking-widest">⠿</span>
</div>

{/* Trajectory frame-selection modal */}
{pendingTraj && (
<div className="fixed inset-0 z-[99999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
<h3 className="text-sm font-black text-slate-800 mb-2">Trajectory frame selection</h3>
<p className="text-xs text-slate-600 mb-3">
<b className="text-slate-800">{pendingTraj.file.name}</b> is estimated to contain ~{pendingTraj.estFrames.toLocaleString()} frames.
{pendingTraj.over2G
  ? ' Loading all of it may exceed ~2 GB of memory and freeze the browser.'
  : ' Choose how many frames to load — a reduced set is sampled evenly across the whole trajectory so the total time range is preserved.'}
</p>
<div className="flex items-center gap-2 mb-1">
<label className="text-xs font-bold text-slate-700 shrink-0">Load at most</label>
<input
  type="number"
  min="1"
  max={pendingTraj.estFrames}
  value={trajFrameCount}
  onChange={(e) => setTrajFrameCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
  className="w-24 border border-indigo-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-500 font-semibold"
/>
<span className="text-xs text-slate-500 shrink-0">representative frames (max {pendingTraj.estFrames.toLocaleString()})</span>
</div>
<p className="text-[10px] text-slate-400 mb-4">
Default: {Math.min(TARGET_TRAJ_FRAMES, pendingTraj.estFrames).toLocaleString()} frames sampled evenly across the run (~every {pendingTraj.suggested}× frame). The total trajectory time is preserved.
</p>
<div className="flex flex-wrap gap-2 justify-end">
<button
type="button"
onClick={() => setPendingTraj(null)}
className="text-xs font-bold text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg"
>
Cancel
</button>
<button
type="button"
onClick={loadTrajWithoutReduction}
className="text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-2 rounded-lg shadow-sm"
>
Load everything
</button>
<button
type="button"
onClick={acceptTrajReduction}
className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg shadow-sm"
>
✓ Load {Math.min(Math.max(1, parseInt(trajFrameCount, 10) || TARGET_TRAJ_FRAMES), Math.max(1, pendingTraj.estFrames)).toLocaleString()} frames
</button>
</div>
</div>
</div>
)}

{/* "Replace or keep both?" — a structure is already loaded and the user picked new
    files OR entered a new PDB code / URL. */}
{(pendingFileBatch || pendingSrc) && (
  <div className="fixed inset-0 z-[99999] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => { setPendingFileBatch(null); setPendingSrc(null); }}>
    <div className="bg-white rounded-xl shadow-2xl p-5 max-w-sm w-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
      <h4 className="text-sm font-black text-slate-800">
        {pendingFileBatch ? `📂 ${pendingFileBatch.length} file(s) selected` : '🧬 New structure (PDB code / URL)'}
      </h4>
      <p className="text-xs text-slate-500">A structure is already loaded. What should happen to it?</p>
      {pendingSrc && (
        <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 break-all">
          Source: <b className="font-mono">{pendingSrc}</b>
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => {
          if (pendingFileBatch) { const f = pendingFileBatch; setPendingFileBatch(null); doReplaceLoad(f); }
          else doReplaceSrc(pendingSrc);
        }}
          className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-left" title="Remove the current structure(s) and load these file(s) as the new main structure">
          🔄 Replace the current structure
        </button>
        <button type="button" onClick={() => {
          if (pendingFileBatch) doKeepBoth(pendingFileBatch);
          else doKeepBothSrc(pendingSrc);
        }}
          className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-left" title="Keep the current structure and add these file(s) as additional molecules (each chain becomes its own entry)">
          ➕ Keep both — add alongside
        </button>
        <button type="button" onClick={() => { setPendingFileBatch(null); setPendingSrc(null); }}
          className="text-xs font-bold bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg text-left">
          Cancel
        </button>
      </div>
    </div>
  </div>
)}

</div>
);
};

export default NMRMoleculeViewer;
