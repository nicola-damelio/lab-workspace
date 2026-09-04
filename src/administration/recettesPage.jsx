/* =========================================================================
   src/administration/recettesPage.jsx
   Page « Recettes » — lignes budgétaires.
   Chaque ligne : type Fonctionnement / Investissement, porteur, budget total,
   montant mis à disposition par l’université, dépenses déjà ordonnées
   (BC signés), ordres de mission (acceptés / à prévoir), souhaits d’achat
   liés, solde calculé, date de fin d’engagement et commentaires.
   Les agrégats sont calculés depuis les collections depenses / om /
   desiderate de la même base (liaison par recetteId / recetteSuggereeId).
   ========================================================================= */
import React, { useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { RECETTE_TYPES, DEPENSE_BC_SIGNE } from './adminSchema';
import { AdminImportModal } from './adminImportModal';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const asDate = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 10) : '');

export const RecettesPage = () => {
  const { data, settings, upsert, remove } = useAdmin();
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  const desiderate = useMemo(() => (Array.isArray(data.desiderate) ? data.desiderate : []), [data.desiderate]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);

  const [modal, setModal] = useState(null);
  const [importOpen, setImportOpen] = useState(false); // {mode:'new'} | {mode:'edit', rec} | {mode:'link', rec}

  const types = Array.isArray(settings.recetteTypes) && settings.recetteTypes.length
    ? settings.recetteTypes
    : RECETTE_TYPES;

  const personName = (idOrName) => {
    if (!idOrName) return '';
    const found = personnel.find((p) => p.id === idOrName);
    return found ? (found.nom || '') : String(idOrName);
  };

  const aggFor = (rec) => {
    const recId = rec && rec.id;
    const isSigned = (d) => String(d.statut || '').trim() === DEPENSE_BC_SIGNE;
    const lineDepenses = depenses.filter((d) => d.recetteId === recId);
    const engages = lineDepenses.filter(isSigned);
    const engTotal = engages.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    const lineOm = om.filter((o) => o.recetteId === recId && String(o.statut || 'En attente').trim() !== 'Refusée');
    const omTotal = lineOm.reduce((s, o) => s + toNum(o.coutTotal), 0);
    const lineDes = desiderate.filter((d) => d.recetteSuggereeId === recId && String(d.statut || '').trim() !== 'Rejected / Pas maintenant');
    const desApprouvees = lineDes.filter((d) => String(d.statut || '').trim() === 'Approved');
    const desMontant = desApprouvees.reduce((s, d) => s + toNum(d.montantEstime), 0);
    const budgetRendu = rec.budgetRenduDispo !== undefined && rec.budgetRenduDispo !== null && rec.budgetRenduDispo !== ''
      ? toNum(rec.budgetRenduDispo)
      : toNum(rec.budgetTotal);
    const solde = budgetRendu - engTotal - omTotal - desMontant;
    return {
      lineDepenses, engages, engTotal,
      lineOm, omEnAttente: lineOm.filter((o) => String(o.statut || 'En attente').trim() === 'En attente'),
      omAcceptees: lineOm.filter((o) => String(o.statut || '').trim() === 'Acceptée'),
      omTotal,
      lineDes, desApprouvees, desMontant,
      budgetRendu, solde,
    };
  };

  const totals = useMemo(() => {
    let budgetTotal = 0; let budgetRendu = 0; let eng = 0; let omTot = 0; let des = 0; let solde = 0;
    recettes.forEach((r) => {
      const a = aggFor(r);
      budgetTotal += toNum(r.budgetTotal);
      budgetRendu += a.budgetRendu;
      eng += a.engTotal; omTot += a.omTotal; des += a.desMontant;
      solde += a.solde;
    });
    return { budgetTotal, budgetRendu, eng, omTot, des, solde };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recettes, depenses, om, desiderate]);

  const onSaveLine = (patch, existingId) => {
    if (!String(patch.ligne || '').trim()) { alert('Merci de donner un intitulé à la ligne budgétaire.'); return; }
    const cleaned = {
      ...patch,
      ligne: String(patch.ligne || '').trim(),
      type: patch.type || types[0],
      porteur: String(patch.porteur || '').trim(),
      budgetTotal: patch.budgetTotal === '' || patch.budgetTotal === null || patch.budgetTotal === undefined
        ? null : toNum(patch.budgetTotal),
      budgetRenduDispo: patch.budgetRenduDispo === '' || patch.budgetRenduDispo === null || patch.budgetRenduDispo === undefined
        ? null : toNum(patch.budgetRenduDispo),
      dateFinEngagement: asDate(patch.dateFinEngagement),
      notes: String(patch.notes || ''),
    };
    upsert('recettes', cleaned, existingId);
    setModal(null);
  };

  const onRemoveLine = (rec) => {
    if (window.confirm(`Supprimer la ligne budgétaire « ${rec.ligne || rec.id} » ?`)) remove('recettes', rec.id);
  };

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      {/* Barre d’actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden="true"></span>
          Chaque ligne affiche ses montants et les éléments liés — survolez une case pour le détail.
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          title="Importer depuis la feuille Google Sheets : Lignes budgétaires, Dépenses (BC/SIFAC), OMs, Souhaités (coller, CSV ou Excel)"
        >
          <span className="text-base leading-none">📥</span> Importer
        </button>
        <button
          onClick={() => setModal({ mode: 'new' })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span> Nouvelle ligne budgétaire
        </button>
      </div>

      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <SummaryCard label="Budget total" value={totals.budgetTotal} tone="slate" />
        <SummaryCard label="Mis à disposition (univ.)" value={totals.budgetRendu} tone="blue" />
        <SummaryCard label="Engagé (BC signés)" value={totals.eng} tone="amber" />
        <SummaryCard label="OM acceptées / en attente" value={totals.omTot} tone="violet" />
        <SummaryCard label="Desiderata actés (estimé)" value={totals.des} tone="teal" />
        <SummaryCard label="Solde restant" value={totals.solde} tone={totals.solde < 0 ? 'red' : 'emerald'} />
      </div>

      {/* Table des lignes budgétaires */}
      {recettes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">📈</div>
          <p className="font-black text-slate-700">Aucune ligne budgétaire pour le moment</p>
          <p className="text-sm text-slate-400 mt-1">
            Créez une première ligne (Fonctionnement ou Investissement) pour commencer le suivi du budget.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[1280px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="px-3 py-2.5">Ligne budgétaire</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Porteur</th>
                <th className="px-3 py-2.5 text-right">Budget total</th>
                <th className="px-3 py-2.5 text-right">Dispo université</th>
                <th className="px-3 py-2.5 text-right">Engagé · BC signés</th>
                <th className="px-3 py-2.5 text-right">OM (acc. / att.)</th>
                <th className="px-3 py-2.5 text-right">Desiderata</th>
                <th className="px-3 py-2.5 text-right">Solde</th>
                <th className="px-3 py-2.5">Fin d’engagement</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {recettes.map((rec) => {
                const a = aggFor(rec);
                return (
                  <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50/60 align-top">
                    <td className="px-3 py-2.5 min-w-[190px]">
                      <div className="font-bold text-slate-800 leading-snug">{rec.ligne || rec.id}</div>
                      {rec.notes ? (
                        <div className="text-[11px] text-slate-400 italic max-w-[220px] line-clamp-2" title={rec.notes}>{rec.notes}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        String(rec.type || types[0]) === 'Investissement'
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      }`}>
                        {rec.type || types[0]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{personName(rec.porteur) || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">{rec.budgetTotal === null || rec.budgetTotal === undefined || rec.budgetTotal === '' ? '—' : euro.format(toNum(rec.budgetTotal))}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-blue-700 whitespace-nowrap">{euro.format(a.budgetRendu)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <HoverCell
                        amount={a.engTotal}
                        badge={a.engages.length}
                        hint="avec BC signé"
                        items={a.engages.map((d) => ({
                          title: d.description || 'Dépense',
                          meta: [d.bcNo || d.sifacNo || '', d.dateSignatureBC || ''].filter(Boolean).join(' · '),
                          value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
                        }))}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <HoverCell
                        amount={a.omTotal}
                        badge={a.lineOm.length}
                        hint={`${a.omAcceptees.length} acceptée(s) · ${a.omEnAttente.length} en attente`}
                        items={a.lineOm.map((o) => ({
                          title: o.description || o.destination || 'OM',
                          meta: [o.destination || '', o.statut || 'En attente'].filter(Boolean).join(' · '),
                          value: euro.format(toNum(o.coutTotal)),
                        }))}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <HoverCell
                        amount={a.desMontant}
                        badge={a.lineDes.length}
                        hint={`${a.desApprouvees.length} approuvée(s)`}
                        items={a.lineDes.map((d) => ({
                          title: d.description || 'Desiderata',
                          meta: [d.demandeur || '', d.statut || 'Pending'].filter(Boolean).join(' · '),
                          value: d.montantEstime !== undefined && d.montantEstime !== null && d.montantEstime !== ''
                            ? euro.format(toNum(d.montantEstime))
                            : 'non chiffré',
                        }))}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <span className={`font-black ${a.solde < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{euro.format(a.solde)}</span>
                      <HoverNote note={`Solde = dispo université ${euro.format(a.budgetRendu)} − BC signés ${euro.format(a.engTotal)} − OM ${euro.format(a.omTotal)} − desiderata approuvés ${euro.format(a.desMontant)}`} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{rec.dateFinEngagement || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setModal({ mode: 'link', rec })} title="Lier dépenses / OM / desiderata"
                          className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">🔗</button>
                        <button onClick={() => setModal({ mode: 'edit', rec })} title="Modifier"
                          className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">✎</button>
                        <button onClick={() => onRemoveLine(rec)} title="Supprimer"
                          className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && <AdminImportModal kind="recettes" onClose={() => setImportOpen(false)} />}

      {modal && <LineModal
        modal={modal} types={types} personnel={personnel}
        depenses={depenses} om={om} desiderate={desiderate}
        onCancel={() => setModal(null)} onSave={onSaveLine}
      />}
    </div>
  );
};

/* ── Cartes de synthèse ─────────────────────────────────────────────────── */
const SummaryCard = ({ label, value, tone }) => {
  const tones = {
    slate: 'border-slate-200 text-slate-800',
    blue: 'border-blue-200 text-blue-700',
    amber: 'border-amber-200 text-amber-700',
    violet: 'border-violet-200 text-violet-700',
    teal: 'border-teal-200 text-teal-700',
    emerald: 'border-emerald-200 text-emerald-700',
    red: 'border-red-200 text-red-600',
  };
  return (
    <div className={`bg-white border rounded-2xl shadow-sm px-3 py-2.5 ${tones[tone] || tones.slate}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70 leading-tight">{label}</div>
      <div className="text-lg font-black mt-0.5 truncate">{euro.format(value)}</div>
    </div>
  );
};

/* ── Cases à détail au survol ───────────────────────────────────────────── */
const HoverCell = ({ amount, badge, hint, items }) => (
  <div className="group relative inline-block text-right">
    <div className="font-bold text-slate-800 whitespace-nowrap">{euro.format(amount)}</div>
    <div className="text-[10px] text-slate-400">
      {badge > 0 ? `${badge} élément${badge > 1 ? 's' : ''}` : 'aucun'}
      {hint ? ` · ${hint}` : ''}
    </div>
    <div className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 max-h-64 overflow-y-auto custom-scrollbar bg-white border border-slate-200 rounded-xl shadow-2xl p-2">
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-400 px-2 py-1">Aucun élément lié à cette ligne.</p>
      ) : items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-2 px-2 py-1.5 border-b border-slate-100 last:border-0">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-700 truncate">{it.title}</div>
            {it.meta ? <div className="text-[10px] text-slate-400 truncate">{it.meta}</div> : null}
          </div>
          <div className="text-xs font-bold text-slate-800 whitespace-nowrap">{it.value}</div>
        </div>
      ))}
    </div>
  </div>
);

const HoverNote = ({ note }) => (
  <div className="group relative inline-block ml-1 cursor-help">
    <span className="text-[10px] text-slate-300 group-hover:text-blue-500">ⓘ</span>
    <span className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-72 bg-slate-800 text-white text-[11px] leading-snug rounded-lg px-3 py-2 shadow-xl">
      {note}
    </span>
  </div>
);

/* ── Fenêtre modale : création / édition d’une ligne budgétaire ─────────── */
const LineModal = ({ modal, types, personnel, depenses, om, desiderate, onCancel, onSave }) => {
  const editing = modal.mode === 'edit';
  const [draft, setDraft] = useState(() => {
    if (editing && modal.rec) {
      const r = modal.rec;
      return {
        ligne: r.ligne || '',
        type: r.type || '',
        porteur: r.porteur || '',
        budgetTotal: r.budgetTotal === null || r.budgetTotal === undefined ? '' : String(r.budgetTotal),
        budgetRenduDispo: r.budgetRenduDispo === null || r.budgetRenduDispo === undefined ? '' : String(r.budgetRenduDispo),
        dateFinEngagement: r.dateFinEngagement || '',
        notes: r.notes || '',
      };
    }
    return { ligne: '', type: '', porteur: '', budgetTotal: '', budgetRenduDispo: '', dateFinEngagement: '', notes: '' };
  });
  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
  const persons = [...new Set((personnel || []).map((p) => p.nom).filter(Boolean))];

  if (modal.mode === 'link') {
    return <LinkLineModal modal={modal} depenses={depenses} om={om} desiderate={desiderate} onCancel={onCancel} />;
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">{editing ? 'Modifier la ligne budgétaire' : 'Nouvelle ligne budgétaire'}</h2>
          <p className="text-blue-100 text-xs">Le solde est recalculé automatiquement depuis les Dépenses, OM et Desiderata liés.</p>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Intitulé / projet de la ligne</label>
            <input className={inputCls} value={draft.ligne} onChange={set('ligne')} placeholder="ex. ANR — Chimie bioinorganique" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={draft.type} onChange={set('type')}>
              {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Porteur du projet</label>
            <input className={inputCls} list="recette-porteurs" value={draft.porteur} onChange={set('porteur')} placeholder="choisir ou saisir" />
            <datalist id="recette-porteurs">
              {persons.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Budget total (€)</label>
            <input className={inputCls} type="number" min="0" step="0.01" value={draft.budgetTotal} onChange={set('budgetTotal')} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Mis à disposition par l’université (€)</label>
            <input className={inputCls} type="number" min="0" step="0.01" value={draft.budgetRenduDispo} onChange={set('budgetRenduDispo')} placeholder="vide = budget total" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Date de fin d’engagement</label>
            <input className={inputCls} type="date" value={draft.dateFinEngagement} onChange={set('dateFinEngagement')} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Commentaires</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={draft.notes} onChange={set('notes')} placeholder="Financeur, numéro de projet, échéances…" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">Annuler</button>
          <button onClick={() => onSave(draft, editing ? modal.rec.id : undefined)}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700">Enregistrer la ligne</button>
        </div>
      </div>
    </div>
  );
};
/* ── Fenêtre modale : lier des éléments existants à la ligne ────────────── */
const LinkLineModal = ({ modal, depenses, om, desiderate, onCancel }) => {
  const { upsert } = useAdmin();
  const recId = modal.rec && modal.rec.id;
  const [checked, setChecked] = useState(() => {
    const set = new Set();
    (depenses || []).forEach((d) => { if (d.recetteId === recId) set.add(`depenses:${d.id}`); });
    (om || []).forEach((o) => { if (o.recetteId === recId) set.add(`om:${o.id}`); });
    (desiderate || []).forEach((x) => { if (x.recetteSuggereeId === recId) set.add(`desiderate:${x.id}`); });
    return set;
  });

  const toggle = (key) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const applyLink = () => {
    const nowSelected = (kind, id) => checked.has(`${kind}:${id}`);
    (depenses || []).forEach((d) => {
      const target = nowSelected('depenses', d.id);
      if (target !== (d.recetteId === recId)) upsert('depenses', { recetteId: target ? recId : null }, d.id);
    });
    (om || []).forEach((o) => {
      const target = nowSelected('om', o.id);
      if (target !== (o.recetteId === recId)) upsert('om', { recetteId: target ? recId : null }, o.id);
    });
    (desiderate || []).forEach((x) => {
      const target = nowSelected('desiderate', x.id);
      if (target !== (x.recetteSuggereeId === recId)) upsert('desiderate', { recetteSuggereeId: target ? recId : null }, x.id);
    });
    onCancel();
  };

  const group = (title, icon, items, sub) => (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-2">
        <span>{icon}</span>{title}
        <span className="ml-auto text-slate-400">{(items || []).length}</span>
      </div>
      <div className="max-h-44 overflow-y-auto custom-scrollbar">
        {(items || []).length === 0 ? (
          <p className="text-[11px] text-slate-400 px-3 py-2">{sub || 'Aucun élément.'}</p>
        ) : items.map((it) => (
          <label key={it.id} className="flex items-start gap-2 px-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-blue-50/50">
            <input
              type="checkbox"
              checked={checked.has(`${title === 'Dépenses (BC)' ? 'depenses' : title === 'Ordres de mission' ? 'om' : 'desiderate'}:${it.id}`)}
              onChange={() => toggle(`${title === 'Dépenses (BC)' ? 'depenses' : title === 'Ordres de mission' ? 'om' : 'desiderate'}:${it.id}`)}
              className="mt-0.5 accent-blue-600"
            />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-slate-700 truncate">{it.description || it.destination || it.ligne || it.id}</span>
              <span className="block text-[10px] text-slate-400 truncate">
                {title === 'Dépenses (BC)' ? `${it.demandeur || ''} · ${it.bcNo || 'sans BC'}` : title === 'Ordres de mission' ? `${it.destination || ''} · ${it.statut || 'En attente'}` : `${it.demandeur || ''} · ${it.statut || 'Pending'}`}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">Lier des éléments à la ligne</h2>
          <p className="text-blue-100 text-xs">Ligne : « {modal.rec.ligne || modal.rec.id} » — cochez les Dépenses (BC), OM ou Desiderata imputés sur ce budget.</p>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {group('Dépenses (BC)', '🧾', depenses)}
          {group('Ordres de mission', '✈️', om)}
          {group('Desiderata', '🛒', desiderate)}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">Fermer</button>
          <button onClick={applyLink} className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700">Enregistrer les liaisons</button>
        </div>
      </div>
    </div>
  );
};





