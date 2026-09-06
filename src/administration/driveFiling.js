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
  sharedWorkspaceMode,
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

/* ── Convention de nommage des documents budget sur Google Drive ────────────
   Chaque document STOCKÉ par l’application (bouton « ⬆ PC ») reçoit un nom qui
   commence par le type du document, son N°, puis les attributs de la dépense,
   séparés par des « _ » :

     BC_<n° BC>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>
     Devis_<n° devis>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>
     BL_<n° BL>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>

   Un devis / BC approuvé reçoit en plus le suffixe « _approuvé » à la fin du
   nom. Les parties vides sont omises ; l’extension du fichier d’origine est
   conservée. Le N° reste le 2e segment, ce qui préserve la recherche de N°
   faite par relinkDepenseDocuments() (./budgetLink.js). */

/** Nettoyage d’un fragment (une partie) de nom de fichier : les caractères que
 *  Google Drive n’accepte pas sont remplacés, les espaces resserrés. */
export const driveFileNamePart = (v, max = 60) =>
  String(v ?? '')
    .replace(/[\p{Cc}]/gu, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Extension (avec le point) d’un nom de fichier local, ex. « rapport.pdf » → « .pdf ». */
export const driveFileExtensionOf = (name) => {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? `.${m[1].toLowerCase()}` : '';
};

/** Construit le nom de fichier Drive d’un document budget d’une dépense selon
 *  la convention du laboratoire (voir commentaire ci-dessus). `prefix` est le
 *  type du document (« BC », « Devis », « BL »…) ; `code` son N° ; `date` une
 *  date ISO (AAAA-MM-JJ). Chaque partie vide est simplement omise. */
export const budgetDocFileName = ({ prefix, code, ligne, fournisseur, demandeur, date, fileName = '' } = {}) => {
  const parts = [prefix, code, ligne, fournisseur, demandeur, date]
    .map((p) => driveFileNamePart(p))
    .filter(Boolean);
  const base = parts.join('_').slice(0, 180);
  if (!base) return driveFileNamePart(String(fileName || 'document'));
  return `${base}${driveFileExtensionOf(fileName)}`;
};

/** Suffixe ajouté au nom d’un devis / BC approuvé. */
export const APPROVED_SUFFIX = '_approuvé';

/** Vrai si le nom de fichier porte déjà la marque « approuvé » (qu’elle soit
 *  suivie ou non d’une extension). */
export const hasApprovedSuffix = (name) =>
  /_approuv(é|e)\s*$/i.test(String(name || '').replace(/\.[^./\\]+$/, ''));

/** Ajoute (une seule fois) la marque « _approuvé » à la fin du nom donné
 *  (juste avant l’extension éventuelle). */
export const withApprovedSuffix = (name) => {
  const s = String(name || '');
  if (!s || hasApprovedSuffix(s)) return s;
  const base = s.replace(/\.[^./\\]+$/, '');
  return `${base}${APPROVED_SUFFIX}${driveFileExtensionOf(s)}`;
};

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

/** Traduit une erreur brute de l’API Drive en un message expliquant POURQUOI
 *  un document lié n’a pas pu être rangé — notamment le très fréquent
 *  « File not found » : le lien est valide dans le navigateur (l’utilisateur
 *  est connecté à son propre Google), mais l’application ne travaille pas dans
 *  le Drive personnel de l’utilisateur : elle range tout dans le Drive partagé
 *  « Lab Workspace » (compte du laboratoire). Un fichier qui y est invisible
 *  pour l’API est soit posé dans le Drive personnel sans être partagé avec le
 *  compte de l’app, soit créé directement dans Google Drive sans passer par
 *  l’application (limite « drive.file » : seuls les fichiers créés par l’app
 *  ou partagés avec elle sont visibles). */
const filingReasonOf = (msg) => {
  const s = String(msg || '');
  if (/not ?found|404|no file id/i.test(s)) {
    // Cause exacte selon le mode d’installation :
    //  · partagé (serveur « Lab Workspace ») → l’app n’est pas connectée au Drive
    //    personnel de l’utilisateur : un fichier non partagé avec le compte du
    //    laboratoire y est invisible ;
    //  · personnel → autorisation Google « drive.file » : l’app ne voit que les
    //    fichiers qu’elle a créés elle-même, pas ceux déposés à la main dans le
    //    Drive (même s’ils appartiennent au même compte).
    const why = sharedWorkspaceMode()
      ? 'l’app classe tout dans le Drive partagé « Lab Workspace » (compte du laboratoire), '
      + 'et non dans votre Drive Google personnel : un fichier resté dans votre compte sans être '
      + 'partagé avec le compte de l’app y reste invisible'
      : 'l’app n’a accès qu’aux fichiers qu’elle a créés elle-même (autorisation Google limitée '
      + '« drive.file ») : un fichier déposé directement dans votre Google Drive — même par vous, '
      + 'dans votre propre compte — reste invisible pour elle';
    return `fichier INACCESSIBLE à l’application (le lien s’ouvre chez vous, pas pour elle) : ${why}. `
      + 'Le plus simple : téléversez le document depuis ce PC avec « ⬆ PC » — l’app crée sa propre '
      + 'copie dans Budget_labo et la range automatiquement.';
  }
  if (/permission|403|insufficient|scope/i.test(s)) {
    return 'permissions insuffisantes : partagez le fichier avec le compte Google connecté dans l’app.';
  }
  if (/trash|corbeille/i.test(s)) return 'le fichier est dans la corbeille Google Drive — restaurez-le d’abord.';
  return s;
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
  /* Enregistrements de la page « Approbation devis & BC » (collection devisBc) :
     chaque ligne porte un fichier unique dans `fichierUrl` — Devis → /Devis,
     BC → /BC (les documents déjà téléversés depuis l’app sont déjà au bon
     endroit ; un fichier collé en lien depuis ailleurs est déplacé ici). */
  if (rec && (rec.kind === 'devis' || rec.kind === 'bc')) {
    push(rec.kind === 'devis' ? 'numDevisUrl' : 'numBCUrl', rec.fichierUrl);
  }
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
        reason: filingReasonOf((err && err.message) || 'erreur Google Drive inconnue'),
      });
    }
  }
  return out;
};
