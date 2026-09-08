/* =========================================================================
   src/administration/approvalSignature.js
   Apposition de la signature du superutilisateur sur les documents devis /
   BC approuvés (page « Approbation devis & BC »).

   Fonctions « pures » (aucun accès à Google Drive — c'est la page qui
   télécharge le fichier, appelle ces fonctions et retéléverse le résultat) :
     · stampPdfWithSignature()  — incruste l'image de signature en bas de la
                                  DERNIÈRE page d'un PDF existant (une copie
                                  est produite, l'original reste intact) ;
     · makeSignedPdfFromImage() — quand le devis / BC a été déposé comme une
                                  image (PNG/JPEG), construit un PDF d'une
                                  page : l'image du document en haut, le bloc
                                  de signature en bas.

   L'image de signature est un data:URL PNG ou JPEG (fond transparent
   recommandé). Le bloc signé est aligné à droite, en bas de page : une
   mention (« Bon pour accord … ») au-dessus de l'image de signature.
   ========================================================================= */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TXT_COLOR = rgb(0.13, 0.16, 0.21);
const CAPTION_SIZE = 8.4;
const CAPTION_LINE_GAP = 11.5;
/* Marges du bloc signé (points PDF). */
const BLOCK_MARGIN_X = 52;
const BLOCK_MARGIN_BOTTOM = 42;
const SIGNATURE_MAX_HEIGHT = 82;

/** Décode un data:URL en octets bruts (pour pdf-lib). */
export const dataUrlToBytes = (dataUrl) => {
  const raw = String(dataUrl || '').split(',')[1] || '';
  let bin = '';
  try { bin = atob(raw); } catch { /* laissé vide → erreur plus bas */ }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const dataUrlMimeOf = (dataUrl) => {
  const m = String(dataUrl || '').match(/^data:([^;,]+)/i);
  return m ? m[1].toLowerCase() : '';
};

const embedImage = async (doc, dataUrl) => {
  const mime = dataUrlMimeOf(dataUrl);
  const isPng = mime === 'image/png';
  const isJpeg = !isPng && (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/pjpeg');
  if (!dataUrl || (!isPng && !isJpeg)) {
    throw new Error('Image de signature non reconnue : fournissez un PNG ou un JPEG.');
  }
  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes.length) throw new Error('Image de signature vide ou illisible.');
  try {
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (err) {
    /* Dernière chance : certains navigateurs étiquettent mal le type. */
    try {
      return isPng ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    } catch {
      throw new Error(`Image de signature illisible : ${(err && err.message) || err}`);
    }
  }
};

/** Dessine le bloc signé (mention(s) au-dessus, image en dessous), aligné à
 *  droite, en bas de la page donnée. `font` doit être une fonte déjà chargée
 *  dans le document (StandardFonts.Helvetica). */
const drawSignatureBlock = (page, image, captionLines, font) => {
  const { width } = page.getSize();
  const aspect = image.width && image.height ? image.width / image.height : 3.5;
  const maxImgW = width * 0.42;
  let imgW = SIGNATURE_MAX_HEIGHT * aspect;
  let imgH = SIGNATURE_MAX_HEIGHT;
  if (imgW > maxImgW) {
    imgW = maxImgW;
    imgH = imgW / aspect;
  }
  const x = width - BLOCK_MARGIN_X - imgW;
  const y = BLOCK_MARGIN_BOTTOM;
  page.drawImage(image, { x, y, width: imgW, height: imgH });

  const lines = (Array.isArray(captionLines) ? captionLines : [])
    .map((l) => String(l ?? '').trim())
    .filter(Boolean);
  if (!lines.length) return;
  /* Première ligne au-dessus du bloc d'images ; la dernière touche l'image. */
  let baseline = y + imgH + 10 + (lines.length - 1) * CAPTION_LINE_GAP;
  lines.forEach((line) => {
    const textW = font.widthOfTextAtSize(line, CAPTION_SIZE);
    page.drawText(line, {
      x: width - BLOCK_MARGIN_X - textW,
      y: baseline,
      size: CAPTION_SIZE,
      font,
      color: TXT_COLOR,
    });
    baseline -= CAPTION_LINE_GAP;
  });
};
/**
 * Incruste l'image de signature en bas de la DERNIÈRE page d'un PDF existant.
 * @param {Uint8Array|ArrayBuffer} pdfBytes  contenu binaire du PDF d'origine
 * @param {string} signatureDataUrl          image PNG/JPEG (data:URL)
 * @param {string[]} [captionLines]          mention(s) au-dessus de la signature
 * @returns {Promise<Uint8Array>}            PDF signé (l'original n'est PAS modifié)
 */
export const stampPdfWithSignature = async ({ pdfBytes, signatureDataUrl, captionLines = [] }) => {
  let doc;
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err) {
    throw new Error(`PDF illisible ou protégé par mot de passe : ${(err && err.message) || err}`);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await embedImage(doc, signatureDataUrl);
  const pages = doc.getPages();
  const page = pages[Math.max(0, pages.length - 1)];
  drawSignatureBlock(page, image, captionLines, font);
  return doc.save();
};

/**
 * Transforme un devis / BC déposé comme IMAGE (PNG/JPEG) en un PDF d'une
 * page : le document occupe la page, le bloc signé est apposé en bas.
 * @param {string} imageDataUrl      image du document (data:URL)
 * @param {string} signatureDataUrl  image de signature (data:URL)
 * @param {string[]} [captionLines]  mention(s) au-dessus de la signature
 * @returns {Promise<Uint8Array>}
 */
export const makeSignedPdfFromImage = async ({ imageDataUrl, signatureDataUrl, captionLines = [] }) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const pageW = page.getWidth();
  const pageH = page.getHeight();

  /* Le document (photo / scan du devis) occupe le haut ; 170 pt en bas sont
     réservés au bloc signé. */
  const areaW = pageW - 2 * 48;
  const areaH = pageH - 48 - 170;
  const docImg = await embedImage(doc, imageDataUrl);
  const scale = Math.min(areaW / docImg.width, areaH / docImg.height, 1);
  const drawW = docImg.width * scale;
  const drawH = docImg.height * scale;
  page.drawImage(docImg, {
    x: (pageW - drawW) / 2,
    y: pageH - 48 - drawH,
    width: drawW,
    height: drawH,
  });

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const signature = await embedImage(doc, signatureDataUrl);
  drawSignatureBlock(page, signature, captionLines, font);
  return doc.save();
};

