/* =========================================================================
   src/administration/smartTable.jsx
   Tableau d’administration réutilisable : tri par clic sur les en-têtes,
   recherche globale, et filtres par colonne (facettes, texte « contient »,
   plage numérique min/max). Certaines colonnes peuvent être déclarées
   « hidden » pour servir uniquement de critère de filtre/recherche sans
   être affichées (ex. Catégorie/Échelon/Chevron fusionnés dans une cellule).
   ========================================================================= */
import React, { useEffect, useMemo, useRef, useState } from 'react';

const ALL_KEY = '__all__';
const EMPTY_KEY = '__empty__';

const toText = (v) => (v === null || v === undefined ? '' : String(v));
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
const facetKeyOf = (v) => (isBlank(v) ? EMPTY_KEY : String(v).trim());

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/* Comparaison de deux valeurs d’une colonne (vide toujours en dernier). */
const compareValues = (a, b, numeric) => {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  if (numeric) {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  }
  return collator.compare(toText(a), toText(b));
};

/* Petite boîte blanche pour chaque contrôle de filtre du panneau. */
const FilterCard = ({ label, children }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 min-w-0">
    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1 truncate">{label}</div>
    {children}
  </div>
);

/* ── Filtres ──────────────────────────────────────────────────────────────── */
const EMPTY_FILTER = {};
const stripFilter = ({ type, val, text, min, max }) => {
  if (type === 'facet') return val === ALL_KEY ? EMPTY_FILTER : { type, val };
  if (type === 'text') return String(text || '').trim() ? { type, text: String(text).trim() } : EMPTY_FILTER;
  if (type === 'range') {
    const lo = String(min ?? '').trim();
    const hi = String(max ?? '').trim();
    return lo || hi ? { type, min: lo, max: hi } : EMPTY_FILTER;
  }
  return EMPTY_FILTER;
};

const rowMatches = (row, columns, filterMap, queryTerms) => {
  if (queryTerms.length) {
    const haystack = columns.map((col) => {
      const v = typeof col.value === 'function' ? col.value(row) : row[col.key];
      return toText(v);
    }).join(' ').toLowerCase();
    if (!queryTerms.every((t) => haystack.includes(t))) return false;
  }
  for (const key of Object.keys(filterMap)) {
    const col = columns.find((c) => c.key === key);
    const f = filterMap[key];
    if (!col || !f) continue;
    const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
    if (f.type === 'facet') {
      const k = facetKeyOf(raw);
      if (f.val === EMPTY_KEY ? k !== EMPTY_KEY : k !== f.val) return false;
    } else if (f.type === 'text') {
      if (!toText(raw).toLowerCase().includes(f.text)) return false;
    } else if (f.type === 'range') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return false;
      if (f.min && n < Number(f.min)) return false;
      if (f.max && n > Number(f.max)) return false;
    }
  }
  return true;
};

/* ── En-tête triable ──────────────────────────────────────────────────────── */
const SortHeader = ({ col, colIndex = 0, sort, onSort, alignRight }) => {
  const active = sort && sort.key === col.key;
  const dir = active ? sort.dir : null;
  /* Cellule épinglée : la ligne d’en-têtes reste visible pendant le défilement
     vertical du tableau ; un léger filet gauche sépare les colonnes. */
  const divider = colIndex > 0 ? ' border-l border-slate-200/80' : '';
  return (
    <th className={`px-3 py-2.5 sticky top-0 z-10 bg-slate-50 border-b-2 border-slate-200 ${alignRight ? 'text-right' : 'text-left'}${divider}`}>
      {col.sortable === false ? (
        <span className="font-black uppercase tracking-wide">{col.label}</span>
      ) : (
        <button
          type="button"
          onClick={() => onSort(col)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide font-black group ${
            active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {col.label}
          <span className={`text-[9px] ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
            {dir === 'desc' ? '▼' : '▲'}
          </span>
        </button>
      )}
    </th>
  );
};
/* ========================================================================= */
export const SmartTable = ({
  columns = [],
  rows = [],
  rowKey = (r, i) => (r && r.id !== undefined ? r.id : i),
  /* Classe CSS ajoutée à chaque ligne (chaîne, ou fonction (row, idx) → chaîne).
     Utilisée par ex. pour le code couleur Permanent / Non permanent. */
  rowClass,
  /* Hauteur maxi du bloc défilant : la 1re ligne (en-têtes) reste toujours
     visible (colonne de définitions épinglée) pendant le défilement vertical. */
  maxHeight = '62vh',
  minWidth = '980px',
  emptyLabel = 'Aucune donnée.',
  noMatchLabel = 'Aucun enregistrement ne correspond aux filtres.',
  searchPlaceholder = 'Rechercher dans le tableau…',
  autoFacetLimit = 30,
  /* Filtres rapides affichés en listes déroulantes directement au-dessus du
     tableau (clés de colonnes en mode facette) — ex. Demandeur, Ligne
     budgétaire, Fournisseur sur la page Dépenses. */
  quickFilters = [],
  /* Mise en évidence d’une ligne après une navigation inter-page :
     `focusRowKey` = la clé renvoyée par rowKey(row, idx) de la ligne cible.
     La ligne est défilée au centre et flashée ; `onFocusDone` est appelé. */
  focusRowKey = null,
  onFocusDone,
}) => {
  const [sort, setSort] = useState(null); // { key, dir: 'asc'|'desc' } | null
  const [filters, setFilters] = useState({}); // colKey -> filtre actif
  const [query, setQuery] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);

  /* Mode de filtre de chaque colonne (auto : facette / texte / plage). */
  const meta = useMemo(() => {
    const seenByCol = new Map();
    columns.forEach((col) => {
      const seen = new Map();
      let hasBlank = false;
      let anyNumber = false;
      rows.forEach((row) => {
        const v = typeof col.value === 'function' ? col.value(row) : row[col.key];
        if (isBlank(v)) { hasBlank = true; return; }
        if (typeof v === 'number' && Number.isFinite(v)) anyNumber = true;
        const k = facetKeyOf(v);
        seen.set(k, (seen.get(k) || 0) + 1);
      });
      seenByCol.set(col.key, { seen, hasBlank, anyNumber });
    });
    return columns.map((col) => {
      const info = seenByCol.get(col.key) || { seen: new Map(), hasBlank: false, anyNumber: false };
      const distinct = info.seen.size;
      let mode = 'text';
      if (col.filterable === false || col.filter === 'none') mode = 'none';
      else if (col.filter && col.filter !== 'auto') mode = col.filter;
      else if (Array.isArray(col.facetOptions)) mode = 'facet';
      else if (col.dataType === 'number' || col.numeric || info.anyNumber) mode = 'range';
      else if (distinct <= autoFacetLimit) mode = 'facet';
      const options = Array.isArray(col.facetOptions)
        ? col.facetOptions.map(String)
        : [...info.seen.keys()].sort((a, b) => collator.compare(a, b));
      return { col, mode, options, hasBlank: info.hasBlank };
    });
  }, [columns, rows, autoFacetLimit]);

  const filterable = meta.filter((m) => m.mode !== 'none');

  const filterMap = useMemo(() => {
    const out = {};
    Object.keys(filters).forEach((k) => {
      const clean = stripFilter(filters[k]);
      if (clean.type) out[k] = clean;
    });
    return out;
  }, [filters]);

  const queryTerms = useMemo(
    () => String(query || '').split(/\s+/).map((s) => s.toLowerCase()).filter(Boolean),
    [query]
  );

  const visibleRows = useMemo(() => {
    let out = rows.slice();
    if (Object.keys(filterMap).length || queryTerms.length) {
      out = out.filter((row) => rowMatches(row, columns, filterMap, queryTerms));
    }
    const activeSort = sort ? columns.find((c) => c.key === sort.key && !c.hidden) : null;
    if (activeSort) {
      const numeric = activeSort.dataType === 'number' || !!activeSort.numeric;
      const dir = sort.dir === 'desc' ? -1 : 1;
      out.sort((a, b) => {
        const av = typeof activeSort.value === 'function' ? activeSort.value(a) : a[activeSort.key];
        const bv = typeof activeSort.value === 'function' ? activeSort.value(b) : b[activeSort.key];
        return dir * compareValues(av, bv, numeric);
      });
    }
    return out;
  }, [rows, columns, filterMap, queryTerms, sort]);

  const activeCount = Object.keys(filterMap).length;
  const visibleCols = columns.filter((c) => !c.hidden);

  const onSort = (col) => {
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null;
    });
  };

  const setFilter = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (!value || !value.type) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const resetAll = () => {
    setFilters({});
    setQuery('');
  };

  /* Mise en évidence de la ligne cible (focusRowKey) après navigation inter-page :
     défilement au centre + flash ambre pendant ~2 s, puis onFocusDone(). */
  const scrollRef = useRef(null);
  const focusTimerRef = useRef(null);
  useEffect(() => {
    if (focusRowKey === null || focusRowKey === undefined || focusRowKey === '') {
      return undefined;
    }
    const container = scrollRef.current;
    const wanted = String(focusRowKey);
    let target = null;
    if (container) {
      container.querySelectorAll('tr[data-rk]').forEach((tr) => {
        if (!target && tr.getAttribute('data-rk') === wanted) target = tr;
      });
    }
    if (!target) return undefined;
    const clearFlash = () => {
      if (!target) return;
      target.style.background = '';
      target.style.boxShadow = '';
    };
    clearFlash();
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.style.background = '#fef9c3';
    target.style.boxShadow = 'inset 0 0 0 2px #fbbf24';
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      clearFlash();
      if (typeof onFocusDone === 'function') onFocusDone();
    }, 2200);
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRowKey, rows]);

  /* ── Contrôle de filtre adapté au type de colonne ─────────────────────── */
  const renderFilterControl = (m) => {
    const { col, mode, options, hasBlank } = m;
    const current = filters[col.key];
    if (mode === 'facet') {
      const val = current && current.type === 'facet' ? current.val : ALL_KEY;
      return (
        <FilterCard label={col.label}>
          <select
            className="w-full text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-blue-400"
            value={val}
            onChange={(e) => {
              const v = e.target.value;
              setFilter(col.key, v === ALL_KEY ? null : { type: 'facet', val: v });
            }}
          >
            <option value={ALL_KEY}>Tous</option>
            {(hasBlank || val === EMPTY_KEY) && <option value={EMPTY_KEY}>— non renseigné —</option>}
            {options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </FilterCard>
      );
    }
    if (mode === 'range') {
      const min = current && current.type === 'range' ? current.min : '';
      const max = current && current.type === 'range' ? current.max : '';
      return (
        <FilterCard label={`${col.label} (min – max)`}>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder="min"
              value={min}
              onChange={(e) => setFilter(col.key, { type: 'range', min: e.target.value, max })}
              className="w-full min-w-0 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-blue-400"
            />
            <span className="text-[10px] text-slate-300">–</span>
            <input
              type="number"
              placeholder="max"
              value={max}
              onChange={(e) => setFilter(col.key, { type: 'range', min, max: e.target.value })}
              className="w-full min-w-0 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-blue-400"
            />
          </div>
        </FilterCard>
      );
    }
    const text = current && current.type === 'text' ? current.text : '';
    return (
      <FilterCard label={col.label}>
        <input
          type="text"
          placeholder="contient…"
          value={text}
          onChange={(e) => setFilter(col.key, { type: 'text', text: e.target.value })}
          className="w-full text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-blue-400"
        />
      </FilterCard>
    );
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Barre d’outils */}
      <div className="px-3 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 min-w-[220px] flex-1">
          <span className="text-slate-300 text-sm leading-none" aria-hidden="true">🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 placeholder:text-slate-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-slate-300 hover:text-slate-500 text-sm leading-none px-1"
              title="Effacer la recherche"
            >✕</button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
            {visibleRows.length} / {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            className={`text-[11px] font-black px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
              activeCount
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : panelOpen
                  ? 'bg-slate-100 border-slate-200 text-slate-600'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {activeCount ? `Filtres (${activeCount})` : 'Filtres'}
            <span className={`text-[8px] ${activeCount ? 'text-blue-400' : 'text-slate-300'}`}>▾</span>
          </button>
          {(activeCount || queryTerms.length) && (
            <button
              type="button"
              onClick={resetAll}
              className="text-[11px] font-bold text-slate-400 hover:text-red-500 px-1.5 py-1.5"
              title="Effacer les filtres et la recherche"
            >Réinitialiser</button>
          )}
        </div>
      </div>

      {/* Filtres rapides (listes déroulantes au-dessus du tableau) */}
      {quickFilters.length > 0 && (
        <div className="px-3 pb-2.5 pt-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Filtrer :</span>
          {quickFilters.map((key) => {
            const m = meta.find((x) => x.col.key === key && x.mode !== 'none');
            if (!m) return null;
            const { col, options, hasBlank } = m;
            const current = filters[key];
            const val = current && current.type === 'facet' ? current.val : ALL_KEY;
            return (
              <label key={key} className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">{col.label}</span>
                <select
                  value={val}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilter(key, v === ALL_KEY ? null : { type: 'facet', val: v });
                  }}
                  className="max-w-[210px] text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-blue-400"
                >
                  <option value={ALL_KEY}>Tous</option>
                  {(hasBlank || val === EMPTY_KEY) && <option value={EMPTY_KEY}>— non renseigné —</option>}
                  {options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      {/* Panneau de filtres par colonne */}
      {panelOpen && (
        <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/70">
          {filterable.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
              {filterable.map((m) => (
                <div key={m.col.key}>{renderFilterControl(m)}</div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">Ce tableau n’a pas de filtre par colonne.</p>
          )}
        </div>
      )}
      {/* Tableau */}
      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-black text-slate-500">{emptyLabel}</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-bold text-slate-500">{noMatchLabel}</p>
          <button
            type="button"
            onClick={resetAll}
            className="mt-2 text-[11px] font-black text-blue-600 hover:text-blue-700"
          >Réinitialiser les filtres</button>
        </div>
      ) : (
        <div className="overflow-auto custom-scrollbar overscroll-contain" ref={scrollRef} style={maxHeight ? { maxHeight } : undefined}>
          <table className="w-full text-sm border-collapse" style={{ minWidth }}>
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                {visibleCols.map((col, ci) => (
                  <SortHeader
                    key={col.key}
                    col={col}
                    colIndex={ci}
                    sort={sort}
                    onSort={onSort}
                    alignRight={col.align === 'right'}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, idx) => {
                const extraRowClass = typeof rowClass === 'function' ? rowClass(row, idx) : (rowClass || '');
                return (
                  <tr
                    key={rowKey(row, idx)}
                    data-rk={String(rowKey(row, idx))}
                    className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/50 align-top ${extraRowClass}`}
                  >
                    {visibleCols.map((col, ci) => {
                      const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
                      const isNumeric = col.dataType === 'number' || !!col.numeric;
                      const content = typeof col.display === 'function'
                        ? col.display(row)
                        : (isBlank(raw) ? '—' : toText(raw));
                      const cls = [
                        'px-3 py-2.5',
                        ci > 0 ? 'border-l border-slate-200/70' : '',
                        col.align === 'right' || (isNumeric && col.align !== 'left') ? 'text-right' : 'text-left',
                        col.nowrap ? 'whitespace-nowrap' : '',
                        col.tdClass || '',
                      ].filter(Boolean).join(' ');
                      return <td key={col.key} className={cls}>{content}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
