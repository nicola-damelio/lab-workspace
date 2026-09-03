/* =========================================================================
   src/utils/atomNameSync.js
   Atom-nomenclature alignment between the 3D structure viewer (NGL) and the
   2D SMILES-generated formula (RDKit).

   The 2D generation code is NOT touched: we read the same SMILES here,
   build an explicit-H RDKit molecule ourselves and produce names that mirror
   the 2D naming rules, so both pictures display the SAME atom names.

   Naming mirrored from the 2D formula:
     heavy atom → <ELEMENT><count>        e.g. C1, C2, N1, O1
     hydrogen   → H<parentAtomIndex>abc   e.g. H0a, H7b
   Correspondence:
     1) "index" — the NGL structure and the RDKit explicit-H molecule contain
        the same atoms in the same order (both from the same SMILES). 1:1 map
        after verifying element-by-element identity.
     2) "isomorph" — best-effort heavy-atom graph isomorphism otherwise.
   ========================================================================= */

import { loadRDKit } from './sequenceInfo';

/** Parse a V2000 molblock into elements + bond pairs (0-based indices). */
const parseMolblock = (molblock) => {
  const lines = String(molblock || '').split('\n');
  const counts = lines[3] || '';
  const nA = parseInt(counts.substring(0, 3).trim(), 10) || 0;
  const nB = parseInt(counts.substring(3, 6).trim(), 10) || 0;
  const elements = [];
  for (let i = 0; i < nA; i++) {
    const line = lines[4 + i] || '';
    elements.push((line.substring(31, 34) || '').trim() || 'C');
  }
  const bonds = [];
  for (let i = 0; i < nB; i++) {
    const line = lines[4 + nA + i] || '';
    const a1 = parseInt(line.substring(0, 3).trim(), 10) - 1;
    const a2 = parseInt(line.substring(3, 6).trim(), 10) - 1;
    if (a1 >= 0 && a2 >= 0 && a1 < nA && a2 < nA) bonds.push([a1, a2]);
  }
  return { nA, elements, bonds };
};

/** Mirror the 2D formula's atom names for an explicit-H RDKit molecule. */
const namesFromMolblock = (molblock) => {
  const { nA, elements, bonds } = parseMolblock(molblock);
  const parentHeavy = new Array(nA).fill(-1);
  bonds.forEach(([a, b]) => {
    if (elements[a] === 'H' && elements[b] !== 'H') parentHeavy[a] = b;
    else if (elements[b] === 'H' && elements[a] !== 'H') parentHeavy[b] = a;
  });
  const atomNames = new Array(nA).fill('');
  const heavyCounts = {};
  const hCounts = {};
  for (let i = 0; i < nA; i++) {
    const elem = elements[i];
    if (elem === 'H') {
      const parent = parentHeavy[i];
      const key = parent >= 0 ? String(parent) : 'orphan';
      if (!hCounts[key]) hCounts[key] = 0;
      atomNames[i] = parent >= 0 ? `H${parent}${String.fromCharCode(97 + hCounts[key])}` : `H_orphan${hCounts[key]}`;
      hCounts[key]++;
    } else {
      if (!heavyCounts[elem]) heavyCounts[elem] = 0;
      heavyCounts[elem]++;
      atomNames[i] = `${elem}${heavyCounts[elem]}`;
    }
  }
  return { atomNames, elements, parentHeavy };
};

/** Best-effort isomorphism between NGL heavy atoms and 2D heavy atoms.
 *  Backtracking seeded by element + degree; SMILES molecules are small.
 *  @returns {Map<nglIndex, twoDIndex>|null} */
const matchHeavyGraphs = (nglHeavyAdj, nglElements, twoDHeavyAdj, twoDElements) => {
  const aKeys = Object.keys(nglHeavyAdj).map(Number);
  const bKeys = Object.keys(twoDHeavyAdj).map(Number);
  if (aKeys.length !== bKeys.length) return null;
  const da = {};
  const db = {};
  aKeys.forEach((k) => { da[k] = (nglHeavyAdj[k] || []).length; });
  bKeys.forEach((k) => { db[k] = (twoDHeavyAdj[k] || []).length; });
  const order = aKeys.slice().sort((x, y) => {
    const byDegree = (db[da[y]] || 0) - (db[da[x]] || 0);
    return byDegree || (da[x] - da[y]) || (x - y);
  });
  const usedB = new Set();
  const map = new Map();
  const canAssign = (a, b) => {
    if (nglElements[a] !== twoDElements[b]) return false;
    if (da[a] !== (db[b] || 0)) return false;
    for (const nb of nglHeavyAdj[a] || []) {
      const mb = map.get(nb);
      if (mb !== undefined && !(twoDHeavyAdj[mb] || []).includes(b)) return false;
    }
    return true;
  };
  const bt = (pos) => {
    if (pos >= order.length) return true;
    const a = order[pos];
    for (const b of bKeys) {
      if (usedB.has(b)) continue;
      if (!canAssign(a, b)) continue;
      map.set(a, b);
      usedB.add(b);
      if (bt(pos + 1)) return true;
      usedB.delete(b);
      map.delete(a);
    }
    return false;
  };
  return bt(0) ? map : null;
};

/**
 * Compute the 1:1 name map { NGL atom index → 2D SMILES atom name }.
 * @param {object} component NGL StructureComponent (component.structure)
 * @param {string} smiles    SMILES the molecule was generated from
 * @returns {Promise<{ map:Object<number,string>, method:string }>}
 */
export const computeSmiles3DNameMap = async (component, smiles) => {
  const empty = { map: {}, method: 'none' };
  const structure = component && component.structure;
  if (!structure || !String(smiles || '').trim()) return empty;

  // ---- 3D (NGL) side ------------------------------------------------------
  const nglAtoms = [];
  const nglHeavyAdj = {};
  try {
    structure.eachAtom((a) => {
      const el = String(a.element || '').toUpperCase() || 'C';
      nglAtoms.push({ idx: a.index, el });
      if (el !== 'H') nglHeavyAdj[a.index] = [];
    });
    structure.eachAtom((a) => {
      const el = String(a.element || '').toUpperCase() || 'C';
      if (el === 'H') return;
      a.eachBondedAtom((b) => {
        const elB = String(b.element || '').toUpperCase();
        if (elB !== 'H') nglHeavyAdj[a.index].push(b.index);
      });
    });
  } catch { return empty; }
  if (!nglAtoms.length) return empty;

  // NGL hydrogen → heavy parent (needed for the isomorphism fallback).
  const nglParentOf = {};
  try {
    structure.eachAtom((a) => {
      if ((String(a.element || '').toUpperCase() || 'C') !== 'H') return;
      let parent = -1;
      a.eachBondedAtom((b) => {
        const elB = String(b.element || '').toUpperCase();
        if (elB !== 'H') parent = b.index;
      });
      nglParentOf[a.index] = parent;
    });
  } catch { /* keep partial map */ }

  // ---- 2D (RDKit explicit-H) side ----------------------------------------
  let RDKit = null;
  try {
    RDKit = (typeof window !== 'undefined' && window.__RDKit) || (await loadRDKit());
  } catch { /* fall through */ }
  if (!RDKit) return empty;

  let twoDNames = null;
  let twoDHeavyAdj = {};
  try {
    const base = RDKit.get_mol(smiles);
    if (!base) return empty;
    const withHs = base.add_hs();
    base.delete();
    const mol = RDKit.get_mol(withHs);
    if (!mol) return empty;
    const molblock = mol.get_molblock();
    mol.delete();
    twoDNames = namesFromMolblock(molblock);
    const { elements, bonds } = parseMolblock(molblock);
    elements.forEach((el, i) => { if (el !== 'H') twoDHeavyAdj[i] = []; });
    bonds.forEach(([a, b]) => {
      if (elements[a] !== 'H' && elements[b] !== 'H') {
        twoDHeavyAdj[a].push(b);
        twoDHeavyAdj[b].push(a);
      }
    });
  } catch { return empty; }
  if (!twoDNames || !twoDNames.atomNames.length) return empty;

  // ---- Correspondence -----------------------------------------------------
  const out = {};
  const nglEl = nglAtoms.map((a) => a.el);
  const twoEl = twoDNames.elements;

  // 1) Index mapping — identical explicit-H ordering (normal RDKit path).
  if (nglEl.length === twoEl.length && nglEl.every((e, i) => e === twoEl[i])) {
    nglAtoms.forEach((a, i) => { out[a.idx] = twoDNames.atomNames[i]; });
    return { map: out, method: 'index' };
  }

  // 2) Best-effort heavy-atom graph isomorphism + hydrogen re-attachment.
  const nglHeavyEls = {};
  nglAtoms.forEach((a) => { if (a.el !== 'H') nglHeavyEls[a.idx] = a.el; });
  const twoHeavyEls = {};
  twoDNames.elements.forEach((el, i) => { if (el !== 'H') twoHeavyEls[i] = el; });
  const iso = matchHeavyGraphs(nglHeavyAdj, nglHeavyEls, twoDHeavyAdj, twoHeavyEls);
  if (!iso || iso.size === 0) return empty;

  // Heavy atoms take the exact 2D name.
  iso.forEach((b2, a1) => { out[a1] = twoDNames.atomNames[b2]; });

  // Hydrogens: for every 3D hydrogen, find its (matched) heavy parent and pick
  // the j-th hydrogen of that parent in the 2D molecule (same j ordering), so
  // H0a/H0b/H0c … labels are identical in both representations.
  const childrenBy2DParent = {};
  twoDNames.elements.forEach((el, i) => {
    if (el !== 'H') return;
    const p = twoDNames.parentHeavy[i];
    if (p < 0) return;
    (childrenBy2DParent[p] = childrenBy2DParent[p] || []).push(i);
  });
  Object.keys(childrenBy2DParent).forEach((p) => childrenBy2DParent[p].sort((x, y) => x - y));
  const childrenBy3DParent = {};
  nglAtoms.forEach((a) => {
    if (a.el !== 'H') return;
    const p = nglParentOf[a.idx];
    if (p < 0) return;
    (childrenBy3DParent[p] = childrenBy3DParent[p] || []).push(a.idx);
  });
  Object.keys(childrenBy3DParent).forEach((p) => childrenBy3DParent[p].sort((x, y) => x - y));

  Object.entries(childrenBy3DParent).forEach(([parent3, h3s]) => {
    const parent2 = iso.get(Number(parent3));
    const h2s = parent2 !== undefined ? (childrenBy2DParent[parent2] || []) : [];
    if (h3s.length !== h2s.length) return; // cannot pair safely — skip H
    h3s.forEach((h3, j) => { out[h3] = twoDNames.atomNames[h2s[j]]; });
  });

  if (Object.keys(out).length > 0) return { map: out, method: 'isomorph' };
  return empty;
};


