/* =========================================================================
   src/data/testTypes.js
   Test classification constants (moved out of App.jsx so LabNotebook and
   TestShellRenderer don't need to import from the App component file).
   ========================================================================= */

export const CLASSIFICATION_MAP = {
  "Protein production": ["Cloning", "Protein Expression and Purification", "Organic Purifications"],
  "Molecular Structure and Dynamics": ["Structure by NMR, CD, IR", "MD & Modeling", "Dynamics by NMR Relaxation, ssNMR", "Diffusion by DLS, NMR"],
  "Interactions": ["Association Constant", "Molecular Docking", "MD interactions", "Chromatography"],
  "Activity": ["Antibacterial activity", "Anticancer activity", "Antifungal activity", "Antiviral activity", "Toxicity"]
};

export const PRIMARY_CATEGORIES = Object.keys(CLASSIFICATION_MAP);

export const EXPERIMENT_TYPES = [
 "Cloning ",
 "Protein expression  & Purification ",
 "Multiwell plate essay ",
 "Flow Cytometry ",
 "Circular Dichroism ",
 "NMR ",
 "NMR Fitting ",
 "Solid State NMR ",
 "MD Simulation ",
 "Molecular Docking "
];
