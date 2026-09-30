export const store = new Map();
let quota = Infinity;
export const setQuota = (n) => { quota = n; };
export const used = () => { let t = 0; store.forEach((v) => { t += String(v).length; }); return t; };
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] || null,
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => store.clear(),
  setItem: (k, v) => {
    const next = String(v);
    const without = used() - String(store.get(String(k)) || '').length;
    if (without + next.length > quota) {
      const err = new Error('quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    store.set(String(k), next);
  }
};