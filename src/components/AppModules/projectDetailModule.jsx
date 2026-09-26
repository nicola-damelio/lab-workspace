import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RichTextEditor } from '../RichTextEditor';
import { SmartImage } from '../TestShellRenderer';
import {
  loadPubFormat, loadRelevantPapers, matchCoauthors, pubCitationData, pubCitationHtml,
  pubLayoutCss, journalSectionOrder, reorderDocHtml,
  docHeadRows, docHeadSpacedHtml, DOC_EMPTY_LINE_ID, DOC_EMPTY_LINE_CLASS,
  /* CE QUI N'EST PAS DU TEXTE (voir journalFormats.js, withoutScreenOnlyUi) : les
     notes du programme, les boutons et le bandeau du Drive vivent dans le document
     affiché (`no-print`) mais ne doivent entrer ni dans un document FIGÉ, ni dans
     l'impression, ni dans le .docx. */
  withoutScreenOnlyUi,
  normalizePubDocOrder, normalizePubDocTitles, pubDocTitleKeywords, pubDocOrderKeywords, pubDocTitleOf,
  pubDocTitleHidden, pubDocBlockOfSection
} from '../Publications';
import { getStarredItems, buildStarCaption, buildMaterialsAndMethods, tabConfigForType } from '../../utils/starredItems';
import { loadProjects, saveProjects, saveProjectsChecked, lightenProjectForStorage, recordProjectDeletion, loadPublications, TEST_TYPE_OPTIONS, testTypeLabel, genProjectId, normalizeAuthorized, projectAccessFor, saveProjectsRescued } from './projectsModule';
import { storageFreedText, storageRefusedText } from '../../utils/localStoreRoom';
import { suggestDriveFileName, openDrive, projectSectionFolderPath, projectSectionFolderLabel, projectImagesFolderLabel } from '../../utils/driveNaming';
import { DriveUploadButton } from '../DriveUpload';
import { UsefulFilesSection } from '../UsefulFilesSection';
import { normalizeProjectFiles } from '../../utils/projectFiles';
/* L'EXPORT EN .DOCX (« In the document of the project there must be a export to
   docx button ») : le document affiché y devient un vrai fichier Word — même
   corps que l'impression, voir projectDocBodyHtml. */
import { downloadDocx, resolveDocxImages } from '../../utils/docxExport';
import {
  REFERENCE_FILE_ACCEPT, entryKeys, mergeReferenceEntries, parseReferences,
  projectBibEntry, readReferenceDocument
} from '../../utils/referenceImport';
import {
  MANUSCRIPT_FILE_ACCEPT, blocksFromText, splitManuscript, groupManuscriptParts,
  parseManuscriptHeader, headerFromLineRoles, HEADER_ROLES, PROJECT_TEXT_SECTIONS,
  HEADER_DESTS, isHeaderDest, headerDestLabel, headerTextFor, METHODS_DEST, withDocumentSections,
  buildManuscriptPlan, convertCitationsInText, htmlFromText, htmlFromManuscriptPart,
  mergeManuscriptBibliography, manuscriptFigurePlacements,
  readManuscriptDocument, figureDataUrl, figureMarksIn, stripFigureMarks,
  manuscriptFingerprint, previousImportOf, citedNumbersInText, superscriptMarksHtml
} from '../../utils/manuscriptImport';
/* COMPLÉTER UNE RÉFÉRENCE INCOMPLÈTE (auteurs, titre, revue, année manquants) :
   pot commun des publications du laboratoire puis Crossref — voir
   utils/referenceEnrich.js. Un import s'en sert tout seul, et le bouton
   « ✨ Complete missing fields » de la page projet répare les références déjà
   enregistrées. */
import { enrichReferences, enrichReport } from '../../utils/referenceEnrich';
import {
  citationAnchorId, citationLabel, ensureReferenceEntries, linkCitationsInSections,
  linkCitationNumbers, numberImportedReferences, referenceNumbers, linkedCitationNumbers,
  applyInTextStyle, withoutBibliographySection
} from '../../utils/referenceLinks';
import { moveFigureTo, splitAnchoredFigures } from '../../utils/figurePlacement';
import { markAttachmentsDeleted, renameDriveFilesFor, moveTestFolderIntoProject, moveTestFolderOutOfProject, getDriveToken, getDriveRootName, resolveDrivePathFromNames, listDriveChildren } from '../../utils/driveUpload';
/* Le texte du projet est AUSSI rangé dans le dossier du projet sur le Drive
   (Lab Workspace/<dataset>/projects/<projet>/<projet>_document.json) : le
   navigateur n'est qu'un cache (voir utils/projectDocumentDrive.js). */
import { archiveProjectDocument, restoreProjectDocument } from '../../utils/projectDocumentDrive';
/* Le Drive est le miroir du programme : supprimer un projet met son dossier
   Drive à la corbeille (et note son chemin comme définitivement supprimé),
   renommer un projet renomme son dossier ET son <projet>_document.json. */
import { mirrorDeleteProject, mirrorRenameProject } from '../../utils/driveMirror';
import { repairContentImages, getRenderableDriveUrl } from '../../data/constants';
import {
  readDeck, readProjectLibrary, removeProjectLibraryItem, renameProjectLibraryItem, pushLibraryToDrive, pullLibraryFromDrive,
  addProjectLibraryItem, makeUploadImage, uploadFigureToDrive, renameFigureOnDrive,
  countCanvasDuplicates, removeCanvasDuplicates, restoreCanvasFromFigureMeta, canvasPreviewFromComposition,
  resolveImageToDataUrl, rasterizeSvgImage, lastLibraryListWrite
} from '../../utils/figuresLibrary';
import { SlidePreview, renderSlideToDataUrl } from '../FiguresSlides';
/* LE DOCUMENT FINAL EN .docx : « ⬇️ Word (.docx) » — le fichier se fabrique ici
   (`exportProjectDocx`, plus bas), avec les deux moitiés du module : le corps du
   document et les images (voir `downloadDocx`, `resolveDocxImages` importés plus
   haut). ⚠ NE PAS réimporter `exportProjectDocx` : la ligne locale du merge le
   faisait, ET le handler est déclaré dans ce fichier — deux déclarations du même
   nom, et le fichier ne se parsait plus (le build échouait).
   (OOXML, ZIP de parties XML — aucune dépendance nouvelle, fflate est déjà là
   pour lire les .docx importés). Le texte, l'ordre des sections, les citations
   et les figures viennent du MÊME corps HTML que l'impression. */
/* ── L'APERÇU D'UNE CARTE DE CANVAS ──────────────────────────────────────────
   Signalé tel quel : « the preview of the images in the project does not work ».
   Une carte de canvas n'affichait QUE son rendu (`url`) : un canvas restauré
   depuis son fichier (📥 Restore a canvas file) n'en a pas — le sidecar ne porte
   que la composition — et sa carte restait un cadre vide « no preview », alors
   que ses panneaux sont bel et bien là. On retombe donc sur l'aperçu reconstruit
   depuis la COMPOSITION (`canvasPreviewFromComposition` : la première vignette
   des panneaux), et l'on réécrit au passage un lien de partage Drive en lien
   affichable. Pourquoi AU RENDU et pas seulement à l'import : les entrées déjà
   restaurées n'ont toujours pas d'`url`, et le magasin plein refuse d'en écrire
   un — ce repli-ci n'écrit pas une ligne. PUR. */
const canvasPreviewOf = (c) => getRenderableDriveUrl(
  (c && (c.url || c.full || canvasPreviewFromComposition(c.canvasData))) || ''
);

/* L'IDENTIFIANT DU CONTENEUR DU DOCUMENT. La page le porte (`#project-doc-container`,
   plus bas) et la page EXPORTÉE le remet autour du texte copié : c'est ce
   conteneur que visent les règles de mise en forme du « Publication format »
   (voir pubLayoutCss dans components/pubCitation.js), donc l'écran, l'impression
   et le PDF obéissent au même format. */
const DOC_CONTAINER_ID = 'project-doc-container';
const DOC_CONTAINER_SELECTOR = `#${DOC_CONTAINER_ID}`;

/* LES SECTIONS DE TEXTE D'UN PROJET, dans l'ordre où la page les écrit — la liste
   de l'application (utils/manuscriptImport.js, importée plus haut) : une seule
   source pour la page, l'import d'un manuscrit ET le document. Leur INTITULÉ
   (`label`) est aussi le mot avec lequel le DOCUMENT les nomme : le panneau
   « Publication format » sait donc les déplacer (voir pubDocOrderKeywords ·
   reorderDocHtml), et le même intitulé sert à l'écran ET à l'impression.
   `OPTIONAL_TEXT_SECTION_IDS` : une section de ces deux-là ne s'imprime que si
   elle est remplie (le socle d'un article — contexte, résultats, conclusions —
   s'imprime toujours, même vide, pour que la structure du document se voie). */
const OPTIONAL_TEXT_SECTION_IDS = ['funding', 'supporting'];
/* LE VOCABULAIRE D'ORDRE DU DOCUMENT D'UN PROJET : l'ordre CHOISI au panneau
   (`docOrder`), traduit dans les mots que le document écrit, PUIS l'ordre du
   journal pour ce que l'utilisateur n'a pas nommé (un journal place « abstract »,
   « introduction »… : les blocs que le format ne connaît pas gardent donc l'ordre
   du journal). L'ordre du panneau passe EN PREMIER : c'est ce que la demande
   demande — « In the publication format even if I change the order of the
   sections they do not affect the document in the project. » */
const docOrderWords = (fmt) => {
  const words = pubDocOrderKeywords(
    fmt && fmt.docOrder,
    /* LES SECTIONS DE TEXTE AVEC LEUR ID : c'est ce qui permet à chaque section d'être
       nommée à SA rangée du panneau — le contexte et les résultats par le bloc « Text
       sections », les conclusions, le financement et les informations supplémentaires par
       la leur (voir PUB_DOC_BLOCKS · pubDocBlockOfSection). */
    PROJECT_TEXT_SECTIONS
  );
  journalSectionOrder(fmt).forEach((w) => {
    const k = String(w == null ? '' : w).toLowerCase().replace(/\s+/g, ' ').trim();
    if (k && !words.includes(k)) words.push(k);
  });
  return words;
};

/* Deux comptes de champs remplis (voir utils/referenceEnrich.js : `filled`) mis
   en un seul : le compte rendu du bouton « ✨ Complete missing fields » travaille
   sur la bibliographie ET sur les références numérotées du projet. */
const mergeFieldCounts = (a, b) => {
  const out = { ...(a || {}) };
  Object.keys(b || {}).forEach((k) => { out[k] = (out[k] || 0) + b[k]; });
  return out;
};

/* =========================================================================
   PROJECT DETAIL — a project page with subsections:
   • Scientific background (rich text + references)
   • Experiments (add multiple tests → buttons that link to the classic pages)
   • Results and Discussion (rich text + references)
   • Conclusions (rich text + references)
   • References (numbered references from Project bibliography and the
     scientist's publications)
   ========================================================================= */

const inputCls = 'border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none focus:border-blue-500 w-full';

const SectionCard = ({ title, badge, open, onToggle, children }) => (
  <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
    <button type="button" onClick={onToggle}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-black text-slate-800 uppercase tracking-wide">{title}</span>
        {badge}
      </div>
      <span className={`shrink-0 text-slate-400 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
    </button>
    {open && <div className="px-4 pb-4 pt-3 border-t border-slate-100">{children}</div>}
  </section>
);

// Suggestion-mode diff helpers: produce a marked-up copy of the document HTML
// where inserted text is wrapped in <ins class="doc-ins"> and removed text in
// <del class="doc-del">, so a reviewer can see exactly what changed.
const escDiff = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const diffAttrs = (el) => {
  const out = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    out.push(` ${a.name}="${escDiff(a.value)}"`);
  }
  return out.join('');
};
// Word-level LCS diff of two plain-text strings → inline <ins>/<del> HTML.
const diffWordsHtml = (a, b) => {
  const ta = String(a || '').split(/(\s+)/);
  const tb = String(b || '').split(/(\s+)/);
  const n = ta.length, m = tb.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const segs = []; // { t: 'same'|'ins'|'del', s }
  const push = (t, s) => {
    if (!s) return;
    const last = segs[segs.length - 1];
    if (last && last.t === t) last.s += s; else segs.push({ t, s });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) { push('same', ta[i]); i++; j++; }
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { push('ins', tb[j]); j++; }
    else { push('del', ta[i]); i++; }
  }
  return segs.map((x) => x.t === 'same' ? escDiff(x.s)
    : x.t === 'ins' ? `<ins class="doc-ins">${escDiff(x.s)}</ins>`
      : `<del class="doc-del">${escDiff(x.s)}</del>`).join('');
};
// Diff two element lists (children of a block) with an LCS; returns HTML strings.
const diffElLists = (aEls, bEls) => {
  const textOf = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ');
  const sigOf = (el) => `${el.tagName.toLowerCase()}|${el.className || ''}|${textOf(el)}`;
  const n = aEls.length, m = bEls.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = sigOf(aEls[i]) === sigOf(bEls[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && sigOf(aEls[i]) === sigOf(bEls[j])) { out.push(aEls[i].outerHTML); i++; j++; continue; }
    if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      // block added in b — but maybe it is an edited version of the current a
      if (i < n && aEls[i].tagName === bEls[j].tagName && aEls[i].className === bEls[j].className) {
        out.push(diffOneBlock(aEls[i], bEls[j]));
        i++; j++;
      } else {
        out.push(`<div class="doc-ins">${bEls[j].outerHTML}</div>`);
        j++;
      }
    } else {
      if (j < m && i < n && aEls[i].tagName === bEls[j].tagName && aEls[i].className === bEls[j].className) {
        out.push(diffOneBlock(aEls[i], bEls[j]));
        i++; j++;
      } else {
        out.push(`<div class="doc-del">${aEls[i].outerHTML}</div>`);
        i++;
      }
    }
  }
  return out;
};
// Diff a single pair of blocks with the same tag/class but different content.
const diffOneBlock = (a, b) => {
  const tag = a.tagName.toLowerCase();
  const attrs = diffAttrs(a);
  const aKids = Array.from(a.children), bKids = Array.from(b.children);
  if (aKids.length && bKids.length) {
    return `<${tag}${attrs}>${diffElLists(aKids, bKids).join('')}</${tag}>`;
  }
  if (a.innerHTML === b.innerHTML) return a.outerHTML;
  // Plain-text blocks (no nested markup) get word-level marks.
  if (a.textContent === a.innerHTML && b.textContent === b.innerHTML) {
    return `<${tag}${attrs}>${diffWordsHtml(a.textContent, b.textContent)}</${tag}>`;
  }
  return `<div class="doc-del">${a.outerHTML}</div><div class="doc-ins">${b.outerHTML}</div>`;
};
const diffHtml = (baseHtml, newHtml) => {
  try {
    const doc = (h) => new DOMParser().parseFromString(h, 'text/html').body;
    return diffElLists(Array.from(doc(baseHtml).children), Array.from(doc(newHtml).children)).join('\n');
  } catch {
    return `<del class="doc-del">${escDiff(baseHtml)}</del>\n<ins class="doc-ins">${escDiff(newHtml)}</ins>`;
  }
};

// Renders one ⭐-starred item (figure / plot snapshot / data table) inside the
// project export document. The caption is generated from the item's base label
// plus data found on the test page (sample, name, date, DOSY parameters, D…).
const renderStarredItem = (item, test, opts = {}) => {
  if (!item) return null;
  const cap = buildStarCaption(test || {}, item, {
    figLabel: opts.figLabel,
    testType: opts.testType,
    base: opts.captionOverride
  });
  const isEditing = opts.editKey === `${test?.id}:${item.id}`;

  const capElement = (
    <figcaption className="pf-caption text-xs text-slate-500 mt-1 flex flex-wrap items-start gap-1.5">
      <span className="min-w-0">{cap}</span>
      {opts.onEditCaption && (
        <button type="button"
                onClick={() => opts.onEditCaption(`${test?.id}:${item.id}`, cap)}
                className="shrink-0 no-print text-[10px] font-bold text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-50"
                title="Edit this caption before export">✏️</button>
      )}
      {isEditing && opts.renderCaptionEditor && opts.renderCaptionEditor(item, test)}
    </figcaption>
  );

  if (item.kind === 'table') {
    const cols = Array.isArray(item.columns) ? item.columns : [];
    const rows = Array.isArray(item.rows) ? item.rows : [];
    if (cols.length === 0 || rows.length === 0) return null;
    return (
      <figure key={item.id} className="pf-figure mb-4">
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50">
                {cols.map((c, i) => (
                  <th key={i} className="px-3 py-1.5 border border-slate-200 text-left">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 border border-slate-200 font-mono">{cell === undefined || cell === null ? '—' : cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {capElement}
      </figure>
    );
  }

  if (!item.url) return null;
  return (
    <figure key={item.id} className="pf-figure mb-4">
      <SmartImage src={item.url} alt={item.label || 'Figure'} style={{ maxWidth: '100%', minHeight: '120px', maxHeight: '500px' }} />
      {capElement}
    </figure>
  );
};

// Builds the auto-generated Materials & Methods parts for a project's linked
// tests. `onlyIncluded` restricts to the tests ticked "Include" (the ones that
// appear in the export document); otherwise all linked tests are used.
const mmPartsFor = (project, tests, onlyIncluded) =>
  (project && Array.isArray(project.experiments) ? project.experiments : [])
    .filter((e) => (onlyIncluded ? e.includeInDocument : true))
    .map((exp) => {
      const test = tests.find((t) => t.id === exp.testId);
      if (!test) return null;
      return { name: test.name || exp.label, text: buildMaterialsAndMethods(test, tabConfigForType(test.type)) };
    })
    .filter(Boolean);

/* LES DEUX PHRASES DU MAGASIN DU NAVIGATEUR — « de la place a été faite » et
   « le navigateur a refusé » — vivent maintenant dans utils/localStoreRoom.js,
   avec la mesure, et sont importées ci-dessus : la LISTE DES PROJETS et la PAGE
   PROJET disent donc exactement la même chose du magasin. */

/* ── LE LIEN DRIVE D'UNE FIGURE DE SECTION ────────────────────────────────────
   Les pixels d'une figure de section peuvent ne plus être dans ce navigateur :
   le magasin était plein et l'écriture d'urgence a remplacé l'image encodée par
   son lien Drive (voir saveProjectsRescued / dropOneFigurePixels). Ils peuvent
   aussi n'avoir JAMAIS été liés — les compositions insérées avant que l'Image
   Builder ne dépose la copie cloud sur le Drive. Dans les deux cas il faut
   retrouver de quoi RÉAFFICHER l'image : le lien de son fichier. Il vit
     (1) sur la figure elle-même (`driveUrl`, ou `full` quand c'est déjà un lien) ;
     (2) sur l'entrée de bibliothèque du canvas dont elle vient (`canvasId` —
         c'est le même fichier, avec son `.meta.json` à côté, voir
         utils/figuresLibrary.js).
   '' quand rien n'est connu : on ne devine jamais une adresse. PUR (hors la
   lecture de la bibliothèque), donc éprouvable hors navigateur. */
export const figureDriveLink = (fig, projectId = '') => {
  const asLink = (v) => (/^https?:\/\//i.test(String(v || '')) ? String(v) : '');
  if (!fig || typeof fig !== 'object') return '';
  const own = asLink(fig.driveUrl) || asLink(fig.full);
  if (own) return own;
  const from = String(fig.builderProjectId || projectId || '');
  if (!fig.canvasId || !from) return '';
  const entry = readProjectLibrary(from).find((i) => i && i.id === fig.canvasId);
  return entry ? (asLink(entry.driveUrl) || asLink(entry.full)) : '';
};

export const ProjectDetailModule = ({
  currentUser, setCurrentModule, setCurrentProjectId, currentProjectId,
  createEmptyTest, tests, setTests, setActiveTestId, jumpToTest, operatorNames,
  openImageBuilder
}) => {
  const isSuper = currentUser?.role === 'superuser';
  const myName = currentUser?.name || '';
  const [projects, setProjects] = useState(loadProjects);
  /* ⚠ LA LISTE VIVANTE (`projectsRef`) — POURQUOI ELLE EXISTE.
     Un gestionnaire qui ATTEND quelque chose reste figé sur la liste du rendu
     qui l'a créé : `projects`, dans sa fermeture, est la liste d'AVANT. L'import
     de manuscrit écrit le texte, les références, la bibliographie et les figures,
     PUIS attend l'archivage Drive et écrit la référence du fichier déposé —
     cette seconde écriture repartait de la liste périmée : elle réécrivait
     l'ANCIEN projet par-dessus l'import. Le texte et les figures disparaissaient
     donc sous les yeux de l'utilisateur juste après l'import (« après l'import,
     tout disparaît »), le magasin gardait l'ancienne version, et seule la copie
     du Drive — envoyée avec le patch COMPLET — avait encore le texte : d'où le
     « je dois cliquer sur ♻ Load the Drive copy », puis le second import
     (« 🖼 Figures only ») qu'il fallait faire pour retrouver les figures (elles
     ne sont jamais dans le document du Drive : on n'y dépose pas les pixels).

     `projectsRef` suit la liste RÉELLE : toute écriture passe par
     replaceProjects() (le ref ET l'état, ensemble), et le ref est resynchronisé à
     chaque rendu. Une écriture qui suit un `await` repart donc de ce qui vient
     d'être écrit — jamais de l'ancien projet. */
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  /** Écrire la liste des projets : l'état React ET la liste vivante, toujours
   *  ensemble (voir commitProjectVerified, qui écrit après un `await`). */
  const replaceProjects = (next) => {
    const list = typeof next === 'function' ? next(projectsRef.current) : next;
    projectsRef.current = list;
    setProjects(list);
  };
  /* `bibliography: true` : la section « 📚 References » de cette page porte les
     DEUX imports (📄 Import references from a paper / 📥 Import a manuscript, ce
     dernier en haut de la page) — la section est donc ouverte dès l'arrivée,
     sinon ces boutons passent inaperçus. « funding » et « supporting » sont les
     deux sections ajoutées pour un article complet (financement + matériel
     supplémentaire) : elles sont ouvertes elles aussi, sinon elles passent
     inaperçues. */
  const [openSections, setOpenSections] = useState({ article: true, background: true, canvases: true, materials: true, usefulFiles: true, bibliography: true, funding: true, supporting: true, comments: false });
  const [refPicker, setRefPicker] = useState(null); // null | { insertText?: fn }
  /* ✨ « Complete missing fields » : l'avancement et le compte rendu de la
     recherche des informations manquantes d'une référence (auteurs, titre,
     revue, année…) — voir utils/referenceEnrich.js. `refFixBusy` bloque le
     bouton pendant la recherche en ligne. */
  const [refFixBusy, setRefFixBusy] = useState(false);
  const [refFixReport, setRefFixReport] = useState('');
  /* IMPORT DE LA BIBLIOGRAPHIE D'UN DOCUMENT (Paperpile / Word / RIS / BibTeX) :
     le texte est analysé, les références reconnues sont proposées à la coche
     puis ajoutées à la « Project bibliography » du projet — la MÊME liste que
     Publications → « Project bibliography », donc elles apparaissent
     automatiquement dans les deux pages et dans les références du document. */
  const [bibImport, setBibImport] = useState(null); // null | { text, fileName, parsed, picked, onePerLine, busy, status }
  /* 📥 Import d'un MANUSCRIT écrit ailleurs (Google Docs / Word + Paperpile) :
     { text, fileName, body, parts, plan, picks, busy, status, report, header,
       lines, headerPicks } — voir utils/manuscriptImport.js.
     `header` = titre / auteurs / affiliations lus en tête du document ;
     `lines`  = la zone d'en-tête telle qu'elle a été comprise ({ at, text, role }) :
                la fenêtre d'import la montre pour laisser CORRIGER les rôles ;
     `body`   = les blocs du document, pour recalculer l'en-tête après correction ;
     `headerPicks` = ceux que l'utilisateur veut ranger dans le projet. */
  const [msImport, setMsImport] = useState(null);
  /* COMPTE RENDU DU DERNIER IMPORT, affiché EN HAUT de la page projet :
     la fenêtre d'import se FERME dès que l'import est écrit (elle restait
     ouverte, le bouton restait actif et un second clic collait le manuscrit
     une deuxième fois dans les sections). `undoProject` = le projet tel qu'il
     était AVANT l'import, pour un « ↩︎ Undo import » immédiat. */
  const [msResult, setMsResult] = useState(null);
  /* Garde anti double import : `busy` ne suffisait pas (deux clics dans le même
     rendu, ou un clic pendant que l'écriture est en cours). */
  const msBusyRef = useRef(false);
  /* Compte rendu du dernier « 🔗 Link citations… » (section References). */
  const [citationLinkReport, setCitationLinkReport] = useState('');
  const [linkTestId, setLinkTestId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pubs = useMemo(loadPublications, []);
  /* Les « Relevant papers » alimentent eux aussi la bibliographie d'un projet
     (Publications → « Project bibliography » → Import) : quand une entrée ne
     porte pas encore ses auteurs, sa publication d'origine peut donc venir des
     deux listes — c'est dans ce pot commun que puise citeData(). */
  const citationPool = useMemo(() => [...pubs, ...loadRelevantPapers()], [pubs]);
  const [tableDraft, setTableDraft] = useState(null); // null | { section, insertText }
  /* OÙ le dernier document envoyé depuis une section a été rangé sur le Drive :
     la même chaîne de dossiers que l'envoi est résolue puis RELUE, et le fichier
     doit y être — l'interface ne dit jamais « enregistré » sans dire où
     (voir verifySectionUpload / sectionDriveInfo). */
  const [driveFlash, setDriveFlash] = useState({});
  const [showExport, setShowExport] = useState(false);
  /* La LARGEUR de la page : « ⤢ Wide editing » choisi par l'utilisateur.
     Elle changeait AVANT toute seule, à chaque clic dans un texte (élargir) et
     à chaque clic sur un bouton (rétrécir) : le bouton se déplaçait sous le
     curseur pendant le clic, donc la commande était perdue et il fallait
     cliquer deux fois (et la page « sautait » en largeur sans arrêt). Plus rien
     n'est automatique : voir le bouton dans l'en-tête. */
  const [wideLayout, setWideLayout] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(4);
  const [mmFeedback, setMmFeedback] = useState(''); // "✓ Updated HH:MM" flash after manual M&M refresh
  const [docMode, setDocMode] = useState('view');   // export doc: 'view' | 'edit' | 'suggest'
  /* ⬇️ « Word (.docx) » : le fichier se construit en rassemblant les figures
     (une par une) — le bouton le dit (« ⏳ … ») et ne peut pas être cliqué deux
     fois, et le bandeau garde le compte rendu de ce qui est parti. */
  const [docxBusy, setDocxBusy] = useState(false);
  const [docxFeedback, setDocxFeedback] = useState('');
  /* ⛶ « Full screen » de la PAGE DOCUMENT : le document occupait déjà l'écran,
     mais sa colonne de lecture restait bornée à 4xl — sur un grand écran, la
     moitié de la largeur était perdue, et « ✏️ Edit text » se faisait dans une
     colonne étroite. Le bouton élargit le document à TOUT l'écran ET demande le
     plein écran du navigateur (comme F11, sans quitter la page) ; « ↙️ Exit »
     (ou Échap) revient à la colonne de lecture. L'IMPRESSION ne bouge pas :
     « 🖨️ Print / Save as PDF » réimprime la feuille calculée par
     printProjectDoc, pas la mise en page d'écran. */
  const [docFull, setDocFull] = useState(false);
  const docPaneRef = useRef(null);
  const [suggestBaseHtml, setSuggestBaseHtml] = useState(''); // HTML snapshot when suggestion mode starts
  const [mmEditOpen, setMmEditOpen] = useState(false); // edit the M&M text on the project page
  const [slidePickerFor, setSlidePickerFor] = useState(null); // which text section is picking a slide
  const [slideInserting, setSlideInserting] = useState(false); // busy while rendering a slide to PNG
  const [mmDraft, setMmDraft] = useState('');           // M&M textarea draft
  const [capEditKey, setCapEditKey] = useState(null);   // 'testId:itemId' being caption-edited
  const [capDraft, setCapDraft] = useState('');         // caption textarea draft
  const [commentDraft, setCommentDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [openReplyId, setOpenReplyId] = useState(null);
  const projectNameBeforeEditRef = useRef(null); // Drive-file rename tracking

  const visibleTests = useMemo(() => {
    if (isSuper) return tests;
    return tests.filter((t) => !t.operator || t.operator === myName);
  }, [tests, isSuper, myName]);

  const project = projects.find((p) => p.id === currentProjectId);
  const pubFormat = useMemo(() => project?.pubFormat || loadPubFormat(), [project]);

  /* ⛶ PLEIN ÉCRAN DE LA PAGE DOCUMENT (voir aussi le bouton « ⛶ Full screen »).
     Les deux effets sont déclarés ICI, avant le « projet introuvable » de la fin :
     un Hook placé après un return ne serait pas appelé à chaque rendu.
       • Échap referme le plein écran, et sortir du plein écran par le navigateur
         (F11) rend sa largeur à la colonne de lecture ;
       • l'entrée/sortie du plein écran du NAVIGATEUR ne vise que notre volet
         (docPaneRef) : le plein écran d'une autre page n'est jamais refermé. */
  useEffect(() => {
    if (!showExport) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDocFull(false); };
    const onFsChange = () => setDocFull((prev) => (prev ? !!document.fullscreenElement : prev));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [showExport]);

  useEffect(() => {
    const pane = docPaneRef.current;
    try {
      if (docFull && showExport && pane && !document.fullscreenElement) pane.requestFullscreen?.();
      else if (document.fullscreenElement === pane && (!docFull || !showExport)) document.exitFullscreen?.();
    } catch { /* plein écran refusé (permission, iframe) : la LARGEUR suit quand même */ }
  }, [docFull, showExport]);

  // Link-existing-test dropdown: ONE entry per test NAME (the instances of a
  // test share the same name, so a flat per-instance list shows repetitions).
  // Names whose instances are ALL already linked to this project are hidden.
  // Linking a name links every instance of the test in one go.
  const linkableTestNames = useMemo(() => {
    const linkedIds = new Set((project?.experiments || []).map((e) => e.testId));
    const byName = new Map();
    visibleTests.forEach((t) => {
      // Storage boxes are not experiments — they must not appear in the linker.
      if (String(t.type || '') === 'plate-9x9box') return;
      const n = String(t.name || '').trim();
      if (!n) return;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(t);
    });
    return Array.from(byName.entries())
      .filter(([, items]) => items.some((t) => !linkedIds.has(t.id)))
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));
  }, [visibleTests, project?.experiments]);

  // ---- Saved Image Builder canvases (editable figures linked on this page) ----
  // The Image Builder stores each composition in the project image library as an
  // item carrying its `canvasData` snapshot: those items ARE the links back into
  // the editor, so this list is read straight from that library (memory-first;
  // refreshed on every remount, e.g. coming back from the builder).
  const [canvasLibVersion, setCanvasLibVersion] = useState(0);
  const savedCanvases = useMemo(() => {
    // The canvases of a project are private to its team (owner + authorized
    // people): without access to the project NOTHING is listed here — the
    // library read itself is gated, not just the page around it.
    if (!projectAccessFor(project, myName, isSuper)) return [];
    const list = readProjectLibrary(project?.id || 'global') || [];
    return list
      .filter((i) => i && i.canvasData)
      .sort((a, b) => String(b.updatedAt || b.addedAt || '').localeCompare(String(a.updatedAt || a.addedAt || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, canvasLibVersion, myName, isSuper]);

  // Forget a canvas link (the Drive/cloud copy of the image is kept).
  const removeCanvasLink = (id) => {
    if (!canModify) return;
    if (!window.confirm('Remove this canvas from the project image library? The cloud/Drive copy is kept.')) return;
    removeProjectLibraryItem(project.id, id);
    setCanvasLibVersion((v) => v + 1);
  };

  /* ---- ✏️ RENOMMER UN CANVAS -------------------------------------------------
     « in no places it is possible to rename canvases » : le libellé d'une toile
     ne se changeait que depuis la modale 🖼 Library de l'Image Builder (bouton ✎
     sur une vignette) — pas là où on les VOIT (cette page). Le libellé vit sur
     l'entrée de la bibliothèque du projet ; les figures qui renvoient à ce canvas
     gardent leur `canvasLabel` (c'est lui que montrent les infobulles
     « ✏️ Modify in Image Builder »), donc on le met à jour du même geste.
     LE FICHIER DU DRIVE SUIT AUSSI (renameFigureOnDrive) : « I cannot find my
     renamed canvas in Drive » — le fichier gardait le nom de sa première
     écriture, et la sauvegarde suivante, le nom ayant changé, ne le retrouvait
     plus à écraser : elle en déposait un second. Le fichier est renommé SUR
     PLACE (même identifiant), donc les liens et la composition suivent. */
  const renameCanvas = (c) => {
    if (!canModify) return;
    const name = window.prompt('Canvas name:', c.label || 'Canvas');
    const label = String(name || '').trim();
    if (!label || label === c.label) return;
    // Le navigateur peut REFUSER l'écriture (magasin plein) : on le DIT, sinon le
    // nom paraît changé et revient tout seul au rechargement suivant.
    const kept = renameProjectLibraryItem(project.id, c.id, label);
    const figures = project.figures || {};
    const nextFigures = {};
    let touched = false;
    Object.keys(figures).forEach((sec) => {
      nextFigures[sec] = (figures[sec] || []).map((fig) => {
        if (!fig || fig.canvasId !== c.id || fig.canvasLabel === label) return fig;
        touched = true;
        return { ...fig, canvasLabel: label };
      });
    });
    if (touched) updateProject({ figures: nextFigures });
    setCanvasLibVersion((v) => v + 1);
    /* Le nom est gardé même quand la liste ne rentre pas (rememberCanvasName) :
       `kept === false` ne veut plus dire « perdu », mais « le magasin est plein ».
       On le dit exactement comme ça, au lieu de laisser croire au pire. */
    const full = kept === false || lastLibraryListWrite().kept === false;
    setFigDriveMsg(!kept
      ? `⚠️ “${label}” could not be written anywhere (this browser’s store refused even the small name record): that name lives in this session only. Free some room with “☁ Save figures to Drive” above, then rename again.`
      : (full
        ? `✏️ “${c.label}” is now called “${label}” — the figures that point at it follow, and the name is remembered (it survives a refresh). ⚠️ This browser’s store is FULL, though: the image lists themselves could not be rewritten, so free some room with “☁ Save figures to Drive” above before adding more.`
        : `✏️ “${c.label}” is now called “${label}” (the figures that point at it follow).`));
    /* LE NOM DU FICHIER SUR LE DRIVE SUIT — c'est le geste qui manquait : on
       cherchait la toile dans le dossier sous un nom que le Drive ne portait
       pas. Le fichier garde son identifiant, donc les figures qui le visent
       continuent de fonctionner ; son sidecar de composition est renommé avec
       lui. Ce qui s'est passé est DIT (renommé / déjà sous ce nom / refusé). */
    renameFigureOnDrive({ scope: 'project', projectId: project.id, projectName: project.name || '', id: c.id, label })
      .then((r) => {
        if (!r || !r.ok) return;                       // le message local reste : il dit déjà l'essentiel
        setFigDriveMsg((m) => (r.unchanged
          ? `${m} 📁 On Drive the image is already called “${r.name}”.`
          : `${m} 📁 On Drive, “${r.from}” is now “${r.name}” — same file (its link and its composition sidecar follow it), so no copy is left behind.`));
      })
      .catch(() => {});
  };

  /* ---- 🧹 LES COPIES DU MÊME CANVAS -------------------------------------------
     La sauvegarde automatique de l'Image Builder écrit dans l'entrée de SON
     canvas — tant qu'elle se souvient de son id. Page rechargée, autre poste,
     liste de navigateur allégée : le souvenir était perdu et chaque passage
     AJOUTAIT une copie ; la liste ci-dessous se remplissait de « Canvas
     18/09/2026 » identiques. Les compositions portent désormais leur clé et se
     fusionnent (voir figuresLibrary) ; ce bouton nettoie ce qu'une version
     précédente a laissé — la composition la plus récente de chaque canvas
     survit, et toute entrée qu'une figure de cette page référence (son lien
     « ✏️ Modify in Image Builder ») est GARDÉE. Rien n'est retiré du Drive. */
  const referencedCanvasIds = () => {
    const out = [];
    Object.keys(project.figures || {}).forEach((sec) => {
      (project.figures[sec] || []).forEach((fig) => { if (fig && fig.canvasId) out.push(fig.canvasId); });
    });
    return out;
  };
  const canvasDupCount = useMemo(() => {
    if (!projectAccessFor(project, myName, isSuper)) return 0;
    try { return countCanvasDuplicates({ allowedProjectIds: [project.id], keepIds: referencedCanvasIds() }); } catch { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, canvasLibVersion, myName, isSuper]);

  const cleanCanvasDuplicates = () => {
    if (!canModify) return;
    const keepIds = referencedCanvasIds();
    const n = countCanvasDuplicates({ allowedProjectIds: [project.id], keepIds });
    if (!n) return;
    if (!window.confirm(`Remove ${n} duplicate cop${n === 1 ? 'y' : 'ies'} of a canvas saved again and again?\n\nThe most recent composition of each canvas is kept, along with every entry a figure of this page points at. Nothing is deleted from Google Drive.`)) return;
    const res = removeCanvasDuplicates({ allowedProjectIds: [project.id], keepIds });
    setCanvasLibVersion((v) => v + 1);
    setFigDriveMsg(res.removed
      ? `🧹 ${res.removed} duplicate canvas cop${res.removed === 1 ? 'y' : 'ies'} removed — the newest composition of each canvas was kept.`
      : '✓ No duplicate canvas left.');
  };

  /* ---- 📥 RESTAURER UN CANVAS DEPUIS SON FICHIER ----------------------------
     « j'ai fait un rafraîchissement forcé et j'ai perdu mon canvas, et je venais
     de le finir » : la composition d'un canvas est écrite ENTIÈRE (les pixels de
     chaque panneau) et ne rentre pas toujours dans le magasin du navigateur —
     elle vivait alors en mémoire seulement, et le rafraîchissement l'emporte. Le
     seul exemplaire complet qui reste est le fichier « <image>.meta.json » posé
     À CÔTÉ de l'image sur le Drive. Ce bouton le reprend là où il est
     (Téléchargements, copie du Drive, poste d'un collègue) et remet la
     composition dans la bibliothèque de CE projet — avec sa clé, donc « 💾 Save
     now » la remettra dans la MÊME entrée. Rien n'est supprimé, rien n'est
     envoyé : c'est la composition qui revient, et l'image repart au Drive à la
     première sauvegarde. */
  const canvasFileRef = useRef(null);
  const [canvasRestoreBusy, setCanvasRestoreBusy] = useState(false);

  const restoreCanvasFromFile = async (file) => {
    if (!file || !canModify) return;
    setCanvasRestoreBusy(true);
    setFigDriveMsg('📥 Reading the canvas file…');
    try {
      const text = await file.text();
      const res = await restoreCanvasFromFigureMeta({
        text, fileName: file.name || '', scope: 'project', projectId: project.id
      });
      if (!res.ok) { setFigDriveMsg(`⚠ ${res.error}`); return; }
      setCanvasLibVersion((v) => v + 1);
      setFigDriveMsg(`✅ “${res.entry.label}” ${res.created ? 'restored into' : 'updated in'} this project’s library`
        + `${res.lightened ? ' (its panels were compressed so the composition fits this browser)' : ''}`
        + (res.persisted
          ? ' — click 🖼 Open in Image Builder below, then 💾 Save now to put its image back on Drive.'
          : ' — ⚠ but this browser’s store is FULL, so the canvas is only here for this session: free space with “☁ Save figures to Drive” above (it moves the figures whose pixels live only here), then import the file again.'));
    } catch (err) {
      setFigDriveMsg(`⚠ ${(err && err.message) || 'Could not read that file'}`);
    } finally {
      setCanvasRestoreBusy(false);
    }
  };

  /* ---- ☁ ⇄ this project's image library against Google Drive -----------------
     The image FILES are on Drive (<dataset>/projects/<projet>/images) but the
     LIST that displays them — which figures, their labels, their order, the saved
     canvases — lives in this browser. These are the two ADDITIVE gestures of the
     Image Library modal, offered here too because the project page is where one
     looks for “my figures”:
       • ⬇ Add missing figures from Drive → relit le dossier et AJOUTE les images
         qu'il contient et que cette liste n'affiche pas (autre ordinateur, images
         envoyées par un collègue) ; lecture seule, rien n'est remplacé.
       • ☁ Save figures to Drive → envoie au Drive les figures dont les pixels ne
         vivent encore que dans ce navigateur (sinon elles ne suivent pas). */
  const [figDriveBusy, setFigDriveBusy] = useState(false);
  const [figDriveMsg, setFigDriveMsg] = useState('');
  /* LES AUTRES DOSSIERS DE PROJET DU DATASET (voir utils/figuresFolder.js) : le
     dossier d'images est dérivé du NOM du projet, donc un projet renommé laisse
     ses fichiers dans l'ancien dossier. Ces entrées permettent de DÉSIGNER le bon
     dossier au lieu de laisser l'application en fabriquer un vide à côté. */
  const [figFolderChoices, setFigFolderChoices] = useState([]);
  /* Glisser-déposer des figures d'une section : `figDrag` = la figure TENUE par
     le pointeur, `figOver` = celle qui est DESSOUS (voir dropFigure, plus bas).
     Déclarés ICI, avec les autres états : un crochet ne peut pas vivre après le
     `if (!project)` de la page (l'ordre des crochets doit être le même à chaque
     rendu). */
  const [figDrag, setFigDrag] = useState(null);
  const [figOver, setFigOver] = useState('');
  const figDriveScope = () => ({ scope: 'project', projectId: project.id, projectName: project.name || '' });

  const saveFiguresToDrive = async () => {
    if (figDriveBusy || !canModify) return;
    setFigDriveBusy(true);
    setFigDriveMsg('☁ Sending to Drive the figures that are still only in this browser…');
    try {
      const res = await pushLibraryToDrive(figDriveScope());
      setCanvasLibVersion((v) => v + 1);
      setFigDriveMsg(res.total === 0
        ? '✓ Every figure of this project is already on Drive.'
        : res.failed === 0 && res.queued === 0
          ? `✓ ${res.uploaded} figure${res.uploaded === 1 ? '' : 's'} saved to ${res.folder}.`
          : `${res.failed ? '⚠' : '⏳'} ${[
            res.uploaded ? `${res.uploaded} figure${res.uploaded === 1 ? '' : 's'} saved to ${res.folder}` : '',
            res.queued ? `${res.queued} queued for ${res.folder} — they upload by themselves as soon as Drive answers, nothing is lost` : '',
            res.failed ? `${res.failed} failed — check the connection and try again` : ''
          ].filter(Boolean).join(' · ')}.`);
    } catch (err) {
      setFigDriveMsg(`⚠ ${(err && err.message) || 'Could not save the figures to Drive'}`);
    }
    setFigDriveBusy(false);
  };

  /* ⬇ RELIRE LE DOSSIER DU PROJET — et DIRE lequel a été lu.
     `fromFolder` vide = laisser chercher (miroir partagé → nom canonique →
     dossier voisin au nom proche, voir utils/figuresFolder.js : la lecture ne
     crée plus de dossier). `fromFolder` nommé = l'utilisateur a désigné le
     dossier qui porte ses figures ; il est alors retenu pour ce projet, donc les
     lectures ET les envois suivants visent celui-là (« deux dossiers images, l'un
     vide » cesse de se reproduire). */
  const addMissingFiguresFromDrive = async (fromFolder = '') => {
    if (figDriveBusy) return;
    setFigDriveBusy(true);
    setFigDriveMsg(fromFolder
      ? `⬇ Reading “${fromFolder}” on Drive and adopting it for this project…`
      : '⬇ Reading this project’s images folder on Drive…');
    try {
      const res = await pullLibraryFromDrive({ ...figDriveScope(), fromFolderName: fromFolder || '' });
      setCanvasLibVersion((v) => v + 1);
      setFigFolderChoices((res.candidates || []).filter((c) => c.name !== fromFolder));
      const noCompo = res.noComposition
        ? ` ⚠ ${res.noComposition} of them have NO editable copy on Drive (no “<image>.meta.json” beside the image), so they cannot be reopened in the Image Builder — a canvas whose editable copy never reached Drive cannot be brought back by this button.`
        : '';
      const adoptedNote = res.adopted
        ? ` ✓ This folder is now the one this project uses on Drive — nothing else is read or written there.`
        : '';
      const movedNote = (!res.adopted && (res.via === 'mirror' || res.via === 'similar'))
        ? ` (the Drive folder is still named “${res.folder.split('/')[1] || ''}”, not like the project — reading it — pick a folder below, or rename the project folder on Drive, to have both agree)`
        : '';
      setFigDriveMsg(res.error
        ? `⚠ ${res.error}`
          + (res.candidates && res.candidates.length
            ? ` The dataset HAS ${res.candidates.length} project folder(s) with images — pick the one holding your figures below: reading it adopts it for this project. Nothing is deleted.`
            : '')
        : res.found === 0
          ? `No image found in ${res.folder} (nothing has been uploaded there yet — use ☁ Save figures to Drive first).`
            + (res.candidates && res.candidates.length ? ` Other project folders do hold figures — see below.` : '')
          : res.added === 0
            ? `✓ ${res.found} image${res.found === 1 ? '' : 's'} in ${res.folder}${movedNote} — all already listed here.` + noCompo + adoptedNote
            : `✓ ${res.added} figure${res.added === 1 ? '' : 's'} added from ${res.folder} (${res.found} file${res.found === 1 ? '' : 's'} in the folder)${movedNote}.` + noCompo + adoptedNote);
    } catch (err) {
      setFigDriveMsg(`⚠ ${(err && err.message) || 'Could not read the Drive folder'}`);
    }
    setFigDriveBusy(false);
  };

  // ---- Coworkers & permissions (computed early so every effect can use them) ----
  // Each coworker gets 'view' (read-only) or 'modify' (see and edit).
  // Legacy entries (plain strings) had full access → 'modify'.
  const isOwner = !!project && (isSuper || project.scientist === myName);
  const authList = project ? normalizeAuthorized(project.authorizedPeople || []) : [];
  const myCoworker = authList.find((c) => c.name === myName) || null;
  const canSee = !!currentUser && !!project && (isOwner || !!myCoworker);
  const canModify = isOwner || (myCoworker && myCoworker.permission === 'modify');

  const [storageWarning, setStorageWarning] = useState('');
  /* ⚠ UNE ÉCRITURE REFUSÉE SE DIT ICI — ET ELLE N'EST PLUS UN CUL-DE-SAC.
     Chaque modification (texte, références, figures, commentaires) passe par cet
     effet. `saveProjects` avalait l'échec du magasin (quota plein, navigation
     privée) : le texte saisi disparaissait à la réouverture du projet sans le
     moindre avertissement. L'échec est maintenant rapporté — mais surtout, il
     est D'ABORD RÉPARÉ : saveProjectsRescued refait de la place DANS le magasin
     du navigateur (copies de figures liées à leur fichier Drive, puis, en
     dernier recours, images qui n'existaient que dans ce navigateur) et
     l'écriture repart. Ce qui a été libéré est dit (storageNote), et l'échec
     définitif parle en chiffres : ce que le magasin contient vraiment. */
  const [storageNote, setStorageNote] = useState('');
  useEffect(() => {
    const res = saveProjectsRescued(projects);
    if (!res.ok) {
      setStorageWarning(storageRefusedText(res));
      return;
    }
    setStorageWarning('');
    if (res.linked || res.droppedImages || res.forgotten) setStorageNote(storageFreedText(res));
    /* L'ÉTAT SUIT CE QUI A ÉTÉ ÉCRIT (voir commitProjectVerified) : sans cela,
       l'écriture suivante repartirait de la liste lourde, et échouerait de
       nouveau à chaque modification — exactement la boucle sans issue signalée. */
    if (res.scopedChanged) replaceProjects(res.list);
  }, [projects]);

  /* ── LES IMAGES DES FIGURES SE REMONTENT TOUTES SEULES DU DRIVE ────────────
     ⚠️ CET EFFET VIT ICI, AVEC LES AUTRES HOOKS, ET AVANT LE `return` DE LA PAGE
     « Project not found » (plus bas) : un hook après ce retour conditionnel
     n'aurait pas été appelé à chaque rendu — React exige le même ordre.

     Une figure de section peut n'avoir plus de pixels ici : le magasin du
     navigateur était plein et l'écriture d'urgence a remplacé l'image encodée
     par son lien Drive (voir saveProjectsRescued). Et quand ce lien manquait —
     c'est le cas des compositions insérées avant que l'Image Builder ne le pose
     — il ne restait RIEN à afficher : « le projet est là, mais sans les
     images », la seule issue étant de les réimporter à la main depuis le Drive.

     Ici, chaque figure sans pixels dont le lien Drive est CONNU récupère
     immédiatement une URL AFFICHABLE (getRenderableDriveUrl : le lien « view »
     d'un fichier ne se dessine pas dans un <img>, la vignette Drive si) — sans
     recopier un seul octet dans le magasin du navigateur. La marque « pixels
     perdus » tombe, et la figure redevient une image.

     Une figure dont le lien n'est pas encore connu (la liste de la bibliothèque
     a été allégée elle aussi) n'est pas perdue pour autant : « ⬇ Add missing
     figures from Drive » relit le dossier du projet, l'entrée du canvas revient
     avec son lien, et la passe suivante la remonte. */
  const restoredFigRef = useRef(new Set());
  useEffect(() => {
    if (!canModify || !project) return;
    const sections = Object.keys(project.figures || {});
    if (!sections.length) return;
    const patches = [];
    sections.forEach((sec) => {
      (project.figures[sec] || []).forEach((fig) => {
        if (!fig || typeof fig !== 'object' || !fig.id) return;
        const hasPixels = fig.pixelsMissing !== true && !!String(fig.url || '').trim();
        if (hasPixels || restoredFigRef.current.has(fig.id)) return;
        const link = figureDriveLink(fig, project.id);
        if (!link) return;                  // rien de connu : on retentera après la relecture du Drive
        restoredFigRef.current.add(fig.id);
        patches.push({
          sec,
          figId: fig.id,
          patch: { url: getRenderableDriveUrl(link), full: link, driveUrl: link, pixelsMissing: false }
        });
      });
    });
    if (!patches.length) return;
    const figures = { ...(project.figures || {}) };
    patches.forEach(({ sec, figId, patch }) => {
      figures[sec] = (figures[sec] || []).map((f) => (f.id === figId ? { ...f, ...patch } : f));
    });
    /* Même écriture que le bouton « commit » de la page (replaceProjects, voir
       commitProjectVerified) : l'état React et la liste vivante avancent
       ENSEMBLE, et l'effet de sauvegarde ci-dessus écrit derrière. */
    replaceProjects((prev) => prev.map((p) => (p.id === project.id
      ? { ...p, figures, updatedAt: new Date().toISOString() }
      : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, canModify]);

  /* ── LES CANVAS SE REMONTENT TOUT SEULS (sans cliquer « ⬇ Add missing figures
     from Drive ») ───────────────────────────────────────────────────────────
     ⛔ CE QUI ÉTAIT SIGNALÉ : « mes canvas ne sont là que si je clique le
        bouton » — « Canvases should… be available without clicking on “restore
        from the drive” button ». La liste des compositions vit dans le
        navigateur (clé `labFiguresLib_<projet>`, fusionnée par contenu entre
        postes, voir utils/figuresLibrary + workspaceKeyStore) ; elle arrive donc
        EN RETARD sur un poste neuf, un navigateur vidé, ou après l'allègement
        d'un magasin plein — et pendant ce temps la page affichait « 🖼 Saved
        canvases · 0 » alors que les compositions étaient sur le Drive.

     ✅ La page relit donc le dossier d'images du projet ELLE-MÊME, UNE FOIS par
        projet et par session, quand un canvas est ATTENDU ici :
          • une figure de la page porte son lien (`canvasId`) et la liste ne le
            montre pas → c'est le cas d'un canvas inséré depuis un autre poste ;
          • ou la bibliothèque du projet n'a AUCUN canvas (poste neuf) : on ne
            peut pas savoir s'il en existe, alors on regarde une fois.
        C'est la MÊME lecture que le bouton (additive, elle ne supprime ni
        n'écrase rien), et elle n'a lieu qu'une fois : si le Drive est coupé ou
        le dossier vide, le bouton reste là et rien ne boucle. */
  const autoCanvasPullRef = useRef(new Set());
  useEffect(() => {
    if (!project) return;
    const pid = project.id;
    if (autoCanvasPullRef.current.has(pid)) return;
    const lib = readProjectLibrary(pid) || [];
    const known = new Set(lib.filter((i) => i && i.canvasData).map((i) => i.id));
    const expected = [];
    Object.keys(project.figures || {}).forEach((sec) => {
      (project.figures[sec] || []).forEach((fig) => { if (fig && fig.canvasId) expected.push(fig.canvasId); });
    });
    const missing = expected.filter((id) => !known.has(id));
    if (!missing.length && known.size) return;
    autoCanvasPullRef.current.add(pid);
    (async () => {
      setFigDriveBusy(true);
      setFigDriveMsg('⬇ Reading this project’s images folder on Drive — its saved canvases come back on their own…');
      try {
        const res = await pullLibraryFromDrive(figDriveScope());
        setCanvasLibVersion((v) => v + 1);
        setFigDriveMsg(res && res.error
          ? `⚠ ${res.error}`
          : res && res.restored
            ? `✓ ${res.restored} saved canvas${res.restored === 1 ? '' : 'es'} brought back from ${res.folder} — nothing to click.`
              + (res.noComposition ? ` ⚠ ${res.noComposition} image${res.noComposition === 1 ? '' : 's'} came back WITHOUT an editable copy (no “<image>.meta.json” next to it): those cannot be reopened here — only their picture is left.` : '')
            : '');
      } catch (err) {
        setFigDriveMsg(`⚠ ${(err && err.message) || 'Could not read the Drive folder'}`);
      } finally {
        setFigDriveBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, canvasLibVersion]);

  /* Bibliographie / références enregistrées AVANT la prise en charge des
     co-auteurs : leurs champs manquants — les AUTEURS en premier lieu — sont
     recopiés une fois depuis la publication d'origine, puis sauvegardés. Sans
     cette réparation, Publications → « Project bibliography » et la bibliographie
     du document du projet n'affichaient que le titulaire du projet, faute
     d'auteurs dans l'entrée. Un champ déjà rempli n'est jamais écrasé (une
     correction à la main reste intacte) et rien n'est écrit si rien ne change. */
  useEffect(() => {
    if (!canModify || citationPool.length === 0) return;
    const fillFromOrigin = (entry) => {
      const data = pubCitationData(entry, citationPool);
      const next = { ...entry };
      let touched = false;
      ['authors', 'journal', 'year', 'doi', 'volume', 'pages'].forEach((key) => {
        if (String(next[key] || '').trim()) return;
        if (!String(data[key] || '').trim()) return;
        next[key] = data[key];
        touched = true;
      });
      return touched ? next : entry;
    };
    const fillList = (list) => {
      if (!Array.isArray(list) || list.length === 0) return list;
      const filled = list.map(fillFromOrigin);
      return filled.some((e, i) => e !== list[i]) ? filled : list;
    };
    const next = projects.map((p) => {
      const bibliography = fillList(p.bibliography);
      const references = fillList(p.references);
      if (bibliography === p.bibliography && references === p.references) return p;
      return { ...p, bibliography, references };
    });
    if (next.some((p, i) => p !== projects[i])) replaceProjects(next);
  }, [projects, citationPool, canModify]);

  // Keep the persisted "Materials and Methods" snapshot fresh every time the
  // export document is opened (it pulls the latest Experimental Conditions,
  // Instrumental Setup and Experiment Setup of the included tests).
  useEffect(() => {
    if (!showExport || !project) return;
    if (!canModify) return; // view-only coworkers must not change the data
    // Never overwrite a manually edited Materials & Methods text.
    if (project.materialsAndMethods?.edited) return;
    const parts = mmPartsFor(project, tests, true);
    replaceProjects((prev) => prev.map((p) =>
      p.id === project.id
        ? {
            ...p,
            materialsAndMethods: {
              text: parts.map((q) => `${q.name}: ${q.text}`).join('\n'),
              generatedAt: new Date().toISOString(),
              count: parts.length,
              scope: 'included'
            },
            updatedAt: new Date().toISOString()
          }
        : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExport]);

  if (!project) {
    return (
      <div className="p-6 h-full overflow-y-auto custom-scrollbar bg-slate-50">
        <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500 text-center">
          Project not found.
          <div className="mt-3">
            <button onClick={() => setCurrentModule('projects')}
                    className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
              ← Back to Projects
            </button>
          </div>
        </div>
      </div>
    );
  }

  const updateProject = (patch) => {
    if (!canModify) return; // view-only coworkers cannot change anything
    replaceProjects((prev) => prev.map((p) =>
      p.id === project.id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p));
  };

  /** LE PROJET VIVANT : tel qu'il est en mémoire MAINTENANT, pas tel qu'il était
   *  dans le rendu qui a créé le gestionnaire en cours. C'est lui qui doit servir
   *  de base dès qu'un `await` s'est glissé avant l'écriture (import de
   *  manuscrit, archivage Drive) — voir projectsRef. */
  const liveProject = () => projectsRef.current.find((p) => p.id === project.id) || project;

  /**
   * ÉCRIRE UN PATCH, PUIS LE RELIRE — la seule écriture dont un import a le droit.
   *
   * Le magasin du navigateur peut REFUSER une écriture (quota plein ~5 Mo,
   * navigation privée) : `saveProjects` avalait cette erreur, la page annonçait
   * « ✓ importé » et tout disparaissait à la réouverture du projet. Ici :
   *   1. le patch part avec le reste de la liste (une seule écriture) ;
   *   2. le projet est RELU du magasin et comparé au patch (saveProjectsChecked) ;
   *   3. si le navigateur a refusé, et que `lighten` est demandé, une seconde
   *      écriture part avec les figures allégées (voir lightenProjectForStorage)
   *      — le texte et les références passent toujours en premier ;
   *   4. l'état React suit EXACTEMENT ce qui a été écrit.
   * @returns {{ ok:boolean, error:string, missing:string[], lightened:string[] }}
   */
  const commitProjectVerified = (patch, { lighten = false } = {}) => {
    const commit = (extra) => {
      /* ⚠ LA BASE EST LA LISTE VIVANTE, PAS LA FERMETURE. Un import de manuscrit
         fait DEUX écritures séparées par un `await` (le texte, les références et
         les figures, puis la référence du document déposé sur le Drive) : la
         seconde repartait de la liste capturée AVANT l'import, donc elle
         réécrivait l'ancien projet — l'import disparaissait de l'écran et du
         magasin, et il fallait « ♻ Load the Drive copy » pour retrouver le texte
         (voir projectsRef pour le détail). */
      const list = projectsRef.current.map((p) => (p.id === project.id
        ? { ...p, ...extra, updatedAt: new Date().toISOString() } : p));
      return { list, res: saveProjectsChecked(list, { projectId: project.id, fields: extra }) };
    };
    let attempt = commit(patch);
    const lightened = [];
    if (!attempt.res.ok && lighten) {
      /* L'allègement part aussi du projet VIVANT : sans cela, l'écriture de
         secours d'un second commit (la référence du fichier Drive) aurait allégé
         et réécrit les figures d'AVANT l'import. */
      const light = lightenProjectForStorage({ ...liveProject(), ...patch });
      if (light.dropped.length) {
        lightened.push(...light.dropped);
        attempt = commit({ ...patch, figures: light.project.figures });
      }
    }
    replaceProjects(attempt.list);
    return {
      ok: attempt.res.ok, error: attempt.res.error, missing: attempt.res.missing || [], lightened
    };
  };

  // ---- Comments & review ----
  const comments = project.comments || [];
  const openComments = comments.filter((c) => !c.resolved).length;
  // Comments modify the project state, so they follow the 'modify' permission.
  const isAuthorized = canModify;

  const setCoworkerPermission = (name, permission) => {
    const rest = authList.filter((c) => c.name !== name);
    const next = permission ? [...rest, { name, permission }] : rest;
    next.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
    updateProject({ authorizedPeople: next });
  };

  const addComment = () => {
    const text = commentDraft.trim();
    if (!text || !isAuthorized) return;
    updateProject({
      comments: [...comments, {
        id: genProjectId(), author: myName, text,
        createdAt: new Date().toISOString(), resolved: false, replies: []
      }]
    });
    setCommentDraft('');
  };

  const addReply = (commentId) => {
    const text = (replyDrafts[commentId] || '').trim();
    if (!text || !isAuthorized) return;
    updateProject({
      comments: comments.map((c) => c.id === commentId
        ? { ...c, resolved: false, replies: [...(c.replies || []), { id: genProjectId(), author: myName, text, createdAt: new Date().toISOString() }] }
        : c)
    });
    setReplyDrafts((d) => ({ ...d, [commentId]: '' }));
    setOpenReplyId(null);
  };

  const toggleResolve = (commentId) =>
    updateProject({
      comments: comments.map((c) => c.id === commentId ? { ...c, resolved: !c.resolved } : c)
    });

  const deleteComment = (commentId) => {
    const c = comments.find((x) => x.id === commentId);
    if (!c || !isAuthorized) return;
    if (!(isSuper || c.author === myName || project.scientist === myName)) return;
    updateProject({ comments: comments.filter((x) => x.id !== commentId) });
  };

  // Manually refresh the Materials and Methods section from the current
  // linked-test data (Experimental Conditions / Instrumental Setup / Experiment
  // Setup) and confirm with a short "✓ Updated" flash. `onlyIncluded` defaults
  // to the tests ticked "Include" (matching the export document); pass false to
  // cover every linked test (used by the project page section).
  const regenerateMaterialsAndMethods = (silent = false, onlyIncluded = true) => {
    const parts = mmPartsFor(project, tests, onlyIncluded);
    /* RIEN À LIRE NE VEUT PAS DIRE « EFFACE CE QUI EST ÉCRIT » : avec aucun test coché
       « Include », la génération sort vide et ÉCRASAIT le texte du projet — celui qu'on
       a écrit à la main (« ✏️ Edit text ») comme celui qu'un manuscrit importé a déposé
       dans ce champ, et que le document imprime (voir la section « Materials and
       Methods » du document). Quand il n'y a rien à lire, le texte reste : la page le
       DIT au lieu de le perdre. */
    if (!parts.length && String((project.materialsAndMethods || {}).text || '').trim()) {
      if (!silent) {
        setMmFeedback('⚠ No test to read — the Materials & Methods text is unchanged');
        setTimeout(() => setMmFeedback(''), 3500);
      }
      return;
    }
    updateProject({
      materialsAndMethods: {
        text: parts.map((q) => `${q.name}: ${q.text}`).join('\n'),
        generatedAt: new Date().toISOString(),
        count: parts.length,
        scope: onlyIncluded ? 'included' : 'all',
        edited: false,
        editedAt: null
      }
    });
    if (!silent) {
      setMmFeedback(`✓ Updated ${new Date().toLocaleTimeString()}`);
      setTimeout(() => setMmFeedback(''), 3500);
    }
  };

  // Save a hand-edited Materials & Methods text (project page, before export).
  const saveMaterialsAndMethodsText = () => {
    const text = mmDraft.trim();
    if (!text) return;
    updateProject({
      materialsAndMethods: {
        ...(project.materialsAndMethods || {}),
        text,
        edited: true,
        editedAt: new Date().toISOString()
      }
    });
    setMmEditOpen(false);
    setMmFeedback('✏️ Materials & Methods text saved');
    setTimeout(() => setMmFeedback(''), 3000);
  };

  // Start / save the suggestion-mode edit of the document.
  const startEditDoc = () => {
    if (project.docSuggestion) {
      if (!window.confirm('There is a pending suggestion for this document. Starting a new edit will discard it.')) return;
      updateProject({ docSuggestion: null });
    }
    setDocMode('edit');
    setMmFeedback('');
  };
  const startSuggestDoc = () => {
    const el = document.getElementById('project-doc-container');
    if (!el) return;
    if (project.docSuggestion) {
      if (!window.confirm('There is already a pending suggestion. Starting a new one will replace it.')) return;
    }
    /* LA BASE DE LA SUGGESTION EST LE TEXTE, PAS LA PAGE (voir withoutScreenOnlyUi) :
       les notes du programme et le bandeau du Drive restaient dans le diff. */
    setSuggestBaseHtml(withoutScreenOnlyUi(el.innerHTML));
    setDocMode('suggest');
    setMmFeedback('');
  };

  // Save the (possibly edited) document text as a frozen snapshot on the project,
  // so the user can modify the exported text and it survives reopening.
  const saveDocText = () => {
    const el = document.getElementById('project-doc-container');
    if (!el) return;
    /* LE DOCUMENT FIGÉ EST DU TEXTE, PAS DES BOUTONS. « ✏️ Edit text » → « 💾 Save
       changes » recopiait `el.innerHTML` TEL QUEL : la mention « Automatically
       generated … », l'aide « Only the figures … ⭐-starred … », le bandeau
       « ☁ Text filed on Drive … ♻ Load the Drive copy » et les boutons de la page
       entraient dans l'instantané — donc dans la page relue, dans le PDF et dans le
       .docx. Ils portent tous `no-print` (la classe qui dit « ceci ne vit qu'à
       l'écran », la même que la feuille d'impression et docxExport respectent) et
       sont retirés ici (voir withoutScreenOnlyUi). Le texte de l'auteur sort au
       caractère près. */
    updateProject({ exportDocHtml: withoutScreenOnlyUi(el.innerHTML), docSuggestion: null });
    setDocMode('view');
    setMmFeedback('✓ Document text saved');
    setTimeout(() => setMmFeedback(''), 2500);
  };

  // Save the edited text as a *suggestion*: keep the base document untouched and
  // store a marked-up diff (insertions/deletions highlighted) for review.
  const saveDocSuggestion = () => {
    const el = document.getElementById('project-doc-container');
    if (!el) return;
    // Le diff se compare sur du TEXTE : les deux côtés passent par le même filtre
    // (voir withoutScreenOnlyUi), sans quoi une note du programme apparaîtrait
    // comme une insertion de l'auteur.
    const editedHtml = withoutScreenOnlyUi(el.innerHTML);
    const baseHtml = withoutScreenOnlyUi(suggestBaseHtml) || editedHtml;
    updateProject({
      docSuggestion: {
        baseHtml,
        editedHtml,
        markedHtml: diffHtml(baseHtml, editedHtml),
        author: myName || 'Anonymous',
        createdAt: new Date().toISOString()
      }
    });
    setDocMode('view');
    setMmFeedback('📝 Suggestion saved — review it below');
    setTimeout(() => setMmFeedback(''), 3500);
  };

  const acceptSuggestion = () => {
    if (!project.docSuggestion) return;
    updateProject({ exportDocHtml: project.docSuggestion.editedHtml, docSuggestion: null });
    setMmFeedback('✓ Suggestion accepted');
    setTimeout(() => setMmFeedback(''), 2500);
  };
  const rejectSuggestion = () => {
    updateProject({ docSuggestion: null });
    setMmFeedback('Suggestion rejected');
    setTimeout(() => setMmFeedback(''), 2500);
  };

  // ---- Editable figure captions (per ⭐-starred item, before export) ----
  const captionOverrides = project.figureCaptionOverrides || {};
  const openCaptionEditor = (key, currentCaption) => {
    setCapEditKey(key);
    setCapDraft(currentCaption);
  };
  const saveCaption = (key) => {
    const val = capDraft.trim();
    const next = { ...captionOverrides };
    if (val) next[key] = val; else delete next[key];
    updateProject({ figureCaptionOverrides: next });
    setCapEditKey(null);
    setMmFeedback('✏️ Caption updated');
    setTimeout(() => setMmFeedback(''), 2500);
  };
  const clearCaption = (key) => {
    const next = { ...captionOverrides };
    delete next[key];
    updateProject({ figureCaptionOverrides: next });
    setCapEditKey(null);
    setMmFeedback('↩️ Caption restored to automatic');
    setTimeout(() => setMmFeedback(''), 2500);
  };
  const renderCaptionEditor = (item, test) => {
    const key = `${test?.id}:${item.id}`;
    return (
      <span className="no-print inline-flex items-center gap-1 flex-wrap">
        <input value={capDraft} onChange={(e) => setCapDraft(e.target.value)}
               autoFocus
               placeholder="Write a custom caption…"
               className="border border-blue-300 rounded px-2 py-1 text-[11px] w-72 bg-white outline-none focus:border-blue-500" />
        <button type="button" onClick={() => saveCaption(key)}
                className="text-[10px] font-bold rounded bg-blue-600 text-white px-2 py-1 hover:bg-blue-700">Save</button>
        {captionOverrides[key] && (
          <button type="button" onClick={() => clearCaption(key)}
                  className="text-[10px] font-bold rounded bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 hover:bg-amber-100">↩️ Auto</button>
        )}
        <button type="button" onClick={() => setCapEditKey(null)}
                className="text-[10px] font-bold rounded bg-slate-200 text-slate-600 px-2 py-1 hover:bg-slate-300">Cancel</button>
      </span>
    );
  };

  // Discard the frozen snapshot and rebuild the document from the current
  // project data (any text edits are lost).
  const rebuildDoc = () => {
    if (!window.confirm('Regenerate the document from the current project data? Your text edits to this document will be lost.')) return;
    updateProject({ exportDocHtml: null, docSuggestion: null });
    setDocMode('view');
  };

  // ---- Figures & documents per text section (report-style tools) ----
  const sectionFigures = (sec) => (project.figures || {})[sec] || [];
  const sectionDocs = (sec) => (project.docs || {})[sec] || [];
  const patchFigures = (sec, list) => updateProject({ figures: { ...(project.figures || {}), [sec]: list } });
  const patchDocs = (sec, list) => updateProject({ docs: { ...(project.docs || {}), [sec]: list } });
  const patchSectionFigure = (sec, figId, patch) =>
    patchFigures(sec, sectionFigures(sec).map((f) => (f.id === figId ? { ...f, ...patch } : f)));
  const removeSectionFigure = (sec, figId) =>
    patchFigures(sec, sectionFigures(sec).filter((f) => f.id !== figId));
  /* ── DÉPLACER UNE FIGURE À LA SOURIS ──────────────────────────────────────
     `figDrag` = la figure tenue par le pointeur (`{ sec, id }`), `figOver` =
     celle qui est dessous (pour montrer OÙ elle tombera). L'ordre des figures
     d'une section est celui du document exporté (voir splitAnchoredFigures) :
     `dropFigure` réécrit donc `project.figures` — une figure déposée sur une
     figure d'une AUTRE section change de section, avec sa légende et sa place
     dans le document. Le déplacement lui-même est un util pur (moveFigureTo). */
  const dropFigure = (sec, beforeId) => {
    const held = figDrag;
    setFigDrag(null);
    setFigOver('');
    if (!held || !canModify) return;
    const current = project.figures || {};
    const next = moveFigureTo(current, { from: held.sec, to: sec, id: held.id, before: beforeId });
    /* Rien à écrire quand la figure retombe à sa place (moveFigureTo rend
       l'objet reçu tel quel, on compare donc les références). */
    if (next === current) return;
    updateProject({ figures: next });
    setMmFeedback(held.sec === sec
      ? '↕ Figure moved'
      : `↕ Figure moved to “${sectionLabelOf(sec)}”`);
  };
  // Figures inserted from the Image Builder (“📤 Insert into project…”) carry a
  // link back into the editor: `canvasId` is the canvas of the image library
  // holding that composition and `builderProjectId` is the project whose library
  // it lives in (the builder reads that scope when it loads the canvas). Opening
  // it loads the panels, captions, grid and canvas size, and “💾 Save canvas”
  // updates that same entry — so the figure always reopens the latest version.
  // Figures inserted before the link existed have no canvasId: they still open
  // the Builder (with this project selected), which resumes its state.
  const openBuilderForFigure = (fig) => {
    if (typeof openImageBuilder !== 'function') return;
    openImageBuilder(fig.builderProjectId || project.id, fig.canvasId || null);
  };
  // Readable section name used inside file names (full-path naming). These are
  // the STABLE names: the Drive folder of a section keeps its historical name
  // even when the displayed title changes (see driveNaming.projectSectionFolderAlias).
  const sectionLabelOf = (sec) => ({
    background: 'Background',
    discussion: 'Discussion',
    conclusions: 'Conclusions',
    funding: 'Funding',
    supporting: 'Supporting information'
  }[sec] || sec);

  // ---- Insert a slide from the Figures & Slides deck into a text section ----
  // The deck lives in localStorage per project (labFiguresDeck_<projectId>);
  // the chosen slide is rendered to a high-res PNG snapshot and stored in the
  // project's section figures, so it shows up in the section and in the export
  // document (the same way any figure does).
  const deckSlides = (project && readDeck(project.id).slides) || [];
  const insertSlideIntoSection = async (sec, slide, idx) => {
    if (!canModify) return;
    setSlideInserting(true);
    try {
      const url = await renderSlideToDataUrl(slide, 1800); // ~1800 px wide snapshot
      patchFigures(sec, [...sectionFigures(sec), {
        id: genProjectId(),
        url,
        caption: slide.title || `Slide ${idx + 1}`,
        isSlide: true,
        slideId: slide.id || '',
        addedAt: new Date().toISOString()
      }]);
      setSlidePickerFor(null);
      setMmFeedback('🖼 Slide inserted into the section');
    } catch {
      setMmFeedback('⚠️ Could not render the slide (an image cannot be read)');
    }
    setSlideInserting(false);
    setTimeout(() => setMmFeedback(''), 3000);
  };

  const addSectionDoc = (sec) =>
    patchDocs(sec, [...sectionDocs(sec), { id: genProjectId(), name: suggestDriveFileName({ project: project.name || '', section: sectionLabelOf(sec), suffix: 'doc' }), data: '' }]);
  const patchSectionDoc = (sec, docId, patch) =>
    patchDocs(sec, sectionDocs(sec).map((d) => (d.id === docId ? { ...d, ...patch } : d)));
  const removeSectionDoc = (sec, docId) =>
    patchDocs(sec, sectionDocs(sec).filter((d) => d.id !== docId));

  /* ── Où les documents d'une section vont-ils sur le Drive ? ───────────────
     La chaîne de dossiers est celle de l'envoi lui-même
     (driveNaming.projectSectionFolderPath → <projet>/<section>, à l'intérieur
     du dossier du dataset) : l'étiquette affichée et le dossier réellement créé
     ne peuvent donc pas diverger. */
  const sectionDrivePath = (label) => projectSectionFolderPath(project.name || '', label);
  const sectionDriveLabel = (label) =>
    projectSectionFolderLabel(project.name || '', label, getDriveRootName());

  /** Ouvre (en la créant au besoin) le dossier Drive d'une section. */
  const openSectionFolder = async (label) => {
    if (!getDriveToken()) {
      setDriveFlash((f) => ({ ...f, [label]: { text: '⚠ Connect Google Drive first (top bar), then the folder can be opened.', ok: false } }));
      return;
    }
    try {
      const { leafId } = await resolveDrivePathFromNames(sectionDrivePath(label));
      if (leafId) window.open(`https://drive.google.com/drive/folders/${leafId}`, '_blank', 'noopener,noreferrer');
      else setDriveFlash((f) => ({ ...f, [label]: { text: '⚠ The folder does not exist yet — upload a document and it will be created.', ok: false } }));
    } catch (err) {
      setDriveFlash((f) => ({ ...f, [label]: { text: `⚠ ${(err && err.message) || 'Could not reach Drive'}`, ok: false } }));
    }
  };

  /** Relit le dossier de la section et vérifie que le fichier envoyé y est
   *  vraiment : le compte rendu (et donc l'emplacement réel) est affiché sous la
   *  liste des documents. */
  const verifySectionUpload = async (label, fileName) => {
    const rel = sectionDrivePath(label).join('/');
    const set = (text, ok) => setDriveFlash((f) => ({ ...f, [label]: { text, ok } }));
    if (!getDriveToken()) {
      set('⚠ Not in Drive yet — connect Drive, then upload the document again (or use ☁ Save to Drive in Figures & Slides).', false);
      return;
    }
    set('⏳ Checking where the file landed…', true);
    try {
      const { leafId } = await resolveDrivePathFromNames(sectionDrivePath(label));
      const children = leafId ? await listDriveChildren(leafId) : [];
      const found = children.some((c) => String((c && c.name) || '') === String(fileName || ''));
      if (found) set(`✓ In Drive → ${rel}`, true);
      else set(`⚠ “${fileName}” was not found in ${rel} — check the Drive connection and upload again.`, false);
    } catch (err) {
      set(`⚠ ${(err && err.message) || 'Could not check the Drive folder'}`, false);
    }
  };

  const toggleIncludeGroup = (group) => {
    // One "Include" checkbox per experiment (group of condition instances):
    // toggling it applies to every instance of the same test name at once.
    const next = !group.entries.every((e) => e.includeInDocument);
    const ids = new Set(group.entries.map((e) => e.id));
    updateProject({ experiments: (project.experiments || []).map((e) =>
      (ids.has(e.id) ? { ...e, includeInDocument: next } : e)) });
  };

  // Group the project's experiment entries by test NAME so that a test with
  // several condition instances appears as ONE experiment in the list.
  const experimentsGrouped = (experiments, testsList) => {
    const groups = [];
    const byName = new Map();
    (experiments || []).forEach((exp) => {
      const t = exp.testId ? testsList.find((x) => x.id === exp.testId) : null;
      const name = t ? String(t.name || '').trim() : '';
      const key = name || `#${exp.id}`;
      if (!byName.has(key)) {
        byName.set(key, { name, entries: [] });
        groups.push(byName.get(key));
      }
      byName.get(key).entries.push(exp);
    });
    return groups;
  };

  const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const backToList = () => { setCurrentProjectId(null); setCurrentModule('projects'); };

  // ---- References: from "Project bibliography" + "Publications of the scientist" ----
  const projectBib = project.bibliography || [];
  const scientistPubs = pubs.filter((p) => {
    /* Le titulaire du projet peut n'être qu'un CO-AUTEUR du papier (article
       importé sous le nom d'un autre membre du laboratoire) : `coauthors` est
       recalculé ici quand il n'a pas encore été enregistré, exactement comme dans
       Publications — sinon la liste se limitait aux papiers dont il est le
       titulaire. */
    const coauthors = Array.isArray(p.coauthors)
      ? p.coauthors
      : matchCoauthors(p.authors || '', operatorNames || [], p.scientist);
    const authors = [p.scientist, ...coauthors].filter(Boolean);
    return !authors.length || authors.includes(project.scientist);
  });
  const refs = project.references || [];

  /* Chaque papier (bibliographie de projet / publication du titulaire) est
     complété par la publication d'origine : les entrées importées AVANT que les
     auteurs ne soient recopiés n'ont qu'un titre, et la citation ne montrait donc
     aucun co-auteur. `pubCitationData` retrouve la liste complète des auteurs
     (laboratoire ET extérieurs) par identifiant, DOI, identifiant PubMed ou
     titre — dans les publications importées COMME dans les « Relevant papers ». */
  const citeData = (entry) => pubCitationData(entry, citationPool);
  const pickerItems = (list) => list.map((item) => ({ ...item, ...citeData(item) }));

  const findOrAddRef = (paper, insertText) => {
    const existing = refs.find((r) => r.sourceId === paper.id && r.source === paper.source);
    const number = existing ? existing.number : refs.length + 1;
    if (!existing) {
      const data = citeData(paper);
      replaceProjects((prev) => prev.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          references: [...(p.references || []), {
            id: genProjectId(), number,
            sourceId: paper.id, source: paper.source,
            title: data.title || 'Untitled',
            link: paper.link || data.doi || '',
            doi: data.doi,
            authors: data.authors,
            journal: data.journal,
            year: data.year,
            volume: data.volume,
            pages: data.pages
          }],
          updatedAt: new Date().toISOString()
        };
      }));
    }
    if (insertText) insertText(`[${number}]`);
  };

  const removeRef = (refId) =>
    updateProject({ references: refs.filter((r) => r.id !== refId) });

  /* ---- Les citations du texte → des LIENS vers les références --------------
     Le « [12] » (ou « (12) », ou l'exposant « ¹² ») d'un manuscrit importé n'est
     qu'un nombre : on en fait un lien vers la référence 12 (ancre #ref-12 de la
     liste ci-dessous, rappelée en infobulle « Auteurs · Titre (année) »). Un
     numéro que le projet ne connaît pas reste intact — aucun lien mort — et la
     transformation est idempotente (voir utils/referenceLinks.js). `extraRefs` =
     les références qui viennent d'être importées et ne sont pas encore dans
     project.references. */
  const citationTitleFor = (extraRefs = []) => (number) => {
    const found = [...refs, ...(extraRefs || [])].find((r) => Number(r && r.number) === Number(number));
    if (!found) return '';
    return citationLabel(found.sourceId ? { ...found, ...citeData(found) } : found);
  };

  /* LA FORME DES RENVOIS DANS LE TEXTE suit le « Publication format »
     (`pubFormat.inTextStyle`) : le texte des sections garde l'écriture de
     l'auteur, et c'est ICI — à l'affichage, à l'impression et à l'export — que la
     forme choisie est appliquée (voir applyInTextStyle). */
  const citeStyle = (pubFormat && pubFormat.inTextStyle) || 'keep';
  const linkCitations = (html, extraRefs = []) => applyInTextStyle(
    linkCitationNumbers(html, citationOpts(extraRefs)),
    { ...citationOpts(extraRefs), style: citeStyle, refs: [...refs, ...(extraRefs || [])] }
  );
  const citationOpts = (extraRefs = []) => ({
    numbers: referenceNumbers([...refs, ...(extraRefs || [])]),
    hrefFor: (n) => `#${citationAnchorId(n)}`,
    titleFor: citationTitleFor(extraRefs)
  });

  /** « 🔗 Link citations to references » : les sections déjà écrites (importées
   *  avant ce bouton, ou tapées à la main avec des [12], des (12) ou des
   *  exposants ¹²) sont reprises d'un coup. */
  const linkCitationLinks = () => {
    const res = linkCitationsInSections(
      PROJECT_TEXT_SECTIONS.map((s) => ({ id: s.id, html: project[s.id] || '' })),
      refs
    );
    if (!res.updated) {
      setCitationLinkReport(refs.length
        ? 'Nothing to link: the text sections hold no numbered citation — [1], (1) or a superscript 1 — or the numbers they show are not references of this project (a citation is linked only when ALL its numbers exist here), or they are already links.'
        : 'No reference yet — add them (📄 Import references from a paper / 📥 Import a manuscript) before linking citations.');
      return;
    }
    updateProject(res.patch);
    setCitationLinkReport(`🔗 ${res.added} citation link(s) added in ${res.updated} section(s) — the exported document (and its printed PDF) follow them.`);
  };

  /* ── ✨ COMPLÉTER LES RÉFÉRENCES INCOMPLÈTES ────────────────────────────────
     « L'information incomplète de la référence (auteurs, titre manquants…) n'est
     pas reconstruite » : ce bouton reprend TOUTES les références du projet
     (bibliographie ET références numérotées du document), et remplit les champs
     vides depuis les publications du laboratoire / « Relevant papers », puis
     depuis Crossref (par DOI, sinon par titre exact). Une liste d'auteurs
     RÉDUITE — « Fumano, et al. » — compte comme un champ à chercher : c'est ce
     qui fait revenir les co-auteurs, le DOI et le volume d'un article dont la
     bibliographie n'avait gardé qu'un nom. Un champ déjà rempli (corrigé à la
     main) n'est jamais écrasé (voir utils/referenceEnrich.js), et la recherche
     en ligne est bornée : elle s'arrête d'elle-même hors ligne. */
  const completeProjectReferences = async () => {
    if (!canModify || refFixBusy) return;
    setRefFixBusy(true);
    setRefFixReport('⏳ Looking for the missing authors, titles, journals, DOIs and volumes…');
    try {
      /* `all: true` = chercher TOUS les champs qui manquent (DOI, volume,
         pages…) et pas seulement les auteurs ou le titre ; `max` haut = un
         projet peut avoir une cinquantaine de références, et l'utilisateur
         clique justement parce qu'il veut qu'elles soient complètes. La
         recherche s'arrête d'elle-même après deux échecs (hors ligne). */
      const bib = await enrichReferences(projectBib, { pool: citationPool, all: true, max: 60 });
      const numbered = await enrichReferences(refs, { pool: citationPool, all: true, max: 60 });
      const patch = {};
      if (bib.completed) patch.bibliography = bib.list;
      if (numbered.completed) patch.references = numbered.list;
      let saved = { ok: true };
      if (Object.keys(patch).length) saved = commitProjectVerified(patch, { lighten: true });
      const done = bib.completed + numbered.completed;
      /* Une liste d'auteurs RÉDUITE (« Fumano, et al. ») compte comme un champ
         manquant : on le dit, même quand la recherche n'a rien trouvé pour
         elle — l'utilisateur voit ainsi ce qui reste à écrire à la main. */
      const stillShortened = (bib.stillShortened || 0) + (numbered.stillShortened || 0);
      setRefFixReport((done
        ? `${enrichReport({ completed: done, filled: mergeFieldCounts(bib.filled, numbered.filled), sources: [...new Set([...bib.sources, ...numbered.sources])] })}`
          + ' — the project bibliography, the numbered references and the exported document show them now.'
          + (saved.ok ? '' : ` · ⚠ NOT SAVED: the browser refused to store this project (${saved.error}).`)
        : 'Every reference already has its authors, title, journal, year, volume, pages and DOI — nothing was missing.'
          + (bib.offline || numbered.offline ? ' (the online service could not be reached)' : ''))
        + (stillShortened
          ? ` · ⚠ ${stillShortened} reference(s) still show their authors as “et al.” — write the co-authors by hand in Publications → “Project bibliography”.`
          : ''));
    } catch (err) {
      setRefFixReport(`⚠ ${(err && err.message) || 'the references could not be completed'}`);
    }
    setRefFixBusy(false);
  };

  /* ---- Import de références depuis un document -------------------------
     « Import from a paper » : on dépose le document (.docx de Word, export
     Paperpile, texte copié, fichier RIS/BibTeX) et l'analyse propose les
     références trouvées. Elles sont ensuite fusionnées dans la bibliographie
     du projet : rien n'est dupliqué (DOI → PMID → titre) et aucun papier déjà
     présent n'est écrasé (voir mergeReferenceEntries). */

  /* Note : calculé à la demande (et non via useMemo) car cette page a déjà
     rendu son JSX plus haut quand aucun projet n'est ouvert — un Hook
     supplémentaire changerait le nombre de Hooks d'un rendu à l'autre. */
  const bibExistingKeys = () => {
    const set = new Set();
    (projectBib || []).forEach((b) => entryKeys(b).forEach((k) => set.add(k)));
    return set;
  };

  const openBibImport = () => setBibImport({ text: '', fileName: '', parsed: [], picked: [], onePerLine: false, busy: false, status: '' });

  const analyseBibImport = (draft) => {
    const src = draft || bibImport;
    if (!src) return null;
    const text = String(src.text || '').trim();
    if (!text) return null;
    const parsed = parseReferences(text, { split: src.onePerLine ? 'line' : 'auto' });
    /* Pré-coché : tout ce qui n'est pas déjà dans la bibliographie du projet. */
    const existing = bibExistingKeys();
    const picked = [];
    parsed.forEach((entry, i) => {
      const present = entryKeys(entry).some((k) => existing.has(k));
      if (!present) picked.push(i);
    });
    const next = { ...src, parsed, picked, status: parsed.length ? '' : 'No reference recognised — check the text or the file.' };
    setBibImport(next);
    return next;
  };

  const loadBibImportFile = async (file) => {
    if (!file) return;
    setBibImport((d) => ({ ...(d || {}), busy: true, status: `Reading ${file.name}…` }));
    try {
      const text = await readReferenceDocument(file);
      const draft = { ...(bibImport || {}), text, fileName: file.name, busy: false, status: '', parsed: [], picked: [] };
      setBibImport(draft);
      analyseBibImport(draft);
    } catch (err) {
      setBibImport((d) => ({ ...(d || {}), busy: false, status: `⚠ ${(err && err.message) || 'Could not read this file'}` }));
    }
  };

  const commitBibImport = async () => {
    if (!bibImport || bibImport.busy) return;
    /* Les entrées COCHÉES, dans l'ORDRE du document : c'est cet ordre qui porte
       la numérotation (voir numberImportedReferences). */
    const pickedEntries = (bibImport.picked || [])
      .slice()
      .sort((a, b) => a - b)
      .map((i) => bibImport.parsed[i])
      .filter(Boolean);
    if (!pickedEntries.length) return;
    /* ✨ LES RÉFÉRENCES INCOMPLÈTES SE COMPLÈTENT À L'IMPORT : une bibliographie
       de fin d'article donne souvent des entrées sans auteurs ni titre, ou une
       liste d'auteurs coupée par un « et al. » ; elles sont complétées depuis
       les publications du laboratoire puis depuis Crossref (par DOI, sinon par
       titre) AVANT d'être rangées et numérotées — la référence entre donc
       complète dans le projet, dans la bibliographie comme dans le document
       (voir utils/referenceEnrich.js). `all: true` : ce sont TOUS les champs
       qui manquent qui sont cherchés (co-auteurs d'un « et al. », DOI, volume,
       pages, revue, année), pas seulement les auteurs et le titre. Un champ
       déjà rempli par le document n'est jamais écrasé. */
    setBibImport((d) => ({ ...(d || {}), busy: true, status: '✨ Completing the references (authors, titles, journals, DOIs…)' }));
    const completed = await enrichReferences(pickedEntries, { pool: citationPool, all: true, max: 60 });
    const filledReport = enrichReport(completed);
    const chosen = completed.list.map((entry) => projectBibEntry(entry, project, genProjectId()));
    const res = mergeReferenceEntries(projectBib, chosen);
    /* LES RÉFÉRENCES NUMÉROTÉES DU PROJET, pas seulement la bibliographie :
       `project.references` est la liste que le TEXTE cite (« [12] »), que la
       section « 📚 References » et le document exporté IMPRIMENT. Sans cette
       étape, un papier importé de Paperpile n'apparaissait dans AUCUN document et
       les « [12] » du texte ne menaient nulle part — c'était la plainte : les
       références importées n'étaient ni liées, ni exportées. Le numéro écrit
       devant l'entrée (« 12. Rossi… ») est conservé : le lien tombe juste. */
    const numbered = numberImportedReferences(completed.list, refs);
    /* Et les citations DÉJÀ écrites dans les sections deviennent des liens vers
       ces références (ancre #ref-n + infobulle) : l'import fait donc les deux
       d'un coup, sans avoir à retrouver le bouton « 🔗 Link citations… ». */
    const linked = linkCitationsInSections(
      PROJECT_TEXT_SECTIONS.map((s) => ({ id: s.id, html: project[s.id] || '' })),
      numbered.list
    );
    /* Écriture VÉRIFIÉE, comme l'import de manuscrit : un magasin plein ne doit
       pas faire disparaître des références en silence (voir
       commitProjectVerified). */
    const saved = commitProjectVerified({
      bibliography: res.list,
      ...(numbered.added ? { references: numbered.list } : {}),
      ...linked.patch
    }, { lighten: true });
    if (linked.updated) {
      setCitationLinkReport(`🔗 ${linked.added} citation link(s) added in ${linked.updated} section(s) — the exported document (and its printed PDF) follow them.`);
    }
    setBibImport((d) => ({
      ...(d || bibImport), parsed: [], picked: [], busy: false,
      status: `✅ ${res.added} reference(s) added to “${project.name}”${res.filled ? ` — ${res.filled} completed` : ''}`
        + (filledReport ? ` · ${filledReport}` : '')
        + (completed.stillShortened
          ? ` · ⚠ ${completed.stillShortened} reference(s) still show “et al.”: write the co-authors in Publications → “Project bibliography”.`
          : '')
        + `${numbered.added ? ` · ${numbered.added} numbered reference(s) in the project document (References)` : ''}`
        + `${linked.updated ? ` · 🔗 ${linked.added} citation(s) linked in ${linked.updated} section(s)` : ''}`
        + (saved.ok
          ? '. They also appear in Publications → “Project bibliography”.'
          : ` · ⚠ NOT SAVED: the browser refused to store this project (${saved.error}) — free some space and import again.`)
    }));
  };

  // ---- Experiments: create classic tests and link them to the project ----
  const addExperiment = (type) => {
    const id = 't' + Date.now() + Math.floor(Math.random() * 1e4);
    const created = createEmptyTest(id, tests.length + 1, type);
    created.projectNames = [...new Set([...(created.projectNames || []), project.name])];
    setTests((prev) => [...prev, created]);
    replaceProjects(projectsRef.current.map((p) => {
      if (p.id !== project.id) return p;
      return {
        ...p,
        experiments: [...(p.experiments || []), {
          id: genProjectId(), testId: created.id, type, label: testTypeLabel(type),
          includeInDocument: false, addedAt: new Date().toISOString()
        }],
        updatedAt: new Date().toISOString()
      };
    }));
    saveProjects(projectsRef.current);
    // Navigate through openTest so "◀ Back" returns to this project page.
    openTest(created.id);
  };

  const linkExistingTest = () => {
    const testName = String(linkTestId || '').trim();
    if (!testName) return;
    // Group = every instance (test object) sharing this name.
    const group = tests.filter((t) => String(t.name || '').trim() === testName);
    if (group.length === 0) return;
    const linkedIds = new Set((project.experiments || []).map((e) => e.testId));
    // Link ALL instances of the test in one go.
    setTests((prev) => prev.map((t) =>
      group.some((g) => g.id === t.id)
        ? { ...t, projectNames: [...new Set([...(t.projectNames || []), project.name])] }
        : t
    ));
    // The test's WHOLE Drive folder (all its instances) is moved into the
    // project — never copied, so no duplicate folder remains on Drive.
    moveTestFolderIntoProject({ testName, projectName: project.name }).catch(() => {});
    const added = group
      .filter((g) => !linkedIds.has(g.id))
      .map((g) => ({
        id: genProjectId(), testId: g.id, type: g.type || 'plate-96',
        label: testTypeLabel(g.type) || 'Test',
        includeInDocument: false, addedAt: new Date().toISOString()
      }));
    if (added.length > 0) {
      updateProject({ experiments: [...(project.experiments || []), ...added] });
    }
    setLinkTestId('');
  };

  const removeExperiment = (expId) => {
    const exp = (project.experiments || []).find((e) => e.id === expId);
    const test = exp && exp.testId ? tests.find((t) => t.id === exp.testId) : null;
    if (!test) { // entry with no resolvable test — just drop the entry
      updateProject({ experiments: (project.experiments || []).filter((e) => e.id !== expId) });
      return;
    }
    const testName = String(test.name || '').trim();
    // Experiments are grouped by test NAME: removing one removes every instance
    // of that name in one go, keeping the app and the Drive tree coherent.
    const remaining = (project.experiments || []).filter((e) => {
      if (e.id === expId) return false;
      const t = e.testId ? tests.find((x) => x.id === e.testId) : null;
      return !(t && testName && String(t.name || '').trim() === testName);
    });
    updateProject({ experiments: remaining });
    setTests((prev) => prev.map((t) =>
      testName && String(t.name || '').trim() === testName
        ? { ...t, projectNames: (t.projectNames || []).filter((pn) => pn !== project.name) }
        : t
    ));
    // Move the Drive folder back out ONLY when no instance of this test remains
    // linked to the project (otherwise the folder would leave the project while
    // other instances of the same test are still used here).
    const stillLinked = remaining.some((e) => {
      const t = e.testId ? tests.find((x) => x.id === e.testId) : null;
      return t && testName && String(t.name || '').trim() === testName;
    });
    if (!stillLinked) {
      moveTestFolderOutOfProject({ testName, projectName: project.name }).catch(() => {});
    }
  };

  const openTest = (testId) => { if (jumpToTest) jumpToTest(testId); else { setActiveTestId(testId); setCurrentModule('active-test'); } };


  /* ---- Import de références depuis un document (Paperpile, Word, RIS…) ----
     Le fichier est lu DANS LE NAVIGATEUR (aucun envoi) : .docx (ZIP → texte),
     texte copié, export RIS/BibTeX, page HTML. L'aperçu montre ce qui a été
     reconnu, ce qui est déjà dans la bibliographie, et laisse décocher. */
  /* ---- 📥 Importer un MANUSCRIT (Google Docs / Word + Paperpile) ----------
     Le document garde TOUT son texte : il est découpé par ses titres et chaque
     partie rejoint la section correspondante de cette page (Background /
     Results and Discussion / Conclusions), la bibliographie du document rejoint la
     « Project bibliography » (donc Publications → « Project bibliography »), et
     les citations du texte deviennent les références NUMÉROTÉES du programme
     ([1], [2]…) comme le fait « 📚 + Reference ». Toute la logique est pure et
     testée : voir utils/manuscriptImport.js. Rien n'est envoyé au Drive par
     cet import — il ne fait que remplir le projet. */
  /* `focusSection` : quand on ouvre l'import DEPUIS la barre d'outils d'une
     section (Background / Results and Discussion / Conclusions), les parties du manuscrit
     dont le titre ne correspond à rien retombent dans CETTE section — l'endroit
     d'où l'utilisateur a cliqué. Ouvert depuis l'en-tête de la page, il reste
     vide : l'utilisateur choisit alors chaque destination. */
  const openManuscriptImport = (focusSection = '') => {
    msBusyRef.current = false;
    setMsResult(null);
    setMsImport({
      text: '', fileName: '', parts: null, plan: null, picks: [], busy: false, status: '', report: '',
      header: null, headerPicks: null, figures: [], hash: '', previous: null, confirmRepeat: false,
      htmlByText: null,
      /* 🖼 « Figures only » : rattraper les FIGURES d'un document DÉJÀ importé
         (l'import les avait perdues, ou l'utilisateur les a retirées) sans
         recoller une deuxième fois le texte. Décidé par l'utilisateur dans la
         fenêtre, jamais par le programme (voir applyManuscriptImport). */
      figuresOnly: false,
      focusSection: typeof focusSection === 'string' ? focusSection : ''
    });
  };

  const analyseManuscript = (text, fileName, figures = null, focusSection = (msImport && msImport.focusSection) || '', htmlByText = null) => {
    const src = String(text || '');
    if (!src.trim()) {
      setMsImport((d) => ({ ...(d || {}), busy: false, status: 'Paste the document text (or choose a file) first.' }));
      return;
    }
    /* LA MISE EN FORME DU DOCUMENT (un .docx : gras, italique, exposants,
       indices) : elle suit les paragraphes — voir htmlFromManuscriptPart — pour
       que le texte importé garde celle de l'article au lieu de la perdre. */
    const html = htmlByText && typeof htmlByText.get === 'function'
      ? htmlByText : ((msImport && msImport.htmlByText) || null);
    /* Les FIGURES lues dans le document (voir readManuscriptDocument) : la
       liste reste telle quelle tant que le même document est analysé. Les
       pixels sont mis en `data:` URL UNE fois (l'aperçu et l'envoi au Drive
       s'en servent ensuite sans les recalculer). */
    const figs = (Array.isArray(figures) ? figures : ((msImport && msImport.figures) || []))
      .map((f) => (f && f.preview === undefined ? { ...f, preview: figureDataUrl(f) } : f));
    const blocks = blocksFromText(src, { htmlByText: html });
    const manuscript = splitManuscript(blocks);
    /* L'EN-TÊTE (titre / auteurs / affiliations) est reconnu AVANT le découpage :
       ces lignes ne sont donc pas proposées comme sections — elles vont dans les
       champs « 🧾 Title, authors & affiliations » du projet. */
    const header = parseManuscriptHeader(manuscript.body);
    /* LES SECTIONS DU PROJET : la position des parties dans l'article tranche —
       entre l'Introduction et les Conclusions tout va dans « Results and
       discussion », sauf le Matériel et méthodes (voir withDocumentSections). */
    const parts = withDocumentSections(groupManuscriptParts(manuscript.body, { header })).map((p, i) => ({
      key: `part${i}`, heading: p.heading, text: p.text, guessed: p.id || '', autoSection: p.autoSection || '',
      dest: p.id || focusSection || '', mode: 'append'
    }));
    const plan = buildManuscriptPlan(manuscript, { existingReferences: refs });
    /* TOUTES les références trouvées dans le manuscrit sont retenues D'OFFICE :
       l'import les range dans la « Project bibliography » ET tourne les
       citations du texte en références numérotées liées, sans demander à
       l'utilisateur de les cocher puis de réclamer la liaison (deux étapes
       qu'il devait faire lui-même, et une référence oubliée = une citation
       restée en clair dans le texte). Les cases servent donc à EN RETIRER une,
       jamais à l'ajouter. */
    const existing = bibExistingKeys();
    const picks = plan.entries.map((_, i) => i);
    const alreadyThere = plan.entries
      .filter((e) => entryKeys(e.entry).some((k) => existing.has(k))).length;
    const headerMissing = ['title', 'authors', 'affiliations'].filter((f) => !String(header[f] || '').trim());
    const headerFound = 3 - headerMissing.length;
    /* LE MÊME DOCUMENT DÉJÀ IMPORTÉ ? L'empreinte du texte est rangée dans le
       projet par chaque import réussi : un second import est signalé AVANT
       d'écrire, au lieu de doubler silencieusement tout le texte. */
    const hash = manuscriptFingerprint(src);
    const previous = previousImportOf(project, hash);
    /* Un champ DÉJÀ rempli dans le projet n'est pas coché d'office : un import
       ne doit jamais écraser un titre saisi à la main (même règle que la fusion
       des références, qui ne remplit que les champs vides). */
    const defaultHeaderPicks = {
      title: !String(project.paperTitle || '').trim(),
      authors: !String(project.paperAuthors || '').trim(),
      affiliations: !String(project.paperAffiliations || '').trim()
    };
    setMsImport((d) => ({
      ...(d || {}), text: src, fileName: fileName || '', parts, plan, picks, busy: false, report: '',
      focusSection, header, body: manuscript.body, lines: header.lines || [], figures: figs,
      htmlByText: html,
      headerPicks: (d && d.headerPicks) || defaultHeaderPicks,
      hash, previous, confirmRepeat: false,
      status: `${blocks.length} block(s) · ${parts.length} part(s) · ${plan.entries.length} reference(s)`
        + (alreadyThere ? ` (${alreadyThere} already in the project)` : '')
        + ` · ${plan.citations.length} citation(s)`
        + (figs.length ? ` · ${figs.length} figure(s)` : '')
        + (headerFound ? ` · header: ${headerFound}/3` : '')
        + (headerMissing.length
          ? ` · ⚠ no ${headerMissing.join(' / no ')} recognised — the lines of the document head are listed below, set the right one by hand`
          : '')
        + (previous ? ' · ⚠ already imported once' : '')
    }));
  };

  const loadManuscriptFile = async (file) => {
    if (!file) return;
    setMsImport((d) => ({ ...(d || {}), busy: true, status: `Reading ${file.name}…` }));
    try {
      /* Le document ENTIER : son texte (marqueurs de figure compris), ses
         figures, ET la mise en forme de ses paragraphes (un .docx : gras,
         italique, exposants, indices) — pour qu'une image de l'article, ou sa
         typographie, ne soit plus perdue. */
      const doc = await readManuscriptDocument(file);
      analyseManuscript(doc.text, file.name, doc.figures, undefined, doc.htmlByText);
    } catch (err) {
      setMsImport((d) => ({ ...(d || {}), busy: false, status: `⚠ ${(err && err.message) || 'Could not read this document'}` }));
    }
  };

  /* ── Les FIGURES d'un manuscrit importé ────────────────────────────────────
     Elles ne sont PAS écrites dans le texte de la section (elles y resteraient
     figées et partiraient dans tous les exports) : elles deviennent les figures
     de LEUR section — `project.figures[section]`, la liste que remplit aussi
     « 📤 Insert into project… » de l'Image Builder — et l'ANCRE gardée sur
     chacune (le paragraphe qui la précédait) les remet à leur place dans le
     document exporté (utils/figurePlacement.js).
     Les pixels partent au Drive comme le fait « 📄 Word text » ; sans Drive
     connecté elles restent dans le navigateur, en copie compacte
     (makeUploadImage) et l'entrée de la bibliothèque du projet pourra être
     envoyée plus tard par « ☁ Save figures to Drive ». */
  const figureLabel = (fig, index) => {
    const caption = String((fig && fig.caption) || '').trim();
    if (caption) return caption.slice(0, 70);
    return String((fig && fig.name) || '').trim() || `Figure ${index}`;
  };

  const figureImageFor = async (fig, label, identity = '') => {
    const dataUrl = fig && fig.preview !== undefined ? fig.preview : figureDataUrl(fig);
    if (!dataUrl) return null;
    /* Une figure d'une page HTML garde son URL (Google, Drive, …) : rien n'est
       retéléchargé ni recopié. */
    if (!dataUrl.startsWith('data:')) {
      return { url: getRenderableDriveUrl(dataUrl), full: dataUrl, drive: false, driveUrl: '' };
    }
    const uploaded = await uploadFigureToDrive({
      full: dataUrl, label, projectName: project.name || '', identity
    });
    const link = (uploaded && (uploaded.driveUrl || uploaded.url || uploaded.webLink)) || '';
    if (link) return { url: getRenderableDriveUrl(link), full: link, drive: true, driveUrl: link };
    try {
      const compact = await makeUploadImage(dataUrl);
      if (compact && compact.url) return { url: compact.url, full: compact.full || compact.url, drive: false, driveUrl: '' };
    } catch { /* garde la data URL d'origine */ }
    return { url: dataUrl, full: dataUrl, drive: false, driveUrl: '' };
  };

  /** Attache les figures du document à leur section, avec leur ancre.
   *  @returns {{ figures:object, added:number, onDrive:number, local:number,
   *              already:number }} `already` = figures du même document déjà
   *           présentes dans la section (un second import ne les duplique pas). */
  const attachManuscriptFigures = async (list, placements) => {
    const out = { ...(project.figures || {}) };
    let added = 0;
    let onDrive = 0;
    let local = 0;
    let already = 0;
    const failed = [];
    for (const place of (Array.isArray(placements) ? placements : [])) {
      const fig = (Array.isArray(list) ? list : []).find((f) => f && f.index === place.index);
      if (!fig) continue;
      const label = figureLabel(fig, place.index);
      /* Le MÊME document importé deux fois (l'utilisateur recommence, ou
         complète une section déjà remplie) ne duplique pas ses figures : une
         figure déjà arrivée par un import dans CETTE section est reconnue à son
         nom de fichier dans le document. */
      const name = String(fig.name || '').trim();
      const current = out[place.section] || [];
      if (name && current.some((f) => f && f.source === 'manuscript-import' && String(f.name || '') === name)) {
        already += 1;
        continue;
      }
      /* UNE FIGURE QUI ÉCHOUE N'EMPORTE PAS LES AUTRES : l'envoi au Drive est la
         seule étape qui dépend du réseau, et une exception ici faisait auparavant
         perdre TOUTES les figures de l'import. */
      let image = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        image = await figureImageFor(fig, label, `${place.section || ''}|${name || label}`);
      } catch {
        failed.push(name || label);
        continue;
      }
      if (!image) { failed.push(name || label); continue; }
      const entry = {
        id: genProjectId(),
        url: image.url,
        caption: String(fig.caption || '').trim(),
        addedAt: new Date().toISOString(),
        source: 'manuscript-import',
        name,
        anchor: place.anchor || ''
      };
      if (image.full && image.full !== image.url) entry.full = image.full;
      if (image.drive) { entry.drive = true; entry.driveUrl = image.driveUrl; }
      out[place.section] = [...current, entry];
      /* Aussi dans la bibliothèque d'images du projet : l'Image Builder y prend
         les figures du projet (Project Library) pour ses compositions. */
      try {
        addProjectLibraryItem(project.id, {
          url: image.url, full: image.full || image.url, label,
          drive: !!image.drive, driveUrl: image.driveUrl || null
        });
      } catch { /* la bibliothèque est un cache : la figure est déjà dans la section */ }
      added += 1;
      if (image.drive) onDrive += 1;
      else local += 1;
    }
    return { figures: out, added, onDrive, local, already, failed };
  };

  const patchManuscriptPart = (key, patch) =>
    setMsImport((d) => (d ? { ...d, parts: d.parts.map((p) => (p.key === key ? { ...p, ...patch } : p)) } : d));

  /* L'en-tête du document (titre / auteurs / affiliations) — modifiable avant
     l'import : le texte est celui du document, l'utilisateur peut le corriger. */
  const patchManuscriptHeader = (field, value) =>
    setMsImport((d) => (d && d.header ? { ...d, header: { ...d.header, [field]: value } } : d));
  const toggleManuscriptHeaderPick = (field) =>
    setMsImport((d) => (d ? { ...d, headerPicks: { ...(d.headerPicks || {}), [field]: !(d.headerPicks || {})[field] } } : d));

  /* LA CORRECTION À LA MAIN des lignes d'en-tête : quand le document est écrit
     autrement que prévu, l'utilisateur désigne lui-même le titre, les auteurs et
     les affiliations (voir HEADER_ROLES). Les champs et la zone retirée du texte
     sont recalculés ; les destinations déjà choisies partie par partie sont
     conservées (même intitulé = même choix). */
  const patchManuscriptHeaderRole = (at, role) =>
    setMsImport((d) => {
      if (!d || !d.lines) return d;
      const lines = d.lines.map((l) => (l.at === at ? { ...l, role } : l));
      const header = headerFromLineRoles(d.body || [], lines);
      /* Les choix déjà faits sont repris partie par partie : d'abord à la MÊME
         position (le découpage suit l'ordre du document), sinon par intitulé —
         deux parties peuvent porter le même intitulé (celles sans titre). */
      const previous = d.parts || [];
      const byHeading = new Map(previous.map((p) => [p.heading, p]));
      const parts = withDocumentSections(groupManuscriptParts(d.body || [], { header })).map((p, i) => {
        const old = (previous[i] && previous[i].heading === p.heading ? previous[i] : null)
          || byHeading.get(p.heading) || {};
        return {
          key: `part${i}`,
          heading: p.heading,
          text: p.text,
          guessed: p.id || '',
          autoSection: p.autoSection || '',
          dest: old.dest !== undefined ? old.dest : (p.id || d.focusSection || ''),
          mode: old.mode || 'append'
        };
      });
      const empty = (field) => !String(project[field] || '').trim();
      const picks = (d.headerPicks || {});
      const headerPicks = {
        title: !!header.title && (empty('paperTitle') || !!picks.title),
        authors: !!header.authors && (empty('paperAuthors') || !!picks.authors),
        affiliations: !!header.affiliations && (empty('paperAffiliations') || !!picks.affiliations)
      };
      return { ...d, lines, header, parts, headerPicks };
    });

  const toggleManuscriptPick = (i) =>
    setMsImport((d) => {
      if (!d) return d;
      const list = d.picks || [];
      return { ...d, picks: list.indexOf(i) === -1 ? [...list, i].sort((a, b) => a - b) : list.filter((x) => x !== i) };
    });

  /** Applique le plan : sections + figures + bibliographie + références.
   *
   *  ⚠ CE QU'UN IMPORT DOIT FAIRE, ET QUE CE CODE NE FAISAIT PAS :
   *   1. ÉCRIRE POUR DE VRAI. L'écriture du magasin échouait en silence quand
   *      le quota du navigateur était plein : la page annonçait « ✓ 3 section(s)
   *      filled · 12 numbered reference(s) » alors que RIEN n'avait été écrit —
   *      le texte, les références et la bibliographie disparaissaient à la
   *      réouverture du projet. L'import écrit maintenant, RELIT, et ne se
   *      déclare réussi que si le magasin a gardé ce qui a été écrit.
   *   2. FERMER LA FENÊTRE. Elle restait ouverte, le bouton restait actif : un
   *      second clic collait le manuscrit une deuxième fois dans les sections.
   *      Le compte rendu s'affiche désormais EN HAUT de la page, avec le projet
   *      d'avant (`↩︎ Undo import`).
   *   3. NUMÉROTER TOUTE LA BIBLIOGRAPHIE. Les références ne venaient que des
   *      entrées cochées ET citées : les entrées non citées n'entraient pas dans
   *      project.references (donc n'étaient imprimées nulle part) et, quand rien
   *      n'était coché — toutes les entrées étant déjà dans la bibliographie du
   *      projet, ce qui arrive au deuxième import — aucune référence n'était
   *      créée et plus aucune citation n'était liée. */
  const applyManuscriptImport = async () => {
    const d = msImport;
    if (!d || !d.plan) return;
    if (msBusyRef.current) return;   // deux clics = un seul import
    /* Le doublon doit être confirmé — sauf en « figures seules », qui n'écrit
       aucun texte : là, le document déjà importé est exactement ce qu'on veut
       (on vient rechercher ses figures). */
    if (d.previous && !d.confirmRepeat && !d.figuresOnly) return;
    msBusyRef.current = true;
    setMsImport((cur) => ({ ...(cur || {}), busy: true, status: 'Applying…' }));
    const before = { ...project };   // filet de sécurité « ↩︎ Undo import »
    const numbers = d.plan.numberByKey;
    /* 🖼 FIGURES SEULES : rattraper les FIGURES d'un document DÉJÀ importé — le
       cas « avant, l'import importait les figures, maintenant elles sont
       perdues » — sans recoller son texte une deuxième fois. Le texte, les
       références et la bibliographie du projet ne sont pas touchés ; les ancres
       viennent du texte CONVERTI aux numéros du projet (comme dans l'import
       complet), donc la figure retrouve sa place dans le document exporté. */
    if (d.figuresOnly) {
      const anchoredText = {};
      (d.parts || []).forEach((p) => {
        if (!p.dest) return;
        anchoredText[p.key] = convertCitationsInText(p.text, numbers).text;
      });
      const place = manuscriptFigurePlacements(
        (d.parts || []).map((p) => (anchoredText[p.key] !== undefined ? { ...p, text: anchoredText[p.key] } : p)),
        d.figures,
        { focusSection: d.focusSection }
      );
      let added = 0;
      let failed = [];
      let failedAll = '';
      try {
        const res = await attachManuscriptFigures(d.figures, place.placements);
        added = res.added;
        failed = res.failed || [];
        if (added) commitProjectVerified({ figures: res.figures }, { lighten: true });
      } catch (err) {
        failedAll = String((err && err.message) || 'the figures could not be attached');
      }
      msBusyRef.current = false;
      setMsImport(null);
      setMsResult({
        ok: !failedAll,
        undoProject: before,
        lines: [
          added
            ? `${added} figure(s) attached to ${place.sections.join(', ')} — the text, the references and the`
              + ' bibliography of this project were NOT touched.'
            : 'No new figure: they are already in the sections of this project (nothing is ever duplicated).',
          ...(place.rerouted || place.orphans
            ? [`📎 ${place.rerouted + place.orphans} figure(s) had no section of their own: they were attached to `
              + `${place.sections.filter((s) => s).join(', ')} — move them if you want.`]
            : []),
          ...(failed.length ? [`⚠ ${failed.length} figure(s) could not be kept (${failed.join(', ')}).`] : []),
          ...(failedAll ? [`⚠ ${failedAll}`] : [])
        ]
      });
      return;
    }
    const patch = {};
    /* 1. Les citations du document → les numéros du PROJET ([12] du manuscrit →
       [5] du projet) — la table du plan ne convertit que ce qu'elle sait
       résoudre : une citation non résolue reste telle quelle. Au passage, les
       MARQUEURS de figure sortent du texte : la figure rejoint la section de la
       partie qui la portait, avec l'ANCRE du paragraphe qui la précédait (elle
       sera réinsérée là dans le document exporté). */
    const convertedParts = [];
    const citedInText = new Set();   // numéros cités (ceux du DOCUMENT)
    const notConverted = [];         // citations laissées telles quelles
    /* Le TEXTE CONVERTI de chaque partie (citations aux numéros du projet) : les
       ANCRES des figures en viennent, sinon l'ancre « …[12] » du document ne se
       retrouve pas dans la section (qui montre « [1] ») et la figure perdrait sa
       place dans le document exporté. */
    const convertedTextByKey = {};
    /* Les parties REDIRIGÉES vers un champ d'en-tête (« 🧾 Authors », « 🧾
       Affiliations », « 🧾 Title », voir HEADER_DESTS) : leur texte ne va pas
       dans une section mais dans « 🧾 Title, authors & affiliations », mis en
       forme par headerTextFor (un auteur par ligne → une liste, etc.). */
    const headerTexts = [];
    /* Les parties de MATÉRIEL ET MÉTHODES : leur texte va dans le champ
       « 📋 Materials and Methods » du projet (celui que « ✏️ Edit text » du
       projet et le document exporté impriment) — jamais dans « Results and
       discussion » (voir METHODS_DEST / withDocumentSections). */
    const mmTexts = [];
    d.parts.forEach((p) => {
      if (!p.dest) return;
      const converted = convertCitationsInText(p.text, numbers);
      convertedTextByKey[p.key] = converted.text;
      citedNumbersInText(converted.text).forEach((n) => citedInText.add(n));
      converted.unresolved.forEach((raw) => notConverted.push(raw));
      if (isHeaderDest(p.dest)) {
        headerTexts.push({ field: p.dest, text: stripFigureMarks(converted.text), mode: p.mode });
        return;
      }
      if (p.dest === METHODS_DEST.id) {
        mmTexts.push(stripFigureMarks(converted.text));
        return;
      }
      convertedParts.push({
        dest: p.dest,
        mode: p.mode,
        text: stripFigureMarks(converted.text),
        /* LE TEXTE MIS EN FORME : les paragraphes gardent la typographie du
           document (gras, italique, exposants, indices) et citations converties
           — voir htmlFromManuscriptPart. */
        html: htmlFromManuscriptPart(p.text, { htmlByText: d.htmlByText, numbers })
      });
    });
    /* OÙ VA CHAQUE FIGURE DU DOCUMENT (voir manuscriptFigurePlacements) : la
       place est calculée sur le document ENTIER, pas seulement sur les parties
       dirigées vers une section. Une figure du chapeau (partie sans destination)
       ou d'une ligne de l'en-tête était auparavant perdue en silence — c'est la
       plainte « avant, l'import importait les figures, maintenant elles sont
       perdues ». */
    const figPlan = manuscriptFigurePlacements(
      d.parts.map((p) => (convertedTextByKey[p.key] !== undefined ? { ...p, text: convertedTextByKey[p.key] } : p)),
      d.figures,
      { focusSection: d.focusSection }
    );
    const figurePlacements = figPlan.placements;
    /* LES RÉFÉRENCES NUMÉROTÉES DU PROJET : une par entrée RETENUE de la
       bibliographie du document — cochée par l'utilisateur, déjà numérotée dans
       le projet (elle garde son numéro), ou déjà rangée dans la bibliographie du
       projet (le cas d'un second import : plus rien n'est coché, et c'est
       précisément là qu'aucune référence n'était créée et que les « [12] » du
       texte ne se liaient plus à rien). */
    const picks = d.picks || [];
    const inProjectBib = bibExistingKeys();
    const kept = d.plan.entries.filter((e, i) => (
      picks.indexOf(i) !== -1 || !!e.existing
      || entryKeys(e.entry).some((k) => inProjectBib.has(k))
    ));
    const keptEntries = kept.map((e) => e.entry);
    const pickedEntries = d.plan.entries
      .filter((e, i) => picks.indexOf(i) !== -1)
      .map((e) => e.entry);
    /* ✨ UNE RÉFÉRENCE INCOMPLÈTE SE COMPLÈTE AVANT D'ENTRER DANS LE PROJET.
       Les bibliographies de fin d'article donnent souvent une entrée sans
       auteurs ou sans titre, ou une liste d'auteurs coupée par un « et al. » (un
       seul nom pour un article qui en a six) : elle est complétée depuis les
       publications du laboratoire puis depuis Crossref (par DOI, sinon par
       titre) AVANT d'être numérotée, donc la référence ET le document montrent
       tout de suite les vraies informations. `all: true` : ce sont TOUS les
       champs qui manquent qui sont cherchés — les co-auteurs d'une liste
       réduite, le DOI, le volume, les pages —, pas seulement les auteurs et le
       titre ; `max` couvre une bibliographie entière. Aucun champ écrit par le
       document n'est écrasé, sauf une liste d'auteurs RÉDUITE, remplacée par la
       liste complète du même papier (voir utils/referenceEnrich.js). */
    const toComplete = [...new Set([...keptEntries, ...pickedEntries])];
    const completion = await enrichReferences(toComplete, { pool: citationPool, all: true, max: 60 });
    const enrichedLine = enrichReport(completion);
    const completedOf = (entry) => {
      const at = toComplete.indexOf(entry);
      return at === -1 ? entry : completion.list[at];
    };
    const numbered = numberImportedReferences(keptEntries.map(completedOf), refs, {
      hints: kept.map((e) => e.number), makeId: genProjectId
    });
    const references = numbered.list;
    const numberSet = referenceNumbers(references);
    const merged = mergeManuscriptBibliography(projectBib, pickedEntries.map(completedOf), { project });
    /* Les numéros cités dans le texte qui n'ont AUCUNE référence : ils restent
       tels quels (aucun lien mort, rien d'inventé) et l'utilisateur le lit dans
       le compte rendu — c'est presque toujours une entrée absente de la
       bibliographie du document. */
    const unlinkedNumbers = [...citedInText].filter((n) => !numberSet.has(n)).sort((a, b) => a - b);
    /* 1 bis. Les FIGURES du document → les figures de LEUR section. C'est la
       seule étape lente (envoi au Drive, repli en copie locale) — et la seule qui
       dépend du réseau : une figure qui échoue ne doit JAMAIS emporter le texte
       et les références (l'import continue, le compte rendu le dit). */
    let figRes = { figures: project.figures || {}, added: 0, onDrive: 0, local: 0, already: 0, failed: [] };
    let figureError = '';
    try {
      figRes = await attachManuscriptFigures(d.figures, figurePlacements);
    } catch (err) {
      figureError = String((err && err.message) || 'the figures could not be attached');
    }
    const hp = d.headerPicks || {};
    const hd = d.header || {};
    const headerPatch = {};
    const headerApplied = [];
    [['title', 'paperTitle', 'title'], ['authors', 'paperAuthors', 'authors'], ['affiliations', 'paperAffiliations', 'affiliations']]
      .forEach(([pick, field, label]) => {
        /* Les marqueurs de figure ne sont pas du texte : une ligne de l'en-tête
           qui en portait un ne doit pas écrire « [[FIGURE 1]] » dans le titre. */
        const value = stripFigureMarks(String((hd && hd[pick]) || '').trim());
        if (hp[pick] && value) { headerPatch[field] = value; headerApplied.push(label); }
      });
    /* Les PARTIES redirigées vers un champ d'en-tête s'ajoutent APRÈS ce que le
       document avait déjà en tête (elles viennent plus bas dans le document),
       avec la mise en forme du champ (voir headerTextFor). Le compte rendu dit
       lesquelles viennent du texte, pour que l'utilisateur sache où regarder. */
    const headerFromText = [];
    HEADER_DESTS.forEach((dest) => {
      const list = headerTexts.filter((h) => h.field === dest.id);
      if (!list.length) return;
      let value = String(headerPatch[dest.id] !== undefined ? headerPatch[dest.id] : (project[dest.id] || ''));
      list.forEach((h) => { value = headerTextFor(dest.id, h.text, { previous: value, mode: h.mode }); });
      value = String(value || '').trim();
      if (!value) return;
      headerPatch[dest.id] = value;
      headerFromText.push(dest.short);
      if (headerApplied.indexOf(dest.short) === -1) headerApplied.push(dest.short);
    });
    /* 1 bis. Le MATÉRIEL ET MÉTHODES du manuscrit → le champ « 📋 Materials and
       Methods » du projet : il est marqué « ✏️ edited » pour que
       « 🔄 Update from tests » ne l'écrase pas en douce (l'utilisateur garde la
       main sur le texte de l'article), et le document exporté l'imprime. */
    const mmText = mmTexts.map((t) => String(t || '').trim()).filter(Boolean).join('\n\n');
    const mmPatch = {};
    if (mmText) {
      mmPatch.materialsAndMethods = {
        ...(project.materialsAndMethods || {}),
        text: mmText,
        edited: true,
        editedAt: new Date().toISOString(),
        imported: true,
        source: 'manuscript-import'
      };
    }
    /* 2. Le texte → le contenu riche de la section : chaque [n] devient un LIEN
       vers la référence n (ancre #ref-n du document exporté + infobulle). Un
       numéro sans référence reste un nombre simple — jamais de lien mort. Les
       parties qui visent la MÊME section s'AJOUTENT l'une à l'autre.
       Le HTML écrit est celui du DOCUMENT quand il est connu (ses exposants, ses
       indices, ses italiques — voir htmlFromManuscriptPart) : la typographie de
       l'article ne se perd plus à l'import. */
    const titleFor = citationTitleFor(numbered.created);
    let linkedTotal = 0;
    convertedParts.forEach((c) => {
      const html = linkCitationNumbers(c.html || htmlFromText(c.text), {
        numbers: numberSet, hrefFor: (n) => `#${citationAnchorId(n)}`, titleFor
      });
      linkedTotal += linkedCitationNumbers(html).size;
      const previous = patch[c.dest] !== undefined ? patch[c.dest] : String(project[c.dest] || '').trim();
      patch[c.dest] = c.mode === 'replace' ? html : [previous, html].filter(Boolean).join('\n');
    });
    /* 3. L'ÉCRITURE, VÉRIFIÉE. Le patch part dans le magasin, puis le projet est
       RELU : si le navigateur a refusé (quota plein), une seconde écriture part
       avec les figures allégées — et si elle échoue encore, la page le DIT au
       lieu d'annoncer « ✓ importé » sur un magasin vide. */
    const receipt = {
      hash: d.hash || manuscriptFingerprint(d.text),
      fileName: d.fileName || '',
      at: new Date().toISOString(),
      sections: [...convertedParts.map((c) => c.dest), ...(mmText ? [METHODS_DEST.id] : [])],
      references: numbered.created.length
    };
    const history = Array.isArray(project.msImports) ? project.msImports : [];
    const fullPatch = {
      ...patch,
      ...headerPatch,
      ...mmPatch,
      bibliography: merged.list,
      references,
      ...(figRes.added ? { figures: figRes.figures } : {}),
      msImports: [...history.filter((it) => !it || it.hash !== receipt.hash), receipt].slice(-20)
    };
    /* L'écriture vérifiée : elle relit le magasin et n'annonce un succès que si
       le texte est BIEN là. Si le navigateur refuse (quota plein), elle réessaie
       une fois avec les figures allégées — le texte et les références d'abord. */
    const saved = commitProjectVerified(fullPatch, { lighten: true });
    const stored = saved.ok;
    const lightened = saved.lightened;
    msBusyRef.current = false;
    setMsImport(null);   // la fenêtre se ferme : plus de second import par inadvertance
    const filled = d.parts.filter((p) => p.dest && !isHeaderDest(p.dest));
    const destLabel = (id) => (PROJECT_TEXT_SECTIONS.find((s) => s.id === id)
      || HEADER_DESTS.find((s) => s.id === id) || (id === METHODS_DEST.id ? METHODS_DEST : null)
      || {}).label || id;
    setMsResult({
      ok: stored,
      undoProject: before,
      lines: [
        `${filled.length
          ? `${filled.length} section(s) filled (${filled.map((p) => destLabel(p.dest)).join(', ')})`
          : 'no section filled'}`
        + (headerApplied.length ? ` · header: ${headerApplied.join(' + ')}` : '')
        + (mmText ? ' · 📋 Materials & Methods replaced by the text of the document' : '')
        + (headerFromText.length
          ? ` (${headerFromText.join(' + ')} taken from the text — check “🧾 Title, authors & affiliations”)`
          : ''),
        `${merged.added} reference(s) added to the project bibliography · `
        + `${numbered.created.length} new numbered reference(s) — ${references.length} in the project`
        + (linkedTotal ? ` · 🔗 ${linkedTotal} citation(s) linked to their reference` : ' · no citation to link')
        + (enrichedLine ? ` · ${enrichedLine}` : '')
        + (completion.stillShortened
          ? ` · ⚠ ${completion.stillShortened} reference(s) still show “et al.”: write the co-authors in Publications → “Project bibliography”.`
          : ''),
        ...(unlinkedNumbers.length
          ? [`⚠ ${unlinkedNumbers.length} citation number(s) have no reference in this project: `
            + `${unlinkedNumbers.slice(0, 15).map((n) => `[${n}]`).join(', ')}`
            + `${unlinkedNumbers.length > 15 ? '…' : ''} — their entry is missing from the document’s `
            + `bibliography. Add it (“📚 + Reference”) then use “🔗 Link citations…”.`]
          : []),
        ...(notConverted.length
          ? [`⚠ ${notConverted.length} citation(s) could not be matched to the document’s bibliography and were `
            + `left exactly as they were: ${notConverted.slice(0, 8).join(' · ')}${notConverted.length > 8 ? '…' : ''}`]
          : []),
        ...(figureError
          ? [`⚠ The figures of the document could not be attached (${figureError}) — the text and the references are imported. `
            + 'Reconnect Google Drive and import the document again, or add the figures from the Image Builder.']
          : []),
        ...(figRes.added
          ? [`${figRes.added} figure(s) added to the sections (${figRes.onDrive ? `${figRes.onDrive} on Drive` : ''}`
            + `${figRes.onDrive && figRes.local ? ', ' : ''}${figRes.local ? `${figRes.local} kept in this browser` : ''}) `
            + `— “📄 Export document” prints them where the document had them`
            + (figRes.already ? ` · ${figRes.already} already there (nothing duplicated)` : '')]
          : []),
        /* Une figure que le document portait dans une partie sans destination (le
           chapeau, une partie « — do not import — ») ou dans une ligne de
           l'en-tête est ATTACHÉE QUAND MÊME à la section la plus proche : elle
           était auparavant perdue sans que rien ne le dise. */
        ...((figPlan.rerouted || figPlan.orphans)
          ? [`📎 ${figPlan.rerouted + figPlan.orphans} figure(s) had no section of their own `
            + '(part not imported, or head of the document): they were attached to '
            + `${figPlan.sections.filter((s) => s).join(', ')} — nothing is lost, move them if you want.`]
          : []),
        ...((figRes.failed || []).length
          ? [`⚠ ${figRes.failed.length} figure(s) could not be kept `
            + `(${figRes.failed.slice(0, 6).join(', ')}${figRes.failed.length > 6 ? '…' : ''}) — `
            + 'the others are attached. Reimport the document with Google Drive connected to keep them in the cloud.']
          : []),
        stored
          ? `💾 saved in this browser${lightened.length ? ` — to fit its storage, ${lightened.join(' and ')} could not be kept` : ''}`
          : `⚠ NOT SAVED: the browser refused to store this project (${saved.error}). `
            + `It is only in this window and will be lost when you leave the page — free some space `
            + `(or save the dataset to Drive) and import again.`
            + (saved.missing.length ? ` Fields not stored: ${saved.missing.join(', ')}.` : '')
      ]
    });

    /* ☁ LE MÊME DOCUMENT PART DANS LE DOSSIER DU PROJET SUR LE DRIVE.
       Le navigateur n'est qu'un cache : son quota se remplit (les figures) et un
       autre poste ne verrait rien de ce qui n'y est pas publié. Le document —
       texte des sections, en-tête de l'article, bibliographie, références
       numérotées, empreintes des imports ; JAMAIS les pixels des figures — est
       donc déposé dans
         Lab Workspace/<dataset>/projects/<projet>/<projet>_document.json
       L'archivage est BEST-EFFORT : sans Drive connecté l'import reste un
       succès, mais il a été TENTÉ — c'est le seul filet quand le navigateur,
       lui, a refusé d'écrire (quota plein). Le compte rendu est complété quand
       l'envoi a répondu. */
    const driveCopy = await archiveProjectDocument({
      project: { ...project, ...fullPatch }, datasetName: getDriveRootName()
    });
    /* La référence du fichier entre dans le projet (petite écriture vérifiée) :
       « ♻ Load the Drive copy » retrouve ainsi le fichier par son identifiant,
       sans avoir à le chercher par son nom. */
    if (driveCopy) commitProjectVerified({ driveDocument: driveCopy }, {});
    setMsResult((r) => {
      if (!r) return r;
      const line = driveCopy
        ? `☁ The text is also filed on Drive — ${driveCopy.folder}/${driveCopy.name} (${Math.max(1, Math.round(driveCopy.bytes / 1024))} kB)`
          + (r.ok ? '' : ' — this Drive copy is the ONLY complete one: this browser refused to store it.')
        : '☁ Not filed on Drive (Drive not connected) — the text lives in this browser only.';
      return { ...r, drive: driveCopy || null, lines: [...(r.lines || []), line] };
    });
  };

  /** « ♻ Load the Drive copy » : le document archivé dans le dossier du projet
   *  sur le Drive redevient le texte, l'en-tête et les références de la page.
   *  Rien n'est appliqué sans ce clic : la copie du Drive ne peut donc jamais
   *  écraser un travail plus récent à l'insu de l'utilisateur. */
  const loadProjectDriveCopy = async () => {
    const ref = (msResult && msResult.drive) || (project && project.driveDocument) || null;
    if (!ref || !ref.id || msBusyRef.current) return;
    msBusyRef.current = true;
    setMsResult((r) => (r ? { ...r, driveBusy: true } : r));
    const before = { ...project };
    const res = await restoreProjectDocument(ref);
    const saved = res.ok ? commitProjectVerified(res.patch, {}) : { ok: false, error: '' };
    msBusyRef.current = false;
    setMsResult((r) => {
      const base = r || {};
      const c = res.counts || {};
      return {
        ...base,
        driveBusy: false,
        ok: !!(res.ok && saved.ok),
        undoProject: res.ok ? before : (base.undoProject || null),
        lines: res.ok
          ? [`♻ Text restored from the Drive copy: ${c.sections} section(s), head ${c.header}/3, `
            + `${c.references} numbered reference(s), ${c.bibliography} bibliography entr(y|ies)`
            + (saved.ok ? '' : ` — ⚠ the browser refused to store it (${saved.error}); save the dataset to Drive first.`)]
          : [`⚠ ${res.error}`]
      };
    });
  };

  /** « ☁ File the text on Drive » : archiver le document du projet À LA DEMANDE
   *  (Drive était déconnecté pendant l'import, ou le projet vient d'un autre
   *  poste et son texte n'a jamais été déposé dans son dossier Drive). */
  const saveProjectDriveCopy = async () => {
    if (msBusyRef.current) return;
    msBusyRef.current = true;
    /* Le compte rendu en cours est CONSERVÉ (et son « Undo import » aussi) :
       classer le texte sur le Drive n'est pas un nouvel import. */
    setMsResult((r) => ({ ...(r || {}), ok: true, drive: null, driveBusy: true, lines: ['⏳ Filing the text in this project Drive folder…'] }));
    const copy = await archiveProjectDocument({ project, datasetName: getDriveRootName() });
    if (copy) commitProjectVerified({ driveDocument: copy }, {});
    msBusyRef.current = false;
    setMsResult((r) => ({
      ...(r || {}),
      ok: !!copy,
      drive: copy || null,
      driveBusy: false,
      lines: [copy
        ? `☁ The text is filed on Drive — ${copy.folder}/${copy.name} (${Math.max(1, Math.round(copy.bytes / 1024))} kB)`
        : '☁ Nothing was filed: Google Drive is not connected (or it refused). Connect it in the top bar, then try again.']
    }));
  };

  /** « ↩︎ Undo import » : rend le projet tel qu'il était avant le dernier import. */
  const undoManuscriptImport = () => {
    const snapshot = msResult && msResult.undoProject;
    if (!snapshot || !snapshot.id) return;
    const list = projectsRef.current.map((p) => (p.id === snapshot.id ? snapshot : p));
    const res = saveProjectsChecked(list, { projectId: snapshot.id, fields: {} });
    replaceProjects(list);
    setMsResult({
      ok: res.ok,
      undoProject: null,
      lines: [res.ok
        ? '↩︎ The import was undone — the project is back as it was before (text, references and bibliography).'
        : `⚠ The project was restored in this window, but the browser refused to store it (${res.error}).`]
    });
  };

  const renderBibImport = () => {
    if (!bibImport) return null;
    const parsed = bibImport.parsed || [];
    const picked = bibImport.picked || [];
    const existing = bibExistingKeys();
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
           onClick={() => setBibImport(null)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
             onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-800">📄 Import references — {project.name}</h3>
            <button onClick={() => setBibImport(null)} className="text-slate-400 hover:text-slate-600 text-sm px-1">✕</button>
          </div>
          <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Drop an article (<b>.docx</b> from Word, Google Docs export, Paperpile export, a <b>.ris</b>/<b>.bib</b>
              file, a text file) or paste the bibliography below. Only what is recognised as a reference is kept — the
              rest of the manuscript is ignored. <b>An incomplete entry is completed before it is stored</b>: the empty
              fields (authors, title, journal, year, volume, pages, DOI) are looked up in the lab publications and
              “Relevant papers”, then in Crossref (by DOI, else by the exact title) — nothing already written is
              overwritten. The papers are added to this project’s bibliography, so they also show
              up in Publications → “Project bibliography”. They also become the <b>numbered references</b> of the project
              (<b>[1]</b>, <b>[2]</b>… the same as “📚 + Reference”), printed in the document’s <b>References</b> with the
              “Publication format” of the lab, and
              the numbered citations already written in the text sections are turned into links to them — a reference
              imported from Paperpile as “12. Rossi…” therefore answers the “<b>[12]</b>” of the text.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 cursor-pointer">
                📂 Choose a document
                <input type="file" accept={REFERENCE_FILE_ACCEPT} className="hidden"
                       onChange={(e) => { loadBibImportFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <input type="checkbox" checked={!!bibImport.onePerLine}
                       onChange={(e) => { const next = { ...bibImport, onePerLine: e.target.checked }; setBibImport(next); analyseBibImport(next); }} />
                One reference per line
              </label>
              {bibImport.fileName && <span className="text-[11px] text-slate-400">{bibImport.fileName}</span>}
              {bibImport.busy && <span className="text-[11px] text-slate-400">working…</span>}
            </div>
            <textarea value={bibImport.text}
                      onChange={(e) => setBibImport((d) => ({ ...d, text: e.target.value }))}
                      placeholder={'Paste the bibliography here, e.g.\n1. Rossi M, Bianchi A (2018). Peptide-membrane interactions. BBA 1860:1234-1245. doi:10.1016/j.bbamem.2018.01.001'}
                      className={`${inputCls} font-mono text-[11px]`} rows={6} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => analyseBibImport()}
                      disabled={!String(bibImport.text || '').trim()}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40">
                🔍 Analyse the text
              </button>
              {bibImport.status && <span className="text-[11px] text-slate-600">{bibImport.status}</span>}
            </div>

            {parsed.length > 0 && (
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                    {parsed.length} reference(s) found · {picked.length} to add
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setBibImport((d) => ({ ...d, picked: parsed.map((_, i) => i) }))}
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800">All</button>
                    <button type="button" onClick={() => setBibImport((d) => ({ ...d, picked: [] }))}
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800">None</button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto custom-scrollbar">
                  {parsed.map((e, i) => {
                    const already = entryKeys(e).some((k) => existing.has(k));
                    const on = picked.indexOf(i) !== -1;
                    return (
                      <label key={`${e.title}-${i}`}
                             className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer ${on ? 'bg-white border-indigo-300' : 'bg-white/60 border-slate-200'}`}>
                        <input type="checkbox" checked={on} className="mt-0.5"
                               onChange={() => setBibImport((d) => {
                                 const list = d.picked || [];
                                 return {
                                   ...d,
                                   picked: list.indexOf(i) === -1
                                     ? [...list, i].sort((a, b) => a - b)
                                     : list.filter((x) => x !== i)
                                 };
                               })} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-800 leading-snug">{e.title || 'Untitled'}</div>
                          <div className="text-[10px] text-slate-500">
                            {[e.authors, e.journal, e.year].filter(Boolean).join(' · ') || '—'}
                          </div>
                          {e.doi && <div className="text-[10px] text-blue-600">doi:{e.doi}</div>}
                          {!e.authors && (
                            <div className="text-[10px] text-amber-600">
                              ⚠ no authors recognised — they are looked up when you add the reference (the lab
                              publications, then Crossref by DOI or title)
                            </div>
                          )}
                          {already && <div className="text-[10px] text-emerald-600">✓ already in this project’s bibliography</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="flex justify-end mt-2">
                  <button type="button" onClick={commitBibImport} disabled={picked.length === 0 || !!bibImport.busy}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                    {String(bibImport.status || '').startsWith('✨')
                      ? '⏳ Completing the missing authors / titles…'
                      : `➕ Add ${picked.length} reference(s) to “${project.name}”`}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-slate-200 text-[10px] text-slate-400">
            Files are read in the browser only. Duplicates are recognised by DOI, then PubMed ID, then title — an entry
            already present is never duplicated nor overwritten.
          </div>
        </div>
      </div>
    );
  };

  // ---- Reference picker modal ----
  /* ---- 📥 Fenêtre : importer un manuscrit (Google Docs / Word + Paperpile) -- */
  const renderManuscriptImport = () => {
    if (!msImport) return null;
    const plan = msImport.plan;
    const picked = msImport.picks || [];
    /* Les destinations d'une partie : les trois CHAMPS d'en-tête du projet
       (« 🧾 Title, authors & affiliations ») puis les sections TEXTE de la page.
       Un document qui imprime ses auteurs sous le résumé se répare donc en
       redirigeant le paragraphe, sans le laisser tomber dans « Background »
       (voir HEADER_DESTS dans utils/manuscriptImport.js). */
    const destGroups = [
      { label: '🧾 Project header (title · authors · affiliations)', options: HEADER_DESTS },
      { label: 'Sections of this page', options: PROJECT_TEXT_SECTIONS },
      /* Le Matériel et méthodes a son propre champ dans le projet (la section
         « 📋 Materials and Methods » de cette page, que le document exporté
         imprime) : un manuscrit importé n'a donc pas à verser ses méthodes dans
         « Results and discussion » — l'article, lui, ne les y met pas non plus. */
      { label: '📋 Materials & Methods of the project', options: [METHODS_DEST] }
    ];
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setMsImport(null)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-800">📥 Import a manuscript — {project.name}</h3>
            <button onClick={() => setMsImport(null)} className="text-slate-400 hover:text-slate-600 text-sm px-1">✕</button>
          </div>
          <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Choose the document (Google Docs: <b>Fichier → Télécharger → .docx</b> ou <b>page Web (.html)</b>, fichier Word)
              or paste its text. The <b>text</b> goes into the project sections you pick below, the document’s
              <b> bibliography</b> (Paperpile…) is added to the <b>Project bibliography</b>
              (Publications → “Project bibliography”), and the citations in the text become the program’s
              <b> numbered references</b> ([1], [2]…) — the same as “📚 + Reference”.
              The <b>figures</b> of the document are kept too: they become the figures of their section
              (editable, reusable in the Image Builder) and “📄 Export document” prints each one
              <b> at the place it had in the document</b>. The document itself is never uploaded: the TEXT you import is filed in the project Drive folder (<b>&lt;dataset&gt;/projects/&lt;project&gt;/&lt;project&gt;_document.json</b>) so it also lives on Drive, not only in this browser.
              The <b>title, authors and affiliations</b> of the paper are picked out of the text and shown in
              “Document header” below, line by line — and a part of the text that actually <i>is</i> the author list
              (a document that prints it under the abstract, for instance) can be redirected to the
              <b> 🧾 project header</b> instead of being left in a section. The author line keeps the
              <b>superscripts</b> of the paper (Rossi¹, Bianchi²).
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              <b>Sections are filled by the position of the parts</b>: everything between the Introduction and the
              Conclusions goes to <b>💬 Results and Discussion</b> — whatever its heading says (“Results”,
              “Discussion”, “Statistical analysis”…) — <b>except the Materials and Methods</b> (“Methods”,
              “Experimental part”…), which goes to the project’s <b>📋 Materials and Methods</b> text, and except
              Funding / Supporting information, which keep their own section. For a <b>.docx</b> the
              <b> formatting of the document is kept</b> in the section: bold, italic, <sup>superscripts</sup> and
              <sub>subscripts</sub> are imported as they are.
            </p>
            {msImport.focusSection && (
              <p className="text-[11px] text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-2 py-1.5">
                Opened from the
                <b> “{(PROJECT_TEXT_SECTIONS.find((s) => s.id === msImport.focusSection) || {}).label || msImport.focusSection}”</b>
                section: a part of the manuscript whose heading has no equivalent here is added to that section —
                change it in the dropdown below if you want it somewhere else.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 cursor-pointer">
                📂 Choose a document
                <input type="file" accept={MANUSCRIPT_FILE_ACCEPT} className="hidden"
                       onChange={(e) => { loadManuscriptFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </label>
              <button type="button" onClick={() => analyseManuscript(msImport.text, msImport.fileName)}
                      disabled={!String(msImport.text || '').trim()}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40">
                🔍 Analyse the text
              </button>
              {msImport.busy && <span className="text-[11px] text-slate-400">working…</span>}
              {msImport.status && <span className="text-[11px] text-slate-600">{msImport.status}</span>}
            </div>
            {!plan && (
              <textarea value={msImport.text || ''}
                        onChange={(e) => setMsImport((d) => ({ ...d, text: e.target.value }))}
                        placeholder="…or paste the manuscript here"
                        className={`${inputCls} font-mono text-[11px]`} rows={6} />
            )}
            {plan && (
              <>
                {(msImport.lines || []).length > 0 && (
                  <div className="border border-sky-200 bg-sky-50/40 rounded-lg p-2">
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1.5">
                      Document header → project (title · authors · affiliations)
                    </div>
                    {/* La zone d'en-tête ligne par ligne, avec le rôle compris par
                        le programme : le document tel qu'il est écrit suffit le
                        plus souvent, et sinon l'utilisateur désigne lui-même le
                        titre / les auteurs / les affiliations. Rien n'est modifié
                        dans le texte du document : on choisit seulement où va la
                        ligne — dans un champ du projet, « not imported », ou
                        « keep in the section text » pour la rendre au texte.
                        Quand le titre ou les auteurs manquent, les lignes qui y
                        ressemblent sont proposées elles aussi (voir
                        extraHeaderLines) : c'est le document qui imprime ses
                        auteurs sous le résumé. */}
                    <div className="flex flex-col gap-1 mb-2 max-h-56 overflow-y-auto custom-scrollbar">
                      {msImport.lines.map((l) => (
                        <div key={l.at} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1">
                          <span className="min-w-0 flex-1 text-[10px] text-slate-500 truncate" title={l.text}>{l.text}</span>
                          <select value={l.role} onChange={(e) => patchManuscriptHeaderRole(l.at, e.target.value)}
                                  className="shrink-0 border border-slate-300 rounded px-1.5 py-1 text-[10px] bg-white">
                            {HEADER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                          </select>
                        </div>
                      ))}
                      <p className="text-[10px] text-slate-500 italic">
                        These lines are the head of the paper: a wrong one (the file name, a date, a journal…) can be set
                        to “not imported”, and the real title / authors / affiliations picked by hand — “keep in the
                        section text” gives a line back to the text of its section. A line whose role is guessed wrong
                        can be changed here, one click, before anything is imported.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {[
                        { field: 'title', label: 'Title', rows: 1 },
                        { field: 'authors', label: 'Authors', rows: 1 },
                        { field: 'affiliations', label: 'Affiliations', rows: 3 }
                      ].map((row) => (
                        <div key={row.field} className="flex items-start gap-2 bg-white border border-slate-200 rounded-lg p-2">
                          <input type="checkbox" className="mt-1"
                                 checked={!!(msImport.headerPicks || {})[row.field]}
                                 onChange={() => toggleManuscriptHeaderPick(row.field)} />
                          <div className="min-w-0 flex-1 flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{row.label}</span>
                            {row.rows === 1 ? (
                              <input value={msImport.header[row.field] || ''}
                                     onChange={(e) => patchManuscriptHeader(row.field, e.target.value)}
                                     placeholder={`No ${row.label.toLowerCase()} recognised in the document`}
                                     className={inputCls} />
                            ) : (
                              <textarea value={msImport.header[row.field] || ''}
                                        onChange={(e) => patchManuscriptHeader(row.field, e.target.value)}
                                        rows={row.rows}
                                        placeholder={`No ${row.label.toLowerCase()} recognised in the document`}
                                        className={`${inputCls} text-xs`} />
                            )}
                            {!String(msImport.header[row.field] || '').trim() && (
                              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                ⚠ No {row.label.toLowerCase()} recognised in the document — set the role of the right line
                                in the list above to “{row.label}”, or type {row.label === 'Title' ? 'it' : 'them'} here.
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      These lines are the paper's title, authors and affiliations: they are stored in the project
                      (<b>🧾 Title, authors & affiliations</b>, at the top of this page) and printed at the top of
                      <b> 📄 Export document</b>. They are never imported as section text.
                      {project.paperTitle && !(msImport.headerPicks || {}).title
                        ? ' This project already has a title — tick “Title” to replace it.' : ''}
                    </p>
                  </div>
                )}

                <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-2">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1.5">
                    Text → project sections ({msImport.parts.length} part(s))
                  </div>
                  <div className="flex flex-col gap-1 max-h-56 overflow-y-auto custom-scrollbar">
                    {msImport.parts.map((p, i) => (
                      <div key={p.key} className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-700">{p.heading || `Part ${i + 1} (no heading)`}</span>
                          <span className="text-[10px] text-slate-400">{p.text.length} chars</span>
                          {figureMarksIn(p.text).length > 0 && (
                            <span className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-1.5 py-0.5"
                                  title={isHeaderDest(p.dest)
                                    ? 'The images of this part: a header field cannot print them, so they become figures of the section this part’s heading points to.'
                                    : 'The images of the document that stand in this part: they become figures of the section this part goes to, and the exported document prints them at that place.'}>
                              🖼 {figureMarksIn(p.text).length}
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-1.5">
                            <select value={p.dest} onChange={(e) => patchManuscriptPart(p.key, { dest: e.target.value })}
                                    className="border border-slate-300 rounded px-1.5 py-1 text-[10px] bg-white">
                              <option value="">— do not import —</option>
                              {destGroups.map((g) => (
                                <optgroup key={g.label} label={g.label}>
                                  {g.options.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            <select value={p.mode} onChange={(e) => patchManuscriptPart(p.key, { mode: e.target.value })}
                                    className="border border-slate-300 rounded px-1.5 py-1 text-[10px] bg-white">
                              <option value="append">add at the end</option>
                              <option value="replace">{isHeaderDest(p.dest) ? 'replace the field' : 'replace the section'}</option>
                            </select>
                          </span>
                        </div>
                        {isHeaderDest(p.dest) && (
                          <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-1">
                            🧾 This part is not section text: it goes into
                            <b> {headerDestLabel(p.dest) === 'affiliations' ? 'the affiliations' : `the ${headerDestLabel(p.dest)}`}</b> of
                            the project header (🧾 Title, authors & affiliations) — one author per line becomes a list, and
                            affiliations keep one line each. It disappears from the sections of this page.
                          </p>
                        )}
                        {p.dest === METHODS_DEST.id && (
                          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                            📋 The Materials &amp; Methods of the paper go to the project’s own
                            <b> Materials and Methods</b> text (the “📋 Materials and Methods” section of this page — the
                            exported document prints it). It is not mixed into “Results and Discussion”.
                          </p>
                        )}
                        {p.dest === 'discussion' && p.autoSection === 'discussion' && (
                          <p className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-1">
                            💬 Between the Introduction and the Conclusions, this part goes to
                            <b> Results and Discussion</b> — its own heading has no equivalent section here.
                          </p>
                        )}
                        <p className="text-[10px] text-slate-400 italic truncate">{p.text.slice(0, 160)}…</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    Each part goes to a section of this page — or to the <b>project header</b> when the document put its
                    authors or affiliations in the middle of the text (choose “🧾 Authors” / “🧾 Affiliations” above):
                    nothing is left in “Background” by mistake. The destination is already chosen by the <b>position</b>
                    of the part (Introduction → Conclusions ⇒ <b>Results and Discussion</b>, except the
                    Materials and Methods ⇒ the project’s <b>📋 Materials and Methods</b> text): change it here if the
                    document says otherwise.
                  </p>
                </div>

                {/* Les FIGURES du document : elles ne sont pas écrites dans le
                    texte de la section (elles y seraient figées et
                    partiraient dans tous les exports) — elles deviennent les
                    figures de la section de la partie qui les portait, là où
                    « 📤 Insert into project… » de l'Image Builder range aussi
                    ses compositions, et le document exporté les réinsère au
                    paragraphe qui les précédait (voir utils/figurePlacement.js). */}
                {(msImport.figures || []).length > 0 && (
                  <div className="border border-sky-200 bg-sky-50/40 rounded-lg p-2">
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1.5">
                      Figures → the sections of their part ({(msImport.figures || []).length} found)
                    </div>
                    <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                      {(msImport.figures || []).map((f) => (
                        <div key={f.index} className="shrink-0 w-28 bg-white border border-sky-200 rounded-lg p-1">
                          <img src={f.preview || figureDataUrl(f)} alt={figureLabel(f, f.index)}
                               className="w-full h-16 object-contain bg-slate-50 rounded"
                               referrerPolicy="no-referrer"
                               onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          <p className="text-[9px] text-slate-500 truncate" title={f.caption || f.name}>
                            {figureLabel(f, f.index)}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 italic mt-1">
                      They are attached to the section of the part they stand in (the “🖼 n” badge above), and their
                      caption (“Figure 1. …”) becomes the figure’s caption. “📄 Export document” prints each figure
                      after the same paragraph as in the document — nothing is written inside the section text.
                      {(msImport.figures || []).some((f) => f.missing)
                        ? ' ⚠ Some images could not be read from the file (their place is kept).' : ''}
                    </p>
                  </div>
                )}

                <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                      References → Project bibliography ({plan.entries.length} found · {picked.length} imported)
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setMsImport((d) => ({ ...d, picks: plan.entries.map((_, i) => i) }))}
                              className="text-[10px] font-bold text-emerald-700 hover:underline">All</button>
                      <button type="button" onClick={() => setMsImport((d) => ({ ...d, picks: [] }))}
                              className="text-[10px] font-bold text-emerald-700 hover:underline">None</button>
                    </div>
                  </div>
                  {plan.entries.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">
                      No reference recognised — this document has no readable “References” list.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto custom-scrollbar">
                      {plan.entries.map((e, i) => (
                        <label key={`${e.index}-${e.number}`}
                               className="flex items-start gap-2 bg-white border border-slate-200 rounded-lg p-2 cursor-pointer">
                          <input type="checkbox" checked={picked.indexOf(i) !== -1} className="mt-0.5"
                                 onChange={() => toggleManuscriptPick(i)} />
                          <span className="min-w-0">
                            <span className="text-[11px] font-bold text-slate-700">[{e.number}] {e.entry.title || 'Untitled'}</span>
                            <span className="block text-[10px] text-slate-500">
                              {[e.entry.authors, e.entry.year, e.entry.journal, e.entry.doi].filter(Boolean).join(' · ')}
                              {e.isNew ? '' : ' · already in this project'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    Every reference of the document is added to the <b>Project bibliography</b> and numbered
                    automatically, and each citation of the text becomes a link to its reference — nothing to tick.
                    Untick a line here to leave that paper out (the others are imported all the same).
                  </p>
                </div>

                <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-2">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 mb-1.5">
                    Citations in the text ({plan.citations.length} found · {plan.citations.length - plan.unresolved.length} → [n])
                  </div>
                  {plan.citations.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">
                      No in-text citation recognised — the text is imported exactly as it is.
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-600">
                      {plan.unresolved.length
                        ? `${plan.unresolved.length} citation(s) will be LEFT AS THEY ARE: `
                        : 'Every citation was matched to the bibliography: '}
                      <span className="font-mono">{plan.unresolved.slice(0, 12).map((c) => c.raw).join(' · ')}</span>
                    </p>
                  )}
                  {plan.unresolved.length > 0 && (
                    <p className="text-[10px] text-slate-400 italic mt-1">
                      An unmatched citation usually means its paper is missing from the document’s bibliography: add it to
                      the Project bibliography, then convert it by hand with “📚 + Reference”.
                    </p>
                  )}
                </div>

                {/* LE MÊME DOCUMENT DÉJÀ IMPORTÉ : on le DIT et on demande une
                    confirmation explicite — un second import sans le savoir
                    collait tout le texte une deuxième fois dans les sections. */}
                {msImport.previous && (
                  <div className="border border-red-300 bg-red-50 rounded-lg p-2">
                    <p className="text-[11px] font-bold text-red-700">
                      ⚠ This document was already imported into “{project.name}”
                      {msImport.previous.at ? ` on ${new Date(msImport.previous.at).toLocaleString()}` : ''}
                      {msImport.previous.fileName ? ` (${msImport.previous.fileName})` : ''}.
                      Importing it again ADDS its text a second time to the same sections.
                    </p>
                    <label className="flex items-center gap-1.5 text-[11px] text-red-700 font-bold mt-1.5">
                      <input type="checkbox" checked={!!msImport.confirmRepeat}
                             onChange={(e) => setMsImport((cur) => ({ ...cur, confirmRepeat: e.target.checked }))} />
                      I know — import it again anyway
                    </label>
                    <p className="text-[10px] text-red-600 mt-1">
                      Nothing has been imported yet: the window only writes when you click the button below.
                      {' '}
                      <b>“🖼 Figures only”</b> below needs no confirmation: it recovers the images of this document
                      and leaves the text exactly as it is.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {/* 🖼 FIGURES SEULES : la façon de RATTRAPER les figures d'un
                      document déjà importé (l'import les avait perdues) sans
                      recoller son texte. L'utilisateur le décide ici — le
                      programme ne devine jamais. */}
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-700 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1.5"
                         title="Attach the images of this document to their sections and change NOTHING else: the text, the references and the bibliography of this project stay exactly as they are. Use it to recover the figures of a document that was already imported.">
                    <input type="checkbox" checked={!!msImport.figuresOnly}
                           onChange={(e) => setMsImport((d) => ({ ...d, figuresOnly: e.target.checked }))} />
                    🖼 Figures only (recover the images — the text is left as it is)
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={applyManuscriptImport}
                          disabled={msImport.busy
                            || (!!msImport.previous && !msImport.confirmRepeat && !msImport.figuresOnly)}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {msImport.busy
                      ? '⏳ Importing (figures, references…)'
                      : (msImport.figuresOnly ? '✓ Attach the figures (nothing else)' : '✓ Import into this project')}
                  </button>
                  <span className="text-[10px] text-slate-400">
                    Only what is shown above is written — existing section text is kept unless “replace the section” is chosen.
                    The window closes by itself when the import is stored, and the report appears at the top of the page.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRefPicker = () => {
    if (!refPicker) return null;
    const pickerLabel = refPicker.insertText ? 'Insert reference' : 'Add reference';
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
           onClick={() => setRefPicker(null)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
             onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-800">{pickerLabel} — {project.name}</h3>
            <button onClick={() => setRefPicker(null)} className="text-slate-400 hover:text-slate-600 text-sm px-1">✕</button>
          </div>
          <div className="p-3 overflow-y-auto custom-scrollbar flex flex-col gap-4">
            {[
              { group: '📄 Project bibliography', items: pickerItems(projectBib) },
              { group: '📰 Publications of the scientist', items: pickerItems(scientistPubs) }
            ].map((g) => (
              <div key={g.group}>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5">
                  {g.group} <span className="text-slate-300">({g.items.length})</span>
                </div>
                {g.items.length === 0 ? (
                  <div className="text-xs italic text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    No papers yet — add some in Publications → “Project bibliography” (for this project) or import the
                    scientist's publications.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {g.items.map((item) => {
                      const existing = refs.find((r) => r.sourceId === item.id && r.source === item.source);
                      return (
                        <div key={item.id}
                             className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-800 leading-snug">
                              {existing && <span className="text-indigo-600 mr-1">[{existing.number}]</span>}
                              {item.title || 'Untitled'}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {[item.authors, item.journal, item.year].filter(Boolean).join(' · ') || '—'}
                            </div>
                            {!item.authors && (
                              <div className="text-[10px] text-amber-600">
                                ⚠ no authors recorded — complete the paper in Publications → “Project bibliography”
                              </div>
                            )}
                            {item.link && <div className="text-[10px] text-blue-600 truncate">{item.link}</div>}
                          </div>
                          <button type="button"
                                  onClick={() => { findOrAddRef(item, refPicker.insertText); setRefPicker(null); }}
                                  className="shrink-0 px-2.5 py-1 text-[10px] font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                            {existing ? (refPicker.insertText ? 'Insert' : '✓ Already added') : (refPicker.insertText ? '+ Insert' : '+ Add')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-slate-200 text-[10px] text-slate-400">
            References are numbered in insertion order and can be reused across all text sections.
          </div>
        </div>
      </div>
    );
  };


  const textSection = (id, label, hint, value, onChange) => {
    const figures = sectionFigures(id);
    const docs = sectionDocs(id);
    return (
      <SectionCard title={label} open={openSections[id]} onToggle={() => toggleSection(id)}
                   badge={value ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">saved</span> : null}>
        <p className="text-xs text-slate-500 mb-2">{hint} Insert links, figures, standard tables, documents and numbered
          references (from the “Project bibliography” and the “Publications of the scientist”).</p>
        <RichTextEditor
          value={value}
          onChange={onChange}
          placeholder={hint}
          linkButton
          figureButton
          docImportButton
          readOnly={!canModify}
          minHeight={420}
          maxHeight={6000}
          fileNaming={{ project: project.name || '', section: label }}
          toolbarExtra={canModify ? [
            { label: '🖼 + Slide', title: 'Insert a slide from the Figures & Slides deck (Publications)', onClick: () => setSlidePickerFor(id) },
            { label: '▦ + Std Table', title: 'Insert a standard table at the cursor position', onClick: (insertText) => setTableDraft({ section: id, insertText }) },
            { label: '📎 + Document', title: 'Attach a document link', onClick: () => addSectionDoc(id) },
            { label: '📚 + Reference', title: 'Insert a numbered reference at the cursor position', onClick: (insertText) => setRefPicker({ insertText }) }
            /* 📥 L'import d'un MANUSCRIT (texte + bibliographie Paperpile +
               citations numérotées) n'est proposé qu'UNE fois, en HAUT de la
               page projet : le répéter dans chaque section et dans la
               bibliographie encombrait les barres d'outils pour rien. */
          ] : []}
        />
        {slidePickerFor === id && (
          <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-violet-800">🖼 Insert a slide from the Figures &amp; Slides deck</span>
              <button type="button" onClick={() => setSlidePickerFor(null)}
                      className="text-[10px] font-bold text-slate-500 hover:text-slate-700">✕ Close</button>
            </div>
            {deckSlides.length === 0 ? (
              <p className="text-[10px] text-slate-500 italic">No slides yet — create them in Publications → Figures &amp; Slides.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 max-h-80 overflow-y-auto custom-scrollbar">
                {deckSlides.map((s, idx) => (
                  <div key={s.id} className="bg-white border border-violet-200 rounded-lg p-2 flex flex-col gap-1.5">
                    <SlidePreview slide={s} width={180} />
                    <span className="text-[10px] font-bold text-slate-600 truncate">{s.title || `Slide ${idx + 1}`}</span>
                    <button type="button"
                            disabled={slideInserting}
                            onClick={() => insertSlideIntoSection(id, s, idx)}
                            className="text-[10px] font-bold bg-violet-600 text-white rounded px-2 py-1 hover:bg-violet-700 disabled:opacity-40">
                      {slideInserting ? 'Rendering…' : '+ Insert slide'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {canModify && (
        <DriveUploadButton
          suggestedName={suggestDriveFileName({ project: project.name || '', section: label, suffix: 'doc' })}
          naming={{ project: project.name || '', section: label, suffix: 'doc' }}
          onDone={({ name, dataUrl, drive }) => {
            patchDocs(id, [...sectionDocs(id), { id: genProjectId(), name, data: drive ? drive.driveUrl : dataUrl }]);
            // Dire OÙ le fichier a été rangé (et le vérifier) : plus de
            // « enregistré » sans savoir dans quel dossier du Drive il est.
            verifySectionUpload(label, name);
          }}
          label="⬆ Upload document"
        />
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
          <span className="font-bold">📁 Drive location:</span>
          <span className="font-mono break-all">{sectionDriveLabel(label)}</span>
          <button type="button" onClick={() => openSectionFolder(label)}
                  className="font-bold text-blue-600 hover:text-blue-800 underline"
                  title="Open (creating it if needed) the Drive folder where this section's documents are stored">
            open folder ↗
          </button>
          {driveFlash[label] && (
            <span className={`font-bold ${driveFlash[label].ok ? 'text-emerald-700' : 'text-amber-700'}`}>
              {driveFlash[label].text}
            </span>
          )}
        </div>

        {figures.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-bold text-slate-700">Figures</h4>
              {/* LE GLISSER-DÉPOSER est annoncé : sans un mot, personne ne
                  devine que les cartes se prennent à la souris. */}
              {canModify && (
                <span className="text-[10px] text-slate-400">
                  ⋮⋮ drag a figure to change its place — or drop it on a figure of another section to move it there
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {figures.map((fig) => (
                <div key={fig.id}
                     draggable={canModify}
                     onDragStart={(e) => {
                       setFigDrag({ sec: id, id: fig.id });
                       try { e.dataTransfer.setData('text/plain', fig.id); } catch { /* navigateur sans dataTransfer */ }
                       e.dataTransfer.effectAllowed = 'move';
                     }}
                     onDragEnd={() => { setFigDrag(null); setFigOver(''); }}
                     onDragOver={(e) => {
                       if (!figDrag) return;
                       e.preventDefault();
                       e.dataTransfer.dropEffect = 'move';
                       if (figOver !== fig.id) setFigOver(fig.id);
                     }}
                     onDragLeave={() => { if (figOver === fig.id) setFigOver(''); }}
                     onDrop={(e) => { e.preventDefault(); dropFigure(id, fig.id); }}
                     className={`bg-slate-50 border rounded-xl p-3 shadow-sm flex flex-col gap-2 ${
                       figDrag && figDrag.id === fig.id ? 'opacity-40 border-slate-300'
                         : figOver === fig.id ? 'border-blue-400 ring-2 ring-blue-200'
                           : 'border-slate-200'} ${canModify ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                      {canModify && (
                        <span className="text-slate-400 text-sm font-black select-none"
                              title="Drag this figure to change its place in the section (or drop it on another section's figures)">⋮⋮</span>
                      )}
                      {fig.isSlide
                        ? <span className="text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">🖼 slide</span>
                        : fig.source === 'image-builder'
                          ? <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5" title="Composed in the Image Builder — this figure keeps its link back to that canvas">🖼 builder</span>
                          : <span>Figure</span>}
                    </span>
                    <span className="flex items-center gap-1.5 ml-auto">
                      {fig.source === 'image-builder' && typeof openImageBuilder === 'function' && (
                        <button type="button" onClick={() => openBuilderForFigure(fig)}
                                className="text-[10px] font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 px-2 py-1"
                                title={fig.canvasId
                                  ? `Reopen ${fig.canvasLabel ? `“${fig.canvasLabel}”` : 'this composition'} in the Image Builder (this project): the editor loads its panels, captions, grid and canvas size — saving the canvas again updates this same entry`
                                  : 'Open the Image Builder for this project to modify the composition this figure was made from'}>
                          ✏️ Modify in Image Builder
                        </button>
                      )}
                      <button onClick={() => removeSectionFigure(id, fig.id)}
                              className="bg-red-50 hover:bg-red-100 text-red-500 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold border border-red-200 shrink-0"
                              title="Remove this figure from the section">×</button>
                    </span>
                  </div>
                  <input type="text" value={fig.url} onChange={(e) => patchSectionFigure(id, fig.id, { url: e.target.value })}
                         placeholder="Paste image URL here (Google Drive, Dropbox, etc.)"
                         className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 bg-white" />
                  {fig.url.trim() !== '' && (
                    <div className="bg-white rounded-lg p-2 border border-slate-200">
                      <SmartImage src={fig.url} alt="Figure" />
                    </div>
                  )}
                  {fig.pixelsMissing && (
                    /* Les pixels de cette image ne sont plus gardés dans le
                       magasin de ce navigateur (il était plein : voir
                       saveProjectsRescued). Sa place, son nom, sa légende et sa
                       position dans le document exporté sont INTACTS — c'est ce
                       qui se réimporte, alors que le texte, lui, ne se réécrit pas.
                       Et depuis que le lien Drive est posé à l'insertion (voir
                       Image Builder) ET que la page remonte d'elle-même ce lien
                       (figureDriveLink + l'effet des figures), l'image se
                       réaffiche TOUTE SEULE : ce cadre est un état transitoire. */
                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
                      🖼 The image itself is not kept on this device (the browser’s store was full) — it is
                      read back from its Drive copy as soon as that file is known here: press
                      “⬇ Add missing figures from Drive” above if the picture stays empty. The figure keeps its
                      place, name, caption and its spot in “📄 Export document”.
                    </p>
                  )}
                  <textarea value={fig.caption} onChange={(e) => patchSectionFigure(id, fig.id, { caption: e.target.value })}
                            placeholder="Figure caption…" rows={2}
                            className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 resize-y bg-white" />
                  {fig.anchor && (
                    /* Figure venue d'un manuscrit importé : elle est attachée
                       ICI (elle reste modifiable) et c'est le document exporté
                       qui la réinsère dans le texte, après ce paragraphe. */
                    <p className="text-[10px] text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-1"
                       title={fig.anchor}>
                      📄 printed in “📄 Export document” after: “{fig.anchor.length > 90 ? `${fig.anchor.slice(0, 90)}…` : fig.anchor}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {docs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-slate-700">Documents</h4>
              <button type="button" onClick={openDrive}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 underline"
                      title="Open your Google Drive folder in a new tab">Open Drive ↗</button>
            </div>
            <div className="flex flex-col gap-1.5">
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-lg">
                  <input type="text" value={doc.name} onChange={(e) => patchSectionDoc(id, doc.id, { name: e.target.value })}
                         placeholder="Document Name"
                         className="w-1/2 border border-slate-300 rounded p-1 text-[10px] outline-none focus:border-blue-500 bg-white" />
                  <input type="text" value={doc.data} onChange={(e) => patchSectionDoc(id, doc.id, { data: e.target.value })}
                         placeholder="https://..."
                         className="flex-1 border border-slate-300 rounded p-1 text-[10px] outline-none focus:border-blue-500 bg-white" />
                  {doc.data && doc.data.trim() !== '' && (
                    <a href={doc.data} target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-blue-500 hover:text-blue-700 underline whitespace-nowrap">Open ↗</a>
                  )}
                  <button onClick={() => removeSectionDoc(id, doc.id)} className="text-slate-400 hover:text-red-500 font-bold px-1 text-[10px]">×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    );
  };

  // ---- Export the project as a printable text document ----
  /* LE CORPS DU DOCUMENT POUR L'EXPORT — l'impression / le PDF ET le fichier Word
     (voir exportProjectDocx) le partagent : le document affiché, RÉPARÉ, puis
     rangé dans l'ordre du « Publication format ». Une seule fabrication, donc
     l'écran, le papier et le .docx ne peuvent pas diverger. */
  const projectDocBodyHtml = () => {
    const docEl = document.getElementById(DOC_CONTAINER_ID);
    if (!docEl) return '';
    /* CE QUI PART À L'IMPRESSION : le document affiché, RÉPARÉ.
       Un document enregistré (« ✏️ Edit text » → « 💾 Save changes ») est un
       INSTANTANÉ : les références importées DEPUIS n'y figurent pas et ses
       « [12] » n'y sont pas liés — l'export (et son PDF) sortait donc sans les
       références Paperpile, même une fois la numérotation en place. On ajoute
       ici les entrées manquantes (ancre `#ref-<n>`) et on relie les citations.
       Le texte de l'auteur, lui, n'est jamais réécrit. */
    /* LE PAPIER, LE PDF ET LE .docx NE PORTENT PAS L'INTERFACE (voir
       withoutScreenOnlyUi). La feuille d'impression cache déjà les `no-print` et
       docxExport les retire, mais le corps est fabriqué ICI, pour les trois à la
       fois : on les retire une bonne fois, avant la réparation des références et
       l'ordre du journal — le texte du document, lui, n'est jamais touché. */
    let bodyHtml = withoutScreenOnlyUi(docEl.innerHTML);
    if (refs.length) {
      const repaired = ensureReferenceEntries(bodyHtml, refs.map((r) => ({
        number: Number(r && r.number) || 0,
        html: pubCitationHtml(citeData(r), pubFormat, operatorNames) || String((r && r.title) || '')
      })));
      bodyHtml = linkCitations(repaired.html);
    }
    /* L'ORDRE DES SECTIONS DU JOURNAL (la demande) : quand un journal est choisi
       (« Journal », dans le Publication format), le document EXPORTÉ / IMPRIMÉ se
       lit dans SON ordre — Introduction → … → References — sans qu'un mot du texte
       soit réécrit. Les titres que le journal ne nomme pas ne bougent pas, et deux
       sections du même genre gardent l'ordre de l'auteur (voir reorderDocHtml, qui
       déplace des blocs entiers).
       LES INTITULÉS CHOISIS PARTENT AVEC : `pubDocTitleKeywords` rend les mots du
       document dont l'utilisateur a changé le titre (« materials and methods » →
       « Experimental section »), donc un texte DÉJÀ ENREGISTRÉ — figé avant le
       changement de nom — suit le nouveau titre au moment de l'export. */
    /* L'ORDRE DU PANNEAU D'ABORD, CELUI DU JOURNAL ENSUITE (voir docOrderWords) :
       le document imprimé se lit dans l'ordre que l'utilisateur a réglé, et les
       sections qu'aucun des deux ne nomme ne bougent pas. Les titres choisis
       partent avec (`pubDocTitleKeywords`), pour un texte déjà figé aussi. */
    bodyHtml = reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));
    /* LA TÊTE SE LIT SUR DES LIGNES SÉPARÉES — « in the final document the list of
       authors must be separated by the title with one empty line. an empty line must
       also separate the authors from the affiliations. » Le titre, les auteurs et les
       affiliations sont donc séparés par une LIGNE VIDE (voir docHeadSpacedHtml, qui
       la pose entre deux blocs de tête VOISINS et la remet à sa place après tout
       déplacement : un document figé, écrit avant cette règle, la reçoit ici aussi —
       l'impression, le PDF et le .docx passent tous par cette fabrication). */
    bodyHtml = docHeadSpacedHtml(bodyHtml);
    return bodyHtml;
  };

  const printProjectDoc = () => {
    if (!document.getElementById(DOC_CONTAINER_ID)) return;
    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) { window.print(); return; }
    const bodyHtml = projectDocBodyHtml();
    const title = `${project.name} — project document`;
    /* LA MISE EN FORME DU DOCUMENT (« Publication format ») PART AVEC L'EXPORT :
       sa feuille vit dans la page de l'application (`#project-doc-container`),
       elle n'est donc pas dans le HTML copié — on la réécrit ici et le corps
       est remis dans le même conteneur, pour que ses règles s'appliquent
       (police, taille, position, style, couleur de chaque partie, figures
       comprises — voir pubLayoutCss). */
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <!-- LA PAGE EXPORTÉE S'ADAPTE À LA LARGEUR DE L'ÉCRAN : sans ce meta, un
       téléphone (ou une fenêtre étroite) affichait la page en « desktop »
       dézoomé — texte minuscule et marges de 2 cm qui mangeaient la moitié de
       l'écran. Voir les règles @media plus bas. -->
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.55; font-size: 15px;
           margin: 0 auto; max-width: 46rem;
           padding: clamp(0.8rem, 4vw, 2.2cm) clamp(0.9rem, 5vw, 2.2cm);
           overflow-wrap: break-word; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h2 { font-size: 16px; border-bottom: 1px solid #bbb; padding-bottom: 4px; margin: 26px 0 10px; }
    h3 { font-size: 14px; margin: 14px 0 6px; }
    p { margin: 8px 0; }
    img { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #888; padding: 5px 7px; }
    th { background: #f1f5f9; }
    figure { margin: 12px 0; page-break-inside: avoid; }
    figcaption { font-size: 12px; color: #555; margin-top: 4px; }
    ol, ul { margin: 8px 0 8px 22px; }
    li { margin: 3px 0; }
    .meta { font-size: 12px; color: #666; }
    .exp-card { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; margin: 14px 0; page-break-inside: avoid; }
    .no-print { display: none !important; }
    .doc-ins { background: #dcfce7; color: #166534; text-decoration: none; }
    .doc-del { background: #fee2e2; color: #991b1b; text-decoration: line-through; }
    /* Les citations du texte : le [12] est un lien vers la référence imprimée
       plus bas (voir utils/referenceLinks.js) — la feuille du document exporté
       est séparée de celle de l'application, il faut donc la même règle ici. */
    .cite-ref { color: #2563eb; font-weight: 700; text-decoration: none; }
    li:target { background: #fef08a; }
    button { font-family: Georgia, 'Times New Roman', serif; }
    /* LA MISE EN FORME CHOISIE DANS LE « PUBLICATION FORMAT » (voir
       pubLayoutCss) : elle est écrite ici parce que la page exportée est
       séparée de celle de l'application. Rien n'est écrit quand rien n'a été
       choisi : la feuille ci-dessus fait alors tout le travail. */
    ${pubLayoutCss(pubFormat, DOC_CONTAINER_SELECTOR)}
    /* ── LA PAGE S'ADAPTE À LA LARGEUR (téléphone, fenêtre étroite, zoom) ──
       Rien ne dépasse jamais la page : images et formules se réduisent, un
       tableau large défile DANS SON CADRE au lieu d'être coupé, un mot très long
       (URL, séquence) se coupe. À l'impression, ce sont les marges de la feuille
       (@page) qui s'appliquent et les tableaux reprennent leur mise en page. */
    img, svg, canvas, video { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    pre, code { max-width: 100%; overflow-x: auto; }
    @media screen and (max-width: 640px) {
      body { font-size: 14px; }
      h1 { font-size: 20px; }
      h2 { font-size: 15px; margin: 20px 0 8px; }
      table { display: block; overflow-x: auto; }
      figure { margin: 10px 0; }
    }
    @media print {
      @page { margin: 1.6cm 1.5cm; }
      body { padding: 0; max-width: none; font-size: 13px; }
      table { display: table; width: 100%; }
      h1, h2 { break-after: avoid; }
    }
  </style>
</head>
<body><div id="${DOC_CONTAINER_ID}">${bodyHtml}</div></body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 350);
  };

  /* « 📄 Export to Word » — le MÊME corps que l'impression (voir
     projectDocBodyHtml) écrit dans un vrai .docx : le fichier est fabriqué puis
     téléchargé dans le navigateur, rien ne part ailleurs (utils/docxExport.js).
     DEUX CHOSES PARTENT AVEC LUI, parce qu'un .docx ne sait ni lire la feuille de
     l'application ni ouvrir une URL :
       • LA MISE EN FORME DU DOCUMENT (« the export to docx does not reflect the
         style of the document… police, alignement, font, color ») : c'est le
         « Publication format » du projet, le même que l'impression applique
         (voir docxStyleOf) ;
       • LES PIXELS DES FIGURES (« furthermore images are missing ») : chaque
         image est rapatriée ici (les `data:` URL sont déjà dans le document, une
         figure du Drive est téléchargée) et devient une partie du fichier ZIP
         (`word/media/…`). Une image illisible est laissée de côté : sa légende,
         elle, reste dans le document. */
  /* LES PIXELS D'UNE IMAGE DU DOCUMENT : on va les chercher (Drive, Nextcloud,
     ou l'URL telle quelle — voir resolveImageToDataUrl) et une image VECTORIELLE
     est d'abord dessinée en PNG, la seule forme qu'un .docx accepte toujours
     (voir rasterizeSvgImage). Une image qu'on n'obtient pas ne part pas. */
  const docxImageResolver = async (src) => rasterizeSvgImage(await resolveImageToDataUrl(src));
  const exportProjectDocx = async () => {
    const bodyHtml = projectDocBodyHtml();
    if (!bodyHtml) {
      setMmFeedback('⚠️ The document is not on screen — open the document first');
      setTimeout(() => setMmFeedback(''), 3500);
      return;
    }
    setMmFeedback('📄 Building the Word document…');
    try {
      const images = await resolveDocxImages(bodyHtml, docxImageResolver);
      downloadDocx(bodyHtml, project.name, { format: pubFormat, images });
      setMmFeedback('📄 Word document downloaded');
    } catch {
      setMmFeedback('⚠️ Could not build the .docx file');
    }
    setTimeout(() => setMmFeedback(''), 3500);
  };

  const renderTableDraft = () => {
    if (!tableDraft) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
           onClick={() => setTableDraft(null)}>
        <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-sm font-black text-slate-800 mb-3">Insert standard table</h3>
          <div className="flex items-center gap-4 mb-4">
            <label className="text-xs font-bold text-slate-600">Rows:
              <input type="number" min="1" value={tableRows} onChange={(e) => setTableRows(parseInt(e.target.value) || 1)}
                     className="w-16 ml-2 border border-slate-300 rounded px-1.5 py-1 text-xs outline-none" />
            </label>
            <label className="text-xs font-bold text-slate-600">Cols:
              <input type="number" min="1" value={tableCols} onChange={(e) => setTableCols(parseInt(e.target.value) || 1)}
                     className="w-16 ml-2 border border-slate-300 rounded px-1.5 py-1 text-xs outline-none" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setTableDraft(null)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
            <button onClick={() => {
              let tableHtml = '<br/><table style="width:100%; border-collapse: collapse;" border="1"><tbody><tr>';
              for (let c = 0; c < tableCols; c++) {
                tableHtml += `<th style="padding:4px; background-color:#f1f5f9; border: 1px solid #cbd5e1;">Header ${c + 1}</th>`;
              }
              tableHtml += '</tr>';
              for (let r = 0; r < tableRows; r++) {
                tableHtml += '<tr>';
                for (let c = 0; c < tableCols; c++) {
                  tableHtml += '<td style="padding:4px; border: 1px solid #cbd5e1;">Data</td>';
                }
                tableHtml += '</tr>';
              }
              tableHtml += '</tbody></table><br/>';
              if (tableDraft.insertText) tableDraft.insertText(tableHtml);
              setTableDraft(null);
            }} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Insert table</button>
          </div>
        </div>
      </div>
    );
  };

  const renderExport = () => {
    if (!showExport) return null;
    const includedExps = (project.experiments || []).filter((e) => e.includeInDocument);
    /* Chaque section sort avec ses CITATIONS LIÉES (voir utils/referenceLinks.js) :
       le « [12] » du texte mène à la référence 12 imprimée en fin de document, et
       l'infobulle rappelle titre et auteurs. Un numéro inconnu reste intact.
       Funding et Supporting information ne s'impriment que s'ils sont remplis. */
    const sectionBlocksOf = PROJECT_TEXT_SECTIONS
      .map((s) => ({
        id: s.id,
        title: s.label,
        html: project[s.id] || '',
        optional: OPTIONAL_TEXT_SECTION_IDS.includes(s.id),
      }))
      .filter((s) => !s.optional || String(s.html || '').trim())
      /* C'est ICI que les figures importées d'un manuscrit reprennent leur
         place : chacune est posée après le paragraphe qu'elle suivait dans le
         document (son « anchor »), et le texte de la section reste, lui, sans
         image. Les figures sans ancre (ajoutées à la main, ancre disparue)
         restent affichées après la section, comme avant. */
      .map((s) => {
        const figures = sectionFigures(s.id).map((f) => ({ ...f, url: getRenderableDriveUrl(f.url) }));
        const split = splitAnchoredFigures(linkCitations(repairContentImages(s.html || '')), figures);
        return { ...s, html: split.html, restFigures: split.rest };
      });
    /* TOUTES LES SECTIONS DE TEXTE DU PROJET ONT LEUR RANGÉE AU PANNEAU — « Scientific
       background » et « Results and discussion » (la demande : « the “Document sections
       (order & titles)” section should contain “scientific background” and “Results and
       discussion” »), puis « Conclusions », « Funding » et « Supporting information »
       (voir PUB_DOC_BLOCKS) : chacune s'imprime à SA place, sous l'intitulé qu'elle a
       reçu. Le bloc générique « Text sections » a donc disparu — il n'avait plus rien à
       porter — et le document imprimé ne change pas tant que rien n'est réglé. */
    const ownRowBlocks = sectionBlocksOf.filter((s) => !!pubDocBlockOfSection(s.id));
    /** UNE SECTION DU DOCUMENT — son intitulé, son texte, ses figures, ses documents.
     *  Un intitulé VIDE (une case décochée au panneau, un style qui n'en écrit pas — voir
     *  pubDocTitleHidden) n'écrit AUCUN `<h2>` : la section garde son texte, ses figures
     *  et sa place dans le document. */
    const renderSectionBlock = (s, heading) => (
      <div key={s.id} className="mb-6">
        {heading ? <h2 className="pf-heading text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">{heading}</h2> : null}
        {s.html ? <div className="pf-body text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: repairContentImages(s.html) }} />
                : <p className="text-xs italic text-slate-400">—</p>}
        {renderFigures(s.restFigures || [])}
        {renderDocs(sectionDocs(s.id))}
      </div>
    );
    const renderFigures = (list) => list.filter((f) => (f.url || '').trim() !== '').length > 0 && (
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.filter((f) => (f.url || '').trim() !== '').map((f) => (
          <figure key={f.id} className="pf-figure">
            <img src={f.url} alt={f.caption || 'Figure'} style={{ maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
            {f.caption && <figcaption className="pf-caption text-xs text-slate-500 mt-1">{f.caption}</figcaption>}
          </figure>
        ))}
      </div>
    );
    const renderDocs = (list) => list.length > 0 && (
      <ul className="mt-2 text-xs text-slate-600 list-disc pl-4">
        {list.map((d) => (
          <li key={d.id}>{d.name || 'Document'}{d.data ? ` — ${d.data}` : ''}</li>
        ))}
      </ul>
    );
    /* ── L'ORDRE ET LES INTITULÉS DES BLOCS DU DOCUMENT (voir PUB_DOC_BLOCKS) ──
       Le format les porte (`docOrder` · `docTitles`) et le document les suit : les ▲▼
       et les champs du panneau « Publication format » suffisent donc à mettre les
       auteurs avant le titre, ou à appeler « Materials and Methods » autrement.
       Un format enregistré avant cette version n'en porte pas : normalizePubDocOrder ·
       normalizePubDocTitles rendent alors l'ordre et les intitulés du programme — le
       document ne bouge pas d'un caractère tant que rien n'est réglé. */
    const docOrder = normalizePubDocOrder(pubFormat && pubFormat.docOrder);
    const docTitles = normalizePubDocTitles(pubFormat && pubFormat.docTitles);
    /* UN INTITULÉ CACHÉ NE S'ÉCRIT PAS — le format le dit (`docNoTitle` : le style choisi,
       ou la case décochée au panneau), et le bloc sort alors sans son `<h2>`. La demande :
       « if in the style of science references have no title then the title tick must be
       unchecked in the “References (citation & bibliography)” section » : la bibliographie
       de Science suit donc le texte, sans intitulé au-dessus d'elle. */
    const docHeading = (id) => (pubDocTitleHidden(pubFormat, id) ? '' : pubDocTitleOf(docTitles, id));
    return (
      /* LA PAGE S'ADAPTE À LA LARGEUR DE L'ÉCRAN : le conteneur ne défile qu'en
         vertical (rien n'est coupé sur le côté), les marges se réduisent sur un
         téléphone, et le contenu du document se replie au lieu de déborder
         (voir les règles ci-dessous). */
      <div className="fixed inset-0 z-[60] bg-slate-100 overflow-y-auto overflow-x-hidden custom-scrollbar"
           ref={docPaneRef}>
        <style>{`
          .doc-ins { background: #dcfce7; color: #166534; text-decoration: none; }
          .doc-del { background: #fee2e2; color: #991b1b; text-decoration: line-through; }
          /* Les citations du texte : chaque [12] est un lien vers la référence
             imprimée plus bas (voir utils/referenceLinks.js). */
          .cite-ref { color: #2563eb; text-decoration: none; font-weight: 700; }
          .cite-ref:hover { text-decoration: underline; }
          li:target { background: #fef08a; }
          /* ── RIEN NE DÉBORDE DE LA PAGE (écran étroit) ──────────────────────
             Images et formules se réduisent, un tableau large défile DANS SON
             CADRE au lieu d'être coupé par la page, un mot très long se coupe. */
          #project-doc-container { overflow-wrap: break-word; }
          #project-doc-container img, #project-doc-container svg,
          #project-doc-container canvas, #project-doc-container video { max-width: 100%; height: auto; }
          #project-doc-container table { max-width: 100%; }
          #project-doc-container pre { max-width: 100%; overflow-x: auto; }
          @media (max-width: 640px) {
            #project-doc-container table { display: block; overflow-x: auto; }
            #project-doc-container h1 { font-size: 1.25rem; }
            #project-doc-container h2 { font-size: 0.95rem; }
          }
          /* ── LA MISE EN FORME DU DOCUMENT SUIT LE « PUBLICATION FORMAT » ────
             Police, taille, position (gauche / centré / droite / justifié),
             style (gras, italique, souligné) et couleur de chaque partie —
             figures comprises. La feuille est écrite par pubLayoutCss à partir
             du format du projet (« project.pubFormat », sinon le défaut) et
             elle est VIDE tant que rien n'a été choisi : le document garde
             alors exactement l'aspect du programme. Les règles visent les
             classes « .pf-… » posées ici et, en repli, les balises du document
             (un texte figé avant cette version n'a pas les classes). */
          ${pubLayoutCss(pubFormat, DOC_CONTAINER_SELECTOR)}
        `}</style>
        <div className={`w-full mx-auto px-2.5 py-3 sm:px-6 sm:py-5 md:px-8 md:py-8 ${docFull ? 'max-w-none' : 'max-w-4xl'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 no-print">
            <h2 className="text-lg font-black text-slate-800">📄 {project.name} — document</h2>
            <div className="flex flex-wrap items-center gap-2">
              {mmFeedback && <span className="text-[10px] font-bold text-emerald-600">{mmFeedback}</span>}
              {docMode === 'view' && (
                <>
                  <button onClick={startEditDoc}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100"
                          title="Edit the text of this document before printing">
                    ✏️ Edit text
                  </button>
                  <button onClick={startSuggestDoc}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-50 text-violet-700 border border-violet-300 hover:bg-violet-100"
                          title="Edit the text as a suggestion — changes are highlighted and can be accepted or rejected">
                    📝 Suggest edits
                  </button>
                </>
              )}
              {docMode === 'edit' && (
                <>
                  <button onClick={saveDocText}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                    💾 Save changes
                  </button>
                  <button onClick={() => setDocMode('view')}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
                    ✖ Cancel
                  </button>
                </>
              )}
              {docMode === 'suggest' && (
                <>
                  <button onClick={saveDocSuggestion}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                    💾 Save suggestion
                  </button>
                  <button onClick={() => setDocMode('view')}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
                    ✖ Cancel
                  </button>
                </>
              )}
              {/* ↩️ REBÂTIR LE TEXTE DU DOCUMENT DEPUIS LES DONNÉES DU PROJET.
                  Le bouton était caché tant que le document n'avait pas été
                  figé — l'utilisateur le cherchait et ne le trouvait pas (« there
                  is no such button “rebuilt from data” that you mentioned »).
                  Il est donc TOUJOURS là : il fait tomber le texte figé (les
                  corrections manuelles, d'où la confirmation), le texte des
                  sections est reconstruit depuis les données du projet et la
                  bibliographie reprend le « Publication format » courant. */}
              {canModify && (
                <button onClick={rebuildDoc}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200"
                        title={project.exportDocHtml
                          ? 'Discard the saved text edits and rebuild the document from the project data (the References then follow the current “Publication format”)'
                          : 'Rebuild the document text from the project data (nothing is frozen: the References already follow the current “Publication format”)'}>
                  ↩️ Rebuild from data{project.exportDocHtml ? ' (apply the format)' : ''}
                </button>
              )}
              <button onClick={printProjectDoc}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700">🖨️ Print / Save as PDF</button>
              <button onClick={exportProjectDocx}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700"
                      title="Download this document as a Word file (.docx): the text, the headings, the lists, the tables, the captions and the links keep their structure and their formatting. The pixels of the figures live in the Drive, not in the page, so they are not embedded — &quot;🖨️ Print / Save as PDF&quot; keeps them.">📄 Export to Word</button>
              <button onClick={() => setDocFull((v) => !v)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
                      title={docFull
                        ? 'Back to the reading column (Échap / Esc)'
                        : 'Read and write the document on the whole screen (the browser goes full screen too)'}>
                {docFull ? '↙️ Exit full screen' : '⛶ Full screen'}
              </button>
              <button onClick={() => setShowExport(false)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Close</button>
            </div>
          </div>
          {docMode === 'edit' && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3 no-print">
              ✏️ Edit mode: click any text to modify it. “💾 Save changes” keeps your edits in the document, “🖨️ Print” prints it as-is.
            </p>
          )}
          {/* CE QUE LE FICHIER WORD A EMPORTÉ : le compte des figures et, s'il y
              en a, celles qui n'ont pas pu être lues (leur légende reste dans le
              document). Un bandeau muet laisserait croire que tout est parti. */}
          {docxFeedback && (
            <p className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 mb-3 no-print">
              {docxFeedback}
            </p>
          )}
          {docMode === 'suggest' && (
            <p className="text-[10px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 mb-3 no-print">
              📝 Suggestion mode: edit the text freely. “💾 Save suggestion” does NOT change the document — it produces a
              reviewable version where additions are highlighted green and removals red. Accept or reject it below.
            </p>
          )}
          {project.docSuggestion && docMode === 'view' && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-violet-50 border border-violet-300 rounded-lg px-3 py-2 mb-3 no-print">
              <p className="text-[10px] font-bold text-violet-800">
                📝 Suggestion by {project.docSuggestion.author} · {new Date(project.docSuggestion.createdAt).toLocaleString()}
                {' — '}
                <span className="text-emerald-700 bg-emerald-100 rounded px-1">green = added</span>
                <span className="text-red-700 bg-red-100 rounded px-1 ml-1">red = removed</span>
              </p>
              <div className="flex gap-1.5">
                <button onClick={acceptSuggestion}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">✔ Accept suggestion</button>
                <button onClick={rejectSuggestion}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300">✖ Reject</button>
              </div>
            </div>
          )}

          <div id="project-doc-container"
               contentEditable={docMode !== 'view'}
               suppressContentEditableWarning
               className={`bg-white rounded-xl shadow-sm p-4 sm:p-6 md:p-10 text-slate-900 min-w-0 ${
                 docMode === 'edit' ? 'border-2 border-dashed border-amber-400 outline-none'
                   : docMode === 'suggest' ? 'border-2 border-dashed border-violet-400 outline-none'
                     : 'border border-slate-200'}`}>
            {project.docSuggestion && docMode === 'view' ? (
              <div dangerouslySetInnerHTML={{
                __html: docHeadSpacedHtml(withoutScreenOnlyUi(
                  repairContentImages(withoutBibliographySection(project.docSuggestion.markedHtml))
                ))
              }} />
            ) : project.exportDocHtml ? (
              /* La bibliographie FIGÉE du document enregistré est retirée : la
                 liste vivante imprimée en bas de ce document est rendue avec le
                 « Publication format » courant (voir withoutBibliographySection).
                 ⚠ ET L'ORDRE / LES INTITULÉS DU PANNEAU S'APPLIQUENT ICI AUSSI —
                 c'est précisément ce qui manquait : un document ENREGISTRÉ
                 (« 💾 Save changes ») affichait son instantané tel quel, donc les
                 ▲▼ du « Publication format » ne changeaient RIEN à la page du
                 projet. La demande, mot pour mot : « In the publication format even
                 if I change the order of the sections they do not affect the
                 document in the project. » `reorderDocHtml` déplace des blocs
                 ENTIERS (un <h2> et ce qui suit) : le texte de l'auteur n'est
                 jamais réécrit, et seuls les intitulés que le PROGRAMME a écrits
                 peuvent être renommés (voir pubDocTitleKeywords). L'ordre par
                 identifiant du document VIVANT, lui, reste plus fin (il déplace
                 aussi le titre, les auteurs, les affiliations) : il est rendu plus
                 bas, quand aucun texte n'a encore été figé.
                 LA TÊTE DU DOCUMENT FIGÉ REÇOIT LES MÊMES LIGNES VIDES que le document
                 vivant (voir docHeadSpacedHtml) : le titre, les auteurs et les
                 affiliations gardent, sur la page comme à l'impression, une ligne vide
                 entre eux — même dans un document enregistré avant cette règle. */
              <div dangerouslySetInnerHTML={{
                __html: docHeadSpacedHtml(reorderDocHtml(
                  /* LE DOCUMENT FIGÉ EST NETTOYÉ AUSSI À L'AFFICHAGE (voir
                     withoutScreenOnlyUi) : un instantané enregistré AVANT cette règle
                     porte encore les notes du programme et le bandeau du Drive — ils
                     sortent ici, pour la page comme pour ce qui en descend
                     (impression, PDF, .docx). */
                  withoutScreenOnlyUi(linkCitations(repairContentImages(withoutBibliographySection(project.exportDocHtml)))),
                  docOrderWords(pubFormat),
                  pubDocTitleKeywords(pubFormat),
                ))
              }} />
            ) : (() => {
              /* ── LES BLOCS DU DOCUMENT, DANS L'ORDRE CHOISI ─────────────────────
                 « In the publication format I cannot change the order of the sections
                 nor change the titles of the subsections. I want to be able for example
                 to put the author before the title or change the name of “materials and
                 methods” into “experimental section” or whatever. »
                 L'ordre et les intitulés vivent dans le format (`docOrder` ·
                 `docTitles`, voir PUB_DOC_BLOCKS) et sont rendus ICI, dans cet ordre :
                 le document vivant est la source de tout le reste — « 💾 Save changes »
                 le fige, « 🖨️ Print » le copie, l'export en descend — donc l'ordre et
                 les intitulés partent avec lui. Un bloc que le projet n'a pas (aucun
                 auteur enregistré, aucun test inclus) n'est simplement pas rendu ; les
                 autres gardent exactement le balisage qu'ils avaient. */
              const blocks = {};
              blocks.title = (
                <h1 key="title" className="pf-title text-2xl font-black text-slate-900 mb-1">
                  {project.paperTitle ? project.paperTitle : `📁 ${project.name}`}
                </h1>
              );
              if (project.paperAuthors) blocks.authors = (
                /* LES MARQUEURS D'AFFILIATION RESTENT DES EXPOSANTS, virgule
                   comprise : « Rossi¹,² » s'affiche « Rossi<sup>1,2</sup> » (voir
                   superscriptMarksHtml). La virgule entre deux affiliations était
                   en exposant dans le document, elle le reste ici — et le champ
                   enregistré, lui, n'est jamais réécrit (il reste éditable). */
                <p key="authors" className="pf-authors text-sm font-semibold text-slate-800 mb-1"
                   dangerouslySetInnerHTML={{ __html: superscriptMarksHtml(project.paperAuthors) }} />
              );
              if (project.paperAffiliations) blocks.affiliations = (
                <p key="affiliations" className="pf-affiliations text-[11px] text-slate-500 italic whitespace-pre-line mb-2"
                   dangerouslySetInnerHTML={{ __html: superscriptMarksHtml(project.paperAffiliations) }} />
              );
              blocks.meta = (
                <p key="meta" className="pf-meta text-xs text-slate-500 mb-6">
                  {project.paperTitle ? `Project: ${project.name} · ` : ''}Scientist: {project.scientist || '—'} · Created: {new Date(project.createdAt).toLocaleDateString()}
                </p>
              );

              /* …ET CELLES QUI ONT LEUR RANGÉE : chacune s'imprime à la place que le
                 format lui donne (`docOrder`), sous l'intitulé choisi dans le panneau —
                 « Conclusions » est le titre du programme tant que personne n'en écrit
                 un autre (voir docHeading). Les conclusions s'impriment toujours (elles
                 font partie du socle d'un article, comme avant) ; le financement et les
                 informations supplémentaires, eux, gardent la règle de la page : ils ne
                 s'impriment que remplis (voir OPTIONAL_TEXT_SECTION_IDS). */
              ownRowBlocks.forEach((s) => {
                const block = pubDocBlockOfSection(s.id);
                blocks[block.id] = renderSectionBlock(s, docHeading(block.id));
              });


              /* LA SECTION S'ÉCRIT SI ELLE A QUELQUE CHOSE À DIRE : les tests cochés
                 « Include » la remplissent, et le TEXTE DU PROJET la remplit aussi —
                 celui qu'on écrit à la main comme celui qu'un manuscrit importé dépose
                 dans « 📋 Materials & Methods » (l'import annonce, mot pour mot, que
                 « le document exporté l'imprime »). Elle était pourtant liée aux SEULS
                 tests cochés : un projet dont aucun test n'est coché n'écrivait AUCUNE
                 section « Materials and Methods », donc le texte enregistré ne se voyait
                 ni dans la page du projet, ni à l'impression, ni dans le PDF — « the
                 Materials and Methods section does not appear in the final document ». */
              const mmTextSaved = String((project.materialsAndMethods || {}).text || '').trim();
              if (includedExps.length > 0 || mmTextSaved) blocks.methods = (
                <div key="methods" className="mb-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-1 mb-2">
                    {docHeading('methods') ? (
                      <h2 className="pf-heading text-base font-black text-slate-800">{docHeading('methods')}</h2>
                    ) : null}
                  <div className="flex items-center gap-2 no-print">
                    {project.materialsAndMethods?.edited && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        ✏️ edited
                      </span>
                    )}
                    {mmFeedback && <span className="text-[10px] font-bold text-emerald-600">{mmFeedback}</span>}
                    <button type="button" onClick={() => regenerateMaterialsAndMethods()}
                            className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-lg px-2 py-1 shadow-sm transition-colors whitespace-nowrap"
                            title="Regenerate this section from the current Experimental Conditions, Instrumental Setup and Experiment Setup of the linked tests">
                      🔄 Update from tests
                    </button>
                  </div>
                </div>
                {/* LA NOTE EST UNE EXPLICATION DU PROGRAMME, PAS DU TEXTE : elle vit
                    à l'écran (`no-print`) et sort du document figé, de
                    l'impression, du PDF et du .docx — voir withoutScreenOnlyUi. */}
                <p className="text-[10px] text-slate-400 mb-3 no-print">
                  Automatically generated from the Experimental Conditions, Instrumental Setup and Experiment Setup
                  of each included test
                  {project.materialsAndMethods?.edited
                    ? ` · hand-edited ${project.materialsAndMethods.editedAt ? new Date(project.materialsAndMethods.editedAt).toLocaleString() : ''}`
                    : project.materialsAndMethods?.generatedAt
                      ? ` · last updated ${new Date(project.materialsAndMethods.generatedAt).toLocaleString()}`
                      : ''}.
                </p>
                <div className="pf-body flex flex-col gap-2">
                  {project.materialsAndMethods?.text ? (
                    String(project.materialsAndMethods.text).split('\n').filter(Boolean).map((para, i) => (
                      <p key={i} className="text-sm text-slate-800 text-justify leading-relaxed">{para}</p>
                    ))
                  ) : (
                    includedExps.map((exp) => {
                      const test = tests.find((t) => t.id === exp.testId);
                      if (!test) return null;
                      const text = buildMaterialsAndMethods(test, tabConfigForType(test.type));
                      return (
                        <p key={exp.id} className="text-sm text-slate-800 text-justify leading-relaxed">
                          <span className="font-black">{test.name || exp.label}:</span> {text}
                        </p>
                      );
                    })
                  )}
                  </div>
                </div>
              );

              if (includedExps.length > 0) blocks.experiments = (
                <div key="experiments" className="mb-6">
                  {docHeading('experiments') ? (
                    <h2 className="pf-heading text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">{docHeading('experiments')} ({includedExps.length})</h2>
                  ) : null}
                {/* Même règle que la note des « Materials and Methods » : l'aide du
                    programme ne fait pas partie du document (voir withoutScreenOnlyUi). */}
                <p className="text-[10px] text-slate-400 mb-3 no-print">
                  Only the figures, plots and tables you ⭐-starred on the test pages are imported here.
                  Click the ✏️ next to a caption to edit it before export.
                </p>
                {includedExps.map((exp) => {
                  const test = tests.find((t) => t.id === exp.testId);
                  if (!test) return null;
                  const stars = getStarredItems(test);
                  let figCount = 0;
                  return (
                    <div key={exp.id} className="mb-6 border-b border-slate-100 pb-4">
                      <h3 className="pf-heading text-sm font-black text-slate-800 flex flex-wrap items-center gap-2">
                        <button onClick={() => { setShowExport(false); openTest(test.id); }}
                                className="hover:text-blue-600 hover:underline text-left">
                          {exp.label}: {test.name}
                        </button>
                        <span className="text-[10px] font-bold text-violet-700 bg-violet-50 rounded-full px-2 py-0.5">📁 {project.name}</span>
                      </h3>
                      <p className="text-[11px] text-slate-500 mb-2">
                        📅 {test.date || '—'} · 🧪 {[test.operator, ...(test.coScientists || [])].filter(Boolean).join(', ') || '—'}
                        {' · '}⭐ {stars.length} item{stars.length === 1 ? '' : 's'}
                      </p>
                      {stars.length === 0 ? (
                        <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3">
                          No items starred yet — open this test and press the ⭐ button on the figures, plots or tables
                          you want to import into the document.
                        </p>
                      ) : (
                        stars.map((s) => {
                          figCount += 1;
                          const key = `${test.id}:${s.id}`;
                          return renderStarredItem(s, test, {
                            figLabel: `Figure ${figCount}`,
                            testType: testTypeLabel(test.type),
                            captionOverride: captionOverrides[key],
                            editKey: capEditKey,
                            onEditCaption: openCaptionEditor,
                            renderCaptionEditor
                          });
                        })
                      )}
                    </div>
                  );
                })}
                </div>
              );

              /* L'ORDRE CHOISI, ET RIEN D'AUTRE : un bloc que le projet n'a pas n'est
                 pas rendu, les autres gardent exactement le balisage qu'ils avaient.
                 La liste des références, elle, est imprimée à la fin du document (voir
                 sa note ci-dessous) : elle ne se déplace pas, son intitulé se règle. */
              return docHeadRows(docOrder, (id) => !!blocks[id]).map((id, i) => (
                /* LA LIGNE VIDE DE LA TÊTE — « in the final document the list of
                   authors must be separated by the title with one empty line. an empty
                   line must also separate the authors from the affiliations. » Elle est
                   rendue ici, ENTRE deux blocs de tête voisins, dans l'ordre que
                   l'utilisateur a réglé (voir docHeadRows) : c'est un vrai paragraphe
                   vide, donc l'impression, le PDF et le .docx l'emportent (voir
                   docHeadSpacedHtml, qui la récrit sur le HTML exporté). */
                id === DOC_EMPTY_LINE_ID
                  ? <div key={`${DOC_EMPTY_LINE_ID}-${i}`} className={DOC_EMPTY_LINE_CLASS}
                         aria-hidden="true">&nbsp;</div>
                  : (blocks[id] || null)
              ));
            })()}

            {/* ── LA LISTE DES RÉFÉRENCES EST TOUJOURS VIVANTE ────────────────
                Elle est rendue ICI, HORS du texte figé : « ✏️ Edit text » →
                « 💾 Save changes » fige le texte du document (corrections de
                l'auteur comprises) et, avec lui, la liste des références telle
                qu'elle était ce jour-là. Le « Publication format » choisi depuis
                ne s'y voyait donc JAMAIS — la plainte exacte : « le publication
                format ne modifie pas le format des références dans le texte du
                projet ». Le document figé est maintenant affiché sans sa propre
                bibliographie (voir withoutBibliographySection) et la liste des
                références du projet, rendue avec le format COURANT à chaque
                affichage, est imprimée à sa place. */}
            {/* L'INTITULÉ DE LA BIBLIOGRAPHIE EST CELUI DES AUTRES SECTIONS — sans
                compteur. La demande : « the references should behave like the other
                sections and not have a tick display reference title (the number of
                references in parentheses is not professional) » : le document écrivait
                « References (24) », un nombre entre parenthèses qui n'appartient à aucun
                article ; les autres sections du document n'ont jamais porté le leur
                (« Experiments (3) » reste, lui, la liste des tests inclus, et il n'est pas
                l'objet de cette demande). La place de la liste, son texte et ses figures ne
                changent pas : seul l'intitulé est celui du programme ou celui réglé dans
                « Document sections (order & titles) ». */}
            <div className="mb-4">
              {docHeading('references') ? (
                <h2 className="pf-heading text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">{docHeading('references')}</h2>
              ) : null}
              {/* LE TEXTE EST AUSSI DANS LE DOSSIER DU PROJET SUR LE DRIVE (voir
                  utils/projectDocumentDrive.js) : la page le dit et sait le
                  relire — le navigateur n'est qu'un cache, et un autre poste
                  retrouve le texte sans passer par une sauvegarde HTML. */}
              {/* …ET LE BANDEAU QUI LE DIT EST DE L'INTERFACE, PAS DU TEXTE : il
                  porte `no-print` (voir withoutScreenOnlyUi) — « ☁ Text filed on
                  Drive … ♻ Load the Drive copy » se lit à l'écran et ne part ni dans
                  le document figé, ni à l'impression, ni dans le .docx. */}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1.5 no-print">
                {project.driveDocument && project.driveDocument.id ? (
                  <>
                    <span className="font-bold">☁ Text filed on Drive</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {project.driveDocument.folder}/{project.driveDocument.name}
                    </span>
                    {project.driveDocument.url && (
                      <a href={project.driveDocument.url} target="_blank" rel="noreferrer"
                         className="font-bold text-sky-700 hover:underline">open</a>
                    )}
                    <button type="button" onClick={loadProjectDriveCopy} disabled={!!(msResult && msResult.driveBusy)}
                            className="ml-auto px-2.5 py-1 text-[10px] font-bold rounded-lg bg-white border border-sky-300 text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                            title="Read the archived copy of this project's text from its Drive folder and put it back into the page (text sections, head, bibliography and numbered references). Nothing is applied before this click.">
                      {msResult && msResult.driveBusy ? '⏳ Reading…' : '♻ Load the Drive copy'}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-bold">☁ The text of this project is not filed on Drive yet</span>
                    <span className="text-[10px] text-slate-500">
                      (this browser holds it — a full browser quota or another computer would lose the text)
                    </span>
                    <button type="button" onClick={saveProjectDriveCopy} disabled={!!(msResult && msResult.driveBusy)}
                            className="ml-auto px-2.5 py-1 text-[10px] font-bold rounded-lg bg-white border border-sky-300 text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                            title="Write the text of this project into Lab Workspace/&lt;dataset&gt;/projects/&lt;project&gt;/&lt;project&gt;_document.json on Google Drive.">
                      {msResult && msResult.driveBusy ? '⏳ Filing…' : '☁ File the text on Drive'}
                    </button>
                  </>
                )}
              </div>
              {refs.length === 0 ? <p className="text-xs italic text-slate-400">No references.</p> : (
                /* La liste est TRIÉE par numéro et chaque entrée porte son numéro
                   réel (`value`) : le « [12] » du texte tombe donc toujours sur
                   la bonne référence, même quand les numéros ne se suivent pas.
                   `id="ref-12"` = l'ancre sur laquelle le lien du texte arrive. */
                <ol className="pf-bib list-decimal pl-5 text-sm text-slate-800 space-y-1">
                  {[...refs].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)).map((r) => {
                    const number = Number(r.number) || 0;
                    return (
                      <li key={r.id}
                          id={number ? citationAnchorId(number) : undefined}
                          value={number || undefined}
                          dangerouslySetInnerHTML={{
                            __html: pubCitationHtml(citeData(r), pubFormat, operatorNames) || r.title
                          }} />
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---- Coworkers chips (shown in the project header, next to the owner) ----
  const renderCoworkers = () => {
    const userList = (operatorNames || []).filter((n) => String(n).trim());
    const ownerInList = project.scientist && !userList.includes(project.scientist);
    const shownUsers = [...new Set([...userList, ...(ownerInList ? [project.scientist] : [])])]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">👥 Coworkers:</span>
        {shownUsers.length === 0 ? (
          <span className="text-[10px] italic text-slate-400">No users in the list yet — add them in Settings → Scientists &amp; Operators.</span>
        ) : (
          shownUsers.map((u) => {
            const isOwnerName = u === project.scientist;
            const perm = isOwnerName ? 'owner' : (authList.find((c) => c.name === u)?.permission || 'none');
            const disabled = !isOwner || isOwnerName;
            return (
              <div key={u} className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${
                perm === 'owner' ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : perm !== 'none' ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white text-slate-600 border-slate-300'
              } ${disabled ? 'opacity-70' : ''}`}>
                <span>{isOwnerName ? '👑 ' : ''}{u}</span>
                {disabled ? (
                  <span className="text-[9px] uppercase">{perm === 'owner' ? 'owner' : (perm === 'modify' ? 'modify' : (perm === 'view' ? 'view' : '—'))}</span>
                ) : (
                  <select
                    value={perm}
                    onChange={(e) => setCoworkerPermission(u, e.target.value === 'none' ? '' : e.target.value)}
                    className="bg-transparent text-[10px] font-bold outline-none cursor-pointer"
                    title={`Permission of ${u} — view = read-only, modify = can edit`}
                  >
                    <option value="none">none</option>
                    <option value="view">view</option>
                    <option value="modify">modify</option>
                  </select>
                )}
              </div>
            );
          })
        )}
        {isOwner && <span className="text-[10px] text-slate-400">(owner &amp; superusers always have full access)</span>}
      </div>
    );
  };

  // ---- Comments & review section ----
  const renderCommentsSection = () => {
    return (
      <SectionCard title="💬 Comments & review"
                   open={openSections.comments} onToggle={() => toggleSection('comments')}
                   badge={<span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${openComments ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                     {openComments} open
                   </span>}>
        {/* Composer */}
        {isAuthorized ? (
          <div className="mb-4">
            <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
                      rows="2" placeholder="Write a comment or question…"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
            <div className="flex justify-end mt-1.5">
              <button onClick={addComment} disabled={!commentDraft.trim()}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                💬 Add comment
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3 mb-4 text-center">
            {currentUser
              ? '🔒 You are not authorized to comment on this project. Ask the project owner to add you to “Authorized people”.'
              : '🔒 Log in to comment on this project.'}
          </p>
        )}

        {/* Thread */}
        {comments.length === 0 ? (
          <p className="text-xs italic text-slate-400 text-center bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3">
            No comments yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {comments.map((c) => (
              <div key={c.id} className={`bg-white border rounded-lg p-3 ${c.resolved ? 'border-slate-200 opacity-70' : 'border-slate-300'}`}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-blue-800">👤 {c.author}</span>
                  <span className="text-[10px] text-slate-400">{new Date(c.createdAt).toLocaleString()}</span>
                  {c.resolved
                    ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">✔ Resolved</span>
                    : <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">● Open</span>}
                  {isAuthorized && (
                    <span className="ml-auto flex gap-1.5">
                      <button onClick={() => toggleResolve(c.id)}
                              className={`text-[10px] font-bold rounded px-2 py-0.5 border transition-colors ${c.resolved ? 'text-amber-600 border-amber-200 hover:bg-amber-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}`}>
                        {c.resolved ? '↩ Re-open' : '✔ Resolve'}
                      </button>
                      <button onClick={() => setOpenReplyId(openReplyId === c.id ? null : c.id)}
                              className="text-[10px] font-bold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded px-2 py-0.5">
                        💬 Reply
                      </button>
                      {(isSuper || c.author === myName || project.scientist === myName) && (
                        <button onClick={() => deleteComment(c.id)}
                                className="text-[10px] font-bold text-red-500 border border-red-200 hover:bg-red-50 rounded px-2 py-0.5"
                                title="Delete comment">✕</button>
                      )}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{c.text}</p>

                {openReplyId === c.id && isAuthorized && (
                  <div className="mt-2">
                    <textarea autoFocus rows="2" value={replyDrafts[c.id] || ''}
                              onChange={(e) => setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                              placeholder={`Reply to ${c.author}…`}
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
                    <div className="flex justify-end gap-1.5 mt-1">
                      <button onClick={() => setOpenReplyId(null)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300">Cancel</button>
                      <button onClick={() => addReply(c.id)} disabled={!(replyDrafts[c.id] || '').trim()}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">Send reply</button>
                    </div>
                  </div>
                )}

                {(c.replies || []).length > 0 && (
                  <div className="mt-2.5 ml-3 pl-3 border-l-2 border-slate-200 flex flex-col gap-2">
                    {c.replies.map((r) => (
                      <div key={r.id} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                        <div className="flex flex-wrap items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-bold text-slate-700">↪ {r.author}</span>
                          <span className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-slate-700 whitespace-pre-wrap">{r.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    );
  };


  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto custom-scrollbar bg-slate-50">
      <div className={`${wideLayout ? 'max-w-none' : 'max-w-5xl'} mx-auto flex flex-col gap-4 pb-10`}>

        {/* ---------- Header ---------- */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={backToList} title="Back to Projects"
                      className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm">←</button>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-slate-800 truncate">📁 {project.name}</h2>
                <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">
                  👤 {project.scientist || 'Unassigned'}
                  {isSuper && <span className="ml-2 text-amber-600">👑 superuser</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 no-print">
              <button onClick={() => setCurrentModule('projects')}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                Projects list
              </button>
              {canModify && (
                <button onClick={() => openManuscriptImport()}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700"
                        title="Move a document written in Google Docs or Word INTO this project: its text fills the project sections (Background / Results and Discussion / Conclusions), its bibliography (Paperpile…) goes to the Project bibliography, and its citations become the numbered references [1], [2]… Nothing is uploaded to Drive.">
                  📥 Import a manuscript
                </button>
              )}
              <button onClick={() => setShowExport(true)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                      title="Export the project as a text document (includes figures and text of the tests marked for inclusion)">
                📄 Export document
              </button>
              {/* La largeur de la page ne change QUE sur ce clic : ni le fait de
                  cliquer dans un texte, ni un clic sur un bouton ne doivent
                  déplacer la page (chaque déplacement faisait perdre le clic en
                  cours et il fallait cliquer deux fois — voir wideLayout). */}
              <button onClick={() => setWideLayout((v) => !v)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                      title={wideLayout
                        ? 'Back to the normal, centred page width'
                        : 'Wide editing: use the full width of the window for the sections below. The width only ever changes here — working in a text or clicking a button never moves the page.'}>
                {wideLayout ? '⤡ Normal width' : '⤢ Wide editing'}
              </button>
              {isOwner && (
                <button onClick={() => setConfirmDelete(true)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-50 text-red-500 hover:bg-red-100">
                  Delete project
                </button>
              )}
            </div>
          </div>
          <input className={inputCls} value={project.name}
                 onChange={(e) => updateProject({ name: e.target.value })}
                 readOnly={!canModify}
                 onFocus={() => { projectNameBeforeEditRef.current = project.name; }}
                 onBlur={() => {
                   const before = projectNameBeforeEditRef.current;
                   // Rename the Drive folder even when the old name was EMPTY
                   // (never skip '').
                   if (before !== null && before !== project.name) {
                     renameDriveFilesFor({ field: 'project', oldValue: before, newValue: project.name }).catch(() => {});
                     /* Le DOCUMENT du projet (<projet>_document.json) est
                        renommé avec son dossier : sans cela, deux copies du
                        texte cohabiteraient et un autre poste pourrait relire
                        l'ancienne. */
                     mirrorRenameProject({
                       datasetId: project.datasetId || '',
                       datasetName: getDriveRootName(),
                       oldName: before,
                       newName: project.name
                     }).catch(() => null);
                   }
                   projectNameBeforeEditRef.current = null;
                 }}
                 placeholder="Project name" />
          {canSee && !isOwner && (
            <div className={`text-[10px] rounded-lg px-3 py-1.5 border ${
              canModify ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              {canModify
                ? '✏️ You are a coworker with modify permission — you can edit this project.'
                : '👁 You have view-only access to this project — editing is disabled.'}
            </div>
          )}
          {!isSuper && currentUser && isOwner && (
            <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              🧪 You are editing your own project. Superusers see all projects and can filter by scientist.
            </div>
          )}

          {/* Coworkers (view / modify) — next to the owner */}
          <div className="flex flex-col gap-1 pt-2 mt-1 border-t border-slate-100">
            {renderCoworkers()}
          </div>
        </div>

        {/* ---------- Écriture refusée par le navigateur (quota plein) ---------- */}
        {storageWarning && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
            {storageWarning}
          </div>
        )}

        {/* ---------- Écriture SAUVÉE : de la place a été faite ----------
            Le magasin du navigateur était plein (ou presque) : l'écriture est
            passée en allégeant des copies d'images (voir saveProjectsRescued).
            Le texte, les références et la mise en page n'ont pas bougé — on le
            dit, et on dit ce qui est parti, pour que rien ne soit silencieux. */}
        {storageNote && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
            <span className="flex-1">
              <b>🧹 Saved — room had to be made in this browser’s store.</b> {storageNote}
            </span>
            <button type="button" onClick={() => setStorageNote('')}
                    className="shrink-0 font-bold text-amber-700 hover:text-amber-900"
                    title="Hide this note — the change is saved either way.">✕</button>
          </div>
        )}

        {/* ---------- Compte rendu du dernier import de manuscrit ----------
            La fenêtre d'import se ferme dès que l'import est écrit : le compte
            rendu — et le verdict du magasin — sont ICI, en haut de la page, avec
            « ↩︎ Undo import » pour revenir à l'état d'avant. Un import NON
            enregistré (quota plein) est impossible à manquer. */}
        {msResult && (
          <div className={`rounded-xl border p-3 flex flex-col gap-1.5 ${
            msResult.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-300'
          }`}>
            <div className="flex items-start justify-between gap-2">
              <span className={`text-xs font-black uppercase tracking-wide ${
                msResult.ok ? 'text-emerald-800' : 'text-red-700'
              }`}>
                📥 Manuscript import — {msResult.ok ? 'done' : 'NOT SAVED'}
              </span>
              <span className="flex items-center gap-1.5">
                {msResult.drive && msResult.drive.id && (
                  <button type="button" onClick={loadProjectDriveCopy} disabled={!!msResult.driveBusy}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                          title="Read the copy filed in this project's Drive folder and put it into the page (text, head, bibliography, numbered references).">
                    {msResult.driveBusy ? '⏳ Reading from Drive…' : '♻ Load the Drive copy'}
                  </button>
                )}
                {msResult.undoProject && (
                  <button type="button" onClick={undoManuscriptImport}
                          className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                          title="Put the project back exactly as it was before this import (text, references and bibliography).">
                    ↩︎ Undo import
                  </button>
                )}
                <button type="button" onClick={() => setMsResult(null)}
                        className={`text-sm px-1 ${msResult.ok ? 'text-emerald-600' : 'text-red-500'} hover:opacity-70`}
                        title="Hide this report">
                  ✕
                </button>
              </span>
            </div>
            {(msResult.lines || []).map((line, i) => (
              <p key={i} className={`text-[11px] leading-relaxed ${
                msResult.ok ? 'text-emerald-900' : 'text-red-800'
              }`}>{line}</p>
            ))}
          </div>
        )}

        {/* ---------- Title, authors & affiliations of the paper ---------- */}
        {/* ---------- Experiment planner ---------- */}
        <SectionCard title="🧪 Experiment planner" open={openSections.experiments} onToggle={() => toggleSection('experiments')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{(project.experiments || []).length}</span>}>
          <p className="text-xs text-slate-500 mb-3">
            Plan as many tests as needed (NMR, ssNMR, DOSY, CD, plate assays, cloning, expression…). Clicking a test
            type creates the classic test page and makes its button appear inside the collapsible window below —
            each button is the link to that test page.
          </p>
          {canModify && (
          <div className="flex flex-wrap gap-1.5">
            {TEST_TYPE_OPTIONS.map((opt) => (
              <button key={opt.type} type="button" onClick={() => addExperiment(opt.type)}
                      className={`px-3 py-1.5 text-xs font-bold text-white rounded-lg transition-colors ${opt.color}`}>
                + {opt.label}
              </button>
            ))}
          </div>
          )}
          {canModify && linkableTestNames.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-black uppercase tracking-wide text-slate-400">Link existing test:</label>
              <select value={linkTestId} onChange={(e) => setLinkTestId(e.target.value)}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700 max-w-xs">
                <option value="">Choose a test…</option>
                {linkableTestNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button onClick={linkExistingTest} disabled={!linkTestId}
                      className="px-3 py-1 text-xs font-bold rounded-lg bg-slate-600 text-white hover:bg-slate-700 disabled:opacity-40">
                + Link
              </button>
            </div>
          )}
        </SectionCard>


        {/* ---------- Experiments: collapsible window with the added tests ---------- */}
        <SectionCard title="🧪 Experiments in this project" open={openSections.expWindow} onToggle={() => toggleSection('expWindow')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{experimentsGrouped(project.experiments, tests).length}</span>}>
          {(project.experiments || []).length === 0 ? (
            <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">
              No experiments yet — click a test type above to add the first one. Its button will appear here as a link
              to the classic test page.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {experimentsGrouped(project.experiments, tests).map((group) => {
                const exp = group.entries[0];
                const test = exp.testId ? tests.find((t) => t.id === exp.testId) : null;
                const allIncluded = group.entries.every((e) => e.includeInDocument);
                const starCount = group.entries.reduce((s, e) => {
                  const t = e.testId ? tests.find((x) => x.id === e.testId) : null;
                  return s + (t ? getStarredItems(t).length : 0);
                }, 0);
                const condCount = group.entries.length;
                return (
                  <div key={group.entries.map((e) => e.id).join('|')}
                       className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-2 hover:border-blue-300 hover:shadow-sm transition-shadow">
                    <button onClick={() => openTest(exp.testId)}
                            className="flex items-center gap-2 min-w-0 text-left">
                      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-white bg-blue-600 rounded px-2 py-1">
                        {exp.label}
                      </span>
                      <span className="text-xs font-bold text-slate-700 truncate">
                        {test?.name || group.name || 'Test'}
                      </span>
                      {condCount > 1 && (
                        <span className="text-[10px] font-semibold text-slate-400 whitespace-nowrap"
                              title={`${condCount} condition instance(s) of this experiment`}>
                          ({condCount} conditions)
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 hidden md:inline">📅 {test?.date || '—'}</span>
                    </button>
                    {canModify && (
                      <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer"
                             title="Include this test in the exported project document (its ⭐-starred figures, plots and tables)">
                        <input type="checkbox" checked={allIncluded} onChange={() => toggleIncludeGroup(group)}
                               className="w-3.5 h-3.5 accent-blue-600" />
                        Include
                      </label>
                    )}
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap"
                          title="Items ⭐-starred on the test pages that will be imported into the document">
                      ⭐ {starCount}
                    </span>
                    {canModify && (
                      <button onClick={() => removeExperiment(exp.id)}
                              className="shrink-0 text-red-400 hover:text-red-600 text-xs px-1.5" title="Remove from project">
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="🧾 Title, authors & affiliations"
                     open={openSections.article} onToggle={() => toggleSection('article')}
                     badge={(project.paperTitle || project.paperAuthors) ? (
                       <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">filled</span>
                     ) : null}>
          <p className="text-xs text-slate-500 mb-3">
            The header of the paper this project is about — its <span className="font-bold">title</span>, the
            <span className="font-bold"> full author list</span> (in the order of the paper) and the
            <span className="font-bold"> affiliations</span> behind each author.
            “📥 Import a manuscript” fills these three fields from the first lines of the document, and
            “📄 Export document” prints them at the top of the exported document. Nothing here is sent to Drive.
          </p>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Title</span>
              <input className={inputCls} value={project.paperTitle || ''} readOnly={!canModify}
                     onChange={(e) => updateProject({ paperTitle: e.target.value })}
                     placeholder="Title of the paper — filled by “📥 Import a manuscript”" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Authors</span>
              <input className={inputCls} value={project.paperAuthors || ''} readOnly={!canModify}
                     onChange={(e) => updateProject({ paperAuthors: e.target.value })}
                     placeholder="All the authors, in order (Rossi M, Bianchi A, Dupont J…)" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Affiliations</span>
              <textarea className={`${inputCls} text-xs`} rows={3} value={project.paperAffiliations || ''} readOnly={!canModify}
                        onChange={(e) => updateProject({ paperAffiliations: e.target.value })}
                        placeholder={'One affiliation per line, numbered as in the author list\n1 Dipartimento di Agraria, Università di Napoli Federico II, Portici, Italy'} />
            </label>
          </div>
        </SectionCard>

        {/* ---------- Saved Image Builder canvases (links back into the editor) ---------- */}
        <SectionCard title="🖼 Saved canvases" open={openSections.canvases} onToggle={() => toggleSection('canvases')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{savedCanvases.length}</span>}>
          <p className="text-xs text-slate-500 mb-3">
            Compositions stored in this project's image library — with <span className="font-bold">💾 Save now</span> (the
            dialog asks which project owns the canvas: pick this one) or by <span className="font-bold">📤 Insert into project…</span>.
            Every canvas below is also an image of the library (🖼 Library in the Image Builder →
            <span className="font-bold"> Project Library</span> tab)
            and a <span className="font-bold">link</span> back into the editor: “Open in Image Builder” reloads its panels, captions
            and grid, and saving it again updates this same entry. A composition inserted into a section keeps showing its
            <span className="font-bold"> image</span> there — the link is added on top, it never replaces the picture.
            A canvas saved by an older version could be stored <span className="font-bold">several times</span>: the
            <span className="font-bold"> 🧹 Remove duplicate canvases</span> button below merges those copies — the most
            recent composition of each canvas wins, and nothing is deleted from Google Drive.
            If a canvas vanished from this browser (a forced refresh while its composition was too big for the browser
            store), <span className="font-bold">📥 Restore a canvas file</span> brings it back from the
            <span className="font-bold"> &lt;image&gt;.meta.json</span> that sits next to its image on Google Drive — no
            list, no timestamp, no cloud connection needed: the file <span className="font-bold">is</span> the composition.
            <span className="font-bold"> ✏️ Rename</span> on a card renames that canvas AND its file on Drive (the same file takes the new name, so the
            figures that link to it keep working); canvases can also be
            renamed in the Image Builder — its toolbar’s <span className="font-bold">✏️ Rename</span> button, and the
            <span className="font-bold"> ✎</span> button on a thumbnail in the <span className="font-bold">🖼 Library</span> modal).
          </p>
          {/* The figure FILES are on Drive; this browser holds the LIST that shows
              them. These two buttons are the same additive gestures as in the
              Image Library modal, reachable from the project page too. */}
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px]">
            <span className="text-slate-500">
              Figures on <span className="font-bold">Google Drive → {projectImagesFolderLabel(project.name || '', getDriveRootName())}</span>
            </span>
            <button type="button" onClick={() => addMissingFiguresFromDrive()} disabled={figDriveBusy}
                    className="font-bold px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    title="Read this project’s images folder on Drive and ADD the figures it holds but this list does not show (another computer, figures uploaded by a coworker). Nothing is deleted or replaced. The folder is SEARCHED (shared registry, then its name, then the closest project folder) — it is never created, so a renamed project folder no longer produces an empty twin beside your files.">
              {figDriveBusy ? '⏳ Working…' : '⬇ Add missing figures from Drive'}
            </button>
            {canModify && (
              <button type="button" onClick={saveFiguresToDrive} disabled={figDriveBusy}
                      className="font-bold px-2.5 py-1 rounded-lg border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                      title="Send to Google Drive the figures of this project whose pixels are still only in this browser (they would not follow you on another computer). Nothing is deleted.">
                ☁ Save figures to Drive
              </button>
            )}
            {canModify && canvasDupCount > 0 && (
              <button type="button" onClick={cleanCanvasDuplicates}
                      className="font-bold px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      title="The automatic save of the Image Builder used to add one entry per pass once it had lost track of the canvas: this removes the extra copies. The most recent composition of each canvas is kept, along with every entry a figure of this page points at. Nothing is deleted from Google Drive.">
                🧹 Remove {canvasDupCount} duplicate canvas cop{canvasDupCount === 1 ? 'y' : 'ies'}
              </button>
            )}
            {canModify && (
              <>
                <button type="button" onClick={() => { if (canvasFileRef.current) canvasFileRef.current.click(); }}
                        disabled={canvasRestoreBusy}
                        className="font-bold px-2.5 py-1 rounded-lg border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                        title="Lost a canvas (browser refresh, empty store, another computer)? Pick the “<image>.meta.json” file that sits NEXT TO its image on Google Drive: its composition — panels, figures, letters, captions, grid, arrows — comes back into this project’s library, where “🖼 Open in Image Builder” can reopen it. The panels are compressed so the composition fits the browser store; the full-size file stays on Drive and “💾 Save now” re-uploads the image.">
                  {canvasRestoreBusy ? '⏳ Restoring…' : '📥 Restore a canvas file'}
                </button>
                <input ref={canvasFileRef} type="file" accept=".json,application/json" className="hidden"
                       onChange={(e) => {
                         const f = e.target.files && e.target.files[0];
                         e.target.value = '';
                         restoreCanvasFromFile(f);
                       }} />
              </>
            )}
            {figDriveMsg && (
              <span className="font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">{figDriveMsg}</span>
            )}
          </div>
          {/* LE DOSSIER D'IMAGES EST DÉRIVÉ DU NOM DU PROJET : quand il a été
              renommé (ou renommé à la main sur le Drive), les fichiers sont
              restés dans l'ancien dossier. Plutôt que de deviner — ou de créer un
              dossier vide à côté — on MONTRE les dossiers de projet du dataset
              avec leur contenu : lire le bon le retient pour ce projet, et les
              envois suivants y vont aussi (voir utils/figuresFolder.js). */}
          {figFolderChoices.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mb-3 text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              <span className="font-bold text-amber-800">
                📁 Other folders of this dataset on Drive (choose the one holding your figures):
              </span>
              {figFolderChoices.slice(0, 10).map((c) => (
                <button key={c.folderId || c.name} type="button" disabled={figDriveBusy}
                        onClick={() => addMissingFiguresFromDrive(c.name)}
                        className="font-bold px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        title={`Read “projects/${c.name}/images” on Drive (${c.files} file(s), ${c.sidecars} editable composition(s)) and make it THIS project’s images folder. Nothing is deleted; the figures it holds are ADDED to this list.`}>
                  {c.name} ({c.files})
                </button>
              ))}
              <button type="button" onClick={() => setFigFolderChoices([])}
                      className="px-1.5 py-0.5 rounded border border-amber-200 bg-white text-amber-700 hover:bg-amber-100"
                      title="Hide this list (it comes back the next time a Drive read finds no folder for this project).">
                ✕
              </button>
            </div>
          )}
          {savedCanvases.length === 0 ? (
            <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-5 text-center">
              No canvas yet — in the Image Builder (sidebar → 🖼️ Image Builder) click “💾 Save now” and choose
              <span className="font-bold"> this project</span> as the project that owns it, or insert a composition with
              “📤 Insert into project…”: it appears here and in the image library's Project tab.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {savedCanvases.map((c) => (
                <div key={c.id} className="bg-slate-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
                  <div className="bg-white border border-slate-200 rounded-lg h-28 flex items-center justify-center overflow-hidden">
                    {canvasPreviewOf(c)
                      ? <img src={canvasPreviewOf(c)} alt={c.label || 'Canvas'} className="max-h-28 max-w-full object-contain"
                             title="Preview of this canvas — the rendered image when this browser has it, otherwise the first panel of its saved composition" />
                      : <span className="text-[10px] italic text-slate-400 text-center px-2"
                              title="This canvas holds its panels but no picture this browser can draw — open it (🖼 Open in Image Builder) and click “💾 Save now” to write its rendered image">composition only — 🖼 open it</span>}
                  </div>
                  <span className="text-xs font-bold text-slate-700 truncate" title={c.label || 'Canvas'}>{c.label || 'Canvas'}</span>
                  <span className="text-[10px] text-slate-400">
                    saved {new Date(c.updatedAt || c.addedAt || Date.now()).toLocaleString()}
                    {c.drive ? ' · ☁ on your cloud' : ''}
                  </span>
                  <div className="flex items-center gap-1.5 mt-auto">
                    <button type="button"
                            onClick={() => { if (typeof openImageBuilder === 'function') openImageBuilder(project.id, c.id); }}
                            className="flex-1 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 px-2 py-1.5"
                            title="Reopen this canvas in the Image Builder (this project) — the editor loads the saved panels, captions and grid">
                      🖼 Open in Image Builder
                    </button>
                    {canModify && (
                      <button type="button" onClick={() => renameCanvas(c)}
                              className="text-slate-600 hover:text-slate-800 border border-slate-200 bg-white rounded-lg px-2 py-1.5 text-xs font-bold"
                              title="Rename this canvas — the name is what this page, the image library and the “✏️ Modify in Image Builder” links show. The figures that point at it follow, and the file already on Drive is renamed with it (same file, same link — nothing is left behind under the old name). If the cloud is not connected, the next “💾 Save now” names the image that way; if this browser’s store is full the write is refused and the message above says so.">✏️ Rename</button>
                    )}
                    {canModify && (
                      <button type="button" onClick={() => removeCanvasLink(c.id)}
                              className="text-red-400 hover:text-red-600 border border-red-200 bg-red-50 rounded-lg px-2 py-1.5 text-xs font-bold"
                              title="Remove this canvas from the project image library (the cloud/Drive copy is kept)">🗑</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ---------- Scientific background ---------- */}
        {textSection('background', '🔬 Scientific background',
          'Rationale, state of the art, hypotheses and aims of the project.',
          project.background || '', (val) => updateProject({ background: val }))}


        {/* ---------- Materials and Methods ---------- */}
        <SectionCard title="📋 Materials and Methods" open={openSections.materials} onToggle={() => toggleSection('materials')}
                     badge={<span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${project.materialsAndMethods?.edited ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{mmPartsFor(project, tests, false).length}</span>}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[10px] text-slate-400 flex-1 min-w-[220px]">
              {project.materialsAndMethods?.edited
                ? `✏️ Hand-edited text used in the export document${project.materialsAndMethods.editedAt ? ' — ' + new Date(project.materialsAndMethods.editedAt).toLocaleString() : ''}.`
                : 'Auto-generated from the Experimental Conditions, Instrumental Setup and Experiment Setup of the linked tests.'}
              {!project.materialsAndMethods?.edited && project.materialsAndMethods?.generatedAt
                ? ` Last updated ${new Date(project.materialsAndMethods.generatedAt).toLocaleString()}.`
                : ''}
            </p>
            <div className="flex items-center gap-2">
              {mmFeedback && <span className="text-[10px] font-bold text-emerald-600">{mmFeedback}</span>}
              {canModify && (
                <>
                  <button type="button"
                          onClick={() => { setMmEditOpen(true); setMmDraft(project.materialsAndMethods?.text || mmPartsFor(project, tests, false).map((p) => `${p.name}: ${p.text}`).join('\n')); }}
                          className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 rounded-lg px-2 py-1 shadow-sm transition-colors whitespace-nowrap"
                          title="Edit the Materials & Methods text that will appear in the exported document">
                    ✏️ Edit text
                  </button>
                  <button type="button"
                          onClick={() => { regenerateMaterialsAndMethods(false, false); setMmEditOpen(false); }}
                          className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-lg px-2 py-1 shadow-sm transition-colors whitespace-nowrap"
                          title="Regenerate this section from the current Experimental Conditions, Instrumental Setup and Experiment Setup of the linked tests">
                    🔄 Update from tests
                  </button>
                </>
              )}
            </div>
          </div>

          {mmEditOpen ? (
            <div className="flex flex-col gap-2">
              <textarea value={mmDraft} onChange={(e) => setMmDraft(e.target.value)}
                        rows="8" placeholder="Materials & Methods text…"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMmEditOpen(false)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
                <button type="button" onClick={saveMaterialsAndMethodsText} disabled={!mmDraft.trim()}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">💾 Save text</button>
              </div>
            </div>
          ) : mmPartsFor(project, tests, false).length === 0 && !project.materialsAndMethods?.text ? (
            <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">
              No linked experiments yet — add tests with the Experiment planner above.
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
              {project.materialsAndMethods?.text
                ? String(project.materialsAndMethods.text).split('\n').filter(Boolean).map((para, i) => (
                    <p key={i} className="text-sm text-slate-800 text-justify leading-relaxed">{para}</p>
                  ))
                : mmPartsFor(project, tests, false).map((p, i) => (
                    <p key={i} className="text-sm text-slate-800 text-justify leading-relaxed">
                      <span className="font-black">{p.name}:</span> {p.text}
                    </p>
                  ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-2 italic">
            The 📄 Export document includes the Materials &amp; Methods of only the tests ticked “Include”.
            {project.materialsAndMethods?.edited ? ' “🔄 Update from tests” regenerates it and discards your edits.' : ''}
          </p>
        </SectionCard>

        {/* ---------- Results and Discussion ---------- */}
        {textSection('discussion', '💬 Results and Discussion',
          'Interpretation of the results, comparisons, limitations and open questions.',
          project.discussion || '', (val) => updateProject({ discussion: val }))}

        {/* ---------- Conclusions ---------- */}
        {textSection('conclusions', '✅ Conclusions',
          'Main take-aways, significance and next steps of the project.',
          project.conclusions || '', (val) => updateProject({ conclusions: val }))}

        {/* ---------- Funding ----------
            Le paragraphe de financement d'un article (bourses, contrats, labo
            d'accueil) vit avec les remerciements : le manuscrit importé le range
            ici quand son titre est « Funding » / « Acknowledgements »… */}
        {textSection('funding', '💰 Funding',
          'Grants, fellowships and financial support — acknowledgements are welcome here too. The manuscript import brings the document’s “Funding” / “Acknowledgements” section into this one.',
          project.funding || '', (val) => updateProject({ funding: val }))}

        {/* ---------- Supporting information ---------- */}
        {textSection('supporting', '📎 Supporting information',
          'Supplementary figures, tables and files of the paper (what goes after the references). The manuscript import brings the document’s “Supporting / Supplementary information” section into this one.',
          project.supporting || '', (val) => updateProject({ supporting: val }))}


        {/* ---------- References ---------- */}
        <SectionCard title="📚 References" open={openSections.bibliography} onToggle={() => toggleSection('bibliography')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{refs.length}</span>}>
          <p className="text-xs text-slate-500 mb-3">
            Numbered references collected from the text sections. They are taken from the
            <strong> “Project bibliography”</strong> (papers labeled with this project in Publications) and the
            <strong> “Publications of the scientist”</strong> (the imported publication list of {project.scientist || 'the project owner'}).
            Each one is printed with the citation built in Publications →
            <strong> “Publication format”</strong>: changing the format changes them here, in the text and in the
            exported document.
          </p>

          {refs.length === 0 ? (
            <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-center mb-3">
              No references yet — use “📚 Insert reference” inside the text sections, or add them below.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 mb-3">
              {refs.map((r) => {
                /* Auteurs COMPLETS du papier (co-auteurs compris) : retrouvés
                   dans la publication d'origine quand la référence ne les
                   stockait pas encore. */
                const d = citeData(r);
                /* LA MISE EN FORME DE LA PUBLICATION ICI AUSSI : c'est la même
                   fonction que l'affichage des publications et la bibliographie
                   du document exporté (voir pubCitationHtml) — l'ordre des
                   champs, les styles, l'« et al. » et les noms du laboratoire
                   soulignés/graissés suivent donc le format choisi. */
                const citation = pubCitationHtml(d, pubFormat, operatorNames);
                return (
                  <div key={r.id} className="flex items-start justify-between gap-3 bg-white border border-slate-200 rounded-lg p-2">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-800">
                        <span className="text-indigo-600 font-black mr-1">[{r.number}]</span>
                        {citation
                          ? <span dangerouslySetInnerHTML={{ __html: citation }} />
                          : <span className="font-bold">{d.title || r.title || 'Untitled'}</span>}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {[r.source, r.link].filter(Boolean).join(' · ')}
                      </div>
                      {!d.authors && (
                        <div className="text-[10px] text-amber-600">
                          ⚠ no authors recorded — use “✨ Complete missing fields” below, or fix the paper in
                          Publications → “Project bibliography”
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeRef(r.id)}
                            className="shrink-0 text-red-400 hover:text-red-600 text-xs px-1.5" title="Remove reference">
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button onClick={() => setRefPicker({ insertText: null })}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              + Add reference from bibliography / publications
            </button>
            <button onClick={() => { openBibImport(); }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200"
                    title="Import references only (an article's .docx, a RIS/BibTeX/Paperpile export, a Web page, or pasted text): the recognised papers are completed (authors, titles, journals…) then added to this project's bibliography and numbered references.">
              📄 Import references from a paper
            </button>
            {/* Les manuscrits importés (ou recollés) gardent les numéros de leur
                bibliographie : ce bouton rattache chaque « [12] » du texte à la
                référence 12 de la liste — c'est le même lien que celui posé à
                l'import, et il est sans danger à relancer. */}
            <button onClick={linkCitationLinks}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-50 text-sky-700 border border-sky-300 hover:bg-sky-100"
                    title="Turn every numbered citation of the text sections — [12], [3,4], [5-7], the EndNote/Word style (12) and superscripts (¹² or <sup>12</sup>) — into a link to the matching reference of the list below. A citation is linked only when ALL its numbers exist here, and a number that is not a reference stays as it is. The exported document and its printed PDF follow it.">
              🔗 Link citations to references
            </button>
            {/* ✨ LES RÉFÉRENCES INCOMPLÈTES (auteurs, titre, revue, année
                manquants) : ce bouton va les chercher dans les publications du
                laboratoire puis dans Crossref — voir utils/referenceEnrich.js.
                Un champ déjà rempli n'est jamais écrasé. */}
            <button onClick={completeProjectReferences} disabled={!canModify || refFixBusy}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 disabled:opacity-50"
                    title="Fill the empty fields of every reference of this project (authors, title, journal, year, volume, pages, DOI): first from the lab publications and “Relevant papers”, then from Crossref (by DOI, else by the exact title). Nothing already written is overwritten.">
              {refFixBusy ? '⏳ Completing…' : '✨ Complete missing fields'}
            </button>
            {citationLinkReport && (
              <span className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1">
                {citationLinkReport}
              </span>
            )}
            {refFixReport && (
              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                {refFixReport}
              </span>
            )}
          </div>

          {/* LA « PROJECT BIBLIOGRAPHY » N'EST PLUS RÉ-AFFICHÉE ICI. Elle est la
              MÊME liste que Publications → « Project bibliography », et les
              références importées apparaissent déjà, en clair et liées, dans la
              liste numérotée ci-dessus : la recopier ici ne faisait que
              brouiller la lecture (« in the project after the references you
              show the project bibliography but it is only confusing… do not show
              it »). On ne garde que ce qui AGIT : les imports et le lien des
              citations, juste au-dessus. */}
          <p className="text-[10px] text-slate-400">
            The project bibliography papers themselves ({projectBib.length}) are listed in
            Publications → “Project bibliography” ({project.scientist || 'the project owner'}), where they can be edited.
            Every one of them that is cited here appears above, numbered.
          </p>
        </SectionCard>


        {renderCommentsSection()}

        {/* ---------- Useful files (project reference documents on Drive) ----------
            EN DERNIER : les documents de référence d'un projet (protocoles, PDF,
            tableurs, spectres…) sont des PIÈCES JOINTES — ils se rangent après le
            texte de l'article et sa revue, pas entre « 📋 Materials and Methods »
            et « 💬 Results and Discussion » (demande utilisateur : « in the project
            move the useful files section at the end »). Le contenu de la section,
            son index et son rangement Drive ne changent pas : elle est simplement
            lue à la fin de la page. */}
        <SectionCard title="📎 Useful files" open={openSections.usefulFiles} onToggle={() => toggleSection('usefulFiles')}
                     badge={
                       <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                         {normalizeProjectFiles(project.usefulFiles).length}
                       </span>
                     }>
          <UsefulFilesSection
            projectName={project.name}
            files={project.usefulFiles}
            folderUrl={project.usefulFilesFolderUrl || ''}
            canModify={canModify}
            currentUser={currentUser}
            onChange={(next) => updateProject({ usefulFiles: next })}
            onFolderUrl={(url) => updateProject({ usefulFilesFolderUrl: url })}
          />
        </SectionCard>

        {confirmDelete && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full">
              <h3 className="text-sm font-black text-slate-800 mb-1">Delete project?</h3>
              <p className="text-xs text-slate-500 mb-4">
                “{project.name}” and its bibliography will be permanently removed. Linked tests are kept.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(false)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
                <button onClick={() => {
                  /* Suppression DÉFINITIVE : la « pierre tombale » est notée
                     avant l'enregistrement, sinon la copie du projet restée
                     dans le document du dataset le ferait réapparaître. */
                  recordProjectDeletion(project);
                  const remaining = projectsRef.current.filter((p) => p.id !== project.id);
                  replaceProjects(remaining);
                  saveProjects(remaining);
                  markAttachmentsDeleted(project).catch(() => {});
                  /* Le dossier Drive du projet part aussi à la corbeille (et son
                     chemin est mis en pierre tombale : il ne se recrée pas). */
                  mirrorDeleteProject({
                    datasetId: project.datasetId || '',
                    datasetName: getDriveRootName(),
                    projectName: project.name || ''
                  }).catch(() => null);
                  backToList();
                }}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {renderRefPicker()}
      {renderBibImport()}
      {renderManuscriptImport()}
      {renderTableDraft()}
      {renderExport()}
    </div>
  );
};

