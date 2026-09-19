/* =========================================================================
   src/utils/boxLabel.js — le CONTENU de l'étiquette d'une boîte de stockage.

   Une étiquette, c'est une TABLE : une ligne par puits (position, composé,
   propriétaire du prélèvement, solvant, concentration, volume, date, masse,
   notes). Ce module ne sait QUE cela — ni Drive, ni React — pour que la fenêtre
   d'impression, le PDF déposé sur le Drive et les tests se servent de la MÊME
   table (aucune divergence possible entre ce qui est imprimé et ce qui est
   archivé).

   Les puits d'une boîte vivent dans `box.grid[r][c]`, soit une chaîne simple
   (ancien format : le composé), soit un objet JSON (format actuel : compound,
   sampleOwner/operator, solvent, concentration, concUnit, volume, volUnit,
   date, weight, weightUnit, description).
   ========================================================================= */
import { BOX_ROW_LABELS } from '../data/constants';

/** Les colonnes de l'étiquette, dans l'ordre imprimé. */
export const BOX_LABEL_COLUMNS = [
  'Pos', 'Compound', 'Sample Owner', 'Solvent', 'Conc.', 'Vol.', 'Date', 'Weight', 'Notes'
];

/** Dimensions d'une boîte (mêmes valeurs par défaut que l'écran). */
export const boxDimsOf = (box) => ({
  rows: Math.max(1, Math.min(26, parseInt(box && box.boxRows, 10) || 9)),
  cols: Math.max(1, Math.min(26, parseInt(box && box.boxCols, 10) || 9))
});

/** Valeurs par défaut d'un puits — identiques à celles de l'écran (BoxDetail). */
export const emptyWellValues = (compound = '') => ({
  compound, operator: '', sampleOwner: '', solvent: '', concentration: '',
  concUnit: 'µM', volume: '', volUnit: 'µL', date: '', weight: '', weightUnit: 'mg', description: ''
});

/** Le contenu d'un puits, quel que soit le format enregistré. */
export const parseWellValue = (raw) => {
  if (typeof raw === 'string' && !raw.startsWith('{')) return emptyWellValues(raw);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return { ...emptyWellValues(), ...parsed, sampleOwner: parsed.sampleOwner || parsed.operator || '' };
    } catch { return emptyWellValues(); }
  }
  if (raw && typeof raw === 'object') {
    return { ...emptyWellValues(), ...raw, sampleOwner: raw.sampleOwner || raw.operator || '' };
  }
  return emptyWellValues();
};

/** Le contenu du puits (r, c) d'une grille. */
export const wellValueOf = (grid, r, c) => parseWellValue(grid && grid[r] ? grid[r][c] : '');

/** Un puits est « rempli » dès qu'un champ autre que ceux par défaut est saisi. */
export const wellIsFilled = (value) => {
  const v = value || emptyWellValues();
  return ['compound', 'sampleOwner', 'operator', 'solvent', 'concentration', 'volume', 'date', 'weight', 'description']
    .some((k) => String(v[k] == null ? '' : v[k]).trim() !== '');
};

/** Les puits REMPLIS d'une boîte, dans l'ordre de lecture (A1, A2, …). */
export const filledWells = (box) => {
  const grid = (box && box.grid) || [];
  const { rows, cols } = boxDimsOf(box);
  const wells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (wellIsFilled(wellValueOf(grid, r, c))) wells.push({ r, c });
    }
  }
  return wells;
};

/** Les puits d'une étiquette : la SÉLECTION quand elle existe (bouton « Print
 *  Label »), sinon TOUS les puits remplis — c'est ce dernier cas que le PDF du
 *  Drive utilise, pour que l'étiquette archivée ne change pas au gré des clics. */
export const labelWellsFor = (box, selectedWells) => {
  const chosen = Array.isArray(selectedWells)
    ? selectedWells.filter((w) => w && Number.isFinite(Number(w.r)) && Number.isFinite(Number(w.c)))
    : [];
  return chosen.length ? chosen : filledWells(box);
};

/** Position lisible d'un puits : « B7 ». */
export const wellPositionLabel = (r, c) =>
  `${BOX_ROW_LABELS[r] || String.fromCharCode(65 + r)}${c + 1}`;

const joined = (value, unit, fallbackUnit) =>
  [value, unit || fallbackUnit].filter((x) => String(x == null ? '' : x).trim() !== '').join(' ');

/** Les lignes imprimées de l'étiquette (ordre de l'écran : ligne puis colonne). */
export const boxLabelRows = (box, wells) => {
  const grid = (box && box.grid) || [];
  const list = Array.isArray(wells) && wells.length ? wells : filledWells(box);
  return [...list]
    .map(({ r, c }) => ({ r: Number(r), c: Number(c) }))
    .sort((a, b) => (a.r === b.r ? a.c - b.c : a.r - b.r))
    .map(({ r, c }) => {
      const d = wellValueOf(grid, r, c);
      return {
        pos: wellPositionLabel(r, c),
        compound: String(d.compound || ''),
        owner: String(d.sampleOwner || d.operator || ''),
        solvent: String(d.solvent || ''),
        conc: joined(d.concentration, d.concUnit, 'µM'),
        vol: joined(d.volume, d.volUnit, 'µL'),
        date: String(d.date || ''),
        weight: joined(d.weight, d.weightUnit, 'mg'),
        notes: String(d.description || '')
      };
    });
};

/** Les valeurs d'une ligne, dans l'ordre des colonnes (PDF et HTML partagent). */
export const boxLabelRowCells = (row) => [
  row.pos, row.compound, row.owner, row.solvent, row.conc, row.vol, row.date, row.weight, row.notes
];

/** Empreinte de l'étiquette : identique ⇔ rien à renvoyer sur le Drive. */
export const boxLabelSignature = ({ storage = '', position = null, box = '', rows = [] }) =>
  JSON.stringify({
    storage: String(storage || ''),
    position: position === null || position === undefined ? '' : String(position),
    box: String(box || ''),
    rows
  });

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Le document HTML de l'étiquette (fenêtre d'impression « Print Label »). */
export const buildBoxLabelHtml = ({
  storageName = 'Unassigned', position = null, boxName = '', instanceName = '', rows = []
}) => {
  const headers = BOX_LABEL_COLUMNS.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${boxLabelRowCells(row).map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`)
    .join('');
  const posLabel = position === null || position === undefined ? 'N/A' : position;
  const instance = String(instanceName || '').trim();
  return `<!DOCTYPE html><html><head><title>Label Print</title><style>
        @page { size: 12cm 12cm; margin: 0; }
        body { font-family: 'Inter', Arial, sans-serif; padding: 15px; font-size: 11px; color: #000; box-sizing: border-box; width: 12cm; height: 12cm; }
        h3 { margin-top: 0; margin-bottom: 10px; font-size: 14px; border-bottom: 1px solid #000; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #000; padding: 4px; text-align: left; font-size: 10px; }
        th { background-color: #f3f4f6; }
    </style></head><body>
    <h3>Storage: ${escapeHtml(storageName)} (Pos: ${escapeHtml(posLabel)})</h3>
    <p><strong>Box:</strong> ${escapeHtml(boxName)}${instance ? ' - ' + escapeHtml(instance) : ''}</p>
    <table><tr>${headers}</tr>${body}</table></body></html>`;
};
