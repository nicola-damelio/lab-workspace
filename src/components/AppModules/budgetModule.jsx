/* =========================================================================
   src/components/AppModules/budgetModule.jsx
   Budget module — superuser-only follow-up of the laboratory budget.

   The page reproduces the structure of the "Budget_GEC_UPJV_2026" Google
   Sheet tab (Dépenses / engagements, gid=2029921384):

     • header → Ligne budgétaire | Catégorie | Porteur | Type |
                Budget total | Budget consommé | Diff. consommé − documenté |
                Budget disponible | Dépenses en attente | OM en attente |
                Dépenses souhaitées | Bilan | Fin d'engagement | Contact | Note
     • totals row → grand totals (budget total / consommé / disponible), which
                in the spreadsheet deliberately EXCLUDE the « salaire » payroll
                lines (a toggle below reproduces that behaviour exactly).
     • lines  → grants / budget lines (GEC NA, S2R01GEC (INTRUDE),
                Valcelmat (FED25001), Overvalc, Molimat3D, MAIA …).

   Access is restricted to the superuser (checked again in App.jsx + sidebar).
   Persistence mirrors the rest of the app: localStorage "labWorkspace_budget".
   CSV export/import is compatible with the Google Sheets export so the data
   can still be exchanged with the spreadsheet if needed.
   ========================================================================= */

import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../Icons';

const STORAGE_KEY = 'labWorkspace_budget';

/* Column order of the spreadsheet tab (1:1 with the CSV export). */
const COLUMNS = [
  { key: 'ligne', label: 'Ligne budgétaire', w: 200 },
  { key: 'categorie', label: 'Catégorie', w: 150 },
  { key: 'porteur', label: 'Porteur', w: 160 },
  { key: 'type', label: 'Type', w: 110 },
  { key: 'budgetTotal', label: 'Budget total', w: 130, money: true },
  { key: 'budgetConsomme', label: 'Budget consommé', w: 145, money: true },
  { key: 'diffConsommeDocumente', label: 'Diff. consommé − documenté', w: 170, money: true },
  { key: 'budgetDisponible', label: 'Budget disponible', w: 145, money: true },
  { key: 'depensesAttente', label: 'Dépenses en attente', w: 150, money: true },
  { key: 'omAttente', label: 'OM en attente', w: 130, money: true },
  { key: 'depensesSouhaitees', label: 'Dépenses souhaitées', w: 155, money: true },
  { key: 'bilan', label: 'Bilan', w: 120, money: true },
  { key: 'dateFinEngagement', label: "Fin d'engagement", w: 135 },
  { key: 'contact', label: 'Contact', w: 130 },
  { key: 'note', label: 'Note', w: 150 }
];

const MONEY_KEYS = COLUMNS.filter((c) => c.money).map((c) => c.key);

/* Exact original headers used for CSV export (identical to the Google Sheets
   export, including the original spelling). */
const EXPORT_HEADERS = [
  'Lignes budgetaires', 'Categorie', 'porteur', 'type',
  'Budget totale', 'Budget consommé', 'Diff entre cosommé ét documenté',
  'Budget disponible', 'Dépenses en attente', 'OM en attente',
  'Dépenses souhaitées', 'bilan', 'Date de fin engagement', 'Contacte', 'Note'
];

const CATEGORIES = ['Fonctionnement', 'Investissement', 'Autres'];
const TYPES = ['Dépense', 'salaire'];

/* Amount formatting / parsing — European style as in the spreadsheet
   ("€ 18.664,00", "-€ 12.659,22"). null = blank cell. */
const fmtEUR = (n) => {
  if (n == null || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}€ ${s},${d}`;
};

const parseMoneyInput = (raw) => {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }
  s = s.replace(/[€\s]/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  s = s.replace(/\./g, '');              // remove thousands separators
  if (hasComma) s = s.replace(',', '.'); // decimal comma → dot
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
};

/* Seed lines — copied 1:1 from the Google Sheet tab (CSV export) so the page
   opens populated with the real budget lines. Amounts are numbers; null = the
   cell was empty in the spreadsheet. */
const DEFAULT_ROWS = [
  { ligne: 'GEC NA (NA)', categorie: 'Fonctionnement', porteur: 'service', type: 'Dépense', budgetTotal: 18664, budgetConsomme: 14736.48, diffConsommeDocumente: 4487.91, budgetDisponible: 18664, depensesAttente: 5815.32, omAttente: 3773.25, depensesSouhaitees: 0, bilan: 9075.43, dateFinEngagement: '05/12/2026', contact: '', note: 'Z' },
  { ligne: 'GEC NA (NA)', categorie: 'Investissement', porteur: 'service', type: 'Dépense', budgetTotal: 0, budgetConsomme: 1471.27, diffConsommeDocumente: 1471.27, budgetDisponible: 0, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '05/12/2026', contact: '', note: 'L' },
  { ligne: "S2R01GEC (INTRUDE)", categorie: 'Fonctionnement', porteur: "Nicola D'Amelio", type: 'Dépense', budgetTotal: 4000, budgetConsomme: 4111, diffConsommeDocumente: 1912.73, budgetDisponible: 4000, depensesAttente: 2198.27, omAttente: 0, depensesSouhaitees: 947.71, bilan: 854.02, dateFinEngagement: '05/12/2026', contact: '', note: 'I' },
  { ligne: "S2R01GEC (INTRUDE)", categorie: 'Investissement', porteur: "Nicola D'Amelio", type: 'Dépense', budgetTotal: 0, budgetConsomme: 1183, diffConsommeDocumente: 1183, budgetDisponible: 0, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '05/12/2026', contact: '', note: 'V' },
  { ligne: 'Valcelmat (FED25001)', categorie: 'Fonctionnement', porteur: 'Isabelle Gosselin', type: 'Dépense', budgetTotal: 30000, budgetConsomme: 10414.78, diffConsommeDocumente: -12659.22, budgetDisponible: 30000, depensesAttente: 23074, omAttente: 0, depensesSouhaitees: 48.4, bilan: 6877.6, dateFinEngagement: '15/07/2028', contact: '', note: '' },
  { ligne: 'Valcelmat (FED25001)', categorie: 'Investissement', porteur: 'Isabelle Gosselin', type: 'Dépense', budgetTotal: 4213.8, budgetConsomme: 4213.74, diffConsommeDocumente: 4213.74, budgetDisponible: null, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '15/07/2028', contact: '', note: '' },
  { ligne: 'Overvalc (FED25001)', categorie: 'Fonctionnement', porteur: 'Isabelle Gosselin', type: 'Dépense', budgetTotal: null, budgetConsomme: 0, diffConsommeDocumente: 0, budgetDisponible: 0, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '30/09/2029', contact: '', note: '' },
  { ligne: 'Overvalc (FED25001)', categorie: 'Investissement', porteur: 'Isabelle Gosselin', type: 'Dépense', budgetTotal: null, budgetConsomme: 4213.74, diffConsommeDocumente: 4213.74, budgetDisponible: 0, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '30/09/2029', contact: '', note: '' },
  { ligne: 'S2R45GEC (Cintia)', categorie: 'Fonctionnement', porteur: 'Cintia Leal', type: 'Dépense', budgetTotal: 650, budgetConsomme: 7998.44, diffConsommeDocumente: 7348.44, budgetDisponible: 650, depensesAttente: 0, omAttente: 650, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '05/12/2026', contact: '', note: '' },
    { ligne: 'Molimat3D (ICAM2301)', categorie: 'Fonctionnement', porteur: 'Eric Husson', type: 'Dépense', budgetTotal: 17559.77, budgetConsomme: 8912.78, diffConsommeDocumente: -164.1, budgetDisponible: 10000, depensesAttente: 9076.88, omAttente: 0, depensesSouhaitees: 0, bilan: 923.12, dateFinEngagement: '30/06/2027', contact: '', note: '' },
  { ligne: 'S2R06GEC (instr)', categorie: 'Investissement', porteur: 'service', type: 'Dépense', budgetTotal: 4692, budgetConsomme: null, diffConsommeDocumente: null, budgetDisponible: 4692, depensesAttente: null, omAttente: null, depensesSouhaitees: 4692, bilan: 0, dateFinEngagement: '', contact: '', note: '' },
  { ligne: 'MAIA (UNIV2604)', categorie: 'Autres', porteur: 'Benjamin Bouvier', type: 'salaire', budgetTotal: 60000, budgetConsomme: null, diffConsommeDocumente: null, budgetDisponible: null, depensesAttente: null, omAttente: null, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '31/12/2027', contact: '', note: '' },
  { ligne: 'CHANFIOU Asmina (ALL24014)', categorie: 'Autres', porteur: 'Eric Husson', type: 'salaire', budgetTotal: 18450, budgetConsomme: 12132.44, diffConsommeDocumente: 12132.44, budgetDisponible: 7855.58, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '31/10/2027', contact: '', note: '' },
  { ligne: 'DORSCHNER Lindsay (ALL22022)', categorie: 'Autres', porteur: 'Eric Husson', type: 'salaire', budgetTotal: 27675, budgetConsomme: 24912.72, diffConsommeDocumente: 24912.72, budgetDisponible: 5838.32, depensesAttente: 0, omAttente: 0, depensesSouhaitees: 0, bilan: 0, dateFinEngagement: '31/08/2025', contact: '', note: '' }
];

let rowIdSeq = 0;
const newRowId = () => `b-${Date.now().toString(36)}-${(rowIdSeq++).toString(36)}`;

const blankRow = () => ({
  id: newRowId(),
  ligne: '', categorie: 'Fonctionnement', porteur: '', type: 'Dépense',
  budgetTotal: null, budgetConsomme: null, diffConsommeDocumente: null,
  budgetDisponible: null, depensesAttente: null, omAttente: null,
  depensesSouhaitees: null, bilan: null,
  dateFinEngagement: '', contact: '', note: ''
});

const loadRows = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.rows)) {
        return data.rows
          .filter((r) => r && typeof r === 'object')
          .map((r, i) => ({ ...blankRow(), ...r, id: r.id || `b-${i + 1}` }));
      }
    }
  } catch { /* corrupted entry → fall back to the spreadsheet seed */ }
  return DEFAULT_ROWS.map((r, i) => ({ ...blankRow(), ...r, id: `b-${i + 1}` }));
};

/* ====================== CSV helpers (Google-Sheets compatible) ========== */
const csvEscape = (field) => {
  const s = field == null ? '' : String(field);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const parseCSVRows = (text) => {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
};

/* Map a CSV header row (original spreadsheet headers OR the cleaned-up UI
   names) onto the internal column keys, in column order. */
const HEADER_RULES = [
  [/lignes?\s*budg/i, 'ligne'],
  [/cat(?:é|e)gori/i, 'categorie'],
  [/porteur/i, 'porteur'],
  [/^type\s*$/i, 'type'],
  [/budget\s+total/i, 'budgetTotal'],
  [/budget\s+consom/i, 'budgetConsomme'],
  [/diff/i, 'diffConsommeDocumente'],
  [/disponible/i, 'budgetDisponible'],
  [/d[ée]penses?\s+en\s+attente/i, 'depensesAttente'],
  [/om\s*en\s*attente/i, 'omAttente'],
  [/souhait/i, 'depensesSouhaitees'],
  [/^bilan$/i, 'bilan'],
  [/engag/i, 'dateFinEngagement'],
  [/contact/i, 'contact'],
  [/^note\s*$/i, 'note']
];

const mapHeaderToKeys = (headerRow) => {
  const keys = COLUMNS.map(() => null);
  const used = new Set();
  (headerRow || []).forEach((cell, i) => {
    const h = String(cell || '').trim();
    if (!h) return;
    for (const [re, key] of HEADER_RULES) {
      if (!used.has(key) && re.test(h)) {
        keys[i] = key;
        used.add(key);
        break;
      }
    }
  });
  return keys;
};

/* Scratch rows present at the bottom of the original spreadsheet tab must not
   be imported as budget lines. */
const NOISE_LINE = /^(https?:|assess which|liste des march|sonepar pour|lien aux fichiers|consommables plastiques)/i;

/* Build { rows } from an imported CSV. Falls back to positional order when no
   recognisable header is found. */
const rowsFromCSV = (text) => {
  const all = parseCSVRows(text.replace(/^\uFEFF/, ''));
  let headerIndex = -1;
  let keys = COLUMNS.map((c) => c.key);
  for (let i = 0; i < Math.min(all.length, 8); i++) {
    const line = all[i].map((c) => String(c || '').trim().toLowerCase());
    if (line.some((c) => /lignes?\s*budg/i.test(c)) || line.some((c) => /budget\s+total/i.test(c))) {
      headerIndex = i;
      keys = mapHeaderToKeys(all[i]);
      break;
    }
  }
  const rows = [];
  for (let i = headerIndex + 1; i < all.length; i++) {
    const r = all[i];
    const get = (key) => {
      const idx = keys.indexOf(key);
      return idx >= 0 ? (r[idx] == null ? '' : String(r[idx]).trim()) : '';
    };
    const ligne = get('ligne');
    if (!ligne || NOISE_LINE.test(ligne)) continue; // skip empty & scratch rows
    const row = blankRow();
    COLUMNS.forEach((c) => {
      const raw = get(c.key);
      row[c.key] = c.money ? parseMoneyInput(raw) : raw;
    });
    rows.push(row);
  }
  return rows;
};

/* ====================== Inline editable cells ============================ */
const cellReadCls =
  'w-full min-h-[34px] flex items-center px-2 py-1 text-xs text-slate-700 cursor-text hover:bg-slate-50 rounded-md';
const cellEditCls =
  'w-full min-w-0 bg-white border border-blue-300 rounded-md px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200';

const TextCell = ({ value, onCommit, list }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const begin = () => { setDraft(value == null ? '' : String(value)); setEditing(true); };
  const commit = () => { onCommit(draft.trim()); setEditing(false); };
  const cancel = () => setEditing(false);
  if (editing) {
    return (
      <input
        autoFocus value={draft} list={list}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        className={cellEditCls}
      />
    );
  }
  return (
    <div className={cellReadCls} onClick={begin} title={value || ''}>
      {value || <span className="text-slate-300">—</span>}
    </div>
  );
};

const MoneyCell = ({ value, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const begin = () => {
    setDraft(value == null || !Number.isFinite(value) ? '' : String(value).replace('.', ','));
    setEditing(true);
  };
  const commit = () => { onCommit(parseMoneyInput(draft)); setEditing(false); };
  const cancel = () => setEditing(false);
  if (editing) {
    return (
      <input
        autoFocus value={draft} inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        className={`${cellEditCls} text-right tabular-nums`}
        placeholder="0,00"
      />
    );
  }
  const neg = value != null && Number.isFinite(value) && value < 0;
  return (
    <div
      className={`${cellReadCls} justify-end font-medium tabular-nums ${neg ? 'text-red-600' : 'text-slate-700'}`}
      onClick={begin}
      title={value == null || !Number.isFinite(value) ? '' : fmtEUR(value)}
    >
      {value == null || !Number.isFinite(value) ? <span className="text-slate-300">—</span> : fmtEUR(value)}
    </div>
  );
};

const downloadText = (filename, content, mime = 'text/csv;charset=utf-8') => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
};

const STAT_CARDS = [
  { key: 'budgetTotal', label: 'Budget total', cls: 'text-indigo-700' },
  { key: 'budgetConsomme', label: 'Budget consommé', cls: 'text-rose-600' },
  { key: 'budgetDisponible', label: 'Budget disponible', cls: 'text-emerald-600' },
  { key: 'depensesAttente', label: 'Dépenses en attente', cls: 'text-amber-600' },
  { key: 'omAttente', label: 'OM en attente', cls: 'text-orange-600' },
  { key: 'depensesSouhaitees', label: 'Dépenses souhaitées', cls: 'text-violet-600' }
];

/* Non-superusers never see the data — only a lock notice (same gate as the
   sidebar & the App.jsx route). */
const BudgetLocked = () => (
  <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
    <div className="max-w-md mx-auto mt-20 bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
      <div className="text-4xl mb-3">👑</div>
      <h2 className="text-lg font-black text-slate-800 mb-1">Superuser only</h2>
      <p className="text-sm text-slate-500 leading-relaxed">
        The Budget page is restricted to the superuser account. Log in as the
        superuser to view and edit the laboratory budget lines.
      </p>
    </div>
  </div>
);

/* =========================================================================
   BudgetModule
   ========================================================================= */
export const BudgetModule = ({ currentUser, operatorNames }) => {
  const isSuperuser = currentUser?.role === 'superuser';

  const [rows, setRows] = useState(loadRows);
  const [lastSaved, setLastSaved] = useState(null);
  const [catFilter, setCatFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [salaryExcluded, setSalaryExcluded] = useState(true); // spreadsheet behaviour
  const [info, setInfo] = useState(null);

  // Persist automatically (same localStorage pattern as labWorkspace_journals)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), rows }));
      setLastSaved(new Date());
    } catch { /* storage full / unavailable — keep working in memory */ }
  }, [rows]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.categorie).filter(Boolean))],
    [rows]
  );
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.type).filter(Boolean))],
    [rows]
  );

  const filtered = useMemo(
    () => rows.filter((r) =>
      (catFilter === 'all' || r.categorie === catFilter) &&
      (typeFilter === 'all' || r.type === typeFilter)),
    [rows, catFilter, typeFilter]
  );

  const tallyRows = useMemo(
    () => filtered.filter((r) =>
      !salaryExcluded || String(r.type || '').toLowerCase() !== 'salaire'),
    [filtered, salaryExcluded]
  );

  const tally = useMemo(() => {
    const s = {};
    MONEY_KEYS.forEach((k) => { s[k] = 0; });
    tallyRows.forEach((r) => MONEY_KEYS.forEach((k) => {
      const v = r[k];
      if (v != null && Number.isFinite(v)) s[k] += v;
    }));
    return s;
  }, [tallyRows]);

  const porteurs = useMemo(() => {
    const set = new Set(['service', ...(operatorNames || []), ...rows.map((r) => r.porteur).filter(Boolean)]);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [rows, operatorNames]);

  const patch = (id, key, val) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: val } : r)));

  const addRow = () => setRows((prev) => [...prev, blankRow()]);

  const duplicateRow = (row) => {
    setRows((prev) => {
      const copy = { ...blankRow(), ...row, id: newRowId() };
      const i = prev.findIndex((r) => r.id === row.id);
      if (i < 0) return [...prev, copy];
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  const removeRow = (row) => {
    const label = row.ligne || 'this empty line';
    if (window.confirm(`Delete "${label}"?\n\nThe line will be removed from the Budget page.`)) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    }
  };

  const resetToSheetSeed = () => {
    if (rows.length > 0 && !window.confirm(
      'Replace the current lines with the 14 initial lines of the spreadsheet tab?\n\nYour current edits will be lost.'
    )) return;
    setRows(DEFAULT_ROWS.map((r, i) => ({ ...blankRow(), ...r, id: `b-${i + 1}` })));
    setCatFilter('all'); setTypeFilter('all');
    setInfo('Restored the 14 initial lines of the spreadsheet tab.');
  };

  const exportCSV = () => {
    const lines = [EXPORT_HEADERS.map(csvEscape).join(',')];
    rows.forEach((r) => {
      lines.push(COLUMNS.map((c) => (c.money ? csvEscape(fmtEUR(r[c.key])) : csvEscape(r[c.key]))).join(','));
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`Budget_GEC_UPJV_${stamp}.csv`, `\uFEFF${lines.join('\r\n')}\r\n`);
    setInfo(`Exported ${rows.length} line(s) to a CSV file — re-importable into Google Sheets / Excel.`);
  };

  const importCSVFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = rowsFromCSV(String(reader.result || ''));
      if (imported.length === 0) { setInfo('No budget line was found in this file — nothing was changed.'); return; }
      if (!window.confirm(
        `Import ${imported.length} line(s) from "${file.name}"?\n\nThis REPLACES the current ${rows.length} line(s).`
      )) return;
      setRows(imported);
      setCatFilter('all'); setTypeFilter('all');
      setInfo(`Imported ${imported.length} line(s) from "${file.name}".`);
    };
    reader.onerror = () => setInfo('Could not read the file.');
    reader.readAsText(file);
  };

  if (!isSuperuser) return <BudgetLocked />;

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
      <div className="max-w-[1600px] mx-auto flex flex-col gap-4 pb-10">
        {/* ── Title / actions ── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-amber-50/70 border-b border-amber-100 flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-base md:text-lg font-black text-slate-800 flex items-center gap-2 flex-wrap">
                <Icon name="banknote" size={20} className="text-amber-600" />
                Budget — Dépenses & engagements
                <span className="text-[9px] font-black uppercase tracking-wide bg-amber-200 text-amber-900 rounded-full px-2 py-0.5">Superuser</span>
                {lastSaved && (
                  <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1 normal-case tracking-normal"
                        title="Data is saved automatically in this browser (localStorage)">
                    <Icon name="save" size={12} /> Saved {lastSaved.toLocaleTimeString()}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">
                Same structure as the « Budget_GEC_UPJV_2026 » spreadsheet tab. Every cell is
                editable — click it, type, press Enter. Amounts in EUR; negative values in red.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={exportCSV}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition">
                <Icon name="download" size={13} /> Export CSV
              </button>
              <label className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-1.5 transition">
                <Icon name="upload" size={13} /> Import CSV
                <input type="file" accept=".csv,text/csv" className="hidden"
                       onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) importCSVFile(f); e.target.value = ''; }} />
              </label>
              <button onClick={resetToSheetSeed}
                      title="Replace the table with the 14 lines copied from the Google Sheet tab"
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-500 hover:bg-slate-50 transition">
                Reset to sheet seed
              </button>
              <button onClick={addRow}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5 transition">
                <Icon name="plus" size={13} /> Add line
              </button>
            </div>
          </div>
          {info && (
            <div className="px-4 py-2 bg-sky-50/70 border-b border-sky-100 text-[11px] font-semibold text-sky-800 flex items-center justify-between gap-3">
              <span>ℹ️ {info}</span>
              <button onClick={() => setInfo(null)} className="text-sky-500 hover:text-sky-800 px-1" title="Dismiss">✕</button>
            </div>
          )}
        </div>

        {/* ── Grand totals (row 1 of the spreadsheet) ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {STAT_CARDS.map((c) => (
            <div key={c.key} className="bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">{c.label}</div>
              <div className={`text-sm md:text-base font-black tabular-nums mt-0.5 ${c.cls}`}>
                {fmtEUR(tally[c.key])}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters + spreadsheet-totals toggle ── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span className="mr-1 text-[10px] uppercase tracking-wide text-slate-400">Filter:</span>
            <button onClick={() => setCatFilter('all')}
                    className={`px-2.5 py-1 rounded-full border transition ${catFilter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              All categories
            </button>
            {categories.map((c) => (
              <button key={c} onClick={() => setCatFilter(catFilter === c ? 'all' : c)}
                      className={`px-2.5 py-1 rounded-full border transition ${catFilter === c ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {c}
              </button>
            ))}
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                    className="ml-2 px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 outline-none focus:border-blue-400">
              <option value="all">All types</option>
              {(types.length ? types : TYPES).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="ml-1 text-slate-400">({filtered.length} line{filtered.length === 1 ? '' : 's'} shown)</span>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 cursor-pointer select-none bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm"
                 title="In the Google Sheet the total row only counts the « Dépense » lines — the « salaire » payroll lines stay visible in the table but are not added to the totals. This toggle reproduces that behaviour.">
            <input type="checkbox" checked={salaryExcluded}
                   onChange={(e) => setSalaryExcluded(e.target.checked)}
                   className="accent-amber-600" />
            Spreadsheet totals: exclude « salaire » lines
          </label>
        </div>

        {/* ── Editable table (same columns as the spreadsheet tab) ── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.w }}
                        className={`px-2 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 border-b border-slate-200 ${c.money ? 'text-right' : 'text-left'}`}>
                      {c.label}
                      {c.money && <span className="block text-[8px] font-semibold text-slate-400 normal-case">EUR</span>}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 text-center border-b border-slate-200" style={{ minWidth: 74 }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No budget line matches the current filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-amber-50/40 transition-colors">
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-1 py-0.5 align-top">
                          {c.money
                            ? <MoneyCell value={row[c.key]} onCommit={(v) => patch(row.id, c.key, v)} />
                            : <TextCell value={row[c.key]} onCommit={(v) => patch(row.id, c.key, v)}
                                        list={c.key === 'categorie' ? 'budget-cat-list' : c.key === 'type' ? 'budget-type-list' : c.key === 'porteur' ? 'budget-porteur-list' : undefined} />}
                        </td>
                      ))}
                      <td className="px-1 py-0.5 align-middle">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => duplicateRow(row)} title="Duplicate this line"
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                            ⧉
                          </button>
                          <button onClick={() => removeRow(row)} title="Delete this line"
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition">
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50">
                    {COLUMNS.map((c) => (
                      <th key={c.key} style={{ minWidth: c.w }}
                          className={`px-2 py-2 text-[11px] font-black border-t-2 border-slate-200 ${c.money ? 'text-right tabular-nums text-slate-700' : 'text-left text-slate-400'}`}>
                        {c.key === 'ligne' ? `TOTAL — ${filtered.length} line${filtered.length === 1 ? '' : 's'}` : (c.money ? fmtEUR(tally[c.key]) : '')}
                      </th>
                    ))}
                    <th className="border-t-2 border-slate-200" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="px-4 py-2 bg-slate-50/60 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
            Totals shown above and in the footer are computed on the{' '}
            <b className="text-slate-500">{tallyRows.length}</b> line{tallyRows.length === 1 ? '' : 's'} currently
            included{salaryExcluded && ' (« salaire » payroll lines excluded, like the spreadsheet)'}. Data is saved
            automatically in this browser. Use <b>Export CSV</b> to archive / move to Google Sheets, and{' '}
            <b>Import CSV</b> to restore a Google Sheets export (File → Download → Comma-separated values).
          </div>
        </div>

        {/* ── Suggestions for text cells (type or pick from existing values) ── */}
        <datalist id="budget-cat-list">
          {CATEGORIES.map((c) => <option key={c} value={c} />)}
        </datalist>
        <datalist id="budget-type-list">
          {TYPES.map((t) => <option key={t} value={t} />)}
        </datalist>
        <datalist id="budget-porteur-list">
          {porteurs.map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>
    </div>
  );
};


