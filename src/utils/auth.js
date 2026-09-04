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
