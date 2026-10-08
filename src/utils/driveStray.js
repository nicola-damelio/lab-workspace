/* =========================================================================
   src/utils/driveStray.js
   ⛔ AUCUN DOSSIER AU NOM D'UN PROJET NE SE POSE À LA RACINE DU DATASET.

   LE DÉFAUT, SIGNALÉ TROIS FOIS : « a directory named after a project is being
   created outside the Projects folder in Drive ». La structure déclarée d'un
   dataset n'admet QUE des conteneurs canoniques à sa racine — `projects`,
   `general_library_images`, `backups`, `protocols`, `storage`, `publications`
   (voir driveNaming.DATASET_FOLDER_DIRS). Un dossier `<dataset>/<projet>/…`
   est donc TOUJOURS un défaut, jamais un choix.

   OÙ LE DÉFAUT NAISSAIT — la cause, pas la surface. **Tout** envoi de fichier
   passe par UN SEUL entonnoir, `driveUpload.resolveDrivePathFromNames(names)` :
   il reçoit une liste de NOMS de dossiers et CRÉE chaque segment
   (`findOrCreateFolder`), en ne traitant spécialement que le PREMIER — et
   seulement s'il est un conteneur canonique (`isCanonicalDatasetDir`).
   Les correctifs précédents ont canonisé les CONSTRUCTEURS de chemins
   (`projectSectionFolderPath`, `canonicalExperimentPath`, `usefulFilesFolderPath`,
   `imagesFolderPathOnDrive`, les deux imports Bruker…) : chacun pouvait donc
   être juste pendant que l'entonnoir, lui, continuait d'obéir à n'importe quel
   chemin explicite resté en forme historique (`[<projet>, <expérience>, …]`,
   `[<projet>, <section>]`, un chemin enregistré avant un renommage…), à un
   appelant qui assemble son tableau à la main, ou à une file d'envois rejouée
   plus tard. Réparer les appelants un par un ne pouvait donc pas marcher : il
   en restait toujours un.

   CE QUI EST FAIT ICI — le garde-fou est posé DANS l'entonnoir, là où le
   dossier serait créé : si le premier segment est le nom d'un PROJET de ce
   dataset (le registre du miroir, partagé par `_workspace/state.json`, et le
   magasin du navigateur `labWorkspace_projects` disent lesquels), le chemin est
   ROUTÉ sous le conteneur canonique (`projects/<projet>/…`) au lieu d'être
   écrit à côté. Le défaut ne peut donc plus être produit par AUCUN appelant,
   y compris ceux qu'on n'a pas encore écrits — et un chemin historique déjà
   enregistré se range tout seul au lieu de fabriquer un jumeau à la racine.

   Rien d'autre n'est touché : un premier segment qui n'est pas un projet
   (`publications`, `protocols`, `storage`, `library`, tout autre usage) garde
   exactement le comportement d'avant. La logique est PURE (les fonctions
   reçoivent les slugs connus) et vérifiée hors navigateur par
   _drive_stray_project_test.mjs.
   ========================================================================= */

import { sanitizeSlug, DATASET_FOLDER_DIRS } from './driveNaming';
import { readDriveMirror } from './driveMirrorStore';

/** Le conteneur canonique des projets (le premier segment de tout envoi lié à
 *  un projet) — la MÊME valeur que driveNaming.PROJECTS_CONTAINER. */
export const PROJECTS_CONTAINER = 'projects';

/** Les conteneurs RÉSERVÉS d'un dataset (driveNaming.DATASET_FOLDER_DIRS) : un
 *  projet qui porterait l'un de ces noms ne peut pas les déloger — le conteneur
 *  canonique gagne, exactement comme driveMirrorStore.projectFolderPaths
 *  protège « projects » d'une mise à la corbeille. Sans cela, un projet nommé
 *  « publications » détournerait les envois de publications dans projects/. */
export const RESERVED_DATASET_DIRS = DATASET_FOLDER_DIRS.map((d) => sanitizeSlug(d));

/** Clé localStorage du magasin des projets (projectsModule.PROJECTS_KEY). */
export const PROJECTS_KEY = 'labWorkspace_projects';

/** L'identité d'un dataset dans le miroir : MÊME règle que
 *  driveMirrorStore.mirrorDatasetKey (`id:<id>`, sinon `name:<slug>`). */
const datasetKeyOf = (id, name) => {
  const dsId = String(id || '').trim();
  if (dsId) return `id:${dsId}`;
  const slug = sanitizeSlug(name);
  return slug ? `name:${slug}` : '';
};

/** Le slug du PROJET que `head` désigne, ou '' : la comparaison ignore la casse
 *  (une casse approchante est toujours le même projet) et rend le slug CANONIQUE
 *  du projet — le chemin corrigé vise donc le vrai dossier, jamais un jumeau
 *  minuscule. PUR. */
export const matcheProjectSlug = (head, projectSlugs = []) => {
  const slug = sanitizeSlug(head);
  if (!slug) return '';
  const list = (Array.isArray(projectSlugs) ? projectSlugs : [])
    .map((s) => sanitizeSlug(s)).filter(Boolean);
  const exact = list.find((s) => s === slug);
  if (exact) return exact;
  const lower = slug.toLowerCase();
  return list.find((s) => s.toLowerCase() === lower) || '';
};

/** `head` est-il le slug d'un projet de ce dataset ? PUR. */
export const isProjectHead = (head, projectSlugs = []) => !!matcheProjectSlug(head, projectSlugs);

/**
 * Le chemin CORRIGÉ, pur. Un premier segment qui est le nom d'un projet ne
 * reste jamais à la racine du dataset : il passe sous `projects/`.
 * @param {string[]} names  les noms de dossiers voulus (premier = tête)
 * @param {{ projectSlugs?: string[] }} opts les slugs des projets de CE dataset
 * @returns {{ names:string[], changed:boolean, head:string }}
 */
export const routeProjectHeadUnderProjects = (names, { projectSlugs = [] } = {}) => {
  const list = (Array.isArray(names) ? names : []).map((n) => sanitizeSlug(n)).filter(Boolean);
  /* Il faut une TÊTE et une suite : un chemin d'un seul segment est déjà visé
     sous `projects/` par les constructeurs canoniques ; ici on ne réécrit qu'un
     chemin qui DESCEND dans un dossier de projet posé à la racine. */
  if (list.length < 2) return { names: list, changed: false, head: '' };
  const head = list[0];
  if (head === PROJECTS_CONTAINER) return { names: list, changed: false, head: '' };
  /* Les conteneurs RÉSERVÉS du dataset ne sont jamais détournés, même si un
     projet porte ce nom : `publications/<scientifique>/…` reste `publications/`,
     c'est le conteneur canonique qui compte. */
  if (RESERVED_DATASET_DIRS.indexOf(head) !== -1) return { names: list, changed: false, head: '' };
  const project = matcheProjectSlug(head, projectSlugs);
  if (!project) return { names: list, changed: false, head: '' };
  return { names: [PROJECTS_CONTAINER, project, ...list.slice(1)], changed: true, head: project };
};

/**
 * Les slugs des projets de CE dataset : le registre du miroir (partagé, donc il
 * connaît aussi les projets créés sur un autre poste) PUIS le magasin du
 * navigateur (il connaît un projet dont le dossier Drive n'a pas encore été
 * touché — le cas même du dossier fautif, créé au PREMIER envoi).
 * Best-effort : un magasin illisible ou un miroir vide rend la liste du miroir.
 */
export const knownProjectSlugs = ({
  datasetId = '', datasetName = '', mirror = null, rawProjects = null
} = {}) => {
  const out = [];
  let m = mirror;
  if (m == null) { try { m = readDriveMirror(); } catch { m = null; } }
  const key = datasetKeyOf(datasetId, datasetName);
  const projects = m && m.projects && typeof m.projects === 'object' ? m.projects : {};
  if (key) {
    Object.keys(projects).forEach((k) => {
      if (k.indexOf(`${key}::`) !== 0) return;
      const slug = k.slice(key.length + 2);
      if (slug && slug !== '_unassigned') out.push(slug);
    });
  }
  let raw = rawProjects;
  if (raw == null) { try { raw = localStorage.getItem(PROJECTS_KEY); } catch { raw = null; } }
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    (Array.isArray(list) ? list : []).forEach((p) => {
      if (!p || !p.id) return;
      const pds = p.datasetId == null ? '' : String(p.datasetId);
      /* Dans un dataset, seuls les projets DE CE dataset décident ; hors dataset
         (explorateur) tous les projets connus sont légitimes. */
      if (datasetId && pds !== String(datasetId)) return;
      const slug = sanitizeSlug(p.name);
      if (slug) out.push(slug);
    });
  } catch { /* magasin illisible : le registre a suffi */ }
  return Array.from(new Set(out));
};

/** Le garde-fou tel que l'entonnoir l'appelle : il lit lui-même ce qu'il faut
 *  savoir (miroir + magasin du navigateur) et rend le chemin corrigé. */
export const guardProjectHead = (names, { datasetId = '', datasetName = '' } = {}) =>
  routeProjectHeadUnderProjects(names, {
    projectSlugs: knownProjectSlugs({ datasetId, datasetName })
  });

