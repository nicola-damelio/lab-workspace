/* =========================================================================
   src/utils/boxLabelPdf.js — la MÊME étiquette que le bouton « Print Label »,
   mais en PDF, pour le Drive :
   storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf.

   Format : 120 × 120 mm (le papier de l'étiquette, voir boxLabel.js) ; les
   lignes sont celles de boxLabel.boxLabelRows, donc imprimé et archivé ne
   peuvent pas diverger ; une nouvelle page est ajoutée quand la table dépasse la
   hauteur du papier.

   L'en-tête porte la DATE et le PROPRIÉTAIRE de la boîte — les deux champs
   obligatoires de la boîte, qui donnaient déjà son nom au fichier — et les NOTES
   sont reprises EN CALCE, entières, rappelées par la position du puits auquel
   elles se rapportent (la colonne « Notes » du tableau ne tient qu'une ligne de
   11 mm, coupée : elle ne permettait pas de les lire).
   ========================================================================= */
import { jsPDF } from 'jspdf';
import { BOX_LABEL_COLUMNS, boxLabelRowCells, boxLabelNotes, plainBoxNotes } from './boxLabel';

/** Le papier de l'étiquette (mm) — la taille de la fenêtre d'impression. */
export const LABEL_PAGE_MM = 120;
const MARGIN = 6;
const HEAD_TOP = 26;
const ROW_H = 5;
/* Hauteur de ligne (mm) du bloc de notes en calce. */
const NOTE_H = 3.4;
/* Largeurs (mm) des colonnes ; la dernière (Notes) prend ce qui reste.
   La somme des colonnes fixes doit laisser une largeur POSITIVE à « Notes » :
   avec 109 mm fixes sur 108 mm utiles elle valait −1 mm, donc jsPDF ne dessinait
   NI son titre NI son contenu — la colonne fantôme que l'utilisateur ne pouvait
   pas lire (les notes sont maintenant reprises en calce, mais la table doit
   rester lisible). */
const COLUMN_MM = [8, 16, 14, 9, 9, 9, 13, 10, 0];

const oneLine = (doc, text, width) => {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  const lines = doc.splitTextToSize(s, Math.max(4, width - 1.6));
  return lines.length ? lines[0] : '';
};

/** Écrit, EN CALCE, les notes d'une étiquette : une entrée par note, précédée de
 *  la POSITION du puits à laquelle elle se rapporte (« B7: … ») ou du titre du
 *  commentaire de boîte. Le texte est replié sur la largeur du papier et une
 *  nouvelle page est ajoutée quand le bas de l'étiquette est atteint.
 *  @returns {number} le y atteint (0 quand il n'y a aucune note à écrire) */
const writeNotesBlock = (doc, items, startY, width) => {
  const lines = (Array.isArray(items) ? items : [])
    .map((item) => ({ prefix: String((item && item.prefix) || ''), text: String((item && item.text) || '') }))
    .filter((item) => item.text.trim() !== '');
  if (!lines.length) return 0;
  let y = startY;
  if (y + ROW_H > LABEL_PAGE_MM - MARGIN) {
    doc.addPage([LABEL_PAGE_MM, LABEL_PAGE_MM], 'portrait');
    y = MARGIN;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text('Notes', MARGIN, y + 3.2);
  y += NOTE_H + 0.6;
  doc.setFont('helvetica', 'normal');
  lines.forEach((item) => {
    item.text.split('\n').forEach((paragraph, pIdx) => {
      const chunks = doc.splitTextToSize(`${pIdx === 0 ? item.prefix : ''}${paragraph}`, Math.max(8, width));
      chunks.filter((chunk) => String(chunk).trim() !== '').forEach((chunk) => {
        if (y + NOTE_H > LABEL_PAGE_MM - MARGIN) {
          doc.addPage([LABEL_PAGE_MM, LABEL_PAGE_MM], 'portrait');
          y = MARGIN;
        }
        doc.text(String(chunk), MARGIN, y + NOTE_H - 1);
        y += NOTE_H;
      });
    });
  });
  return y;
};

/** Le PDF de l'étiquette d'une boîte. @returns {Blob} */
export const buildBoxLabelPdf = ({
  storageName = 'Unassigned', position = null, boxName = '', owner = '', date = '',
  rows = [], boxNotes = ''
}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [LABEL_PAGE_MM, LABEL_PAGE_MM] });
  const totalW = LABEL_PAGE_MM - MARGIN * 2;
  const fixed = COLUMN_MM.reduce((t, w) => t + w, 0);
  const widths = COLUMN_MM.map((w) => w || (totalW - fixed));
  const posLabel = position === null || position === undefined ? 'N/A' : String(position);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  /* Les deux champs obligatoires de la boîte, sur une ligne à eux : ils donnent
     aussi son nom au fichier (voir driveNaming.boxLabelFileName). */
  const ownerDateLine = [
    String(owner || '').trim() ? `Box Owner: ${String(owner).trim()}` : '',
    String(date || '').trim() ? `Date: ${String(date).trim()}` : ''
  ].filter(Boolean).join('   —   ');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(oneLine(doc, `Storage: ${storageName} (Pos: ${posLabel})`, totalW), MARGIN, 10);
  doc.setFontSize(8);
  doc.text(oneLine(doc, `Box: ${boxName}`, totalW), MARGIN, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  if (ownerDateLine) doc.text(oneLine(doc, ownerDateLine, totalW), MARGIN, 19.5);
  doc.setFontSize(6);
  doc.text(oneLine(doc, `Label generated automatically — ${stamp}`, totalW), MARGIN, ownerDateLine ? 24 : 20);

  let y = HEAD_TOP + (ownerDateLine ? 4 : 0);
  const drawRow = (cells, head) => {
    doc.setFont('helvetica', head ? 'bold' : 'normal');
    doc.setFontSize(6);
    let x = MARGIN;
    cells.forEach((cell, i) => {
      doc.text(oneLine(doc, cell, widths[i]), x + 0.8, y + 3.4);
      x += widths[i];
    });
    doc.setDrawColor(0);
    doc.setLineWidth(0.15);
    doc.rect(MARGIN, y, totalW, ROW_H);
    let gx = MARGIN;
    widths.slice(0, -1).forEach((w) => { gx += w; doc.line(gx, y, gx, y + ROW_H); });
    y += ROW_H;
  };

  drawRow(BOX_LABEL_COLUMNS, true);
  rows.forEach((row) => {
    if (y + ROW_H > LABEL_PAGE_MM - MARGIN) {
      doc.addPage([LABEL_PAGE_MM, LABEL_PAGE_MM], 'portrait');
      y = MARGIN;
      drawRow(BOX_LABEL_COLUMNS, true);
    }
    drawRow(boxLabelRowCells(row).map(String), false);
  });

  /* ── Les notes EN CALCE ────────────────────────────────────────────────────
     Le tableau ne peut pas les montrer : sa colonne « Notes » tient 11 mm (une
     seule ligne, coupée). Elles sont donc reprises ici, entières, CHACUNE
     RAPPELÉE PAR LA POSITION DU PUITS auquel elle se rapporte — et le
     commentaire général de la boîte (« General Box Notes ») ferme le bloc. */
  const boxNotesText = plainBoxNotes(boxNotes);
  writeNotesBlock(doc, [
    ...boxLabelNotes(rows).map((note) => ({ prefix: `${note.pos}: `, text: note.text })),
    ...(boxNotesText
      ? [{ prefix: `Box notes${posLabel === 'N/A' ? '' : ` (Pos ${posLabel})`}: `, text: boxNotesText }]
      : [])
  ], y + 1.4, totalW);

  return doc.output('blob');
};