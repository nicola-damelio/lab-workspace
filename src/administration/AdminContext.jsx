/* =========================================================================
   src/administration/AdminContext.jsx
   Couche de données liée au dataset pour le module d’administration.

   Une base d’administration est un dataset normal de type « administration ».
   Tout son contenu vit DANS le document du dataset, dans l’objet payload
   `administration` : { recettes, librerie, personnel, depenses, om,
   desiderate, questioni, sicurezza, settings }.

   Ce provider est donc un STORE CONTRÔLÉ, purement en mémoire : le parent
   (App) possède l’état du payload et le persiste via la sauvegarde automatique
   habituelle des datasets (même code que les datasets scientifiques). Rien
   n’est lu ni écrit directement ici — plus aucune sous-collection
   data/admin/… (chemin invalide dans Firestore).
   ========================================================================= */
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import {
  ADMIN_COLLECTIONS, DEFAULT_OPTIONS, adminAccessProfile, adminPageIdsFor,
  isReimbNature, reimbursementFromDepense,
} from './adminSchema';

const AdminDataContext = createContext(null);
export const useAdmin = () => useContext(AdminDataContext);

const makeId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

export const AdminProvider = ({
  currentUser, user, operators, content, onChange, children, teamBootstrap,
  /* Navigation inter-pages d’administration (fournie par App) : permet à une
     page (ex. Dépenses) d’ouvrir une autre page et d’y pointer un
     enregistrement précis (fournisseur, ligne budgétaire, personne…). */
  navigate, focus, clearFocus,
}) => {
  // Bootstrap : aucun compte scientifique ou aucun superutilisateur défini.
  // La page Parametres (equipe) reste alors accessible pour creer l'equipe.
  const safeContent = content && typeof content === 'object' ? content : {};

  const data = useMemo(() => {
    const out = {};
    Object.keys(ADMIN_COLLECTIONS).forEach((key) => {
      out[key] = Array.isArray(safeContent[key]) ? safeContent[key] : [];
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Profil d’accès : rôle (superuser / scientifique) depuis les opérateurs,
  // statut + fonction depuis la fiche Personnel liée de CETTE base.
  const profile = useMemo(
    () => adminAccessProfile(currentUser, operators, data.personnel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser, operators, data.personnel]
  );
  const isSuperuser = profile.isSuperuser;

  const settings = useMemo(
    () =>
      safeContent.settings && typeof safeContent.settings === 'object'
        ? safeContent.settings
        : DEFAULT_OPTIONS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content]
  );

  /* Pages autorisées : matrice par défaut (statut + fonctions de la fiche) +
     règles personnalisées du Setup (« Accès aux pages »). Recalculées à
     chaque changement du payload (fiches Personnel ou réglages). */
  const allowedPageIds = useMemo(
    () => adminPageIdsFor(profile, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, content]
  );

  /* Chaque commit part de l’ÉTAT LE PLUS RÉCENT (mise à jour fonctionnelle).
     Deux pièges sont couverts ici :
     - deux écritures dans le même tick (ex. transfert OM → dépense, où on
       crée une dépense PUIS on marque l’OM) se composent au lieu de
       s’écraser ;
     - une écriture asynchrone POSTÉRIEURE à une autre (ex. approbation d’un
       devis puis renommage, ~2 s plus tard, du fichier sur Google Drive) ne
       repart JAMAIS d’un instantané obsolète : la liste est recalculée à
       partir de l’état précédent réel (prev) reçu par la mise à jour
       fonctionnelle, jamais d’un data[kind] figé au moment du clic — sinon
       la seconde écriture écraserait la première (le devis « Approuvé »
       repassait « En attente » dès que le renommage Drive se terminait). */
  const commitKind = (kind, build) => {
    if (typeof onChange !== 'function') return;
    onChange((prev) => {
      const base = prev && typeof prev === 'object' ? prev : {};
      const cur = Array.isArray(base[kind]) ? base[kind] : [];
      return { ...base, [kind]: build(cur) };
    });
  };
  /* Dernier état RENDU : sert uniquement à construire la valeur de retour de
     upsert (id, enveloppe, champs) quand la mise à jour fonctionnelle n’a pas
     encore été exécutée. L’état persisté, lui, est toujours calculé dans
     commitKind à partir de l’état le plus récent. */
  const dataRef = useRef(data);
  dataRef.current = data;

  const upsert = (kind, patch, existingId) => {
    const now = Date.now();
    const actor = { name: currentUser?.name || 'Invité', role: currentUser?.role || 'user' };
    const id = existingId || makeId(kind);
    let returned = null;
    commitKind(kind, (cur) => {
      const prev = cur.find((d) => d.id === id) || (existingId ? { id } : {});
      const record = {
        ...prev,
        ...(patch || {}),
        id,
        createdAt: prev.createdAt || now,
        createdBy: prev.createdBy || actor,
        updatedAt: now,
        updatedBy: actor,
      };
      returned = record;
      return [record, ...cur.filter((d) => d.id !== id)];
    });
    if (returned) return returned;
    const cur = Array.isArray(dataRef.current && dataRef.current[kind]) ? dataRef.current[kind] : [];
    const prev = cur.find((d) => d.id === id) || (existingId ? { id } : {});
    return {
      ...prev,
      ...(patch || {}),
      id,
      createdAt: prev.createdAt || now,
      createdBy: prev.createdBy || actor,
      updatedAt: now,
      updatedBy: actor,
    };
  };

  const remove = (kind, id) => {
    commitKind(kind, (cur) => cur.filter((d) => d.id !== id));
  };

  /* Rapatriement automatique des anciennes lignes Dépenses classées
     « Remboursements » (saisies ou importées avant l’arrivée du registre
     dédié) vers la collection `reimbursements`. Un remboursement est une
     CATÉGORIE À PART : il ne doit jamais rester dans la table Dépenses (ni
     y « migrer » ensuite) — il vit dans son propre registre, présenté dans
     l’onglet « Remboursements » de la page Dépenses. La conversion est
     idempotente : dès qu’il ne reste plus de ligne classée « Remboursements »
     dans `depenses`, l’effet ne fait plus rien. */
  const drainedReimbRef = useRef(false);
  useEffect(() => {
    if (drainedReimbRef.current) return;
    const deps = Array.isArray(data.depenses) ? data.depenses : [];
    const stale = deps.filter((d) => d && d.id && isReimbNature(d.classification || d.nature));
    if (!stale.length) return;
    drainedReimbRef.current = true;
    const now = Date.now();
    const actor = { name: currentUser?.name || 'Invité', role: currentUser?.role || 'user' };
    const removedIds = new Set();
    const converted = stale.map((d) => {
      removedIds.add(d.id);
      const id = makeId('reimbursements');
      return { ...reimbursementFromDepense(d), id, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor };
    });
    commitKind('reimbursements', (cur) => [...converted, ...cur]);
    commitKind('depenses', (cur) => cur.filter((d) => !removedIds.has(d.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.depenses]);

  /** Import groupé (assistant d’import) : un seul onChange pour toute la
   *  liste, chaque enregistrement reçoit enveloppe + audit comme `upsert`. */
  const importMany = (kind, records) => {
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!list.length) return { added: 0 };
    const now = Date.now();
    const actor = { name: currentUser?.name || 'Invité', role: currentUser?.role || 'user' };
    const stamped = list.map((patch) => {
      const id = makeId(kind);
      return { ...(patch || {}), id, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor };
    });
    commitKind(kind, (cur) => [...stamped, ...cur]);
    return { added: stamped.length, records: stamped };
  };

  /** Mise à jour GROUPÉE d’enregistrements EXISTANTS (ex. réattribution
   *  automatique des dépenses incohérentes) : un seul onChange pour toute la
   *  liste — appeler `upsert` en boucle synchronisée perdrait les premiers
   *  correctifs (chaque appel repart de l’instantané d’origine). */
  const updateMany = (kind, changes) => {
    const list = Array.isArray(changes) ? changes.filter((c) => c && c.id) : [];
    if (!list.length) return { updated: 0 };
    const now = Date.now();
    const actor = { name: currentUser?.name || 'Invité', role: currentUser?.role || 'user' };
    const byId = new Map(list.map((c) => [c.id, c.patch || {}]));
    commitKind(kind, (cur) => cur.map((rec) => {
      const patch = byId.get(rec.id);
      if (!patch) return rec;
      return { ...rec, ...patch, id: rec.id, updatedAt: now, updatedBy: actor };
    }));
    return { updated: list.length };
  };

  const updateSettings = (patch) => {
    if (typeof onChange !== 'function') return;
    onChange((prev) => {
      const base = prev && typeof prev === 'object' ? prev : {};
      const curSettings = base.settings && typeof base.settings === 'object' ? base.settings : DEFAULT_OPTIONS;
      return { ...base, settings: { ...DEFAULT_OPTIONS, ...curSettings, ...(patch || {}) } };
    });
  };

  const access = useMemo(
    () => ({
      isSuperuser,
      profile,
      canViewPage: (p) => !!p && (allowedPageIds.has(p.id) || (p.id === 'settings' && !!teamBootstrap)),
      canEditPage: (p) => !!p && (allowedPageIds.has(p.id) || (p.id === 'settings' && !!teamBootstrap)),
      canChangeWishlistStatus: isSuperuser,
      // Every write goes straight to Firestore now — no Google sign-in is
      // required any more — so this is always true.
      canWriteCloud: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuperuser, profile, allowedPageIds, user, teamBootstrap]
  );

  const value = {
    data,
    settings,
    ready: true,
    notice: '',
    access,
    upsert,
    remove,
    importMany,
    updateMany,
    updateSettings,
    isSuperuser,
    user,
    currentUser: currentUser || null,
    /* Navigation entre pages d’administration + mise en évidence d’un
       enregistrement cible (consommée par la page d’arrivée au montage). */
    navigate: typeof navigate === 'function' ? navigate : () => {},
    focus: focus || null,
    clearFocus: typeof clearFocus === 'function' ? clearFocus : () => {},
    /* Opérateurs (rôles) — nécessaire aux pages qui notifient par e-mail
       (ex. Approbation devis & BC → recherche du superutilisateur). */
    operators: Array.isArray(operators) ? operators : [],
  };

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
};
