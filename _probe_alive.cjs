/* Sonde jetable : les deux palettes dont la grille a été retirée sont-elles
   TOUJOURS VIVANTES ? On liste, avec leur ligne, chaque lecture/écriture de
   `residueColors`, `residuePartColors`, `lipidTypeColors`, `lipidPartColors`
   et de leurs tables (RESIDUE_COLOR_PALETTE, RESIDUE_PART_DEFAULTS,
   LIPID_CLASS_COLORS, LIPID_PART_DEFAULTS) + la définition de mergePartPalette.
   But : aucune pastille morte, aucun état que plus rien ne lit. */
const fs = require('fs');
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split('\n');
const keys = [
  'residueColors', 'setResidueColors', 'RESIDUE_COLOR_PALETTE', 'RESIDUE_PART_DEFAULTS',
  'residuePartColors', 'setResiduePartColors', 'mergePartPalette',
  'lipidTypeColors', 'setLipidTypeColors', 'LIPID_CLASS_COLORS', 'LIPID_PART_DEFAULTS',
  'lipidPartColors', 'setLipidPartColors', 'LIPID_TYPE_ORDER', 'RESIDUE_ORDER',
  'proteinAtomPart', 'lab-residue',
];
const out = [];
for (const k of keys) {
  const rows = [];
  src.forEach((l, i) => { if (l.includes(k)) rows.push(`${i + 1}| ${l.trim().slice(0, 190)}`); });
  out.push(`##### ${k}  (${rows.length} lignes) #####`);
  out.push(...rows, '');
}
fs.writeFileSync('_palette_alive.txt', out.join('\n'), 'utf8');
console.log(out.filter((l) => l.startsWith('#####')).join('\n'));
