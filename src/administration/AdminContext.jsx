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
import React, { createContext, useContext, useMemo } from 'react';
import { ADMIN_COLLECTIONS, DEFAULT_OPTIONS } from './adminSchema';

const AdminDataContext = createContext(null);
export const useAdmin = () => useContext(AdminDataContext);

const makeId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

export const AdminProvider = ({ currentUser, user, content, onChange, children, teamBootstrap }) => {
  const isSuperuser = currentUser?.role === 'superuser';
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

  const settings = useMemo(
    () =>
      safeContent.settings && typeof safeContent.settings === 'object'
        ? safeContent.settings
        : DEFAULT_OPTIONS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [content]
  );

  const setList = (kind, list) => {
    if (typeof onChange !== 'function') return;
    onChange({ ...safeContent, [kind]: list });
  };

  const upsert = (kind, patch, existingId) => {
    const prevList = data[kind] || [];
    const prev = prevList.find((d) => d.id === existingId) || (existingId ? { id: existingId } : {});
    const id = prev.id || makeId(kind);
    const now = Date.now();
    const actor = { name: currentUser?.name || 'Invité', role: currentUser?.role || 'user' };
    const record = {
      ...prev,
      ...(patch || {}),
      id,
      createdAt: prev.createdAt || now,
      createdBy: prev.createdBy || actor,
      updatedAt: now,
      updatedBy: actor,
    };
    setList(kind, [record, ...prevList.filter((d) => d.id !== id)]);
    return record;
  };

  const remove = (kind, id) => {
    setList(kind, (data[kind] || []).filter((d) => d.id !== id));
  };

  /** Import groupé (assistant d’import) : un seul onChange pour toute la
   *  liste, chaque enregistrement reçoit enveloppe + audit comme `upsert`. */
  const importMany = (kind, records) => {
    const prevList = data[kind] || [];
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!list.length) return { added: 0 };
    const now = Date.now();
    const actor = { name: currentUser?.name || 'Invité', role: currentUser?.role || 'user' };
    const stamped = list.map((patch) => {
      const id = makeId(kind);
      return { ...(patch || {}), id, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor };
    });
    setList(kind, [...stamped, ...prevList]);
    return { added: stamped.length };
  };

  const updateSettings = (patch) => {
    if (typeof onChange !== 'function') return;
    onChange({ ...safeContent, settings: { ...DEFAULT_OPTIONS, ...settings, ...(patch || {}) } });
  };

  const access = useMemo(
    () => ({
      isSuperuser,
      canViewPage: (p) => !p.superuserOnly || isSuperuser || (p.id === 'settings' && !!teamBootstrap),
      canEditPage: (p) => isSuperuser || !p.superuserOnly || (p.id === 'settings' && !!teamBootstrap),
      canChangeWishlistStatus: isSuperuser,
      canWriteCloud: !!user,
    }),
    [isSuperuser, user, teamBootstrap]
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
    updateSettings,
    isSuperuser,
    user,
  };

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
};
