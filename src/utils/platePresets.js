/* =========================================================================
   platePresets.js — shared preset labels for filling plate wells.

   Used by both the Multiwell Plate page (PlateSections) and the Flow
   Cytometry Experimental Setup plate. Clicking a preset button fills the
   selected wells with that label and NO concentration. Colors are the
   "very light" palette requested by the user.
   ========================================================================= */

export const PLATE_PRESET_LABELS = ['cells', 'PBS', 'DMSO', 'Medium', 'empty'];

// Lowercased label → background color (very light shades, dark text readable).
export const PLATE_PRESET_COLORS = {
  cells: '#fef9c3', // very light yellow
  pbs: '#dbeafe',   // light blue
  dmso: '#e2e8f0',  // gray
  medium: '#fce7f3', // very light magenta
  empty: '#f1f5f9'  // light gray
};

export const isPlatePreset = (s) =>
  Object.prototype.hasOwnProperty.call(PLATE_PRESET_COLORS, String(s || '').toLowerCase());

export const platePresetColor = (s) =>
  PLATE_PRESET_COLORS[String(s || '').toLowerCase()] || null;
