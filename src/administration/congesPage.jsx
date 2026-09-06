/* =========================================================================
   src/administration/congesPage.jsx
   Page « Congés », inspirée de l'onglet « Congés » du classeur Google Sheets
   du laboratoire (feuille Budget) : demandes par période, colonne « Jours »
   (jours ouvrés), « Notes » et « Approuvation ».

   Règles :
     • Page réservée aux profils Non permanent (le superutilisateur y accède
       pour approuver) ; les profils Permanent/Technique ne la voient pas.
     • Chaque membre Non permanent pose sa propre demande (statut « Demande ») —
       c'est d'ailleurs la SEULE page de ces profils.
     • Un membre Non permanent ne voit QUE ses propres demandes (tableau,
       soldes, statistiques) ; le superutilisateur, qui approuve, voit tout.

     • L'approbation (Approuvé / Refusé) est réservée au superutilisateur
       (même règle que le changement de statut des Spese Desiderate) ; une
       demande déjà traitée n'est plus modifiable par son auteur.
     • Seul le superutilisateur peut supprimer une demande de congés. Un
       membre peut en revanche modifier sa propre demande tant qu'elle n'a
       pas encore été traitée (statut « Demande »).
     • Dates stockées au format ISO (yyyy-mm-dd), affichées en jj/mm/aaaa.
     • « Jours » = jours ouvrés entre le 1er et le dernier jour inclus
       (week-ends + jours fériés français exclus), voir congesDates.js.
     • Soldes annuels : quota par profil (47 j par défaut pour un Doctorant,
       réglable dans Paramètres) sur la saison du 1er septembre → 31 août.
       Les jours des demandes approuvées qui tombent dans la saison en cours
       sont déduits du solde ; renouvellement automatique chaque 1er septembre.

   Modèle d'enregistrement (collection `conges`) :
     { demandeur, personnelId?, dateDebut, dateFin, jours, note, statut }
     statut ∈ CONGE_STATUSES = Demande / Approuvé / Refusé / Présence autorisée
     pendant fermeture. Les jours de fermeture UPJV de la saison sont décomptés
     d'office du quota annuel (règle du labo) ; une demande de congé ne consomme
     que ses jours ouvrés hors fermeture, et une ligne « Présence autorisée
     pendant fermeture » (superutilisateur) réintègre au solde les jours de
     fermeture travaillés avec autorisation.
   ========================================================================= */
import React, { useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import { businessDaysBetween, toFrDate, congeYearBounds, businessDaysInPeriod, closureDaysInSeason, closureDaysInPeriod, frenchHolidayList } from './congesDates';
import {
  CONGE_STATUSES, CONGE_DEMANDE, CONGE_APPROUVE, CONGE_REFUSE, CONGE_PRESENCE,
  CONGE_DEFAULT_ALLOWANCE, CONGE_QUOTA_BY_TYPE,
} from './adminSchema';

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const nameKey = (s) => {
  const k = norm(s);
  return k ? k.split(/\s+/).sort().join(' ') : '';
};
const sameName = (a, b) => !!a && !!b && nameKey(a) === nameKey(b);

const FR_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/* Petits éléments d'affichage (mêmes classes que les autres pages d'admin). */
const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-600',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
};
const Badge = ({ tone = 'slate', children }) => (
  <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${TONES[tone] || TONES.slate}`}>
    {children}
  </span>
);

const STATUS_TONE = {
  [CONGE_DEMANDE]: 'amber',
  [CONGE_APPROUVE]: 'emerald',
  [CONGE_REFUSE]: 'red',
  [CONGE_PRESENCE]: 'indigo',
};
const StatutBadge = ({ statut }) => {
  const s = txt(statut) || CONGE_DEMANDE;
  return <Badge tone={STATUS_TONE[s] || 'slate'}>{s}</Badge>;
};

/* ── Cartes de synthèse ─────────────────────────────────────────────────── */
const SummaryCard = ({ label, value, tone = 'slate', hint }) => {
  const tones = {
    slate: 'border-slate-200 text-slate-800',
    emerald: 'border-emerald-200 text-emerald-700',
    amber: 'border-amber-200 text-amber-700',
    red: 'border-red-200 text-red-600',
    blue: 'border-blue-200 text-blue-700',
    indigo: 'border-indigo-200 text-indigo-700',
  };
  return (
    <div className={`bg-white border rounded-2xl shadow-sm px-3 py-2.5 ${tones[tone] || tones.slate}`} title={hint || ''}>
      <div className="text-xl font-black leading-tight">{value}</div>
      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
};

export const CongesPage = () => {
  const { data, access, settings, upsert, remove, currentUser } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.conges) ? data.conges : []), [data.conges]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const [modal, setModal] = useState(null); // null | { mode:'new' } | { mode:'edit', rec }
  const [importOpen, setImportOpen] = useState(false);

  const isSuper = !!access.isSuperuser;
  const profilePerson = access.profile && access.profile.person ? access.profile.person : null;
  const meName = txt(profilePerson && profilePerson.nom ? profilePerson.nom : (currentUser && currentUser.name));

  const sorted = useMemo(
    () => [...list].sort((a, b) => String(b.dateDebut || '').localeCompare(String(a.dateDebut || ''))),
    [list]
  );

  const own = (r) => !!meName && sameName(meName, txt(r.demandeur));
  const pending = (r) => !txt(r.statut) || txt(r.statut) === CONGE_DEMANDE;
  const canEdit = (r) => isSuper || (own(r) && pending(r));
  const canDelete = () => isSuper; // seul le superutilisateur peut supprimer une demande

  /* Un membre Non permanent ne voit QUE ses propres demandes ; le
     superutilisateur (rôle d’approbation) voit toute la liste. */
  const visible = useMemo(
    () => (isSuper ? sorted : sorted.filter((r) => own(r))),
    // own() dépend de meName (recalculée à chaque rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuper, sorted, meName]
  );

  const summary = useMemo(() => {
    const b = congeYearBounds();
    let demandes = 0;
    let approuve = 0;
    let demande = 0;
    let presence = 0;
    const personnes = new Set();
    visible.forEach((r) => {
      demandes += 1;
      const k = norm(r.demandeur);
      if (k) personnes.add(k);
      const s = txt(r.statut);
      const joursTotal = businessDaysInPeriod(txt(r.dateDebut), txt(r.dateFin), b.start, b.end);
      const joursFermeture = closureDaysInPeriod(txt(r.dateDebut), txt(r.dateFin), b);
      if (s === CONGE_PRESENCE) { presence += joursFermeture; return; }
      if (s === CONGE_REFUSE) { /* demandes refusées : rien à décompter */ return; }
      // Demandes ordinaires : seuls les jours ouvrés HORS fermeture comptent
      // (les jours de fermeture sont déjà décomptés d'office des quotas).
      const joursOuvres = joursTotal - joursFermeture;
      if (s === CONGE_APPROUVE) approuve += joursOuvres;
      else demande += joursOuvres;
    });
    return {
      bounds: b,
      demandes,
      approuve,
      demande,
      presence,
      fermeture: closureDaysInSeason(b),
      personnes: personnes.size,
    };
  }, [visible]);

  /* ── Soldes annuels par demandeur ──────────────────────────────────────────
     Saison du 1er septembre au 31 août : les jours de fermeture UPJV de la
     saison (2 semaines de Noël + 4 semaines en juillet-août, jours ouvrés,
     fériés exclus) sont décomptés D'OFFICE du quota annuel du profil de la
     fiche Personnel liée (corps → type → « Par défaut » ; 47 j par défaut).
     Une demande de congé ordinaire ne consomme ensuite que ses jours ouvrés
     HORS fermeture ; une ligne « Présence autorisée pendant fermeture »
     réintègre au contraire au solde les jours de fermeture travaillés avec
     autorisation. Le calcul part de la date du jour : dès le 1er septembre,
     une nouvelle saison démarre donc automatiquement, sans compteur à
     réinitialiser. */
  const balances = useMemo(() => {
    const b = congeYearBounds();
    const fermeture = closureDaysInSeason(b);
    const conf = (settings && settings.congesQuotaByType && typeof settings.congesQuotaByType === 'object'
      && !Array.isArray(settings.congesQuotaByType))
      ? settings.congesQuotaByType
      : CONGE_QUOTA_BY_TYPE;
    const personByKey = new Map();
    personnel.forEach((p) => {
      const k = nameKey(txt(p && p.nom));
      if (k) personByKey.set(k, p);
    });
    const quotaOf = (person) => {
      if (person) {
        const c = txt(person.corps);
        const t = txt(person.type);
        const cand = (c && conf[c] !== undefined && conf[c] !== null)
          ? conf[c]
          : (t && conf[t] !== undefined && conf[t] !== null) ? conf[t] : undefined;
        const n = Number(cand);
        if (cand !== undefined && Number.isFinite(n)) return n;
      }
      const def = Number(conf['Par défaut']);
      return Number.isFinite(def) ? def : CONGE_DEFAULT_ALLOWANCE;
    };
    const map = new Map();
    const ensure = (name) => {
      const k = nameKey(txt(name));
      if (!k) return null;
      let e = map.get(k);
      if (!e) {
        const person = personByKey.get(k) || null;
        e = {
          key: k,
          name: txt(name),
          person,
          quota: quotaOf(person),
          fermeture,
          approved: 0,
          pending: 0,
          presence: 0,
          requests: [],
        };
        map.set(k, e);
      }
      return e;
    };
    sorted.forEach((r) => {
      const s = txt(r.statut);
      const presence = s === CONGE_PRESENCE;
      const approved = s === CONGE_APPROUVE;
      const isPending = !s || s === CONGE_DEMANDE;
      if (!presence && !approved && !isPending) return; // Refusé : ne consomme pas de jours
      const joursTotal = businessDaysInPeriod(txt(r.dateDebut), txt(r.dateFin), b.start, b.end);
      if (!joursTotal) return; // demande hors saison en cours → déjà soldée une autre année
      const joursFermeture = closureDaysInPeriod(txt(r.dateDebut), txt(r.dateFin), b);
      if (presence) {
        // Jours de fermeture travaillés avec autorisation → réintégrés au solde.
        if (joursFermeture <= 0) return;
        const e = ensure(txt(r.demandeur));
        if (!e) return;
        e.requests.push({ recId: r.id, presence: true, open: 0, closed: joursFermeture, hypothetical: false });
        e.presence += joursFermeture;
        return;
      }
      // Demande / congé approuvé : seuls les jours ouvrés HORS fermeture sont
      // consommés au-delà du pré-chargement des fermetures.
      const joursOuvres = joursTotal - joursFermeture;
      if (joursOuvres <= 0) return;
      const e = ensure(txt(r.demandeur));
      if (!e) return;
      e.requests.push({ recId: r.id, presence: false, open: joursOuvres, closed: joursFermeture, hypothetical: !approved });
      if (approved) e.approved += joursOuvres;
      else e.pending += joursOuvres;
    });
    if (!isSuper && meName) ensure(meName); // un non-permanent voit toujours sa propre carte
    const rows = [...map.values()].sort((a, b2) => a.name.localeCompare(b2.name, 'fr'));
    const after = new Map();
    rows.forEach((e) => {
      e.label = e.person ? (txt(e.person.corps) || txt(e.person.type) || 'Par défaut') : 'Par défaut';
      e.requests.forEach((x) => {
        // Droits restants = quota − fermeture UPJV + présences autorisées − congés approuvés.
        const base = e.quota - e.fermeture + e.presence - e.approved;
        after.set(x.recId, {
          presence: x.presence,
          closed: x.closed,
          days: x.presence ? x.closed : x.open,
          remainingAfter: x.hypothetical ? base - x.open : base,
        });
      });
    });
    return { bounds: b, fermeture, rows, after };
  }, [sorted, personnel, settings, meName, isSuper]);

  /* Cartes de soldes affichées : un non-permanent ne voit que sa propre carte. */
  const visibleBalances = useMemo(
    () => (isSuper ? balances.rows : balances.rows.filter((e) => e.key === nameKey(meName))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances.rows, isSuper, meName]
  );

  const suggestions = useMemo(() => {
    const set = new Set();
    personnel.forEach((p) => { const n = txt(p.nom); if (n) set.add(n); });
    sorted.forEach((r) => { const n = txt(r.demandeur); if (n) set.add(n); });
    if (meName) set.add(meName);
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [personnel, sorted, meName]);

  const findPersonId = (name) => {
    const key = nameKey(name);
    if (!key) return null;
    const found = personnel.find((p) => nameKey(txt(p.nom)) === key);
    return found ? found.id : null;
  };

  const onSave = (draft, existingId) => {
    const demandeur = txt(draft.demandeur);
    if (!demandeur) { alert('Merci de saisir le nom du demandeur.'); return; }
    const dateDebut = txt(draft.dateDebut);
    const dateFin = txt(draft.dateFin);
    if (!dateDebut || !dateFin) { alert('Précisez le premier jour et le dernier jour de congé.'); return; }
    if (dateDebut > dateFin) { alert('Le dernier jour doit être identique ou postérieur au premier jour.'); return; }
    const existing = existingId ? list.find((r) => r.id === existingId) : null;
    if (!isSuper && existing && !pending(existing)) {
      alert('Cette demande a déjà été traitée : seul le superutilisateur peut la modifier.');
      return;
    }
    let jours = (draft.jours === '' || draft.jours === null || draft.jours === undefined) ? null : toNum(draft.jours);
    if (!jours) jours = businessDaysBetween(dateDebut, dateFin);
    if (!jours) { alert('Nombre de jours invalide : renseignez un nombre ou vérifiez les dates.'); return; }
    const statut = !isSuper
      ? (existing ? txt(existing.statut) : CONGE_DEMANDE)
      : (txt(draft.statut) || CONGE_DEMANDE);
    upsert('conges', {
      demandeur,
      dateDebut,
      dateFin,
      jours,
      note: txt(draft.note),
      statut,
      personnelId: findPersonId(demandeur),
    }, existingId);
    setModal(null);
  };

  const decide = (rec, statut) => {
    if (isSuper && rec) upsert('conges', { statut }, rec.id);
  };

  const onRemove = (rec) => {
    if (!rec) return;
    if (!isSuper) return; // la suppression est réservée au superutilisateur
    const who = txt(rec.demandeur);
    if (!window.confirm(who ? `Supprimer la demande de congés de ${who} ?` : 'Supprimer cette demande de congés ?')) return;
    remove('conges', rec.id);
  };

  const DateCell = ({ iso }) => {
    const fr = toFrDate(iso);
    return fr ? <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{fr}</span> : <span className="text-slate-300">—</span>;
  };

  const columns = [
    {
      key: 'demandeur', label: 'Demandeur',
      value: (r) => txt(r.demandeur),
      display: (r) => {
        const name = txt(r.demandeur) || '—';
        const isMe = !isSuper && !!meName && sameName(meName, name);
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-slate-700 truncate">{name}</span>
            {isMe ? <Badge tone="blue">vous</Badge> : null}
          </div>
        );
      },
    },
    {
      key: 'dateDebut', label: 'Date initiale',
      value: (r) => txt(r.dateDebut),
      display: (r) => <DateCell iso={r.dateDebut} />,
    },
    {
      key: 'dateFin', label: 'Dernier jour',
      value: (r) => txt(r.dateFin),
      display: (r) => <DateCell iso={r.dateFin} />,
    },
    {
      key: 'jours', label: 'Jours', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => {
        const meta = balances.after.get(r.id);
        return meta ? meta.days : toNum(r.jours) || '';
      },
      display: (r) => {
        const meta = balances.after.get(r.id);
        if (!meta) {
          const n = toNum(r.jours);
          if (!n) return <span className="text-slate-300">—</span>;
          return <span className="whitespace-nowrap font-black text-slate-700">{n} j</span>;
        }
        if (meta.presence) {
          return (
            <div
              className="whitespace-nowrap text-right"
              title={`${meta.days} jour(s) ouvrés de fermeture UPJV couverts par cette présence autorisée, réintégrés au solde du membre (week-ends et fériés exclus).`}
            >
              <div className="font-black text-indigo-600">+{meta.days} j</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-indigo-500">reste {meta.remainingAfter} j</div>
            </div>
          );
        }
        const approved = txt(r.statut) === CONGE_APPROUVE;
        const overlap = meta.closed > 0;
        return (
          <div
            className="whitespace-nowrap text-right"
            title={(approved
              ? 'Jours ouvrés (hors fermeture UPJV) décomptés du solde — reste après déduction de tous les congés approuvés.'
              : 'Jours ouvrés (hors fermeture UPJV) qui seraient décomptés si cette demande était approuvée.')
              + (overlap ? ` Dont ${meta.closed} j de fermeture UPJV déjà couverts par le pré-chargement.` : '')}
          >
            <div className="font-black text-slate-700">{meta.days} j</div>
            <div className={`text-[9px] font-bold uppercase tracking-wide ${approved ? 'text-emerald-600' : 'text-amber-600'}`}>
              {approved ? `reste ${meta.remainingAfter} j` : `≈ reste ${meta.remainingAfter} j si approuvé`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'statut', label: 'Approuvation', filter: 'facet',
      value: (r) => txt(r.statut) || CONGE_DEMANDE,
      display: (r) => <StatutBadge statut={r.statut} />,
    },
    {
      key: 'note', label: 'Notes', filter: 'text',
      value: (r) => txt(r.note),
      display: (r) => (txt(r.note)
        ? <div className="text-[11px] text-slate-500 max-w-[260px] leading-snug">{r.note}</div>
        : <span className="text-slate-300">—</span>),
    },
    {
      key: 'actions', label: '', sortable: false, filterable: false, align: 'right', nowrap: true,
      value: () => '',
      display: (r) => {
        const editable = canEdit(r);
        const deletable = canDelete(r);
        const decidable = isSuper && pending(r);
        if (!editable && !deletable && !decidable) return <span className="text-slate-300 text-xs">—</span>;
        return (
          <div className="flex items-center gap-1 justify-end">
            {decidable && (
              <>
                <button
                  onClick={() => decide(r, CONGE_APPROUVE)} title="Approuver"
                  className="w-7 h-7 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 text-xs font-black"
                >✓</button>
                <button
                  onClick={() => decide(r, CONGE_REFUSE)} title="Refuser"
                  className="w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-black"
                >✗</button>
              </>
            )}
            {editable && (
              <button
                onClick={() => setModal({ mode: 'edit', rec: r })} title={isSuper ? 'Modifier' : 'Modifier ma demande'}
                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs"
              >✎</button>
            )}
            {deletable && (
              <button
                onClick={() => onRemove(r)} title="Supprimer (réservé au superutilisateur)"
                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs"
              >🗑</button>
            )}
          </div>
        );
      },
    },
  ];

  /* Jours fériés français de l’année en cours (bloc pédagogique sous le tableau). */
  const holidaysYear = new Date().getFullYear();
  const holidays = useMemo(() => frenchHolidayList(holidaysYear), [holidaysYear]);

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400">
          {isSuper ? (
            <>
              {visible.length} demande{visible.length > 1 ? 's' : ''} · {summary.personnes} personne{summary.personnes > 1 ? 's' : ''} concernée{summary.personnes > 1 ? 's' : ''} — l’approbation comme la suppression sont réservées au superutilisateur.
            </>
          ) : (
            <>
              Vos demandes de congés ({visible.length}) — l’approbation est réservée au superutilisateur et vous ne voyez que vos propres demandes.
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {isSuper && (
            <button
              onClick={() => setImportOpen(true)}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
              title="Importer les congés depuis la feuille Google Sheets (coller, CSV ou Excel)"
            >
              <span className="text-base leading-none">📥</span> Importer
            </button>
          )}
          <button
            onClick={() => setModal({ mode: 'new' })}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> Ajouter une demande
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <SummaryCard label="Demandes" value={summary.demandes} tone="slate" hint="Nombre total de lignes saisies (demandes + présences autorisées)." />
        <SummaryCard label="Personnes concernées" value={summary.personnes} tone="blue" hint="Nombre de demandeurs distincts." />
        <SummaryCard
          label="Jours approuvés (saison)"
          value={`${summary.approuve} j`}
          tone="emerald"
          hint={`Jours ouvrés approuvés hors fermeture UPJV, décomptés du solde sur la saison en cours (${summary.bounds.label}).`}
        />
        <SummaryCard
          label="Jours en attente (saison)"
          value={`${summary.demande} j`}
          tone="amber"
          hint={`Jours ouvrés hors fermeture UPJV des demandes « Demande » portant sur la saison en cours (${summary.bounds.label}).`}
        />
        <SummaryCard
          label="Fermeture UPJV (saison)"
          value={`−${summary.fermeture} j`}
          tone="blue"
          hint={`Jours ouvrés de fermeture UPJV de la saison (2 semaines de Noël + 4 semaines en juillet-août, week-ends et fériés exclus), décomptés d'office du quota de chaque membre — ${summary.bounds.label}.`}
        />
        <SummaryCard
          label="Présences fermeture"
          value={`+${summary.presence} j`}
          tone="indigo"
          hint={`Jours ouvrés de fermeture UPJV réintégrés au solde via les lignes « Présence autorisée pendant fermeture » visibles (${summary.bounds.label}).`}
        />
      </div>

      {visibleBalances.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
            <h3 className="text-sm font-black text-slate-700">🏝 Soldes de congés — saison {balances.bounds.label}</h3>
            <span className="text-[10px] font-bold text-slate-400">
              jours de fermeture UPJV décomptés d'office (−{balances.fermeture} j cette saison) · quota réglable par profil dans Setup · renouvelé chaque 1er septembre
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
            {visibleBalances.map((e) => {
              // Droits restants = quota − fermeture UPJV (pré-chargée) + jours de
              // présence autorisée en fermeture − congés approuvés (hors fermeture).
              const left = e.quota - e.fermeture + e.presence - e.approved;
              const negative = left < 0;
              const low = !negative && left <= 5;
              const cardTone = negative ? 'border-red-200' : low ? 'border-amber-200' : 'border-emerald-200';
              const numTone = negative ? 'text-red-600' : low ? 'text-amber-600' : 'text-emerald-600';
              return (
                <div
                  key={e.key}
                  className={`bg-white border rounded-2xl shadow-sm px-3 py-2.5 ${cardTone}`}
                  title={`${e.name} — quota ${e.quota} j annuels, dont ${e.fermeture} j de fermeture UPJV décomptés d'office ; ${e.approved} j approuvés hors fermeture${e.presence ? `, ${e.presence} j réintégrés par présence autorisée` : ''} → ${left} j restants (saison ${balances.bounds.label}).${e.pending ? ` ${e.pending} j en attente.` : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-700 truncate">{e.name}</span>
                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-slate-400">{e.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className={`text-2xl font-black leading-none ${numTone}`}>{left} j</span>
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">restants</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {e.approved} j approuvés / {e.quota} j · −{e.fermeture} j fermeture UPJV
                  </div>
                  <div className="text-[10px] mt-0.5">
                    {e.presence > 0 ? <span className="text-indigo-600 font-bold">+{e.presence} j présence fermeture</span> : null}
                    {e.presence > 0 && e.pending > 0 ? <span className="text-slate-300"> · </span> : null}
                    {e.pending > 0 ? <span className="text-amber-600 font-bold">{e.pending} j en attente</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>Fonctionnement :</b> chacun pose sa demande (statut « Demande »), un superutilisateur l’approuve ou la refuse. Un membre ne voit que ses propres demandes de congés, le superutilisateur voit toute la liste et approuve. Le solde de chaque membre est décompté en jours ouvrés sur la saison du
        1er septembre au 31 août (renouvelée automatiquement chaque 1er septembre), week-ends et fêtes nationales exclus. Les jours de fermeture UPJV de la saison (2 semaines de Noël + 4 semaines en juillet-août, jours ouvrés hors fériés) sont
        décomptés d’office du quota de chaque membre : une demande de congé ne consomme que ses jours ouvrés hors fermeture, et une ligne « Présence autorisée pendant fermeture » (superutilisateur) réintègre au solde les jours de fermeture travaillés avec autorisation.
        Quota par défaut : 47 jours pour un Doctorant, modulable par profil dans Setup › « Congés : jours/an par profil ».
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <h3 className="text-sm font-black text-slate-700">🎉 Jours fériés en France cette année</h3>
          <span className="text-[10px] font-bold text-slate-400">
            fêtes nationales françaises de métropole ({holidaysYear}) — exclues du décompte des jours ouvrés
          </span>
        </div>
        <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[11px] text-indigo-900 leading-relaxed">
          Fermeture UPJV retenue : 2 semaines de Noël (21 déc. → 3 janv.) + 4 semaines entre juillet et août (27 juil. → 23 août) — ajustable dans « congés » si les dates réelles changent.
          Le 14 juillet précède toujours la fermeture estivale et n'y tombe jamais ; les fêtes qui tombent pendant la fermeture (25/12, 01/01, 15/08…) ne sont jamais décomptées des jours de congés.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-1">
          {holidays.map((h) => {
            const d = new Date(`${h.iso}T00:00:00`);
            return (
              <div key={h.iso} className="flex items-baseline gap-2 rounded-lg px-1 py-0.5">
                <span className="text-[11px] font-black text-indigo-600 whitespace-nowrap tabular-nums">{toFrDate(h.iso)}</span>
                <span className="text-[10px] text-slate-400 w-14 capitalize whitespace-nowrap">{FR_WEEKDAYS[d.getDay()]}</span>
                <span className="text-xs font-semibold text-slate-700">{h.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">🏖️</div>
          <p className="font-black text-slate-700">
            {isSuper ? 'Aucune demande de congés pour le moment' : 'Aucune demande de congés à votre nom'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {isSuper
              ? 'Ajoutez la première demande via « + Ajouter une demande », ou importez l’onglet « Congés » de la feuille Google Sheets.'
              : 'Cliquez sur « + Ajouter une demande » pour poser votre premier congé — le formulaire est pré-rempli à votre nom.'}
          </p>
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={visible}
          minWidth="1180px"
          searchPlaceholder="Rechercher un demandeur, une note, un statut…"
          emptyLabel="Aucune demande de congés"
          noMatchLabel="Aucune demande ne correspond aux filtres."
        />
      )}

      {importOpen && <AdminImportModal kind="conges" onClose={() => setImportOpen(false)} />}

      {modal && (
        <CongeModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          defaultDemandeur={isSuper ? '' : meName}
          names={isSuper ? suggestions : [meName].filter(Boolean)}
          isSuper={isSuper}
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
};

/* ── Fenêtre d’ajout / édition d’une demande de congés ──────────────────── */
const CongeModal = ({ rec, defaultDemandeur, names, isSuper, onCancel, onSave }) => {
  const editing = !!rec;
  const [draft, setDraft] = useState(() => {
    if (rec) {
      return {
        demandeur: rec.demandeur || '',
        dateDebut: rec.dateDebut || '',
        dateFin: rec.dateFin || '',
        jours: rec.jours === null || rec.jours === undefined ? '' : String(rec.jours),
        note: rec.note || '',
        statut: rec.statut || CONGE_DEMANDE,
      };
    }
    return { demandeur: defaultDemandeur || '', dateDebut: '', dateFin: '', jours: '', note: '', statut: CONGE_DEMANDE };
  });
  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));

  const autoJours = () => {
    if (!draft.dateDebut || !draft.dateFin) { alert('Renseignez d’abord le premier et le dernier jour.'); return; }
    const n = businessDaysBetween(draft.dateDebut, draft.dateFin);
    if (n) setDraft((d) => ({ ...d, jours: String(n) }));
  };

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">{editing ? 'Modifier la demande de congés' : 'Nouvelle demande de congés'}</h2>
          <p className="text-blue-100 text-xs">
            « Jours » = jours ouvrés entre les deux dates incluses (week-ends et jours fériés exclus). Approbation réservée au superutilisateur.
          </p>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Demandeur</label>
            <input
              className={inputCls} value={draft.demandeur} onChange={set('demandeur')} list="conges-demandeurs"
              placeholder="Prénom Nom"
            />
            <datalist id="conges-demandeurs">
              {(names || []).map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>

          <div>
            <label className={labelCls}>Premier jour (date initiale)</label>
            <input className={inputCls} type="date" value={draft.dateDebut} onChange={set('dateDebut')} />
          </div>
          <div>
            <label className={labelCls}>Dernier jour de congé</label>
            <input className={inputCls} type="date" value={draft.dateFin} onChange={set('dateFin')} />
          </div>

          <div>
            <label className={labelCls}>Jours ouvrés</label>
            <div className="flex gap-2">
              <input
                className={inputCls} type="number" min="1" step="1" value={draft.jours} onChange={set('jours')}
                placeholder="ex. 5"
              />
              <button
                type="button" onClick={autoJours}
                className="shrink-0 px-3 py-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 text-xs font-bold"
                title="Calculer les jours ouvrés entre les deux dates"
              >≈ auto</button>
            </div>
          </div>

          <div>
            <label className={labelCls}>Statut (Approuvation)</label>
            {isSuper ? (
              <select className={inputCls} value={draft.statut} onChange={set('statut')}>
                {CONGE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <div className={`${inputCls} bg-slate-50 text-slate-500 flex items-center gap-2`}>
                <StatutBadge statut={draft.statut} />
                <span className="text-[10px]">décision réservée au superutilisateur</span>
              </div>
            )}
          </div>
          {isSuper && draft.statut === CONGE_PRESENCE && (
            <div className="sm:col-span-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-[11px] text-indigo-900 leading-relaxed">
              Ligne <b>« Présence autorisée pendant fermeture »</b> : ce n'est pas une demande de congé. Les jours ouvrés de la période couverts par la fermeture UPJV de la saison
              (week-ends et fériés exclus) sont <b>réintégrés au solde</b> du membre — à saisir quand une personne travaille pendant une fermeture avec autorisation.
            </div>
          )}

          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <textarea
              className={`${inputCls} min-h-[56px]`} value={draft.note} onChange={set('note')}
              placeholder="Éventuel commentaire visible par l’équipe…"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100"
          >Annuler</button>
          <button
            onClick={() => onSave(draft, editing ? rec.id : undefined)}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700"
          >Enregistrer la demande</button>
        </div>
      </div>
    </div>
  );
};
