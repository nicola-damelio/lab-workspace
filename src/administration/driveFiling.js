/* =========================================================================
   src/administration/driveFiling.js
   Classement automatique sur Google Drive des documents liés d'une dépense.

   Au moment d'enregistrer une dépense, chaque lien Google Drive collé dans un
   champ « lien document » (devis, BC, facture, OM, BL/SF par livraison) est
   DÉPLACÉ dans le dossier de classement du budget, sous le dossier du dataset :

        Lab Workspace › <dataset> › Budget_labo › <année> › Devis
                                                      › BC
                                                      › BL
                                                      › OM
                                                      › Factures

   - l'année est l'année courante (ou celle passée en argument) ;
   - les dossiers manquants sont créés automatiquement (chaîne entière) ;
   - un fichier déjà présent au bon endroit n'est pas touché ;
   - tout est best-effort : un fichier non déplaçable (Drive non connecté,
     permissions insuffisantes…) garde son lien d'origine et est signalé.
   ========================================================================= */
import {
  cloudBackendAvailable,
  driveFetch,
  resolveDrivePathFromNames,
} from '../utils/driveUpload';

/** Nom du dossier Drive (dans Budget_labo/<année>/…) associé à chaque champ
 *  « lien document » d'une dépense. Les documents « service fait » (SF / PV de
 *  réception) sont rangés avec le bon de livraison (BL) de leur livraison. */
export const BUDGET_DOC_FOLDER_BY_FIELD = {
  numDevisUrl: 'Devis',
  numBCUrl: 'BC',
  numFactureUrl: 'Factures',
  omUrl: 'OM',
  numBLUrl: 'BL',
  numSFUrl: 'BL',
};

/** Chemin Drive relatif au dossier du dataset : Budget_labo/<année>/<type>. */
export const budgetDocPath = (year, folder) =>
  ['Budget_labo', String(year || new Date().getFullYear()), folder].filter(Boolean);

/** Identifiant d'un FICHIER Google Drive (jamais d'un dossier) extrait d'une
 *  URL de lien partagé. Renvoie '' pour un lien externe / non-Drive. */
export const driveFileIdFromUrl = (url) => {
  const s = String(url || '').trim();
  if (!s || !/drive\.google\.com/.test(s) || /drive\.google\.com\/drive\/(u\/\d+\/)?folders\//.test(s)) return '';
  // https://drive.google.com/open?id=…, /uc?id=…, /thumbnail?id=…
  const byParam = s.match(/[?&]id=([A-Za-z0-9_-]{8,})/);
  if (byParam) return byParam[1];
  // https://drive.google.com/file/d/<id>/view
  const byPath = s.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{8,})/);
  return byPath ? byPath[1] : '';
};

/** Déplace un fichier Drive dans un dossier (si ce n'est déjà fait).
 *  @returns {'moved'|'already'} */
const moveFileIntoFolder = async (fileId, folderId) => {
  const metaRes = await driveFetch(`/drive/v3/files/${fileId}?fields=id,parents`);
  const meta = await metaRes.json();
  const parents = Array.isArray(meta.parents) ? meta.parents : [];
  if (parents.indexOf(folderId) !== -1) return 'already';
  const params = new URLSearchParams();
  params.set('addParents', folderId);
  parents.forEach((p) => {
    if (p !== folderId) params.append('removeParents', p);
  });
  await driveFetch(`/drive/v3/files/${fileId}?${params.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  return 'moved';
};

/**
 * Range dans Budget_labo/<année>/<Devis|BC|BL|OM|Factures> chaque document
 * Google Drive lié à une dépense (champs numDevisUrl, numBCUrl, numFactureUrl,
 * omUrl et, par livraison, numBLUrl / numSFUrl). Crée les dossiers manquants.
 *
 * @param {object} rec  dépense normalisée (clés …Url au niveau racine et dans
 *                      `livraisons[]`), telle qu'enregistrée par la page.
 * @param {object} [opts]
 * @param {number|string} [opts.year]  année du classement (défaut : année courante)
 * @returns {Promise<{attempted:number,moved:number,skipped:number,
 *           failed:Array<{field:string,folder:string,url:string,reason:string}>}>}
 */
export const fileBudgetDocs = async (rec, { year } = {}) => {
  const links = [];
  const push = (field, url) => {
    const folder = BUDGET_DOC_FOLDER_BY_FIELD[field];
    const s = String(url || '').trim();
    if (folder && s) links.push({ field, folder, url: s });
  };
  Object.keys(BUDGET_DOC_FOLDER_BY_FIELD).forEach((key) => push(key, rec && rec[key]));
  (Array.isArray(rec && rec.livraisons) ? rec.livraisons : []).forEach((l) => {
    push('numBLUrl', l && l.numBLUrl);
    push('numSFUrl', l && l.numSFUrl);
  });
  if (!links.length) return { attempted: 0, moved: 0, skipped: 0, failed: [] };

  if (!cloudBackendAvailable()) {
    return {
      attempted: links.length,
      moved: 0,
      skipped: 0,
      failed: links.map((l) => ({
        field: l.field,
        folder: l.folder,
        url: l.url,
        reason: 'Google Drive n’est pas connecté.',
      })),
    };
  }

  const targetYear = year || new Date().getFullYear();
  const leafCache = {}; // folder → id Drive (résolu une seule fois)
  const folderError = {}; // folder → message d’échec (pour les liens qui tentent le déplacement)
  const out = { attempted: 0, moved: 0, skipped: 0, failed: [] };

  /** Crée / résout le dossier Budget_labo/<année>/<folder> (une seule fois). */
  const ensureFolder = async (folder) => {
    if (Object.prototype.hasOwnProperty.call(leafCache, folder)) return leafCache[folder];
    leafCache[folder] = '';
    folderError[folder] = '';
    try {
      const resolved = await resolveDrivePathFromNames(budgetDocPath(targetYear, folder));
      leafCache[folder] = resolved && resolved.leafId ? resolved.leafId : '';
      folderError[folder] = leafCache[folder]
        ? ''
        : `dossier « ${folder} » introuvable sur Google Drive`;
    } catch (err) {
      folderError[folder] = (err && err.message) || `dossier « ${folder} » inaccessible`;
    }
    return leafCache[folder];
  };

  // 1) Les dossiers Budget_labo/<année>/Devis|BC|BL|OM|Factures sont créés dès
  //    qu'un champ « lien document » est renseigné — même quand le lien n'est
  //    pas un fichier Google Drive déplaçable (lien externe, dossier…). C'est ce
  //    qui faisait défaut : aucune création de dossier lors de l'enregistrement.
  const folders = [...new Set(links.map((l) => l.folder))];
  for (const folder of folders) await ensureFolder(folder);

  // 2) Déplacement des fichiers Google Drive liés vers le dossier de leur nature.
  for (const link of links) {
    const fileId = driveFileIdFromUrl(link.url);
    if (!fileId) {
      out.skipped += 1; // lien externe / dossier : rien à déplacer (le dossier existe déjà)
      continue;
    }
    out.attempted += 1;
    try {
      const folderId = await ensureFolder(link.folder);
      if (!folderId) {
        throw new Error(folderError[link.folder] || `dossier « ${link.folder} » inaccessible`);
      }
      const result = await moveFileIntoFolder(fileId, folderId);
      if (result === 'moved') out.moved += 1;
      else out.skipped += 1;
    } catch (err) {
      out.failed.push({
        field: link.field,
        folder: link.folder,
        url: link.url,
        reason: (err && err.message) || 'erreur Google Drive inconnue',
      });
    }
  }
  return out;
};
