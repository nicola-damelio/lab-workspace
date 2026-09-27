/* Sonde: la règle de découpe, exécutée comme le fera la vraie sonde. */
import { fragmentMolecules, moleculePartNames, pdbTextForMolecule, pdbLineOfAtom, isWaterResname } from './src/utils/viewerMoleculeParts.js';

const A = (chain, resname, resno, name, x, y, z, el, model = 0, line) => ({ chain, resname, resno, atomname: name, x, y, z, element: el, model, line });
const atoms = [
  A('A', 'ALA', 1, 'N', 0, 0, 0, 'N'), A('A', 'ALA', 1, 'CA', 1.4, 0, 0, 'C'), A('A', 'ALA', 2, 'N', 2.8, 0, 0, 'N'),
  A('A', 'LIG', 501, 'C1', 20, 0, 0, 'C'), A('A', 'LIG', 501, 'C2', 21.4, 0, 0, 'C'),
  A('A', 'HOH', 900, 'O', 40, 0, 0, 'O'),
  A('B', 'ALA', 1, 'CA', 60, 0, 0, 'C'),
  A('A', 'LIG', 502, 'C1', 80, 0, 0, 'C'),
];
const parts = moleculePartNames(fragmentMolecules(atoms), {});
console.log('parts:', parts.map((p) => `${p.label} (${p.atomCount} atoms, chain=${p.chain}, polymer=${p.polymer})`).join(' | '));
const multi = moleculePartNames(fragmentMolecules(atoms), { multiModel: true, onePartPerModel: false });
console.log('multi:', multi.map((p) => p.label).join(' | '));
const models = atoms.concat(atoms.map((a, i) => ({ ...a, model: 1, x: a.x + 0.2, y: a.y + 0.1 })));
console.log('models kept apart:', fragmentMolecules(models).length, 'parts (attended 8)');
const text = pdbTextForMolecule(atoms, parts[1].idxs);
console.log('generated:\n' + text.trimEnd());
const line = pdbLineOfAtom({ chain: 'A', resname: 'LIG', resno: 501, atomname: 'C1', x: -1.5, y: 2.25, z: 3, element: 'C' }, 7);
console.log('cols:', JSON.stringify({ chain: line.slice(21, 22), resno: line.slice(22, 26), x: line.slice(30, 38), y: line.slice(38, 46), z: line.slice(46, 54), el: line.slice(76, 78), len: line.length }));
console.log('water:', isWaterResname('hoh'), isWaterResname('LIG'));
