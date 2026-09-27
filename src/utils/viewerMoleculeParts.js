/* =========================================================================
   src/utils/viewerMoleculeParts.js
   🧬 CHAQUE MOLÉCULE EST UNE ENTITÉ — D'OÙ QU'ELLE VIENNE.

   LA DEMANDE : « you say that each molecule carries the main/set main but it is
   not true. you assign main to the composition of all molecules in a group and
   that means that I cannot do anything. Let me select molecule by molecule, even
   if these molecules are in the same pdb they are separate entities. »

   Le viewer donne UN espace de styling par ENTITÉ de la barre — son ★ « set
   main », son ☑, ses ✥ Move · ↻ Rotate, son 🎯 Fit à choisir. Or une entité EST
   une composante NGL : une molécule ne peut donc être déplacée, superposée ou
   choisie comme référence que si elle A sa propre composante. La découpe en
   molécules n'avait lieu que pour un fichier PDB lu COMME TEXTE : une structure
   venue d'un code PDB, d'une URL, d'un .cif ou d'un .gro restait UNE composante
   — « la composition de toutes les molécules » — et rien n'était sélectionnable
   molécule par molécule.

   Ce module porte LA RÈGLE, une seule, pure (aucun NGL, aucun DOM) et donc
   exécutable par la sonde _viewer_molecule_parts_test.mjs :
     · deux atomes du MÊME MODEL sont liés s'ils sont à ≤ 2,0 Å (la liaison
       covalente implicite — la règle qu'appliquait déjà la découpe du texte PDB)
       ou si le fichier / la structure les déclare liés (CONECT, liaisons NGL) ;
     · chaque fragment connexe est ensuite divisé PAR CHAÎNE, pour qu'un complexe
       expose chaque chaîne ;
     · un fragment d'EAU PURE est ignoré (une protéine hydratée ne doit pas
       exploser en dizaines d'entrées) et la barre s'arrête à 30 entités ;
     · chaque entité reçoit un NOM QUI LA DÉSIGNE : « Chain A », « LIG »,
       « Chain A · LIG », « Model 2 · A »… — deux molécules de la MÊME chaîne ne
       portent donc plus le même nom, et ★ main dit laquelle on déplace.
   ========================================================================= */

/** Liaison covalente implicite (Å) — la même règle que la découpe du texte PDB. */
export const MOLECULE_BOND_DIST = 2.0;
/** Au-delà, la barre ne serait plus lisible : on s'arrête là. */
export const MOLECULE_PART_CAP = 30;
/** Une scène plus grosse que ça n'est pas découpée (elle resterait une entité). */
export const MOLECULE_PART_MAX_ATOMS = 60000;

/** Les noms de résidu qui sont de l'EAU : un fragment qui n'est QUE cela est ignoré. */
export const WATER_RESNAMES = new Set([
  'HOH', 'WAT', 'H2O', 'DOD', 'SOL', 'TIP', 'TIP3', 'TIP3P', 'TIP4P', 'TIP5P', 'SPC', 'SPCE',
]);

/** Les noms de résidu POLYMÈRES (une chaîne se nomme par sa chaîne, pas par ses résidus). */
export const POLYMER_RESNAMES = new Set([
  // les vingt acides aminés
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
  // …et leurs formes courantes (sélénométhionine, histidines chargées, ponts)
  'MSE', 'SEC', 'PYL', 'HID', 'HIE', 'HIP', 'CYX', 'ASH', 'GLH', 'LYN',
  // les acides nucléiques, en 1 comme en 3 lettres
  'A', 'C', 'G', 'U', 'I', 'DA', 'DC', 'DG', 'DT', 'DI',
  'ADE', 'CYT', 'GUA', 'URA', 'THY',
]);

const upper = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** Le nom de résidu est-il de l'eau ? */
export const isWaterResname = (resname) => WATER_RESNAMES.has(upper(resname));
/** Le nom de résidu est-il un polymère (protéine / acide nucléique) ? */

const modelOfAtom = (atom) => (Number.isFinite(Number(atom && atom.model)) ? Number(atom.model) : 0);
const chainOfAtom = (atom) => {
  const chain = String((atom && atom.chain) == null ? '' : atom.chain).trim();
  return chain || '_';
};

/**
 * LES MOLÉCULES D'UNE LISTE D'ATOMES — les fragments connexes, chaîne par chaîne.
 *
 * C'est l'algorithme de la découpe du texte PDB (voir splitPdbFileIntoMolecules du
 * viewer), extrait ici pour valoir AUSSI pour une structure DÉJÀ CHARGÉE par NGL :
 * une structure venue d'un code PDB, d'une URL ou d'un .cif se découpe donc avec
 * exactement la même règle que le même fichier lu comme texte.
 *
 * @param {Array<{chain?: string, resname?: string, resno?: number, model?: number, x: number, y: number, z: number}>} atoms
 * @param {Array<[number, number]>} [bonds] les liaisons DÉCLARÉES (CONECT · liaisons NGL)
 * @returns {Array<{ idxs: number[], chain: string, model: number, atomCount: number,
 *   resnames: string[], polymer: boolean, resnoMin: number|null, resnoMax: number|null }>}
 *   dans l'ordre du fichier (le fragment d'abord, la chaîne ensuite) — [] s'il n'y
 *   a rien à découper.
 */
export const fragmentMolecules = (atoms, bonds = []) => {
  const list = Array.isArray(atoms) ? atoms : [];
  const n = list.length;
  if (!n) return [];

  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // 1. LES LIAISONS DÉCLARÉES — jamais entre deux MODEL : deux conformères qui se
  //    recouvrent ne sont pas une seule molécule (ensembles NMR, poses de docking).
  (Array.isArray(bonds) ? bonds : []).forEach((pair) => {
    const a = pair && pair[0];
    const b = pair && pair[1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (a < 0 || b < 0 || a >= n || b >= n) return;
    if (modelOfAtom(list[a]) !== modelOfAtom(list[b])) return;
    union(a, b);
  });

  // 2. LES LIAISONS IMPLICITES PAR PROXIMITÉ — une grille spatiale garde le calcul
  //    linéaire, même sur un système entier. Même MODEL là aussi.
  const cellOf = (x, y, z) => `${Math.floor(x / MOLECULE_BOND_DIST)}|${Math.floor(y / MOLECULE_BOND_DIST)}|${Math.floor(z / MOLECULE_BOND_DIST)}`;
  const grid = new Map();
  list.forEach((a, i) => {
    const key = cellOf(a.x, a.y, a.z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  for (let i = 0; i < n; i++) {
    const a = list[i];
    const cx = Math.floor(a.x / MOLECULE_BOND_DIST), cy = Math.floor(a.y / MOLECULE_BOND_DIST), cz = Math.floor(a.z / MOLECULE_BOND_DIST);
    const model = modelOfAtom(a);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = list[j];
            if (modelOfAtom(b) !== model) continue;
            const ddx = a.x - b.x, ddy = a.y - b.y, ddz = a.z - b.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= MOLECULE_BOND_DIST * MOLECULE_BOND_DIST) union(i, j);
          }
        }
      }
    }
  }

  // 3. LES ENTITÉS — le fragment connexe, puis la CHAÎNE (un complexe expose
  //    chaque chaîne), dans l'ordre du fichier : deux lectures du même fichier
  //    donnent les mêmes entités, dans le même ordre.
  const order = [];
  const byFragment = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byFragment.has(r)) { byFragment.set(r, new Map()); order.push(r); }
    const byChain = byFragment.get(r);
    const chain = chainOfAtom(list[i]);
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(i);
  }

  const parts = [];
  order.forEach((r) => {
    byFragment.get(r).forEach((idxs, chain) => {
      if (parts.length >= MOLECULE_PART_CAP) return;
      if (idxs.every((i) => isWaterResname(list[i].resname))) return;   // eau pure : ignorée
      const resnames = [];
      let polymer = false;
      let resnoMin = Infinity;
      let resnoMax = -Infinity;
      idxs.forEach((i) => {
        const resname = upper(list[i].resname);
        if (resname && !resnames.includes(resname)) resnames.push(resname);
        if (isPolymerResname(resname)) polymer = true;
        const resno = Number(list[i].resno);
        if (Number.isFinite(resno)) { if (resno < resnoMin) resnoMin = resno; if (resno > resnoMax) resnoMax = resno; }
      });
      parts.push({
        idxs,
        chain,
        model: modelOfAtom(list[idxs[0]]),
        atomCount: idxs.length,
        resnames,
        polymer,
        resnoMin: Number.isFinite(resnoMin) ? resnoMin : null,
        resnoMax: Number.isFinite(resnoMax) ? resnoMax : null,
      });
    });
  });
  return parts;
};

/**
 * LE NOM DE CHAQUE ENTITÉ — ce qui la désigne dans la barre, ★ main compris.
 *
 * Les noms de la barre sont ceux du viewer, gardés tels quels (« Chain A »,
 * « Model 2 », « Molecule 3 (Model 2) · B ») ; ce qui change est qu'une entité qui
 * n'est PAS une chaîne polymère dit ce qu'elle est (« Chain A · LIG ») et qu'un nom
 * qui se répéterait reçoit son numéro d'ordre (« Chain A #2 ») : deux molécules de
 * la MÊME chaîne ne sont donc plus confondues, ni dans la barre, ni dans ★ main, ni
 * dans le PDB exporté (le REMARK qui les nomme).
 *
 * @param {Array} parts les fragments (voir fragmentMolecules)
 * @param {{ multiModel?: boolean, onePartPerModel?: boolean }} [opts]
 */
export const moleculePartNames = (parts, opts = {}) => {
  const list = Array.isArray(parts) ? parts : [];
  const used = new Map();
  return list.map((part, i) => {
    const chain = part.chain && part.chain !== '_' ? String(part.chain) : '';
    const model = Number(part.model || 0) + 1;
    let label;
    if (opts.multiModel) {
      label = `${opts.onePartPerModel ? `Model ${model}` : `Molecule ${i + 1} (Model ${model})`}${chain ? ` · ${chain}` : ''}`;
    } else {
      label = chain ? `Chain ${chain}` : `Molecule ${i + 1}`;
    }
    // Ce que c'est : une chaîne polymère se nomme par sa chaîne, une petite
    // molécule (ligand · ion · sucre) par ses résidus.
    if (!part.polymer) {
      const what = resnameSummaryOf(part.resnames);
      if (what) label = `${label} · ${what}`;
    }
    const seen = used.get(label) || 0;
    used.set(label, seen + 1);
    return { ...part, label: seen ? `${label} #${seen + 1}` : label };
  });
};

/**
 * UNE ENTITÉ, ÉCRITE — le PDB que le viewer chargera comme une molécule.
 * Les lignes d'ORIGINE sont recopiées quand l'entité vient d'un texte (le fichier
 * est alors préservé au caractère près) ; sinon la ligne est ÉCRITE ICI, dans les
 * colonnes que le lecteur PDB lit (chaîne en 22, coordonnées en 31-54, élément en
 * 77-78 — exactement les indices que la découpe du texte utilise).
 */
export const pdbLineOfAtom = (atom, serial) => {
  const a = atom || {};
  const resname = upper(a.resname);
  const name = String(a.atomname || a.name || '').trim().slice(0, 4);
  const element = String(a.element || '').trim().slice(0, 2) || name.replace(/[^A-Za-z]/g, '').slice(0, 2) || 'C';
  const chain = String(a.chain == null ? '' : a.chain).trim().slice(0, 1) || ' ';
  const resno = Number.isFinite(Number(a.resno)) ? Number(a.resno) : 1;
  const xyz = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0).toFixed(3).padStart(8);
  return [
    isPolymerResname(resname) ? 'ATOM  ' : 'HETATM',
    String(Number.isFinite(Number(serial)) ? Number(serial) : 0).padStart(5),
    ' ',
    name.padEnd(4),
    ' ',
    resname.padStart(3),
    ' ',
    chain,
    String(resno).padStart(4),
    '    ',
    xyz(a.x), xyz(a.y), xyz(a.z),
    '  1.00  0.00          ',
    element.padStart(2),
  ].join('').slice(0, 80);
};

/** Le texte PDB d'UNE entité : ses atomes, puis « END » (les séries repartent de 1). */
export const pdbTextForMolecule = (atoms, idxs) => {
  const list = Array.isArray(idxs) ? idxs : [];
  const fromText = list.length > 0 && list.every((i) => typeof (atoms[i] || {}).line === 'string' && atoms[i].line);
  const lines = [];
  list.forEach((i, k) => {
    const a = atoms[i];
    if (!a) return;
    lines.push(fromText ? a.line : pdbLineOfAtom(a, k + 1));
  });
  lines.push('END');
  return `${lines.join('\n')}\n`;
};

export const isPolymerResname = (resname) => POLYMER_RESNAMES.has(upper(resname));

/** `3` → « LIG », « NA·CL », « GLC·NA·… » — ce qu'un fragment EST, en clair. */
export const resnameSummaryOf = (resnames, max = 3) => {
  const list = (Array.isArray(resnames) ? resnames : []).map(upper).filter(Boolean);
  if (!list.length) return '';
  const head = list.slice(0, max).join('·');
  return list.length > max ? `${head}·…` : head;
};
