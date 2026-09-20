/* =============================================================================
   mdAnalysisCache.js — CACHE des graphes MD calculés (Data Analysis).

   Les courbes de la page MD (RMSD, RMSF, Rg, SASA, énergie) sont le fruit de
   calculs longs sur la trajectoire. Elles sont donc CONSERVÉES avec le test :

     • une copie bornée (« downsample ») vit dans la fiche du test
       (`mdAnalysisResult`) — elle suit le jeu de données sur le Drive/Firestore,
       donc on la retrouve depuis n'importe quel poste ;
     • une copie locale (localStorage) sert de cache rapide pour réafficher les
       graphes à l'ouverture de la page, sans attendre la synchronisation.

   Un « empreinte » (nom + taille + date de la trajectoire) est mémorisée avec le
   résultat : si la trajectoire chargée n'est plus la même, le cache est signalé
   comme PÉRIMÉ et l'utilisateur peut recalculer (bouton 🔁 Recalculate) ou
   effacer le cache (🗑). Rien n'est jamais recalculé en silence.
   ============================================================================= */

export const MD_ANALYSIS_CACHE_VERSION = 1;
export const MD_ANALYSIS_LOCAL_PREFIX = 'lab_md_analysis_';

// Storage par défaut = celui du navigateur (on passe par `window` pour ne pas
// toucher au `localStorage` désactivé que Node expose sans --localstorage-file).
const defaultStorage = () => {
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
};

export const localAnalysisKey = (testId) => `${MD_ANALYSIS_LOCAL_PREFIX}${testId || '_unknown'}`;

/* Empreinte de la trajectoire chargée : sans elle, impossible de dire si les
   graphes affichés correspondent encore au fichier courant. Un fichier absent
   (trajectoire rechargée depuis le Drive sur un autre poste) donne ''. */
export const mdTrajectoryFingerprint = (file) => {
  if (!file || !file.name) return '';
  return [String(file.name), Number(file.size) || 0, Number(file.lastModified) || 0].join('|');
};

// Quand le résultat a été calculé, en clair (jj/mm/aaaa hh:mm) — chaîne vide si
// la date est absente ou illisible (anciens résultats enregistrés).
export const formatSavedAt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Un résultat exploitable contient au moins une série de valeurs.
export const hasAnalysisData = (res) => !!res && typeof res === 'object' && ['rmsd', 'rmsf', 'rg', 'sasa', 'energy']
  .some((k) => Array.isArray(res[k]) && res[k].length > 0);

// Les courbes qui viennent de la TRAJECTOIRE (l'énergie, elle, vient d'un .xvg
// chargé à part) : elles seules disent que « l'analyse générale » a été faite.
export const hasTrajectoryCurves = (res) => !!res && typeof res === 'object' && ['rmsd', 'rmsf', 'rg', 'sasa']
  .some((k) => Array.isArray(res[k]) && res[k].length > 0);

/* ── Copie locale (cache rapide) ──────────────────────────────────────────── */

export const readLocalAnalysis = (testId, storage) => {
  const store = storage || defaultStorage();
  if (!store || !testId) return null;
  try {
    const raw = JSON.parse(store.getItem(localAnalysisKey(testId)) || 'null');
    return hasAnalysisData(raw) ? raw : null;
  } catch {
    return null;
  }
};

// Écrit la copie locale (un résultat vide EFFACE le cache au lieu d'y laisser
// un objet inutilisable).
export const writeLocalAnalysis = (testId, payload, storage) => {
  const store = storage || defaultStorage();
  if (!store || !testId) return payload || null;
  try {
    if (hasAnalysisData(payload)) store.setItem(localAnalysisKey(testId), JSON.stringify(payload));
    else if (typeof store.removeItem === 'function') store.removeItem(localAnalysisKey(testId));
  } catch { /* quota plein / mode privé : la copie du test reste la source */ }
  return payload || null;
};

export const clearLocalAnalysis = (testId, storage) => {
  const store = storage || defaultStorage();
  if (!store || !testId || typeof store.removeItem !== 'function') return false;
  try { store.removeItem(localAnalysisKey(testId)); return true; } catch { return false; }
};



/* ── Payload enregistré avec le test ──────────────────────────────────────── */

const bounded = (series, downsample) => {
  const arr = Array.isArray(series) ? series : [];
  return typeof downsample === 'function' ? downsample(arr) : arr;
};

/* Construit la copie bornée à partir d'un calcul frais (`analysis`) en
   CONSERVANT ce qui ne vient pas de la trajectoire : la série d'énergie (fichier
   .xvg chargé à part) et son nom de fichier. `downsample` est injecté pour
   rester sans dépendance (les tests passent une fonction factice). */
export const buildAnalysisCachePayload = (analysis, options = {}) => {
  const { prev = {}, fingerprint = '', stride = 0, maxFrames = 0, savedAt = '', downsample } = options;
  const res = analysis || {};
  return {
    version: MD_ANALYSIS_CACHE_VERSION,
    rmsd: bounded(res.rmsd, downsample),
    rmsf: Array.isArray(res.rmsf) ? res.rmsf : [],
    rg: bounded(res.rg, downsample),
    sasa: bounded(res.sasa, downsample),
    energy: bounded(prev.energy, downsample),
    energyFileName: prev.energyFileName || '',
    nFrames: Number(res.nFrames) || 0,
    source: res.source || '',
    fingerprint: String(fingerprint || ''),
    stride: Number(stride) || 0,
    maxFrames: Number(maxFrames) || 0,
    savedAt: savedAt || ''
  };
};

/* Ajoute (ou remplace) la série d'énergie dans une copie existante — les
   courbes calculées sur la trajectoire ne sont pas touchées. */
export const mergeEnergyIntoAnalysis = (prev, energy, options = {}) => {
  const { fileName = '', savedAt = '', downsample } = options;
  const base = prev && typeof prev === 'object' ? prev : {};
  return {
    ...base,
    version: MD_ANALYSIS_CACHE_VERSION,
    energy: bounded(energy, downsample),
    energyFileName: fileName || base.energyFileName || '',
    savedAt: savedAt || base.savedAt || ''
  };
};

/* ── État du cache, tel que l'affiche la page MD ──────────────────────────── */

/* `stale` = le cache vient d'UNE AUTRE trajectoire que celle chargée maintenant
   (empreintes connues et différentes). Une empreinte inconnue (résultat calculé
   avant cette version, ou trajectoire non rechargée localement) n'est JAMAIS
   déclarée périmée : on ne fait pas peur pour rien. */
export const analysisCacheState = (stored, currentFingerprint) => {
  const res = hasAnalysisData(stored) ? stored : null;
  if (!res) return { present: false, stale: false, frames: 0, source: '', savedAt: '', savedAtLabel: '', fingerprint: '' };
  const fingerprint = String(res.fingerprint || '');
  const current = String(currentFingerprint || '');
  return {
    present: true,
    stale: !!fingerprint && !!current && fingerprint !== current,
    frames: Number(res.nFrames) || 0,
    source: res.source || '',
    savedAt: res.savedAt || '',
    savedAtLabel: formatSavedAt(res.savedAt),
    fingerprint
  };
};

// Ligne lisible pour la bannière « graphes conservés ».
export const describeAnalysisCache = (state) => {
  if (!state || !state.present) return '';
  const parts = [];
  if (state.frames) parts.push(`${state.frames} frames`);
  if (state.source) parts.push(`from ${state.source}`);
  if (state.savedAtLabel) parts.push(`saved ${state.savedAtLabel}`);
  const head = `Saved analysis${parts.length ? `: ${parts.join(' · ')}` : ''}`;
  return state.stale ? `${head} — ⚠️ the loaded trajectory is different: press Recalculate` : head;
};

