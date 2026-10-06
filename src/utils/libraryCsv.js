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

/* ══════════════════════════════════════════════════════════════════════════
   3. LA RELECTURE PAR SECTION — « je choisis ce que j'importe »

   LA DEMANDE, MOT POUR MOT : « when i load a library I must be able to choose
   which subcategory or even elements I decide to upload ».

   `parseLibraryCsv` (ci-dessus) rend les COMPOSÉS : c'est tout ce que demande
   le bouton « Import CSV » de la fiche du composé. La page Librairie, elle,
   propose le fichier ENTIER : on y coche des SOUS-CATÉGORIES (« Compounds »,
   « Buffers »…) ou, dedans, des ÉLÉMENTS un par un. Ce module-ci rend cette
   lecture-là — les neuf sections du fichier, chacune dans la forme que la page
   attend (les mêmes champs que les fiches : `organism` / `tissue` /
   `cultureMedium` pour une lignée, `description` pour un tampon, `nuclei` en
   LISTE pour une expérience RMN…) — puis `libraryPlanPatch`, qui l'applique.

   ⚠ L'IMPORT EST ADDITIF — même règle que la relecture d'une sauvegarde (voir
   _library_restore_test.mjs) : il AJOUTE et COMPLÈTE par nom, il ne supprime
   JAMAIS, et un champ que le fichier ne porte pas garde sa valeur d'avant.
   ══════════════════════════════════════════════════════════════════════════ */

/** UN NOMBRE DE FICHIER — « 3 496,28 », « 600 », « 1,1 »… Le TEXTE est gardé
 *  tel quel quand on ne peut pas en faire un nombre (une unité collée au
 *  chiffre, par exemple), et une cellule vide rend « rien ». C'est `massOf`
 *  (ci-dessus) qui décide de ce qui est un nombre : une seule règle. */
const scalarOf = (raw) => {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const n = massOf(s);
  return n == null ? s : n;
};

/** LES LIGNES D'UNE SECTION ORDINAIRE — reconnues PAR LEUR EN-TÊTE. Les huit
 *  sections autres que « COMPOUNDS » n'ont jamais existé sans en-tête : c'est
 *  l'export qui les écrit. Une cellule VIDE n'entre pas dans la ligne : elle ne
 *  peut donc pas écraser, à l'import, la valeur déjà en place. Un nom déjà vu
 *  est remplacé par la ligne suivante (la dernière gagne). */
const rowsByHeader = (rows, fields) => {
  const seen = new Map();
  let columns = null;
  rows.forEach((raw) => {
    const cells = raw.map((c) => String(c == null ? '' : c).trim());
    if (isHeaderRow(cells)) {
      columns = cells.map((h) => {
        const rule = fields.find(([re]) => re.test(h));
        return rule ? rule[1] : null;
      });
      return;
    }
    if (!columns) return;
    const at = (key) => { const i = columns.indexOf(key); return i >= 0 ? cells[i] : ''; };
    const name = at('name');
    if (!name) return;
    const row = { name };
    columns.forEach((key, i) => { if (key && key !== 'name' && cells[i] !== '') row[key] = cells[i]; });
    seen.set(name, row);
  });
  return [...seen.values()];
};

/** LES CHAMPS D'EN-TÊTE PARTAGÉS PAR PLUSIEURS SECTIONS. */
const NAME_FIELD = [/^name$/i, 'name'];
const COMMENTS_FIELD = [/^(notes?|comments?|remarques?)$/i, 'comments'];
const MW_FIELD = [/^(mw|molecular\s*weight|masse)$/i, 'molecularWeight'];

/** LES NEUF SOUS-CATÉGORIES DE LA LIBRAIRIE, dans l'ordre du fichier. `match`
 *  reconnaît le nom de section écrit par l'export, `fields` les en-têtes des
 *  colonnes, `clean` achève la conversion (nombres, listes) : chaque ligne sort
 *  dans la forme de la fiche, jamais dans celle du fichier. */
const LIBRARY_SECTIONS = [
  {
    key: 'compounds', label: 'Compounds', unit: 'compound', match: /^compounds?$/i,
    rows: (rows) => compoundsFromRows(rows),
  },
  {
    key: 'cellLines', label: 'Cell Lines', unit: 'cell line', match: /^cell\s*lines?$/i,
    fields: [NAME_FIELD, [/^organism$/i, 'organism'], [/^tissue$/i, 'tissue'], [/^(medium|culture\s*medium)$/i, 'cultureMedium'], COMMENTS_FIELD],
    clean: (row) => ({ ...row, notes: row.notes || '' }),
  },
  {
    key: 'plasmids', label: 'Plasmids', unit: 'plasmid', match: /^plasmids?$/i,
    fields: [NAME_FIELD, [/^backbone$/i, 'backbone'], [/^promoter$/i, 'promoter'], [/^marker$/i, 'marker'], MW_FIELD, COMMENTS_FIELD],
    clean: (row) => ({ ...row, molecularWeight: massOf(row.molecularWeight) }),
  },
  {
    key: 'solvents', label: 'Solvents & Media', unit: 'solvent', match: /^solvents?/i,
    fields: [NAME_FIELD, [/^density$/i, 'density'], MW_FIELD, COMMENTS_FIELD],
    clean: (row) => ({ ...row, density: scalarOf(row.density), molecularWeight: massOf(row.molecularWeight) }),
  },
  {
    key: 'buffers', label: 'Buffers', unit: 'buffer', match: /^buffers?$/i,
    fields: [NAME_FIELD, [/^description$/i, 'description'], MW_FIELD, COMMENTS_FIELD],
    clean: (row) => ({ ...row, molecularWeight: massOf(row.molecularWeight) }),
  },
  {
    key: 'additives', label: 'Additives', unit: 'additive', match: /^additives?$/i,
    fields: [NAME_FIELD, [/^description$/i, 'description'], MW_FIELD, COMMENTS_FIELD],
    clean: (row) => ({ ...row, molecularWeight: massOf(row.molecularWeight) }),
  },
  {
    key: 'nmrInstruments', label: 'NMR Instruments', unit: 'instrument', match: /^nmr\s*instruments?$/i,
    fields: [NAME_FIELD, [/^frequency/i, 'frequency'], [/^manufacturer$/i, 'manufacturer'], COMMENTS_FIELD],
    clean: (row) => ({ ...row, frequency: scalarOf(row.frequency) }),
  },
  {
    key: 'nmrProbes', label: 'NMR Probes', unit: 'probe', match: /^nmr\s*probes?$/i,
    fields: [NAME_FIELD, [/^type$/i, 'type'], [/^field/i, 'field'], COMMENTS_FIELD],
    /* UNE SEULE CASE POUR DEUX CHAMPS — l'export écrit « HCN / cryo » (type et
       sous-type joints) : la relecture les sépare pour retrouver la fiche. */
    clean: (row) => {
      const parts = String(row.type || '').split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
      const out = { ...row, field: scalarOf(row.field) };
      delete out.type;
      if (parts[0]) out.type = parts[0];
      if (parts[1]) out.subtype = parts[1];
      return out;
    },
  },
  {
    key: 'nmrExperiments', label: 'NMR Experiments / Pulse Programs', unit: 'experiment', match: /^nmr\s*experiments?/i,
    fields: [NAME_FIELD, [/^dimension/i, 'dimensions'], [/^nuclei$/i, 'nuclei'], COMMENTS_FIELD],
    /* LES NOYAUX SONT UNE LISTE dans la fiche (`nuclei: ['H', 'N']`) et un texte
       dans le fichier (« H, N ») : on repart de la liste, jamais du texte. */
    clean: (row) => {
      const nuclei = String(row.nuclei || '').split(/[,;/]/).map((x) => x.trim()).filter(Boolean);
      const out = { ...row };
      delete out.nuclei;
      if (nuclei.length) out.nuclei = nuclei;
      return out;
    },
  },
];

/** LE FICHIER LU PAR SOUS-CATÉGORIE —
 *
 *    { sections: [{ key, label, unit, rows }], sectioned, total }
 *
 *  Seules les sections NON VIDES sont rendues : on ne propose jamais de cocher
 *  une sous-catégorie que le fichier ne porte pas. Un fichier SANS section (une
 *  simple liste de composés, le cas d'avant) est lu comme « COMPOUNDS »,
 *  exactement comme `parseLibraryCsv` le fait. */
export const parseLibrarySections = (text) => {
  const rows = parseCsvRows(text);
  const buckets = new Map();      // clé de section → lignes brutes
  let current = null;             // section courante (null : inconnue, ou à venir)
  let sectioned = false;
  const push = (def, row) => {
    if (!buckets.has(def.key)) buckets.set(def.key, []);
    buckets.get(def.key).push(row);
  };
  rows.forEach((row) => {
    if (isSectionRow(row)) {
      sectioned = true;
      const label = sectionLabelOf(row);
      current = LIBRARY_SECTIONS.find((d) => d.match.test(label)) || null;
      return;
    }
    if (!sectioned) { push(LIBRARY_SECTIONS[0], row); return; }
    if (current) push(current, row);
  });
  const sections = LIBRARY_SECTIONS
    .filter((def) => buckets.has(def.key))
    .map((def) => {
      const raw = buckets.get(def.key);
      const rowsOf = def.rows ? def.rows(raw)
        : rowsByHeader(raw, def.fields).map((row) => (def.clean ? def.clean(row) : row));
      return { key: def.key, label: def.label, unit: def.unit, rows: rowsOf };
    })
    .filter((s) => s.rows.length > 0);
  return { sections, sectioned, total: sections.reduce((n, s) => n + s.rows.length, 0) };
};

/* ── LA FUSION — additive, par nom, jamais destructrice ─────────────────── */

/** LES SEULS CHAMPS QUE LE FICHIER PORTE : une cellule vide (ou absente) ne
 *  fait pas partie de la ligne — elle ne peut donc rien écraser. */
const carriedOf = (row) => Object.fromEntries(
  Object.entries(row || {}).filter(([key, value]) => key !== 'name' && value !== '' && value != null)
);

/** FUSION PAR NOM d'une LISTE d'objets (solvants, tampons, additifs, sondes,
 *  instruments, expériences) : l'élément connu est COMPLÉTÉ, l'inconnu est
 *  AJOUTÉ, rien n'est retiré. Un élément arrivé par un fichier prend le nom
 *  pour identifiant — c'est aussi ce qui le rend retrouvable à l'écran. */
const mergeListByName = (current, incoming) => {
  const out = listOf(current).map((it) => (typeof it === 'string' ? { id: it, name: it } : { ...it }));
  listOf(incoming).forEach((row) => {
    if (!row || !row.name) return;
    const carried = carriedOf(row);
    const at = out.findIndex((it) => (it.name || '') === row.name);
    if (at >= 0) out[at] = { ...out[at], ...carried };
    else out.push({ id: row.name, ...carried, name: row.name });
  });
  return out;
};

/** FUSION PAR NOM d'un OBJET indexé par le nom (fiches lignées, plasmides). */
const mergeMetaByName = (current, incoming) => {
  const out = { ...(current && typeof current === 'object' ? current : {}) };
  listOf(incoming).forEach((row) => {
    if (!row || !row.name) return;
    const before = out[row.name] && typeof out[row.name] === 'object' ? out[row.name] : {};
    out[row.name] = { ...before, ...carriedOf(row), name: row.name, updatedAt: Date.now() };
  });
  return out;
};

/** LES COMPOSÉS DU FICHIER DANS LEUR FICHE — même règle que l'« Import CSV » de
 *  la fiche du composé (nom, type, séquence / SMILES / formule, notes, et la
 *  masse du fichier ou, à défaut, celle d'avant) : un seul comportement pour
 *  les deux boutons. */
const mergeCompoundRows = (current, incoming) => {
  const out = { ...(current && typeof current === 'object' ? current : {}) };
  listOf(incoming).forEach((row) => {
    if (!row || !row.name) return;
    const before = out[row.name] || {};
    out[row.name] = {
      ...before,
      name: row.name,
      type: row.type,
      sequence: row.sequence,
      smiles: row.smiles,
      formula: row.formula,
      notes: row.notes,
      molecularWeight: row.molecularWeight == null ? (before.molecularWeight ?? null) : row.molecularWeight,
      updatedAt: Date.now(),
    };
  });
  return out;
};

/** LES NOMS AJOUTÉS À UNE LISTE DE NOMS (composés / lignées personnalisés) —
 *  jamais deux fois, jamais en écrasant une entrée en forme d'objet. */
const addNamesToList = (current, names) => {
  const out = listOf(current).slice();
  const has = (name) => out.some((c) => (typeof c === 'string' ? c : (c && c.name)) === name);
  listOf(names).forEach((name) => { if (name && !has(name)) out.push(name); });
  return out;
};

/** LE PLAN APPLIQUÉ — `libraryPlanPatch(state, plan)` rend UNIQUEMENT les clés
 *  qui changent, prêtes pour les setters de la page Librairie. Le plan vient du
 *  panneau de sélection : lui seul sait ce qui a été coché (une sous-catégorie
 *  entière, ou les éléments choisis un par un). */
export const libraryPlanPatch = (state, plan) => {
  const src = state && typeof state === 'object' ? state : {};
  const p = plan && typeof plan === 'object' ? plan : {};
  const namesOf = (rows) => listOf(rows).map((r) => r && r.name).filter(Boolean);
  const patch = {};
  if (listOf(p.compounds).length) {
    patch.compoundMeta = mergeCompoundRows(src.compoundMeta, p.compounds);
    patch.customCmpds = addNamesToList(src.customCmpds, namesOf(p.compounds));
  }
  if (listOf(p.cellLines).length) {
    patch.cellLineMeta = mergeMetaByName(src.cellLineMeta, p.cellLines);
    patch.customCellLines = addNamesToList(src.customCellLines, namesOf(p.cellLines));
  }
  if (listOf(p.plasmids).length) patch.plasmidMeta = mergeMetaByName(src.plasmidMeta, p.plasmids);
  if (listOf(p.solvents).length) patch.solvents = mergeListByName(src.solvents, p.solvents);
  if (listOf(p.buffers).length) patch.buffers = mergeListByName(src.buffers, p.buffers);
  if (listOf(p.additives).length) patch.additives = mergeListByName(src.additives, p.additives);
  if (listOf(p.nmrInstruments).length) patch.nmrInstruments = mergeListByName(src.nmrInstruments, p.nmrInstruments);
  if (listOf(p.nmrProbes).length) patch.nmrProbes = mergeListByName(src.nmrProbes, p.nmrProbes);
  if (listOf(p.nmrExperiments).length) patch.nmrExperiments = mergeListByName(src.nmrExperiments, p.nmrExperiments);
  return patch;
};

export default parseLibraryCsv;

