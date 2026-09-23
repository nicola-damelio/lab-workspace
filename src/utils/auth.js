/* =========================================================================
   src/utils/auth.js
   Auth utilities (password hashing + operator normalisation).
   Extracted from App.jsx.
   ========================================================================= */

/** Hash a plain-text password with SHA-256, returning a hex string. */
export const hashPassword = async (password) => {
  if (!password) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Ensure every entry in an operators array is the new object format:
 * { id, name, role, passwordHash }
 * Legacy string entries become { role: 'user', passwordHash: '' }.
 */
export const normalizeOperators = (ops) => {
  if (!Array.isArray(ops)) return [];
  return ops.map((op) => {
    if (typeof op === 'string') {
      return { id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2), name: op, role: 'user', passwordHash: '' };
    }
    return {
      id: op.id || 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      name: op.name || '',
      role: op.role || 'user',
      passwordHash: op.passwordHash || '',
      personnelId: op.personnelId || null,
    };
  });
};

/** Get the display label of an operator (object or legacy string). */
export const getOpLabel = (op) => (typeof op === 'string' ? op : op?.name || '');

/* ── IDENTITÉ D'UN MEMBRE CONNECTÉ : UN SEUL POINT DE VÉRITÉ ───────────────
   Deux chemins écrivent l'identité de la session, et ils ne voient pas la
   même chose :
     · la connexion par mot de passe (POST /api/auth/login) reçoit l'id de
       l'opérateur, son nom et son rôle ;
     · l'écouteur d'état Firebase (onAuthStateChanged) ne connaît QUE l'uid
       Firebase et les revendications du jeton signé.
   Or le profil d'administration relie la fiche Personnel par
   `operators.find(op => op.id === currentUser.id)` puis `op.personnelId`
   (voir adminAccessProfile) : quand l'uid Firebase remplaçait l'id de
   l'opérateur, ce lien était perdu et le nom — seul critère restant — pouvait
   ne pas correspondre à la fiche. Le profil retombait alors sur « Non
   permanent » sans fonction, c'est-à-dire les pages d'un utilisateur
   GÉNÉRIQUE, jusqu'au rechargement suivant. Les deux chemins passent donc
   désormais par la même règle : ils ne peuvent plus diverger. */

/** Clé de comparaison d'un nom d'opérateur : accents retirés, mots triés
 *  (« Nom Prénom » et « Prénom Nom » désignent le même opérateur). */
export const opNameKey = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(Boolean).sort().join(' ');

/** L'opérateur de la liste locale qui porte ce nom (null si introuvable). */
export const operatorForName = (operators, name) => {
  const key = opNameKey(name);
  if (!key) return null;
  return normalizeOperators(operators).find((op) => opNameKey(op.name) === key) || null;
};

/**
 * Identité canonique d'une session, à partir de ce qu'un chemin connaît
 * (`entry`) et de l'identité précédemment établie (`previous`).
 *   · l'ID est celui de l'OPÉRATEUR dès qu'on le reconnaît (par nom, sinon par
 *     l'id fourni / précédent) : c'est cet id qui porte le lien `personnelId` ;
 *   · le NOM précédent survit à une revendication vide (le jeton du serveur
 *     peut arriver sans nom) — une identité riche n'est jamais remplacée par
 *     une identité plus pauvre ;
 *   · le RÔLE signé par le serveur (`entry.role`) fait foi quand il est là.
 * Renvoie toujours { id, name, role, personnelId }.
 */
export const memberIdentity = (entry, { operators, previous } = {}) => {
  const e = entry && typeof entry === 'object' ? entry : {};
  const prev = previous && typeof previous === 'object' ? previous : null;
  const clean = (v) => String(v == null ? '' : v).trim();
  const list = normalizeOperators(operators);
  const name = clean(e.name) || clean(prev && prev.name);
  const key = opNameKey(name);
  const op =
    (key && list.find((o) => opNameKey(o.name) === key)) ||
    list.find((o) => !!clean(e.id) && o.id === clean(e.id)) ||
    list.find((o) => !!clean(prev && prev.id) && o.id === clean(prev.id)) ||
    null;
  const role = clean(e.role) || (op && op.role) || (prev && prev.role) || 'user';
  return {
    id: (op && op.id) || clean(e.id) || clean(prev && prev.id),
    name: (op && op.name) || name,
    role: role === 'superuser' ? 'superuser' : 'user',
    personnelId: (op && op.personnelId) || clean(e.personnelId)
      || clean(prev && prev.personnelId) || null,
  };
};
