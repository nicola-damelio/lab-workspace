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

/* ── Sélection de cellules & somme ─────────────────────────────────────── */
const SEP = '\u0001';

/* Valeur « brute » d'une colonne pour une ligne (utilisée aussi pour la somme
   des cellules sélectionnées). */
const rawValueOf = (col, row) => (typeof col.value === 'function' ? col.value(row) : row[col.key]);

/* Format d'affichage des sommes (écriture française, regroupement par milliers). */
const sumFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/* Convertit une valeur en nombre exploitable : nombres, chaînes numériques,
   montants au format français « 1 234,56 € », « 1.234,56 »… → null si aucune
   valeur chiffrée. */
const parseNumeric = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  const cleaned = s.replace(/[€\s\u00A0\u202F\u2007\u2009\u200A\u200B\u00B4']/g, '').replace(/[%]/g, '');
  if (!cleaned) return null;
  let normalized;
  if (cleaned.includes(',')) {
    // Virgule décimale → les « . » sont des séparateurs de milliers.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Point unique suivi de 1-2 décimales → séparateur décimal ; sinon millier.
    normalized = (cleaned.split('.').length - 1 === 1 && /\.\d{1,2}$/.test(cleaned))
      ? cleaned
      : cleaned.replace(/\./g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

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
const SortHeader = ({ col, colIndex = 0, sort, onSort, alignRight, stickyLeft = null, stickyEdge = false }) => {
  const active = sort && sort.key === col.key;
  const dir = active ? sort.dir : null;
  /* Cellule épinglée : la ligne d’en-têtes reste visible pendant le défilement
     vertical du tableau ; un léger filet gauche sépare les colonnes. */
  const divider = colIndex > 0 ? ' border-l border-slate-200/80' : '';
  /* Épinglage horizontal : `left` = position réelle mesurée de la colonne ;
     le z-index passe au-dessus des cellules du corps qui défilent dessous. */
  const stickyStyle = stickyLeft == null
    ? undefined
    : {
        left: stickyLeft,
        zIndex: 30,
        boxShadow: stickyEdge ? '10px 0 10px -8px rgba(15, 23, 42, 0.4)' : undefined,
      };
  return (
    <th
      className={`px-3 py-2.5 sticky top-0 z-10 bg-slate-50 border-b-2 border-slate-200 ${alignRight ? 'text-right' : 'text-left'}${divider}`}
      style={stickyStyle}
    >
      {col.sortable === false ? (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 font-black uppercase tracking-wide">{col.header || col.label}</span>
      ) : (
        <button
          type="button"
          onClick={() => onSort(col)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide font-black group text-left ${
            active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {col.header || col.label}
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
  /* Ligne CLIQUABLE (facultatif) : `onRowClick(row)` est appelé au clic sur une
     ligne pour laquelle `rowClickable(row, idx)` est vrai (par défaut : toutes).
     Les clics sur un bouton, un lien, un champ ou une cellule chiffrée
     sélectionnable (somme de cellules) sont ignorés : les actions de ligne et la
     sélection des montants restent utilisables. Sans `onRowClick`, le tableau se
     comporte exactement comme avant. */
  onRowClick,
  rowClickable,
  /* Hauteur maxi du bloc défilant : la 1re ligne (en-têtes) reste toujours
     visible (colonne de définitions épinglée) pendant le défilement vertical. */
  maxHeight = '62vh',
  /* Remplit toute la hauteur laissée par le parent (page en colonne flex) :
     le bloc de défilement prend le reste de l’écran, donc la barre de
     défilement horizontale reste toujours visible en bas, sans faire défiler
     la page pour la rejoindre. Désactive le plafond `maxHeight`. */
  fillHeight = false,
  /* Sélection de cellules chiffrées (clic simple, Ctrl/Cmd+clic pour ajouter /
     retirer, Maj+clic pour étendre) avec affichage de la somme des valeurs
     sélectionnées. Désactivable au cas par cas (ex. mini-tableaux décoratifs). */
  enableCellSum = true,
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
  /* Colonnes conservées à gauche pendant le défilement horizontal : les
     `frozenCols` premières colonnes du tableau restent visibles quand on fait
     défiler le reste horizontalement (identifiants, intitulés…). */
  frozenCols = 5,
}) => {
  const [sort, setSort] = useState(null); // { key, dir: 'asc'|'desc' } | null
  const [filters, setFilters] = useState({}); // colKey -> filtre actif
  const [query, setQuery] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);

  /* Colonnes épinglées à gauche pendant le défilement horizontal : `lefts`
     contient la position en px de chaque colonne figée (mesurée dans le DOM),
     `active` = le tableau déborde réellement et le gel s’applique. */
  const [stickyInfo, setStickyInfo] = useState({ active: false, lefts: [] });
  const [measureTick, setMeasureTick] = useState(0);

  /* Cellules chiffrées sélectionnées — clé « String(rowKey) + SEP + col.key ». */
  const [selSet, setSelSet] = useState(() => new Set());
  const anchorRef = useRef(null); // { rk, c } : cellule d'ancrage pour Maj+clic

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
  /* Nombre de colonnes à conserver visibles à gauche (borné au nombre réel). */
  const frozenCount = Math.max(0, Math.min(frozenCols, visibleCols.length));

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

  const clearSel = () => {
    setSelSet(new Set());
    anchorRef.current = null;
  };

  /* Échap : efface la sélection courante. */
  useEffect(() => {
    if (!enableCellSum || selSet.size === 0) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') clearSel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableCellSum, selSet.size]);

  /* Si la fonctionnalité est désactivée, on repart d'une sélection vide. */
  useEffect(() => {
    if (!enableCellSum && selSet.size > 0) clearSel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableCellSum]);

  /* Les cellules sorties de la vue (filtres, recherche…) sont retirées de la
     sélection : la somme affichée correspond toujours aux cellules visibles. */
  useEffect(() => {
    if (!enableCellSum || selSet.size === 0) return undefined;
    const rks = new Set();
    visibleRows.forEach((row, idx) => rks.add(String(rowKey(row, idx))));
    const visibleKeys = new Set();
    visibleCols.forEach((col) => {
      const numericCol = col.dataType === 'number' || !!col.numeric;
      if (!numericCol) return;
      rks.forEach((rk) => visibleKeys.add(rk + SEP + col.key));
    });
    const kept = [...selSet].filter((k) => visibleKeys.has(k));
    if (kept.length !== selSet.size) {
      setSelSet(new Set(kept));
      if (kept.length === 0) anchorRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, visibleCols, selSet, enableCellSum]);

  /* Clic sur une cellule chiffrée : sélection simple ; Ctrl/Cmd+clic pour
     ajouter/retirer ; Maj+clic pour étendre depuis la cellule d'ancrage. */
  const handleCellClick = (rowIdx, colIdx, rk, ck, ev) => {
    const key = rk + SEP + ck;
    const additive = ev.ctrlKey || ev.metaKey;
    const anchor = anchorRef.current;
    if (ev.shiftKey && anchor) {
      let aRow = -1;
      for (let i = 0; i < visibleRows.length; i += 1) {
        if (String(rowKey(visibleRows[i], i)) === anchor.rk) { aRow = i; break; }
      }
      if (aRow < 0) {
        setSelSet(new Set([key]));
        anchorRef.current = { rk, c: colIdx };
        return;
      }
      const r1 = Math.min(aRow, rowIdx);
      const r2 = Math.max(aRow, rowIdx);
      const c1 = Math.min(anchor.c, colIdx);
      const c2 = Math.max(anchor.c, colIdx);
      const keys = [];
      for (let r = r1; r <= r2; r += 1) {
        const rrow = visibleRows[r];
        const rrKey = String(rowKey(rrow, r));
        for (let c = c1; c <= c2; c += 1) {
          const col = visibleCols[c];
          const numericCol = col.dataType === 'number' || !!col.numeric;
          if (!numericCol) continue;
          if (parseNumeric(rawValueOf(col, rrow)) === null) continue;
          keys.push(rrKey + SEP + col.key);
        }
      }
      setSelSet((prev) => {
        const next = new Set(additive ? prev : []);
        keys.forEach((k) => next.add(k));
        return next;
      });
      return;
    }
    if (additive) {
      setSelSet((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      anchorRef.current = { rk, c: colIdx };
      return;
    }
    setSelSet((prev) => ((prev.size === 1 && prev.has(key)) ? new Set() : new Set([key])));
    anchorRef.current = { rk, c: colIdx };
  };

  /* Statistiques de la sélection : nombre de cellules sélectionnées et somme
     des valeurs, regroupée par colonne (les unités peuvent différer d'une
     colonne à l'autre : €, jours, quantités…). */
  const sumStats = useMemo(() => {
    if (!enableCellSum || selSet.size === 0) return null;
    const rkIdx = new Map();
    visibleRows.forEach((row, idx) => {
      const k = String(rowKey(row, idx));
      if (!rkIdx.has(k)) rkIdx.set(k, idx);
    });
    const colMeta = new Map();
    visibleCols.forEach((col, ci) => colMeta.set(col.key, { col, ci }));
    const acc = new Map(); // colKey -> { label, sum, count }
    let cells = 0;
    selSet.forEach((key) => {
      const sepAt = key.indexOf(SEP);
      if (sepAt <= 0) return;
      const rk = key.slice(0, sepAt);
      const ck = key.slice(sepAt + 1);
      const idx = rkIdx.get(rk);
      const meta = colMeta.get(ck);
      if (idx === undefined || !meta) return;
      const col = meta.col;
      const numericCol = col.dataType === 'number' || !!col.numeric;
      if (!numericCol) return;
      const n = parseNumeric(rawValueOf(col, visibleRows[idx]));
      if (n === null) return;
      let entry = acc.get(ck);
      if (!entry) {
        entry = {
          label: (typeof col.label === 'string' && col.label) || ck,
          sum: 0,
          count: 0,
        };
        acc.set(ck, entry);
      }
      entry.sum += n;
      entry.count += 1;
      cells += 1;
    });
    if (cells === 0) return null;
    return {
      cells,
      cols: visibleCols.map((col) => acc.get(col.key)).filter(Boolean),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableCellSum, selSet, visibleRows, visibleCols, rowKey]);

  /* Mise en évidence de la ligne cible (focusRowKey) après navigation inter-page :
     défilement au centre + flash ambre pendant ~2 s, puis onFocusDone(). */
  const scrollRef = useRef(null);
  const focusTimerRef = useRef(null);

  /* ── Épinglage des colonnes à gauche lors du défilement horizontal ──────
     Si le tableau déborde de son conteneur, les `frozenCols` premières
     colonnes (en-têtes + cellules) reçoivent `position: sticky; left: X` où X
     est leur position naturelle calculée en cumulant les largeurs réelles des
     colonnes (les largeurs d’un tableau en disposition automatique ne sont
     connues qu’après le rendu — et la position ne doit PAS être lue sur les
     en-têtes déjà épinglés pendant un défilement horizontal). */
  useEffect(() => {
    const container = scrollRef.current;
    const table = container ? container.querySelector('table') : null;
    if (!container || !table) {
      setStickyInfo((prev) => (prev.active || prev.lefts.length ? { active: false, lefts: [] } : prev));
      return undefined;
    }
    const heads = Array.prototype.slice.call(table.querySelectorAll('thead th'));
    const n = Math.min(frozenCount, heads.length);
    const overflow = table.scrollWidth > container.clientWidth + 1;
    if (!overflow || n === 0) {
      setStickyInfo((prev) => (prev.active || prev.lefts.length ? { active: false, lefts: [] } : prev));
      return undefined;
    }
    /* Positions naturelles des colonnes figées. IMPORTANT : on NE PEUT PAS lire
       getBoundingClientRect().left des en-têtes pendant que le tableau est
       défilé — ces en-têtes sont déjà « sticky » et renverraient leur position
       épinglée (colée), pas leur position naturelle : le calcul produirait
       ancienne_position + scrollLeft (colonnes projetées vers la droite).
       On cumule donc les largeurs réelles mesurées des colonnes depuis le bord
       gauche de la table (disposition automatique, indépendant du défilement). */
    let acc = 0;
    const lefts = [];
    for (let i = 0; i < n; i += 1) {
      lefts.push(Math.round(acc * 10) / 10);
      acc += heads[i].getBoundingClientRect().width;
    }
    setStickyInfo((prev) => (
      prev.active && prev.lefts.length === lefts.length
        && prev.lefts.every((v, j) => Math.abs(v - lefts[j]) < 0.6)
        ? prev
        : { active: true, lefts }
    ));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCols, visibleRows, frozenCount, measureTick]);

  /* Re-mesure quand le conteneur change de largeur (redimensionnement de la
     fenêtre, ouverture du panneau de filtres…) : en disposition automatique
     les largeurs de colonnes peuvent alors changer. */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setMeasureTick((t) => t + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

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
    /* Les cellules épinglées (colonnes figées à gauche) ont un fond opaque :
       on les colore aussi pendant le flash pour que la ligne reste visible. */
    const setFrozenCells = (bg) => {
      if (!target) return;
      target.querySelectorAll('td.sticky').forEach((td) => {
        const wasSelected = td.classList.contains('bg-blue-100');
        td.style.backgroundColor = bg === null
          ? (wasSelected ? '#dbeafe' : '#ffffff')
          : bg;
      });
    };
    const clearFlash = () => {
      if (!target) return;
      target.style.background = '';
      target.style.boxShadow = '';
      setFrozenCells(null);
    };
    clearFlash();
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.style.background = '#fef9c3';
    target.style.boxShadow = 'inset 0 0 0 2px #fbbf24';
    setFrozenCells('#fef9c3');
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
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${fillHeight ? 'flex flex-1 min-h-0 flex-col' : ''}`}>
      {/* Cellules dont la valeur chiffrée vaut zéro : affichées en gris clair.
          Comportement commun à toutes les tables SmartTable. La règle passe en
          !important car certaines cellules « montant » définissent leur propre
          couleur de texte. */}
      <style>{`td.st-zero, td.st-zero * { color: #94a3b8 !important; }`}</style>
      {/* Barre d’outils */}
      <div className="shrink-0 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
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
        <div className="shrink-0 px-3 pb-2.5 pt-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-2">
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
        <div className={`shrink-0 px-3 py-2.5 border-b border-slate-100 bg-slate-50/70 ${fillHeight ? 'max-h-[40vh] overflow-y-auto custom-scrollbar' : ''}`}>
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
        <div className={`p-8 text-center ${fillHeight ? 'flex-1 flex flex-col items-center justify-center' : ''}`}>
          <p className="text-sm font-black text-slate-500">{emptyLabel}</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className={`p-8 text-center ${fillHeight ? 'flex-1 flex flex-col items-center justify-center' : ''}`}>
          <p className="text-sm font-bold text-slate-500">{noMatchLabel}</p>
          <button
            type="button"
            onClick={resetAll}
            className="mt-2 text-[11px] font-black text-blue-600 hover:text-blue-700"
          >Réinitialiser les filtres</button>
        </div>
      ) : (
        <div
          className={`overflow-auto custom-scrollbar overscroll-contain ${fillHeight ? 'flex-1 min-h-0' : ''}`}
          ref={scrollRef}
          style={!fillHeight && maxHeight ? { maxHeight } : undefined}
        >
          <table className="w-full text-sm border-collapse" style={{ minWidth }}>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                {visibleCols.map((col, ci) => (
                  <SortHeader
                    key={col.key}
                    col={col}
                    colIndex={ci}
                    sort={sort}
                    onSort={onSort}
                    alignRight={col.align === 'right'}
                    stickyLeft={stickyInfo.active && ci < stickyInfo.lefts.length ? stickyInfo.lefts[ci] : null}
                    stickyEdge={stickyInfo.active && ci === stickyInfo.lefts.length - 1}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, idx) => {
                const extraRowClass = typeof rowClass === 'function' ? rowClass(row, idx) : (rowClass || '');
                const rk = String(rowKey(row, idx));
                const clickable = typeof onRowClick === 'function'
                  && (typeof rowClickable === 'function' ? !!rowClickable(row, idx) : true);
                const activateRow = clickable
                  ? (e) => {
                    /* Un bouton, un lien, un champ ou une cellule chiffrée
                       sélectionnable garde son propre rôle : le clic « ligne »
                       ne s'applique qu'ailleurs. */
                    if (e.target.closest('button, a, input, select, textarea, label, .cursor-cell')) return;
                    onRowClick(row, e);
                  }
                  : undefined;
                return (
                  <tr
                    key={rowKey(row, idx)}
                    data-rk={rk}
                    onClick={activateRow}
                    className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/50 align-top ${clickable ? 'cursor-pointer' : ''} ${extraRowClass}`}
                  >
                    {visibleCols.map((col, ci) => {
                      const raw = rawValueOf(col, row);
                      const isNumeric = col.dataType === 'number' || !!col.numeric;
                      const num = isNumeric ? parseNumeric(raw) : null;
                      /* Cellule dont la valeur chiffrée vaut zéro → gris clair. */
                      const isZero = isNumeric && num !== null && num === 0;
                      const content = typeof col.display === 'function'
                        ? col.display(row)
                        : (isBlank(raw) ? '—' : toText(raw));
                      const cellKey = rk + SEP + col.key;
                      const selectable = enableCellSum && num !== null;
                      const selected = selectable && selSet.has(cellKey);
                      const frozenLeft = stickyInfo.active && ci < stickyInfo.lefts.length
                        ? stickyInfo.lefts[ci]
                        : null;
                      const cls = [
                        'px-3 py-2.5',
                        ci > 0 ? 'border-l border-slate-200/70' : '',
                        col.align === 'right' || (isNumeric && col.align !== 'left') ? 'text-right' : 'text-left',
                        col.nowrap ? 'whitespace-nowrap' : '',
                        col.tdClass || '',
                        selectable ? 'cursor-cell' : '',
                        selected ? 'bg-blue-100 shadow-[inset_0_0_0_2px_rgba(37,99,235,0.55)]' : '',
                        isZero ? 'st-zero' : '',
                        frozenLeft != null ? 'sticky' : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <td
                          key={col.key}
                          className={cls}
                          aria-selected={selected || undefined}
                          style={frozenLeft == null
                            ? undefined
                            : {
                                left: frozenLeft,
                                zIndex: 2,
                                backgroundColor: selected ? '#dbeafe' : '#ffffff',
                                boxShadow: ci === stickyInfo.lefts.length - 1
                                  ? '10px 0 10px -8px rgba(15, 23, 42, 0.4)'
                                  : undefined,
                              }}
                          onClick={selectable
                            ? (ev) => {
                                const t = ev.target;
                                if (t && typeof t.closest === 'function'
                                  && t.closest('button, a, input, select, textarea, label, [contenteditable="true"]')) return;
                                handleCellClick(idx, ci, rk, col.key, ev);
                              }
                            : undefined}
                        >{content}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Barre « somme » des cellules sélectionnées */}
      {sumStats && (
        <div className="shrink-0 px-3 py-2 border-t border-blue-100 bg-gradient-to-r from-blue-50/90 to-indigo-50/60 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
            <span aria-hidden="true">🧮</span>
            {sumStats.cells} cellule{sumStats.cells > 1 ? 's' : ''} sélectionnée{sumStats.cells > 1 ? 's' : ''}
          </span>
          {sumStats.cols.length === 1 ? (
            <span className="flex items-baseline gap-1.5 text-xs font-semibold text-blue-700">
              Somme
              <span className="text-sm font-black text-blue-900 tabular-nums whitespace-nowrap">
                {sumFmt.format(sumStats.cols[0].sum)}
              </span>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              {sumStats.cols.map((c, i) => (
                <span
                  key={`${c.label}-${i}`}
                  title={`${c.label} : ${sumFmt.format(c.sum)}`}
                  className="inline-flex items-baseline gap-1.5 bg-white border border-blue-200 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-blue-800"
                >
                  <span className="uppercase text-[9px] font-black text-blue-400 truncate max-w-[120px]">{c.label}</span>
                  <span className="font-black tabular-nums whitespace-nowrap">{sumFmt.format(c.sum)}</span>
                </span>
              ))}
            </span>
          )}
          <span className="hidden md:inline text-[10px] font-semibold text-blue-400 ml-auto">
            Clic : sélectionner · Ctrl/Cmd+clic : ajouter/retirer · Maj+clic : étendre · Échap : effacer
          </span>
          <button
            type="button"
            onClick={clearSel}
            title="Effacer la sélection (Échap)"
            className="ml-auto md:ml-0 text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-white text-blue-600 hover:bg-blue-100 transition-colors shrink-0"
          >✕ Effacer</button>
        </div>
      )}
    </div>
  );
};
