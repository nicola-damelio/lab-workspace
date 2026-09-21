import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ensureNGL } from '../utils/ngl';
import { computeSmiles3DNameMap } from '../utils/atomNameSync';
import { rebuildProteinHydrogenCoords } from '../utils/rebuildProteinHydrogens';
import { readXtcFrames, countXtcFrames, countXtcFramesInFile } from '../utils/xtcDecoder';
import { abortControl } from '../utils/abortControl';
import { archiveFileToDrive } from '../utils/driveUpload';
import { getPymolScripts } from '../utils/pymolScripts';
import { getActiveProjectId, publishLibraryFigure } from '../utils/figuresLibrary';

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

   The Bases dropdown also gained « Stylized rings (coloured inside) »: NGL's own
   `base` rungs — the slabs that FILL the inside of the base rings — coloured with
   a per-base palette (A · C · G · T · U) plus a thin ring of sticks over the base
   atoms, so each base reads as a coloured ring of its own. With the backbone on
   « Cartoon » (the NGL nucleic ribbon) that is the classic stylized DNA / RNA
   ladder: a flat ribbon with the coloured base plates inside it.

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
// The five fields every menu owns on top of its styles: the atom colour, the
// surface colour and the sphere / bond radius multipliers. ONE factory keeps the
// six entries readable and impossible to half-fill.
const catLook = (atomColorHex) => ({
  atomColor: 'default',
  atomColorHex,
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
  //    🎨 Colours panel (phosphate · pentose · bases) and its switch.
  nucleic: {
    backbone: 'cartoon', bases: 'slab', surface: 'hide', surfaceOpacity: 0.4,
    ...catLook(DEFAULT_ATOM_COLORS.nucleic),
    groupColour: false,
    phosphateColor: DEFAULT_NUCLEIC_COLORS.phosphate,
    pentoseColor: DEFAULT_NUCLEIC_COLORS.pentose,
    baseColor: DEFAULT_NUCLEIC_COLORS.base,
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
// clipping). Unknown keys simply fall back to the default.
const loadCatStyles = () => {
  const out = cloneCatStyles();
  try {
    const raw = localStorage.getItem(CAT_STYLE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') {
      Object.keys(out).forEach((k) => {
        if (saved[k] && typeof saved[k] === 'object') out[k] = { ...out[k], ...saved[k] };
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

/* ---- Stylized per-base colour (Bases → « Stylized rings ») ------------------
   The base identity is read from the residue name of the atom, with the standard
   nucleic residue names of every dialect: A / DA / RA / ADE → A, C / DC / RC /
   CYT → C, G / DG / RG / GUA → G, T / DT / THY → T, U / U / RU / URA → U. */
const baseIdentityColorOf = (resname) => {
  const n = String(resname || '').trim().toUpperCase();
  const m = /^[DR]?([ACGTU])/.exec(n);
  return m ? BASE_IDENTITY_COLORS[m[1]] : 0xbdbdbd;
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
]);
const isLipidResname = (name) => LIPID_RESNAMES.has(String(name || '').trim().toUpperCase());

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
      return [i, String((a && a.atomname) || ''), (a && a.element) || ''];
    } catch { return [i, '', '']; }
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
  const head = []; const glycerol = []; const acyl = [];
  atoms.forEach(([i, n, e]) => {
    const g = lipidGroupOf(n, e, named);
    if (g === 'glycerol') glycerol.push(i);
    else if (g === 'acyl') acyl.push(i);
    else head.push(i);
  });
  const sele = (list) => (list.length ? `@${list.join(',')}` : '');
  const out = { head: sele(head), glycerol: sele(glycerol), acyl: sele(acyl), named };
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
const SUGAR_RES_SEL = '[GLC] or [NAG] or [MAN] or [BMA] or [SIA] or [GAL] or [FUC]';
const SUGAR_SEL = `saccharide or ${SUGAR_RES_SEL}`;

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

// Supersampling level used while the « ◐ Shadows » rig is ON — NGL's nearest
// equivalent to a screen-space ambient-occlusion pass (see applyShadowSettings):
// the cavity-shading gradients produced by the deep-ambient + strong-key-light
// rig are sampled several times per pixel instead of once, so the AO-like
// shading of a crevice is smooth instead of banded. Stage parameter range is
// -1 … 5 (NGL 2.4 StageParameters#sampleLevel); 0 = NGL's own default (sample
// only while the camera is still) and is restored as soon as Shadows is OFF.
const AO_SAMPLE_LEVEL = 2;

const AA3_TO_1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', HSD: 'H', HSE: 'H', HSP: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M',
  PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', CYX: 'C',
  SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z',
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U'
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
      out.push({
        resno: r && r.resno != null ? r.resno : out.length + 1,
        resname: name || String((r && r.restype) || 'UNK'),
        code: code || (name.length === 1 ? name : ''),
        // TRUE only for polymer residues (protein / nucleic). Water, ions,
        // lipids and other hetero have no 1-letter code and are excluded from
        // the sequence strip (they are not part of the polymer "sequence").
        polymer: !!code,
        chainid,
        atomNames: [...(atomsByRes.get(`${chainid}|${r.resno}`) || [])],
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
 * @returns {{ labelText: object, indices: number[] }}
 */
const build3dLabelMap = (component, { showResidueNumber, showAtomLabel, showResidueNumberType = false, atomNameOf = null, allowed = null }) => {
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
    const resTag = `${entry.resname}${entry.resno}`;
    const resnoStr = String(entry.resno);

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
let sstrucSchemeKey = null; // id returned by ColormakerRegistry.addScheme (null = unusable)
// The definition of the scheme, NAMED so a test can extract and really run it
// (registerSstrucScheme below is the only place that registers it).
const defineSstrucScheme = () => {
  return function () {
    this.atomColor = function (atom) {
      const s = atom && atom.sstruc;
      if (s === 'h' || s === 'g' || s === 'i') return sstrucColorStore.helix;   // α / 3₁₀ / π helices
      if (s === 'e' || s === 'b') return sstrucColorStore.sheet;                // β strands / sheets
      return sstrucColorStore.loop;                                             // coil, turns, bends, loops…
    };
  };
};
const registerSstrucScheme = (NGL) => {
  if (sstrucSchemeKey) return;
  sstrucSchemeKey = registerColorScheme(NGL, 'lab-sstruc', defineSstrucScheme());
};
const numToHex = (v) => `#${(Number(v) || 0).toString(16).padStart(6, '0')}`;

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

// Convert a common PyMOL selection expression to NGL selection syntax.
const translateSelection = (expr) => {
  const s = String(expr || '')
    .replace(/\bpolymer\.protein\b/g, 'protein')
    .replace(/\bpolymer\.nucleic\b/g, 'nucleic')
    .replace(/\bbyres\b/g, '')
    .replace(/\bbycalpha\b/g, '')
    .replace(/\+/g, ' ')
    .replace(/,(?=\s*name|\s*resn|\s*resid|\s*protein|\s*not)/g, '')
    .trim();
  return s || 'all';
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

// ============================================================================
// MAIN COMPONENT
// ============================================================================
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
// Update ONE field of ONE category (every menu goes through this). A change made
// here IS a styling choice, so it also leaves the fast starting layout of a large
// system (leaveLightMode): the menu the user just moved is really applied.
const setCatStyle = (cat, key, value) => {
  leaveLightMode();
  setCatStyles((prev) => ({
    ...prev,
    [cat]: { ...(prev[cat] || {}), [key]: value },
  }));
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
    return { ...prev, [cat]: next };
  });
};
// Open/closed state of the five styling menus (accordion: one at a time) and of
// the residue-sequence strip above the viewport (collapsible: it used to eat
// too much room on long sequences).
const [openMenu, setOpenMenu] = useState(null);
const [stripCollapsed, setStripCollapsed] = useState(() => {
  try { return localStorage.getItem('labViewerStripCollapsed') === 'on'; } catch { return false; }
});

// ---- Multiple structures & multi-model PDB (docking clusters: HADDOCK/AutoDock) ----
// extraMols = extra loaded structure files (each its own NGL component); the
// "Molecules" selector shows exactly one at a time. Multi-MODEL PDB files
// (NMR ensembles / docking clusters) are split into one entry per MODEL by the
// main-load effect, so they appear in the same "Molecules" selector. Each entry
// also carries its own style/color overrides ({ style, color }) so every chain /
// molecule can be rendered independently from the global selectors.
const [extraMols, setExtraMols] = useState([]);    // [{ id, name, style, color }]
const [visibleMolKeys, setVisibleMolKeys] = useState(() => new Set(['main'])); // multi-select: which structures are shown
const [selectedMolKey, setSelectedMolKey] = useState('main'); // active entry in the Molecules bar (click → select + centre)
// Per-molecule overrides for the MAIN structure — same controls as the extra
// structures (style / colour / transparency). "auto" follows the global
// Backbone / Molecule Style selectors (the classic main rendering).
const [mainMol, setMainMol] = useState({ style: 'auto', color: '', colorMode: 'element', transparency: 0 });
const mainMolRef = useRef(mainMol);
mainMolRef.current = mainMol;
const [mainPos, setMainPos] = useState([0, 0, 0]); // main structure translation (Å), settable via Move X/Y/Z or ✋ Drag
// "Standardize docking" mode: every docking result (the active cluster / pose
// AND all the others, current and future) is drawn with the styles of section
// « 2 · Molecular Styling » — the ONE place where the look is defined (Proteins
// backbone / side chains, Ligands, surfaces …). That is what makes all the
// solutions look consistent while the mode is ON, whatever each molecule's own
// Style setting says; switching OFF gives every molecule its own style back.
// There is deliberately NO docking-specific style menu: the look IS the §2 look.
const [dockStyleMode, setDockStyleMode] = useState(false);
const dockStyleRef = useRef(dockStyleMode);
dockStyleRef.current = dockStyleMode;
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

// Renumber every residue consecutively starting from the user-chosen number
// (residue 1 → start, residue 2 → start+1, …).
const applyRenumberFrom = () => {
  const start = parseInt(renumberFrom, 10);
  if (!Number.isFinite(start)) return;
  const next = {};
  residueInfo.forEach((r, i) => { next[String(r.resno)] = start + i; });
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
        helix: raw.helix || 0xb44a90,
        sheet: raw.sheet || 0xf8d878,
        loop: raw.loop || 0xe6e6e6,
      };
    }
  } catch { /* fall through to defaults */ }
  return { helix: 0xb44a90, sheet: 0xf8d878, loop: 0xe6e6e6 };
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
const [selStyles, setSelStyles] = useState({});        // key -> { cartoon, ribbon, tube, stick, sphere, surface, color, colorMode, transparency, sphereScale }
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
      // space, derived from the Azimuth / Elevation controls. NGL's default
      // camera sits at z=-80 looking along +z, so z<0 is the near/camera side,
      // x>0 is screen-left and y>0 is up. az=0 keeps the light behind the
      // camera (flat), turning it swings the shade across the model.
      const d0 = shadowDirRef.current || {};
      const azRad = (((Number(d0.az) || 0) * Math.PI) / 180);
      const elRad = (((Number(d0.el) || 0) * Math.PI) / 180);
      const ce = Math.cos(elRad);
      const ux = ce * Math.sin(azRad);
      const uy = Math.sin(elRad);
      const uz = -ce * Math.cos(azRad);
      const inv = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz + 1e-12);
      // Park the light far outside the model (≈ 100× the bounding box like NGL
      // does) so the rays are effectively parallel — a crisp "sun" direction.
      const d = Math.max(1, this.boundingBoxLength || 1) * 100;
      light.position.set(ux * inv * d, uy * inv * d, uz * inv * d);
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
    if (on) {
      // Shadows ON: ONE fixed key light (aimed via the Azimuth / Elevation
      // controls). Darkness only raises the dark-vs-light CONTRAST — the key
      // light gets brighter while the ambient fill gets dimmer. The lights are
      // pure white, so colours are never tinted (the old warm-golden key /
      // cool-blue fill is gone — it read as "a red light was added"). The fill
      // is floored so the shadow side never goes fully black.
      //
      // AMBIENT OCCLUSION: NGL 2.4 ships NO screen-space ambient-occlusion pass
      // (verified in the installed build: `ssao` / `AmbientOcclusion` do not
      // exist anywhere — only three.js's unused AO-map shader chunk, which needs
      // an AO texture no structure rendering ever binds). The equivalent NGL
      // exposes is its AMBIENT term: the ambient light is added uniformly, so
      // lowering `ambientIntensity` while raising `lightIntensity` darkens every
      // face the key light does not reach — crevices, cavities and the inner
      // side of a folded chain lose their fill and read as cavity shading and
      // depth, exactly what AO is used for. `sampleLevel` is raised at the same
      // time so the resulting gradients are supersampled (smooth, not banded).
      stage.setParameters({
        lightColor: 0xffffff,
        ambientColor: 0xffffff,
        lightIntensity: 1.3 + dark * 0.7,                     // 1.3 → 2.0
        ambientIntensity: Math.max(0.12, 0.34 - dark * 0.22), // 0.34 → 0.12
        sampleLevel: AO_SAMPLE_LEVEL,
      });
    } else {
      // No shadows: NGL's even, camera-linked lighting — pure white so every
      // element / residue colour stays exactly as chosen — and the plain
      // sampling level (AO off).
      stage.setParameters({
        lightColor: 0xffffff,
        ambientColor: 0xffffff,
        lightIntensity: 1.15,
        ambientIntensity: 0.34,
        sampleLevel: 0,
      });
    }
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
// The exact ESP colouring used by the ⚡ ESP overlay: NGL's built-in
// 'electrostatic' colour scheme pinned to the red → white → blue ramp (rwb) and
// driven by the user's ±kcal/mol limits — shared, so « Surface Color: ESP » and
// the ⚡ button can never drift apart.
const espColorParams = () => {
  const prev = espLimitsRef.current || [15, 15];
  const neg = Math.min(500, Math.max(0.5, Number(prev[0]) || 15));
  const pos = Math.min(500, Math.max(0.5, Number(prev[1]) || 15));
  return { colorScheme: 'electrostatic', colorScale: 'rwb', colorDomain: [-neg, pos] };
};

// ── Per-CATEGORY representation builder (section « 2. Molecular Styling ») ───
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
  // A flat colour (« Atom colour : Custom… » / « Surface colour : Custom… ») is
  // what NGL receives as `color` — a hex number; « default » keeps the classic
  // element colouring, and the BACKBONE of a polymer keeps its landmark
  // rainbow-by-residue default until a flat colour is chosen for that menu.
  const flatHex = (v) => (Number.isFinite(v) ? v : null);
  const atomCol = (cat) => {
    const m = cs[cat] || {};
    const hex = m.atomColor === 'custom' ? flatHex(m.atomColorHex) : null;
    return hex != null ? { color: hex } : { colorScheme: 'element' };
  };
  const backboneCol = (cat) => {
    const m = cs[cat] || {};
    const hex = m.atomColor === 'custom' ? flatHex(m.atomColorHex) : null;
    return hex != null ? { color: hex } : { color: 'residueindex' };
  };
  // 🔬 Menu B — « Colour by chemical group » (🎨 Colours panel of that menu): the
  // phosphate backbone, the pentose rings and the bases each take their own colour
  // through the lab-nucleic-groups scheme.
  const nucleicGroupsOn = () => !!(cs.nucleic && cs.nucleic.groupColour && nucleicSchemeKey);
  const nucleicCol = () => (nucleicGroupsOn() ? { color: nucleicSchemeKey } : atomCol('nucleic'));
  // The INSIDE of the base rings of « Stylized rings »: one colour per base.
  const baseIdentityCol = () => (baseIdentitySchemeKey ? { color: baseIdentitySchemeKey } : { colorScheme: 'resname' });
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
    // Stylized rings — the ONE style that colours the INSIDE of the base rings:
    // the filled rungs coloured per BASE IDENTITY (A · C · G · T · U) PLUS a thin
    // ring of sticks over the base atoms, so each base reads as a coloured ring.
    else if (bases === 'rings') {
      add('base', { sele: sels.nucleic, ...baseIdentityCol(), ...stickGeom('nucleic', BASE_BOND_RADIUS) });
      add('licorice', { sele: 'nucleic and sidechain', ...baseIdentityCol(), radiusSize: LICORICE_BOND_RADIUS * 0.6 * g.bond });
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
const addDefaultReps = (component) => {
  if (!component || !component.structure) return;
  baseCompsRef.current = [];
  const trackBase = (r) => { if (r) baseCompsRef.current.push(r); };
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
  // Per-CATEGORY rendering (section « 2. Molecular Styling »): the five menus —
  // Proteins / Nucleic acids / Lipids / Organic molecules / Others — draw the
  // structure together (base representations + their surfaces), and every mesh
  // they create is flagged to cast AND receive shadows (flagMeshShadows).
  buildCategoryReps(component).forEach(trackBase);
};

// Apply the CURRENT per-CATEGORY styles to ANY component — the main structure OR
// an extra molecule / chain — so changing a styling menu updates everything, not
// just the main structure. One builder does the work (buildCategoryReps), so a
// component can never be styled with different rules than the main view.
// Returns the list of representation objects added (so callers can remove them).
const applyCurrentStyleTo = useCallback((comp, baseReps) => {
  if (!comp || !comp.structure) return baseReps || [];
  (baseReps || []).forEach((r) => { try { comp.removeRepresentation(r); } catch {} });
  return buildCategoryReps(comp);
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

// Build the MAIN structure's base representations, honouring the per-molecule
// override (Molecules bar → Main controls). "auto" = the per-CATEGORY styling of
// section « 2. Molecular Styling » (addDefaultReps, incl. the large-system
// lightweight handling); any other style rebuilds the main with ONE chosen
// style + colouring metaphor + transparency, exactly like the extra molecules.
// Selections / highlights live on the same component, so only the tracked base
// representations are replaced — never everything.
const buildMainReps = () => {
  const comp = componentRef.current;
  if (!comp || !comp.structure) return;
  baseCompsRef.current.forEach((r) => { try { comp.removeRepresentation(r); } catch {} });
  baseCompsRef.current = [];
  // The previous ESP-coloured category surfaces of the main component are gone
  // (they were part of baseCompsRef) — re-create them from scratch.
  catEspRepsRef.current.delete(comp);
  // "🧬 Docking" standard mode: the main docking result gets the §2 « Molecular
  // Styling » look — the very same per-category renderer as every other
  // cluster/pose (addDefaultReps → buildCategoryReps), even when a per-molecule
  // Style was picked in the Molecules bar. That is what standardizes a series.
  const st = mainMolRef.current || {};
  if (dockStyleRef.current || !st.style || st.style === 'auto') {
    addDefaultReps(comp);
    return;
  }
  const colorScheme = st.colorMode && st.colorMode !== 'solid'
    ? (st.colorMode === 'sstruc' ? sstrucSchemeKey || 'sstruc' : st.colorMode)
    : undefined;
  const color = colorScheme ? undefined : (st.color != null ? st.color : undefined);
  const opacity = st.transparency != null ? Math.max(0, Math.min(1, 1 - st.transparency)) : undefined;
  const add = (type, params = {}) => {
    try {
      const r = comp.addRepresentation(type, { sele: 'all', colorScheme, color, opacity, ...params });
      if (r) baseCompsRef.current.push(r);
    } catch { /* style best-effort */ }
  };
  try {
    if (st.style === 'cartoon') add('cartoon');
    else if (st.style === 'ribbon') add('ribbon');
    else if (st.style === 'ball+stick') add('ball+stick', { multipleBond: true, aspectRatio: 1.3 });
    // « Sticks » = licorice: NGL has no `stick` representation, so this used to
    // draw nothing at all.
    else if (st.style === 'sticks') add('licorice', { multipleBond: true, radiusSize: LICORICE_BOND_RADIUS });
    else if (st.style === 'lines') add('line');
    else if (st.style === 'spheres') add('spacefill', { scale: 0.6 });
    else if (st.style === 'surface') add('surface');
  } catch { /* style best-effort */ }
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
// them (PQR, charged MOL2/SDF, …); otherwise NGL falls back to its CHARMM-
// derived table for protein backbone + key side-chain atoms, so plain PDB
// ensembles / docking poses still get a meaningful map. Each molecule component
// (the main structure or any extra / model / chain) can have one overlay — it
// is a normal representation but tracked separately from the per-molecule base
// reps, so a style change never removes it accidentally.
const espAddSurfaceRep = (comp) => {
  if (!comp || !comp.structure) return null;
  try {
    const prev = espLimitsRef.current || [15, 15];
    const neg = Math.min(500, Math.max(0.5, Number(prev[0]) || 15));
    const pos = Math.min(500, Math.max(0.5, Number(prev[1]) || 15));
    // 'not water' skips the noisy solvent shell of membrane / water-heavy files;
    // opacity < 1 keeps the cartoon / atoms legible underneath the map.
    return comp.addRepresentation('surface', {
      sele: 'not water',
      colorScheme: 'electrostatic',
      colorScale: 'rwb',
      colorDomain: [-neg, pos],
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
  setCatInfo(cs2 ? { ...cs2.n, lipids: cs2.lipids, lipidNamed: cs2.lipidNamed } : null);
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

// Expose the 1-letter sequence parsed from the structure so the pages can
// auto-fill the sequence field when it is empty (enables the per-atom table).
if (typeof onStructureSequence === 'function') {
const seq = extractStructureSequence(component);
if (seq) onStructureSequence(seq);
}
// Build the residue strip ticks (resno / resname / 1-letter code per residue).
setResidueTicks(collectResidueTicks(component));
stripResidueRiRef.current = null;

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

// Expose trajectory playback to the global Stop button (so the always-visible
// ⏹ Stop can also halt playback, not just loading operations).
useEffect(() => {
  if (!playing) return;
  const unregister = abortControl.register('trajectory playback', () => setPlaying(false));
  return unregister;
}, [playing]);


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
  const resMap = new Map();
  try {
    component.structure.eachAtom((a) => {
      const rawResno = a.resno != null ? Number(a.resno) : 0;
      list.push({ idx: a.index, element: a.element || '', name: a.atomname || '', resno: displayResno(rawResno), rawResno, resname: a.resname || '' });
      if (!resMap.has(rawResno)) resMap.set(rawResno, { resno: rawResno, resname: a.resname || '', count: 0 });
      resMap.get(rawResno).count++;
    });
  } catch {}
  setAtomList(list);
  setResidueInfo([...resMap.values()]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, renumberMap]);

// ---- PyMOL-style selections & effects ----
const selCompsRef = useRef({});       // key -> [representations]
const baseCompsRef = useRef([]);      // default representations added at load
const selStylesRef = useRef(selStyles);
selStylesRef.current = selStyles;

// Resolved NGL expression for a selection key (named selection or raw expr),
// with references to other named selections expanded inline (like PyMOL sets).
const selKeyExpr = (key) => {
  const named = selections.find((s) => s.name === key);
  let raw = named ? named.expr : key;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    selections.forEach((s) => {
      const re = new RegExp(`\\b${s.name}\\b`, 'g');
      if (re.test(raw)) {
        raw = raw.replace(re, `(${translateSelection(s.expr)})`);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return translateSelection(raw);
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
  // when the backbone OR molecule style changes or when restoring from "hide all".
  const catSig = catStylesSig(catStyles);
  const styleChanged = prevCatSigRef.current !== catSig;
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
    // Colouring metaphor: a NGL colorScheme (element/chain/resname/sstruc/…) or
    // a plain solid colour when "Solid" is selected. The "2° structure" mode
    // uses the customisable helix/sheet/loop scheme (🎨 Colours panel).
    const colorScheme = st.colorMode && st.colorMode !== 'solid'
      ? (st.colorMode === 'sstruc' ? sstrucSchemeKey || 'sstruc' : st.colorMode)
      : undefined;
    const color = colorScheme ? undefined : (st.color != null ? st.color : undefined);
    const opacity = st.transparency != null ? Math.max(0, Math.min(1, 1 - st.transparency)) : undefined;
    const reps = [];
    const add = (type, params) => {
      try { reps.push(component.addRepresentation(type, { sele: expr, color, colorScheme, ...params })); } catch {}
    };
    if (st.cartoon) add('cartoon', { colorScheme, opacity });
    if (st.ribbon) add('ribbon', { colorScheme, opacity });
    if (st.tube) add('tube', { colorScheme, opacity });
    if (st.sphere) add('spacefill', { scale: st.sphereScale || 1, colorScheme, opacity, multipleBond: true });
    if (st.ball) add('ball+stick', { colorScheme, opacity, multipleBond: true, aspectRatio: 1.3 });
    // « Sticks » of a selection / molecule is licorice (NGL has no `stick` rep).
    if (st.stick) add('licorice', { colorScheme, opacity, multipleBond: true, radiusSize: LICORICE_BOND_RADIUS });
    if (st.surface) add('surface', { colorScheme, opacity: opacity != null ? opacity : 0.5 });
    selCompsRef.current[key] = reps;
  });
  return () => {
    Object.keys(selCompsRef.current).forEach((k) => {
      (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    });
    selCompsRef.current = {};
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, selections, selStyles, pymolActive, hideAll, catStyles, sstrucColors]);

// Re-apply the current §2 « Molecular Styling » menus to EVERY extra molecule /
// chain when one of them changes — so the styles work for all loaded
// structures, not just the main one.
useEffect(() => {
  if (status !== 'ready') return;
  extraCompsRef.current.forEach((entry) => {
    if (!entry || !entry.comp) return;
    if (entry.style && entry.style !== 'auto') {
      // Custom-styled molecules keep their per-molecule style / colour / position
      // — unless « 🧬 Docking » is ON, where restyleExtraMol applies the §2 look.
      restyleExtraMol(entry.id);
    } else {
      entry.baseReps = applyCurrentStyleTo(entry.comp, entry.baseReps || []);
    }
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [catStyles, status, applyCurrentStyleTo, sstrucColors]);

// Rebuild the MAIN structure whenever the user changes its per-molecule
// overrides (Molecules bar → Main controls). Guarded by hideAll/pymolActive so
// "hide everything" / a PyMOL script still wins until the user toggles it off.
useEffect(() => {
  if (status !== 'ready' || hideAll || pymolActive) return;
  if (!componentRef.current) return;
  buildMainReps();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [mainMol, status, hideAll, pymolActive, sstrucColors]);

// Re-style the MAIN structure and every loaded cluster/pose with the §2
// « Molecular Styling » look. Called by the mode toggle, so switching
// « 🧬 Docking » ON is visible at once on the active result and all the others.
const applyDockStylesNow = () => {
  if (status !== 'ready' || !componentRef.current) return;
  // Applying the §2 look IS a styling choice: a large system leaves its fast
  // starting layout so the docking look is really visible on the main result.
  leaveLightMode();
  // The MAIN is only rebuilt outside PyMOL-script mode — there the script's own
  // representations keep defining the look. "Hide everything" also skips the
  // main (it is hidden anyway) but still re-styles the loaded docking results.
  if (!hideAll && !pymolActive) buildMainReps();
  extraCompsRef.current.forEach((entry) => {
    if (entry && entry.comp) restyleExtraMol(entry.id);
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

// Switch « 🧬 Docking » ON/OFF. The look applied to every docking result — the
// active one and all the others, current and future — is the one of section
// « 2 · Molecular Styling »: the six category menus are the ONLY style menus of
// the docking look, so there is nothing to define here. Switching OFF gives
// every molecule its own style back.
const toggleDockStyle = () => setDockStyleMode((v) => !v);

// Toggle the "🧬 Docking" standard mode: when it changes, re-render the main AND
// every loaded cluster/pose with the §2 « Molecular Styling » look. Toggling off
// restores each molecule's own style.
const prevDockStyleRef = useRef(dockStyleMode);
useEffect(() => {
  if (prevDockStyleRef.current === dockStyleMode) return;
  prevDockStyleRef.current = dockStyleMode;
  applyDockStylesNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [dockStyleMode]);

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
      const style = (arg1 || rest[0] || 'all').toLowerCase();
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
      else if (prop === 'transparency' || prop === 'sphere_transparency') acts.push({ type: 'transparency', val: parseFloat(val), sel });
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
    const styleOf = (st) => (st === 'sphere' || st === 'spheres' ? 'sphere' : st === 'stick' || st === 'sticks' ? 'stick' : st === 'ball' || st === 'ball+stick' || st === 'ball_and_stick' || st === 'ballandstick' ? 'ball' : st === 'cartoon' ? 'cartoon' : st === 'ribbon' ? 'ribbon' : st === 'tube' ? 'tube' : st === 'surface' ? 'surface' : st === 'line' || st === 'lines' || st === 'dots' ? 'line' : null);
    const next = { ...selStylesRef.current };
    // Reset every selection the script mentions to "hidden", then apply commands
    sels.forEach((s) => {
      const cur = next[s.name] || {};
      next[s.name] = { ...cur, cartoon: false, ribbon: false, tube: false, ball: false, stick: false, sphere: false, surface: false };
    });
    acts.forEach((a) => {
      const key = names.has(a.sel) ? a.sel : (a.sel === 'all' ? 'all' : a.sel);
      const cur = next[key] || {};
      if (a.type === 'show' || a.type === 'hide') {
        const st = styleOf(a.style);
        if (st) next[key] = { ...cur, [st]: a.type === 'show' };
        if (a.style === 'everything' || a.style === 'all') {
          next[key] = { ...cur, cartoon: a.type === 'show', ribbon: a.type === 'show', tube: a.type === 'show', ball: a.type === 'show', stick: a.type === 'show', sphere: a.type === 'show', surface: a.type === 'show' };
        }
      } else if (a.type === 'color') {
        const c = colorDefs[a.color] || parseColorInt(a.color);
        if (c != null) next[key] = { ...cur, color: c };
      } else if (a.type === 'sphere_scale') {
        next[key] = { ...cur, sphereScale: a.val || 1 };
      } else if (a.type === 'transparency') {
        next[key] = { ...cur, transparency: Math.max(0, Math.min(1, a.val || 0)) };
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
      }
    });
    setSelStyles(next);
    setPymolActive(true);
    setHideAll(false);
    // Reproduce every selection the script defines: selections that received no
    // explicit style from the script are shown as a subtle semi-transparent
    // sphere so the user can see exactly which atoms each one captures.
    if (autoShowSel && sels.length) {
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

// 3D atom / residue labels — PER CATEGORY.
// Each molecule menu owns three switches (Residues · Residue type · Atom names)
// and the atoms they may label are EXACTLY the atoms that menu styles, i.e. the
// same selections as the renderer (routeCategorySelections). The text itself is
// computed per atom in build3dLabelMap (context-aware: protein / nucleic /
// ligand / water / ion rules) and rendered by ONE NGL "label" representation
// that selects EXACTLY the labelled atoms (via an atom-index selection @a,b,c),
// so no empty labels are ever created. Styling keeps the glyphs billboarded
// (NGL text sprites always face the camera), pulled slightly toward the camera
// (zOffset) with depth testing disabled so they never clip inside atom spheres
// or bonds. Glyphs are BLACK with a subtle WHITE stroke halo and NO background
// plate — readable against bright, complex structures.
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
if (!anyCatLabel(catLabelsRef.current)) return clearLabels;
try {
const labels = catLabelsRef.current || {};
// The very same routing as the menus: a category can only label its own atoms.
const fallbackSels = {
  protein: 'protein', nucleic: 'nucleic', lipid: '', sugar: SUGAR_SEL,
  organic: 'hetero and not water and not ion', others: 'water or ion', lipids: [],
  n: { protein: -1, nucleic: -1, others: -1, organic: -1, lipid: -1, sugar: -1 },
};
const sels = catSelectionsFor(component.structure) || fallbackSels;
const route = routeCategorySelections(sels, moleculeType);
// The SAME selections the menus style: a protein menu labels `protein` atoms
// only — never `all` (the default moleculeType of a protein condition must not
// turn its label switches into whole-scene switches).
const owner = {
  protein: route.protein,
  nucleic: route.nucleic,
  lipid: route.lipid,
  sugar: route.sugar,
  organic: route.organic,
  other: route.other,
};
const labelText = {};
const indexSet = new Set();
CAT_STYLE_CATS.forEach((cat) => {
  const l = labels[cat] || CAT_LABEL_DEFAULTS;
  if (!l.residues && !l.atoms) return;         // nothing asked for this category
  const sele = owner[cat];
  if (!sele) return;
  const indices = atomIndicesForSele(component.structure, sele);
  if (!indices.length) return;
  const sub = build3dLabelMap(component, {
    showResidueNumber: !!l.residues,
    showAtomLabel: !!l.atoms,
    showResidueNumberType: !!l.residueType,
    atomNameOf: (atom) => displayNameRef.current(atom),
    allowed: new Set(indices),
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
}, [catLabelSig, status, renames, smilesNameMap, moleculeType]);

// Side chains obey the PROTEINS menu exactly like the backbone does: its Atom
// colour, its Sphere radius (the atom-sphere aspect ratio) and its Bond radius
// (the radiusSize of the sticks), so menu A styles the whole protein. Every value
// at its neutral 1.00 reproduces what the viewer drew before (element colours,
// NGL's 0.15 Å for ball+stick, the app's own 0.25 Å licorice thickness). The
// effect depends on a STRING signature of that menu (a new object every render
// would rebuild the side chains for nothing) and reads the live values from
// catStylesRef, which is updated on every render.
const proteinLookSig = JSON.stringify(catStyles.protein || {});
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;
if (['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current)) return;
const proteinLook = catStylesRef.current.protein || {};
const clearSidechain = () => {
if (sidechainCompRef.current) {
try { component.removeRepresentation(sidechainCompRef.current); } catch {}
sidechainCompRef.current = null;
}
};
clearSidechain();
// Skip heavy side-chain rendering on very large systems (keeps the view usable).
if (sidechainStyle !== 'none' && !hideAll && !pymolActive && !lightRenderRef.current) {
try {
const pGeom = catRadii(proteinLook);
// Same rule as the renderer: ONE flat colour when « Atom colour » is Custom…,
// the element colours otherwise; a stick style takes the Bond radius, spacefill
// takes the Sphere radius, and ball+stick scales its atom spheres with it.
const sideParams = sidechainStyle === 'ball+stick'
  ? { aspectRatio: 2.0 * pGeom.sphere, radiusSize: BALLSTICK_BOND_RADIUS * pGeom.bond }
  : sidechainStyle === 'licorice'
    ? { radiusSize: LICORICE_BOND_RADIUS * pGeom.bond }
    : sidechainStyle === 'spacefill'
      ? { radiusScale: pGeom.sphere }
      : sidechainStyle === 'line'
        ? { linewidth: Math.max(1, Math.round(2 * pGeom.bond)) }
        : {};
sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
sele: '(protein and sidechain) or (protein and .CA)', multipleBond: true,
...((proteinLook.atomColor === 'custom' && Number.isFinite(proteinLook.atomColorHex))
  ? { color: proteinLook.atomColorHex }
  : { color: 'element' }),
...sideParams,
});
} catch {}
}
return clearSidechain;
}, [sidechainStyle, status, hideAll, pymolActive, lightRender, proteinLookSig]);

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
  if (dockStyleRef.current || !style || style === 'auto') {
    // "auto" = the §2 « Molecular Styling » look. « 🧬 Docking » ON forces that
    // very same look on every docking result — like every other cluster/pose,
    // regardless of this molecule's own style.
    reps = applyCurrentStyleTo(comp, []);
  } else {
    // Colouring metaphor — a NGL colorScheme, or a plain solid colour when
    // "Solid" is selected (mirrors the Selections panel). "2° structure" uses
    // the customisable helix/sheet/loop scheme (🎨 Colours panel).
    const colorScheme = st.colorMode && st.colorMode !== 'solid'
      ? (st.colorMode === 'sstruc' ? sstrucSchemeKey || 'sstruc' : st.colorMode)
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
  extraCompsRef.current.forEach((e) => { if (e.id === id) e.style = style; });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

const setExtraMolColor = (id, color) => {
  extraCompsRef.current.forEach((e) => { if (e.id === id) { e.color = color; e.colorMode = 'solid'; } });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

const setExtraMolColorMode = (id, mode) => {
  extraCompsRef.current.forEach((e) => { if (e.id === id) e.colorMode = mode; });
  setExtraMols(extraMolsSnapshot());
  restyleExtraMol(id);
};

const setExtraMolTransparency = (id, t) => {
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
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
};

// Select + centre the view on one structure (click its row in the Molecules bar).
const autoViewMol = (key) => {
  setSelectedMolKey(key);
  const comp = key === 'main' ? componentRef.current : (extraCompsRef.current.find((e) => e.id === key) || {}).comp;
  try { if (comp) comp.autoView(); } catch {}
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
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
    // The same §2 « Molecular Styling » look as the main structure (and, while
    // « 🧬 Docking » is ON, as every other docking result).
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
      </VRow>
      <VRow label="Bond radius" title="Thickness of the STICKS of THIS menu only, as a multiplier of the style's own radius (1.00 = untouched). It is NGL's radiusSize in Å: 0.15 Å for Ball & Stick, 0.25 Å for Licorice (the stick thickness this viewer has always used for the side chains) and 0.3 Å for the base rungs. The line styles use it as their line width.">
        <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={RADIUS_STEP} value={g.bond}
          onChange={(e) => setCatStyle(cat, 'bondRadius', Number(e.target.value))}
          className="w-28 accent-slate-600" aria-label={`${cat} — bond radius`} />
        <span className="text-[10px] text-slate-500 w-10">{g.bond.toFixed(2)}×</span>
      </VRow>
    </>
  );
};

// Atom colour of ONE menu: the element colours (default), or ONE flat colour —
// NGL takes a hex number as `color`. The backbones keep their rainbow-by-residue
// default until Custom… is chosen (see backboneCol in the renderer).
const renderAtomColour = (cat) => {
  const m = catStyles[cat] || {};
  const custom = m.atomColor === 'custom';
  const hex = Number.isFinite(m.atomColorHex) ? m.atomColorHex : DEFAULT_ATOM_COLORS[cat];
  return (
    <VRow label="Atom colour" title="Colour of the ATOMS of this menu only. « Default » keeps the classic colouring — element colours, and the rainbow by residue index for the protein / nucleic backbones. « Custom… » paints the whole menu with ONE colour (the swatch on the right).">
      <VSel value={custom ? 'custom' : 'default'}
        onChange={(e) => {
          const v = e.target.value;
          setCatStyle(cat, 'atomColor', v);
          if (v === 'custom' && !Number.isFinite(m.atomColorHex)) setCatStyle(cat, 'atomColorHex', DEFAULT_ATOM_COLORS[cat]);
        }}
        title={`${cat} atom colouring`} width="w-44">
        <option value="default">Default (element colours)</option>
        <option value="custom">Custom colour…</option>
      </VSel>
      {custom && (
        <input type="color" value={numToHex(hex)}
          onChange={(e) => setCatStyle(cat, 'atomColorHex', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border border-slate-300 cursor-pointer" title="Colour of every atom drawn by this menu" />
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
      {custom && (
        <input type="color" value={numToHex(hex)}
          onChange={(e) => setCatStyle(cat, 'surfaceColorHex', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border border-slate-300 cursor-pointer" title="Colour of the whole surface of this menu" />
      )}
    </VRow>
  );
};

// ↺ of ONE menu: back to the neutral radii (1.00×) and to the default colours —
// the styles themselves are never touched.
const resetCatLook = (cat) => setCatStyles((prev) => ({
  ...prev,
  [cat]: {
    ...(prev[cat] || {}),
    atomColor: 'default',
    atomColorHex: DEFAULT_ATOM_COLORS[cat],
    surfaceColor: 'default',
    surfaceColorHex: DEFAULT_SURFACE_COLOR,
    sphereRadius: 1,
    bondRadius: 1,
  },
}));

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
  },
}));
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

{/* ══ 2 · MOLECULAR STYLING — ACCORDION, COLLAPSED BY DEFAULT ═══════════════
    One row: the toggle + a live summary of every menu. Opening it reveals the
    Docking controls, « Hide everything » and the SIX per-category menus
    (A Proteins · B Nucleic acids · C Lipids · D Sugars · E Organic molecules ·
    F Others), all SIX on one line: an open menu unfolds its parameters on a
    full-width horizontal row right below it. Every menu is independent (no
    global Side / Backbone / Mol dropdowns) and carries its own 3D-label
    switches, and the shared tools —
    ⚡ electrostatic-potential surface colour, 🎨 Colours, 🔢 Renumber — live at
    the end of the panel, right below the menus that open them. */}
<section className="flex flex-col gap-1 bg-slate-50/80 border border-slate-200 rounded-lg px-1.5 py-1">
<button
type="button"
onClick={() => setStylingOpen((v) => !v)}
aria-expanded={stylingOpen}
title={stylingOpen ? 'Collapse the molecular-styling menus — the current styles stay applied' : 'Expand the molecular-styling menus (one per molecule category: proteins · nucleic acids · lipids · sugars · ligands · solvent)'}
className={`w-full flex flex-wrap items-center gap-2 text-left transition-colors ${stylingOpen ? 'text-blue-800' : 'text-slate-700 hover:text-blue-800'}`}
>
<span className="text-[9px] font-black uppercase tracking-wide whitespace-nowrap">{stylingOpen ? '▾' : '▸'} 2 · Molecular Styling</span>
<span className="text-[9px] font-bold text-slate-500 truncate flex-1">
{`Proteins ${catStyles.protein.backbone} · Nucleic ${catStyles.nucleic.backbone} · Lipids ${catStyles.lipid.head}/${catStyles.lipid.glycerol}/${catStyles.lipid.tail} · Sugars ${catStyles.sugar.style} · Ligands ${catStyles.organic.style} · Water ${catStyles.other.water}${anyLabelOn ? ' · 3D labels on' : ''}${hasNonProtein ? ' · this file also contains ligands / lipids / sugars / ions / water' : ''}`}
</span>
<span className="text-[9px] font-black uppercase tracking-wide text-slate-400 shrink-0">{stylingOpen ? '▲ collapse' : '▼ expand'}</span>
</button>
{stylingOpen && (
<div className="flex flex-wrap items-center gap-1">

{/* 🧬 Docking — STANDARDIZE every docking result (cluster / pose, current and
    future) on the look defined in THIS section: the six per-category menus
    below (A · Proteins … F · Others) are the only style menus of « 🧬 Docking »,
    so switching it ON re-draws the active structure AND every loaded result
    with them — whatever each molecule's own Style says — and switching OFF
    gives each molecule its style back. This block is FULLY usable outside a
    docking run (it is a styling gesture, which is why it lives in §2). */}
{(moleculeType === 'protein' || extraMols.length > 0 || dockStyleMode) && (
<div className={`flex items-center gap-1 rounded-md border px-1.5 h-7 whitespace-nowrap ${dockStyleMode ? 'bg-teal-50 border-teal-400' : 'bg-white border-teal-300'}`}>
  <button type="button" onClick={toggleDockStyle}
    className={`text-xs font-bold px-1 py-0.5 rounded ${dockStyleMode ? 'text-teal-900' : 'text-teal-700 hover:bg-teal-50'}`}
    title="Standardize DOCKING results: every cluster/pose — current and future — is drawn with the styles of the menus A–F below (Proteins, Ligands, surfaces…), the ONLY style menus of the docking look. Switch off to restore each molecule's own style.">
    🧬 Docking: {dockStyleMode ? 'On' : 'Off'}
  </button>
</div>
)}

{/* 🙈 Hide everything — one click removes every representation (base, side
    chains, selections, ESP); 👁️ Show default rebuilds them from the menus. */}
<button type="button" onClick={() => setHideAll((v) => !v)}
  className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors h-7 whitespace-nowrap ${hideAll ? 'bg-red-100 border-red-400 text-red-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
  title="Hide every representation of the whole scene (all molecules, side chains, selections, ESP surfaces). Click again to restore them exactly as the styling menus describe.">
  {hideAll ? '👁️ Show default' : '🙈 Hide everything'}
</button>

{/* ── The SIX menus, aligned HORIZONTALLY ───────────────────────────────
    Six equal columns put A–F side by side on ONE row that never grows: a closed
    button is one line tall now (see VMenu — no description under the name).
    The OPEN menu is not squeezed into its cell either: its parameters take a
    full-width row of this same grid, right under the row of six, and unfold
    HORIZONTALLY (two or three compact lines instead of a tall column). */}
<div className="w-full grid gap-1 items-stretch grid-cols-6">

{/* ── A · Proteins ─────────────────────────────────────────────────────── */}
<VMenu open={openMenu === 'protein'} onToggle={() => setOpenMenu(openMenu === 'protein' ? null : 'protein')}
  id="viewer-menu-proteins" label="A · Proteins" accent="blue"
  summary={`Backbone: ${catStyles.protein.backbone} · Side chains: ${sidechainStyle} · Surface: ${catStyles.protein.surface}${catStyles.protein.surfaceColor === 'esp' ? ' (ESP)' : ''}`}>
  <VRow label="Backbone" title="How the protein backbone is drawn. Cartoon = NGL cartoon (helices + sheets); Trace (C-α) = NGL's own trace, a spline through the C-α atoms; Tube = thin cartoon. Hide draws no backbone.">
    <VSel value={catStyles.protein.backbone} onChange={(e) => setCatStyle('protein', 'backbone', e.target.value)} title="Protein backbone representation" width="w-44">
      <option value="cartoon">Cartoon</option>
      <option value="trace">Trace (C-α)</option>
      <option value="tube">Tube</option>
      <option value="ribbon">Ribbon</option>
      <option value="licorice">Licorice (sticks)</option>
      <option value="ball+stick">Ball &amp; Stick (whole residue)</option>
      <option value="sticks">Sticks (backbone atoms only)</option>
      <option value="lines">Lines</option>
      <option value="spheres">Spheres</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Side chains" title="Representation of the protein side chains (+ C-α, so the fold stays readable). « Licorice » (= sticks) is the default; « Lines » is the cheapest — use it on big systems. It obeys this menu's Atom colour / Sphere radius / Bond radius.">
    <VSel value={sidechainStyle} onChange={(e) => { leaveLightMode(); setSidechainStyle(e.target.value); }} title="Protein side-chain representation" width="w-44">
      <option value="licorice">Licorice (sticks)</option>
      <option value="line">Lines (saves resources)</option>
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="spacefill">Spacefill</option>
      <option value="none">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Surface" title="NGL molecular surface of the PROTEIN part only. Solid = opaque, Transparent = the Opacity slider below decides (40 % by default, the cartoon stays visible), Mesh = wireframe. Hide removes it.">
    <VSel value={catStyles.protein.surface} onChange={(e) => setCatStyle('protein', 'surface', e.target.value)} title="Protein surface" width="w-40">
      <option value="solid">Solid</option>
      <option value="transparent">Transparent</option>
      <option value="mesh">Mesh (wireframe)</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  {renderSurfaceOpacity('protein')}
  {renderSurfaceColour('protein', 'protein')}
  {renderAtomColour('protein')}
  {renderCatRadii('protein')}
  <VRow label="Colours" title="Secondary-structure colours (helix / sheet / loop), the highlight colours and the renumbering tool — plus ↺, which puts THIS menu's radii and colours back to their defaults (the styles themselves are never touched).">
    {renderColoursButton('protein')}
    <button type="button" onClick={() => setShowRenumberPanel((v) => !v)}
      className={`px-2 py-1 text-[10px] font-bold rounded border ${showRenumberPanel ? 'bg-blue-100 border-blue-400 text-blue-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
      🔢 {showRenumberPanel ? 'Hide renumber' : 'Renumber…'}
    </button>
    <button type="button" onClick={() => resetCatLook('protein')}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
      title="Reset this menu's Sphere radius / Bond radius / atom colour / surface colour to their defaults (1.00× and element colours) — the styles stay as they are">
      ↺ Reset radii &amp; colours
    </button>
  </VRow>
  {renderCatLabels('protein')}
</VMenu>

{/* ── B · Nucleic acids ───────────────────────────────────────────────── */}
<VMenu open={openMenu === 'nucleic'} onToggle={() => setOpenMenu(openMenu === 'nucleic' ? null : 'nucleic')}
  id="viewer-menu-nucleic" label="B · Nucleic acids" accent="violet"
  summary={`Backbone: ${catStyles.nucleic.backbone} · Bases: ${catStyles.nucleic.bases} · Surface: ${catStyles.nucleic.surface}${catStyles.nucleic.surfaceColor === 'esp' ? ' (ESP)' : ''}`}>
  <VRow label="Backbone" title="Cartoon = NGL's nucleic cartoon: the flat backbone RIBBON. Together with Bases = Filled rings or Stylized rings it gives the classic stylized DNA / RNA look (a ribbon with the coloured base plates inside it). Phosphate Trace = NGL trace, a spline through the phosphate atoms (P) of each nucleotide; Hide draws no backbone.">
    <VSel value={catStyles.nucleic.backbone} onChange={(e) => setCatStyle('nucleic', 'backbone', e.target.value)} title="Nucleic backbone representation" width="w-44">
      <option value="cartoon">Cartoon</option>
      <option value="trace">Phosphate Trace (P)</option>
      <option value="tube">Tube</option>
      <option value="ribbon">Ribbon</option>
      <option value="licorice">Licorice (sticks)</option>
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="lines">Lines</option>
      <option value="spheres">Spheres</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Bases" title="Filled rings (slabs / boxes) = NGL's own « base » representation — the flat plates (rungs) of the base ladder, i.e. the slabs that fill the inside of the base rings. Stylized rings = the same filled plates, but coloured INSIDE by the identity of each base (A · C · G · T · U) with a thin coloured ring of sticks over the base atoms — with Backbone = Cartoon this is the stylized DNA / RNA look. Licorice (sticks) draws the base atoms as sticks, Lines as bonds (cheapest). Hide removes the bases.">
    <VSel value={catStyles.nucleic.bases} onChange={(e) => setCatStyle('nucleic', 'bases', e.target.value)} title="Nucleic bases representation" width="w-48">
      <option value="slab">Filled rings (slabs / boxes)</option>
      <option value="rings">Stylized rings (coloured inside)</option>
      <option value="sticks">Licorice (sticks)</option>
      <option value="lines">Lines</option>
      <option value="spheres">Spheres</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Surface" title="NGL molecular surface of the NUCLEIC part only: Solid / Transparent (40 %) / Mesh (wireframe) / Hide.">
    <VSel value={catStyles.nucleic.surface} onChange={(e) => setCatStyle('nucleic', 'surface', e.target.value)} title="Nucleic surface" width="w-40">
      <option value="solid">Solid</option>
      <option value="transparent">Transparent</option>
      <option value="mesh">Mesh (wireframe)</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  {renderSurfaceOpacity('nucleic')}
  {renderSurfaceColour('nucleic', 'nucleic')}
  {renderAtomColour('nucleic')}
  {renderCatRadii('nucleic')}
  <VRow label="Colours" title="Colours of the NUCLEIC ACID itself (phosphate backbone · pentose rings · bases) — the 🎨 button opens that panel at the end of this section; plus the renumbering tool and ↺ (radii and colours of THIS menu back to their defaults).">
    {renderColoursButton('nucleic')}
    <button type="button" onClick={() => setShowRenumberPanel((v) => !v)}
      className={`px-2 py-1 text-[10px] font-bold rounded border ${showRenumberPanel ? 'bg-blue-100 border-blue-400 text-blue-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
      🔢 {showRenumberPanel ? 'Hide renumber' : 'Renumber…'}
    </button>
    <button type="button" onClick={() => resetCatLook('nucleic')}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
      title="Reset this menu's Sphere radius / Bond radius / atom colour / surface colour to their defaults (1.00× and element colours) — the styles and the group colours stay as they are">
      ↺ Reset radii &amp; colours
    </button>
  </VRow>
  {renderCatLabels('nucleic')}
</VMenu>

{/* ── C · Lipids ──────────────────────────────────────────────────────── */}
<VMenu open={openMenu === 'lipid'} onToggle={() => setOpenMenu(openMenu === 'lipid' ? null : 'lipid')}
  id="viewer-menu-lipids" label="C · Lipids" accent="amber"
  summary={`Headgroups: ${catStyles.lipid.head} · Acyl chains: ${catStyles.lipid.tail} · ${lipidHint}`}>
  <VRow label="Headgroups" title="The polar head of each lipid: EVERY atom of the lipid that is neither an acyl-chain atom nor a glycerol-backbone atom — the phosphate (P with its oxygens O11…O14), the choline / ethanolamine / serine / inositol nitrogen and carbons, and every hydrogen of them. The headgroup is defined by EXCLUSION of the two other parts, so it is complete: a headgroup drawn as Ball & Stick shows all its atoms with all their bonds (naming it positively left the choline carbons and the head hydrogens out, which cut the head into disconnected fragments). Spheres = spacefill, Ball & Stick and the stick / line styles are finer options, Hide removes the headgroups. When a file does not follow the standard atom naming the parts are read by element instead (the polar N · P · O · S atoms are the headgroup).">
    <VSel value={catStyles.lipid.head} onChange={(e) => setCatStyle('lipid', 'head', e.target.value)}
      disabled={lipidMenuInactive} title="Lipid headgroup representation" width="w-44">
      <option value="spheres">Spheres</option>
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="licorice">Licorice (sticks)</option>
      <option value="line">Lines</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Glycerol backbone" title="The three-carbon backbone the two chains hang from, in the standard CHARMM / AMBER naming: the carbons C1 · C2 · C3, the ester oxygens O21 · O31 and the hydrogens of those carbons (HA · HB · HS · HX · HY). Styled independently from the headgroups and the chains, so the bilayer scaffolding can be followed on its own. A file whose atoms are named after their element cannot be read that way (the backbone is then left with the headgroups).">
    <VSel value={catStyles.lipid.glycerol} onChange={(e) => setCatStyle('lipid', 'glycerol', e.target.value)}
      disabled={lipidMenuInactive} title="Lipid glycerol-backbone representation" width="w-44">
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="sticks">Sticks</option>
      <option value="spheres">Spheres</option>
      <option value="lines">Lines</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Acyl chains" title="The two hydrophobic tails: the sn-1 / sn-2 carbons (C21 … C31 …), the ester carbonyl oxygens O22 · O32 and every hydrogen of those carbons. Lines is the default — the lightest style that still shows the bilayer; Sticks is denser. The chains are never mixed with the headgroups: every atom of a lipid belongs to exactly one of the three parts.">
    <VSel value={catStyles.lipid.tail} onChange={(e) => setCatStyle('lipid', 'tail', e.target.value)}
      disabled={lipidMenuInactive} title="Lipid acyl-chain representation" width="w-44">
      <option value="lines">Lines (default)</option>
      <option value="sticks">Licorice (sticks)</option>
      <option value="spheres">Spheres</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <p className="text-[10px] text-slate-400 italic">NGL has no « lipid » selection keyword, so lipids are recognised by residue name — the base selection is <b>[POPC] or [DPPC] or … or [PAL]</b> plus any other lipid this file declares; headgroups / glycerol backbone / acyl chains are then separated by ATOM NAME (C1 · C2 · C3 · O21 · O31 = backbone, C21… · C31… · O22 · O32 = chains, everything else = headgroup) — see the 🎨 Colours panel of this menu. {lipidHint}.{lipidNamingHint}</p>
  <VRow label="Surface" title="NGL molecular surface of the LIPID part only — the bilayer as one plate: Solid / Transparent (the Opacity slider appears underneath) / Mesh (wireframe) / Hide. Hidden by default: the surface of a whole bilayer is heavy.">
    <VSel value={catStyles.lipid.surface} onChange={(e) => setCatStyle('lipid', 'surface', e.target.value)}
      disabled={lipidMenuInactive} title="Lipid surface" width="w-40">
      <option value="solid">Solid</option>
      <option value="transparent">Transparent</option>
      <option value="mesh">Mesh (wireframe)</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  {renderSurfaceOpacity('lipid')}
  {renderSurfaceColour('lipid', 'lipid')}
  {renderAtomColour('lipid')}
  {renderCatRadii('lipid')}
  <VRow label="Colours" title="Colours of the LIPID itself (headgroup · glycerol backbone · acyl chains) — the 🎨 button opens that panel at the end of this section; plus ↺, which puts THIS menu's radii and colours (not the part colours) back to their defaults.">
    {renderColoursButton('lipid')}
    <button type="button" onClick={() => resetCatLook('lipid')}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100"
      title="Reset this menu's Sphere radius / Bond radius / atom colour / surface colour to their defaults (1.00× and element colours) — the headgroups / glycerol / acyl-chain styles and the part colours stay as they are.">
      ↺ Reset radii &amp; colours
    </button>
  </VRow>
  {renderCatLabels('lipid')}
</VMenu>

{/* ── D · Sugars (carbohydrates) ──────────────────────────────────────── */}
<VMenu open={openMenu === 'sugar'} onToggle={() => setOpenMenu(openMenu === 'sugar' ? null : 'sugar')}
  id="viewer-menu-sugars" label="D · Sugars" accent="rose"
  summary={`Style: ${catStyles.sugar.style} · Surface: ${catStyles.sugar.surface} · ${sugarHint}`}>
  <VRow label="Style" title="Representation of the sugars / glycans ONLY. NGL 2.4 has no « carbohydrate » keyword — the real one is « saccharide », to which the explicit residue list [GLC] [NAG] [MAN] [BMA] [SIA] [GAL] [FUC] is added, so an N-glycan, a glycolipid head or a free monosaccharide is styled here and NEVER as a generic ligand.">
    <VSel value={catStyles.sugar.style} onChange={(e) => setCatStyle('sugar', 'style', e.target.value)} title="Sugar representation" width="w-44">
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="sticks">Licorice (sticks)</option>
      <option value="spheres">Spheres</option>
      <option value="lines">Lines</option>
      <option value="spacefill">Spacefill (full VdW)</option>
      <option value="surface">Surface</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Surface" title="NGL molecular surface of the sugars only: Solid / Transparent (the Opacity slider appears underneath) / Mesh (wireframe) / Hide.">
    <VSel value={catStyles.sugar.surface} onChange={(e) => setCatStyle('sugar', 'surface', e.target.value)} title="Sugar surface" width="w-40">
      <option value="solid">Solid</option>
      <option value="transparent">Transparent</option>
      <option value="mesh">Mesh (wireframe)</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  {renderSurfaceOpacity('sugar')}
  {renderSurfaceColour('sugar', 'sugar')}
  {renderAtomColour('sugar')}
  {renderCatRadii('sugar')}
  <p className="text-[10px] text-slate-400 italic">Selection: <b>saccharide or [GLC] or [NAG] or [MAN] or [BMA] or [SIA] or [GAL] or [FUC]</b> — the Organic (ligands) menu excludes exactly this selection. {sugarHint}.</p>
  <VRow label="Defaults" title="Put this menu's Sphere radius / Bond radius / atom colour / surface colour back to their defaults (1.00× and element colours) — the style stays as it is.">
    <button type="button" onClick={() => resetCatLook('sugar')}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100">
      ↺ Reset radii &amp; colours
    </button>
  </VRow>
  {renderCatLabels('sugar')}
</VMenu>

{/* ── E · Organic molecules (ligands / small molecules) ───────────────── */}
<VMenu open={openMenu === 'organic'} onToggle={() => setOpenMenu(openMenu === 'organic' ? null : 'organic')}
  id="viewer-menu-organic" label="E · Ligands" accent="emerald"
  summary={`Style: ${catStyles.organic.style} · Surface: ${catStyles.organic.surface}${catStyles.organic.surfaceColor === 'esp' ? ' (ESP)' : ''}`}>
  <VRow label="Style" title="Representation of the ligands / small molecules. The selection is strictly « hetero and not water and not ion » MINUS the lipids and MINUS the sugars (both have their own menu), and it becomes everything that is not polymer / lipid / sugar / water / ion when the condition itself is a small organic compound.">
    <VSel value={catStyles.organic.style} onChange={(e) => setCatStyle('organic', 'style', e.target.value)} title="Ligand representation" width="w-44">
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="sticks">Licorice (sticks)</option>
      <option value="spacefill">Spacefill</option>
      <option value="lines">Lines</option>
      <option value="spheres">Spheres</option>
      <option value="surface">Surface</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Surface" title="NGL molecular surface of the ligands / small molecules only: Solid / Transparent (the Opacity slider appears underneath) / Mesh (wireframe) / Hide.">
    <VSel value={catStyles.organic.surface} onChange={(e) => setCatStyle('organic', 'surface', e.target.value)} title="Ligand surface" width="w-40">
      <option value="solid">Solid</option>
      <option value="transparent">Transparent</option>
      <option value="mesh">Mesh (wireframe)</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  {renderSurfaceOpacity('organic')}
  {renderSurfaceColour('organic', 'ligand')}
  {renderAtomColour('organic')}
  {renderCatRadii('organic')}
  <VRow label="Defaults" title="Put this menu's Sphere radius / Bond radius / atom colour / surface colour back to their defaults (1.00× and element colours) — the style stays as it is.">
    <button type="button" onClick={() => resetCatLook('organic')}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100">
      ↺ Reset radii &amp; colours
    </button>
  </VRow>
  {renderCatLabels('organic')}
</VMenu>

{/* ── E · Others (ions, solvent / water) ─────────────────────────────── */}
<VMenu open={openMenu === 'other'} onToggle={() => setOpenMenu(openMenu === 'other' ? null : 'other')}
  id="viewer-menu-others" label="F · Others · water" accent="sky"
  summary={`Ions: ${catStyles.other.ion} · Water: ${catStyles.other.water} · Water surface: ${catStyles.other.surface}`}>
  <VRow label="Ions" title="Metal / halide ions (Na⁺, K⁺, Cl⁻, Mg²⁺, Ca²⁺, Zn²⁺ …). Spheres = spacefill on the ion selection.">
    <VSel value={catStyles.other.ion} onChange={(e) => setCatStyle('other', 'ion', e.target.value)} title="Ion representation" width="w-44">
      <option value="spheres">Spheres</option>
      <option value="ball+stick">Ball &amp; Stick</option>
      <option value="dots">Dots (lightest)</option>
      <option value="lines">Lines</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  <VRow label="Water" title="Solvent. Hidden by default (water dominates the atom count of a solvated box and hides the solute). Dots = one point per oxygen (NGL dot representation — NGL has no « cross » primitive, dots are its lightest water style), Points = sized points, Spheres = tiny spacefill.">
    <VSel value={catStyles.other.water} onChange={(e) => setCatStyle('other', 'water', e.target.value)} title="Water representation" width="w-44">
      <option value="hidden">Hide</option>
      <option value="dots">Dots (lightest)</option>
      <option value="points">Points (sized)</option>
      <option value="lines">Lines</option>
      <option value="spheres">Spheres</option>
      <option value="ball+stick">Ball &amp; Stick</option>
    </VSel>
  </VRow>
  <VRow label="Water surface" title="The SURFACE of the water selection: it is applied on its own (NGL surface on the `water` selection), so the solvent shell can be shown as a solid / transparent / mesh surface even with the water atoms hidden (set Water = Hide above) and even in a system whose other selections do not cover the water. Transparent reveals the Opacity slider underneath.">
    <VSel value={catStyles.other.surface} onChange={(e) => setCatStyle('other', 'surface', e.target.value)} title="Water surface" width="w-40">
      <option value="solid">Solid</option>
      <option value="transparent">Transparent</option>
      <option value="mesh">Mesh (wireframe)</option>
      <option value="hide">Hide</option>
    </VSel>
  </VRow>
  {renderSurfaceOpacity('other', 'Water opacity')}
  {renderSurfaceColour('other', 'water')}
  {renderAtomColour('other')}
  {renderCatRadii('other')}
  <VRow label="Defaults" title="Put this menu's Sphere radius / Bond radius / atom colour / surface colour back to their defaults (1.00× and element colours) — the ion / water styles stay as they are.">
    <button type="button" onClick={() => resetCatLook('other')}
      className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-slate-300 text-slate-600 hover:bg-slate-100">
      ↺ Reset radii &amp; colours
    </button>
  </VRow>
  {/* A large system STARTS in the lightweight layout (everything in ONE cheap
      style, water off unless ticked): this row describes that fast view and lets
      it be changed. It is NOT a lock — as soon as a style is chosen in any menu
      of §2, the system is redrawn with those per-category representations
      (leaveLightMode) and this row disappears together with the mode. */}
  {lightRender && (
    <VRow label="Large system" title={`Large systems (>25 000 atoms or a >1.5 MB structure) start in this fast layout: EVERY atom drawn in one cheap representation${lightInfo && lightInfo.nAtoms ? ` (${lightInfo.nAtoms.toLocaleString()} atoms)` : ''}, water left out until 💧 Water is ticked. It is only the STARTING view — choose a style in any menu of §2 (or the one below) and the system is drawn with the per-category representations at once.`}>
      <select
        title="Large structure style (lightweight start): the style of EVERY atom — water is not drawn unless you tick 💧 Water"
        value={largeStyle}
        onChange={(e) => setLargeStyle(e.target.value)}
        className="border border-sky-300 rounded-md px-1.5 py-1 text-[11px] bg-sky-50 text-sky-800 outline-none focus:border-sky-500 h-7 w-44"
      >
        <option value="lines">Large: Lines (all atoms)</option>
        <option value="spheres">Large: Spheres</option>
        <option value="dots">Large: Dots (lightest)</option>
      </select>
      <label title="Water is NOT drawn in large systems by default (it dominates the atom count of solvated / membrane systems and hides the protein); tick to show it with the same lightweight style" className="flex items-center gap-1 text-[10px] font-bold text-sky-800 cursor-pointer h-7 whitespace-nowrap">
        <input
          type="checkbox"
          checked={showLargeWater}
          onChange={(e) => setShowLargeWater(e.target.checked)}
          className="w-3.5 h-3.5 accent-sky-600"
        />
        💧 Water
      </label>
    </VRow>
  )}
  {renderCatLabels('other')}
</VMenu>

</div>
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
onClick={() => setShowRenumberPanel((v) => !v)}
title="Renumber residues"
className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-md px-2 py-1.5 h-8 whitespace-nowrap"
>
🔢 Renumber{showRenumberPanel ? ' ▲' : ' ▼'}
</button>
{showRenumberPanel && residueInfo.length > 0 && (
<div className="border border-slate-200 rounded-lg bg-white shadow-sm p-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
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
{residueInfo.map((r, i) => (
<div key={r.resno} className="flex items-center gap-1.5 text-[10px] font-mono text-slate-600">
<span className="w-3 text-slate-400">{i + 1}.</span>
<span className="flex-1 truncate">{r.resname}{r.resno}</span>
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
</div>
)}
</div>

{/* ── Shared tools of §2 — the panels opened by the 🎨 Colours / 🔢 Renumber
    buttons of the A (Proteins) and B (Nucleic acids) menus. ─────────────── */}
{showColoursPanel && (
  <div className="w-full bg-rose-50/40 border border-rose-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-black text-rose-700 uppercase tracking-wide">Custom colours</span>
      <button type="button" onClick={() => {
        leaveLightMode();   // the swatches are a styling choice too
        setSstrucColors({ helix: 0xb44a90, sheet: 0xf8d878, loop: 0xe6e6e6 });
        setSelectedResidueColor(SELECT_COLOR_HEX);
        setAssignedAtomColor(MANUAL_COLOR_HEX);
      }}
        className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-rose-300 text-rose-700 hover:bg-rose-100"
        title="Restore the default viewer colours">
        ↺ Reset defaults
      </button>
    </div>
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {/* Per-element secondary-structure colours — used wherever the colour
          mode is "2° structure" (Molecules bar / Selections panel). */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-black text-slate-600 uppercase">Secondary structure</span>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of α-helices (incl. 3₁₀ and π helices) when coloured by 2° structure">
          <input type="color" value={numToHex(sstrucColors.helix)}
            onChange={(e) => { leaveLightMode(); setSstrucColors((c) => ({ ...c, helix: parseInt(e.target.value.slice(1), 16) })); }}
            className="w-8 h-7 rounded border cursor-pointer" />
          Helices
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of β-sheets / β-strands when coloured by 2° structure">
          <input type="color" value={numToHex(sstrucColors.sheet)}
            onChange={(e) => { leaveLightMode(); setSstrucColors((c) => ({ ...c, sheet: parseInt(e.target.value.slice(1), 16) })); }}
            className="w-8 h-7 rounded border cursor-pointer" />
          Sheets
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of loops / coils (everything that is not a helix or a sheet) when coloured by 2° structure">
          <input type="color" value={numToHex(sstrucColors.loop)}
            onChange={(e) => { leaveLightMode(); setSstrucColors((c) => ({ ...c, loop: parseInt(e.target.value.slice(1), 16) })); }}
            className="w-8 h-7 rounded border cursor-pointer" />
          Loops / coils
        </label>
      </div>
      {/* Residue-highlight colours. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-black text-slate-600 uppercase">Residue highlights</span>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the residues you select (residue strip / atom clicks / selections)">
          <input type="color" value={numToHex(selectedResidueColor)}
            onChange={(e) => setSelectedResidueColor(parseInt(e.target.value.slice(1), 16))}
            className="w-8 h-7 rounded border cursor-pointer" />
          Selected residues
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the manually-assigned atoms (the 🟢 Assigned toggle)">
          <input type="color" value={numToHex(assignedAtomColor)}
            onChange={(e) => setAssignedAtomColor(parseInt(e.target.value.slice(1), 16))}
            className="w-8 h-7 rounded border cursor-pointer" />
          Assigned atoms
        </label>
      </div>
    </div>
    <p className="text-[10px] text-slate-400 italic">Saved and persists across pages. “Secondary structure” colours apply everywhere the “2° structure” colour mode is used (Molecules bar / Selections panel).</p>
  </div>
)}
{/* 🔬 The colour panel of the B (Nucleic acids) menu. This is where the shared
    panel above — helix / sheet / loop, a PROTEIN notion — is replaced for a
    nucleic acid: here the molecule is recoloured by CHEMICAL GROUP — phosphate
    backbone · pentose rings · bases. « Colour by chemical group » switches every
    nucleic representation of the menus to the lab-nucleic-groups scheme; the
    swatches feed it LIVE (the scheme reads the store, so no representation is
    rebuilt), and the three values live in catStyles.nucleic — persisted with the
    menus and captured by a ⚙️ setup. */}
{showNucleicColoursPanel && (
  <div className="w-full bg-violet-50/50 border border-violet-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[10px] font-black text-violet-700 uppercase tracking-wide">Nucleic-acid colours</span>
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer" title="Colour every nucleic acid by its three chemical groups — phosphate backbone · pentose rings · bases — instead of the rainbow by residue index (and the resname palette of the base rungs). The three swatches below are applied live.">
        <input type="checkbox" checked={!!catStyles.nucleic.groupColour}
          onChange={(e) => setCatStyle('nucleic', 'groupColour', e.target.checked)}
          className="w-3.5 h-3.5 accent-violet-600" />
        Colour by chemical group
      </label>
      <button type="button" onClick={resetNucleicColours}
        className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-violet-300 text-violet-700 hover:bg-violet-100"
        title="Put the three group colours back to their defaults (the switch is left as it is)">
        ↺ Reset colours
      </button>
    </div>
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the PHOSPHATE backbone: the phosphorus and its non-bridging oxygens — P, OP1, OP2, OP3 (and O1P / O2P / O3P), with their hydrogens.">
        <input type="color" value={numToHex(catStyles.nucleic.phosphateColor)}
          onChange={(e) => setNucleicColour('phosphateColor', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border cursor-pointer" />
        Phosphate backbone
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the PENTOSE rings: every PRIMED atom name — C1'…C5', O2'…O5', O4', H1'…H5'', HO2'/HO3'/HO5' (the older files spell the prime « * », C1*) — i.e. the ribose / 2'-deoxyribose ring and its exocyclic CH2-OH.">
        <input type="color" value={numToHex(catStyles.nucleic.pentoseColor)}
          onChange={(e) => setNucleicColour('pentoseColor', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border cursor-pointer" />
        Pentose ring
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the BASES: everything that is neither phosphate nor pentose — N1 / N2 / N3 / N4 / N6 / N7 / N9, C2 / C4 / C5 / C6 / C8, O2 / O4 / O6, C5M / CH3 and their hydrogens. (The Bases dropdown also has « Stylized rings », which colours each base by its own identity — A · C · G · T · U.)">
        <input type="color" value={numToHex(catStyles.nucleic.baseColor)}
          onChange={(e) => setNucleicColour('baseColor', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border cursor-pointer" />
        Bases
      </label>
    </div>
    <p className="text-[10px] text-slate-400 italic">The group of an atom is read from its ATOM NAME: <b>P · OP1 · OP2 · OP3</b> (and O1P / O2P / O3P) = phosphate, every <b>primed</b> name (C1'…C5', O2'…O5', O4', H1'…H5'' — or the older C1* spelling) = pentose ring, everything else (N1…N9, C2 · C4…C8, O2 · O4 · O6, C5M) = bases. Changing a swatch switches the group colouring on; saved and persistent across pages, and part of a ⚙️ setup.</p>
  </div>
)}
{/* 🧫 The colour panel of the C (Lipids) menu — the same idea as menu B's, for
    the three chemical PARTS of a lipid: headgroup · glycerol backbone · acyl
    chains. « Colour by chemical part » switches every lipid representation to the
    lab-lipid-groups scheme, the swatches feed it LIVE (the scheme reads the
    store, so no representation is rebuilt), and the three values live in
    catStyles.lipid — persisted with the menus and captured by a ⚙️ setup. The
    headgroup is the EXCLUSION of the two other parts, so the parts tile every
    lipid: nothing is drawn twice, nothing is forgotten. */}
{showLipidColoursPanel && (
  <div className="w-full bg-amber-50/50 border border-amber-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[10px] font-black text-amber-700 uppercase tracking-wide">Lipid colours</span>
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer" title="Colour every lipid by its three chemical PARTS — the polar headgroup, the glycerol backbone and the two acyl chains — instead of the element colours (or the flat colour of this menu). The three swatches below are applied live.">
        <input type="checkbox" checked={!!catStyles.lipid.groupColour}
          onChange={(e) => setCatStyle('lipid', 'groupColour', e.target.checked)}
          className="w-3.5 h-3.5 accent-amber-600" />
        Colour by chemical part
      </label>
      <button type="button" onClick={resetLipidColours}
        className="px-2 py-1 text-[10px] font-bold rounded border bg-white border-amber-300 text-amber-700 hover:bg-amber-100"
        title="Put the three part colours back to their defaults (the switch is left as it is)">
        ↺ Reset colours
      </button>
    </div>
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the HEADGROUP: every atom of the lipid that is neither a glycerol-backbone atom nor an acyl-chain atom — the phosphate (P with its oxygens O11…O14), the choline / ethanolamine nitrogen and its carbons, and every hydrogen of the head. The headgroup is defined by EXCLUSION of the two other parts, so a headgroup shown as Ball & Stick keeps all its atoms and all their bonds.">
        <input type="color" value={numToHex(catStyles.lipid.headColor)}
          onChange={(e) => setLipidColour('headColor', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border cursor-pointer" />
        Headgroup
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the GLYCEROL backbone: the three carbons C1 · C2 · C3, the two ester oxygens the chains hang from (O21 · O31) and the hydrogens of those carbons (HA · HB · HS · HX · HY) in the standard CHARMM / AMBER naming.">
        <input type="color" value={numToHex(catStyles.lipid.glycerolColor)}
          onChange={(e) => setLipidColour('glycerolColor', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border cursor-pointer" />
        Glycerol backbone
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700" title="Colour of the ACYL CHAINS: the sn-1 / sn-2 carbons (C21 … C216 / C31 … C316), the two ester carbonyl oxygens O22 · O32 and every hydrogen of those carbons.">
        <input type="color" value={numToHex(catStyles.lipid.tailColor)}
          onChange={(e) => setLipidColour('tailColor', parseInt(e.target.value.slice(1), 16))}
          className="w-8 h-7 rounded border cursor-pointer" />
        Acyl chains
      </label>
    </div>
    <p className="text-[10px] text-slate-400 italic">The part of an atom is read from its ATOM NAME: <b>C1 · C2 · C3 · O21 · O31</b> = the glycerol backbone, <b>C21… C216 / C31… C316 · O22 · O32</b> = the acyl chains, and EVERYTHING ELSE — the phosphate, the choline / ethanolamine nitrogen, all the head carbons and every head hydrogen — = the headgroup, which is therefore never cut into fragments: the three parts tile each lipid exactly, so a headgroup drawn as Ball &amp; Stick really contains all its atoms and all their bonds.{lipidNamingHint} Changing a swatch switches the part colouring on; saved and persistent across pages, and part of a ⚙️ setup.</p>
  </div>
)}
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
  title="Paste or load a PyMOL script (select / show / hide / color / set sphere_scale·transparency / bg_color / cartoon · ribbon · tube / surface / spectrum / util.ray_shadows). Parsed selections appear in the vertical bar on the right of the 3D viewer.">
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
    <label className="text-[10px] font-bold text-slate-500 uppercase">Paste a PyMOL script (select / show / hide / color / set sphere_scale·transparency / bg_color / cartoon · ribbon · tube / surface / spectrum / util.ray_shadows)</label>
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
        ✓ {selections.length} selection(s) parsed — toggle them in the vertical bar on the right of the 3D viewer.
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
  const thinStep = polyTicks.length > 900 ? 5 : polyTicks.length > 450 ? 3 : polyTicks.length > 200 ? 2 : 1;
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
    <div className="flex gap-0.5 overflow-x-auto custom-scrollbar items-stretch py-0.5">
      {polyTicks.map((r, i) => {
        if (thinStep > 1 && i % thinStep !== 0) return null;
        const isSel = selectedKeys && selectedKeys.some((k) => parseInt(String(k).split('-')[0], 10) === r.resno - 1);
        return (
          <button key={`${r.chainid}-${r.resno}`} type="button"
            onClick={(e) => handleResidueTickClick(r, e)}
            title={`${r.resname} ${r.resno}${r.chainid ? ` (chain ${r.chainid})` : ''} — click to select, Ctrl/Cmd/Shift-click to add to a multi-residue selection, Shift+click after another tick to select a range`}
            className={`w-7 h-9 shrink-0 rounded-md border flex flex-col items-center justify-center gap-px leading-none transition-colors ${isSel ? 'bg-amber-400 border-amber-600' : 'bg-white border-slate-300 hover:border-amber-400 hover:bg-amber-50'}`}>
            <span className="text-[6px] font-bold text-slate-400 leading-none">{r.resno}</span>
            <span className={`text-[10px] font-black leading-none ${isSel ? 'text-amber-950' : 'text-slate-700'}`}>{r.code || (r.resname ? r.resname.slice(0, 1) : '?')}</span>
          </button>
        );
      })}
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

{/* Vertical Molecules bar (right side) — every loaded structure / chain, each with
    its own visibility, style and colour; click a row to select & centre it. */}
{extraMols.length > 0 && (
  <div className="absolute top-2 right-2 bottom-2 w-80 z-40 flex flex-col gap-2 bg-white/95 border border-blue-200 rounded-xl shadow-lg p-2 overflow-hidden">
    <div className="flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] font-black text-blue-700 uppercase tracking-wide">Molecules</span>
      <span className="flex gap-1">
        <button type="button"
          onClick={() => setVisibleMolKeys(new Set(extraCompsRef.current.map(({ id }) => id).concat(['main'])))}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-blue-300 text-blue-600 hover:bg-blue-50"
          title="Show every structure">All</button>
        <button type="button"
          onClick={() => setVisibleMolKeys(new Set(['main']))}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-slate-300 text-slate-500 hover:bg-slate-50"
          title="Show only the main structure">Main</button>
        <button type="button" onClick={applyActiveStyleToAll}
          className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          title="Apply the ACTIVE (selected) structure's style / colour / transparency to every other molecule — handy for a series of docked structures that should all look the same">
          🎨 Copy</button>
        <button type="button" onClick={toggleDockStyle}
          className={`px-1.5 py-0.5 text-[9px] font-bold rounded border transition-colors ${dockStyleMode ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-teal-300 text-teal-700 hover:bg-teal-50'}`}
          title="Standardize DOCKING results: every cluster/pose (current and future) is drawn with the styles of section « 2 · Molecular Styling » of the toolbar — the only style menus of the docking look. Switch off to restore each molecule's own style.">
          🧬 Docking: {dockStyleMode ? 'On' : 'Off'}</button>
      </span>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1 min-h-0">
      <div onClick={() => autoViewMol('main')}
        className={`flex items-center gap-1.5 text-[10px] font-bold rounded px-1 py-0.5 cursor-pointer ${selectedMolKey === 'main' ? 'bg-blue-100 border border-blue-300' : 'hover:bg-blue-50'}`}
        title="Main structure — click to select & centre it">
        <input type="checkbox" checked={visibleMolKeys.has('main')} onChange={(e) => { e.stopPropagation(); toggleMol('main'); }} className="accent-blue-600 w-3.5 h-3.5" />
        <span className="truncate text-slate-700 flex-1">Main{file ? ` (${file.name})` : ''}</span>
      </div>
      {/* Main structure controls — same as the extra molecules: style, colour,
          transparency, Move X/Y/Z and ✋ drag. "Auto" follows the global
          Backbone / Molecule Style selectors. */}
      <div className="flex items-center gap-1 mt-0.5 pl-5">
        <select value={mainMol.style || 'auto'} onChange={(e) => setMainMol((m) => ({ ...m, style: e.target.value }))}
          className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-24" title="Representation style for the main structure (Auto follows the global Backbone / Molecule Style)">
          <option value="auto">Auto</option>
          <option value="cartoon">Cartoon</option>
          <option value="ribbon">Ribbon</option>
          <option value="ball+stick">Ball &amp; stick</option>
          <option value="sticks">Sticks</option>
          <option value="lines">Lines</option>
          <option value="spheres">Spheres</option>
          <option value="surface">Surface</option>
        </select>
        <label className="text-[10px] text-slate-400 font-bold flex items-center gap-0.5" title="Colouring of the main structure (applies to the chosen style above)">
          Colour
          <select value={mainMol.colorMode || 'element'} onChange={(e) => setMainMol((m) => ({ ...m, colorMode: e.target.value }))}
            className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-20" title="Colouring metaphor">
            <option value="solid">Solid</option>
            <option value="element">Atom type</option>
            <option value="chainid">Chain</option>
            <option value="resname">Residue</option>
            <option value="sstruc">2° structure</option>
            <option value="hydrophobicity">Hydrophobicity</option>
          </select>
        </label>
        <input type="color" value={mainMol.color || '#dddddd'} disabled={(mainMol.colorMode || 'element') !== 'solid'}
          onChange={(e) => setMainMol((m) => ({ ...m, color: e.target.value }))}
          className={`w-5 h-5 rounded border cursor-pointer ${(mainMol.colorMode || 'element') !== 'solid' ? 'opacity-30 cursor-not-allowed' : ''}`}
          title="Solid colour (used when Colour = Solid)" />
      </div>
      <div className="flex items-center gap-1 mt-0.5 pl-5" title="Transparency of the main structure">
        <span className="text-[10px] text-slate-400 font-bold shrink-0">Transp</span>
        <input type="range" min="0" max="1" step="0.05" value={mainMol.transparency || 0}
          onChange={(e) => setMainMol((m) => ({ ...m, transparency: parseFloat(e.target.value) }))}
          className="accent-blue-600 w-full" />
      </div>
      <div className="flex items-center gap-1 mt-0.5 pl-5" title="Move the main structure independently (Å)">
        <span className="text-[10px] text-slate-400 font-bold shrink-0">Move</span>
        {['X', 'Y', 'Z'].map((ax, ai) => (
          <label key={ax} className="flex items-center gap-0.5 text-[10px] text-slate-400 font-bold" title={`Shift the main structure along ${ax}`}>
            {ax}
            <input type="number" step="1" value={mainPos[ai] || 0}
              onChange={(e) => setMainPosition(ai, e.target.value)}
              className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-12" />
          </label>
        ))}
        <button type="button" onClick={resetMainPosition} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline" title="Reset position">↺</button>
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer" title="Move the main structure with the mouse (toggle off to rotate/zoom)">
          <input type="checkbox" checked={dragMove} onChange={(e) => { e.stopPropagation(); setDragMove(e.target.checked); }} className="accent-blue-600 w-3 h-3" />
          ✋ Drag
        </label>
      </div>
      {extraMols.map((m) => (
        <div key={m.id} className={`rounded px-1 py-0.5 border ${selectedMolKey === m.id ? 'bg-blue-100 border-blue-300' : 'border-transparent hover:bg-blue-50'}`}>
          <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => autoViewMol(m.id)} title={`${m.name} — click to select & centre it`}>
            <input type="checkbox" checked={visibleMolKeys.has(m.id)} onChange={(e) => { e.stopPropagation(); toggleMol(m.id); }} className="accent-blue-600 w-3.5 h-3.5 shrink-0" />
            <span className="truncate text-[10px] font-bold text-slate-700 flex-1">{m.name}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); deleteExtraMol(m.id); }}
              className="text-red-400 hover:text-red-600 font-bold text-[10px] px-1 shrink-0" title="Delete this structure">🗑</button>
          </div>
          <div className="flex items-center gap-1 mt-0.5 pl-5">
            <select value={m.style || 'auto'} onChange={(e) => setExtraMolStyle(m.id, e.target.value)}
              className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-24" title="Representation style for this structure">
              <option value="auto">Auto</option>
              <option value="cartoon">Cartoon</option>
              <option value="ribbon">Ribbon</option>
              <option value="ball+stick">Ball &amp; stick</option>
              <option value="sticks">Sticks</option>
              <option value="lines">Lines</option>
              <option value="spheres">Spheres</option>
              <option value="surface">Surface</option>
            </select>
            <label className="text-[10px] text-slate-400 font-bold flex items-center gap-0.5" title="Colouring of this structure (applies to the chosen style above)">
              Colour
              <select value={m.colorMode || 'element'} onChange={(e) => setExtraMolColorMode(m.id, e.target.value)}
                className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-20" title="Colouring metaphor">
                <option value="solid">Solid</option>
                <option value="element">Atom type</option>
                <option value="chainid">Chain</option>
                <option value="resname">Residue</option>
                <option value="sstruc">2° structure</option>
                <option value="hydrophobicity">Hydrophobicity</option>
              </select>
            </label>
            <input type="color" value={m.color || '#dddddd'} disabled={(m.colorMode || 'element') !== 'solid'}
              onChange={(e) => setExtraMolColor(m.id, e.target.value)}
              className={`w-5 h-5 rounded border cursor-pointer ${(m.colorMode || 'element') !== 'solid' ? 'opacity-30 cursor-not-allowed' : ''}`}
              title="Solid colour (used when Colour = Solid)" />
          </div>
          <div className="flex items-center gap-1 mt-0.5 pl-5" title="Transparency of this structure">
            <span className="text-[10px] text-slate-400 font-bold shrink-0">Transp</span>
            <input type="range" min="0" max="1" step="0.05" value={m.transparency || 0}
              onChange={(e) => setExtraMolTransparency(m.id, parseFloat(e.target.value))}
              className="accent-blue-600 w-full" />
          </div>
          <div className="flex items-center gap-1 mt-0.5 pl-5" title="Move this structure independently (Å)">
            <span className="text-[10px] text-slate-400 font-bold shrink-0">Move</span>
            {['X', 'Y', 'Z'].map((ax, ai) => (
              <label key={ax} className="flex items-center gap-0.5 text-[10px] text-slate-400 font-bold" title={`Shift this structure along ${ax}`}>
                {ax}
                <input type="number" step="1" value={(m.position && m.position[ai]) || 0}
                  onChange={(e) => setExtraMolPosition(m.id, ai, e.target.value)}
                  className="border border-slate-200 rounded text-[10px] py-0.5 px-1 w-12" />
              </label>
            ))}
            <button type="button" onClick={() => resetExtraMolPosition(m.id)} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline" title="Reset position">↺</button>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer" title="Move this structure with the mouse (toggle off to rotate/zoom)">
              <input type="checkbox" checked={dragMove} onChange={(e) => setDragMove(e.target.checked)} className="accent-blue-600 w-3 h-3" />
              ✋ Drag
            </label>
          </div>
        </div>
      ))}
    </div>
  </div>
)}

{/* Vertical selections bar (right side of the viewer) — also hosts the Abort button */}
{(selections.length > 0 || status === 'loading' || trajStatus === 'loading' || playing) && (
  <div className={`absolute top-2 ${extraMols.length > 0 ? 'right-[21rem]' : 'right-2'} bottom-2 w-64 z-30 flex flex-col gap-2 bg-white/95 border border-violet-200 rounded-xl shadow-lg p-2 overflow-hidden`}>
    {selections.length > 0 && (
    <>
    <div className="flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] font-black text-violet-700 uppercase tracking-wide">Selections</span>
      <button type="button" onClick={() => setHideAll((v) => !v)}
        className={`px-2 py-0.5 text-[9px] font-bold rounded border ${hideAll ? 'bg-red-600 text-white border-red-600' : 'bg-white border-red-300 text-red-600 hover:bg-red-50'}`}
        title={hideAll ? 'Show everything again' : 'Hide every representation'}>
        {hideAll ? 'Show all' : '🙈 Hide all'}
      </button>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 min-h-0">
      {selections.map((s) => {
        const st = selStyles[s.name] || {};
        const n = selectionAtomCount(s.name);
        return (
          <div key={s.name} className="flex flex-col gap-1 border border-slate-100 rounded-lg p-1.5 bg-white">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-xs font-bold truncate ${st.hidden ? 'text-slate-400 line-through' : 'text-slate-800'}`} title={s.expr}>{s.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-slate-400 font-mono">{n != null ? `${n} atoms` : '—'}</span>
                <button type="button"
                  onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), hidden: !st.hidden } })}
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${st.hidden ? 'bg-red-600 text-white border-red-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-red-50'}`}
                  title={st.hidden ? 'Show this selection again' : 'Hide this selection (removes its representations)'}>
                  {st.hidden ? '👁 Show' : '🙈 Hide'}
                </button>
              </div>
            </div>
            {!st.hidden && (
              <>
            <div className="flex items-center gap-1 flex-wrap">
              {['cartoon', 'ribbon', 'tube', 'ball', 'stick', 'sphere', 'surface'].map((style) => (
                <button key={style} type="button"
                  onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), [style]: !((selStylesRef.current[s.name] || {})[style]) } })}
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
    <div className="shrink-0 border-t border-slate-100 pt-1.5 mt-1">
      <button type="button" onClick={handleAbort}
        className={`w-full px-2 py-1 text-xs font-bold rounded-lg border transition-colors ${abortRef.current || playing ? 'bg-red-600 text-white border-red-600 hover:bg-red-700' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`}
        disabled={!(abortRef.current || playing)}
        title={abortRef.current ? `Abort: ${abortRef.current.label}` : playing ? 'Stop trajectory playback' : 'No operation in progress'}>
        ⏹ Abort{abortRef.current ? ` (${abortRef.current.label})` : ''}
      </button>
    </div>
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
