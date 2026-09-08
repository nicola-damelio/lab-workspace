/* =========================================================================
   src/administration/driveReimport.js

   Ré-importe comme COPIES de l'application les documents budget Google Drive
   que l'app ne voit pas (autorisation limitée « drive.file » : elle ne voit
   que les fichiers qu'elle a elle-même créés). Pour chaque lien Drive
   inaccessible, les OCTETS du fichier sont téléchargés par son adresse
   PUBLIQUE (partage « Toute personne disposant du lien » — un dossier
   Budget_labo partagé suffit) puis ré-téléversés via le compte de l'app dans
   Budget_labo/<année>/<Devis|BC|BL|OM|Factures> sous le nom de la convention.
   Le lien enregistré dans la dépense est remplacé par celui de la copie —
   même apparence, mais désormais visible et classée par l'app. L'original
   déposé à la main n'est JAMAIS supprimé.

   Quand une copie du même nom existe déjà dans le dossier (créée par « Ranger
   les liens Drive » ou un ré-import précédent), la dépense est simplement
   RELIÉE à cette copie : jamais de doublon, jamais d'écrasement — même règle
   de dédoublonnage que le classement ordinaire.
   ========================================================================= */
import {
  cloudBackendAvailable,
  findDriveFileByName,
  getDriveFileMeta,
  resolveDrivePathFromNames,
  uploadLocalFile,
} from '../utils/driveUpload';
import { downloadDriveFileBytes } from '../utils/migrateTestImages';
import {
  budgetDocCopyName,
  budgetDocFileName,
  budgetDocLinkSlots,
  budgetDocPath,
  driveFileIdFromUrl,
} from './driveFiling';

const txtOf = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Libellé humain d'un enregistrement pour les comptes rendus. */
const recordLabel = (rec) => {
  if (!rec) return '';
  return txtOf(rec.description)
    || txtOf(rec.numBC || rec.numSIFAC || rec.numFacture || rec.omNo || rec.numDevis)
    || txtOf(rec.id);
};

/** Extension (avec le point) à partir du type MIME — secours quand le
 *  téléchargement public n'a pas renvoyé de nom de fichier. */
const MIME_EXT = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip',
  'application/rtf': '.rtf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',
};
const mimeExtOf = (mime) =>
  MIME_EXT[String(mime || '').split(';')[0].trim()] || '';

/** Ré-import d'UN lien : renvoie { status:'accessible' } quand le fichier est
 *  déjà visible par l'app (le classement ordinaire s'en charge), sinon
 *  { status:'imported', adopted, url } après téléchargement public + dépôt
 *  d'une copie de l'app dans Budget_labo/<année>/<type>. Jette une Error
 *  détaillée quand le fichier n'est ni visible ni téléchargeable. */
const reimportOne = async ({ rec, slot, fileId, year, folderCache }) => {
  /* Fichier déjà visible par l'app (créé par elle) : rien à ré-importer —
     « Ranger les liens Drive » le copie/renomme à sa place habituelle. */
  try {
    await getDriveFileMeta(fileId);
    return { status: 'accessible' };
  } catch { /* invisible sous drive.file → ré-import ci-dessous */ }

  /* Les octets passent par l'adresse PUBLIQUE (aucune autorisation nécessaire
     pour lire un fichier public, alors que l'API exige drive.file). */
  let dl;
  try {
    dl = await downloadDriveFileBytes(fileId);
  } catch (err) {
    throw new Error(
      `téléchargement public impossible (${((err && err.message) || 'inconnu')}) — `
      + 'partagez le dossier Google Drive en « Toute personne disposant du lien » puis relancez, '
      + 'ou téléversez ce document depuis ce PC avec « ⬆ PC ».'
    );
  }

  /* Nom de la convention (Devis_<N°>_<ligne>_…), comme pour le classement
     ordinaire ; sans N° connu on garde le nom réel du fichier téléchargé. */
  const srcName = txtOf(dl.name) || `document${mimeExtOf(dl.mimeType)}`;
  const canonical = budgetDocCopyName(rec, slot.field, slot.subject || rec, srcName);
  const name = txtOf(canonical) || budgetDocFileName({ fileName: srcName });

  // Dossier Budget_labo/<année>/<type> (créé si besoin — résolu une seule fois).
  let folderId = folderCache.get(slot.folder);
  if (!folderId) {
    const resolved = await resolveDrivePathFromNames(budgetDocPath(year, slot.folder));
    folderId = resolved && resolved.leafId ? resolved.leafId : '';
    if (!folderId) throw new Error(`dossier « ${slot.folder} » inaccessible sur Google Drive`);
    folderCache.set(slot.folder, folderId);
  }

  /* Une copie de l'app porte déjà ce nom dans le dossier ? On RELIE la dépense
     à cette copie (dédoublonnage) au lieu d'empiler ou d'écraser un fichier. */
  const existingId = await findDriveFileByName(name, folderId);
  if (existingId) {
    return { status: 'imported', adopted: true, url: `https://drive.google.com/file/d/${existingId}/view` };
  }

  const drive = await uploadLocalFile({
    name: name.slice(0, 200),
    mimeType: dl.mimeType || 'application/octet-stream',
    file: new Blob([dl.bytes], { type: dl.mimeType || 'application/octet-stream' }),
    path: budgetDocPath(year, slot.folder),
  });
  if (!drive || !drive.driveUrl) {
    throw new Error("le téléversement n'a pas été confirmé par Google Drive (non connecté ?)");
  }
  return { status: 'imported', adopted: false, url: drive.driveUrl };
};

/**
 * Ré-importe comme copies de l'application les documents Google Drive liés aux
 * dépenses (devis, BC, facture, OM, BL/SF — y compris les enregistrements
 * `devisBc`) que l'app ne peut pas voir (fichiers déposés à la main ; limite
 * « drive.file ») et qui sont téléchargeables par leur adresse publique.
 * Renvoie les correctifs à appliquer (champ « …Url » remplacé) sous la forme
 * attendue par updateMany() de la page.
 *
 * @param {Array} records   dépenses (ou devisBc) normalisées
 * @param {Object} [opts]
 * @param {number|string} [opts.year]  année du classement (défaut : année courante)
 * @param {number} [opts.concurrency]  téléchargements simultanés (défaut : 3)
 * @param {Function} [opts.onProgress] reçoit { done, total } à chaque document traité
 * @returns {Promise<{imported:number, adopted:number, accessible:number,
 *           skipped:number, failed:Array, updates:Array<{id:string,patch:Object}>,
 *           details:Array}>}
 */
export const reimportBudgetDriveDocs = async (records, {
  year,
  concurrency = 3,
  onProgress = () => {},
} = {}) => {
  const recs = (Array.isArray(records) ? records : []).filter((r) => r && r.id);
  const targetYear = year || new Date().getFullYear();
  const out = {
    imported: 0,
    adopted: 0,
    accessible: 0,
    skipped: 0,
    failed: [],
    updates: [],
    details: [],
  };

  // 1) Tous les liens Drive « fichier » (les liens externes / de dossier sont
  //    ignorés : rien à ré-importer — la dépense garde son lien d'origine).
  const tasks = [];
  for (const rec of recs) {
    for (const slot of budgetDocLinkSlots(rec)) {
      const fileId = driveFileIdFromUrl(slot.url);
      if (!fileId) { out.skipped += 1; continue; }
      tasks.push({ rec, slot, fileId });
    }
  }
  if (!tasks.length) return out;

  // 2) Drive joignable ? Sans Drive configuré, impossible de déposer la copie
  //    (le renouvellement du jeton est géré par les appels API eux-mêmes).
  if (!cloudBackendAvailable()) {
    tasks.forEach(({ rec, slot }) => {
      out.failed.push({
        label: recordLabel(rec),
        field: slot.field,
        folder: slot.folder,
        reason: 'Google Drive n’est pas connecté.',
      });
    });
    return out;
  }

  // 3) Traitement avec un petit pool de téléchargements concurrents.
  const folderCache = new Map();
  const results = new Array(tasks.length);
  let cursor = 0;
  let settled = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= tasks.length) return;
      const { rec, slot, fileId } = tasks[i];
      try {
        results[i] = { rec, slot, ...(await reimportOne({ rec, slot, fileId, year: targetYear, folderCache })) };
      } catch (err) {
        results[i] = {
          rec, slot, status: 'failed', reason: (err && err.message) || 'erreur inconnue',
        };
      }
      settled += 1;
      onProgress({ done: settled, total: tasks.length });
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, () => worker())
  );
  // 4) Comptes rendus + correctifs de liens (un patch par enregistrement).
  const byRecord = new Map(); // id → { rec, patch }
  const applySlotUrl = (rec, patch, slot, url) => {
    if (slot.livraisonIndex === undefined) {
      patch[slot.field] = url;
      return;
    }
    if (!patch.livraisons) {
      patch.livraisons = (Array.isArray(rec.livraisons) ? rec.livraisons : [])
        .map((l) => ({ ...(l || {}) }));
    }
    patch.livraisons[slot.livraisonIndex] = {
      ...(patch.livraisons[slot.livraisonIndex] || {}),
      [slot.field]: url,
    };
  };

  results.forEach((r) => {
    if (!r) return;
    if (r.status === 'accessible') { out.accessible += 1; return; }
    if (r.status !== 'imported') {
      if (r.status === 'failed') {
        out.failed.push({
          label: recordLabel(r.rec),
          field: r.slot.field,
          folder: r.slot.folder,
          reason: r.reason,
        });
      } else {
        out.skipped += 1;
      }
      return;
    }
    if (r.adopted) out.adopted += 1; else out.imported += 1;
    out.details.push({ field: r.slot.field, folder: r.slot.folder, url: r.url, adopted: !!r.adopted });
    let entry = byRecord.get(r.rec.id);
    if (!entry) {
      entry = { rec: r.rec, patch: {} };
      byRecord.set(r.rec.id, entry);
    }
    applySlotUrl(entry.rec, entry.patch, r.slot, r.url);
  });
  byRecord.forEach((entry) => out.updates.push({ id: entry.rec.id, patch: entry.patch }));

  return out;
};


