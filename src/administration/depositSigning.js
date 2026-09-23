/* =========================================================================
   src/administration/depositSigning.js
   Signature du superutilisateur sur les documents devis / BC déposés.

   UN SEUL point d'entrée pour les deux endroits qui signent un devis :
     · la page « Approbation devis & BC » (bouton ✓ « Signer le devis ») ;
     · le transfert « ✓ Signature et BC » de la page « Achats prévus /
       souhaités » (le devis est signé immédiatement puis rangé dans la
       section « BC à faire et à approuver »).
   Rien n'est écrit ici : `buildSignedDeposit()` renvoie le correctif à
   appliquer à la ligne (fichier officiel + trace de signature) et l'appelant
   fait l'upsert — la signature reste « best-effort » (jamais bloquante).

   Ce qui est produit, quand une image de signature est enregistrée et que le
   fichier déposé est accessible sur Google Drive :
     Budget_labo/<année>/Devis|BC › <nom conventionnel>_approuvé_signé.pdf
   Cette copie (PDF, même si le dépôt était une image) devient le fichier
   officiel de la ligne ; l'original reste intact. Le nom conventionnel est
   reconstruit à la demande (« _approuvé » compris) pour que la copie signée
   d'un devis transféré porte elle aussi le bon nom.

   Les fonctions « pures » (type réel du fichier, noms conventionnels, data:URL
   d'une image) sont exportées séparément : elles sont vérifiées hors navigateur
   par les tests du dépôt.
   ========================================================================= */
import { APPROVAL_APPROVED } from './adminSchema';
import { uploadLocalFile, cloudBackendAvailable, driveFetch, renameDriveFile } from '../utils/driveUpload';
import {
  budgetDocFileName, driveFileIdFromUrl, hasApprovedSuffix, withApprovedSuffix,
} from './driveFiling';
import { stampPdfWithSignature, makeSignedPdfFromImage } from './approvalSignature';
import { downloadDriveFileBytes } from '../utils/migrateTestImages';

/* ── Petites aides ──────────────────────────────────────────────────────── */
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const isoOf = (v) => {
  const s = txt(v);
  return s ? s.slice(0, 10) : '';
};
const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ── Convention de nommage des fichiers déposés ───────────────────────────── */
/** Nom conventionnel du fichier déposé (N°, ligne, fournisseur, demandeur,
 *  date et objet) — voir ./driveFiling.js. Vide quand le N° du document
 *  (devis / BC) n'est pas encore connu : le nom d'origine est alors conservé. */
export const depositDocDriveNameOf = (r) => {
  const isBc = !!r && r.kind === 'bc';
  const code = txt(r && (isBc ? r.numBC : r.numDevis));
  if (!code) return '';
  return budgetDocFileName({
    prefix: isBc ? 'BC' : 'Devis',
    code,
    ligne: txt(r && r.ligneBudgetaire),
    fournisseur: txt(r && r.fournisseur),
    demandeur: txt(r && r.demandeur),
    date: txt(r && (r.date || r.dateDepot)),
    /* L’objet saisi (description) termine le nom après un « _ » : on reconnaît
       le contenu du document sans avoir à l’ouvrir. */
    description: txt(r && r.description),
    fileName: txt(r && r.fichierNom),
  });
};

/** Nom final attendu pour le fichier d’un devis / BC : convention du
 *  laboratoire, plus la marque « _approuvé » quand la ligne est approuvée. */
export const depositDocDriveFinalName = (r) => {
  const base = depositDocDriveNameOf(r);
  if (!base) return txt(r && r.fichierNom);
  return r && r.statut === APPROVAL_APPROVED && !hasApprovedSuffix(base)
    ? withApprovedSuffix(base)
    : base;
};

/** Dossier Drive du fichier déposé : Budget_labo/<année>/Devis|BC. */
export const budgetLaboPath = (kind) =>
  ['Budget_labo', String(new Date().getFullYear()), kind === 'bc' ? 'BC' : 'Devis'];

/** Nom du fichier SIGNÉ téléversé à l'approbation : convention du laboratoire
 *  (avec la marque « _approuvé » portée par depositDocDriveFinalName) + la
 *  marque « _signé », toujours en extension PDF :
 *    Devis_<N°>_<ligne>_<fournisseur>_<demandeur>_<date>_approuvé_signé.pdf */
export const signedDocDriveName = (r) => {
  const base = depositDocDriveFinalName(r) || txt(r && r.fichierNom) || 'document';
  return `${String(base).replace(/\.[^./\\]+$/, '')}_signé.pdf`;
};

/* ── Type réel du document ────────────────────────────────────────────────── */
/** Type effectif du fichier déposé : 'pdf' | 'image' | 'other'. L'extension
 *  d'origine ou le type MIME (renseigné au téléversement) sont utilisés. */
export const depositFileKindOf = (rec) => {
  const name = txt(rec && (rec.fichierNom || rec.fichierUrl));
  const mime = String(rec && rec.fichierMime || '').toLowerCase();
  if (mime === 'application/pdf' || /\.pdf(?:[?#].*)?$/i.test(name)) return 'pdf';
  if (mime.startsWith('image/') || /\.(jpe?g|png)(?:[?#].*)?$/i.test(name)) return 'image';
  return 'other';
};

/** Type RÉEL d'un document d'après ses premiers octets : 'pdf' | 'image/png' |
 *  'image/jpeg' | '' (inconnu). Le contenu fait foi : un fichier mal étiqueté
 *  (ex. un vrai PDF nommé « …png » par le Drive) est reconnu correctement, ce
 *  qui garantit qu'une copie signée est toujours un PDF et jamais une image. */
export const sniffBudgetDocBytes = (bytes) => {
  const a = bytes && bytes.length > 0 ? bytes[0] : -1;
  const b = bytes && bytes.length > 1 ? bytes[1] : -1;
  const c = bytes && bytes.length > 2 ? bytes[2] : -1;
  const d = bytes && bytes.length > 3 ? bytes[3] : -1;
  if (a === 0x25 && b === 0x50 && c === 0x44 && d === 0x46) return 'pdf';        // %PDF
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return 'image/png';  // \x89PNG
  if (a === 0xff && b === 0xd8 && c === 0xff) return 'image/jpeg';               // JPEG
  return '';
};

/** Octets binaires → data:URL (utile quand le devis déposé est une image). */
export const bytesToDataUrl = (bytes, mime) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let bin = '';
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`;
};

/** Date ISO (AAAA-MM-JJ) → « JJ/MM/AAAA » (mention portée sur la signature). */
export const frShortDateOf = (iso) => {
  const [y, m, d] = (isoOf(iso) || todayIso()).split('-');
  return y && m && d ? `${d}/${m}/${y}` : todayIso();
};

/** Renomme (best-effort) sur Google Drive le fichier d’un devis / BC : nom
 *  conventionnel au dépôt, « _approuvé » ajouté après approbation. Renvoie le
 *  nouveau nom, ou '' quand rien n’a pu être renommé (fichier non accessible à
 *  l’app — limite « drive.file » — ou absence de fichier / de N°). */
export const renameDepositDriveFileTo = async (r) => {
  if (!r || !cloudBackendAvailable()) return '';
  const fileId = driveFileIdFromUrl(txt(r.fichierUrl));
  const target = depositDocDriveFinalName(r);
  if (!fileId || !target) return '';
  try {
    const ok = await renameDriveFile(fileId, target);
    return ok ? target : '';
  } catch (err) {
    console.warn('Renommage Drive du fichier devis/BC ignoré (fichier inaccessible à l’app ?)', err && err.message);
    return '';
  }
};

/* ── Copie signée (best-effort) ───────────────────────────────────────────── */
/**
 * Ajoute la signature du superutilisateur au document d'un devis / BC approuvé :
 * une COPIE SIGNÉE en PDF est créée dans Budget_labo/<année>/Devis|BC (l'original
 * reste intact) et devient le fichier officiel de la ligne. Best-effort : un
 * échec est expliqué dans `frags` et n'empêche jamais la décision déjà
 * enregistrée (approbation / transfert signé) d'aboutir.
 *
 * @param {object} args
 * @param {object} args.rec         ligne `devisBc` (kind 'devis' | 'bc')
 * @param {object} args.signature   réglage `approvalSignature` ({ dataUrl })
 * @param {string} args.currentName nom du superutilisateur qui signe
 * @returns {Promise<{ frags: string[], patch: object|null }>} `patch` = correctif
 *          à upsert sur la ligne (fichier officiel + trace), null si rien fait.
 */
export const buildSignedDeposit = async ({ rec, signature, currentName } = {}) => {
  const frags = [];
  const warn = (msg) => frags.push(`✍️ Signature : ${msg}`);
  if (!rec || !rec.id) return { frags, patch: null };
  if (!signature || !txt(signature.dataUrl)) return { frags, patch: null }; // aucune image : rien à faire
  try {
    if (!cloudBackendAvailable()) {
      warn('Google Drive non connecté — le PDF signé n’a pas été créé.');
      return { frags, patch: null };
    }
    const fileId = driveFileIdFromUrl(txt(rec.fichierUrl));
    if (!fileId) {
      warn('fichier non stocké sur Google Drive — le PDF signé n’a pas été créé.');
      return { frags, patch: null };
    }
    let docKind = depositFileKindOf(rec);
    let mime = String(rec.fichierMime || '').toLowerCase();
    /* Le fichier collé en lien (sans type MIME local) : on interroge Drive. */
    try {
      const metaRes = await driveFetch(`/drive/v3/files/${fileId}?fields=name,mimeType`);
      const meta = metaRes ? await metaRes.json() : null;
      const metaName = String(meta && meta.name || '');
      mime = String(meta && meta.mimeType || mime).toLowerCase();
      if (mime === 'application/pdf' || /\.pdf$/i.test(metaName)) docKind = 'pdf';
      else if (mime.startsWith('image/') || /\.(jpe?g|png)$/i.test(metaName)) docKind = 'image';
    } catch { /* on garde le type deviné depuis l'enregistrement */ }

    /* Octets du document : téléchargés via l'API d'abord. Quand le fichier
       est INVISIBLE à l'API (déposé à la main dans un Drive personnel non
       partagé — autorisation limitée « drive.file »), on retente par son
       adresse PUBLIQUE — exactement comme le ré-import des documents
       (./driveReimport.js). Sans ce repli, la copie signée n'était jamais
       créée pour ces fichiers et la signature « disparaissait ». */
    let bytes = null;
    try {
      const contentRes = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, {
        headers: { Accept: docKind === 'pdf' ? 'application/pdf' : (mime || 'image/png') },
      });
      if (contentRes && contentRes.ok) bytes = new Uint8Array(await contentRes.arrayBuffer());
    } catch { /* → tentative par adresse publique ci-dessous */ }
    if (!bytes || !bytes.length) {
      try {
        const dl = await downloadDriveFileBytes(fileId);
        if (dl && dl.bytes && dl.bytes.byteLength) {
          bytes = new Uint8Array(dl.bytes);
          const dlMime = String(dl.mimeType || '').toLowerCase();
          if (dlMime) mime = dlMime;
          const dlName = String(dl.name || '');
          if (/\.pdf$/i.test(dlName)) docKind = 'pdf';
          else if (/\.(jpe?g|png)$/i.test(dlName)) docKind = 'image';
        }
      } catch { bytes = null; }
      if (!bytes || !bytes.length) {
        warn('impossible de télécharger le fichier (permissions Google Drive ?). Partagez-le avec le compte de l’app, ou téléversez-le depuis ce PC avec « ⬆ PC », puis approuvez à nouveau.');
        return { frags, patch: null };
      }
    }

    /* Le CONTENU fait foi : certains documents sont mal étiquetés (vrai PDF
       vu comme PNG, ou l'inverse). La détection par les premiers octets évite
       de produire une « copie signée » qui serait en réalité une image — la
       copie signée téléversée est toujours un vrai PDF. */
    const sniffed = sniffBudgetDocBytes(bytes);
    if (sniffed === 'pdf') { docKind = 'pdf'; mime = 'application/pdf'; }
    else if (sniffed === 'image/png' || sniffed === 'image/jpeg') { docKind = 'image'; mime = sniffed; }
    if (docKind === 'other') {
      warn('document non PDF (Word, Excel…) — la signature ne peut pas y être apposée.');
      return { frags, patch: null };
    }
    if (!bytes || !bytes.length) {
      warn('fichier vide — la copie signée n’a pas été créée.');
      return { frags, patch: null };
    }
    const kindLabel = rec.kind === 'bc' ? 'BC' : 'Devis';
    const ref = txt(rec.kind === 'bc' ? rec.numBC : rec.numDevis);
    const captionLines = [
      'Bon pour accord',
      `${kindLabel}${ref ? ` N° ${ref}` : ''} — approuvé le ${frShortDateOf()} par ${txt(currentName)}`,
    ];
    const signedBytes = docKind === 'pdf'
      ? await stampPdfWithSignature({ pdfBytes: bytes, signatureDataUrl: signature.dataUrl, captionLines })
      : await makeSignedPdfFromImage({
        imageDataUrl: bytesToDataUrl(bytes, mime || 'image/png'),
        signatureDataUrl: signature.dataUrl,
        captionLines,
      });
    const signedName = signedDocDriveName(rec);
    const drive = await uploadLocalFile({
      name: signedName,
      mimeType: 'application/pdf',
      file: new Blob([signedBytes], { type: 'application/pdf' }),
      path: budgetLaboPath(rec.kind),
    });
    if (!drive || !drive.driveUrl) {
      warn('téléversement de la copie signée impossible (Drive non connecté ?).');
      return { frags, patch: null };
    }
    const driveName = String(drive.name || signedName);
    frags.push(`✍️ Copie signée « ${driveName} » créée — c'est maintenant le fichier officiel.`);
    return {
      frags,
      patch: {
        fichierNom: driveName,
        fichierUrl: drive.driveUrl,
        fichierMime: 'application/pdf',
        signedAt: Date.now(),
        signedBy: txt(currentName),
      },
    };
  } catch (err) {
    console.warn('Signature automatique du document ignorée :', err && err.message);
    warn((err && err.message) || 'erreur inattendue.');
    return { frags, patch: null };
  }
};
