/* =========================================================================
   src/components/AppModules/definitionsManagers.jsx
   Definitions managers (CustomMetadataFields, MandatoryParameters,
   Scientists/Operators, ScientistLoginGate/Modal) extracted from App.jsx.
   ========================================================================= */

import React, {useState, useEffect, useCallback} from 'react';
import { normalizeOperators, hashPassword } from '../../utils/auth';
import { Icon } from '../Icons';
import { SPECIAL_PAGES, CUSTOM_FIELD_TAB_OPTIONS, getSubsectionsForPage } from '../../data/specialPages';
import {
  authServerBase, fetchAuthStatus, publishAccounts, serverAdminToken, setServerAdminToken,
  serverChangePassword
} from '../../utils/labAuth';
/* 🔑 « I forgot my password » — la demande est un RECORD daté (voir
   utils/passwordResets.js) et l'e-mail aux superutilisateurs le canal qui
   traverse les postes (sendAdminMail : Gmail du compte connecté, sinon le relais
   du serveur, sinon un lien mailto: pré-rempli — jamais un envoi silencieux). */
import {
  loadPasswordResets, requestPasswordReset, openResets, closePasswordReset,
  resetRequestText, resetMailSubject, describeResetOutcome
} from '../../utils/passwordResets';
import { sendAdminMail, superuserEmailsOf, summarizeMail, buildMailto } from '../../administration/emailNotify';
/* 👥 La tombe d'un compte retiré (voir utils/teamAccounts.js) : écrite AVANT la
   liste, elle voyage avec elle et empêche un autre poste de republier le compte. */
import { removeOperatorRecord, reviveOperator } from '../../utils/teamAccounts';

export const CustomMetadataFieldsManager = ({ customFields = [], setCustomFields }) => {
  const [draft, setDraft] = useState({
    name: '',
    type: 'text',
    options: '',
    appliesTo: 'all',
    subsection: ''
  });

  const draftSubsections = draft.appliesTo === 'all' ? [] : getSubsectionsForPage(draft.appliesTo);

  const addField = () => {
    const name = draft.name.trim();

    if (!name) {
      alert('Please enter a field name.');
      return;
    }

    const options =
      draft.type === 'select'
        ? draft.options
            .split(',')
            .map((opt) => opt.trim())
            .filter(Boolean)
        : [];

    const newField = {
      id: `custom_field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: draft.type,
      options,
      appliesTo: draft.appliesTo || 'all',
      subsection: draft.appliesTo === 'all' ? '' : draft.subsection || ''
    };

    setCustomFields((prev) => [...(Array.isArray(prev) ? prev : []), newField]);

    setDraft({
      name: '',
      type: 'text',
      options: '',
      appliesTo: 'all',
      subsection: ''
    });
  };

  const updateField = (id, patch) => {
    setCustomFields((prev) =>
      (Array.isArray(prev) ? prev : []).map((field) =>
        field.id === id ? { ...field, ...patch } : field
      )
    );
  };

  const removeField = (id) => {
    setCustomFields((prev) =>
      (Array.isArray(prev) ? prev : []).filter((field) => field.id !== id)
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 uppercase mb-3">
        Custom Metadata Fields
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Field Name
          </label>

          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Instrument"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Type
          </label>

          <select
            value={draft.type}
            onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="textarea">Textarea</option>
            <option value="select">Select</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Options, comma separated
          </label>

          <input
            type="text"
            value={draft.options}
            onChange={(e) => setDraft((prev) => ({ ...prev, options: e.target.value }))}
            disabled={draft.type !== 'select'}
            placeholder={draft.type === 'select' ? 'e.g. Low, Medium, High' : 'N/A'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Special Page
          </label>

          <select
            value={draft.appliesTo}
            onChange={(e) => setDraft((prev) => ({ ...prev, appliesTo: e.target.value, subsection: '' }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {CUSTOM_FIELD_TAB_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Subsection
          </label>

          <select
            value={draft.subsection}
            onChange={(e) => setDraft((prev) => ({ ...prev, subsection: e.target.value }))}
            disabled={draft.appliesTo === 'all'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">General (anywhere on the page)</option>
            {draftSubsections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-1 flex items-end">
          <button
            type="button"
            onClick={addField}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-2 rounded-lg text-sm shadow-sm transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {(Array.isArray(customFields) ? customFields : []).length === 0 ? (
          <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
            No custom metadata fields defined.
          </div>
        ) : (
          (Array.isArray(customFields) ? customFields : []).map((field) => {
            const scopeValue = Array.isArray(field.appliesTo)
              ? field.appliesTo[0] || 'all'
              : field.appliesTo || 'all';
            const fieldSubsections = scopeValue === 'all' ? [] : getSubsectionsForPage(scopeValue);

            return (
              <div
                key={field.id || field.name}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Field Name
                    </label>

                    <input
                      type="text"
                      value={field.name || ''}
                      onChange={(e) => updateField(field.id, { name: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Type
                    </label>

                    <select
                      value={field.type || 'text'}
                      onChange={(e) => updateField(field.id, { type: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="textarea">Textarea</option>
                      <option value="select">Select</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Options
                    </label>

                    <input
                      type="text"
                      value={(field.options || []).join(', ')}
                      onChange={(e) =>
                        updateField(field.id, {
                          options: e.target.value
                            .split(',')
                            .map((opt) => opt.trim())
                            .filter(Boolean)
                        })
                      }
                      disabled={field.type !== 'select'}
                      placeholder={field.type === 'select' ? 'Comma separated options' : 'N/A'}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Special Page
                    </label>

                    <select
                      value={scopeValue}
                      onChange={(e) => updateField(field.id, { appliesTo: e.target.value, subsection: '' })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
                    >
                      {CUSTOM_FIELD_TAB_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Subsection
                    </label>

                    <select
                      value={field.subsection || ''}
                      onChange={(e) => updateField(field.id, { subsection: e.target.value })}
                      disabled={scopeValue === 'all'}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">General</option>
                      {fieldSubsections.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-3 rounded-lg text-sm transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/* =========================================================
   MANDATORY PARAMETERS MANAGER
   Rules are scoped to a special page (or "all") + an optional named
   subsection of that page. Each special page also gets its own
   behavior setting for what happens when one of its mandatory fields
   is left blank: show a warning, block the page, or don't check at all.
========================================================= */
export const MANDATORY_BEHAVIOR_OPTIONS = [
  { value: 'warning', label: 'Warning banner only' },
  { value: 'block', label: 'Block the page until filled in' },
  { value: 'deactivate', label: 'Deactivate (do not check)' }
];

export const MandatoryParametersManager = ({
  mandatoryRules = [],
  setMandatoryRules,
  mandatoryBehavior = {},
  setMandatoryBehavior
}) => {
  const [draft, setDraft] = useState({ page: 'all', subsection: '', fieldName: '' });

  const draftSubsections = draft.page === 'all' ? [] : getSubsectionsForPage(draft.page);

  const addRule = () => {
    const fieldName = draft.fieldName.trim();

    if (!fieldName) {
      alert('Please enter the exact field name to require.');
      return;
    }

    const newRule = {
      id: `mandatory_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      page: draft.page,
      subsection: draft.page === 'all' ? '' : draft.subsection,
      fieldName
    };

    setMandatoryRules((prev) => [...(Array.isArray(prev) ? prev : []), newRule]);
    setDraft((prev) => ({ ...prev, fieldName: '' }));
  };

  const removeRule = (id) => {
    setMandatoryRules((prev) => (Array.isArray(prev) ? prev : []).filter((r) => r.id !== id));
  };

  const setBehaviorForPage = (page, value) => {
    setMandatoryBehavior((prev) => ({ ...(prev || {}), [page]: value }));
  };

  const pageLabel = (page) =>
    page === 'all' ? 'All special pages' : (SPECIAL_PAGES.find((p) => p.value === page)?.label || page);

  const subsectionLabel = (page, subId) => {
    if (!subId) return 'General (any part of the page)';
    return getSubsectionsForPage(page).find((s) => s.id === subId)?.label || subId;
  };

  return (
    <div>
      <h3 className="text-sm font-bold text-slate-700 uppercase mb-1">Mandatory Parameters</h3>
      <p className="text-xs text-slate-500 mb-4">
        Define fields that must be filled in before a special page is considered complete — optionally
        scoped to one exact subsection of that page. Then choose, per page, what happens if one is left blank.
      </p>

      {/* Per-page behavior */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {SPECIAL_PAGES.map((p) => (
          <div
            key={p.value}
            className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50"
          >
            <span className="text-sm font-bold text-slate-700">{p.label}</span>

            <select
              value={mandatoryBehavior[p.value] || 'warning'}
              onChange={(e) => setBehaviorForPage(p.value, e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500"
            >
              {MANDATORY_BEHAVIOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Add rule form */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Special Page</label>

          <select
            value={draft.page}
            onChange={(e) => setDraft({ page: e.target.value, subsection: '', fieldName: draft.fieldName })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            <option value="all">All special pages</option>
            {SPECIAL_PAGES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subsection</label>

          <select
            value={draft.subsection}
            onChange={(e) => setDraft((prev) => ({ ...prev, subsection: e.target.value }))}
            disabled={draft.page === 'all'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">General (any part of the page)</option>
            {draftSubsections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Field Name</label>

          <input
            type="text"
            value={draft.fieldName}
            onChange={(e) => setDraft((prev) => ({ ...prev, fieldName: e.target.value }))}
            placeholder='e.g. "Operator", "Solvent", or a Custom Metadata Field name'
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2 flex items-end">
          <button
            type="button"
            onClick={addRule}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div className="flex flex-col gap-2">
        {(!mandatoryRules || mandatoryRules.length === 0) ? (
          <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
            No mandatory parameters defined yet.
          </div>
        ) : (
          mandatoryRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 bg-white shadow-sm"
            >
              <div className="text-sm">
                <span className="font-bold text-slate-800">{rule.fieldName}</span>
                <span className="text-slate-400"> — </span>
                <span className="text-slate-600">{pageLabel(rule.page)}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-slate-600">{subsectionLabel(rule.page, rule.subsection)}</span>
              </div>

              <button
                type="button"
                onClick={() => removeRule(rule.id)}
                className="text-red-500 hover:text-red-700 font-bold text-sm px-2"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

/* =========================================================
   SÉCURITÉ SERVEUR — l'équipe doit être publiée sur le serveur de
   jetons (server/token-server.js) pour que celui-ci puisse vérifier
   les mots de passe et signer les jetons que les règles Firestore
   exigent. ⚠️ Publier AVANT de fermer les règles (docs/SECURITY-SETUP.md).
========================================================= */
const ServerSecurityPanel = ({ operators }) => {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState(() => serverAdminToken());
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => setStatus(await fetchAuthStatus());
  React.useEffect(() => { refresh(); }, []);

  const publish = async () => {
    setBusy(true); setMessage(''); setOk(false);
    setServerAdminToken(token);
    const res = await publishAccounts(normalizeOperators(operators), token);
    setOk(!!res.ok);
    /* `staleIgnored` : fiche(s) dont l'empreinte publiée est plus ancienne que
       celle du serveur (la personne a changé son mot de passe depuis) — le
       serveur a gardé la sienne, et il faut le DIRE (sinon le refus serait
       silencieux). */
    const stale = Array.isArray(res.staleIgnored) ? res.staleIgnored : [];
    setMessage(res.ok
      ? `${res.accounts} compte(s) publié(s) — ${res.withPassword} avec mot de passe.`
        + (stale.length
          ? ` ⚠️ Ignoré pour ${stale.join(', ')} : un mot de passe plus récent est déjà enregistré sur le serveur`
            + ' (changement fait par la personne elle-même dans « Mon compte »). Il faudrait le connaître pour le remplacer ici.'
          : '')
      : (res.message || 'Publication impossible.'));
    setBusy(false);
    refresh();
  };

  const list = normalizeOperators(operators);
  const withoutPassword = list.filter((o) => !o.passwordHash).length;
  const accounts = status ? status.accounts : null;

  return (
    <div className="border-t border-slate-200 pt-5">
      <h3 className="text-sm font-bold text-sky-700 uppercase mb-3 flex items-center gap-2">
        🛡️ Sécurité serveur — vérification des mots de passe
      </h3>

      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 mb-3 flex flex-col gap-1">
        <span>
          Serveur : <b className="text-slate-700">{authServerBase() || 'non configuré'}</b>
        </span>
        {!status && <span className="text-slate-400">État du serveur : vérification…</span>}
        {status && !status.ok && (
          <span className="text-amber-700">⚠️ Serveur injoignable ({status.message || status.error})</span>
        )}
        {status && status.ok && (
          <span>
            Signature de jetons : <b className={status.configured ? 'text-emerald-700' : 'text-red-600'}>
              {status.configured ? 'configurée' : 'non configurée (FIREBASE_SERVICE_ACCOUNT manquant)'}
            </b>
            {' · '}Équipe publiée : <b className="text-slate-700">{accounts} compte(s)</b>
            {' · '}Publication par l’app : <b className={status.adminPushEnabled ? 'text-emerald-700' : 'text-red-600'}>
              {status.adminPushEnabled ? 'autorisée' : 'désactivée (ADMIN_TOKEN manquant)'}
            </b>
          </span>
        )}
      </div>

      <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">
        Jeton administrateur du serveur (ADMIN_TOKEN)
      </label>
      <div className="flex gap-2 mb-2">
        <input
          type="password"
          value={token}
          onChange={(e) => { setToken(e.target.value); setMessage(''); }}
          placeholder="ADMIN_TOKEN défini au déploiement du serveur"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <button
          onClick={publish}
          disabled={busy || !list.length}
          className={`font-bold text-sm px-4 py-2 rounded-lg shadow-sm transition-colors ${
            busy ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-sky-600 hover:bg-sky-700 text-white'
          }`}
        >
          {busy ? '⏳ Publication…' : '⬆ Publier les comptes'}
        </button>
      </div>

      {message && (
        <p className={`text-xs mb-2 ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {ok ? '✅' : '⛔'} {message}
        </p>
      )}
      {withoutPassword > 0 && (
        <p className="text-xs text-amber-700 mb-2">
          ⚠️ {withoutPassword} fiche(s) sans mot de passe : leur connexion sera refusée par le serveur.
        </p>
      )}
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Le serveur ne reçoit que les noms, les rôles et les empreintes des mots de passe — jamais un
        mot de passe en clair. Les empreintes sont renforcées (PBKDF2 + sel) dès la première connexion
        réussie de chaque personne. Publiez cette liste <b>avant</b> de coller
        <code className="mx-1 px-1 bg-slate-100 rounded">firestore.rules</code> dans la Console Firebase.
      </p>
    </div>
  );
};

/* =========================================================
   MON COMPTE — LE GESTE PERSONNEL, SÉPARÉ DE LA DÉFINITION DE L'ÉQUIPE.

   Ce bloc vivait DANS ScientistsOperatorsManager (un « if » en tête qui
   remplaçait toute la page pour un compte non superutilisateur). Depuis que la
   définition de l'équipe a déménagé sur la page d'accueil (teamAccessPanel.jsx,
   superutilisateur seulement), « changer MON mot de passe » ne pouvait plus
   rester là : c'est le seul geste d'authentification que TOUT LE MONDE doit
   pouvoir faire, depuis les réglages de la base où il travaille. Ce composant
   est donc monté dans les DEUX réglages (dataset scientifique et Setup d'une
   base d'administration), pour tout compte connecté.

   Rien d'autre n'a changé : le mot de passe est remplacé par le SERVEUR de
   jetons quand l'authentification serveur est active (POST
   /api/auth/change-password, qui exige l'ancien mot de passe), la copie locale
   suit, et « 🔑 I forgot my password » reste le seul recours quand il est
   oublié (la demande est enregistrée et notifiée aux superutilisateurs — voir
   utils/passwordResets.js).
   ========================================================= */
export const MyAccountPanel = ({
  operators = [],
  setOperators,
  currentUser = null,
  personnel = null,
  serverMode = false,
}) => {
  const personnelList = Array.isArray(personnel) ? personnel : [];
  /* L'entrée de la personne CONNECTÉE dans la liste locale (c'est elle qui
     porte le hash que le serveur a durci) ; à défaut, l'identité du compte
     connecté — un compte publié au serveur peut ne pas figurer dans cette
     copie du navigateur, et le changement de mot de passe reste possible
     (c'est le serveur qui le vérifie et l'enregistre). */
  const selfServiceOp = currentUser
    ? (normalizeOperators(operators).find((op) => op.id === currentUser.id)
      || { id: currentUser.id, name: currentUser.name, role: currentUser.role || 'user', passwordHash: '' })
    : null;
  const [selfPw, setSelfPw] = useState('');
  const [selfPwConfirm, setSelfPwConfirm] = useState('');
  const [selfCurrentPw, setSelfCurrentPw] = useState('');
  const [selfSaving, setSelfSaving] = useState(false);
  const [selfMsg, setSelfMsg] = useState('');

  /* Le serveur de jetons ANNONCE les routes qu'il connaît (/api/auth/status →
     « authChangePassword »). Un déploiement ANTÉRIEUR à POST
     /api/auth/change-password ne l'annonce pas : la requête retombe alors sur
     l'échange de jeton et répond « Unknown grant_type "" » ou 404 not_found —
     message inquiétant et surtout TROMPEUR, puisque l'ancien mot de passe
     continue d'être accepté partout. On le dit donc AVANT la saisie (le bouton
     reste inactif), au lieu de laisser croire que le mot de passe a changé.
     Après un redéploiement du serveur : « Recheck » (ou recharger la page). */
  const [serverChangePwOk, setServerChangePwOk] = useState(null);
  const checkChangePwSupport = useCallback(async () => {
    if (!serverMode) { setServerChangePwOk(null); return; }
    const st = await fetchAuthStatus();
    setServerChangePwOk(!!st.changePasswordEnabled);
  }, [serverMode]);
  useEffect(() => { checkChangePwSupport(); }, [checkChangePwSupport]);

  /* Changement de mot de passe par la personne elle-même.
     ⚠️ En mode serveur, les mots de passe sont vérifiés PAR LE SERVEUR : écrire
     le nouveau hash seulement dans cette liste ne servait à rien — le serveur
     gardait l'ancien, refusait le nouveau et continuait d'accepter l'ancien
     (« le changement n'a aucun effet »). L'app ne peut pas publier la liste à sa
     place (POST /api/auth/accounts exige le jeton administrateur, réservé au
     superutilisateur) : elle appelle donc POST /api/auth/change-password, qui
     exige l'ANCIEN mot de passe. Le serveur d'abord, la copie locale ensuite. */
  const saveSelfPassword = async () => {
    const op = selfServiceOp;
    if (!op) return;
    if (!selfPw) { setSelfMsg('⚠️ Enter a new password.'); return; }
    if (selfPw !== selfPwConfirm) { setSelfMsg('⚠️ Passwords do not match.'); return; }
    if (serverMode && !selfCurrentPw) { setSelfMsg('⚠️ Enter your current password.'); return; }
    if (serverMode && serverChangePwOk === false) {
      setSelfMsg('⚠️ The lab token server is an OLDER build: it does not know POST /api/auth/change-password yet, so no new password can be registered there. Redeploy server/token-server.js first (server/README.md).');
      return;
    }
    setSelfSaving(true); setSelfMsg('');
    if (serverMode) {
      const res = await serverChangePassword(op.name, selfCurrentPw, selfPw);
      if (!res.ok) {
        setSelfSaving(false);
        setSelfMsg(`⚠️ ${res.message}`);
        return;
      }
    }
    const hash = await hashPassword(selfPw);
    if (typeof setOperators === 'function') {
      setOperators((prev) => normalizeOperators(prev).map((o) =>
        op.id === o.id ? { ...o, passwordHash: hash } : o
      ));
    }
    setSelfPw(''); setSelfPwConfirm(''); setSelfCurrentPw('');
    setSelfSaving(false);
    setSelfMsg(serverMode
      ? '✅ Password changed — the lab server accepts it from now on.'
      : '✅ Password updated successfully.');
    setTimeout(() => setSelfMsg(''), 4000);
  };

  if (!selfServiceOp) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-700 uppercase">My Account</h3>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          Connectez-vous pour changer votre mot de passe (la barre latérale porte le bouton
          « 🔑 Sign In »). La définition des comptes de l'équipe se fait, elle, sur la page
          d'accueil → 👥 Équipe &amp; accès (superutilisateur).
        </p>
      </div>
    );
  }


  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase">My Account</h3>
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
        selfServiceOp.role === 'superuser' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'
      }`}>
        <span className="text-lg">{selfServiceOp.role === 'superuser' ? '👑' : '🧪'}</span>
        <div>
          <p className="font-bold text-slate-800">{selfServiceOp.name}</p>
          <p className="text-xs text-slate-500 capitalize">{selfServiceOp.role}</p>
        </div>
      </div>
      <div>
        {/* Serveur plus ancien que cette fonctionnalité : le dire AVANT la
            saisie. Sinon l'échec (« Unknown grant_type "" ») arrive après coup
            et laisse croire que le mot de passe a été changé alors que le
            serveur continue d'accepter l'ancien. */}
        {serverMode && serverChangePwOk === false && (
          <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
            ⚠️ The lab token server (
            <code className="px-1 bg-amber-100 rounded break-all">{authServerBase()}</code>
            ) is an <b>older build</b>: it does not know{' '}
            <code className="px-1 bg-amber-100 rounded">POST /api/auth/change-password</code>, so a new password cannot be
            registered there and signing in would keep accepting the old one. Redeploy{' '}
            <code className="px-1 bg-amber-100 rounded">server/token-server.js</code> (see server/README.md), then{' '}
            <button type="button" onClick={checkChangePwSupport} className="underline font-bold">Recheck</button>.
          </div>
        )}
        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Change My Password</h4>
        <div className="flex flex-col gap-2">
          {serverMode && (
            <input type="password" value={selfCurrentPw} onChange={(e) => setSelfCurrentPw(e.target.value)}
              autoComplete="current-password"
              placeholder="Current password"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full" />
          )}
          <input type="password" value={selfPw} onChange={(e) => setSelfPw(e.target.value)}
            autoComplete="new-password"
            placeholder="New password"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full" />
          <input type="password" value={selfPwConfirm} onChange={(e) => setSelfPwConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="Confirm new password"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full" />
          <button onClick={saveSelfPassword} disabled={selfSaving || (serverMode && serverChangePwOk === false)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50 w-full">
            {selfSaving ? 'Saving…' : 'Update Password'}
          </button>
          {selfMsg && <p className="text-xs text-center mt-1">{selfMsg}</p>}
          {/* 🔑 Celui qui a OUBLIÉ son mot de passe ne peut pas le changer :
              en mode serveur l'ancien est exigé, et personne ne peut lire le
              nouveau. C'est donc exactement ici qu'il faut pouvoir DEMANDER
              une réinitialisation — demande enregistrée (le superutilisateur
              la voit) et envoyée par e-mail. */}
          <div className="mt-1 pt-3 border-t border-slate-100 text-center flex flex-col items-center gap-1">
            <PasswordResetRequest
              operators={operators}
              personnel={personnelList}
              defaultName={selfServiceOp.name}
            />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              A superuser can set a new password for you (page d&apos;accueil → 👥 Équipe &amp; accès → ✏️ →
              New password → Save): nobody, not even a superuser, can read the current one.
            </p>
          </div>
          {serverMode && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Passwords are checked by the <b>lab token server</b>: your current password is required and the new
              one is registered there immediately — the old password stops working in every browser.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export const ScientistsOperatorsManager = ({
  operators = [],
  setOperators,
  authSettings,
  setAuthSettings,
  currentUser,
  personnel = null,
  /* Vrai quand les connexions passent par le serveur de jetons : c'est LUI qui
     vérifie les mots de passe (voir server/token-server.js), donc c'est SA copie
     qu'il faut remplacer — un changement écrit seulement ici n'aurait aucun
     effet sur la connexion. */
  serverMode = false,
}) => {
  const [draft, setDraft] = useState({ name: '', surname: '', role: 'user', password: '', personnelId: '' });
  const [editingId, setEditingId] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('user');
  const [editPersonnelId, setEditPersonnelId] = useState('');
  const [saving, setSaving] = useState(false);

  const isSuperuser = currentUser?.role === 'superuser';
  // Bootstrap: if no superuser exists yet, allow anyone to define roles
  const hasSuperuserDefined = normalizeOperators(operators).some((op) => op.role === 'superuser');
  const canManage = isSuperuser || !hasSuperuserDefined;

  // Liaison compte ↔ fiche Personnel de la base d’administration ouverte.
  // Une fiche est retrouvée par id (liaison manuelle) ou par nom.
  const personnelList = Array.isArray(personnel) ? personnel : [];
  const nameKey = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const ficheOf = (op) => {
    if (!personnelList.length || !op) return null;
    if (op.personnelId) {
      const byId = personnelList.find((p) => p && p.id === op.personnelId);
      if (byId) return byId;
    }
    const wantedTokens = nameKey(op.name).split(/\s+/).sort().join(' ');
    if (!wantedTokens) return null;
    return personnelList.find((p) => {
      const nk = nameKey(p && p.nom);
      return nk && (nk === wantedTokens || nk.split(/\s+/).sort().join(' ') === wantedTokens);
    }) || null;
  };
  const accessOf = (fiche) => {
    const t = String(fiche && fiche.type || '').toLowerCase();
    const corps = String(fiche && fiche.corps || '').trim();
    const nonPerm = /temporaire|cdd|post.?doc|ater|doctorant|stagiaire|vacataire|contractuel|stage/i.test(t);
    let statut = '';
    if (fiche) statut = nonPerm ? 'Non permanent'
      : (t || corps) ? 'Permanent'
      : 'Non permanent';
    // Fonctions : tableau (nouveau) ou ancienne valeur unique / séparée.
    const rawF = fiche && fiche.fonction;
    const items = Array.isArray(rawF) ? rawF : (typeof rawF === 'string' && rawF.trim() ? rawF.split(/[;|,/]+/) : []);
    const fonctions = items
      .map((s) => String(s || '').trim())
      .filter((c) => c === 'AP' || c === 'Gestionnaire' || c === 'Achats');
    return { statut, fonctions };
  };

  const addOperator = async () => {
    const fullName = `${draft.name.trim()} ${draft.surname.trim()}`.trim();
    if (!fullName) { alert('Please enter scientist name and/or surname.'); return; }
    if (operators.some((op) => op.name.toLowerCase() === fullName.toLowerCase())) {
      alert('Scientist already exists.'); return;
    }
    if (!draft.password) { alert('Please set a password for this scientist.'); return; }
    setSaving(true);
    const hash = await hashPassword(draft.password);
    setSaving(false);
    const newOp = {
      id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      name: fullName,
      role: draft.role,
      passwordHash: hash,
      personnelId: draft.personnelId || null,
    };
    /* 🔁 RECRÉER la personne LÈVE sa tombe (voir utils/teamAccounts.js) : sans
       cela, un autre poste qui ne connaît que la suppression laisserait le
       nouveau compte de côté à la prochaine fusion. */
    try { reviveOperator(newOp); } catch { /* magasin indisponible */ }
    setOperators((prev) => [...normalizeOperators(prev), newOp].sort((a, b) => a.name.localeCompare(b.name)));
    setDraft({ name: '', surname: '', role: 'user', password: '', personnelId: '' });
  };

  const removeOperator = (id) => {
    /* 🗑 LA SUPPRESSION EST UNE DONNÉE, ET ELLE S'ÉCRIT AVANT LA LISTE (voir
       utils/teamAccounts.js) : c'est ce record qui empêche un poste resté plus
       ancien — qui détient encore le compte — de le republier au prochain
       enregistrement. */
    const gone = normalizeOperators(operators).find((op) => op.id === id) || null;
    if (gone) { try { removeOperatorRecord(gone); } catch { /* magasin indisponible */ } }
    setOperators((prev) => normalizeOperators(prev).filter((op) => op.id !== id));
  };

  const startEdit = (op) => {
    setEditingId(op.id);
    setEditRole(op.role);
    setEditPersonnelId(op.personnelId || '');
    setEditPassword('');
  };

  const saveEdit = async (id) => {
    setSaving(true);
    const hash = editPassword ? await hashPassword(editPassword) : null;
    setSaving(false);
    /* 🔁 RÉÉDITER la personne vaut comme un retour volontaire : sa tombe est
       levée (voir utils/teamAccounts.js) — sinon une suppression faite ailleurs
       la laisserait hors de la prochaine fusion, alors qu'on vient de lui
       écrire ici. */
    const current = normalizeOperators(operators).find((op) => op.id === id) || null;
    if (current) { try { reviveOperator(current); } catch { /* magasin indisponible */ } }
    setOperators((prev) =>
      normalizeOperators(prev).map((op) => {
        if (op.id !== id) return op;
        return {
          ...op,
          role: canManage ? editRole : op.role,
          personnelId: canManage ? (editPersonnelId || null) : op.personnelId,
          ...(hash ? { passwordHash: hash } : {}),
        };
      })
    );
    setEditingId(null);
  };

  const normalizedOps = normalizeOperators(operators);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-6">
      {/* En mode serveur, seuls les mots de passe REÇUS PAR LE SERVEUR sont
          vérifiés à la connexion, et les publier exige le jeton administrateur.
          Sans ce jeton dans ce navigateur, tout ce qui est saisi ici (ajouts,
          remplacements de mots de passe) reste local : le serveur garde les
          anciens, et les connexions continuent avec eux. */}
      {serverMode && !serverAdminToken() && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
          ⚠️ Server sign-in is active but no admin token is stored in this browser: password changes made here are
          <b> not sent</b> to the token server, so everyone keeps signing in with the previous password. Open
          <b> 🛡️ Server security</b> below and paste the <code className="px-1 bg-amber-100 rounded">ADMIN_TOKEN</code> to
          publish the team.
        </div>
      )}


      {/* 🔑 Les demandes de réinitialisation enregistrées SUR CE POSTE : elles
          apparaissent juste avant la liste, là où le superutilisateur change les
          mots de passe (✏️). */}
      <PasswordResetRequestsPanel />

      {/* 🔑 Et pour un superutilisateur qui a lui-même oublié son mot de passe
          (deux superutilisateurs, le second pose le nouveau) : le même
          formulaire, ici — sans quitter la page où il change les mots de passe. */}
      <div className="text-center">
        <PasswordResetRequest
          operators={operators}
          personnel={personnelList}
          triggerLabel="🔑 I forgot my password (ask another superuser)"
        />
      </div>

      {/* ── ADD SCIENTIST (superuser / bootstrap only) ── */}
      {canManage && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label>
            <input type="text" value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addOperator(); }}
              placeholder="e.g. Marie"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Surname</label>
            <input type="text" value={draft.surname}
              onChange={(e) => setDraft((p) => ({ ...p, surname: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addOperator(); }}
              placeholder="e.g. Curie"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
            <input type="password" value={draft.password}
              onChange={(e) => setDraft((p) => ({ ...p, password: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addOperator(); }}
              placeholder="Required"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Role</label>
            <select value={draft.role} onChange={(e) => setDraft((p) => ({ ...p, role: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white">
              <option value="user">User</option>
              <option value="superuser">Superuser</option>
            </select>
          </div>
          <div className="md:col-span-2 flex items-end">
            <button type="button" onClick={addOperator} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Scientist'}
            </button>
          </div>

          {personnelList.length > 0 && (
            <div className="md:col-span-12">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Linked personnel record (admin access)</label>
              <select
                value={draft.personnelId || ''}
                onChange={(e) => setDraft((p) => ({ ...p, personnelId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white">
                <option value="">— Not linked (minimal access) —</option>
                {personnelList.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

        {/* ── SCIENTIST LIST ── */}
        <div className="flex flex-col gap-2">
          {!canManage && (
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 italic">
              👁️ Read-only — log in as a superuser to manage scientists and passwords.
            </div>
          )}
          {normalizedOps.length === 0 ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              No scientists/operators defined.
            </div>
          ) : (
            normalizedOps.map((op) => (
              <div key={op.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
                  op.role === 'superuser'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                <span className="text-lg">{op.role === 'superuser' ? '👑' : '🧪'}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-slate-800">{op.name}</span>
                  <span className={`ml-2 text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                    op.role === 'superuser' ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {op.role === 'superuser' ? 'Superuser' : 'User'}
                  </span>
                  {canManage && (op.passwordHash ? (
                    <span className="ml-2 text-[10px] text-emerald-600">🔐 Password set</span>
                  ) : (
                    <span className="ml-2 text-[10px] text-red-500">⚠️ No password</span>
                  ))}
                  {personnelList.length > 0 && canManage && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {editingId === op.id ? (
                        <select
                          value={editPersonnelId || ''}
                          onChange={(e) => setEditPersonnelId(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 max-w-[280px]"
                          title="Fiche Personnel qui détermine l’accès aux pages d’administration"
                        >
                          <option value="">— Aucune fiche liée —</option>
                          {personnelList.map((p) => (
                            <option key={p.id} value={p.id}>{p.nom}</option>
                          ))}
                        </select>
                      ) : (() => {
                        const fiche = ficheOf(op);
                        if (!fiche && op.role === 'superuser') return null;
                        if (!fiche) {
                          return <span className="text-[10px] italic text-slate-400">Aucune fiche Personnel liée → accès minimal (✏️ pour lier)</span>;
                        }
                        const acc = accessOf(fiche);
                        const foncCls = (code) => (code === 'AP'
                          ? 'bg-violet-50 text-violet-700 border-violet-200'
                          : code === 'Achats'
                            ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200');
                        return (
                          <>
                            <span className="text-[10px] font-semibold text-slate-500">👤 {fiche.nom}</span>
                            {acc.statut && (
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${acc.statut === 'Permanent' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{acc.statut}</span>
                            )}
                            {acc.fonctions && acc.fonctions.map((code) => (
                              <span key={code} className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${foncCls(code)}`}>
                                {code === 'Achats' ? 'Resp. achats' : code}
                              </span>
                            ))}
                            {acc.fonctions && acc.fonctions.length === 0 && (
                              <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-400">Aucune fonction</span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Edit controls — only for canManage users */}
                {canManage && (
                  editingId === op.id ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {canManage && (
                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500">
                          <option value="user">User</option>
                          <option value="superuser">Superuser</option>
                        </select>
                      )}
                      <input type="password" value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        placeholder="New password (optional)"
                        className="border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-500 w-40" />
                      <button onClick={() => saveEdit(op.id)} disabled={saving}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded transition-colors disabled:opacity-50">
                        {saving ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingId(null)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-3 py-1 rounded transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(op)}
                        className="text-blue-500 hover:text-blue-700 text-xs font-bold px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        title="Edit role / change password">
                        ✏️
                      </button>
                      <button onClick={() => removeOperator(op.id)}
                        className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        title="Remove scientist">
                        ×
                      </button>
                    </div>
                  )
                )}
              </div>
            ))
          )}
        </div>


      {/* ── AUTH SETTINGS (superuser only) ── */}
      {(isSuperuser || (!hasSuperuserDefined)) && authSettings && setAuthSettings && (
        <div className="border-t border-slate-200 pt-5">
          <h3 className="text-sm font-bold text-amber-700 uppercase mb-3 flex items-center gap-2">
            👑 Access Control Settings
            {!hasSuperuserDefined && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-normal">
                ⚠️ Define a superuser first to lock these settings
              </span>
            )}
          </h3>
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox"
                checked={!!authSettings.requireLoginOnEntry}
                onChange={(e) => setAuthSettings((p) => ({ ...p, requireLoginOnEntry: e.target.checked }))}
                className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" />
              <div>
                <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">
                  Require login before accessing the app
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  When enabled, users must select a scientist and enter their password before seeing anything.
                  When disabled, everyone can browse the Dashboard, Definitions, Agenda, etc. — but protected tests still require login.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox"
                checked={!!authSettings.hideOtherScientistTests}
                onChange={(e) => setAuthSettings((p) => ({ ...p, hideOtherScientistTests: e.target.checked }))}
                className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" />
              <div>
                <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">
                  Hide other scientists' tests completely
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  When enabled, users only see their own tests in the list.
                  When disabled, all tests are visible — others' tests show a 🔒 icon and require authentication to open.
                </p>
              </div>
            </label>
          </div>

          {/* Sécurité serveur : vérification des mots de passe par le serveur
              de jetons (les règles Firestore n'acceptent que ses jetons signés). */}
          {authServerBase() && <ServerSecurityPanel operators={operators} />}
        </div>
      )}
    </div>
  );
};

/* =========================================================
   « I FORGOT MY PASSWORD »  (voir utils/passwordResets.js)
========================================================= */

/** LA DEMANDE DE RÉINITIALISATION, EN UN SEUL COMPOSANT.
 *
 *  Ce qu'un client NE PEUT PAS faire : réinitialiser un mot de passe. La liste
 *  ne porte qu'un hash et c'est le serveur de jetons qui vérifie les mots de
 *  passe (server/token-server.js) : personne — pas même un superutilisateur — ne
 *  peut lire l'ancien, et changer le mot de passe de quelqu'un sans le
 *  connaître est impossible.
 *
 *  Ce qui peut être fait, et qui est fait ici :
 *    · la demande est ENREGISTRÉE (datée, une par personne) : le superutilisateur
 *      la voit sur ce poste, là où il pose le nouveau mot de passe ;
 *    · elle est ENVOYÉE aux superutilisateurs (sendAdminMail : Gmail du compte
 *      connecté, sinon relais du serveur, sinon lien mailto: pré-rempli) — le
 *      canal qui traverse les postes même sans connexion ;
 *    · l'écran dit EXACTEMENT ce qui s'est passé (enregistrée / envoyée / pas
 *      envoyée) : jamais « c'est fait » quand ça ne l'est pas.
 *
 *  Utilisé par la page « Change My Password » ET par l'écran de connexion —
 *  c'est là que se trouve la personne qui ne peut plus entrer. */
export const PasswordResetRequest = ({
  operators = [],
  personnel = [],
  defaultName = '',
  triggerLabel = '🔑 I forgot my password',
  triggerClassName = 'text-[11px] text-blue-600 hover:text-blue-700 underline transition-colors'
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const superusers = normalizeOperators(operators).filter((op) => op.role === 'superuser');
  const openPanel = () => { if (defaultName) setName(defaultName); setResult(null); setOpen(true); };

  const submit = async () => {
    const who = String(name || '').trim();
    if (!who) { setResult({ error: 'Enter the name of your account (as it appears in the team list).' }); return; }
    setBusy(true);
    const entry = requestPasswordReset({ name: who, note });
    const text = resetRequestText(entry);
    const subject = resetMailSubject(entry);
    const to = superuserEmailsOf(normalizeOperators(operators), Array.isArray(personnel) ? personnel : []);
    const mail = await sendAdminMail({ to, subject, text })
      .catch((err) => ({ ok: false, mode: 'none', reason: (err && err.message) || 'e-mail unavailable' }));
    setBusy(false);
    setResult({ entry, text, subject, mail, summary: summarizeMail(mail, 'Reset request') });
  };

  /* Le lien mailto: de repli est construit ICI quand rien n'a pu être envoyé :
     l'app ne laisse jamais croire qu'un message est parti (même règle que le
     reste du module Administration). */
  const mailto = result && result.entry && !(result.mail && result.mail.ok)
    ? ((result.mail && result.mail.mailto) || buildMailto([], result.subject, result.text))
    : '';

  return (
    <>
      <button type="button" onClick={openPanel} className={triggerClassName}>{triggerLabel}</button>
      {open && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-5 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-black text-slate-800 mb-1">🔑 Forgot your password?</h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              Nobody — not even a superuser — can read a password: only a hash is kept, and the lab server is
              what checks it at sign-in. A superuser can <b>set a new one</b> for you, and this form asks them to.
            </p>
            {result && !result.error ? (
              <div className="flex flex-col gap-3">
                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
                  ✅ {describeResetOutcome(result.entry, result.mail)}
                  {!(result.mail && result.mail.ok) && (
                    <p className="mt-1 text-amber-800">
                      {(result.summary && result.summary.text) || 'The e-mail could not be sent.'}
                    </p>
                  )}
                </div>
                {mailto && (
                  <a href={mailto} className="text-xs font-bold text-blue-700 underline break-words">
                    ✉️ Send the request from your own mailbox (message ready)
                  </a>
                )}
                {superusers.length > 0 ? (
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Superuser(s) of this lab: <b>{superusers.map((op) => op.name).join(', ')}</b>. They set a new
                    password from <b>page d’accueil → 👥 Équipe &amp; accès</b> → ✏️ → <i>New password</i> → Save.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    No superuser appears in this browser's team list: ask whoever set up Lab Workspace to replace
                    your password from page d’accueil → 👥 Équipe &amp; accès.
                  </p>
                )}
                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer">Show the message that was prepared</summary>
                  <pre className="whitespace-pre-wrap mt-1 bg-slate-50 border border-slate-200 rounded p-2">{result.text}</pre>
                </details>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="self-end bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-3 rounded-lg text-xs transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {result && result.error && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    ⚠️ {result.error}
                  </div>
                )}
                <label className="text-[11px] font-bold text-slate-500 uppercase">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Marie Curie"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full"
                />
                <label className="text-[11px] font-bold text-slate-500 uppercase mt-1">Message (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. I am at the bench next to the NMR — any temporary password is fine"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Ask for a reset'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2 px-4 rounded-lg text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The request is recorded on this computer and sent to the superuser(s) by e-mail — and, if the
                  e-mail cannot leave, a ready-to-send message is offered.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/** CE QUE LE SUPERUTILISATEUR VOIT : les demandes encore ouvertes, exactement
 *  là où il pose le nouveau mot de passe (page d'accueil → 👥 Équipe & accès → ✏️). L'e-mail
 *  est le canal qui traverse les postes ; ce panneau montre les demandes
 *  enregistrées SUR CE POSTE — et les referme quand le mot de passe est posé. */
export const PasswordResetRequestsPanel = () => {
  const [list, setList] = useState(() => openResets(loadPasswordResets()));
  useEffect(() => {
    const refresh = () => setList(openResets(loadPasswordResets()));
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  if (!list.length) return null;
  const when = (ts) => (Number(ts) ? new Date(Number(ts)).toLocaleString() : '');
  return (
    <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed flex flex-col gap-2">
      <p className="font-bold text-amber-900">
        🔑 {list.length} password reset request{list.length > 1 ? 's' : ''} recorded on this computer
      </p>
      {list.map((r) => (
        <div key={r.id} className="flex items-start gap-2 bg-white/80 border border-amber-100 rounded px-2 py-1.5">
          <div className="flex-1 min-w-0">
            <p className="text-amber-900">
              <b>{r.name}</b> · <span className="text-amber-700">{when(r.askedAt)}</span>
            </p>
            {r.note && <p className="text-[11px] italic text-amber-800">{r.note}</p>}
            <p className="text-[11px] text-amber-700">
              Set a new password for this person below (✏️ → New password → Save), then mark the request handled.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setList(openResets(closePasswordReset(r.id)))}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2 py-1 rounded transition-colors"
          >
            ✔ Handled
          </button>
        </div>
      ))}
    </div>
  );
};

/* =========================================================
   SCIENTIST LOGIN GATE  (full-screen, mandatory)
========================================================= */
export const ScientistLoginGate = ({ operators, onLogin, onRecovery, serverMode = false, serverStatus = null }) => {
  const normalizedOps = normalizeOperators(operators || []);
  // Recovery mode: if nobody has a password set, allow emergency bypass
  const noneHavePassword = normalizedOps.every((op) => !op.passwordHash);
  // Authentification serveur amorcée : le contournement d'urgence est fermé
  // (sinon il rouvrirait exactement le trou que le serveur referme).
  const recoveryAllowed = !serverMode && !(serverStatus && serverStatus.configured);
  const [selectedId, setSelectedId] = useState(normalizedOps.length === 1 ? normalizedOps[0].id : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = React.useRef(null);

  React.useEffect(() => {
    if (selectedId) setTimeout(() => passwordRef.current?.focus(), 80);
  }, [selectedId]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!selectedId) { setError('Please select your name.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true);
    setError('');
    try {
      const op = normalizedOps.find((o) => o.id === selectedId);
      if (!op) { setError('Scientist not found.'); setLoading(false); return; }
      /* serverMode : le mot de passe n'est PAS vérifié ici — le hash n'est même
         pas transmis au navigateur. C'est le serveur de jetons qui vérifie le
         mot de passe et signe la session Firebase ; le parent répond { error }
         en cas de refus. */
      if (!serverMode) {
        if (!op.passwordHash) { setError('No password set for this account. Contact a superuser.'); setLoading(false); return; }
        const hash = await hashPassword(password);
        if (hash !== op.passwordHash) {
          setError('Incorrect password. Try again.');
          setPassword('');
          setLoading(false);
          return;
        }
      }
      const result = await onLogin({ id: op.id, name: op.name, role: op.role, personnelId: op.personnelId }, password);
      if (result && result.error) {
        setError(result.error);
        setPassword('');
        setLoading(false);
      }
    } catch (err) {
      setError('Login failed: ' + ((err && err.message) || String(err)));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8 shadow-2xl">

          {/* Logo / branding */}
          <div className="text-center mb-8">
            <div className="text-blue-300 mb-3 flex justify-center"><Icon name="microscope" size={48} /></div>
            <h1 className="text-2xl font-black text-white tracking-tight">Lab Workspace</h1>
            <p className="text-blue-200 text-sm mt-1 font-medium">Secure access — please identify yourself</p>
          </div>

          {/* Special panel when no scientists are configured */}
          {normalizedOps.length === 0 && (
            <div className="mb-6 bg-amber-500/20 border border-amber-400/40 rounded-xl px-5 py-4 text-center">
              <div className="text-2xl mb-2">⚠️</div>
              <p className="text-amber-200 font-bold text-sm mb-1">No scientists configured</p>
              <p className="text-amber-300/70 text-xs">
                Scientist accounts were lost (e.g. from an HTML file load). Use recovery to re-configure.
              </p>
              {onRecovery && recoveryAllowed && (
                <button
                  type="button"
                  onClick={onRecovery}
                  className="mt-3 bg-amber-500 hover:bg-amber-400 text-white font-black px-4 py-2 rounded-lg text-sm transition-colors w-full"
                >
                  🔓 Enter Recovery Mode
                </button>
              )}
            </div>
          )}

          {/* Scientist selector */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-blue-200 uppercase mb-1.5 tracking-wider">
              Scientist
            </label>
            <select
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setError(''); }}
              className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" style={{ background: '#1e293b' }}>— Select your name —</option>
              {normalizedOps.map((op) => (
                <option key={op.id} value={op.id} style={{ background: '#1e293b' }}>
                  {op.role === 'superuser' ? '👑 ' : '🧪 '}{op.name}
                </option>
              ))}
            </select>
          </div>

          {/* Password */}
          <div className="mb-6">
            <label className="block text-xs font-bold text-blue-200 uppercase mb-1.5 tracking-wider">
              Password
            </label>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Enter your password"
              className="w-full bg-white/10 border border-white/20 text-white placeholder-blue-300/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 bg-red-500/20 border border-red-400/30 text-red-200 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2">
              <span>⚠️</span>{error}
            </div>
          )}

          {/* État de l'authentification serveur (jetons signés) */}
          {serverMode ? (
            <p className="mb-4 text-[11px] text-emerald-200/80 leading-relaxed">
              🔐 Mot de passe vérifié par le serveur sécurisé du laboratoire : l’accès aux données
              n’est délivré qu’à un compte valide de l’équipe.
            </p>
          ) : (serverStatus && serverStatus.configured && serverStatus.accounts === 0) ? (
            <p className="mb-4 text-[11px] text-amber-200/80 leading-relaxed">
              ⚠️ Le serveur sécurisé n’a pas encore reçu la liste de l’équipe : un superutilisateur doit
              publier les comptes (page d'accueil → 👥 Équipe & accès) AVANT de fermer les règles Firestore
              (docs/SECURITY-SETUP.md).
            </p>
          ) : (serverStatus && serverStatus.lastError) ? (
            <p className="mb-4 text-[11px] text-amber-200/80 leading-relaxed">
              ⚠️ Serveur sécurisé injoignable ({serverStatus.lastError}) — connexion locale de secours.
            </p>
          ) : null}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-blue-800 text-white font-black py-3 px-6 rounded-xl text-sm shadow-lg hover:shadow-blue-500/40 transition-all transform hover:scale-[1.02] disabled:scale-100 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verifying…
              </>
            ) : (
              <>🔑 Enter Lab</>
            )}
          </button>

          {/* Recovery bypass — shown only if no passwords are set at all */}
          {noneHavePassword && onRecovery && recoveryAllowed && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onRecovery}
                className="text-xs text-blue-300/70 hover:text-blue-200 underline transition-colors"
              >
                🔓 Emergency recovery (no passwords configured)
              </button>
            </div>
          )}

          {/* 🔑 « I forgot my password » — ICI, et pas seulement dans les
              réglages : la personne qui ne peut plus entrer ne verra jamais la
              page des réglages. La demande est enregistrée sur ce poste et
              préparée pour les superutilisateurs (e-mail quand un envoi est
              possible, sinon un message prêt à envoyer). */}
          {normalizedOps.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-1">
              <PasswordResetRequest
                operators={normalizedOps}
                triggerClassName="text-xs text-blue-300/70 hover:text-blue-200 underline transition-colors"
              />
              <p className="text-[10px] text-blue-200/50 leading-relaxed text-center">
                A superuser sets a new password (nobody can read the old one).
              </p>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

/* =========================================================
   SCIENTIST LOGIN MODAL
========================================================= */

export const ScientistLoginModal = ({ operators, onLogin, onClose, title, subtitle, serverMode = false }) => {
  const normalizedOps = normalizeOperators(operators || []);
  const [selectedId, setSelectedId] = useState(normalizedOps.length === 1 ? normalizedOps[0].id : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = React.useRef(null);

  // Focus the password field when modal opens
  React.useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!selectedId) { setError('Please select a scientist.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true);
    setError('');
    try {
      const op = normalizedOps.find((o) => o.id === selectedId);
      if (!op) { setError('Scientist not found.'); setLoading(false); return; }
      // serverMode : la vérification est faite par le serveur de jetons (le hash
      // n'est pas transmis au navigateur) — le parent peut répondre { error }.
      if (!serverMode) {
        if (!op.passwordHash) { setError('This scientist has no password set. Ask a superuser to set one.'); setLoading(false); return; }
        const hash = await hashPassword(password);
        if (hash !== op.passwordHash) {
          setError('Incorrect password. Try again.');
          setPassword('');
          setLoading(false);
          return;
        }
      }
      const result = await onLogin({ id: op.id, name: op.name, role: op.role, personnelId: op.personnelId }, password);
      if (result && result.error) {
        setError(result.error);
        setPassword('');
        setLoading(false);
      }
    } catch (err) {
      setError('Login failed: ' + ((err && err.message) || String(err)));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[fadeIn_0.15s_ease]">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-5 text-white">
          <div className="text-2xl mb-2">🔐</div>
          <h2 className="text-xl font-black">{title || 'Scientist Login'}</h2>
          {subtitle && <p className="text-blue-100 text-sm mt-1">{subtitle}</p>}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Scientist</label>
            <select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setError(''); }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 bg-white font-medium">
              <option value="">— Select scientist —</option>
              {normalizedOps.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.role === 'superuser' ? '👑 ' : '🧪 '}{op.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
            <input ref={inputRef} type="password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter your password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2">
              ⚠️ {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-sm transition-colors disabled:opacity-50">
              {loading ? 'Verifying…' : 'Log In'}
            </button>
            {onClose && (
              <button type="button" onClick={onClose}
                className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};





