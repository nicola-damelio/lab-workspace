/* =========================================================================
   src/components/AppModules/teamAccessPanel.jsx
   👥 ÉQUIPE & ACCÈS — SUR LA PAGE D'ACCUEIL, POUR LE SUPERUTILISATEUR.

   LE DÉFAUT RÉPARÉ ICI : les comptes (scientifiques, superutilisateur, mots de
   passe) se définissaient à DEUX endroits — les réglages d'un dataset
   scientifique (« Scientists / Operators ») et le Setup d'une base
   d'administration — alors que la liste est UNE (appConfig/global.operators,
   publiée au serveur de jetons). Deux portes pour une même liste, c'est deux
   occasions de croire qu'on a défini quelqu'un « dans ce dataset » : la
   définition de l'équipe n'appartient à AUCUN dataset, elle se fait donc là où
   l'on arrive — la page d'accueil — et seulement pour le superutilisateur
   (bootstrap excepté : sans superutilisateur défini, tout le monde doit
   pouvoir créer le premier compte, sinon il n'y a plus personne pour le faire).

   Ce qui est ICI vient donc des deux anciennes portes : les comptes et leurs
   mots de passe (`ScientistsOperatorsManager`), la publication vers le serveur
   de jetons (🛡️ Sécurité serveur), les demandes de mot de passe oublié, les
   réglages d'accès — PLUS la matrice « qui voit quel dataset »
   (datasetMembershipMatrix.jsx), qui répond à la question posée dans l'autre
   sens (« pour cette personne, quels datasets ? »).

   Ce qui N'EST PAS ici : « Mon compte » (changer SON mot de passe), qui reste
   dans les réglages de chaque base (MyAccountPanel), parce que c'est un geste
   personnel, pas la définition de l'équipe.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { normalizeOperators } from '../../utils/auth';
import { hasDefinedSuperuser } from '../../administration/adminSchema';
import { ScientistsOperatorsManager } from './definitionsManagers';
import { DatasetMembershipMatrix } from './datasetMembershipMatrix';
import { membershipSummary } from '../../utils/datasetMembership';

export const TeamAccessPanel = ({
  operators = [],
  setOperators,
  authSettings,
  setAuthSettings,
  currentUser = null,
  /* Les fiches Personnel (liaison compte ↔ fiche, qui détermine les pages
     d'administration visibles). Elles vivent dans les bases d'administration :
     le panneau les reçoit par `onLoadPersonnel` (App.jsx les relit), sinon il
     se contente de ce qui est déjà en mémoire. */
  personnel = [],
  onLoadPersonnel = null,
  serverMode = false,
  datasets = [],
  onSaveAccess = null,
}) => {
  const team = useMemo(() => normalizeOperators(operators), [operators]);
  const isSuper = !!currentUser && currentUser.role === 'superuser';
  /* Bootstrap : aucun superutilisateur défini → le panneau est ouvert à tous,
     comme l'était le Setup (sinon la première équipe ne peut plus être créée). */
  const bootstrap = !hasDefinedSuperuser(team);
  const allowed = isSuper || bootstrap;
  const [open, setOpen] = useState(() => bootstrap);
  const [fiches, setFiches] = useState(() => (Array.isArray(personnel) ? personnel : []));

  /* Les fiches Personnel ne sont lues qu'à l'OUVERTURE : la page d'accueil n'a
     pas à lire les bases d'administration pour qui ne gère pas l'équipe. */
  useEffect(() => {
    if (!open || typeof onLoadPersonnel !== 'function') return undefined;
    let alive = true;
    Promise.resolve(onLoadPersonnel())
      .then((list) => { if (alive && Array.isArray(list) && list.length) setFiches(list); })
      .catch(() => { /* hors ligne : la liste connue suffit */ });
    return () => { alive = false; };
  }, [open, onLoadPersonnel]);

  if (!allowed) return null;

  const summary = membershipSummary(datasets, team);

  return (
    <section className="bg-white rounded-2xl shadow-xl border border-slate-200 mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 md:px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-white to-blue-50/60">
        <span className="text-2xl" aria-hidden="true">👥</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base md:text-lg font-black text-slate-800">Équipe &amp; accès</h2>
          <p className="text-[11px] text-slate-500 leading-snug">
            Les comptes, leurs mots de passe et les datasets de chacun — définis <b>une seule fois, ici</b>.
            {isSuper ? ' Vous êtes connecté(e) comme superutilisateur.' : ' ⚠️ Aucun superutilisateur défini : créez-le ci-dessous.'}
          </p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            {team.length} compte(s) · {summary.accounts} membre(s) · {summary.datasets} dataset(s)
            {summary.restricted > 0 && ` · ${summary.restricted} restreint(s)`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-3 py-2 transition-colors"
        >
          {open ? '▲ Masquer' : '▼ Afficher / modifier'}
        </button>
      </div>

      {open && (
        <div className="p-4 md:p-6 flex flex-col gap-6">
          <ScientistsOperatorsManager
            operators={operators}
            setOperators={setOperators}
            authSettings={authSettings}
            setAuthSettings={setAuthSettings}
            currentUser={currentUser}
            personnel={fiches}
            serverMode={serverMode}
          />
          <div className="border-t border-slate-200 pt-5">
            <DatasetMembershipMatrix
              datasets={datasets}
              operators={team}
              onSaveAccess={onSaveAccess}
            />
          </div>
        </div>
      )}
    </section>
  );
};
