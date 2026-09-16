/* =========================================================================
   src/utils/projectDocumentDrive.js
   LE TEXTE D'UN PROJET SUR LE DRIVE, DANS LE DOSSIER DU PROJET.

   Un projet vit dans le navigateur (localStorage, publié sur Firestore) : le
   quota d'un navigateur est petit et peut être plein, et un autre poste ne voit
   rien tant qu'il n'a pas rechargé la base. Un manuscrit importé (texte,
   en-tête, bibliographie, références numérotées) mérite donc d'exister aussi
   LÀ OÙ LE PROJET VIT SUR LE DRIVE :

     Lab Workspace/<dataset>/projects/<projet>/<projet>_document.json

   — c'est le dossier que l'application crée déjà pour les expériences d'un
   projet (voir driveUpload.moveTestFolderIntoProject) : le fichier se range à
   côté, à la racine du projet.

   Cet archivage est ADDITIF et BEST-EFFORT : sans Drive connecté (ou en mode
   Nextcloud non configuré), il ne fait rien et l'import n'en souffre pas. Les
   PIXELS des figures n'y entrent JAMAIS (ce sont eux qui saturent le navigateur
   et ils sont déjà sur le Drive) : le fichier ne porte que ce qui est
   irremplaçable — le texte des sections, l'en-tête de l'article, la
   bibliographie du projet, les références numérotées et l'empreinte des imports
   (pour qu'un second import du même document soit encore reconnu après un
   vidage du navigateur).

   `restoreProjectDocument` fait le chemin inverse : le fichier relu redevient
   un PATCH pour le projet. Rien n'est appliqué en douce — c'est l'utilisateur
   qui demande la restauration (bouton « ♻ Load the Drive copy »).

   Tout ce qui ne parle pas au réseau est PUR et testé hors navigateur
   (voir _project_drive_doc_test.mjs).
   ========================================================================= */

import { getDriveToken, uploadWorkspaceFile, downloadDriveFileText } from './driveUpload';
import { getCloudProvider, nextcloudConfigured, ncUploadFile, ncFetchBlob } from './nextcloud';
import { sanitizeSlug, datasetFolderSlug } from './driveNaming';
import { PROJECT_TEXT_SECTIONS } from './manuscriptImport';

/** Marque du fichier : il n'est restauré que s'il vient bien de l'application. */
export const PROJECT_DOCUMENT_KIND = 'lab-workspace/project-document';
export const PROJECT_DOCUMENT_VERSION = 1;

/** Les CHAMPS de texte d'un projet (le document lui-même). */
export const PROJECT_DOCUMENT_SECTIONS = PROJECT_TEXT_SECTIONS.map((s) => ({ id: s.id, label: s.label }));

/** <projet>_document.json */
export const projectDocumentFileName = (project) =>
  `${sanitizeSlug(String((project && project.name) || '') || 'project')}_document.json`;

/** <dataset>/projects/<projet> — le dossier du projet sur le Drive. */
export const projectDocumentFolder = (datasetName, project) =>
  `${datasetFolderSlug(datasetName)}/projects/${sanitizeSlug(String((project && project.name) || '') || 'project')}`;

/** Le fichier JSON tel qu'il part sur le Drive (indenté : lisible en cas de besoin). */
export const projectDocumentJson = (payload) => JSON.stringify(payload, null, 2);


/**
 * Le contenu à archiver : le DOCUMENT du projet, sans les pixels des figures.
 * @param {object} project le projet tel qu'il est en mémoire
 * @param {{ at?: string }} opts
 */
export const projectDocumentPayload = (project, { at = new Date().toISOString() } = {}) => {
  const p = project || {};
  const sections = {};
  PROJECT_DOCUMENT_SECTIONS.forEach((s) => {
    const html = String(p[s.id] || '');
    if (html.trim()) sections[s.id] = html;
  });
  const header = {};
  [['paperTitle', 'title'], ['paperAuthors', 'authors'], ['paperAffiliations', 'affiliations']]
    .forEach(([field, key]) => {
      const value = String(p[field] || '');
      if (value.trim()) header[key] = value;
    });
  return {
    kind: PROJECT_DOCUMENT_KIND,
    version: PROJECT_DOCUMENT_VERSION,
    savedAt: at,
    project: {
      id: String(p.id || ''),
      name: String(p.name || ''),
      scientist: String(p.scientist || '')
    },
    sections,
    header,
    bibliography: (Array.isArray(p.bibliography) ? p.bibliography : []).map((b) => ({ ...b })),
    references: (Array.isArray(p.references) ? p.references : []).map((r) => ({ ...r })),
    msImports: (Array.isArray(p.msImports) ? p.msImports : []).map((it) => ({ ...it }))
  };
};

/**
 * Relire un fichier archivé → le document, ou la raison du refus. Un fichier
 * d'un autre programme, tronqué ou d'une version inconnue n'est jamais appliqué.
 * @returns {{ ok: boolean, payload?: object, reason?: string }}
 */
export const parseProjectDocument = (raw) => {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'empty' };
  let data = null;
  try { data = JSON.parse(raw); } catch { return { ok: false, reason: 'not-json' }; }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'not-an-object' };
  if (data.kind !== PROJECT_DOCUMENT_KIND) return { ok: false, reason: 'not-a-project-document' };
  if (Number(data.version) > PROJECT_DOCUMENT_VERSION) return { ok: false, reason: 'newer-version' };
  const sections = (data.sections && typeof data.sections === 'object') ? data.sections : {};
  const hasText = PROJECT_DOCUMENT_SECTIONS
    .some((s) => typeof sections[s.id] === 'string' && sections[s.id].trim());
  if (!hasText) return { ok: false, reason: 'no-section-text' };
  return { ok: true, payload: data };
};

/**
 * Le document relu → le PATCH du projet (ce que la page écrit dans le magasin).
 * Seuls les champs PRÉSENTS dans le fichier sont repris : restaurer un fichier
 * écrit avant qu'une section existe ne vide pas cette section aujourd'hui.
 * @returns {{ ok: boolean, patch?: object, reason?: string, counts?: object }}
 */
export const projectDocumentPatch = (payload) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'empty' };
  const patch = {};
  const sections = payload.sections || {};
  let text = 0;
  PROJECT_DOCUMENT_SECTIONS.forEach((s) => {
    const html = sections[s.id];
    if (typeof html === 'string' && html.trim()) { patch[s.id] = html; text += 1; }
  });
  if (!text) return { ok: false, reason: 'no-section-text' };
  const header = payload.header || {};
  const headerCount = [['title', 'paperTitle'], ['authors', 'paperAuthors'], ['affiliations', 'paperAffiliations']]
    .filter(([key, field]) => {
      const value = header[key];
      const keep = typeof value === 'string' && value.trim();
      if (keep) patch[field] = value;
      return !!keep;
    }).length;
  let refs = 0;
  if (Array.isArray(payload.references) && payload.references.length) {
    patch.references = payload.references.map((r) => ({ ...r }));
    refs = patch.references.length;
  }
  let bib = 0;
  if (Array.isArray(payload.bibliography) && payload.bibliography.length) {
    patch.bibliography = payload.bibliography.map((b) => ({ ...b }));
    bib = patch.bibliography.length;
  }
  if (Array.isArray(payload.msImports) && payload.msImports.length) {
    /* Les empreintes reviennent AVEC le document : le même manuscrit réimporté
       sur ce poste est encore reconnu comme déjà importé. */
    patch.msImports = payload.msImports.map((it) => ({ ...it }));
  }
  return { ok: true, patch, counts: { sections: text, header: headerCount, references: refs, bibliography: bib } };
};

/** Envoi du fichier dans le dossier du projet (Drive ou Nextcloud). */
const uploadProjectDocument = async ({ folder, name, body }) => {
  const blob = typeof Blob === 'undefined' ? body : new Blob([body], { type: 'application/json' });
  if (getCloudProvider() === 'nextcloud') {
    if (!nextcloudConfigured()) return null;
    const parts = ['Lab Workspace', ...String(folder).split('/').filter(Boolean).map((s) => sanitizeSlug(s))];
    const res = await ncUploadFile({ parts, name, mimeType: 'application/json', file: blob });
    return res ? { id: String(res.id), davUrl: String(res.url || ''), url: String(res.webLink || res.url || '') } : null;
  }
  if (!getDriveToken()) return null;
  const res = await uploadWorkspaceFile({ name, mimeType: 'application/json', file: blob, folder });
  if (!res || !res.id) return null;
  return { id: String(res.id), url: `https://drive.google.com/file/d/${res.id}/view` };
};

/**
 * Archiver le document d'un projet dans SON dossier Drive. Best-effort : toute
 * panne (Drive non connecté, réseau, quota) rend `null` — l'import continue.
 * @returns {Promise<{id:string,name:string,folder:string,url?:string,davUrl?:string,provider:string,bytes:number,at:string}|null>}
 */
export const archiveProjectDocument = async ({ project, datasetName = '' } = {}) => {
  if (!project || !project.id) return null;
  const name = projectDocumentFileName(project);
  const folder = projectDocumentFolder(datasetName, project);
  const body = projectDocumentJson(projectDocumentPayload(project));
  try {
    const up = await uploadProjectDocument({ folder, name, body });
    if (!up) return null;
    return {
      id: up.id, name, folder,
      url: up.url || '', davUrl: up.davUrl || '',
      provider: getCloudProvider() === 'nextcloud' ? 'nextcloud' : 'drive',
      bytes: body.length,
      at: new Date().toISOString()
    };
  } catch (err) {
    console.warn('Archiving the project document to Drive failed:', err && err.message);
    return null;
  }
};

/**
 * Relire le fichier archivé (celui que `archiveProjectDocument` vient d'écrire)
 * → le document validé, ou null si le Drive ne répond pas / fichier étranger.
 */
export const readProjectDocumentFromDrive = async (ref) => {
  if (!ref || !ref.id) return null;
  try {
    let text = '';
    if (ref.provider === 'nextcloud') {
      const davUrl = ref.davUrl || ref.url;
      if (!davUrl) return null;
      const blob = await ncFetchBlob(davUrl);
      text = blob ? await blob.text() : '';
    } else {
      text = await downloadDriveFileText(ref.id);
    }
    const parsed = parseProjectDocument(text);
    return parsed.ok ? parsed.payload : null;
  } catch (err) {
    console.warn('Reading the Drive copy of the project document failed:', err && err.message);
    return null;
  }
};

/**
 * Le document archivé → le patch à écrire dans le projet, avec les compteurs à
 * montrer à l'utilisateur. `ok:false` quand le fichier ne peut pas être relu.
 */
export const restoreProjectDocument = async (ref) => {
  const payload = await readProjectDocumentFromDrive(ref);
  if (!payload) return { ok: false, error: 'The Drive copy could not be read.' };
  const built = projectDocumentPatch(payload);
  if (!built.ok) return { ok: false, error: `The Drive copy has no section text (${built.reason}).` };
  return { ok: true, patch: built.patch, counts: built.counts, savedAt: payload.savedAt || '' };
};
