/* =========================================================================
   src/utils/libraryCsv.js — LA LIBRAIRIE DANS UN FICHIER, ET RETOUR.

   LA DEMANDE, MOT POUR MOT : « quando esporto la libreria poi non la posso
   reimportare in un altro dataset? se la importo con il tasto import CSV la
   legge ma con i campi sbagliati. »

   Le bouton « 📥 Export Full Library (CSV) » (AppModules/libraryDirectory.jsx)
   et le bouton « Import CSV » de la fiche du composé
   (AppModules/compoundDefinitionSection.jsx) sont LES DEUX MOITIÉS D'UN MÊME
   CONTRAT : ce module EST ce contrat, et il est PUR (aucun React, aucun import)
   — donc éprouvable tel quel par un banc, et réutilisé par les deux pages.

   ⚠ POURQUOI LA RELECTURE A ÉTÉ RÉÉCRITE. L'ancien import lisait les lignes à la
   POSITION : `cols[0]` = nom, `cols[1]` = séquence, `cols[2]` = type. Or
   l'export écrit `Name,Type,Sequence/Formula,MW,Notes` — LE TYPE D'ABORD. Un
   aller-retour donnait donc un composé nommé `"Peptide-01"` (guillemets
   compris : les valeurs exportées sont CITÉES), de type « la séquence » et de
   séquence « protein » : le fichier était bien lu, mais TOUS les champs
   glissaient d'une colonne. Et les huit autres sections du fichier (cellules,
   plasmides, solvants, tampons, additifs, instruments, sondes, programmes) se
   déversaient dans les composés les unes après les autres.

   LE CONTRAT MAINTENANT :
     • LES COLONNES SONT RECONNUES PAR LEUR EN-TÊTE (« Name », « Type »,
       « Sequence/Formula », « MW », « Notes ») dès qu'il y en a un ;
     • sans en-tête, l'ORDRE HISTORIQUE est gardé (nom, séquence, type) : les
       fichiers d'avant continuent de s'importer ;
     • LES VALEURS CITÉES SONT DÉCITÉES — une virgule, un point-virgule, une
       tabulation, un guillemet doublé ou même un retour à la ligne dans un champ
       ne coupe plus la ligne ;
     • UN SEUL SÉPARATEUR PAR FICHIER, et c'est celui qui découpe le PLUS de
       champs hors guillemets — virgule, point-virgule ou tabulation. C'est ce qui
       fait marcher un Excel italien ou français, qui exporte en « ; » et garde la
       virgule DÉCIMALE : « 58,44 » y reste UN nombre, pas deux colonnes ;
     • LE FICHIER EST LU PAR SECTIONS : le bouton « Import CSV » est celui de la
       fiche du composé, donc il n'importe QUE la section « COMPOUNDS » — un
       export complet ne peut plus transformer une lignée cellulaire en composé ;
     • LE TYPE EST RAMENÉ À CEUX DE LA FICHE (protein · dna · rna ·
       polysaccharide · smiles · formula), y compris quand le fichier porte le
       LIBELLÉ du menu (« Protein / Peptide ») ; un type inconnu retombe sur
       « protein », le défaut de la fiche ;
     • LA MASSE ET LES NOTES SUIVENT LE FICHIER : l'export les écrit, la
       relecture les remet (seule une colonne absente laisse « Imported from
       CSV ») ;
     • POUR UNE FORMULE, LE TEXTE VA DANS `sequence` — c'est là que la fiche le
       relit (`type === 'formula'` affiche `sequence` dans la case « Chemical
       Formula ») : sans cela, une formule revenue d'un fichier s'ouvrait vide.
   ========================================================================= */

/** UNE CELLULE ÉCRITE — toujours citée, guillemets doublés (l'écriture d'avant,
 *  à la lettre : un aller-retour ne peut donc pas changer le fichier lu par
 *  Excel / Google Sheets). */
const cell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;

/** LES BALISES HTML D'UNE SÉQUENCE — la fiche du composé est un `RichTextEditor`,
 *  donc du HTML : « div » et « br » se reliraient comme des acides aminés. Même
 *  règle que `stripHtml` de utils/sequenceInfo.js, recopiée ici pour que ce
 *  module reste PUR (aucun JSX à tirer derrière). */
const stripTags = (str) => String(str || '').replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ');

const listOf = (value) => (Array.isArray(value) ? value : []);
const nameOf = (item) => (typeof item === 'string' ? item : (item && item.name) || '');
const fieldOf = (item, key) => {
  if (typeof item === 'string' || !item) return '';
  const v = item[key];
  return v == null ? '' : v;
};

/* ══════════════════════════════════════════════════════════════════════════
   1. L'ÉCRITURE — « 📥 Export Full Library (CSV) »
   ══════════════════════════════════════════════════════════════════════════ */

/** LE TEXTE COMPLET DU FICHIER DE LA LIBRAIRIE. Les composés d'abord (c'est la
 *  section que la fiche relit), puis les huit autres listes de la page : même
 *  ordre, mêmes en-têtes, mêmes colonnes et une ligne vide devant chaque section
 *  — la factorisation ne change pas un octet du fichier produit.
 *
 *  `compounds` / `cellLines` / `plasmids` sont les NOMS (la page les présente
 *  ainsi), les autres listes sont les objets de la page (ou de simples noms). */
export const libraryCsvText = ({
  compounds = [], compoundMeta = {},
  cellLines = [], cellLineMeta = {},
  plasmids = [], plasmidMeta = {},
  solvents = [], buffers = [], additives = [],
  nmrInstruments = [], nmrProbes = [], nmrExperiments = [],
} = {}) => {
  const out = [];
  const put = (...lines) => lines.forEach((line) => out.push(line));
  const rowOf = (values) => put(values.map(cell).join(','));

  put('--- COMPOUNDS ---', 'Name,Type,Sequence/Formula,MW,Notes');
  listOf(compounds).forEach((name) => {
    const m = compoundMeta[name] || {};
    rowOf([name, m.type, stripTags(m.sequence || m.formula || m.smiles || ''), m.molecularWeight, m.notes]);
  });

  put('', '--- CELL LINES ---', 'Name,Organism,Tissue,Medium,Notes');
  listOf(cellLines).forEach((name) => {
    const m = cellLineMeta[name] || {};
    rowOf([name, m.organism, m.tissue, m.cultureMedium, m.notes]);
  });

  put('', '--- PLASMIDS ---', 'Name,Backbone,Promoter,Marker,MW,Notes');
  listOf(plasmids).forEach((name) => {
    const m = plasmidMeta[name] || {};
    rowOf([name, m.backbone, m.promoter, m.marker, m.molecularWeight, m.notes]);
  });

  put('', '--- SOLVENTS ---', 'Name,Density,MW,Comments');
  listOf(solvents).forEach((s) => {
    rowOf([nameOf(s), fieldOf(s, 'density'), fieldOf(s, 'molecularWeight'), fieldOf(s, 'comments')]);
  });

  put('', '--- BUFFERS ---', 'Name,Description,MW,Comments');
  listOf(buffers).forEach((b) => {
    rowOf([nameOf(b), fieldOf(b, 'description'), fieldOf(b, 'molecularWeight'), fieldOf(b, 'comments')]);
  });

  put('', '--- ADDITIVES ---', 'Name,Description,MW,Comments');
  listOf(additives).forEach((a) => {
    rowOf([nameOf(a), fieldOf(a, 'description'), fieldOf(a, 'molecularWeight'), fieldOf(a, 'comments')]);
  });

  put('', '--- NMR INSTRUMENTS ---', 'Name,Frequency (MHz),Manufacturer,Comments');
  listOf(nmrInstruments).forEach((i) => {
    rowOf([nameOf(i), fieldOf(i, 'frequency'), fieldOf(i, 'manufacturer'), fieldOf(i, 'comments')]);
  });

  put('', '--- NMR PROBES ---', 'Name,Type,Field (MHz),Comments');
  listOf(nmrProbes).forEach((p) => {
    const type = typeof p === 'string' ? '' : [p.type, p.subtype].filter(Boolean).join(' / ');
    rowOf([nameOf(p), type, fieldOf(p, 'field'), fieldOf(p, 'comments')]);
  });

  put('', '--- NMR EXPERIMENTS / PULSE PROGRAMS ---', 'Name,Dimensions,Nuclei,Comments');
  listOf(nmrExperiments).forEach((x) => {
    const nuclei = typeof x === 'string' ? ''
      : (Array.isArray(x.nuclei) ? x.nuclei.filter(Boolean).join(', ') : (x.nuclei || ''));
    rowOf([nameOf(x), fieldOf(x, 'dimensions'), nuclei, fieldOf(x, 'comments')]);
  });

  return out.join('\n');
};

/* ══════════════════════════════════════════════════════════════════════════
   2. LA RELECTURE — « Import CSV »
   ══════════════════════════════════════════════════════════════════════════ */

/** LE SÉPARATEUR D'UN FICHIER — celui qui découpe le PLUS de champs HORS
 *  GUILLEMETS : la virgule de notre export, le POINT-VIRGULE d'un Excel français
 *  ou italien (où la virgule est le séparateur DÉCIMAL — « 58,44 » doit rester UN
 *  nombre), la TABULATION d'un collage. Sans aucun séparateur (une colonne), la
 *  virgule : la question ne se pose pas. */
export const delimiterOf = (text) => {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const count = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && count[ch] !== undefined) count[ch] += 1;
  }
  const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  return count[best] > 0 ? best : ',';
};

/** LES LIGNES ET LES CHAMPS D'UN FICHIER CSV — le séparateur du fichier (voir
 *  `delimiterOf`), les guillemets (avec guillemets DOUBLÉS), les CRLF, un champ
 *  multi-lignes entre guillemets et le BOM compris. Les lignes entièrement vides
 *  (les séparateurs de sections de l'export) sont jetées. */
export const parseCsvRows = (text) => {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const sep = delimiterOf(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const endField = () => { row.push(field.trim()); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (src[i + 1] === '\n') i += 1; endRow(); }
    else field += ch;
  }
  if (field.length || row.length) endRow();
  return rows.filter((r) => r.some((c) => c !== ''));
};

/** UNE SECTION DU FICHIER — « --- COMPOUNDS --- ». Les tirets sont facultatifs
 *  mais c'est la forme que l'export écrit. */
const SECTION_RE = /^-{2,}\s*(.*?)\s*-{2,}$/;

/** LES EN-TÊTES DE COLONNES QUE LA RELECTURE RECONNAÎT. Un en-tête inconnu
 *  (« Length », « Links »…) laisse simplement sa colonne de côté : il ne peut
 *  pas décaler les autres, puisqu'on ne lit QUE par nom. */
const COLUMN_HEADERS = [
  [/^name$/i, 'name'],
  [/^type$/i, 'type'],
  [/^sequence(\s*\/\s*formula)?$/i, 'sequence'],
  [/^(mw|molecular\s*weight|masse)$/i, 'molecularWeight'],
  [/^(notes?|comments?|remarques?)$/i, 'notes'],
];

/** LE TYPE DU MENU « Molecule type » — les libellés du menu ET quelques façons
 *  courantes de les écrire, ramenés à la valeur que la fiche attend. Un type
 *  inconnu (ou absent) retombe sur « protein », le défaut de la fiche. */
const TYPE_RULES = [
  [/peptid|protein|amino|^aa$/, 'protein'],
  [/^dna/, 'dna'],
  [/^rna/, 'rna'],
  [/polysacchar|glycan|carbohydrat/, 'polysaccharide'],
  [/smiles|small\s*molecule/, 'smiles'],
  [/formula|chemical/, 'formula'],
];

const typeOf = (raw) => {
  const t = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!t) return 'protein';
  const rule = TYPE_RULES.find(([re]) => re.test(t));
  return rule ? rule[1] : 'protein';
};

/** LA MASSE — « 3 496.28 Da », « 3 496,28 » ou « 3496.28 » se relisent pareil :
 *  on ne garde que ce qui fait un nombre (virgule décimale et espaces compris).
 *  Ce qui ne fait pas un nombre positif ne s'invente pas : `null`. */
const massOf = (raw) => {
  const s = String(raw == null ? '' : raw).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const n = Number(s.replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const isHeaderRow = (row) => row.some((c) => /^name$/i.test(String(c || '').trim()));

const columnsOf = (row) => row.map((c) => {
  const h = String(c || '').trim();
  const rule = COLUMN_HEADERS.find(([re]) => re.test(h));
  return rule ? rule[1] : null;
});

const isSectionRow = (row) => row.length === 1 && SECTION_RE.test(String(row[0] || '').trim());

const sectionLabelOf = (row) => (String(row[0] || '').trim().match(SECTION_RE) || [])[1] || '';

/** LES COMPOSÉS D'UNE LISTE DE LIGNES — l'en-tête décide des colonnes, sinon
 *  l'ordre historique (nom, séquence, type) s'applique. Un nom déjà vu est
 *  remplacé par la ligne suivante (la dernière gagne), et une ligne sans nom
 *  n'est jamais un composé. */
const compoundsFromRows = (rows) => {
  const seen = new Map();
  let columns = null;
  rows.forEach((raw) => {
    const cells = raw.map((c) => String(c == null ? '' : c).trim());
    if (isHeaderRow(cells)) { columns = columnsOf(cells); return; }
    const at = (key, position) => {
      if (columns) {
        const i = columns.indexOf(key);
        return i >= 0 ? cells[i] : '';
      }
      return position == null ? '' : cells[position] || '';
    };
    const name = at('name', 0);
    if (!name) return;
    const type = typeOf(at('type', 2));
    const body = at('sequence', 1);
    seen.set(name, {
      name,
      type,
      sequence: type === 'smiles' ? '' : body,
      smiles: type === 'smiles' ? body : '',
      formula: type === 'formula' ? body : '',
      molecularWeight: massOf(at('molecularWeight', null)),
      notes: at('notes', null) || 'Imported from CSV',
    });
  });
  return [...seen.values()];
};

/** LE FICHIER RELU — les composés prêts pour la fiche, et ce qui a été vu :
 *
 *    { compounds: [{ name, type, sequence, smiles, formula, molecularWeight,
 *                    notes }],
 *      sections: ['COMPOUNDS', 'CELL LINES', …],   // pour le dire à l'écran
 *      sectioned: true }                            // le fichier est découpé
 *
 *  ⚠ SEULS LES COMPOSÉS SONT RENDUS : le bouton « Import CSV » vit dans la fiche
 *  du composé, donc un export complet ne peut pas déverser ses cellules, ses
 *  plasmides ou ses solvants dans les composés. Un fichier SANS section (une
 *  simple liste de trois colonnes, le cas d'avant) est lu en entier. */
export const parseLibraryCsv = (text) => {
  const rows = parseCsvRows(text);
  const sections = [];
  const loose = [];                     // les lignes d'avant la première section
  let current = null;
  rows.forEach((row) => {
    if (isSectionRow(row)) {
      current = { name: sectionLabelOf(row), rows: [] };
      sections.push(current);
      return;
    }
    (current ? current.rows : loose).push(row);
  });
  const source = sections.length
    ? (sections.find((s) => /^compounds?$/i.test(s.name)) || null)
    : { name: 'COMPOUNDS', rows: loose };
  return {
    compounds: source ? compoundsFromRows(source.rows) : [],
    sections: sections.map((s) => s.name),
    sectioned: sections.length > 0,
  };
};

export default parseLibraryCsv;

