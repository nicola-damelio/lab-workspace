// « Upload a PDF of a paper in journal X and let the program fill the publication
// format » — the detector on a fixture whose every parameter is known, then END
// TO END: a PDF built with pdf-lib and read back with pdfjs.
// Run: node _pub_format_from_pdf_test.mjs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { detectPublicationFormat } from './src/components/publicationFormatFromPdf.js';
import { pdfTextLines } from './src/utils/pdfTextTokens.js';
import { applyDetectedFormat } from './src/components/journalFormats.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('ok   ' + msg);
  else { failures++; console.error('FAIL ' + msg); }
};

/* ---- les lignes telles que utils/pdfTextTokens.js les rend ------------------- */
const FACE = {
  serif: { name: 'TimesNewRomanPSMT', family: 'TimesNewRoman', bold: false, italic: false, serif: true },
  serifBold: { name: 'TimesNewRomanPS-BoldMT', family: 'TimesNewRoman', bold: true, italic: false, serif: true },
  serifItalic: { name: 'TimesNewRomanPS-ItalicMT', family: 'TimesNewRoman', bold: false, italic: true, serif: true },
  sans: { name: 'Helvetica', family: 'Helvetica', bold: false, italic: false, serif: false },
  sansBold: { name: 'Helvetica-Bold', family: 'Helvetica', bold: true, italic: false, serif: false },
};
const line = (text, size, face, o = {}) => ({
  text,
  size,
  face,
  x: o.x == null ? 50 : o.x,
  xEnd: (o.x == null ? 50 : o.x) + (o.xEnd || text.length * size * 0.48),
  y: o.y == null ? 700 : o.y,
  sup: !!o.sup,
  chars: text.length,
  runs: o.runs || [{ name: face.name, text, face }],
});
const BODY = 'The reaction was followed by NMR and the result agrees with the earlier report of this group';
const docOf = (pages) => ({ pages, pageCount: pages.length, truncated: false });

/* ---- 1. UNE REVUE « À L'ACS » : auteurs. titre. revue année, volume, pages --- */
const acsEntry = (n, y) => line('[' + n + '] Smith, J. A., Jones, B. and Rossi, C. Title of the first paper. J. Test Chem. 2019, 41, 1234-1240. doi:10.1234/xyz', 9, FACE.serif, {
  y,
  runs: [
    { name: FACE.serif.name, text: '[' + n + '] Smith, J. A., Jones, B. and Rossi, C. Title of the first paper. ', face: FACE.serif },
    { name: FACE.serifItalic.name, text: 'J. Test Chem.', face: FACE.serifItalic },
    { name: FACE.serif.name, text: ' 2019, ', face: FACE.serif },
    { name: FACE.serifBold.name, text: '41', face: FACE.serifBold },
    { name: FACE.serif.name, text: ', 1234-1240. doi:10.1234/xyz', face: FACE.serif },
  ],
});
const bodyLine = (y) => line(BODY, 10, FACE.serif, { y, xEnd: 500 });
const acsDoc = () => docOf([{
  page: 1, width: 612, height: 792, lines: [
    line('Journal of Test Chemistry', 9, FACE.sans, { y: 770 }),
    line('A study of the thing under test', 17, FACE.serifBold, { y: 720 }),
    line('Smith, J. A., Jones, B. and Rossi, C.', 11, FACE.serif, { y: 700 }),
    line('Department of Chemistry, University of Test, Testville', 9, FACE.serifItalic, { y: 686 }),
    line('Abstract', 12, FACE.serifBold, { y: 660 }),
    line('We report the thing, and it works as shown previously.', 10, FACE.serif, { y: 648, sup: true }),
    line('Introduction', 12, FACE.serifBold, { y: 620 }),
    bodyLine(606), bodyLine(594), bodyLine(582),
    line('Results and Discussion', 12, FACE.serifBold, { y: 556 }),
    bodyLine(542), bodyLine(530),
    line('Materials and Methods', 12, FACE.serifBold, { y: 504 }),
    bodyLine(490), bodyLine(478),
    line('References', 12, FACE.serifBold, { y: 452 }),
    acsEntry(1, 440), acsEntry(2, 428), acsEntry(3, 416), acsEntry(4, 404),
  ],
}]);

/* ---- 2. UNE REVUE « À LA SCIENCE » : pas d'intitulé sur la liste, pas de titre
       d'article, renvois en exposant, auteurs en initiales d'abord ------------- */
const scienceEntry = (n, y) => line(n + '. J. A. Smith, B. Jones, C. Rossi, J. Test Chem. 2019, 41, 1234-1240.', 9, FACE.serif, {
  y,
  runs: [
    { name: FACE.serif.name, text: n + '. J. A. Smith, B. Jones, C. Rossi, ', face: FACE.serif },
    { name: FACE.serifItalic.name, text: 'J. Test Chem.', face: FACE.serifItalic },
    { name: FACE.serif.name, text: ' 2019, ', face: FACE.serif },
    { name: FACE.serifBold.name, text: '41', face: FACE.serifBold },
    { name: FACE.serif.name, text: ', 1234-1240.', face: FACE.serif },
  ],
});
const scienceBody = (y) => line('It works as shown previously and again in the more recent report of this group.', 10, FACE.sans, { y, xEnd: 500 });
const scienceDoc = () => docOf([
  {
    page: 1, width: 612, height: 792, lines: [
      line('Science', 9, FACE.sansBold, { y: 770 }),
      line('A study of the thing under test', 16, FACE.sansBold, { y: 720 }),
      line('J. A. Smith, B. Jones and C. Rossi', 11, FACE.sans, { y: 700 }),
      line('Abstract', 11, FACE.sansBold, { y: 670 }),
      line('We report the thing, and it works as shown previously.', 10, FACE.sans, { y: 658, sup: true }),
      line('Introduction', 11, FACE.sansBold, { y: 630 }),
      scienceBody(616), scienceBody(604), scienceBody(592), scienceBody(580),
      line('Results', 11, FACE.sansBold, { y: 554 }),
      scienceBody(540), scienceBody(528), scienceBody(516), scienceBody(504),
    ],
  },
  {
    page: 2, width: 612, height: 792, lines: [
      scienceEntry(1, 700), scienceEntry(2, 688), scienceEntry(3, 676),
      scienceEntry(4, 664), scienceEntry(5, 652), scienceEntry(6, 640),
    ],
  },
]);

/* ---- LA DÉTECTION, CAS PAR CAS ---------------------------------------------- */
const acs = detectPublicationFormat(acsDoc());
ok(!!acs.bundle, 'ACS-like fixture: a format was read');
ok(acs.bundle.bibLabel === 'References', 'bibLabel = “References” (' + acs.bundle.bibLabel + ')');
ok(acs.bundle.inText === 'sup', 'in-text citations read as superscript (' + acs.bundle.inText + ')');
ok(acs.bundle.names === 'family-comma-initials', 'author names = “Smith, J. A.” (' + acs.bundle.names + ')');
ok(acs.bundle.preset === 'acs', 'reference preset = ACS (' + acs.bundle.preset + ')');
ok(acs.bundle.bibFieldsOff.length === 0, 'the article title IS printed — no field switched off');
ok(acs.bundle.order.join(' → ') === 'abstract → introduction → results and discussion → materials and methods → references',
  'section order: ' + acs.bundle.order.join(' → '));
ok(acs.bundle.layout.body.size === 10 && acs.bundle.layout.body.align === 'justify', 'body = 10 pt justified');
ok(acs.bundle.layout.title.size === 17 && acs.bundle.layout.title.bold === true, 'title = 17 pt bold');
ok(acs.bundle.layout.heading.size === 12 && acs.bundle.layout.heading.bold === true, 'headings = 12 pt bold');
ok(acs.bundle.layout.bibliography.font.indexOf('Times') >= 0, 'references in Times (' + acs.bundle.layout.bibliography.font + ')');
ok(acs.evidence.some((e) => /Superscript/.test(e)), 'the evidence states the in-text form: ' + acs.evidence.filter((e) => /in-text/.test(e))[0]);
ok(acs.confidence >= 4, 'confidence ' + acs.confidence + '/5');
ok(acs.journalName === 'Journal of Test Chemistry', 'journal name read from the page head (“' + acs.journalName + '”)');

const sci = detectPublicationFormat(scienceDoc());
ok(sci.bundle.bibLabel === '', 'no heading over the reference list → bibLabel is empty (Science prints it this way)');
ok(sci.bundle.bibFieldsOff.indexOf('title') >= 0, 'the article titles are absent → the Title field is switched off');
ok(sci.bundle.names === 'initials-family', 'author names = “J. A. Smith” (' + sci.bundle.names + ')');
ok(sci.bundle.inText === 'sup', 'in-text citations: superscript');

/* ---- LE PAQUET S'APPLIQUE COMME UN JOURNAL DE LA LISTE (le chemin du pannello) */
const applied = applyDetectedFormat({}, acs.bundle);
ok(applied.preset === 'acs', 'apply: the citation form follows the PDF (' + applied.preset + ')');
ok(applied.nameStyle === 'family-comma-initials' && applied.inTextStyle === 'sup', 'apply: names and in-text form follow');
ok(applied.order.join(' → ') === acs.bundle.order.join(' → '), 'apply: the section order follows');
ok(applied.layout.body.size === 10 && applied.layout.title.size === 17, 'apply: the typography follows');
ok(applied.fields.some((f) => f.id === 'title' && f.enabled), 'apply: the article title stays printed (ACS)');
const appliedSci = applyDetectedFormat({}, sci.bundle);
ok(appliedSci.fields.some((f) => f.id === 'title' && !f.enabled), 'apply (Science): the Title field is off');
ok(appliedSci.docNoTitle.indexOf('references') >= 0, 'apply (Science): the reference list prints without a heading');

/* ---- 5. DE BOUT EN BOUT : un vrai PDF, construit avec pdf-lib et relu par pdfjs */
const buildPdf = async () => {
  const pdf = await PDFDocument.create();
  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const page = pdf.addPage([612, 792]);
  const black = rgb(0, 0, 0);
  let y = 744;
  const put = (text, font, size, x) => {
    const at = x == null ? 56 : x;
    page.drawText(text, { x: at, y, size, font, color: black });
    return font.widthOfTextAtSize(text, size);
  };
  put('Journal of Test Chemistry', times, 9);
  y -= 26; put('A study of the thing under test', timesBold, 16);
  y -= 20; put('Smith, J. A., Jones, B. and Rossi, C.', times, 11);
  y -= 14; put('Department of Chemistry, University of Test', timesItalic, 9);
  y -= 26; put('Introduction', timesBold, 12);
  y -= 16;
  const para = (withSup) => {
    let x = 56;
    x += put('The reaction was followed by NMR and the result agrees with the report of', times, 10, x);
    if (withSup) {
      page.drawText('1,2', { x: x + 1, y: y + 3, size: 7, font: times, color: black });
      x += times.widthOfTextAtSize('1,2', 7) + 2;
    }
    put(' this group.', times, 10, x);
    y -= 14;
  };
  para(true); para(false); para(false);
  y -= 12; put('Results and Discussion', timesBold, 12);
  y -= 16; para(false); para(false);
  y -= 12; put('Materials and Methods', timesBold, 12);
  y -= 16; para(false); para(false);
  y -= 12; put('References', timesBold, 12);
  y -= 16;
  for (let n = 1; n <= 4; n++) {
    let x = 56;
    x += put('[' + n + '] Smith, J. A., Jones, B. Title of the paper number ' + n + '. ', times, 9, x);
    x += put('J. Test Chem.', timesItalic, 9, x);
    x += put(' 2019, ', times, 9, x);
    x += put('41', timesBold, 9, x);
    put(', 1234-1240.', times, 9, x);
    y -= 14;
  }
  return pdf.save();
};

const bytes = await buildPdf();
/* La sortie de pdfjs est écoutée le temps de CETTE lecture : un PDF de revue cite
   « Times-Roman » sans l'embarquer, et si pdfjs ne trouve pas ses propres fichiers
   de police il avertit (« Ensure that the `standardFontDataUrl` API parameter is
   provided. ») puis rend des items à largeur nulle — l'étendue des lignes, donc
   les colonnes, se lisent de travers. */
const pdfjsNoise = [];
const realLog = console.log;
const realWarn = console.warn;
console.log = (...a) => pdfjsNoise.push(a.join(' '));
console.warn = (...a) => pdfjsNoise.push(a.join(' '));
const read = await pdfTextLines(bytes, { maxPages: 3 });
console.log = realLog;
console.warn = realWarn;
const readLines = read.pages.length ? read.pages[0].lines.length : 0;
ok(read.pages.length === 1 && readLines >= 12, 'pdfjs read the PDF built for the test: ' + readLines + ' lines');
ok(!pdfjsNoise.some((m) => /standardFontDataUrl|Unable to load font data/.test(m)),
  'pdfjs found its standard font data (no “standardFontDataUrl” warning)');
const det = detectPublicationFormat(read);
ok(!!det.bundle, 'a format was read from the real PDF');
ok(det.bundle.layout.body.size === 10, 'the body is 10 pt (read from the embedded font size)');
ok(det.bundle.layout.title.size === 16 && det.bundle.layout.title.bold === true, 'the title is 16 pt bold');
ok(/Times/.test(det.bundle.layout.bibliography.font), 'the reference face is Times (' + det.bundle.layout.bibliography.font + ')');
ok(det.bundle.bibLabel === 'References', 'bibLabel read from the printed heading');
ok(det.bundle.order.indexOf('materials and methods') >= 0 && det.bundle.order.indexOf('results and discussion') >= 0,
  'the sections and their order were read: ' + det.bundle.order.join(' → '));
ok(det.bundle.inText === 'sup', 'the small raised run is read as a superscript citation (' + det.bundle.inText + ')');
ok(det.bundle.preset === 'acs', 'the reference entries give the ACS shape (' + det.bundle.preset + ')');
ok(det.bundle.names === 'family-comma-initials', 'author names = “Smith, J. A.” (' + det.bundle.names + ')');
console.log('     evidence: ' + det.evidence.join(' | '));

console.log(failures === 0 ? '\nPASS' : '\nFAIL (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);


