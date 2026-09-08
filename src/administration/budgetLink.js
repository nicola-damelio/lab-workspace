/* =========================================================================
   src/administration/budgetLink.js
   Rétablit et classe les LIENS entre les dépenses et leurs documents Google
   Drive (devis, BC, factures, OM, BL / service fait).

   Pourquoi : un import « Dépenses » depuis un fichier (CSV exporté, collage
   sans hyperliens…) n’apporte que les NUMÉROS (N° devis, N° BC, N° facture…),
   les adresses des documents sont perdues. Ces fichiers existent pourtant
   déjà sur Google Drive, classés dans le dossier du dataset :
        Lab Workspace › <dataset> › Budget_labo › <année> › Devis | BC | BL | OM | Factures
   relinkDepenseDocuments() retrouve le fichier dont le nom contient le numéro
   et remet l’adresse cliquable dans le champ « …Url » correspondant — les
   numéros redeviennent alors cliquables dans les tableaux.
   fileDepenseDocuments() classe ensuite chaque document lié dans le bon
   sous-dossier Budget_labo/<année>/<type> (dossiers créés si besoin).
   ========================================================================= */
import {
  cloudBackendAvailable,
  driveFetch,
  ensureDriveFolder,
  findFolderByName,
  getDriveToken,
  listDriveChildren,
} from '../utils/driveUpload';
import { fileBudgetDocs } from './driveFiling';

const txtOf = (v) => (v === null || v === undefined ? '' : String(v).trim());

/* Recherche « tolérante » d’un numéro dans un nom de fichier : accents,
   espaces, tirets et ponctuation ignorés (« BC_2026-0041.pdf » retrouve le
   numéro « 2026 0041 » ou « 20260041 »). */
const normForMatch = (s) =>
  String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();

const fileMatchesCode = (name, code) => {
  const n = normForMatch(name);
  const c = normForMatch(code).replace(/\s+/g, '');
  if (!n || !c) return false;
  const compact = n.replace(/\s+/g, '');
  if (compact.includes(c)) return true;
  return n.split(/\s+/).some((token) => token.includes(c) || c.includes(token));
};

const firstOf = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txtOf(v)) return v;
  }
  return '';
};

/** Emplacements de lien manquants d’une dépense : pour chaque document dont le
 *  numéro est renseigné mais pas l’adresse Drive (devis, BC, facture, OM, BL
 *  et SF par livraison). */
export const depenseDocSlots = (rec) => {
  const out = [];
  const topPairs = [
    { codes: ['numDevis', 'devisNo', 'numdevis'], urls: ['numDevisUrl', 'devisUrl'] },
    { codes: ['numBC', 'bcNo', 'numbc'], urls: ['numBCUrl', 'bcUrl'] },
    { codes: ['numFacture', 'factureNo', 'numfacture'], urls: ['numFactureUrl', 'factureUrl'] },
    { codes: ['omNo', 'om', 'numOM'], urls: ['omUrl'] },
  ];
  topPairs.forEach((pair) => {
    const code = firstOf(rec, pair.codes);
    if (!code || firstOf(rec, pair.urls)) return;
    out.push({ code, urlField: pair.urls[0], record: rec });
  });
  const livraisons = Array.isArray(rec && rec.livraisons) ? rec.livraisons : [];
  livraisons.forEach((liv, i) => {
    [
      { codes: ['numBL', 'blNo', 'numbL'], urls: ['numBLUrl', 'blUrl'] },
      { codes: ['numSF', 'sfNo', 'numsf'], urls: ['numSFUrl', 'sfUrl'] },
    ].forEach((pair) => {
      const code = firstOf(liv, pair.codes);
      if (!code || firstOf(liv, pair.urls)) return;
      out.push({ code, urlField: pair.urls[0], record: rec, livraisonIndex: i });
    });
  });
  return out;
};

const driveViewUrlOf = (id) => `https://drive.google.com/file/d/${id}/view`;

/** Partage « toute personne disposant du lien » (lecture) pour que le lien soit
 *  ouvrable par les membres du laboratoire — best-effort. */
const shareFileIfNeeded = async (fileId) => {
  try {
    const res = await driveFetch(`/drive/v3/files/${fileId}/permissions?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    await res.json();
  } catch { /* fichier déjà partagé ou non créé par l’app — le lien reste valable */ }
  return driveViewUrlOf(fileId);
};

/** Liste « plate » des fichiers rangés dans Budget_labo (quel que soit l’année
 *  ou le sous-dossier) + ceux restés à la racine du dataset (déplacements
 *  anciens). Une liste d’appels Drive limitée : Budget_labo → années →
 *  sous-dossiers de documents. */
const collectBudgetFiles = async () => {
  const out = [];
  let datasetRoot = '';
  try { datasetRoot = await ensureDriveFolder(); } catch { return out; }
  if (!datasetRoot) return out;

  const pushFolder = async (folderId, year, kind) => {
    let children = [];
    try { children = await listDriveChildren(folderId); } catch { return; }
    (Array.isArray(children) ? children : []).forEach((f) => {
      if (!f || f.mimeType === 'application/vnd.google-apps.folder') return;
      out.push({
        id: String(f.id),
        name: String(f.name || ''),
        year: String(year || ''),
        kind: String(kind || ''),
      });
    });
  };

  const bl = await findFolderByName('Budget_labo', datasetRoot);
  if (bl) {
    let years = [];
    try { years = await listDriveChildren(bl); } catch { /* ignore */ }
    for (const year of years) {
      if (!year || year.mimeType !== 'application/vnd.google-apps.folder') continue;
      await pushFolder(year.id, year.name, '');
      let kinds = [];
      try { kinds = await listDriveChildren(year.id); } catch { continue; }
      for (const kind of kinds) {
        if (!kind || kind.mimeType !== 'application/vnd.google-apps.folder') continue;
        await pushFolder(kind.id, year.name, kind.name);
      }
    }
  }
  // Fichiers restés à la racine du dataset (placements antérieurs à la
  // structure Budget_labo) — on les retrouve aussi par leur numéro.
  await pushFolder(datasetRoot, '', '');
  return out;
};

const findBudgetFile = (index, code) => {
  const list = Array.isArray(index) ? index : [];
  for (const f of list) {
    if (fileMatchesCode(f && f.name, code)) return f;
  }
  return null;
};

/* Petit cache (quelques minutes) pour ne pas re-scanner les dossiers Drive et
   ne pas re-publier les permissions à chaque re-rendu / re-relink : la liste
   des fichiers Budget_labo change rarement pendant une session. */
const BUDGET_FILE_INDEX_TTL = 3 * 60 * 1000;
let budgetFileIndexCache = null;
let budgetFileIndexCacheAt = 0;
const budgetCodeUrlCache = new Map(); // code → { url, at }

const cachedBudgetFiles = async () => {
  const now = Date.now();
  if (budgetFileIndexCache && now - budgetFileIndexCacheAt < BUDGET_FILE_INDEX_TTL) {
    return budgetFileIndexCache;
  }
  budgetFileIndexCache = await collectBudgetFiles();
  budgetFileIndexCacheAt = now;
  return budgetFileIndexCache;
};

const cachedUrlForCode = async (code) => {
  const hit = budgetCodeUrlCache.get(code);
  if (hit && Date.now() - hit.at < BUDGET_FILE_INDEX_TTL) return hit.url;
  let url = '';
  try {
    const index = await cachedBudgetFiles();
    const found = findBudgetFile(index, code);
    if (found) url = await shareFileIfNeeded(found.id);
  } catch { url = ''; }
  budgetCodeUrlCache.set(code, { url, at: Date.now() });
  return url;
};

/**
 * Retrouve sur Google Drive le document correspondant au numéro de chaque
 * dépense (N° devis / BC / facture / OM, et BL / SF de chaque livraison) et
 * renvoie les correctifs à appliquer (champ « …Url » renseigné) — les numéros
 * redeviennent cliquables dans les tableaux.
 * @returns {Promise<{updates:Array<{id:string,patch:Object}>, linked:number,
 *           skipped:number}>}
 */
export const relinkDepenseDocuments = async (records) => {
  const list = (Array.isArray(records) ? records : []).filter((r) => r && r.id);
  const pending = [];
  list.forEach((r) => depenseDocSlots(r).forEach((slot) => pending.push(slot)));
  if (!pending.length) return { updates: [], linked: 0, skipped: 0 };
  if (!cloudBackendAvailable() || !getDriveToken()) {
    return { updates: [], linked: 0, skipped: pending.length };
  }

  const byRecord = new Map(); // id → { record, patch }
  let linked = 0;
  for (const slot of pending) {
    const url = await cachedUrlForCode(slot.code);
    if (!url) continue;
    let entry = byRecord.get(slot.record.id);
    if (!entry) {
      entry = { record: slot.record, patch: {} };
      byRecord.set(slot.record.id, entry);
    }
    if (slot.livraisonIndex === undefined) {
      entry.patch[slot.urlField] = url;
    } else {
      if (!entry.patch.livraisons) {
        entry.patch.livraisons = (Array.isArray(slot.record.livraisons)
          ? slot.record.livraisons
          : []).map((l) => ({ ...(l || {}) }));
      }
      entry.patch.livraisons[slot.livraisonIndex] = {
        ...(entry.patch.livraisons[slot.livraisonIndex] || {}),
        [slot.urlField]: url,
      };
    }
    linked += 1;
  }

  const updates = [];
  byRecord.forEach((entry) => updates.push({ id: entry.record.id, patch: entry.patch }));
  return { updates, linked, skipped: pending.length - linked };
};

/**
 * Classe sur Google Drive chaque document lié d’une dépense dans le dossier
 *  Budget_labo/<année>/<Devis|BC|BL|OM|Factures> (best-effort, dossiers créés
 *  si besoin) : une COPIE du fichier — jamais un déplacement de l’original —
 *  est déposée au bon endroit. Appelé après un import « Dépenses » pour que
 *  les fichiers importés atterrissent bien dans le classement du budget.
 * @returns {Promise<{copied:number, renamed:number, attempted:number, failed:number}>}
 */
export const fileDepenseDocuments = async (records, { year } = {}) => {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  const out = { copied: 0, renamed: 0, attempted: 0, failed: 0 };
  if (!list.length || !cloudBackendAvailable() || !getDriveToken()) return out;
  for (const rec of list) {
    try {
      const res = await fileBudgetDocs(rec, { year });
      if (res) {
        out.copied += res.copied || 0;
        out.renamed += res.renamed || 0;
        out.attempted += res.attempted || 0;
        out.failed += Array.isArray(res.failed) ? res.failed.length : 0;
      }
    } catch { /* un échec de classement ne bloque jamais le reste */ }
  }
  return out;
};
