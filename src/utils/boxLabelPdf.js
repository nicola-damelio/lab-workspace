/* =========================================================================
   src/utils/boxLabelPdf.js — la MÊME étiquette que le bouton « Print Label »,
   mais en PDF, pour le Drive : storage/<storage>/boxes/<boîte>/label.pdf.

   Format : 120 × 120 mm (le papier de l'étiquette, voir boxLabel.js) ; les
   lignes sont celles de boxLabel.boxLabelRows, donc imprimé et archivé ne
   peuvent pas diverger ; une nouvelle page est ajoutée quand la table dépasse la
   hauteur du papier.
   ========================================================================= */
import { jsPDF } from 'jspdf';
import { BOX_LABEL_COLUMNS, boxLabelRowCells } from './boxLabel';

/** Le papier de l'étiquette (mm) — la taille de la fenêtre d'impression. */
export const LABEL_PAGE_MM = 120;
const MARGIN = 6;
const HEAD_TOP = 26;
const ROW_H = 5;
/* Largeurs (mm) des colonnes ; la dernière (Notes) prend ce qui reste. */
const COLUMN_MM = [10, 24, 16, 13, 13, 11, 11, 11, 0];

const oneLine = (doc, text, width) => {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  const lines = doc.splitTextToSize(s, Math.max(4, width - 1.6));
  return lines.length ? lines[0] : '';
};

/** Le PDF de l'étiquette d'une boîte. @returns {Blob} */
export const buildBoxLabelPdf = ({ storageName = 'Unassigned', position = null, boxName = '', rows = [] }) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [LABEL_PAGE_MM, LABEL_PAGE_MM] });
  const totalW = LABEL_PAGE_MM - MARGIN * 2;
  const fixed = COLUMN_MM.reduce((t, w) => t + w, 0);
  const widths = COLUMN_MM.map((w) => w || (totalW - fixed));
  const posLabel = position === null || position === undefined ? 'N/A' : String(position);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(oneLine(doc, `Storage: ${storageName} (Pos: ${posLabel})`, totalW), MARGIN, 10);
  doc.setFontSize(8);
  doc.text(oneLine(doc, `Box: ${boxName}`, totalW), MARGIN, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Label generated automatically — ${stamp}`, MARGIN, 20);

  let y = HEAD_TOP;
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

  return doc.output('blob');
};