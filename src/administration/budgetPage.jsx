/* =========================================================================
   src/administration/budgetPage.jsx
   Page « Budget overview » — studio de graphiques budgétaires.

   Chaque membre du laboratoire compose et enregistre SES propres graphiques
   (dépenses, lignes budgétaires / recettes, ordres de mission, souhaits) :
     · type : camembert 🥧 / barres 📊 / courbe 📈 ;
     · regroupement : classification, catégorie, statut, fournisseur,
       opérateur (demandeur), ligne budgétaire, mois / année / jour… ;
     · mesure : somme des montants ou nombre d’enregistrements.

   Sauvegarde : les graphiques personnels sont rangés DANS la base courante,
   sous administration.settings.budgetCharts[<id opérateur>], et persistés
   par la sauvegarde automatique habituelle du dataset. Aucune sous-collection.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAdmin } from './AdminContext';
import { DEPENSE_BC_SIGNE, isPiFournisseur } from './adminSchema';
import { parseEuroAmount } from './importUtils';

/* ── Formatage ──────────────────────────────────────────────────────────── */
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const euroFull = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const countFull = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const pctFull = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmtMoney = (v) => euroFull.format(v);
const fmtCount = (v) => countFull.format(v);
const fmtVal = (v, money) => (money ? fmtMoney(v) : fmtCount(v));
/** Valeur numérique (nombre ou « 1.234,56 »), sinon null. */
const parseAmount = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseEuroAmount(v);
  return n === null ? null : Math.round(n * 100) / 100;
};
/** Toujours numérique (0 quand vide) pour les totaux calculés. */
const toNum = (v) => {
  const n = parseAmount(v);
  return n === null ? 0 : n;
};
const normLabel = (s) => txt(s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isoDate = (s) => {
  const t = txt(s);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
const dateFromIso = (iso) => {
  const p = String(iso || '').split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
};
const monthLabel = (iso) => {
  const d = dateFromIso(iso);
  return d ? d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : iso;
};
const dayLabel = (iso) => {
  const d = dateFromIso(iso);
  return d ? d.toLocaleDateString('fr-FR') : iso;
};

/* ── Palette + métadonnées ──────────────────────────────────────────────── */
const PALETTE = [
  '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#6366f1', '#f97316', '#14b8a6', '#3b82f6',
  '#f43f5e', '#a855f7', '#22c55e', '#eab308', '#0d9488', '#64748b',
];
const paletteFor = (i) => PALETTE[i % PALETTE.length];

const CHART_TYPES = [
  { id: 'pie', label: 'Camembert', icon: '🥧' },
  { id: 'bar', label: 'Barres', icon: '📊' },
  { id: 'line', label: 'Courbe', icon: '📈' },
];
const SOURCE_META = {
  depenses: { label: 'Dépenses', icon: '🧾' },
  lignes: { label: 'Lignes budgétaires (Recettes)', icon: '📈' },
  om: { label: 'Ordres de mission', icon: '✈️' },
  desiderate: { label: 'Souhaits d’achat', icon: '🛒' },
};
const SAVE_KEY = 'budgetCharts';
const ROUND = (v) => Math.round(v * 100) / 100;

/* ── Dates de référence par source ─────────────────────────────────────── */
const DATE_KEYS = {
  depenses: ['dateDemande', 'dateBC', 'dateSignatureBC', 'dateSignature', 'dateApprobFournisseur', 'dateAcceptationFournisseur'],
  om: ['dateDemande', 'dateDebut', 'dateRetour'],
  desiderate: ['dateDemande'],
  lignes: [],
};
const firstDate = (row, source) => {
  const keys = DATE_KEYS[source] || [];
  for (const k of keys) {
    const iso = isoDate(row && row[k]);
    if (iso) return iso;
  }
  return null;
};

/* ── Fabrique de dimensions ────────────────────────────────────────────── */
const textDim = (id, label, keys, opts = {}) => ({
  id, label, keys,
  group: (row) => {
    for (const k of keys) {
      const v = txt(row && row[k]);
      if (v) return { key: normLabel(v), label: v };
    }
    return null;
  },
  ...opts,
});
const timeDim = (id, label, bucket) => ({
  id, label, time: true, bucket,
  group: (row, ctx) => {
    const iso = firstDate(row, ctx.source);
    if (!iso) return null;
    const key = bucket === 'year' ? iso.slice(0, 4) : bucket === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
    const shown = bucket === 'year' ? iso.slice(0, 4) : bucket === 'month' ? monthLabel(key) : dayLabel(key);
    return { key, label: shown };
  },
});
const ligneDim = (id, recetteKeys, extraKeys) => ({
  id,
  label: 'Ligne budgétaire',
  group: (row, ctx) => {
    const list = (ctx && ctx.recettes) || [];
    for (const rk of recetteKeys) {
      const rid = txt(row && row[rk]);
      if (!rid) continue;
      const found = list.find((r) => r && r.id === rid);
      const name = found && found.ligne ? txt(found.ligne) : '';
      if (name) return { key: `L:${normLabel(name)}`, label: name };
    }
    for (const k of (extraKeys || [])) {
      const v = txt(row && row[k]);
      if (v) return { key: `R:${normLabel(v)}`, label: v };
    }
    return null;
  },
});

/* ── Dimensions disponibles par source ─────────────────────────────────── */
const DIM_BY_SOURCE = {
  depenses: [
    timeDim('annee', 'Par année', 'year'),
    timeDim('mois', 'Par mois', 'month'),
    timeDim('jour', 'Par jour', 'day'),
    textDim('classification', 'Classification / nature', ['classification', 'nature']),
    textDim('categorie', 'Catégorie (Fonct. / Invest.)', ['categorie']),
    textDim('statut', 'Statut (pipeline)', ['statut', 'suivi']),
    textDim('demandeur', 'Opérateur / demandeur', ['demandeur', 'porteur']),
    textDim('fournisseur', 'Fournisseur', ['fournisseur', 'fournisseurNom', 'nomFournisseur']),
    ligneDim('ligne', ['recetteId'], ['ligneBudgetaire', 'ligne']),
    textDim('ent', 'ENT', ['ent']),
  ],
  lignes: [
    textDim('ligne', 'Ligne budgétaire', ['ligne']),
    textDim('type', 'Type (Fonctionnement / Investissement)', ['type']),
    textDim('porteur', 'Porteur du projet', ['porteur', 'porteurNom']),
  ],
  om: [
    timeDim('annee', 'Par année', 'year'),
    timeDim('mois', 'Par mois', 'month'),
    timeDim('jour', 'Par jour', 'day'),
    textDim('statut', 'Statut', ['statut']),
    textDim('demandeur', 'Demandeur', ['demandeur']),
    textDim('destination', 'Destination', ['destination', 'ville']),
    textDim('coutStatut', 'Coût : estimé / exact', ['coutStatut']),
    ligneDim('ligne', ['recetteId'], ['ligneBudgetaire', 'ligne']),
  ],
  desiderate: [
    timeDim('annee', 'Par année', 'year'),
    timeDim('mois', 'Par mois', 'month'),
    timeDim('jour', 'Par jour', 'day'),
    textDim('urgence', 'Urgence', ['urgence', 'priorite']),
    textDim('statut', 'Statut', ['statut']),
    textDim('demandeur', 'Demandeur', ['demandeur']),
    textDim('categorie', 'Catégorie (Fonct. / Invest.)', ['categorie']),
    ligneDim('ligne', ['recetteSuggereeId'], ['ligneBudgetaire', 'ligne', 'recetteSuggerie']),
    textDim('fournisseur', 'Fournisseur', ['fournisseur', 'fournisseurNom', 'nomFournisseur']),
  ],
};

/* ── Mesures disponibles par source ────────────────────────────────────── */
const moneyMeasure = (id, label, value) => ({ id, label, money: true, value });
const countMeasure = (id, label) => ({ id, label, money: false, value: () => 1 });
const MEASURE_BY_SOURCE = {
  depenses: [
    moneyMeasure('montant', 'Montant HT + frais de port', (r) => {
      const v = toNum(r.montant) + toNum(r.fraisPort);
      return v > 0 ? ROUND(v) : null;
    }),
    countMeasure('count', 'Nombre de dépenses'),
  ],
  lignes: [
    moneyMeasure('dispo', 'Montant mis à disposition', (r) => r.dispoVal),
    moneyMeasure('budgetTotal', 'Budget total alloué', (r) => r.budgetTotalVal),
    moneyMeasure('engage', 'Dépenses engagées (BC signés + PI)', (r) => (r.engTotal > 0 ? ROUND(r.engTotal) : 0)),
    moneyMeasure('om', 'Coûts OM (hors refusés)', (r) => (r.omTotal > 0 ? ROUND(r.omTotal) : 0)),
    moneyMeasure('souhaits', 'Souhaits approuvés', (r) => (r.desApproved > 0 ? ROUND(r.desApproved) : 0)),
    moneyMeasure('solde', 'Solde restant (calculé)', (r) => ROUND(r.solde)),
    countMeasure('count', 'Nombre de lignes budgétaires'),
  ],
  om: [
    moneyMeasure('montant', 'Coût total (€)', (r) => {
      const t = parseAmount(r.coutTotal);
      if (t !== null && t !== undefined) return t;
      const parts = toNum(r.coutTransport) + toNum(r.coutHebergement) + toNum(r.coutRepas) + toNum(r.coutInscription);
      return parts > 0 ? ROUND(parts) : null;
    }),
    countMeasure('count', "Nombre d'OM"),
  ],
  desiderate: [
    moneyMeasure('montant', 'Montant estimé (€)', (r) => {
      const v = toNum(r.montantEstime) + toNum(r.fraisPort);
      return v > 0 ? ROUND(v) : null;
    }),
    countMeasure('count', 'Nombre de souhaits'),
  ],
};

/* Valeurs par défaut quand on change de source dans le studio. */
const DEFAULT_FOR_SOURCE = {
  depenses: { chartType: 'pie', dimension: 'classification', measure: 'montant', limit: 10 },
  lignes: { chartType: 'bar', dimension: 'type', measure: 'solde', limit: 12 },
  om: { chartType: 'bar', dimension: 'mois', measure: 'montant', limit: 12 },
  desiderate: { chartType: 'pie', dimension: 'urgence', measure: 'montant', limit: 8 },
};

const findDim = (source, dimId) => (DIM_BY_SOURCE[source] || []).find((d) => d.id === dimId);
const findMeasure = (source, measureId) => (MEASURE_BY_SOURCE[source] || []).find((m) => m.id === measureId);
const makeId = () => `budget_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const cfgSignature = (cfg) => JSON.stringify([cfg.source, cfg.chartType, cfg.dimension, cfg.measure, Number(cfg.limit) || 0]);

/** Titre auto depuis les sélections (si l’utilisateur n’en saisit pas). */
const autoTitle = (draft) => {
  const src = SOURCE_META[draft.source] ? SOURCE_META[draft.source].label : draft.source;
  const dim = findDim(draft.source, draft.dimension);
  const meas = findMeasure(draft.source, draft.measure);
  const dimTxt = dim ? dim.label.replace(/^Par /, '') : draft.dimension;
  return `${src} par ${dimTxt.toLowerCase()}${meas ? ` (${meas.label})` : ''}`;
};

/* ── Lignes budgétaires « enrichies » (totaux calculés comme la page Recettes) ── */
const buildLigneRows = (recettes, depenses, om, desiderate) => {
  const isSigned = (d) => txt(d && d.statut) === DEPENSE_BC_SIGNE;
  const isPi = (d) => isPiFournisseur(d && d.fournisseur);
  /* Même règle que la page Recettes : engagé = BC signés + PI (prestations
     internes, considérées consommées dès leur saisie, sauf refus/annulation). */
  const isEngaged = (d) => {
    if (isSigned(d)) return true;
    const st = txt(d && (d.statut || d.suivi));
    return isPi(d) && !/refus|rejet|annul/i.test(st);
  };
  const notRefused = (o) => txt(o && o.statut) !== 'Refusée';
  const omCost = (o) => {
    const t = parseAmount(o && o.coutTotal);
    if (t !== null && t !== undefined) return t;
    const parts = toNum(o && o.coutTransport) + toNum(o && o.coutHebergement) + toNum(o && o.coutRepas) + toNum(o && o.coutInscription);
    return parts > 0 ? parts : null;
  };
  return (Array.isArray(recettes) ? recettes : []).map((rec) => {
    const rid = rec && rec.id;
    const budgetTotalVal = parseAmount(rec && rec.budgetTotal);
    const dispoVal = parseAmount(rec && rec.budgetRenduDispo);
    const engTotal = (Array.isArray(depenses) ? depenses : [])
      .filter((d) => d && d.recetteId === rid && isEngaged(d))
      .reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    const omTotal = (Array.isArray(om) ? om : [])
      .filter((o) => o && o.recetteId === rid && notRefused(o))
      .reduce((s, o) => s + toNum(omCost(o)), 0);
    const desApproved = (Array.isArray(desiderate) ? desiderate : [])
      .filter((d) => d && d.recetteSuggereeId === rid && txt(d.statut) === 'Approved')
      .reduce((s, d) => s + toNum(d.montantEstime), 0);
    const base = dispoVal !== null && dispoVal !== undefined ? dispoVal : budgetTotalVal;
    // Solde = dispo université − engagé (BC signés + PI) − OM
    const solde = (base === null || base === undefined ? 0 : base) - engTotal - omTotal;
    return {
      id: rid,
      ligne: txt(rec && rec.ligne) || rid || '',
      type: txt(rec && rec.type),
      porteur: txt(rec && rec.porteur) || txt(rec && rec.porteurNom),
      budgetTotalVal,
      dispoVal,
      engTotal,
      omTotal,
      desApproved,
      solde,
    };
  });
};

/* ── Agrégation d’un graphique (une config → des points) ────────────────── */
const computeChart = (cfg, rowsBySource, recettes) => {
  const source = cfg.source;
  const dimList = DIM_BY_SOURCE[source] || [];
  const measureList = MEASURE_BY_SOURCE[source] || [];
  const dim = findDim(source, cfg.dimension) || dimList[0];
  const measure = findMeasure(source, cfg.measure) || measureList[0];
  if (!dim || !measure) return null;
  const rows = rowsBySource[source] || [];
  const money = !!measure.money;
  const isTime = !!dim.time;
  const ctx = { source, recettes };
  const map = new Map();
  let records = 0;
  let skipped = 0;

  rows.forEach((row) => {
    const raw = measure.value(row);
    const val = typeof raw === 'number' && Number.isFinite(raw) ? ROUND(raw) : null;
    if (val === null || (money && val === 0)) { skipped += 1; return; }
    const g = dim.group(row, ctx);
    if (!g || !txt(g.label)) { skipped += 1; return; }
    const acc = map.get(g.key) || { key: g.key, name: txt(g.label), value: 0, _n: 0 };
    acc.value = ROUND(acc.value + val);
    acc._n += 1;
    map.set(g.key, acc);
    records += 1;
  });

  let points = [...map.values()];
  const chartType = cfg.chartType || 'pie';
  if (chartType === 'pie') points = points.filter((p) => p.value > 0);

  if (isTime) {
    points.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  } else {
    points.sort((a, b) => (b.value - a.value) || (a.name < b.name ? -1 : 1));
  }

  const limit = Math.max(0, Math.min(200, Number(cfg.limit) || 0));
  if (limit > 0 && points.length > limit) {
    if (chartType === 'pie') {
      const kept = points.slice(0, limit);
      const rest = points.slice(limit);
      const restVal = ROUND(rest.reduce((s, p) => s + p.value, 0));
      const restN = rest.reduce((s, p) => s + (p._n || 0), 0);
      if (restVal > 0) kept.push({ key: '#autres', name: 'Autres', value: restVal, _n: restN });
      points = kept;
    } else if (isTime) {
      points = points.slice(points.length - limit);
    } else {
      points = points.slice(0, limit);
    }
  }

  const total = ROUND(points.reduce((s, p) => s + p.value, 0));
  const withShare = points.map((p) => ({
    ...p,
    share: total > 0 ? ROUND((p.value / total) * 100) : 0,
  }));

  return {
    cfg,
    points: withShare,
    total,
    records,
    skipped,
    money,
    isTime,
    sourceLabel: SOURCE_META[source] ? SOURCE_META[source].label : source,
    dimLabel: dim.label,
    measureLabel: measure.label,
  };
};

/* ── Rendu Recharts ────────────────────────────────────────────────────── */
const fmtAxis = (v, money) => {
  if (!money) return fmtCount(v);
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (a >= 1e4) return `${Math.round(v / 1e3)} k€`;
  return euroFull.format(v);
};
const shortName = (s) => (txt(s).length > 16 ? `${txt(s).slice(0, 15)}…` : txt(s));

const BudgetTip = ({ active, payload, money }) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  const pt = (p && p.payload) || {};
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2 text-xs max-w-[260px]">
      <div className="font-black text-slate-800 truncate">{pt.name || p.name || ''}</div>
      <div className="text-slate-600 mt-0.5 whitespace-nowrap">
        {fmtVal(p.value, money)}
        {typeof pt.share === 'number' && pt.share >= 0 && (
          <span className="text-slate-400"> · {pctFull.format(pt.share)} %</span>
        )}
      </div>
    </div>
  );
};

const ChartBody = ({ res }) => {
  const data = res.points;
  const type = (res.cfg && res.cfg.chartType) || 'pie';
  const hasNegative = data.some((p) => p.value < 0);
  const axis = {
    fontSize: 10, fill: '#64748b',
  };
  if (type === 'pie') {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} dataKey="value" nameKey="name"
              innerRadius={46} outerRadius="82%" paddingAngle={2} stroke="#ffffff" strokeWidth={1.5}
              label={(entry) => (entry && entry.percent >= 0.05 ? `${Math.round(entry.percent * 100)} %` : '')}
              labelLine={false}
            >
              {data.map((p, i) => (
                <Cell key={p.key || i} fill={paletteFor(i)} />
              ))}
            </Pie>
            <Tooltip content={<BudgetTip money={res.money} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (type === 'line') {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, left: 2, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={axis} tickFormatter={shortName} interval="preserveStartEnd" minTickGap={14} height={40} />
            <YAxis tick={axis} tickFormatter={(v) => fmtAxis(v, res.money)} width={62} />
            <Tooltip content={<BudgetTip money={res.money} />} />
            <Line
              type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5}
              dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }} activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 8, left: 2, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={axis} tickFormatter={shortName} interval={0} height={44} />
          <YAxis tick={axis} tickFormatter={(v) => fmtAxis(v, res.money)} width={62} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} content={<BudgetTip money={res.money} />} />
          <Bar dataKey="value" radius={hasNegative ? [0, 0, 0, 0] : [5, 5, 0, 0]}>
            {data.map((p, i) => (
              <Cell key={p.key || i} fill={paletteFor(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

/* Légende compacte (camembert) : les segments avec leur part. */
const ChartLegend = ({ res }) => (
  <div className="max-h-32 overflow-y-auto custom-scrollbar pl-4 pr-3 pb-1">
    <ul className="text-[11px] text-slate-600 space-y-0.5">
      {res.points.map((p, i) => (
        <li key={p.key || i} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: paletteFor(i) }} />
          <span className="truncate flex-1" title={p.name}>{p.name}</span>
          <span className="font-bold whitespace-nowrap">{fmtVal(p.value, res.money)}</span>
          <span className="text-slate-400 w-11 text-right whitespace-nowrap">{pctFull.format(p.share)} %</span>
        </li>
      ))}
    </ul>
  </div>
);

/* ── Carte graphique (une config sauvegardée) ──────────────────────────── */
const typeMeta = (id) => CHART_TYPES.find((t) => t.id === id) || CHART_TYPES[0];
const dimLabelClean = (label) => txt(label).replace(/^Par /, '');

const ChartCard = ({ item, res, idx, count, onEdit, onDuplicate, onRemove, onMove }) => {
  const type = typeMeta(item.chartType);
  const src = SOURCE_META[item.source];
  const hasData = !!res && res.points.length > 0;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">
            <span aria-hidden="true">{type.icon}</span>
            <span>{type.label}</span>
            {src && <span className="text-slate-300">·</span>}
            {src && <span>{src.icon} {src.label}</span>}
          </div>
          <h3 className="font-black text-slate-800 text-sm leading-snug truncate" title={item.title}>
            {item.title}
          </h3>
          <p className="text-[11px] text-slate-400 leading-snug truncate" title={res ? `${res.dimLabel} · ${res.measureLabel}` : ''}>
            {res ? `${dimLabelClean(res.dimLabel)} · ${res.measureLabel}` : ''}
          </p>
        </div>
        {hasData && (
          <div className="text-right shrink-0 pl-2">
            <div className="font-black text-slate-800 leading-none text-lg">{fmtVal(res.total, res.money)}</div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mt-1">
              {res.money ? 'total €' : 'total'}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {hasData ? (
          <>
            <ChartBody res={res} />
            {type.id === 'pie' && <ChartLegend res={res} />}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 py-10 text-center">
            <div>
              <div className="text-3xl mb-2">{src ? src.icon : '📉'}</div>
              <p className="text-xs font-bold text-slate-500">Aucune donnée chiffrée</p>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed max-w-[240px]">
                Ajoutez ou chiffrez des enregistrements ({src ? src.label.toLowerCase() : ''}) pour que ce graphique s’alimente.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2 bg-slate-50/60">
        <span className="text-[10px] text-slate-400 leading-none">
          {hasData ? `${fmtCount(res.records)} enreg. · ${res.points.length} ${res.points.length > 1 ? 'groupes' : 'groupe'}` : 'en attente de données'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button" onClick={() => onMove(idx, -1)} disabled={idx === 0} title="Déplacer à gauche"
            className="w-6 h-6 grid place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >◀</button>
          <button
            type="button" onClick={() => onMove(idx, +1)} disabled={idx === count - 1} title="Déplacer à droite"
            className="w-6 h-6 grid place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >▶</button>
          <button type="button" onClick={() => onEdit(item)} title="Modifier le graphique"
            className="w-6 h-6 grid place-items-center rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-700">✏️</button>
          <button type="button" onClick={() => onDuplicate(item)} title="Dupliquer"
            className="w-6 h-6 grid place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">⧉</button>
          <button type="button" onClick={() => onRemove(item)} title="Supprimer"
            className="w-6 h-6 grid place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600">🗑️</button>
        </div>
      </div>
    </div>
  );
};

/* ── Studio : fenêtre de création / édition d’un graphique ─────────────── */
const INPUT_CLS = 'w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm text-slate-800 bg-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const LABEL_CLS = 'block text-[10px] font-black uppercase tracking-wide text-slate-500 mb-1.5';

const BudgetModal = ({ item, rowsBySource, recettes, onCancel, onSave }) => {
  const editing = !!(item && item.id);
  const init = editing
    ? {
      title: item.title || '',
      source: item.source || 'depenses',
      chartType: item.chartType || 'pie',
      dimension: item.dimension || 'classification',
      measure: item.measure || 'montant',
      limit: Number(item.limit) || 10,
    }
    : { title: '', source: 'depenses', ...DEFAULT_FOR_SOURCE.depenses };
  const [draft, setDraft] = useState(init);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const changeSource = (src) => {
    const def = DEFAULT_FOR_SOURCE[src] || DEFAULT_FOR_SOURCE.depenses;
    setDraft((d) => ({ ...d, source: src, ...def }));
  };

  const dims = DIM_BY_SOURCE[draft.source] || [];
  const measures = MEASURE_BY_SOURCE[draft.source] || [];
  const preview = useMemo(
    () => computeChart(
      { title: draft.title, source: draft.source, chartType: draft.chartType, dimension: draft.dimension, measure: draft.measure, limit: draft.limit },
      rowsBySource,
      recettes,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, rowsBySource, recettes],
  );

  const submit = () => {
    const dim = findDim(draft.source, draft.dimension) || dims[0];
    const meas = findMeasure(draft.source, draft.measure) || measures[0];
    const c = {
      ...draft,
      chartType: draft.chartType || 'pie',
      dimension: dim ? dim.id : 'classification',
      measure: meas ? meas.id : 'montant',
      title: txt(draft.title) || autoTitle(draft),
    };
    onSave(c);
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shrink-0">
          <h2 className="text-lg font-black flex items-center gap-2">
            {editing ? '✏️ Modifier le graphique' : '＋ Nouveau graphique budget'}
          </h2>
          <p className="text-blue-100 text-xs mt-0.5">
            Camembert, barres ou courbe — sur les dépenses, lignes budgétaires, OM ou souhaits de la base.
            Le graphique est enregistré dans votre espace personnel « Budget overview ».
          </p>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar flex-1 grid grid-cols-1 md:grid-cols-[300px_1fr] gap-5">
          <div className="flex flex-col gap-3.5">
            <div>
              <label className={LABEL_CLS}>Titre du graphique</label>
              <input
                className={INPUT_CLS} value={draft.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder={autoTitle(draft)}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Source des données</label>
              <select className={INPUT_CLS} value={draft.source} onChange={(e) => changeSource(e.target.value)}>
                {Object.keys(SOURCE_META).map((k) => (
                  <option key={k} value={k}>{SOURCE_META[k].icon} {SOURCE_META[k].label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLS}>Type de graphique</label>
              <div className="grid grid-cols-3 gap-1.5">
                {CHART_TYPES.map((t) => (
                  <button
                    key={t.id} type="button" onClick={() => set('chartType', t.id)}
                    title={t.label}
                    className={`rounded-xl border px-2 py-2 text-center transition-colors ${
                      draft.chartType === t.id
                        ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    <span className="block text-base leading-none">{t.icon}</span>
                    <span className="block text-[9px] font-black uppercase tracking-wide mt-1">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={LABEL_CLS}>Regroupement</label>
              <select className={INPUT_CLS} value={draft.dimension} onChange={(e) => set('dimension', e.target.value)}>
                {dims.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Mesure</label>
              <select className={INPUT_CLS} value={draft.measure} onChange={(e) => set('measure', e.target.value)}>
                {measures.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Nombre max. de points affichés</label>
              <select className={INPUT_CLS} value={Number(draft.limit) || 0} onChange={(e) => set('limit', Number(e.target.value))}>
                <option value={0}>Tous</option>
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={40}>40</option>
                <option value={80}>80</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col min-h-[320px]">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2">
              Aperçu {preview && preview.points.length > 0 ? `· ${preview.points.length} ${preview.points.length > 1 ? 'points' : 'point'}` : ''}
            </div>
            {preview && preview.points.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2 flex-1 min-h-0 flex flex-col">
                <ChartBody res={preview} />
                {preview.cfg.chartType === 'pie' && <ChartLegend res={preview} />}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 flex-1 min-h-0 grid place-items-center p-6 text-center">
                <div>
                  <div className="text-2xl mb-2">🔍</div>
                  <p className="text-xs font-bold text-slate-500">Pas encore de données</p>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    {preview && preview.records === 0
                      ? 'Aucun enregistrement ne correspond à ce regroupement dans la base actuelle.'
                      : 'Ajoutez des montants ou changez le regroupement pour voir l’aperçu.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50 shrink-0">
          <p className="text-[11px] text-slate-400 min-w-0 truncate">
            {txt(draft.title) ? `Titre : « ${txt(draft.title)} »` : 'Titre auto : ' + autoTitle(draft)}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button" onClick={onCancel}
              className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100"
            >Annuler</button>
            <button
              type="button" onClick={submit}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700"
            >{editing ? 'Enregistrer les modifications' : 'Ajouter à mon tableau de bord'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Exemples prêts à l’emploi ─────────────────────────────────────────── */
const EXAMPLES = [
  {
    id: 'ex-classif', icon: '🧾', label: 'Dépenses par classification',
    hint: 'Camembert du montant (HT + port) par classification',
    cfg: { source: 'depenses', chartType: 'pie', dimension: 'classification', measure: 'montant', limit: 10, title: 'Dépenses par classification' },
  },
  {
    id: 'ex-ligne', icon: '📊', label: 'Dépenses par ligne budgétaire',
    hint: 'Barres du montant (HT + port) par ligne budgétaire',
    cfg: { source: 'depenses', chartType: 'bar', dimension: 'ligne', measure: 'montant', limit: 12, title: 'Dépenses par ligne budgétaire' },
  },
  {
    id: 'ex-op', icon: '👤', label: 'Dépenses par opérateur',
    hint: 'Camembert du montant par demandeur / porteur',
    cfg: { source: 'depenses', chartType: 'pie', dimension: 'demandeur', measure: 'montant', limit: 10, title: 'Dépenses par opérateur' },
  },
  {
    id: 'ex-mois', icon: '📈', label: 'Dépenses par mois',
    hint: 'Courbe mensuelle du montant (HT + port)',
    cfg: { source: 'depenses', chartType: 'line', dimension: 'mois', measure: 'montant', limit: 24, title: 'Dépenses par mois' },
  },
  {
    id: 'ex-annee', icon: '🗓️', label: 'Dépenses par année',
    hint: 'Barres annuelles du montant (HT + port)',
    cfg: { source: 'depenses', chartType: 'bar', dimension: 'annee', measure: 'montant', limit: 20, title: 'Dépenses par année' },
  },
  {
    id: 'ex-jour', icon: '🔍', label: 'Dépenses par jour',
    hint: 'Courbe journalière (40 derniers jours) du montant',
    cfg: { source: 'depenses', chartType: 'line', dimension: 'jour', measure: 'montant', limit: 40, title: 'Dépenses par jour' },
  },
  {
    id: 'ex-solde', icon: '⚖️', label: 'Solde par ligne budgétaire',
    hint: 'Barres du solde restant calculé de chaque ligne',
    cfg: { source: 'lignes', chartType: 'bar', dimension: 'ligne', measure: 'solde', limit: 12, title: 'Solde par ligne budgétaire' },
  },
  {
    id: 'ex-type', icon: '🏛️', label: 'Budgets par type',
    hint: 'Montants mis à disposition par type (Fonct. / Invest.)',
    cfg: { source: 'lignes', chartType: 'bar', dimension: 'type', measure: 'dispo', limit: 8, title: 'Budgets mis à disposition par type' },
  },
  {
    id: 'ex-om', icon: '✈️', label: 'OM par mois',
    hint: 'Barres des coûts totaux des ordres de mission par mois',
    cfg: { source: 'om', chartType: 'bar', dimension: 'mois', measure: 'montant', limit: 24, title: 'Coûts des missions par mois' },
  },
  {
    id: 'ex-des', icon: '🛒', label: 'Souhaits par urgence',
    hint: 'Camembert du montant estimé des souhaits par urgence',
    cfg: { source: 'desiderate', chartType: 'pie', dimension: 'urgence', measure: 'montant', limit: 8, title: 'Souhaits d’achat par urgence' },
  },
];

/* ── Page « Budget overview » ──────────────────────────────────────────── */
export const BudgetPage = () => {
  const { data, settings, updateSettings, currentUser } = useAdmin();
  const list = (k) => (Array.isArray(data[k]) ? data[k] : []);
  const recettes = list('recettes');
  const depenses = list('depenses');
  const om = list('om');
  const desiderate = list('desiderate');

  const rowsBySource = useMemo(() => ({
    depenses,
    lignes: buildLigneRows(recettes, depenses, om, desiderate),
    om,
    desiderate,
  }), [depenses, recettes, om, desiderate]);

  const store = (settings && settings[SAVE_KEY] && typeof settings[SAVE_KEY] === 'object')
    ? settings[SAVE_KEY]
    : {};
  const me = (currentUser && currentUser.id) ? String(currentUser.id) : 'invite';
  const meName = (currentUser && currentUser.name) ? currentUser.name : 'invité';
  const myCharts = Array.isArray(store[me]) ? store[me] : [];

  const persist = (next) => updateSettings({ [SAVE_KEY]: { ...store, [me]: next } });

  const [modal, setModal] = useState(null); // null | { item: Chart|null }
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(t);
  }, [notice]);

  const flash = (text) => setNotice(text);

  const saveChart = (draft) => {
    const now = Date.now();
    const existing = myCharts.find((c) => c.id === draft.id) || {};
    const clean = {
      id: draft.id || makeId(),
      title: txt(draft.title),
      source: draft.source,
      chartType: draft.chartType,
      dimension: draft.dimension,
      measure: draft.measure,
      limit: Number(draft.limit) || 0,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    const exists = myCharts.some((c) => c.id !== clean.id && cfgSignature(c) === cfgSignature(clean));
    if (exists) {
      setModal(null);
      flash('Ce graphique existe déjà dans votre tableau de bord (configurations identiques).');
      return;
    }
    const next = draft.id
      ? myCharts.map((c) => (c.id === clean.id ? clean : c))
      : [clean, ...myCharts];
    persist(next);
    setModal(null);
    flash(draft.id ? 'Graphique mis à jour ✓' : 'Graphique ajouté à votre tableau de bord ✓');
  };

  const removeChart = (item) => {
    if (!window.confirm(`Supprimer le graphique « ${item.title} » ?`)) return;
    persist(myCharts.filter((c) => c.id !== item.id));
    flash('Graphique supprimé.');
  };

  const duplicateChart = (item) => {
    const copy = {
      ...item,
      id: makeId(),
      title: `${item.title} (copie)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    persist([copy, ...myCharts]);
    flash('Graphique dupliqué ✓');
  };

  const moveChart = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= myCharts.length) return;
    const next = [...myCharts];
    const [a] = next.splice(idx, 1);
    next.splice(j, 0, a);
    persist(next);
  };

  const addExample = (ex) => {
    const exists = myCharts.some((c) => cfgSignature(c) === cfgSignature(ex.cfg));
    if (exists) {
      flash('Cet exemple est déjà présent sur votre tableau de bord.');
      return;
    }
    const now = Date.now();
    persist([{ ...ex.cfg, id: makeId(), title: ex.cfg.title, createdAt: now, updatedAt: now }, ...myCharts]);
    flash(`Exemple ajouté : « ${ex.cfg.title} » ✓`);
  };

  const rendered = useMemo(
    () => myCharts.map((cfg) => ({ cfg, res: computeChart(cfg, rowsBySource, recettes) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myCharts, rowsBySource, recettes],
  );

  const countLabel = rendered.length === 0
    ? 'Aucun graphique'
    : `${rendered.length} ${rendered.length > 1 ? 'graphiques' : 'graphique'}`;

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-4">

      {/* En-tête */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-3xl shrink-0" aria-hidden="true">💶</span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black text-slate-800">Budget overview</h2>
                <span className="text-[10px] font-black uppercase text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
                  espace personnel de {meName}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
                Composez vos propres graphiques de suivi budgétaire — camembert, barres ou courbe —
                puis enregistrez-les dans la base : dépenses (par classification, ligne budgétaire,
                opérateur, fournisseur, mois / année / jour…), soldes &amp; budgets des lignes
                (Recettes), OM et souhaits d’achat. Chaque membre retrouve son tableau de bord à
                l’ouverture de la page.
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-black text-blue-700">{rendered.length}</div>
            <div className="text-[10px] font-bold uppercase text-slate-400">{countLabel}</div>
          </div>
        </div>

        {/* Exemples en un clic */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2">
            ⚡ Exemples prêts à l’emploi — un clic pour les ajouter, puis modifiez-les librement
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.id} type="button" onClick={() => addExample(ex)} title={ex.hint}
                className="group flex items-center gap-1.5 bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors"
              >
                <span aria-hidden="true">{ex.icon}</span>
                <span>+ {ex.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Barre d’action */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400">
          Les graphiques sont recalculés en direct à partir des données de la base. Ils ne sont
          visibles que pour vous (enregistrés sous votre compte).
        </p>
        <button
          type="button"
          onClick={() => setModal({ item: null })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">＋</span> Créer un graphique
        </button>
      </div>

      {/* Notices */}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 shadow-sm">
          {notice}
        </div>
      )}

      {/* Grille des graphiques */}
      {rendered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-10 text-center">
          <div className="text-4xl mb-3">🥧📊📈</div>
          <h3 className="text-base font-black text-slate-700">Votre tableau de bord est vide</h3>
          <p className="text-sm text-slate-500 max-w-xl mx-auto mt-1 leading-relaxed">
            Cliquez sur un exemple ci-dessus pour le récupérer en un clic, ou ouvrez le studio avec
            « Créer un graphique » pour choisir la source, le type, le regroupement et la mesure.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
          {rendered.map(({ cfg, res }, idx) => (
            <ChartCard
              key={cfg.id}
              item={cfg} res={res} idx={idx} count={rendered.length}
              onEdit={(item) => setModal({ item })}
              onDuplicate={duplicateChart}
              onRemove={removeChart}
              onMove={moveChart}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        💾 Sauvegarde automatique : vos graphiques sont conservés dans cette base (datasets/&lt;id&gt;,
        payload `administration › settings › budgetCharts`). Pensez à alimenter les pages Dépenses,
        Recettes, OM et Spese Desiderate — les montants saisis y alimentent immédiatement ces graphiques.
      </p>

      {modal && (
        <BudgetModal
          item={modal.item}
          rowsBySource={rowsBySource}
          recettes={recettes}
          onCancel={() => setModal(null)}
          onSave={saveChart}
        />
      )}
    </div>
  );
};
