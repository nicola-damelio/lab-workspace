/* =========================================================================
   src/administration/importUtils.js
   Import « Google Sheets » → collections du module Administration.

   Classeur budget (Budget_GEC_UPJV_2026) — un onglet par page d’admin :
     · « Lignes budgétaires »   → collection recettes (page Recettes)
     · « Dépenses »             → collection depenses (BC / SIFAC, livraisons)
     · « OMs »                  → collection om (ordres de mission)
     · « Souhaités »            → collection desiderate (souhaits d’achat)
     · « Questions_ouvertes »   → collection questioni
     · « H&S »                  → collection sicurezza
   Classeur « Personnel » de l’équipe → collection personnel (page Personnel) :
     · onglet annuaire (porteur / type / HDR / BAP / échelon / RIPEC…)
     · onglet stagiaires (encadrant / Projet / debut / fin contrat…)

   Le parsing accepte le texte collé depuis Google Sheets (TSV), l’export
   CSV/TSV, ou un classeur Excel (.xlsx/.xls via la lib `xlsx`). Aucune
   lecture distante : l’utilisateur colle ou dépose les données, pas de clé
   API, pas de CORS.
   ========================================================================= */

// Feuilles sources (liens du bouton « Ouvrir la feuille source »).
// Classeur budget « Budget_GEC_UPJV_2026 » : un onglet par page d’admin.
export const GOOGLE_SHEET_LINKS = {
  recettes: 'https://docs.google.com/spreadsheets/d/1m0V9L7vcYtx0bzHsdkJjLgrJT-cgk8oD58VbiwdMUtc/edit?gid=2029921384#gid=2029921384',
  depenses: 'https://docs.google.com/spreadsheets/d/1m0V9L7vcYtx0bzHsdkJjLgrJT-cgk8oD58VbiwdMUtc/edit?gid=0#gid=0',
  om: 'https://docs.google.com/spreadsheets/d/1m0V9L7vcYtx0bzHsdkJjLgrJT-cgk8oD58VbiwdMUtc/edit?gid=1495246607#gid=1495246607',
  desiderate: 'https://docs.google.com/spreadsheets/d/1m0V9L7vcYtx0bzHsdkJjLgrJT-cgk8oD58VbiwdMUtc/edit?gid=203092031#gid=203092031',
  questioni: 'https://docs.google.com/spreadsheets/d/1m0V9L7vcYtx0bzHsdkJjLgrJT-cgk8oD58VbiwdMUtc/edit?gid=923776700#gid=923776700',
  sicurezza: 'https://docs.google.com/spreadsheets/d/1m0V9L7vcYtx0bzHsdkJjLgrJT-cgk8oD58VbiwdMUtc/edit?gid=652048951#gid=652048951',
  personnel: 'https://docs.google.com/spreadsheets/d/1iUjjE7JeJbvnjDmMT3KPUKqkoVJUegM3IRw9ZQ5n_q8/edit?gid=2082111636#gid=2082111636',
  conges: 'https://docs.google.com/spreadsheets/d/1ere7clPdEA9bru7W-V2C7Wl76smTf4J8uf69BnvGNQA/edit?gid=555000330#gid=555000330',
};

/* Normalisation « tolérante » des en-têtes : minuscules, sans accents ni
   apostrophes — reconnaît « Categorie » et « Catégorie », etc. */
export const normalizeKey = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'‘“”«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/* ── Découpage d’un tableau texte (CSV/TSV, guillemets « " » gérés) ───────── */
const DELIMITERS = ['\t', ',', ';', '|'];

const splitDelimited = (text, delim) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

const medianOf = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/* Détecte le séparateur (tabulation collée depuis Sheets, virgule CSV,
   point-virgule Excel FR…) en gardant la grille la plus régulière. */
export const parseDelimitedText = (raw) => {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  let best = null;
  let bestScore = -1;
  DELIMITERS.forEach((d) => {
    const rows = splitDelimited(text, d).filter((r) => r.length > 1);
    if (!rows.length) return;
    const modal = medianOf(rows.map((r) => r.length));
    if (modal < 2) return;
    const score = rows.filter((r) => r.length === modal).length * 1000 - modal;
    if (score > bestScore) { bestScore = score; best = splitDelimited(text, d); }
  });
  const rows = best || splitDelimited(text, '\t');
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out.map((c) => String(c ?? '').trim());
  });
};

/* ── Hyperliens de cellules (copier-coller & .xlsx) ─────────────────────────
   Google Sheets n’exporte qu’un TEXTE par cellule. Pour un « lien cliquable »
   (bleu souligné), ce texte est souvent le nom du fichier : l’adresse (URL)
   n’existe que dans les métadonnées — HTML du presse-papier quand on copie
   depuis le navigateur, ou fichier .xlsx téléchargé. On récupère ces URL et on
   ajoute, pour les feuilles « Dépenses », les colonnes « Lien … » correspondantes
   (déjà reconnues par buildDepenses et collectLivraisonPhases). */

const DEPENSE_HEADER_HINTS = [
  'suivi', 'ent', 'description', 'demandeur', 'categorie', 'ligne budgetaire',
  'montant ht', 'frais de port', 'date demande', 'nom du fournisseur',
  'n° devis', 'n° sifac', 'date bc', 'n° bc', 'date signature',
  'date approb fornisseur', 'n° facture', 'livraison complete', 'commentaires', 'classification',
];

export const isDepensesHeader = (keys) => {
  const k = (Array.isArray(keys) ? keys : []).map(normalizeKey);
  return k.filter((x) => DEPENSE_HEADER_HINTS.includes(x)).length >= 2;
};

/* En-tête de colonne « document » → en-tête « Lien … » attendu par le builder. */
const docToLinkHeader = (headerText) => {
  const k = normalizeKey(headerText);
  if (!k) return null;
  const words = k.split(/[^a-z0-9]+/).filter(Boolean);
  const numbered = (prefix) => {
    const w = words.find((x) => new RegExp(`^${prefix}[0-9]+$`).test(x));
    return w ? w.slice(prefix.length) : null;
  };
  const bl = numbered('bl');
  if (bl !== null) return `Lien BL${bl}`;
  const sf = numbered('sf');
  if (sf !== null) return `Lien SF${sf}`;
  if (words.includes('bc') || k.includes('bon de commande')) return 'Lien BC';
  if (words.includes('om')) return 'Lien OM';
  if (k.includes('devis')) return 'Lien devis';
  if (k.includes('facture')) return 'Lien facture';
  return null;
};

/* Ajoute en fin de grille une colonne « Lien … » pour chaque colonne de
   document dont au moins une cellule possède une URL d’hyperlien. */
export const augmentRowsWithCellUrls = (rows, urlAt) => {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 12) && headerIdx < 0; i++) {
    if (isDepensesHeader(rows[i])) headerIdx = i;
  }
  if (headerIdx < 0) return rows;
  const header = rows[headerIdx].map(normalizeKey);
  const additions = [];
  for (let c = 0; c < header.length; c++) {
    const target = docToLinkHeader(rows[headerIdx][c]);
    if (!target || header.includes(normalizeKey(target))) continue;
    const values = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const meta = (urlAt && String(urlAt(r, c) || '').trim()) || '';
      const text = String(rows[r][c] ?? '').trim();
      values.push(meta || (/^https?:/i.test(text) ? text : ''));
    }
    if (values.some((v) => v)) additions.push({ target, values });
  }
  if (!additions.length) return rows;
  return rows.map((row, r) => {
    const out = row.slice();
    while (out.length < header.length) out.push('');
    additions.forEach((a) => {
      out.push(r === headerIdx ? a.target : (a.values[r - headerIdx - 1] || ''));
    });
    return out;
  });
};

/* Adresses Excel « A1 » ↔ { r, c } — sans dépendre de la lib, car le workbook
   retourné par XLSX.read ne porte pas toujours les utilitaires. */
const lettersToCol = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const rcToAddr = (r, c) => {
  let letters = '';
  let n = c + 1;
  while (n > 0) { const rem = (n - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; n = Math.floor((n - 1) / 26); }
  return `${letters}${r + 1}`;
};
const addrToRC = (addr) => {
  const m = String(addr).match(/^([A-Z]+)([0-9]+)$/);
  return m ? { r: parseInt(m[2], 10) - 1, c: lettersToCol(m[1]) } : { r: 0, c: 0 };
};
const refToRange = (ref) => {
  const parts = String(ref || 'A1').split(':');
  const s = addrToRC(parts[0]);
  const e = parts[1] ? addrToRC(parts[1]) : s;
  return { s, e };
};

/* Classeur Excel (.xlsx/.xls) → liste { name, rows } par onglet. Lit aussi les
   hyperliens (cell.l.Target) pour reconstruire les colonnes « Lien … ». */
export const parseXlsxWorkbook = (workbook) => {
  const out = [];
  const names = workbook && workbook.SheetNames ? workbook.SheetNames : [];
  names.forEach((name) => {
    const ws = workbook.Sheets[name];
    if (!ws) return;
    const range = ws['!ref'] ? refToRange(ws['!ref']) : null;
    const matrix = [];
    const urlRows = [];
    if (range) {
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row = [];
        const urlRow = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          let v = '';
          let url = '';
          const cell = ws[rcToAddr(r, c)];
          if (cell) {
            if (cell.v !== undefined && cell.v !== null) v = cell.v;
            const l = cell.l;
            if (l) {
              const raw = l.Target || l.Location || (typeof l.Tooltip === 'string' ? l.Tooltip : '');
              if (raw) url = String(raw).trim();
            }
          }
          row.push(v);
          urlRow.push(url);
        }
        if (row.every((x) => x === '' || x === null || x === undefined)) continue;
        matrix.push(row);
        urlRows.push(urlRow);
      }
    }
    const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
    const rows = matrix.map((r) => {
      const o = r.slice(0, width);
      while (o.length < width) o.push('');
      return o.map((c) => (typeof c === 'string' ? c.trim() : c));
    });
    const urls = urlRows.map((r) => {
      const o = r.slice(0, width);
      while (o.length < width) o.push('');
      return o;
    });
    out.push({
      name: String(name || ''),
      rows: augmentRowsWithCellUrls(rows, (r, c) => (urls[r] && urls[r][c]) || ''),
    });
  });
  return out;
};

/* Presse-papier : Google Sheets fournit aussi la version HTML (tableau) du
   collage, qui contient les vraies adresses des liens cliquables (<a href>).
   On reconstruit la même grille à partir du DOM pour conserver ces adresses. */
export const parseHtmlClipboard = (html) => {
  if (typeof DOMParser === 'undefined' || !/<\/?(table|tr|td|th)\b/i.test(String(html || ''))) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); }
  catch { return null; }
  const table = doc && doc.querySelector('table');
  if (!table) return null;
  const matrix = [];
  const urls = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const row = [];
    const urlRow = [];
    tr.querySelectorAll('td, th').forEach((td) => {
      const a = td.querySelector('a[href]');
      let url = '';
      if (a) {
        const href = (a.getAttribute('href') || '').trim();
        if (/^(https?|ftp|mailto):/i.test(href)) url = href;
      }
      row.push(String(td.textContent || '').replace(/[ \t\u00a0]+/g, ' ').trim());
      urlRow.push(url);
    });
    if (row.some((t) => t !== '')) { matrix.push(row); urls.push(urlRow); }
  });
  if (!matrix.length) return null;
  const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (arr) => { const o = arr.slice(); while (o.length < width) o.push(''); return o; };
  const rows = matrix.map((r) => pad(r).map((c) => c));
  const urlCells = urls.map((r) => pad(r));
  return augmentRowsWithCellUrls(rows, (r, c) => (urlCells[r] && urlCells[r][c]) || '');
};

/* ── Convertisseurs : montants « € 18.664,00 », dates FR / ISO ────────────── */
export const parseEuroAmount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[\u00A0\u202F\u2009]/g, ' ');
  s = s.replace(/[€£$]/g, ' ');
  s = s.replace(/\bEUR\b/gi, ' ');
  s = s.replace(/\s+/g, ' ');
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[+\-−]+/, (m) => { if (m.includes('-') || m.includes('−')) sign *= -1; return ''; });
  s = s.replace(/['’]/g, '');
  const lc = s.lastIndexOf(',');
  const ld = s.lastIndexOf('.');
  let intPart = s;
  let dec = '';
  if (lc > -1 && ld > -1) {
    if (lc > ld) { dec = s.slice(lc + 1); intPart = s.slice(0, lc).replace(/\./g, ''); }
    else { dec = s.slice(ld + 1); intPart = s.slice(0, ld).replace(/,/g, ''); }
  } else if (lc > -1) { dec = s.slice(lc + 1); intPart = s.slice(0, lc).replace(/[.\s]/g, ''); }
  else if (ld > -1) { dec = s.slice(ld + 1); intPart = s.slice(0, ld).replace(/[,\s]/g, ''); }
  else intPart = s.replace(/[.,\s]/g, '');
  intPart = intPart.replace(/\D/g, '') || '0';
  dec = dec.replace(/\D/g, '');
  const n = Number(intPart + (dec ? '.' + dec : ''));
  return Number.isFinite(n) ? n * sign : null;
};

/* Dates « 20/10/2025 » (Sheets FR) ou ISO → yyyy-mm-dd pour les <input>. */
export const parseDateCell = (value) => {
  if (typeof value === 'number') {
    // Numéro de série Excel (domaine : années ~1928 à ~2119). Une simple
    // année (« 2016 ») n’est PAS un numéro de série → on ne la convertit pas.
    if (!Number.isFinite(value) || value < 10000 || value > 80000) return '';
    try { return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10); }
    catch { return ''; }
  }
  let s = String(value ?? '').trim();
  if (!s) return '';
  const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) {
    const d = new Date(+fr[3], +fr[2] - 1, +fr[1]);
    if (!Number.isNaN(d.getTime())) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
    return '';
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const DAYS_MONTH = 30.4375;
export const monthsBetween = (startISO, endISO) => {
  if (!startISO || !endISO) return null;
  const a = new Date(startISO);
  const b = new Date(endISO);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const mo = (b - a) / (86400000 * DAYS_MONTH);
  return mo > 0 ? Math.max(1, Math.round(mo)) : null;
};

/* « 6 mois » dans la note, sinon durée déduite des dates début/fin. */
export const extractMonths = (text, startISO, endISO) => {
  const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*(mois|month)/i);
  if (m) {
    const n = parseEuroAmount(m[1].replace(',', '.'));
    return n && n > 0 ? Math.round(n) : null;
  }
  return monthsBetween(startISO, endISO);
};

/* ── Profils d’import : une feuille Google Sheets → une collection ───────── */
export const IMPORT_PRESETS = [
  {
    id: 'recettes-lignes',
    kind: 'recettes',
    title: 'Lignes budgétaires',
    icon: '📈',
    tabLabel: 'Lignes budgétaires',
    sourceUrl: GOOGLE_SHEET_LINKS.recettes,
    expectHeaders: ['Lignes budgétaires', 'Categorie', 'porteur', 'type', 'Budget totale', 'Budget disponible', 'Date de fin engagement', 'Note'],
    help: 'Onglet « Lignes budgétaires » de la feuille Google Sheets : Fichier → Télécharger → CSV (feuille actuelle), ou copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
  {
    id: 'personnel-permanents',
    kind: 'personnel',
    title: 'Personnel (annuaire)',
    icon: '👥',
    tabLabel: 'Personnel',
    sourceUrl: GOOGLE_SHEET_LINKS.personnel,
    expectHeaders: ['porteur', 'type', 'HDR', 'BAP', 'Categorie', 'echelon', 'chevron', 'depuis', 'derniere RIPEC', 'arrivé en', 'fin contrat', 'SST', 'date formation autoclave', 'Note'],
    help: 'Onglet « Personnel » de la feuille Google Sheets (permanents, techniques, doctorants…) : Fichier → Télécharger → CSV (feuille actuelle), ou copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
  {
    id: 'personnel-stagiaires',
    kind: 'personnel',
    title: 'Stagiaires / Personnel',
    icon: '👥',
    tabLabel: 'Stagiaires',
    sourceUrl: GOOGLE_SHEET_LINKS.personnel,
    expectHeaders: ['porteur', 'type', 'encadrant', 'encadrant2', 'Projet', 'debut', 'fin contrat', 'Note'],
    help: 'Onglet des stagiaires de la feuille Google Sheets : Fichier → Télécharger → CSV (feuille actuelle), ou copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
  {
    id: 'depenses-bc',
    kind: 'depenses',
    title: 'Dépenses (BC & SIFAC)',
    icon: '🧾',
    tabLabel: 'Dépenses',
    sourceUrl: GOOGLE_SHEET_LINKS.depenses,
    expectHeaders: ['Suivi', 'ENT', 'Description', 'Demandeur', 'Categorie', 'Ligne budgetaire', 'Montant HT', 'Frais de port', 'Date demande', 'Nom du fournisseur', 'n° SIFAC', 'Date BC', 'n° BC', 'Date signature', 'n° facture', 'Livraison complete', 'Commentaires', 'Classification', 'Lien devis', 'Lien BC', 'Lien facture', 'Lien OM', 'Lien BL1', 'Lien SF1'],
    help: 'Onglet « Dépenses » du classeur Google Sheets (suivi des bons de commande / SIFAC, réceptions en plusieurs colis) : copier le tableau (Ctrl+A puis Ctrl+C) ou Fichier → Télécharger → CSV (feuille actuelle), puis coller ci-dessous. Pour importer aussi les liens ↗ des documents, l’idéal est de copier le tableau depuis Google Sheets (Ctrl+A puis Ctrl+C : les adresses des liens cliquables sont récupérées automatiquement) ou de téléverser le fichier Excel (.xlsx) téléchargé (Fichier → Télécharger → Microsoft Excel) — un export CSV ne conserve pas les adresses des liens cliquables. Sans lien cliquable, ajoutez des colonnes « Lien devis », « Lien BC », « Lien facture », « Lien OM » et, par colis, « Lien BL1 », « Lien SF1 », « Lien BL2 »… avec l’adresse complète du document (https://…) en texte. Note : un simple lien vers la feuille ne suffit pas (le navigateur ne peut pas la lire à distance).',
  },
  {
    id: 'om-missions',
    kind: 'om',
    title: 'Ordres de mission (OMs)',
    icon: '✈️',
    tabLabel: 'OMs',
    sourceUrl: GOOGLE_SHEET_LINKS.om,
    expectHeaders: ['ENT', 'Prix', 'Description', 'Demandeur', 'Categorie', 'Ligne budgetaire', 'voyage', 'lodgement', 'repas', 'inscription', 'Montant HT', 'Date demande', 'Date mission', 'Date retour', 'OM', 'Commentaires'],
    help: 'Onglet « OMs » du classeur Google Sheets (missions : voyage / logement / repas / inscription, dates aller-retour) : copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
  {
    id: 'desiderate-souhaits',
    kind: 'desiderate',
    title: 'Souhaits d’achat',
    icon: '🛒',
    tabLabel: 'Souhaités',
    sourceUrl: GOOGLE_SHEET_LINKS.desiderate,
    expectHeaders: ['Decision', 'Priorité', 'Cout', 'Description', 'Demandeur', 'Categorie', 'Ligne budgetaire', 'Frais de port/travel', 'Date demande', 'Nom du fournisseur', 'n° devis', 'Lien devis', 'Code produit', 'Commentaires'],
    help: 'Onglet « Souhaités » du classeur Google Sheets (demandes d’achat : décision, priorité, coût estimé/exact, devis, code produit) : copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous. Pour conserver le lien Drive du devis sur le souhait, copiez le tableau depuis Google Sheets (les adresses des liens cliquables ↗ sont récupérées automatiquement) ou ajoutez une colonne « Lien devis » avec l’adresse complète (https://…) du fichier.',
  },
  {
    id: 'conges-demandes',
    kind: 'conges',
    title: 'Congés (demandes)',
    icon: '🏖️',
    tabLabel: 'Congés',
    sourceUrl: GOOGLE_SHEET_LINKS.conges,
    expectHeaders: ['Demandeur', 'Date initiale', 'Date dernier jour de congé', 'Jours', 'Notes', 'Approuvation'],
    help: 'Onglet « Congés » de la feuille Google Sheets (planning des demandes : Demandeur, dates, Jours, Notes, Approuvation) : copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
  {
    id: 'questioni-reminders',
    kind: 'questioni',
    title: 'Questions ouvertes',
    icon: '❓',
    tabLabel: 'Questions_ouvertes',
    sourceUrl: GOOGLE_SHEET_LINKS.questioni,
    expectHeaders: ['Question', 'Categorie', 'Note'],
    help: 'Onglet « Questions_ouvertes » du classeur Google Sheets : copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
  {
    id: 'sicurezza-hs',
    kind: 'sicurezza',
    title: 'Hygiène & sécurité',
    icon: '🛡️',
    tabLabel: 'H&S',
    sourceUrl: GOOGLE_SHEET_LINKS.sicurezza,
    expectHeaders: ['Question', 'Responsable', 'Categorie', 'priorité', 'Note'],
    help: 'Onglet « H&S » du classeur Google Sheets (tâches d’hygiène & sécurité / DUERP) : copier le tableau (Ctrl+A puis Ctrl+C) et coller ci-dessous.',
  },
];

/* Recherche de la ligne d’en-tête connue dans les premières lignes. */
const DETECT_RULES = {
  'conges-demandes': {
    min: 4,
    strong: ['demandeur', 'date initiale', 'date dernier jour de conge', 'jours', 'approuvation'],
    strongMin: 3,
    absent: ['suivi', 'ent', 'voyage', 'decision', 'question', 'budget totale', 'categorie'],
  },
  'depenses-bc': {
    min: 6,
    strong: ['suivi', 'ent', 'description', 'demandeur', 'categorie', 'ligne budgetaire', 'montant ht', 'frais de port', 'date demande', 'nom du fournisseur', 'contact fornisseur', 'n° devis', 'n° sifac', 'date bc', 'n° bc', 'date signature', 'date approb fornisseur', 'n° facture', 'livraison complete', 'commentaires', 'classification'],
    strongMin: 2,
    absent: ['prix', 'voyage', 'lodgement', 'decision', 'code produit', 'question'],
  },
  'om-missions': {
    min: 5,
    strong: ['ent', 'prix', 'description', 'demandeur', 'categorie', 'ligne budgetaire', 'voyage', 'lodgement', 'repas', 'inscription', 'montant ht', 'date demande', 'date mission', 'date retour', 'om', 'commentaires'],
    strongMin: 2,
    absent: ['suivi', 'n° sifac', 'decision', 'code produit', 'question'],
  },
  'desiderate-souhaits': {
    min: 5,
    strong: ['decision', 'priorite', 'cout', 'description', 'demandeur', 'categorie', 'ligne budgetaire', 'code produit', 'commentaires'],
    strongMin: 2,
    absent: ['voyage', 'lodgement', 'n° sifac', 'suivi', 'question'],
  },
  'questioni-reminders': {
    min: 2,
    strong: ['question'],
    strongMin: 1,
    absent: ['responsable', 'priorite', 'suivi', 'decision'],
  },
  'sicurezza-hs': {
    min: 4,
    strong: ['question', 'responsable', 'categorie', 'priorite', 'note'],
    strongMin: 2,
    absent: ['suivi', 'decision', 'voyage', 'n° sifac'],
  },
  'recettes-lignes': {
    min: 4,
    strong: ['lignes budgetaires', 'categorie', 'budget totale', 'budget disponible'],
    strongMin: 2,
  },
  'personnel-permanents': {
    min: 6,
    strong: ['hdr', 'bap', 'categorie', 'echelon', 'chevron', 'derniere ripce', 'arrive en', 'sst', 'date formation autoclave'],
    strongMin: 2,
  },
  'personnel-stagiaires': {
    min: 4,
    strong: ['porteur'],
    strongMin: 1,
    extra: ['encadrant', 'encadrant2', 'projet', 'fin contrat'],
  },
};

/* Règle « une ligne d’en-tête correspond-elle au profil ? » (partagée par la
   détection et le chaînage des blocs empilés dans un même collage). */
const presetMatchesRow = (preset, rowKeys) => {
  const rule = DETECT_RULES[preset.id];
  const expected = preset.expectHeaders.map(normalizeKey);
  const found = rowKeys.filter((cellKey) => expected.includes(cellKey)).length;
  if (found < (rule ? rule.min : 3)) return false;
  if (rule && rule.strong) {
    const strongHits = (rule.strong || []).filter((s) => rowKeys.includes(s)).length;
    if (strongHits < (rule.strongMin || 1)) return false;
  }
  if (rule && rule.extra) {
    if (!rule.extra.some((s) => rowKeys.includes(s))) return false;
  }
  if (rule && rule.absent) {
    if (rule.absent.some((s) => rowKeys.includes(s))) return false;
  }
  return true;
};

export const detectImport = (rows) => {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const scan = rows.slice(0, 15);
  for (const preset of IMPORT_PRESETS) {
    let headerIdx = -1;
    for (let i = 0; i < scan.length && headerIdx < 0; i++) {
      if (presetMatchesRow(preset, scan[i].map(normalizeKey))) headerIdx = i;
    }
    if (headerIdx >= 0) return { preset, headerIdx };
  }
  return null;
};

const findColumn = (header, aliases) => {
  const wanted = (Array.isArray(aliases) ? aliases : [aliases]).map(normalizeKey);
  return header.findIndex((cellH) => wanted.includes(normalizeKey(cellH)));
};

const cell = (row, idx) => (idx >= 0 && row && row[idx] !== undefined && row[idx] !== null ? row[idx] : '');

const hasContent = (row) => (Array.isArray(row) ? row : []).some((c) => String(c ?? '').trim() !== '');

const clean = (v) => String(v ?? '').trim();

/* Cellules « N° devis / N° BC / N° facture… » qui portent l’hyperlien du
   document : le texte visible exporté devient le nom du fichier (ex.
   « Devis_2026-015_Fournisseur.pdf »), et le N° de référence — « 2026-015 » —
   y figure comme un segment séparé par des « _ ». On extrait ce N° pour le
   champ « numéro » ; une URL ou un nom de fichier seul ne doit jamais atterrir
   dans ces champs. Si rien ne ressemble à un N° (année + séquence), on renvoie
   une chaîne vide plutôt que le nom du fichier. */
const DOC_EXT_RE = /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|csv|txt|jpe?g|png|gif)\s*$/i;
const canonicalCode = (code) => String(code).replace(/[._/]/g, '-');

const findCodeIn = (text) => {
  if (!text) return '';
  const s = String(text);
  // « 2026-015 » isolé (c’est déjà le N°, pas un nom de fichier).
  const whole = s.match(/^((?:19|20)\d{2}[-_./]\d{1,5})$/);
  if (whole) return canonicalCode(whole[1]);
  // Segments délimités par « _ » ou espaces (nom de fichier), extension ignorée.
  const parts = s.split(/[_ ]+/).map((p) => p.replace(DOC_EXT_RE, ''));
  for (const part of parts) {
    const ex = part.match(/^((?:19|20)\d{2}[-_./]\d{1,5})$/);
    if (ex) return canonicalCode(ex[1]);
  }
  // Recherche libre (ex. « BC2026-015 », sans exiger un séparateur) mais en
  // refusant les dates complètes « 2026-01-15 » (on ne garderait que « 2026-01 »).
  const m = s.match(
    /(?:^|[^0-9])((?:19|20)\d{2}[-_.]\d{1,5})(?![-_.]\d{1,2}(?:[^0-9A-Za-z]|$))(?=$|[^0-9A-Za-z])/
  );
  if (m) return canonicalCode(m[1]);
  return '';
};

export const extractNumeroFromDoc = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // Lien dont le nom de fichier (avec le N°) est dans l’URL.
  if (/^https?:/i.test(s)) {
    let name = '';
    try { name = decodeURIComponent(s.replace(/[?#].*$/, '').split('/').pop() || ''); }
    catch { name = s.replace(/[?#].*$/, '').split('/').pop() || ''; }
    return findCodeIn(name);
  }
  const found = findCodeIn(s);
  if (found) return found;
  // Nom de document sans N° reconnaissable → on n’écrit pas le nom dans un N°.
  return s.includes('_') || DOC_EXT_RE.test(s) ? '' : s;
};

export const formatEuro0 = (n) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);

/* ── Feuille « Lignes budgétaires » → enregistrements recettes ───────────── */
const RECETTE_COLUMNS = {
  ligne: ['Lignes budgétaires', 'Ligne budgétaire', 'ligne', 'intitulé', 'projet', 'opération'],
  categorie: ['Categorie', 'Catégorie', 'Categoria', 'Category'],
  porteur: ['porteur', 'Porteur du projet', 'responsable'],
  budgetTotal: ['Budget totale', 'Budget total', 'Total', 'Montant total'],
  budgetDispo: ['Budget disponible', 'Montant mis à disposition', 'mis à disposition', 'Disponible'],
  finEngagement: ['Date de fin engagement', 'Fin d’engagement', 'Date de fin'],
  note: ['Note', 'Notes', 'Commentaire', 'Commentaires'],
};

const buildRecettes = (rows, headerIdx) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(RECETTE_COLUMNS).forEach((f) => { cols[f] = findColumn(header, RECETTE_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break; // fin du bloc de données
    const ligne = clean(cell(r, cols.ligne));
    if (!ligne || /^https?:/i.test(ligne)) { skipped++; continue; }
    const type = clean(cell(r, cols.categorie)) || 'Fonctionnement';
    const porteur = clean(cell(r, cols.porteur));
    const bT = parseEuroAmount(cell(r, cols.budgetTotal));
    const bD = parseEuroAmount(cell(r, cols.budgetDispo));
    const note = clean(cell(r, cols.note));
    const importStamp = `Import Google Sheets « Lignes budgétaires » — ${new Date().toISOString().slice(0, 10)}`;
    items.push({
      kind: 'recettes',
      key: `${normalizeKey(ligne)}|${normalizeKey(type)}`,
      rec: {
        ligne,
        type,
        porteur,
        budgetTotal: bT === null ? null : bT,
        budgetRenduDispo: bD === null ? null : bD,
        dateFinEngagement: parseDateCell(cell(r, cols.finEngagement)),
        notes: [note, importStamp].filter(Boolean).join(' · '),
      },
      preview: {
        title: ligne,
        sub: [type, porteur].filter(Boolean).join(' · '),
        extra: `${formatEuro0(bT)} · dispo ${formatEuro0(bD)}`,
      },
    });
  }
  return { items, skipped, unmatchedProjets: [] };
};

/* ── Feuille « Stagiaires / Personnel » → enregistrements personnel ──────── */
const PERSONNEL_COLUMNS = {
  nom: ['porteur', 'Nom', 'Nom complet', 'stagiaire'],
  type: ['type', 'Statut'],
  corps: ['Corps'],
  grade: ['Grade'],
  bap: ['BAP', 'BAP / Échelon', 'Échelon'],
  encadrant: ['encadrant', 'Tuteur', 'Référent'],
  encadrant2: ['encadrant2', 'Co-encadrant', 'Tuteur 2', 'Référent 2'],
  projet: ['Projet', 'Ligne budgétaire', 'Ligne', 'Recette'],
  debut: ['debut', 'Début', 'Date début', 'Date de début', 'Arrivée'],
  fin: ['fin contrat', 'Fin de contrat', 'Fin', 'Date fin', 'Date de fin'],
  note: ['Note', 'Notes', 'Commentaire', 'Commentaires'],
};

/* ── Feuille « Personnel » (annuaire permanent / technique / temporaire) ───── */
const PERSONNEL_PERM_COLUMNS = {
  nom: ['porteur', 'Nom', 'Nom complet'],
  type: ['type', 'Statut', 'Corps / grade'],
  hdr: ['HDR', 'Habilitation'],
  bap: ['BAP'],
  categorie: ['Categorie', 'Catégorie'],
  echelon: ['echelon', 'Échelon'],
  chevron: ['chevron'],
  depuis: ['depuis', 'Depuis'],
  ripce: ['derniere RIPEC', 'dernière RIPEC', 'Dernière RIPEC', 'dernier RIPEC'],
  arrivee: ['arrivé en', 'arrivée en', 'Arrivée', "Date d'arrivée"],
  fin: ['fin contrat', 'Fin de contrat', 'Fin'],
  sst: ['SST'],
  autoclave: ['date formation autoclave', 'Formation autoclave', 'Autoclave'],
  fonction: ['Fonction', 'Responsabilité'],
  note: ['Note', 'Notes', 'Commentaire', 'Commentaires'],
};

/* Corps vu dans la feuille source → type d’annuaire (fiche Personnel). */
const CORPS_TYPE_MAP = {
  PR: 'Permanent', MCF: 'Permanent', DR: 'Permanent', CR: 'Permanent',
  PRAG: 'Permanent', PRCE: 'Permanent',
  IR: 'Technique', IE: 'Technique', ASI: 'Technique', TECH: 'Technique', ATRF: 'Technique',
  'Post-doc': 'Temporaire', ATER: 'Temporaire', Doctorant: 'Temporaire', Stagiaire: 'Temporaire',
};
const CANON_CORPS = Object.keys(CORPS_TYPE_MAP).sort((a, b) => b.length - a.length);
const CORPS_NORM = CANON_CORPS.map((c) => normalizeKey(c).replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
const KNOWN_GRADES = ['PR2', 'PR1', 'CE2', 'CE1', 'CN', 'HC', 'DR2', 'DR1', 'CR2', 'CR1'];
const KNOWN_GRADES_LC = KNOWN_GRADES.map((g) => g.toLowerCase());

/* Une « vraie » date calendaire (jour précis), contrairement à « 2016 » ou
   « 10/2025 » qu’on ne peut pas écrire dans un <input type="date">. */
const isFullDateCell = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 10000 && raw <= 80000;
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return true;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return true;
  return false;
};

/* « PR CE1 » → { corps:'PR', grade:'CE1' } ; « MCF CN » → MCF/CN ;
   « CR CNRS » → corps CR, grade vide (CNRS n’est pas un grade) ;
   « PR1 » → PR/PR1 ; « post-doc » → Post-doc. */
const splitCorpsGrade = (typeRaw) => {
  const t = String(typeRaw || '').trim();
  if (!t) return { corps: '', grade: '' };
  const n = normalizeKey(t).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const exact = CORPS_NORM.indexOf(n);
  if (exact >= 0) return { corps: CANON_CORPS[exact], grade: '' };
  const toks = n.split(' ');
  const first = CORPS_NORM.indexOf(toks[0]);
  if (first >= 0 && toks.length > 1) {
    const grade = toks.slice(1).map((g) => {
      const gi = KNOWN_GRADES_LC.indexOf(g);
      return gi >= 0 ? KNOWN_GRADES[gi] : '';
    }).filter(Boolean).join(' ');
    return { corps: CANON_CORPS[first], grade };
  }
  // « PR1 » : corps + numéro collés (PR1/PR2, DR1/DR2, CR1/CR2…).
  for (let i = 0; i < CANON_CORPS.length; i++) {
    const cn = CORPS_NORM[i];
    if (cn.length >= 2 && n.length === cn.length + 1 && n.startsWith(cn) && /[12]/.test(n[cn.length])) {
      const c = CANON_CORPS[i];
      const digit = n[cn.length];
      const ok = c === 'PR' || c === 'DR' || c === 'CR';
      return { corps: c, grade: ok ? c + digit : '' };
    }
  }
  return { corps: n, grade: '' };
};

/* Feuille « Personnel » (colonnes porteur/HDR/BAP/Catégorie/échelon/RIPEC…)
   → enregistrements d’annuaire. HDR, catégorie, échelon et chevron deviennent
   des champs structurés de la fiche (hdr / categorie / echelon / chevron).
   Seuls les dates partielles (« 2016 », « 10/2025 »), les mentions « Depuis »
   et les notes restent en texte dans les commentaires. */
const buildPermanent = (rows, headerIdx) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(PERSONNEL_PERM_COLUMNS).forEach((f) => { cols[f] = findColumn(header, PERSONNEL_PERM_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  const NOISE = /^(non|no|na|n\/a|—|-|\*|x|ø)?$/i;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break; // fin du bloc de données
    const nom = clean(cell(r, cols.nom));
    if (!nom) { skipped++; continue; }
    const typeCell = clean(cell(r, cols.type));
    const { corps, grade } = splitCorpsGrade(typeCell);
    let type = CORPS_TYPE_MAP[corps] || '';
    if (!type) {
      if (/permanent/i.test(typeCell)) type = 'Permanent';
      else if (/technique|tech\.|ingenieur|ingénieur/i.test(typeCell)) type = 'Technique';
      else if (/temporaire|doctorant|ater|post.?doc|stagiaire|cdd/i.test(typeCell)) type = 'Temporaire';
    }
    const bap = clean(cell(r, cols.bap));
    const fonctionRaw = clean(cell(r, cols.fonction));
    // HDR : colonne « oui / non » (parfois une année) → Oui / Non canonique.
    const hdrRaw = clean(cell(r, cols.hdr));
    const hdr = !hdrRaw ? '' : (/non/i.test(hdrRaw) ? 'Non' : 'Oui');
    let categorie = clean(cell(r, cols.categorie)).replace(/^cat[ée]gorie\s+/i, '');
    if (NOISE.test(categorie)) categorie = '';
    let echelon = clean(cell(r, cols.echelon)).replace(/^[ée]chelon\s+/i, '');
    if (NOISE.test(echelon)) echelon = '';
    let chevron = clean(cell(r, cols.chevron)).replace(/^chevron\s+/i, '');
    if (NOISE.test(chevron)) chevron = '';
    const depCell = clean(cell(r, cols.depuis));
    const ripceRaw = clean(cell(r, cols.ripce));
    const arriveRaw = clean(cell(r, cols.arrivee));
    const finRaw = clean(cell(r, cols.fin));
    const sstCell = clean(cell(r, cols.sst));
    const autoclaveRaw = clean(cell(r, cols.autoclave));
    const note = clean(cell(r, cols.note));
    const arriveISO = isFullDateCell(arriveRaw) ? parseDateCell(arriveRaw) : '';
    const finISO = isFullDateCell(finRaw) ? parseDateCell(finRaw) : '';
    const duties = [];
    if (/oui/i.test(sstCell)) duties.push('SST');
    const formations = [];
    if (autoclaveRaw && !/non/i.test(autoclaveRaw) && autoclaveRaw !== '*') formations.push(`Formation autoclave | ${autoclaveRaw}`);
    const details = [];
    if (depCell && depCell !== arriveRaw) details.push(`Depuis ${depCell}`);
    if (arriveRaw && !arriveISO) details.push(`Arrivée ${arriveRaw}`);
    if (finRaw && !finISO) details.push(`Fin prévue ${finRaw}`);
    if (note) details.push(note);
    const rec = {
      nom,
      type,
      corps,
      grade,
      bap,
      fonction: normalizeFonction(fonctionRaw),
      hdr,
      categorie,
      echelon,
      chevron,
      dernierRIPEC: ripceRaw || '',
      dateEmbauche: arriveISO,
      dateFinContrat: finISO,
      duties,
      formations,
      encadrantsText: '',
      commentaires: details.join(' · '),
    };
    items.push({
      kind: 'personnel',
      key: `${normalizeKey(nom)}|${normalizeKey(arriveISO || '')}`,
      rec,
      preview: {
        title: nom,
        sub: [type, corps, grade].filter(Boolean).join(' · '),
        extra: [
          hdr ? `HDR ${hdr}` : '',
          categorie ? `Catégorie ${categorie}` : '',
          echelon ? `Échelon ${echelon}` : '',
          chevron ? `Chevron ${chevron}` : '',
          ripceRaw ? `RIPEC ${ripceRaw}` : '',
          finISO || finRaw ? `Fin ${finISO || finRaw}` : '',
          details.join(' · '),
        ].filter(Boolean).join(' · '),
      },
    });
  }
  return { items, skipped, unmatchedProjets: [] };
};

const buildPersonnel = (rows, headerIdx, state) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(PERSONNEL_COLUMNS).forEach((f) => { cols[f] = findColumn(header, PERSONNEL_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  const unmatchedProjets = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break; // fin du bloc de données
    const nom = clean(cell(r, cols.nom));
    if (!nom) { skipped++; continue; }
    const typeRaw = clean(cell(r, cols.type));
    const corpsRaw = clean(cell(r, cols.corps));
    const projet = clean(cell(r, cols.projet));
    const debutISO = parseDateCell(cell(r, cols.debut));
    const finISO = parseDateCell(cell(r, cols.fin));
    const note = clean(cell(r, cols.note));
    const isStag = /stag|staig/i.test(typeRaw) || /stag|staig/i.test(corpsRaw) || (!typeRaw && !corpsRaw);
    const type = isStag ? 'Temporaire'
      : /permanent|technique|temporaire/i.test(typeRaw) ? typeRaw
      : typeRaw || '';
    const corps = isStag ? 'Stagiaire' : (corpsRaw || '');
    const encadrants = [];
    if (cols.encadrant >= 0) { const v = clean(cell(r, cols.encadrant)); if (v) encadrants.push(v); }
    if (cols.encadrant2 >= 0) { const v = clean(cell(r, cols.encadrant2)); if (v) encadrants.push(v); }
    let recetteId = null;
    if (isStag && projet) {
      const match = (state.recettes || []).find((rec) => normalizeKey(rec.ligne) === normalizeKey(projet));
      if (match) recetteId = match.id;
      else unmatchedProjets.push(projet);
    }
    const notes = [];
    if (note) notes.push(note);
    if (isStag && projet && !recetteId) notes.push(`Projet « ${projet} » : ligne budgétaire introuvable dans Recettes — à lier après import.`);
    const duree = isStag ? extractMonths(note, debutISO, finISO) : null;
    const rec = {
      nom,
      type: type || (isStag ? 'Temporaire' : ''),
      corps: corps || (isStag ? 'Stagiaire' : ''),
      grade: clean(cell(r, cols.grade)),
      bap: clean(cell(r, cols.bap)),
      encadrantsText: isStag ? encadrants.join('\n') : '',
      recetteId,
      dateEmbauche: debutISO,
      dateFinContrat: finISO,
      dateDebutStage: isStag ? debutISO : '',
      dateFinStage: isStag ? finISO : '',
      dureeMois: duree,
      commentaires: notes.join(' '),
    };
    items.push({
      kind: 'personnel',
      key: `${normalizeKey(nom)}|${normalizeKey(debutISO || finISO || '')}`,
      rec,
      preview: {
        title: nom,
        sub: isStag ? ['Stagiaire', encadrants.join(' + ')].filter(Boolean).join(' · ') : [type, corpsRaw].filter(Boolean).join(' · '),
        extra: [debutISO && finISO ? `${debutISO} → ${finISO}` : (debutISO || finISO || ''), projet].filter(Boolean).join(' · '),
      },
    });
  }
  return { items, skipped, unmatchedProjets };
};

/* ── Onglets « Dépenses », « OMs », « Souhaités » du classeur budget →        ──
   collections depenses / om / desiderate. La colonne « Ligne budgetaire »
   est reliée automatiquement à la Recette correspondante (code projet),
   ex. « S2R01GEC (INTRUDE) » → ligne « S2R01GEC (INTRUDE) » de Recettes.  */
const DEPENSE_COLUMNS = {
  suivi: ['Suivi'],
  ent: ['ENT'],
  description: ['Description', 'Intitulé', 'Produit', 'Désignation'],
  demandeur: ['Demandeur', 'Porteur'],
  categorie: ['Categorie', 'Catégorie'],
  ligne: ['Ligne budgetaire', 'Ligne budgétaire', 'Ligne', 'Recette'],
  montant: ['Montant HT', 'Montant', 'Montant total'],
  fraisPort: ['Frais de port', 'Port'],
  dateDemande: ['Date demande', 'Demandé le'],
  fournisseur: ['Nom du fournisseur', 'Fournisseur'],
  contact: ['Contact fornisseur', 'Contact fournisseur', 'Contact'],
  numDevis: ['n° devis', 'N° devis', 'Devis', 'N°devis', 'N° de devis', 'Numéro de devis', 'Numero devis'],
  numDevisUrl: ['Lien devis', 'Lien du devis', 'Lien Devis', 'URL devis', 'URL Devis', 'Lien doc devis', 'Lien document devis', 'Lien Document Devis'],
  numSIFAC: ['n° SIFAC', 'N° SIFAC', 'SIFAC'],
  dateBC: ['Date BC', 'Date bon de commande'],
  numBC: ['n° BC', 'N° BC', 'N°BC', 'N° de BC', 'Numero BC', 'Numéro BC'],
  numBCUrl: ['Lien BC', 'Lien du BC', 'Lien bon de commande', 'Lien Bon de commande', 'URL BC', 'Lien doc BC', 'Lien document BC', 'Lien Document BC'],
  dateSignature: ['Date signature', 'Signature'],
  dateSignatureDevis: ['Date signature devis', 'Date signature du devis', 'Date devis', 'Date du devis', 'Signature devis'],
  dateApprob: ['Date approb fornisseur', 'Date approb fournisseur'],
  numFacture: ['n° facture', 'N° facture', 'N° Facture', 'N° de facture'],
  numFactureUrl: ['Lien facture', 'Lien de la facture', 'Lien Facture', 'URL facture', 'Lien doc facture', 'Lien document facture', 'Lien Document Facture'],
  omNo: ['OM', 'N° OM', 'N° OM / paiement', 'Numero OM'],
  omUrl: ['Lien OM', 'Lien OM / paiement', 'Lien paiement', 'Lien de paiement', 'URL OM', 'Lien doc OM', 'Lien document OM'],
  livraisonComplete: ['Livraison complete', 'Livraison complète'],
  commentaires: ['Commentaires', 'Commentaire'],
  classification: ['Classification'],
};

const OM_COLUMNS = {
  ent: ['ENT'],
  prix: ['Prix', 'Statut coût'],
  description: ['Description', 'Intitulé', 'Motif'],
  demandeur: ['Demandeur', 'Porteur'],
  categorie: ['Categorie', 'Catégorie'],
  ligne: ['Ligne budgetaire', 'Ligne budgétaire', 'Ligne', 'Recette'],
  voyage: ['voyage'],
  logement: ['lodgement', 'logement'],
  repas: ['repas'],
  inscription: ['inscription'],
  montant: ['Montant HT', 'Montant', 'Montant total'],
  dateDemande: ['Date demande', 'Demandé le'],
  dateMission: ['Date mission', 'Départ'],
  dateRetour: ['Date retour', 'Retour'],
  numOM: ['OM', 'N° OM'],
  commentaires: ['Commentaires', 'Commentaire'],
};

const DESIDERATE_COLUMNS = {
  decision: ['Decision', 'Décision', 'Statut', 'Status'],
  priorite: ['Priorité', 'Priorite', 'Urgence'],
  cout: ['Cout', 'Coût'],
  description: ['Description', 'Intitulé', 'Produit', 'Désignation'],
  demandeur: ['Demandeur', 'Porteur'],
  categorie: ['Categorie', 'Catégorie'],
  ligne: ['Ligne budgetaire', 'Ligne budgétaire', 'Ligne', 'Recette'],
  montant: ['Colonna 8', 'Montant estimé', 'Montant', 'Montant HT'],
  fraisPort: ['Frais de port/travel', 'Frais de port', 'Port'],
  dateDemande: ['Date demande', 'Demandé le'],
  fournisseur: ['Nom du fournisseur', 'Fournisseur'],
  contact: ['Contact fornisseur', 'Contact fournisseur', 'Contact'],
  devis1: ['n° devis', 'N° devis', 'Devis', 'N° de devis', 'Numéro de devis'],
  numDevisUrl: ['Lien devis', 'Lien du devis', 'Lien Devis', 'URL devis', 'URL Devis', 'Lien doc devis', 'Lien document devis', 'Lien Document Devis'],
  devis2: ['devis N°2', 'Devis n°2', 'devis n°2'],
  devis3: ['devis N°3', 'Devis n°3', 'devis n°3'],
  codeProduit: ['Code produit', 'Code article', 'Référence'],
  commentaires: ['Commentaires', 'Commentaire', 'Lien'],
};

/* Onglet « Congés » du classeur du laboratoire → collection conges. */
const CONGES_COLUMNS = {
  demandeur: ['Demandeur'],
  dateDebut: ['Date initiale', 'Premier jour', 'Debut'],
  dateFin: ['Date dernier jour de congé', 'Dernier jour', 'Fin'],
  jours: ['Jours', 'Jours de congé'],
  note: ['Note', 'Notes', 'Commentaire', 'Commentaires'],
  approuvation: ['Approuvation', 'Approbation', 'Approuvé', 'Décision', 'Statut', 'Status'],
};

const congeStatutOf = (v) => {
  const s = normalizeKey(v);
  if (!s || /^(demande|en attente|pending|en cours|non traitee)/.test(s)) return 'Demande';
  // Ligne spéciale « présence autorisée pendant fermeture » : jours de
  // fermeture UPJV travaillés avec autorisation, réintégrés au solde.
  if (/^(present|presence|fermeture|autorise|travail)/.test(s)) return 'Présence autorisée pendant fermeture';
  if (/^(approuv|accept|accord|ok|oui)/.test(s)) return 'Approuvé';
  if (/^(refus|rejete|annul)/.test(s)) return 'Refusé';
  return 'Demande';
};

const QUESTIONI_COLUMNS = {
  question: ['Question', 'Description'],
  categorie: ['Categorie', 'Catégorie', 'Statut', 'Status'],
  note: ['Note', 'Notes', 'Commentaire', 'Commentaires'],
};

const SICUREZZA_COLUMNS = {
  question: ['Question', 'Description', 'Tâche'],
  responsable: ['Responsable'],
  categorie: ['Categorie', 'Catégorie', 'Statut', 'Status'],
  priorite: ['Priorité', 'Priorite', 'Urgence'],
  note: ['Note', 'Notes', 'Commentaire', 'Commentaires'],
};

/* Correspondance code projet → ligne de Recettes (liaisons automatiques).
   `type` (ex. « Fonctionnement », colonne « Catégorie » de la feuille)
   restreint la recherche aux fiches de CE type : un même code peut exister en
   deux fiches (Fonctionnement / Investissement) et la dépense doit être
   reliée à celle qui correspond à sa catégorie, jamais à l’autre. */
const normalizeLigneCore = (s) => normalizeKey(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

const findRecetteLigne = (recettes, raw, type) => {
  const list = Array.isArray(recettes) ? recettes : [];
  if (!raw) return null;
  const want = type ? normalizeKey(type) : '';
  const pool = want
    ? list.filter((r) => normalizeKey(r && r.type) === want)
    : list;
  if (!pool.length) return null;
  const n = normalizeKey(raw);
  const exact = pool.find((r) => normalizeKey(r.ligne || '') === n);
  if (exact) return exact;
  const core = normalizeLigneCore(n);
  if (core && core.length >= 3) {
    const byCore = pool.find((r) => normalizeLigneCore(r.ligne || '') === core);
    if (byCore) return byCore;
  }
  const m = n.match(/\(([^)]+)\)\s*$/);
  const tok = m ? m[1].trim() : '';
  if (tok && tok.length >= 2 && tok !== 'na' && tok !== 'n a') {
    const byTok = pool.find((r) => normalizeKey(r.ligne || '').includes(`(${tok})`));
    if (byTok) return byTok;
  }
  return null;
};

/* Statuts libres des onglets → valeurs canoniques du schéma Administration. */
const STATUS_ALIAS = {
  'a faire': 'A faire',
  'en cours': 'En cours',
  'en cours de traitement': 'En cours',
  fait: 'Fait',
  'en attente': 'En attente',
  pending: 'Pending',
  approved: 'Approved',
  accepte: 'Acceptée',
  refuse: 'Refusée',
  terminee: 'Terminée',
  'pas maintenant': 'Rejected / Pas maintenant',
  'rejected / pas maintenant': 'Rejected / Pas maintenant',
  'devis en cours': 'Devis en cours',
  'sifac transmis': 'SIFAC transmis',
  'bc signe': 'BC signé',
  livre: 'Livré',
  facture: 'Facturé',
  cloture: 'Clôturé',
  'service fait': 'Service fait',
  'colis partiallement livre': 'Colis partiellement livré',
  'colis partiellement livre': 'Colis partiellement livré',
};

const normalizeStatut = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const key = normalizeKey(s);
  if (STATUS_ALIAS[key]) return STATUS_ALIAS[key];
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const PRIORITY_ALIAS = {
  urgent: 'Urgent',
  important: 'Important',
  souhaite: 'Souhaitable',
  souhaitable: 'Souhaitable',
};

const normalizePriorite = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const key = normalizeKey(s);
  return PRIORITY_ALIAS[key] || (s.charAt(0).toUpperCase() + s.slice(1));
};

const DECISION_ALIAS = {
  'en attente': 'En attente',
  pending: 'En attente',
  approuve: 'Approuvé',
  approve: 'Approuvé',
  accepte: 'Approuvé',
  'pas maintenant': 'Pas maintenant',
  'rejected pas maintenant': 'Pas maintenant',
  'rejected / pas maintenant': 'Pas maintenant',
  refuse: 'Pas maintenant',
  rejete: 'Pas maintenant',
};

const normalizeDecision = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const key = normalizeKey(s);
  return DECISION_ALIAS[key] || normalizeStatut(s);
};

const COUT_ALIAS = {
  exact: 'Exact',
  estime: 'Estimé',
  rectifie: 'Exact',
  reel: 'Exact',
  'sur devis': 'Estimé',
};

const normalizeCout = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const key = normalizeKey(s);
  return COUT_ALIAS[key] || normalizeStatut(s);
};

/* « AP », « AP Hygiène & Sécurité », « Agent de prévention » → AP ;
   « Gestionnaire » → Gestionnaire ; sinon vide (aucune fonction). */
const normalizeFonction = (v) => {
  const s = String(v ?? '').trim();
  if (/^ap(?:\b|[\s/_-])/i.test(s) || /agent de pr[eé]vention/i.test(s)) return 'AP';
  if (/^gestionnaire/i.test(s)) return 'Gestionnaire';
  return '';
};

const stampFor = (label) => `Import Google Sheets « ${label} » — ${new Date().toISOString().slice(0, 10)}`;

/* ── Onglet « Dépenses » (suivi BC / SIFAC) → collection depenses ─────────── */
const collectLivraisonPhases = (header) => {
  const col = { dateRec: {}, bl: {}, blUrl: {}, sfDate: {}, sf: {}, sfUrl: {} };
  header.forEach((h, idx) => {
    const key = normalizeKey(h);
    let m = null;
    if ((m = key.match(/^date reception du colis([0-9]+)$/)) || (m = key.match(/^date reception colis([0-9]+)$/))) col.dateRec[m[1]] = idx;
    else if ((m = key.match(/^n° ?bl([0-9]+)$/))) col.bl[m[1]] = idx;
    else if ((m = key.match(/^lien (?:doc(?:ument)? |du |de )?bl([0-9]+)$/)) || (m = key.match(/^url bl([0-9]+)$/))) col.blUrl[m[1]] = idx;
    else if ((m = key.match(/^date service fait([0-9]+)$/))) col.sfDate[m[1]] = idx;
    else if ((m = key.match(/^n° ?sf([0-9]+)$/))) col.sf[m[1]] = idx;
    else if ((m = key.match(/^lien (?:doc(?:ument)? |du |de )?sf([0-9]+)$/)) || (m = key.match(/^url sf([0-9]+)$/))) col.sfUrl[m[1]] = idx;
  });
  const nums = new Set([...Object.keys(col.dateRec), ...Object.keys(col.bl), ...Object.keys(col.blUrl), ...Object.keys(col.sfDate), ...Object.keys(col.sf), ...Object.keys(col.sfUrl)]);
  return [...nums].map(Number).sort((a, b) => a - b).map((n) => ({
    dateRec: col.dateRec[n],
    bl: col.bl[n],
    blUrl: col.blUrl[n],
    sfDate: col.sfDate[n],
    sf: col.sf[n],
    sfUrl: col.sfUrl[n],
  }));
};

const buildDepenses = (rows, headerIdx, state) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(DEPENSE_COLUMNS).forEach((f) => { cols[f] = findColumn(header, DEPENSE_COLUMNS[f]); });
  const phases = collectLivraisonPhases(header);
  const items = [];
  let skipped = 0;
  const unmatched = [];
  const stamp = stampFor('Dépenses');
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break; // fin du bloc de données
    const description = clean(cell(r, cols.description));
    const ligneRaw = clean(cell(r, cols.ligne));
    const numSIFAC = clean(cell(r, cols.numSIFAC));
    if (!description && !ligneRaw && !numSIFAC) { skipped++; continue; }
    const suivi = normalizeStatut(clean(cell(r, cols.suivi)));
    /* Liaison automatique restreinte au type de la « Catégorie » (colonne de
       la feuille) : une dépense « Fonctionnement » ne doit jamais être
       imputée sur la fiche « Investissement » du même code (et réciproquement)
       — la page Recettes compterait sinon la dépense sur la mauvaise ligne. */
    const categorieRaw = clean(cell(r, cols.categorie));
    const recette = findRecetteLigne(state && state.recettes, ligneRaw, categorieRaw || undefined);
    if (!recette && ligneRaw) {
      unmatched.push(categorieRaw ? `${ligneRaw} (fiche « ${categorieRaw} » absente dans Recettes)` : ligneRaw);
    }
    const livraisons = [];
    phases.forEach((p) => {
      const dr = clean(cell(r, p.dateRec));
      const bl = clean(cell(r, p.bl));
      const sf = clean(cell(r, p.sfDate));
      const num = clean(cell(r, p.sf));
      const blUrl = clean(cell(r, p.blUrl));
      const sfUrl = clean(cell(r, p.sfUrl));
      if (dr || bl || sf || num || blUrl || sfUrl) {
        livraisons.push({
          dateReception: parseDateCell(dr),
          numBL: extractNumeroFromDoc(bl),
          numBLUrl: blUrl,
          dateServiceFait: parseDateCell(sf),
          numSF: extractNumeroFromDoc(num),
          numSFUrl: sfUrl,
        });
      }
    });
    const montant = parseEuroAmount(cell(r, cols.montant));
    const fraisPort = parseEuroAmount(cell(r, cols.fraisPort));
    const entRaw = clean(cell(r, cols.ent));
    const commentaires = [clean(cell(r, cols.commentaires)), stamp].filter(Boolean).join(' · ');
    items.push({
      kind: 'depenses',
      key: `${normalizeKey(description)}|${normalizeKey(numSIFAC || clean(cell(r, cols.numBC)))}`,
      rec: {
        recetteId: recette ? recette.id : null,
        ligneBudgetaire: ligneRaw,
        description,
        demandeur: clean(cell(r, cols.demandeur)),
        categorie: clean(cell(r, cols.categorie)),
        suivi,
        statut: suivi,
        nonComptabiliseEnt: /pas decompt[eé]/i.test(entRaw) || /pas d[eé]compt[eé]/i.test(entRaw),
        ent: entRaw,
        montant,
        fraisPort,
        dateDemande: parseDateCell(cell(r, cols.dateDemande)),
        fournisseur: clean(cell(r, cols.fournisseur)),
        contact: clean(cell(r, cols.contact)),
        numDevis: extractNumeroFromDoc(clean(cell(r, cols.numDevis))),
        numDevisUrl: clean(cell(r, cols.numDevisUrl)),
        dateSignatureDevis: parseDateCell(cell(r, cols.dateSignatureDevis)),
        numSIFAC: extractNumeroFromDoc(numSIFAC),
        dateBC: parseDateCell(cell(r, cols.dateBC)),
        numBC: extractNumeroFromDoc(clean(cell(r, cols.numBC))),
        numBCUrl: clean(cell(r, cols.numBCUrl)),
        dateSignature: parseDateCell(cell(r, cols.dateSignature)),
        dateApprobFournisseur: parseDateCell(cell(r, cols.dateApprob)),
        numFacture: extractNumeroFromDoc(clean(cell(r, cols.numFacture))),
        numFactureUrl: clean(cell(r, cols.numFactureUrl)),
        omNo: extractNumeroFromDoc(clean(cell(r, cols.omNo))),
        omUrl: clean(cell(r, cols.omUrl)),
        livraisonComplete: normalizeStatut(clean(cell(r, cols.livraisonComplete))),
        livraisons,
        classification: clean(cell(r, cols.classification)),
        commentaires,
      },
      preview: {
        title: description || ligneRaw || numSIFAC,
        sub: [suivi, clean(cell(r, cols.fournisseur)), ligneRaw].filter(Boolean).join(' · '),
        extra: `${formatEuro0(montant)}${fraisPort !== null && fraisPort !== undefined ? ` + ${formatEuro0(fraisPort)} port` : ''}`,
      },
    });
  }
  return { items, skipped, unmatchedProjets: unmatched };
};

/* ── Onglet « OMs » → collection om ───────────────────────────────────────── */
const buildOm = (rows, headerIdx, state) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(OM_COLUMNS).forEach((f) => { cols[f] = findColumn(header, OM_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  const unmatched = [];
  const stamp = stampFor('OMs');
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break;
    const description = clean(cell(r, cols.description));
    const ligneRaw = clean(cell(r, cols.ligne));
    if (!description && !ligneRaw) { skipped++; continue; }
    if (!description && /^https?:/i.test(clean(cell(r, 0)))) continue;
    const voyage = parseEuroAmount(cell(r, cols.voyage));
    const logement = parseEuroAmount(cell(r, cols.logement));
    const repas = parseEuroAmount(cell(r, cols.repas));
    const inscription = parseEuroAmount(cell(r, cols.inscription));
    const parts = [voyage, logement, repas, inscription].filter((n) => n !== null && n !== undefined);
    const total = parseEuroAmount(cell(r, cols.montant));
    const coutTotal = total !== null && total !== undefined ? total : (parts.length ? parts.reduce((s, n) => s + n, 0) : null);
    const recette = findRecetteLigne(state && state.recettes, ligneRaw);
    if (!recette && ligneRaw) unmatched.push(ligneRaw);
    const numOM = clean(cell(r, cols.numOM));
    const coutStatut = normalizeCout(clean(cell(r, cols.prix)));
    const commentaires = [clean(cell(r, cols.commentaires)), stamp].filter(Boolean).join(' · ');
    items.push({
      kind: 'om',
      key: `${normalizeKey(description)}|${normalizeKey(clean(cell(r, cols.demandeur)))}|${normalizeKey(parseDateCell(cell(r, cols.dateMission)) || numOM)}`,
      rec: {
        recetteId: recette ? recette.id : null,
        ligneBudgetaire: ligneRaw,
        description,
        demandeur: clean(cell(r, cols.demandeur)),
        categorie: clean(cell(r, cols.categorie)),
        coutStatut,
        statut: '',
        coutVoyage: voyage,
        coutLogement: logement,
        coutRepas: repas,
        coutInscription: inscription,
        coutTotal,
        dateDemande: parseDateCell(cell(r, cols.dateDemande)),
        dateMission: parseDateCell(cell(r, cols.dateMission)),
        dateRetour: parseDateCell(cell(r, cols.dateRetour)),
        numOM: extractNumeroFromDoc(numOM),
        commentaires,
      },
      preview: {
        title: description,
        sub: [clean(cell(r, cols.demandeur)), coutStatut].filter(Boolean).join(' · '),
        extra: formatEuro0(coutTotal),
      },
    });
  }
  return { items, skipped, unmatchedProjets: unmatched };
};

/* ── Onglet « Souhaités » → collection desiderate ─────────────────────────── */
const buildDesiderate = (rows, headerIdx, state) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(DESIDERATE_COLUMNS).forEach((f) => { cols[f] = findColumn(header, DESIDERATE_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  const unmatched = [];
  const stamp = stampFor('Souhaités');
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break;
    const description = clean(cell(r, cols.description));
    const ligneRaw = clean(cell(r, cols.ligne));
    if (!description && !ligneRaw) { skipped++; continue; }
    if (!description && /^https?:/i.test(clean(cell(r, 0)))) continue;
    const statut = normalizeDecision(clean(cell(r, cols.decision)));
    const recette = findRecetteLigne(state && state.recettes, ligneRaw);
    if (!recette && ligneRaw) unmatched.push(ligneRaw);
    const priorite = normalizePriorite(clean(cell(r, cols.priorite)));
    const coutStatut = normalizeCout(clean(cell(r, cols.cout)));
    const montant = parseEuroAmount(cell(r, cols.montant));
    const commentaires = [clean(cell(r, cols.commentaires)), stamp].filter(Boolean).join(' · ');
    items.push({
      kind: 'desiderate',
      key: `${normalizeKey(description)}|${normalizeKey(clean(cell(r, cols.demandeur)))}`,
      rec: {
        recetteSuggereeId: recette ? recette.id : null,
        ligneBudgetaire: ligneRaw,
        description,
        demandeur: clean(cell(r, cols.demandeur)),
        categorie: clean(cell(r, cols.categorie)),
        priorite,
        coutStatut,
        statut,
        montantEstime: montant,
        fraisPort: parseEuroAmount(cell(r, cols.fraisPort)),
        dateDemande: parseDateCell(cell(r, cols.dateDemande)),
        fournisseur: clean(cell(r, cols.fournisseur)),
        contact: clean(cell(r, cols.contact)),
        numDevis: extractNumeroFromDoc(clean(cell(r, cols.devis1))),
        numDevisUrl: clean(cell(r, cols.numDevisUrl))
          || (/^https?:/i.test(clean(cell(r, cols.devis1))) ? clean(cell(r, cols.devis1)) : ''),
        devis2: extractNumeroFromDoc(clean(cell(r, cols.devis2))),
        devis3: extractNumeroFromDoc(clean(cell(r, cols.devis3))),
        codeProduit: clean(cell(r, cols.codeProduit)),
        commentaires,
      },
      preview: {
        title: description,
        sub: [clean(cell(r, cols.demandeur)), priorite].filter(Boolean).join(' · '),
        extra: `${formatEuro0(montant)} · ${statut}`,
      },
    });
  }
  return { items, skipped, unmatchedProjets: unmatched };
};

/* ── Onglets « Questions_ouvertes » / « H&S » → questioni / sicurezza ────── */
/* ── Onglet « Congés » (demandes de l’équipe) → collection conges ────────── */
const buildConges = (rows, headerIdx) => {
  const header = rows[headerIdx];
  const colIdx = {};
  Object.keys(CONGES_COLUMNS).forEach((f) => { colIdx[f] = findColumn(header, CONGES_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break;
    const demandeur = clean(cell(r, colIdx.demandeur));
    const dateDebut = parseDateCell(cell(r, colIdx.dateDebut));
    const dateFin = parseDateCell(cell(r, colIdx.dateFin));
    // Les lignes de totaux / gabarits (sans demandeur ni dates) sont ignorées.
    if (!demandeur || !dateDebut || !dateFin) { skipped++; continue; }
    const joursRaw = clean(cell(r, colIdx.jours));
    const statut = congeStatutOf(clean(cell(r, colIdx.approuvation)));
    const jours = joursRaw ? parseEuroAmount(joursRaw) : null;
    items.push({
      kind: 'conges',
      key: `${normalizeKey(demandeur)}|${dateDebut}|${dateFin}`,
      rec: {
        demandeur,
        dateDebut,
        dateFin,
        jours: jours === null ? null : jours,
        note: clean(cell(r, colIdx.note)),
        statut,
      },
      preview: {
        title: demandeur,
        sub: `${dateDebut} → ${dateFin}`,
        extra: [statut, jours === null ? '' : `${jours} j`].filter(Boolean).join(' · '),
      },
    });
  }
  return { items, skipped, unmatchedProjets: [] };
};

const buildQuestioni = (rows, headerIdx) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(QUESTIONI_COLUMNS).forEach((f) => { cols[f] = findColumn(header, QUESTIONI_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break;
    const description = clean(cell(r, cols.question));
    if (!description) { skipped++; continue; }
    if (/^https?:/i.test(description)) continue;
    const statut = normalizeStatut(clean(cell(r, cols.categorie)));
    items.push({
      kind: 'questioni',
      key: normalizeKey(description),
      rec: {
        description,
        statut,
        responsable: '',
        commentaires: clean(cell(r, cols.note)),
      },
      preview: { title: description, sub: '', extra: statut },
    });
  }
  return { items, skipped, unmatchedProjets: [] };
};

const buildSicurezza = (rows, headerIdx) => {
  const header = rows[headerIdx];
  const cols = {};
  Object.keys(SICUREZZA_COLUMNS).forEach((f) => { cols[f] = findColumn(header, SICUREZZA_COLUMNS[f]); });
  const items = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!hasContent(r)) break;
    const description = clean(cell(r, cols.question));
    if (!description) { skipped++; continue; }
    if (/^https?:/i.test(description)) continue;
    const statut = normalizeStatut(clean(cell(r, cols.categorie)));
    const priorite = normalizePriorite(clean(cell(r, cols.priorite)));
    items.push({
      kind: 'sicurezza',
      key: normalizeKey(description),
      rec: {
        description,
        responsable: clean(cell(r, cols.responsable)),
        statut,
        priorite,
        commentaires: clean(cell(r, cols.note)),
      },
      preview: {
        title: description,
        sub: clean(cell(r, cols.responsable)),
        extra: [priorite, statut].filter(Boolean).join(' · '),
      },
    });
  }
  return { items, skipped, unmatchedProjets: [] };
};

/* ── Catalogue fournisseurs (Librerie) ────────────────────────────────────
   Construit les fiches fournisseurs manquantes à partir d’une liste qui les
   référence par nom (Dépenses, Spese Desiderate…) : une fiche par nom, sans
   doublon (comparaison insensible à la casse et aux accents, via normalizeKey).
   Les coordonnées éventuellement portées par les lignes sources (contact,
   email, adresse, téléphone, référence SIFAC du fournisseur, site…) sont
   recopiées lorsqu’elles existent. */
const SUPPLIER_NAME_KEYS = ['fournisseur', 'nomFournisseur', 'fournisseurNom', 'nom', 'name'];
const SUPPLIER_COORD_KEYS = [
  ['contact', ['contact', 'contactFournisseur', 'emailContact']],
  ['adresse', ['adresse', 'address']],
  ['email', ['email', 'mail']],
  ['telephone', ['telephone', 'tel', 'phone']],
  ['referenceSifac', ['referenceSifac', 'refSifac', 'sifacTiers', 'siret']],
  ['siteWeb', ['siteWeb', 'site', 'website', 'url']],
  ['categories', ['categories', 'categorie']],
];
const firstValue = (rec, keys) => {
  if (!rec || typeof rec !== 'object') return '';
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};
export const buildMissingFournisseurs = (rows, existing) => {
  const known = new Set();
  (Array.isArray(existing) ? existing : []).forEach((r) => {
    const k = normalizeKey(firstValue(r, SUPPLIER_NAME_KEYS));
    if (k) known.add(k);
  });
  const byName = new Map(); // normalizeKey -> fiche la plus complète
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const rawName = firstValue(r, SUPPLIER_NAME_KEYS);
    const key = normalizeKey(rawName);
    if (!key) return;
    // « PI » = prestation interne : pseudo-fournisseur, pas un vrai catalogue.
    if (key === 'pi' || key === 'prestation interne') return;
    const current = byName.get(key);
    if (current) {
      SUPPLIER_COORD_KEYS.forEach(([k, cand]) => {
        const v = firstValue(r, cand);
        if (v && !current[k]) current[k] = v;
      });
      return;
    }
    const fiche = { fournisseur: rawName };
    SUPPLIER_COORD_KEYS.forEach(([k, cand]) => {
      const v = firstValue(r, cand);
      if (v) fiche[k] = v;
    });
    byName.set(key, fiche);
  });
  return [...byName.values()].filter((f) => !known.has(normalizeKey(f.fournisseur)));
};

/* Clé de dédoublonnage partagée (utilisée aussi par l’assistant d’import). */
export const recordDedupeKey = (kind, rec) => {
  const r = rec || {};
  const n = (x) => normalizeKey(x);
  if (kind === 'recettes') return `${n(r.ligne)}|${n(r.type)}`;
  if (kind === 'personnel') return `${n(r.nom)}|${n(r.dateDebutStage || r.dateEmbauche || '')}`;
  if (kind === 'depenses') return `${n(r.description)}|${n(r.numSIFAC || r.numBC || '')}`;
  if (kind === 'om') return `${n(r.description)}|${n(r.demandeur)}|${n(r.dateMission || r.numOM || '')}`;
  if (kind === 'desiderate') return `${n(r.description)}|${n(r.demandeur)}`;
  if (kind === 'questioni' || kind === 'sicurezza') return `${n(r.description)}`;
  if (kind === 'conges') return `${n(r.demandeur)}|${n(r.dateDebut)}|${n(r.dateFin)}`;
  return `${n(r.description || r.nom || r.ligne || '')}`;
};

/* Sélection du constructeur selon le profil reconnu. */
const BUILDER_BY_PRESET = {
  'recettes-lignes': buildRecettes,
  'personnel-permanents': buildPermanent,
  'personnel-stagiaires': buildPersonnel,
  'depenses-bc': buildDepenses,
  'om-missions': buildOm,
  'desiderate-souhaits': buildDesiderate,
  'questioni-reminders': buildQuestioni,
  'sicurezza-hs': buildSicurezza,
  'conges-demandes': buildConges,
};

/* Point d’entrée commun : matrice → items prêts pour `importMany`.
   Si deux blocs « Personnel » sont empilés dans le même collage (onglet
   annuaire puis onglet stagiaires, ou l’inverse), les deux sont importés. */
export const buildImportItems = (rows, detection, state) => {
  if (!detection) return { items: [], skipped: 0, unmatchedProjets: [] };
  if (detection.preset.kind !== 'personnel') {
    const b = BUILDER_BY_PRESET[detection.preset.id];
    return b ? b(rows, detection.headerIdx, state) : { items: [], skipped: 0, unmatchedProjets: [] };
  }
  const ctx = state || {};
  const out = { items: [], skipped: 0, unmatchedProjets: [] };
  const seen = new Set();
  const handled = new Set();
  let cur = { preset: detection.preset, headerIdx: detection.headerIdx };
  while (cur) {
    const builder = cur.preset.id === 'personnel-permanents' ? buildPermanent : buildPersonnel;
    const res = builder(rows, cur.headerIdx, ctx);
    (res.items || []).forEach((it) => {
      const key = it.key || `rec:${(res.items || []).indexOf(it)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.items.push(it);
    });
    out.skipped += res.skipped || 0;
    (res.unmatchedProjets || []).forEach((p) => {
      if (!out.unmatchedProjets.includes(p)) out.unmatchedProjets.push(p);
    });
    handled.add(cur.preset.id);
    const blockStart = cur.headerIdx + 1;
    cur = null;
    for (const preset of IMPORT_PRESETS) {
      if (preset.kind !== 'personnel' || handled.has(preset.id)) continue;
      for (let i = blockStart; i < rows.length; i++) {
        if (presetMatchesRow(preset, rows[i].map(normalizeKey))) { cur = { preset, headerIdx: i }; break; }
      }
      if (cur) break;
    }
  }
  return out;
};
