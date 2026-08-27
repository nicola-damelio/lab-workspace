/* =========================================================================
   src/components/testTypeMeta.js
   Single source of truth for "test type → label / icon / notebook key".

   Previously this mapping was hand-re-encoded as ternaries inside
   LabNotebook.jsx (and partly App.jsx), so every new test page required
   editing those ternaries again. Now it lives in one place.

   NOTE: labels/icons deliberately match the values the Lab Notebook already
   displayed, so moving to this helper changes no visible text.
   ========================================================================= */

const FALLBACK = { label: 'Experiment', icon: '🧪' };

export const TEST_TYPE_META = {
  nmr: { label: 'NMR', icon: 'chart-line' },
  'nmr-fittings': { label: 'NMR Fitting', icon: 'compass' },
  dosy: { label: 'DOSY', icon: 'chart-bar' },
  cd: { label: 'Circular Dichroism', icon: 'atom' },
  ssnmr: { label: 'Solid State NMR', icon: 'magnet' },
  plate: { label: 'Plate Assay', icon: 'plate' },
  cloning: { label: 'Cloning', icon: 'dna' },
  protein_expression: { label: 'Protein Expression', icon: 'flask' },
  md_simulation: { label: 'MD Simulation', icon: 'monitor' },
  flow_cytometry: { label: 'Flow Cytometry', icon: 'droplet' },
  docking: { label: 'Molecular Docking', icon: 'target' }
};

/** Normalise a raw test type to the registry key ("plate-96-well" → "plate"). */
export const getNotebookTypeKey = (type) => {
  if (!type) return '';
  return type.startsWith('plate-') && type !== 'plate-9x9box' ? 'plate' : type;
};

export const getTestTypeMeta = (type) =>
  TEST_TYPE_META[getNotebookTypeKey(type)] || FALLBACK;
