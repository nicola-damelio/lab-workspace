/* =========================================================================
   src/administration/driveFiling.js
   Classement automatique sur Google Drive des documents liés d'une dépense.

   Au moment d'enregistrer une dépense, chaque lien Google Drive collé dans un
   champ « lien document » (devis, BC, facture, OM, BL/SF par livraison) est
   COPIÉ dans le dossier de classement du budget, sous le dossier du dataset :

        Lab Workspace › <dataset> › Budget_labo › <année> › Devis
                                                      › BC
                                                      › BL
                                                      › OM
                                                      › Factures

   - l'année est l'année courante (ou celle passée en argument) ;
   - les dossiers manquants sont créés automatiquement (chaîne entière) ;
   - le fichier d'origine n'est JAMAIS déplacé : s'il est ailleurs, une copie est
     créée au bon endroit et reçoit le nom de la convention (quand le N° du
     document est connu, ex. Devis_<N°>_<ligne>_<fournisseur>_<demandeur>_<date>) ;
   - un fichier déjà DANS le dossier de classement avec un nom déjà conforme
     n'est pas touché ; s'il y est avec un nom non conforme (document déposé à
     la main, ancienne convention, N° pas en 2e position…), il est RENOMMÉ sur
     place (même fichier → le lien reste valide, jamais de doublon) ; le
     classement peut être relancé sans rien dupliquer ;
   - tout est best-effort : un fichier non copiable (Drive non connecté,
     permissions insuffisantes…) garde son lien d'origine et est signalé.
   ========================================================================= */
import {
  cloudBackendAvailable,
  driveFetch,
  findDriveFileByName,
  renameDriveFile,
  resolveDrivePathFromNames,
  sharedWorkspaceMode,
} from '../utils/driveUpload';
import { APPROVAL_APPROVED } from './adminSchema';

/** Nom du dossier Drive (dans Budget_labo/<année>/…) associé à chaque champ
 *  « lien document » d'une dépense. Les documents « service fait » (SF / PV de
 *  réception) sont rangés avec le bon de livraison (BL) de leur livraison.
 *  Les « états liquidatifs » des remboursements (fichiers signés validant le
 *  remboursement) sont rangés dans le dossier « OM » de l’année. */
export const BUDGET_DOC_FOLDER_BY_FIELD = {
  numDevisUrl: 'Devis',
  numBCUrl: 'BC',
  numFactureUrl: 'Factures',
  omUrl: 'OM',
  etatLiquidatifUrl: 'OM',
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
 *  date ISO (AAAA-MM-JJ). `description` (optionnelle) est ajoutée APRÈS un « _ »
 *  à la fin du titre pour reconnaître l’objet du document :
 *    Devis_<N°>_<ligne>_<fournisseur>_<demandeur>_<date>_<description>
 *  Chaque partie vide est simplement omise. */
export const budgetDocFileName = ({ prefix, code, ligne, fournisseur, demandeur, date, description, fileName = '' } = {}) => {
  const parts = [prefix, code, ligne, fournisseur, demandeur, date, description]
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

/* ── Nom à donner à la COPIE classée ─────────────────────────────────────────
   La copie posée dans Budget_labo/<année>/<type> reçoit le nom de la convention
   du laboratoire (mêmes règles que le bouton « ⬆ PC » du formulaire) :
   Devis_<N° devis>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>… avec
   l'extension du fichier d'origine. Le nom n'est conventionnel que si le N° du
   document est connu ; sinon on garde le nom d'origine (jamais d'extension
   perdue). Les documents devis / BC « Approuvé » reçoivent en plus la marque
   « _approuvé », comme au dépôt. */

/** Métadonnées de nommage d'un champ « lien document » d'une DÉPENSE : type du
 *  document (préfixe du nom), clé du N° correspondant et date(s) à préférer.
 *  Les BL / SF sont portés par leur livraison (sujet passé séparément). */
const DEPENSE_SLOT_NAME_META = {
  numDevisUrl: { prefix: 'Devis', code: 'numDevis', dates: ['dateSignatureDevis'] },
  numBCUrl: { prefix: 'BC', code: 'numBC', dates: ['dateBC'] },
  numFactureUrl: { prefix: 'Facture', code: 'numFacture', dates: ['dateFacture'] },
  omUrl: { prefix: 'OM', code: 'omNo', dates: [] },
  /* État liquidatif d’un remboursement : classé dans « OM », nommé d’après le
     N° OM / référence porté par la fiche Remboursement (collection dédiée). */
  etatLiquidatifUrl: { prefix: 'OM', code: 'numOM', dates: [] },
  numBLUrl: { prefix: 'BL', code: 'numBL', dates: ['dateReception'] },
  numSFUrl: { prefix: 'SF', code: 'numSF', dates: ['dateServiceFait'] },
};

const strOf = (v) => String(v ?? '').trim();

/** Nom conventionnel à donner à la COPIE d'un document lié, ou '' quand aucun
 *  N° de document n'est connu (on conserve alors le nom d'origine). `subject`
 *  est la livraison pour un BL / SF, sinon la dépense elle-même ; `srcName`
 *  est le nom actuel du fichier sur Drive (il fournit l'extension). */
export const budgetDocCopyName = (rec, field, subject, srcName) => {
  if (!rec) return '';
  const isApproval = rec.kind === 'devis' || rec.kind === 'bc';
  const meta = isApproval ? null : (DEPENSE_SLOT_NAME_META[field] || null);
  let prefix = '';
  let code = '';
  if (isApproval) {
    prefix = rec.kind === 'bc' ? 'BC' : 'Devis';
    code = strOf(rec.kind === 'bc' ? rec.numBC : rec.numDevis);
  } else if (meta) {
    prefix = meta.prefix;
    code = strOf(subject && subject[meta.code]);
  }
  if (!code) return '';
  let date = '';
  if (isApproval) {
    date = strOf(rec.date || rec.dateDepot);
  } else if (meta && meta.dates.length) {
    for (const k of meta.dates) {
      const d = strOf(subject && subject[k]);
      if (d) { date = d; break; }
    }
  }
  let name = budgetDocFileName({
    prefix,
    code,
    ligne: strOf(rec.ligneBudgetaire),
    fournisseur: strOf(rec.fournisseur),
    demandeur: strOf(rec.demandeur),
    date: date || strOf(rec.dateDemande),
    /* L’objet du document (description de la dépense / du devis / du
       remboursement) termine le titre après un « _ » : il permet de reconnaître
       le document sans l’ouvrir. */
    description: strOf(rec.description),
    fileName: strOf(srcName),
  });
  if (isApproval && rec.statut === APPROVAL_APPROVED && !hasApprovedSuffix(name)) {
    name = withApprovedSuffix(name);
  }
  return name;
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

/* ── Renommage sur place d'un fichier déjà dans son dossier ──────────────────
   Un fichier déjà DANS le bon dossier de classement mais dont le nom n'est pas
   conforme à la convention (document déposé à la main, ancienne convention, N°
   pas en 2e position…) est RENOMMÉ sur place : même fichier, même lien, jamais
   de doublon. Les marques officielles « _approuvé » / « _signé » sont
   conservées (un fichier déjà au bon endroit avec un nom conforme n'est pas
   touché). */

/** Séquence des marques officielles terminant un nom (avant l'extension),
 *  ex. « …_approuvé_signé.pdf » → « _approuvé_signé » ; '' si aucune. */
const officialMarksOf = (name) => {
  const base = String(name || '').replace(/\.[^./\\]+$/, '');
  const m = /((_approuv(?:é|e))|(_signé))+$/i.exec(base);
  return m ? m[0] : '';
};

const officialMarksList = (seq) => (String(seq || '').match(/_(?:approuv(?:é|e)|signé)/gi) || []);

/** Nouveau nom conforme qui conserve toutes les marques officielles du nom
 *  actuel (« _approuvé », « _signé ») que la convention n'aurait pas déjà
 *  reproduites — un renommage ne retire jamais une de ces marques. */
const preserveOfficialMarks = (target, srcName) => {
  const ext = driveFileExtensionOf(target);
  const base = String(target).slice(0, target.length - ext.length);
  const tMarks = officialMarksOf(base);
  const srcMarks = officialMarksOf(srcName);
  const want = [];
  for (const mk of officialMarksList(srcMarks)) {
    const have = (x) => String(x).toLowerCase().replace(/[ée]/gi, 'e');
    if (!officialMarksList(tMarks).some((t) => have(t) === have(mk))) want.push(mk);
  }
  const clean = tMarks ? base.slice(0, -tMarks.length) : base;
  return `${clean}${tMarks}${want.join('')}${ext}`;
};

/** Copie un fichier Google Drive dans un dossier de classement, avec le nom
 *  conventionnel demandé — le fichier d'origine n'est JAMAIS déplacé ni modifié
 *  (l'application ne retire plus jamais un fichier du dossier où il se trouve :
 *  elle dépose une copie au bon endroit). Quand le fichier est DÉJÀ dans le
 *  dossier de classement :
 *    · nom déjà conforme → on ne fait rien (« already ») ;
 *    · nom non conforme et N° connu → il est RENOMMÉ sur place, même fichier
 *      donc même lien, jamais de doublon (« renamed »).
 *  Quand il est ailleurs mais qu'une copie portant exactement le nom
 *  conventionnel existe déjà dans le dossier, on ne fait rien non plus.
 *  « Ranger » est donc relançable sans jamais rien dupliquer.
 *  @param {string} fileId   identifiant du fichier d'origine (le lien collé)
 *  @param {string} folderId dossier de classement Budget_labo/…/<type>
 *  @param {(srcName:string)=>string} nameFor  nom conforme à donner (copie ou
 *         renommage), calculé à partir du nom actuel ('' → on garde l'existant)
 *  @returns {'copied'|'renamed'|'already'} */
const copyDriveFileIntoFolder = async (fileId, folderId, nameFor) => {
  const metaRes = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,parents,trashed`);
  const meta = await metaRes.json();
  if (!meta || !meta.id) throw new Error('Fichier Google Drive introuvable.');
  const parents = Array.isArray(meta.parents) ? meta.parents : [];
  const srcName = String(meta.name || '').trim();
  const canonical = String((typeof nameFor === 'function' && nameFor(srcName)) || '')
    .trim()
    .slice(0, 200);
  if (parents.indexOf(folderId) !== -1) {
    // Déjà classé au bon endroit : renommer seulement si un nom conforme est
    // possible (N° du document connu) ET que le nom actuel ne l'est pas déjà.
    if (!canonical) return 'already';
    const target = preserveOfficialMarks(canonical, srcName);
    if (target.toLowerCase() === srcName.toLowerCase()) return 'already';
    const ok = await renameDriveFile(fileId, target);
    return ok ? 'renamed' : 'already';
  }
  const name = canonical || srcName || 'document';
  // Relançable sans doublon : une copie de même nom existe déjà dans le dossier.
  if (await findDriveFileByName(name, folderId)) return 'already';
  const res = await driveFetch(`/drive/v3/files/${fileId}/copy?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const j = await res.json();
  if (!j || !j.id) throw new Error("Google Drive n'a pas confirmé la copie du fichier.");
  return 'copied';
};

/** Emplacements « lien document » renseignés d’un enregistrement budget
 *  (dépense ou devisBc de la page Approbation) : champ, dossier de classement,
 *  sujet de nommage et, pour les BL / SF, l’index de la livraison. Mêmes règles
 *  que fileBudgetDocs() — cette liste alimente aussi le ré-import des documents
 *  inaccessibles (./driveReimport.js). */
export const budgetDocLinkSlots = (rec) => {
  const out = [];
  const push = (field, url, subject, livraisonIndex) => {
    const folder = BUDGET_DOC_FOLDER_BY_FIELD[field];
    const s = String(url || '').trim();
    if (folder && s) out.push({ field, folder, url: s, subject: subject || null, livraisonIndex });
  };
  Object.keys(BUDGET_DOC_FOLDER_BY_FIELD).forEach((key) => push(key, rec && rec[key], rec));
  (Array.isArray(rec && rec.livraisons) ? rec.livraisons : []).forEach((l, i) => {
    push('numBLUrl', l && l.numBLUrl, l, i);
    push('numSFUrl', l && l.numSFUrl, l, i);
  });
  /* Enregistrements de la page « Approbation devis & BC » (collection devisBc) :
     chaque ligne porte un fichier unique dans `fichierUrl` — Devis → /Devis,
     BC → /BC (les documents déjà téléversés depuis l’app sont déjà au bon
     endroit ; un fichier collé en lien depuis ailleurs est COPIÉ ici — jamais
     déplacé : l'original reste où il est). */
  if (rec && (rec.kind === 'devis' || rec.kind === 'bc')) {
    push(rec.kind === 'devis' ? 'numDevisUrl' : 'numBCUrl', rec.fichierUrl, rec);
  }
  return out;
};


/**
 * Range dans Budget_labo/<année>/<Devis|BC|BL|OM|Factures> chaque document
 * Google Drive lié à une dépense (champs numDevisUrl, numBCUrl, numFactureUrl,
 * omUrl et, par livraison, numBLUrl / numSFUrl). Crée les dossiers manquants.
 * Un fichier ailleurs qu’à son emplacement est COPIÉ (jamais déplacé) au bon
 * endroit, avec le nom de la convention (quand le N° du document est connu) ;
 * un fichier DÉJÀ au bon endroit mais au nom non conforme est RENOMMÉ sur
 * place (même fichier, même lien — pas de doublon).
 *
 * @param {object} rec  dépense normalisée (clés …Url au niveau racine et dans
 *                      `livraisons[]`), telle qu'enregistrée par la page — ou
 *                      enregistrement `devisBc` (page Approbation devis & BC).
 * @param {object} [opts]
 * @param {number|string} [opts.year]  année du classement (défaut : année courante)
 * @returns {Promise<{attempted:number,copied:number,renamed:number,skipped:number,
 *           failed:Array<{field:string,folder:string,url:string,reason:string}>}>}
 */
export const fileBudgetDocs = async (rec, { year } = {}) => {
  const links = budgetDocLinkSlots(rec);
  if (!links.length) return { attempted: 0, copied: 0, renamed: 0, skipped: 0, failed: [] };

  if (!cloudBackendAvailable()) {
    return {
      attempted: links.length,
      copied: 0,
      renamed: 0,
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
  const folderError = {}; // folder → message d’échec (pour les liens qui tentent la copie)
  const out = { attempted: 0, copied: 0, renamed: 0, skipped: 0, failed: [] };

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
  //    pas un fichier Google Drive copiable (lien externe, dossier…). C'est ce
  //    qui faisait défaut : aucune création de dossier lors de l'enregistrement.
  const folders = [...new Set(links.map((l) => l.folder))];
  for (const folder of folders) await ensureFolder(folder);

  // 2) Classement des fichiers Google Drive liés dans le dossier de leur
  //    nature : un fichier ailleurs est COPIÉ (l'original reste en place) avec
  //    le nom de la convention ; un fichier déjà DANS le dossier au nom non
  //    conforme y est renommé sur place (même fichier → même lien, pas de
  //    doublon).
  for (const link of links) {
    const fileId = driveFileIdFromUrl(link.url);
    if (!fileId) {
      out.skipped += 1; // lien externe / dossier : rien à copier (le dossier existe déjà)
      continue;
    }
    out.attempted += 1;
    try {
      const folderId = await ensureFolder(link.folder);
      if (!folderId) {
        throw new Error(folderError[link.folder] || `dossier « ${link.folder} » inaccessible`);
      }
      const result = await copyDriveFileIntoFolder(fileId, folderId, (srcName) =>
        budgetDocCopyName(rec, link.field, link.subject || rec, srcName));
      if (result === 'copied') out.copied += 1;
      else if (result === 'renamed') out.renamed += 1;
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
