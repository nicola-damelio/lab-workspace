/* Sonde jetable : quels marqueurs des demandes restantes existent déjà ? */
const { readFileSync } = require('node:fs');
const V = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const marks = [
  'SELECTED_SECTION_PREFIX',
  'SEL_ROW_STYLE_CHOICES',
  'SEL_COLOR_MODES',
  'membraneHeadOwnerExprs',
  'firstLipidSectionOf',
  'color by lipid type',
  'color by base',
  'color by residue',
  'color by chain',
  'color by element',
  'bases: [',
  'const renderMembraneSelections',
  'nucleicRingPlates',
  'slab',
  'General',
];
for (const m of marks) {
  const n = V.split(m).length - 1;
  console.log(`${m} => ${n}`);
}
