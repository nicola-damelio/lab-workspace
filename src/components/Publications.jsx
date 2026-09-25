// src/components/Publications.jsx
// Publications → Journals table (inspired by the attached Journals.pdf table).
// Sorted by Impact Factor (highest → lowest); IF is editable inline and the list
// re-sorts live. Every journal can carry a comment and one or more links.
// Persisted in localStorage under "labWorkspace_journals".

import React, { useEffect, useMemo, useState } from 'react';
import LZString from 'lz-string';
import { Icon } from './Icons';
import { DriveUploadButton } from './DriveUpload';
import {
  extractDriveFileIds, trashDriveFile, listDatasetBackups, downloadDriveFileText, getDriveToken
} from '../utils/driveUpload';
import { loadProjects, saveProjects } from './AppModules/projectsModule';
import {
  backupPaperCount, mergePaperLists, mergeProjectBibliographies, papersFromBackupHtml
} from '../utils/referenceImport';
/* COMPLÉTER LA LISTE D'AUTEURS D'UN PAPIER : le pot commun du laboratoire
   (publications des scientifiques, « Relevant papers ») puis Crossref — le même
   moteur que le bouton « ✨ Complete missing fields » de la page projet. Les
   trois listes de papiers s'en servent (voir completePaperAuthors /
   completePbAuthorLists) : il sait aussi remplacer une liste coupée par un
   « et al. » par la liste complète du même article. */
import { authorsIncomplete, enrichReferences } from '../utils/referenceEnrich';
/* LA FORME DES NOMS D'AUTEURS : chaque source web est ramenée à la convention
   du laboratoire (« Smith JA ») DÈS L'IMPORT — PubMed écrivait déjà ainsi,
   Crossref / OpenAlex / ORCID donnaient « John A. Smith », et la citation
   gardait donc l'écriture de la revue d'origine. Une seule règle, un seul
   résultat (voir utils/authorNames.js — le même module que les citations). */
import { authorsFromParts, canonicalName } from '../utils/authorNames';
/* LA FORME DES RENVOIS DANS LE TEXTE : rendue par le VRAI moteur — l'aperçu du
   panneau « Publication format » ne peut donc pas mentir sur ce que le document
   imprimera (voir applyInTextStyle). */
import { inTextCitationHtml } from '../utils/referenceLinks';
import {
  AUTHOR_STYLE_IDS, AUTHOR_STYLES, IN_TEXT_STYLES, normalizeInTextStyle,
  PUB_FORMAT_KEY, PUB_FORMAT_PRESETS,
  PUB_DOC_BLOCKS, PUB_FONTS, PUB_LAYOUT_PARTS, PUB_TEXT_ALIGNMENTS,
  authorMatchesCandidate, buildPubFormat, buildPubDocOrder, buildPubDocTitles, buildPubLayout,
  loadPubFormat, matchCoauthors, normalizePubDocOrder, normalizePubDocTitles, normalizePubLayout,
  normalizePubDocNoTitle,
  pubCitationData, pubCitationHtml, pubDocOrderDropped,
  pubLayoutCss, pubTextStyleIsSet,
  /* LA FORME DES NOMS D'AUTEURS dans la citation (voir utils/authorNames.js) :
     le panneau itère sur ces formes (boutons « as written », « Smith JA »…). */
  NAME_STYLES, normalizeNameStyle,
  /* LES STYLES QUE L'UTILISATEUR SAUVEGARDE (« Custom ») : le panneau les liste, les
     rappelle, les sauve et les oublie (voir pubCitation.js — la clé `labWorkspace_pubStyles`
     reste dans ce module-là : le panneau ne parle qu'aux fonctions). */
  loadPubStyles, savePubStyle, removePubStyle,
  scientistStyleOf
} from './pubCitation';
/* LES FORMATS DE JOURNAL (« cambiare giornale di submission velocemente ») : chaque
   journal réunit la forme de la citation, le CARACTÈRE de chaque partie du document
   et l'ORDRE de ses sections — voir journalFormats.js. */
import {
  JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat,
  journalLabelOf, journalOf, journalSectionOrder, reorderDocHtml,
  DOC_EMPTY_LINE_CLASS
} from './journalFormats';

const JOURNALS_STORAGE_KEY = 'labWorkspace_journals';

const inputCls =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white';
const labelCls = 'block text-[10px] font-bold text-slate-400 uppercase mb-1';

/* Un bouton de style à TROIS états (voir pubToggleLayoutStyle) : laissé comme
   le programme (gris clair), imposé (bleu), ou explicitement retiré (barré) —
   le titre d'une section, que le programme écrit en gras, doit pouvoir
   redevenir normal. Le panneau « Publication format » en a trois par partie du
   document : gras, italique, souligné. */
const PubTriButton = ({ state, label, title, onClick }) => (
  <button type="button" onClick={onClick} title={title}
          aria-pressed={state === true}
          className={`w-6 h-6 rounded text-[11px] font-bold border transition ${
            state === true ? 'bg-indigo-600 text-white border-indigo-600'
              : state === false ? 'bg-white text-slate-400 border-slate-300 line-through'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
    {label}
  </button>
);

/* =========================================================================
   PUBLICATION FORMAT — the citation engine lives in ./pubCitation (a
   React-free module, so the node test _pub_author_style_test.mjs imports the
   real code). It is re-exported below because the project document renders its
   bibliography with loadPubFormat / pubCitationHtml.

   Reminder: EVERY author of the paper is listed — only the “et al.” cutoff
   shortens the list. On top of that the format chooses the STYLE of the lab
   members' names: each scientist of the user list can be underlined, bold or
   left as typed, wherever their name appears among the authors (AUTHOR_STYLES
   / format.scientistStyles).
   ========================================================================= */
export {
  AUTHOR_STYLES, AUTHOR_STYLE_IDS, IN_TEXT_STYLES, IN_TEXT_STYLE_IDS, PUB_FORMAT_PRESETS,
  normalizeInTextStyle,
  PUB_FONTS, PUB_LAYOUT_PARTS, PUB_TEXT_ALIGNMENTS,
  buildPubFormat, buildPubDocOrder, buildPubDocTitles, buildPubDocNoTitle, buildPubLayout, loadPubFormat,
  normalizePubDocOrder, normalizePubDocTitles, normalizePubDocNoTitle, normalizePubFormat, normalizePubLayout,
  pubLayoutCss, pubTextStyleIsSet, emptyPubTextStyle, PUB_DOC_BLOCKS, PUB_DOC_BLOCK_IDS,
  pubDocOrderMoved, pubDocOrderDropped, pubDocTitleKeywords, pubDocOrderKeywords, pubDocTitleOf, pubDocTitleHidden,
  /* LES SECTIONS DE TEXTE QUI ONT LEUR RANGÉE (Scientific background · Results and
     discussion · conclusions · funding · supporting : voir PUB_DOC_BLOCKS) : la page du
     projet les imprime chacune à sa place, sous l'intitulé qu'elle a reçu. */
  PUB_DOC_SECTION_BLOCKS, PUB_DOC_SECTION_IDS, pubDocBlockOfSection,
  pubCitationHtml, pubCitationText, pubFieldValue, pubDoiUrl,
  pubCitationData, pubOriginOf,
  authorMatchesCandidate, matchCoauthors, isLabAuthor, labMemberOf,
  scientistStyleOf, authorStyleOf, sanitizeScientistStyles
} from './pubCitation';

/* LES FORMATS DE JOURNAL, ré-exportés POUR LA PAGE DU PROJET : elle imprime le
   document et n'importe que ce module-ci (`from '../Publications'`). Le bloc
   ci-dessus ré-exporte pubCitation : ces noms-là viennent de journalFormats.js,
   d'où cette seconde instruction — un nom ne peut pas être ré-exporté depuis un
   module qui ne le déclare pas. Les LIGNES VIDES de la tête du document (le titre,
   les auteurs et les affiliations se lisent sur des lignes séparées — voir
   docHeadRows · docHeadSpacedHtml) partent avec elles : la page du projet, le
   document figé, l'impression, le PDF et le .docx obéissent à la même règle. */
export {
  JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat,
  journalLabelOf, journalOf, journalSectionOrder, reorderDocHtml,
  DOC_HEAD_IDS, DOC_HEAD_CLASSES, DOC_EMPTY_LINE_ID, DOC_EMPTY_LINE_CLASS, DOC_EMPTY_LINE_HTML,
  docHeadRows, docHeadSpacedHtml
} from './journalFormats';

const ifNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : -1;
};

const emptyJournal = () => ({
  name: '',
  impactFactor: '',
  cost: '',
  format: '',
  scope: '',
  publisher: '',
  comments: '',
  links: []
});

/* Links editor: one or more links (description + URL) per journal */
const LinksEditor = ({ links = [], setLinks }) => {
  const update = (i, field, val) =>
    setLinks(links.map((l, j) => (j === i ? { ...l, [field]: val } : l)));
  const remove = (i) => setLinks(links.filter((_, j) => j !== i));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className={labelCls}>Links ({links.length})</label>
        <button
          type="button"
          onClick={() => setLinks([...links, { description: '', url: '' }])}
          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
        >
          + Add link
        </button>
      </div>
      {links.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          No links yet — add a journal homepage, guide-for-authors or example article.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={l.description || ''}
                onChange={(e) => update(i, 'description', e.target.value)}
                placeholder="Description (e.g. Guide for authors)"
                className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-indigo-400"
              />
              <input
                type="text"
                value={l.url || ''}
                onChange={(e) => update(i, 'url', e.target.value)}
                placeholder="https://..."
                className="flex-[2] border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-red-500 hover:text-red-700 font-bold px-1"
                title="Remove link"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* =========================================================
   PUBLICATIONS OF THE SCIENTISTS — web search helpers
   ========================================================= */
const PUBLICATIONS_STORAGE_KEY = 'labWorkspace_publications';
const EXCLUDED_PUBS_KEY = 'labWorkspace_publications_excluded';

const genPubId = () => `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const RELEVANT_PAPERS_KEY = 'labWorkspace_relevantPapers';
const SUBJECTS_KEY = 'labWorkspace_relevant_subjects';

/** PAPIERS « Relevant papers » enregistrés sur cet appareil. Ils alimentent la
 *  bibliographie d'un projet au même titre que les publications importées : ils
 *  sont donc une « publication d'origine » possible quand une entrée de
 *  bibliographie (ou une référence numérotée) n'a pas d'auteurs — voir
 *  pubCitationData / pubOriginOf, réutilisés par la page de projet. */
export const loadRelevantPapers = () => {
  try {
    const raw = localStorage.getItem(RELEVANT_PAPERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};

/* Les quatre listes de papiers de cette page vivent dans localStorage : elles
   ne sont donc PAS dans la base du dataset. On les lit ici par leur nom pour
   que le reste de l'application (sauvegarde HTML, « Load HTML », récupération
   d'une ancienne version) puisse les sauver et les relire. */
const readList = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const writeList = (key, list) => {
  try { localStorage.setItem(key, JSON.stringify(Array.isArray(list) ? list : [])); } catch { /* quota */ }
};

export const readPublications = () => readList(PUBLICATIONS_STORAGE_KEY);
export const readExcludedPubs = () => readList(EXCLUDED_PUBS_KEY);
export const readRelevantSubjects = () => readList(SUBJECTS_KEY);
export const writePublicationsList = (list) => writeList(PUBLICATIONS_STORAGE_KEY, list);
export const writeRelevantPapersList = (list) => writeList(RELEVANT_PAPERS_KEY, list);
export const writeExcludedPubs = (list) => writeList(EXCLUDED_PUBS_KEY, list);
export const writeRelevantSubjects = (list) => writeList(SUBJECTS_KEY, list);

/**
 * Applique les papiers d'une ANCIENNE SAUVEGARDE à l'appareil — sans jamais
 * rien écraser :
 *   • publications des scientifiques, « Relevant papers », étiquettes et
 *     publications masquées : on ajoute les absentes et on complète les champs
 *     vides des présentes (mergePaperLists) ;
 *   • bibliographies des projets : les références sont fusionnées dans les
 *     projets qui existent (par id, sinon par nom) ; aucun projet n'est créé,
 *     remplacé ou supprimé (mergeProjectBibliographies).
 * Le reste du fichier (expériences, définitions, stockage, rapport…) n'est
 * JAMAIS touché : c'est le but — récupérer les papiers perdus d'une version
 * antérieure sans perdre le travail récent des autres sections.
 * @returns {{publications:number, relevantPapers:number, subjects:number,
 *            projects:number, refs:number}}
 */
export const applyPapersRecovery = (papers, opts = {}) => {
  const src = papers && typeof papers === 'object' ? papers : {};
  const want = (key) => opts[key] !== false;
  const out = { publications: 0, relevantPapers: 0, subjects: 0, excluded: 0, projects: 0, refs: 0, filled: 0 };

  if (want('publications') && Array.isArray(src.publications) && src.publications.length) {
    const m = mergePaperLists(readPublications(), src.publications);
    if (m.added || m.filled) writePublicationsList(m.list);
    out.publications = m.added;
    out.filled += m.filled;
  }
  if (want('relevantPapers') && Array.isArray(src.relevantPapers) && src.relevantPapers.length) {
    const m = mergePaperLists(loadRelevantPapers(), src.relevantPapers);
    if (m.added || m.filled) writeRelevantPapersList(m.list);
    out.relevantPapers = m.added;
    out.filled += m.filled;
  }
  if (want('subjects') && Array.isArray(src.relevantSubjects) && src.relevantSubjects.length) {
    const cur = readRelevantSubjects();
    const next = [...new Set([...cur, ...src.relevantSubjects.map((s) => String(s || '').trim()).filter(Boolean)])];
    if (next.length > cur.length) { writeRelevantSubjects(next); out.subjects = next.length - cur.length; }
  }
  if (want('excluded') && Array.isArray(src.excludedPubs) && src.excludedPubs.length) {
    const cur = readExcludedPubs();
    const next = [...new Set([...cur, ...src.excludedPubs.map((s) => String(s || '').trim()).filter(Boolean)])];
    if (next.length > cur.length) { writeExcludedPubs(next); out.excluded = next.length - cur.length; }
  }
  if (want('projects') && Array.isArray(src.projects) && src.projects.length) {
    const res = mergeProjectBibliographies(loadProjects(), src.projects);
    if (res.projectsTouched) saveProjects(res.projects);
    out.projects = res.projectsTouched;
    out.refs = res.added;
    out.filled += res.filled;
  }
  return out;
};

const DEFAULT_SUBJECTS = [
  'MD simulations', 'NMR', 'Docking', 'Antimicrobial peptides (AMPs)',
  'Membrane biophysics', 'Bioinformatics', 'Protein structure', 'Other'
];

const normalizeLink = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/i.test(s)) return `https://doi.org/${s}`;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
};

const subjectColor = (s) => {
  const colors = [
    'bg-blue-100 text-blue-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800',
    'bg-purple-100 text-purple-800', 'bg-rose-100 text-rose-800', 'bg-cyan-100 text-cyan-800',
    'bg-indigo-100 text-indigo-800', 'bg-slate-100 text-slate-700'
  ];
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
};

// A paper can carry one or more labels; legacy entries stored a single `subject`
const paperLabelsOf = (p) => {
  if (p && Array.isArray(p.labels) && p.labels.length) return p.labels.map((l) => String(l).trim()).filter(Boolean);
  if (p && p.subject) return [String(p.subject).trim()];
  return [];
};

// Multi-label picker: toggleable chips for all known labels + free-text custom label
const LabelChips = ({ labels, options, onChange, placeholder }) => {
  const [custom, setCustom] = React.useState('');
  const toggle = (l) => {
    const next = labels.includes(l) ? labels.filter((x) => x !== l) : [...labels, l];
    onChange(next);
  };
  const addCustom = () => {
    const l = custom.trim();
    if (!l || labels.includes(l)) { if (l) setCustom(''); return; }
    onChange([...labels, l]);
    setCustom('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button type="button" key={o} onClick={() => toggle(o)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition ${labels.includes(o) ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {labels.includes(o) ? '✓ ' : ''}{o}
          </button>
        ))}
        {labels.filter((l) => !options.includes(l)).map((l) => (
          <button type="button" key={l} onClick={() => toggle(l)}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-600 text-white shadow">
            ✓ {l} ✕
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        <input className="border border-slate-300 rounded px-2 py-1 text-xs flex-1 min-w-0 bg-white outline-none focus:border-indigo-400"
               value={custom} onChange={(e) => setCustom(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
               placeholder={placeholder || 'Type a new label…'} />
        <button type="button" onClick={addCustom}
                className="text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 px-2 py-1 rounded shrink-0">Add</button>
      </div>
    </div>
  );
};

const searchPubMed = async (query) => {
  const q = encodeURIComponent(query);
  const es = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${q}&retmode=json&retmax=12&sort=relevance`);
  const sj = await es.json();
  const ids = sj?.esearchresult?.idlist || [];
  if (ids.length === 0) return [];
  const em = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`);
  const ej = await em.json();
  const out = [];
  ids.forEach((id) => {
    const r = ej?.result?.[id];
    if (!r) return;
    const doi = (r.articleids || []).find((a) => a.idtype === 'doi')?.value || '';
    out.push({
      title: r.title || '',
      authors: (r.authors || []).map((a) => canonicalName(a && a.name)).filter(Boolean).join(', '),
      journal: r.fulljournalname || r.source || '',
      year: r.pubdate ? String(r.pubdate).slice(0, 4) : '',
      doi,
      pmid: id,
      type: r.pubtype && r.pubtype.length ? r.pubtype[0] : '',
      links: [
        { description: 'PubMed', url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` },
        ...(doi ? [{ description: 'DOI', url: `https://doi.org/${doi}` }] : [])
      ]
    });
  });
  return out;
};

const searchCrossref = async (query) => {
  const res = await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=12&select=title,author,container-title,issued,DOI,type`);
  const j = await res.json();
  return ((j?.message?.items) || [])
    .map((it) => {
      const title = (it.title && it.title[0]) || '';
      const doi = it.DOI || '';
      return {
        title,
        /* « John A. Smith » (Crossref) → « Smith JA » : voir utils/authorNames.js. */
        authors: authorsFromParts(it.author),
        journal: (it['container-title'] && it['container-title'][0]) || '',
        year: it.issued?.['date-parts']?.[0]?.[0] ? String(it.issued['date-parts'][0][0]) : '',
        doi,
        pmid: '',
        type: (it.type || '').replace(/-/g, ' '),
        links: doi ? [{ description: 'DOI', url: `https://doi.org/${doi}` }] : []
      };
    })
    .filter((r) => r.title);
};

const searchCrossrefAuthor = async (name) => {
  const res = await fetch(`https://api.crossref.org/works?query.author=${encodeURIComponent(name)}&rows=15&select=title,author,container-title,issued,DOI,type`);
  const j = await res.json();
  return ((j?.message?.items) || [])
    .map((it) => {
      const title = (it.title && it.title[0]) || '';
      const doi = it.DOI || '';
      return {
        title,
        authors: authorsFromParts(it.author),
        journal: (it['container-title'] && it['container-title'][0]) || '',
        year: it.issued?.['date-parts']?.[0]?.[0] ? String(it.issued['date-parts'][0][0]) : '',
        doi,
        pmid: '',
        type: (it.type || '').replace(/-/g, ' '),
        links: doi ? [{ description: 'DOI', url: `https://doi.org/${doi}` }] : []
      };
    })
    .filter((r) => r.title);
};

// ---- ORCID Public API ------------------------------------------------
// Fetch the list of works of an ORCID iD (from an orcid.org/XXXX-XXXX-… profile
// page) and return them in the same shape as the PubMed / Crossref results.
const searchOrcidByOrcidId = async (orcidId, authorName = '') => {
  const id = String(orcidId || '').trim().toLowerCase().replace(/^https?:\/\/orcid\.org\//i, '');
  if (!id) return [];
  const res = await fetch(`https://pub.orcid.org/v3.0/${encodeURIComponent(id)}/works`, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`ORCID API error (HTTP ${res.status})`);
  const j = await res.json();
  const groups = Array.isArray(j?.group) ? j.group : [];
  const out = [];
  groups.forEach((g) => {
    const ws = Array.isArray(g?.['work-summary']) ? g['work-summary'] : [];
    const ws0 = ws[0];
    if (!ws0) return;
    const title = ws0?.title?.title?.value || '';
    if (!title) return;
    const doi = (ws0?.['external-ids']?.['external-id'] || [])
      .find((e) => (e['external-id-type'] || '').toLowerCase() === 'doi')?.['external-id-value'] || '';
    const pmid = (ws0?.['external-ids']?.['external-id'] || [])
      .find((e) => (e['external-id-type'] || '').toLowerCase() === 'pmid')?.['external-id-value'] || '';
    const pd = ws0?.['publication-date'] || {};
    const year = pd?.year?.value || '';
    const putCode = ws0?.['put-code'] || '';
    out.push({
      title,
      /* L'API ORCID ne donne QUE le titulaire du profil (aucun contributeur dans
         son `work-summary`) : les co-auteurs sont récupérés juste après par
         authorListLookup(), ce nom n'est qu'un repli hors ligne. Lui aussi passe
         par la convention du laboratoire (« Smith JA »). */
      authors: canonicalName(authorName),
      journal: ws0?.['journal-title']?.value || '',
      year,
      doi,
      pmid,
      type: (ws0?.type || '').replace(/-/g, ' '),
      links: [
        ...(putCode ? [{ description: 'ORCID', url: `https://orcid.org/${id}/work/${putCode}` }] : [{ description: 'ORCID', url: `https://orcid.org/${id}` }]),
        ...(doi ? [{ description: 'DOI', url: `https://doi.org/${doi}` }] : [])
      ]
    });
  });
  /* L'API ORCID ne renvoie AUCUN co-auteur : la liste complète des auteurs est
     donc récupérée AVANT que ces travaux ne soient proposés puis enregistrés.
     Sans elle, le membre du laboratoire apparaissait comme SEUL auteur du papier
     (`authors: authorName` n'est plus qu'un repli, quand le web ne connaît
     l'identifiant du travail). */
  const lookup = await authorListLookup(out);
  return out.map((r) => ({ ...r, authors: lookup(r) || r.authors }));
};

// Search ORCID by author name (expanded-search).
const searchOrcidByName = async (query) => {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return [];
  const res = await fetch(`https://pub.orcid.org/v3.0/expanded-search/?q=${q}`, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`ORCID API error (HTTP ${res.status})`);
  const j = await res.json();
  const items = Array.isArray(j?.['expanded-result']) ? j['expanded-result'] : [];
  const out = [];
  for (const it of items.slice(0, 5)) {
    const oid = it?.['orcid-id'] || '';
    const name = `${it?.['given-names'] || ''} ${it?.['family-names'] || ''}`.trim();
    if (!oid) continue;
    try {
      const works = await searchOrcidByOrcidId(oid, name);
      works.forEach((w) => out.push(w));
    } catch { /* skip profiles that fail */ }
  }
  return out;
};

// ---- Author lists of the imported works -----------------------------------
/* A search API does NOT always give the co-authors: the public ORCID API, in
   particular, only returns the profile owner (its `work-summary` has no
   contributor at all), so a paper imported from an ORCID iD ended up with the
   lab member's name as its ONLY author. The real list is therefore fetched
   separately and copied into the result: by DOI from OpenAlex (one request per
   40 DOIs) and by PubMed id from eSummary (the same source as the search
   itself). A work with neither identifier keeps what ORCID gave. */
const AUTHOR_BATCH = 40;

const pubDoiOf = (item) => String((item && item.doi) || '').trim()
  .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
const pubPmidOf = (item) => String((item && item.pmid) || '').trim();

/* OpenAlex rend le nom COMPLET (« John A. Smith ») : ramené ici à la convention
   du laboratoire, comme toutes les autres sources (voir utils/authorNames.js). */
const openAlexAuthorList = (authorships) => (Array.isArray(authorships) ? authorships : [])
  .map((a) => canonicalName(String(a?.author?.display_name || '')))
  .filter(Boolean)
  .join(', ');

const fetchAuthorsByDoi = async (dois) => {
  const out = new Map();
  for (let i = 0; i < dois.length; i += AUTHOR_BATCH) {
    const chunk = dois.slice(i, i + AUTHOR_BATCH);
    try {
      const res = await fetch(
        `https://api.openalex.org/works?filter=doi:${chunk.map((d) => encodeURIComponent(d)).join('|')}`
        + `&per-page=${chunk.length}&select=doi,authorships`
      );
      if (!res.ok) continue;
      const j = await res.json();
      (j?.results || []).forEach((w) => {
        const key = String(w?.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
        const authors = openAlexAuthorList(w?.authorships);
        if (key && authors) out.set(key, authors);
      });
    } catch { /* réseau indisponible : on garde ce que la recherche a donné */ }
  }
  return out;
};

const fetchAuthorsByPmid = async (pmids) => {
  const out = new Map();
  for (let i = 0; i < pmids.length; i += AUTHOR_BATCH * 5) {
    const chunk = pmids.slice(i, i + AUTHOR_BATCH * 5);
    try {
      const res = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${chunk.join(',')}&retmode=json`
      );
      if (!res.ok) continue;
      const j = await res.json();
      chunk.forEach((id) => {
        /* PubMed écrit DÉJÀ « Smith JA » : la conversion ne fait que garantir la
           même écriture pour tout le monde (un « Smith, John A. » y passerait). */
        const authors = (j?.result?.[id]?.authors || [])
          .map((a) => canonicalName(a && a.name)).filter(Boolean).join(', ');
        if (authors) out.set(String(id), authors);
      });
    } catch { /* réseau indisponible */ }
  }
  return out;
};

/** Lecture des auteurs RÉELS d'un résultat importé : DOI (OpenAlex) puis
 *  identifiant PubMed (eSummary). Rend une fonction item → liste d'auteurs
 *  (chaîne vide quand le web ne connaît pas ce travail). */
const authorListLookup = async (items) => {
  const list = Array.isArray(items) ? items : [];
  const dois = [...new Set(list.map(pubDoiOf).filter(Boolean))];
  const pmids = [...new Set(list.map(pubPmidOf).filter(Boolean))];
  const [byDoi, byPmid] = await Promise.all([fetchAuthorsByDoi(dois), fetchAuthorsByPmid(pmids)]);
  return (item) => byDoi.get(pubDoiOf(item)) || byPmid.get(pubPmidOf(item)) || '';
};

// ---- Impact-factor lookup (web) ------------------------------------------
// Uses the OpenAlex "sources" endpoint. OpenAlex's 2-year mean citedness
// (summary_stats.2yr_mean_citedness) is computed from the same 2-year citation
// window that defines the Clarivate Journal Impact Factor, so it is the best
// free, CORS-friendly approximation available in the browser.
const ifNormalizeName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fetchJournalImpactFactor = async (journalName) => {
  const q = encodeURIComponent(ifNormalizeName(journalName));
  if (!q) return null;
  const res = await fetch(
    `https://api.openalex.org/sources?search=${q}&per-page=5&select=id,display_name,issn_l,summary_stats`
  );
  if (!res.ok) throw new Error(`OpenAlex API error (HTTP ${res.status})`);
  const j = await res.json();
  const results = Array.isArray(j?.results) ? j.results : [];
  const want = ifNormalizeName(journalName);

  let best = null;
  let bestScore = -1;
  for (const r of results) {
    const dn = ifNormalizeName(r?.display_name || '');
    if (!dn) continue;
    let score = 0;
    if (dn === want) score = 100;
    else if (dn.includes(want) || want.includes(dn)) {
      score = 60 + (Math.min(dn.length, want.length) / Math.max(1, Math.max(dn.length, want.length))) * 30;
    } else {
      const wa = new Set(want.split(' ').filter(Boolean));
      const inter = dn.split(' ').filter((w) => wa.has(w)).length;
      score = (inter / Math.max(1, wa.size)) * 50;
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best || bestScore < 35) return null;

  const cited = best?.summary_stats?.['2yr_mean_citedness'];
  if (cited == null || !Number.isFinite(cited)) return null;
  return {
    impactFactor: Number(cited).toFixed(1),
    matchedName: best.display_name || journalName,
    source: 'OpenAlex',
    year: new Date().getFullYear()
  };
};

/* PDF attachment cell used in the publications tables: uploads the PDF to
   Google Drive at the given folder `path`, with an optional `fileSuffix`
   (publication year / keywords) appended to the file name, and lets the user
   open or remove the attached PDF. Removing the PDF also TRASHES the Drive
   file, so Drive keeps mirroring the app (no orphaned files). */
const PubPdfCell = ({ p, path, fileSuffix, onSetPdf }) => {
  const removePdf = () => {
    onSetPdf('');
    // Best-effort: delete the PDF from Drive too (it may be a data URL with no
    // Drive file behind it — extractDriveFileIds simply returns [] then).
    extractDriveFileIds(p.pdf || '').forEach((id) => { trashDriveFile(id); });
  };
  return (
    <div className="flex flex-col gap-1">
      <DriveUploadButton
        accept=".pdf,.PDF"
        label="⬆ PDF"
        naming={{}}
        path={path}
        fileSuffix={fileSuffix}
        onDone={({ dataUrl, drive }) => onSetPdf(drive ? drive.driveUrl : dataUrl)}
        className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
      />
      {p.pdf ? (
        <div className="flex items-center gap-1.5">
          <a href={p.pdf} target="_blank" rel="noreferrer"
             className="text-blue-600 hover:underline text-[10px] truncate block max-w-[110px]">📄 Open</a>
          <button type="button" onClick={removePdf}
                  className="text-red-400 hover:text-red-600 text-xs px-0.5" title="Remove PDF">✕</button>
        </div>
      ) : (
        <span className="text-slate-300 text-[10px]">no pdf</span>
      )}
    </div>
  );
};

export const PublicationsSection = ({ scientists = [], defaultScientist = '', currentUser }) => {
  // A user can delete a "Relevant paper" / "Publication of a scientist" entry
  // only if they OWN it (the entry's scientist matches their name) or they are
  // the supervisor. Entries of other users are protected.
  const canManageEntry = (owner) =>
    !!currentUser && (
      currentUser.role === 'superuser' ||
      String(currentUser.name || '') === String(owner || '')
    );
  // The journals table (impact factors + entries) is curated by the supervisor:
  // only a superuser can edit impact factors or delete journals.
  const isSuper = currentUser?.role === 'superuser';
  const [journals, setJournals] = useState(() => {
    try {
      const saved = localStorage.getItem(JOURNALS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore malformed saved data */ }
    return DEFAULT_JOURNALS;
  });
  const [expandedId, setExpandedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyJournal());
  // "Update Impact Factor" — live web lookup state
  const [ifUpdating, setIfUpdating] = useState(false);
  const [ifStatus, setIfStatus] = useState('');
  const [ifResults, setIfResults] = useState({}); // journal id → { status, impactFactor, matchedName }

  useEffect(() => {
    try { localStorage.setItem(JOURNALS_STORAGE_KEY, JSON.stringify(journals)); } catch { /* ignore */ }
  }, [journals]);

  // ---- Publications of the scientists (filtered per scientist, web-searchable) ----
  const [pubs, setPubs] = useState(() => {
    try {
      const saved = localStorage.getItem(PUBLICATIONS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Backfill `coauthors` for entries saved before this field existed
          return parsed.map((p) => {
            if (Array.isArray(p.coauthors)) return p;
            return { ...p, coauthors: matchCoauthors(p.authors || '', scientists, p.scientist) };
          });
        }
      }
    } catch { /* ignore malformed saved data */ }
    return [];
  });
  const [pubFilter, setPubFilter] = useState('all');
  const [pubAuthorsFixing, setPubAuthorsFixing] = useState(false); // « ⟳ Complete author lists » running
  const [pubFormat, setPubFormat] = useState(loadPubFormat);
  const [pubFormatScope, setPubFormatScope] = useState('default'); // 'default' | project name
  const [pubAddField, setPubAddField] = useState('doi'); // field id to add via the "+ Add field" control
  /* L'ORDRE DES BLOCS DU DOCUMENT SE RÈGLE PAR GLISSER-DÉPOSER (voir
     pubDropDocBlock) : la ligne qu'on a prise, et celle survolée. */
  const [pubDocDragId, setPubDocDragId] = useState('');
  const [pubDocOverId, setPubDocOverId] = useState('');
  useEffect(() => {
    try { localStorage.setItem(PUB_FORMAT_KEY, JSON.stringify(pubFormat)); } catch { /* ignore */ }
  }, [pubFormat]);
  /* LES STYLES SAUVEGARDÉS (« Custom » à rappeler) : lus une fois, réécrits à chaque
     sauvegarde ou oubli (voir savePubStyle / removePubStyle, pubCitation.js). La clé
     porte le préfixe « lab » : le miroir du Drive les emporte avec le reste, donc ils se
     retrouvent d'un poste à l'autre. */
  const [pubStyles, setPubStyles] = useState(() => loadPubStyles());
  const [pubStyleMsg, setPubStyleMsg] = useState('');
  const [pubExpanded, setPubExpanded] = useState(null);
  const [showExcludedPubs, setShowExcludedPubs] = useState(false);
  const [pubShowSearch, setPubShowSearch] = useState(false);
  const [pubScientist, setPubScientist] = useState(defaultScientist || '');
  const [pubQuery, setPubQuery] = useState('');
  const [orcidId, setOrcidId] = useState('');
  const [pubSearching, setPubSearching] = useState(false);
  const [pubError, setPubError] = useState('');
  const [pubResults, setPubResults] = useState([]);
  const [addedPubKeys, setAddedPubKeys] = useState([]);
  const [updating, setUpdating] = useState('');   // '' idle, or scientist being checked
  const [updateMsg, setUpdateMsg] = useState('');

  // Entries the user never wants re-added (false positives from same-name authors)
  const [excludedPubKeys, setExcludedPubKeys] = useState(() => {
    try {
      const s = localStorage.getItem(EXCLUDED_PUBS_KEY);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(EXCLUDED_PUBS_KEY, JSON.stringify(excludedPubKeys)); } catch { /* ignore */ }
  }, [excludedPubKeys]);
  const excludedSet = useMemo(() => new Set(excludedPubKeys), [excludedPubKeys]);
  const toggleExcludePub = (p) => {
    const k = pubExistsKey(p);
    if (!k) return;
    setExcludedPubKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  // Extra scientist names added manually (persisted) so the filter can list anyone
  const EXTRA_SCIENTISTS_KEY = 'labWorkspace_publication_scientists';
  const [extraScientists, setExtraScientists] = useState(() => {
    try {
      const s = localStorage.getItem(EXTRA_SCIENTISTS_KEY);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [showAddScientist, setShowAddScientist] = useState(false);
  const [newScientistName, setNewScientistName] = useState('');

  useEffect(() => {
    try { localStorage.setItem(EXTRA_SCIENTISTS_KEY, JSON.stringify(extraScientists)); } catch { /* ignore */ }
  }, [extraScientists]);

  const addScientist = () => {
    const n = newScientistName.trim();
    if (!n) return;
    setExtraScientists((prev) => (prev.includes(n) ? prev : [...prev, n].sort((a, b) => a.localeCompare(b))));
    setNewScientistName('');
    setShowAddScientist(false);
  };

  useEffect(() => {
    try { localStorage.setItem(PUBLICATIONS_STORAGE_KEY, JSON.stringify(pubs)); } catch { /* ignore */ }
  }, [pubs]);

  // Dedupe key for a publication / search result
  const pubExistsKey = (p) => {
    if (p && p.doi) return `doi:${String(p.doi).toLowerCase()}`;
    if (p && p.title) return `t:${String(p.title).toLowerCase()}|${String(p.year || '')}`;
    return '';
  };

  // Names recognised as “lab members” inside a citation: the scientists of the
  // user list plus the names added manually just above (a student, a former
  // member… even without an account). These are the names the publication
  // format can underline / put in bold wherever they appear among the authors.
  const citationScientists = useMemo(() => {
    const set = new Set();
    (scientists || []).forEach((s) => { const n = String(s || '').trim(); if (n) set.add(n); });
    (extraScientists || []).forEach((s) => { const n = String(s || '').trim(); if (n) set.add(n); });
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [scientists, extraScientists]);

  const scientistOptions = useMemo(() => {
    const set = new Set((scientists || []).filter(Boolean));
    pubs.forEach((p) => { if (p.scientist) set.add(p.scientist); });
    (extraScientists || []).forEach((s) => { if (s) set.add(s); });
    if (defaultScientist) set.add(defaultScientist);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [scientists, pubs, extraScientists, defaultScientist]);

  const filteredPubs = useMemo(() => {
    const base = showExcludedPubs ? pubs : pubs.filter((p) => !excludedSet.has(pubExistsKey(p)));
    const list = pubFilter === 'all'
      ? base
      : base.filter((p) => p.scientist === pubFilter || (p.coauthors || []).includes(pubFilter));
    return [...list].sort((a, b) => {
      const ay = parseInt(a.year, 10) || 0;
      const by = parseInt(b.year, 10) || 0;
      if (by !== ay) return by - ay;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }, [pubs, pubFilter, excludedSet, showExcludedPubs]);

  const patchPub = (id, p) => setPubs((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const removePub = (id, title) => {
    if (!window.confirm(`Delete "${title || 'this publication'}"?`)) return;
    setPubs((prev) => prev.filter((x) => x.id !== id));
    if (pubExpanded === id) setPubExpanded(null);
  };

  const pubKey = (r) => `${r.title || ''}|${r.year || ''}`;

  const addPubResult = (r) => {
    const scientist = (defaultScientist || '').trim();
    if (!scientist) { alert('Log in first — you can only add publications under your own name.'); return; }
    if (excludedSet.has(pubExistsKey(r))) {
      setUpdateMsg('⛔ This publication is excluded (never add again). Use the 🚫 toggle in its row to un-exclude it.');
      return;
    }
    const item = {
      id: `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      scientist,
      coauthors: matchCoauthors(r.authors || '', scientistOptions, scientist),
      title: r.title || '',
      authors: r.authors || '',
      journal: r.journal || '',
      year: r.year || '',
      doi: r.doi || '',
      pmid: r.pmid || '',
      type: r.type || '',
      comments: '',
      links: Array.isArray(r.links) ? r.links : []
    };
    setPubs((prev) => [...prev, item]);
    setAddedPubKeys((prev) => [...prev, pubKey(r)]);
  };

  const doSearch = async (source) => {
    const q = pubQuery.trim();
    if (!q) return;
    setPubSearching(true);
    setPubError('');
    setPubResults([]);
    try {
      const res = source === 'crossref' ? await searchCrossref(q)
        : source === 'orcid' ? await searchOrcidByName(q)
        : await searchPubMed(q);
      setPubResults(res);
      if (res.length === 0) setPubError('No results found. Try a different query, or paste an ORCID iD below.');
    } catch (e) {
      setPubError(`Search failed: ${e && e.message ? e.message : e}`);
    } finally {
      setPubSearching(false);
    }
  };

  // Import all works from an ORCID profile page (paste the iD, e.g. 0000-0002-1825-0097)
  const importOrcidId = async () => {
    const id = (orcidId || '').trim();
    if (!id) { setPubError('Paste an ORCID iD (e.g. 0000-0002-1825-0097) or the full profile URL.'); return; }
    setPubSearching(true);
    setPubError('');
    setPubResults([]);
    try {
      const res = await searchOrcidByOrcidId(id, pubScientist || defaultScientist || '');
      setPubResults(res);
      if (res.length === 0) setPubError('No works found for this ORCID profile (or the iD is not public).');
    } catch (e) {
      setPubError(`ORCID import failed: ${e && e.message ? e.message : e}`);
    } finally {
      setPubSearching(false);
    }
  };

  const togglePubSearch = () => {
    if (!pubShowSearch && !pubScientist) setPubScientist(defaultScientist || '');
    setPubShowSearch((v) => !v);
  };

  // Auto-update: search the web (PubMed + Crossref) for new publications of the
  // logged-in user only — insertion under another name is not allowed.
  const checkPublications = async (target) => {
    const logged = (defaultScientist || '').trim();
    if (!logged) {
      setUpdateMsg('⛔ Log in first — publications can only be added under your own name.');
      return;
    }
    const targets = [logged];
    if (targets.length === 0) return;
    setUpdating(target);
    setUpdateMsg('');
    const seen = new Set();
    pubs.forEach((p) => { const k = pubExistsKey(p); if (k) seen.add(k); });
    let added = 0, skipped = 0, failed = 0;
    for (const name of targets) {
      setUpdating(name);
      try {
        const [pm, cr] = await Promise.all([
          searchPubMed(`"${name}"[Author]`),
          searchCrossrefAuthor(name)
        ]);
        const items = [];
        for (const r of [...pm, ...cr]) {
          const k = pubExistsKey(r);
          if (!k) continue;
          if (excludedSet.has(k)) continue;
          if (seen.has(k)) { skipped++; continue; }
          seen.add(k);
          items.push({
            id: genPubId(),
            scientist: name,
            coauthors: matchCoauthors(r.authors || '', scientistOptions, name),
            title: r.title || '',
            authors: r.authors || '',
            journal: r.journal || '',
            year: r.year || '',
            doi: r.doi || '',
            pmid: r.pmid || '',
            type: r.type || '',
            comments: '',
            links: Array.isArray(r.links) ? r.links : []
          });
        }
        if (items.length > 0) {
          setPubs((prev) => [...prev, ...items]);
          added += items.length;
        }
      } catch { failed++; }
    }
    setUpdating('');
    setUpdateMsg(`✓ Check completed: ${added} publication(s) added · ${skipped} already in the table${failed ? ` · ${failed} author(s) failed` : ''}.`);
  };

  // Add every search result at once (skips the ones already in the table)
  const addAllResults = () => {
    const scientist = (defaultScientist || '').trim();
    if (!scientist) { alert('Log in first — you can only add publications under your own name.'); return; }
    const seen = new Set(pubs.map((p) => pubExistsKey(p)).filter(Boolean));
    const items = [];
    for (const r of pubResults) {
      const k = pubExistsKey(r);
      if (!k || seen.has(k)) continue;
      if (excludedSet.has(k)) continue;
      seen.add(k);
      items.push({
        id: genPubId(),
        scientist,
        coauthors: matchCoauthors(r.authors || '', scientistOptions, scientist),
        title: r.title || '',
        authors: r.authors || '',
        journal: r.journal || '',
        year: r.year || '',
        doi: r.doi || '',
        pmid: r.pmid || '',
        type: r.type || '',
        comments: '',
        links: Array.isArray(r.links) ? r.links : []
      });
    }
    if (items.length > 0) setPubs((prev) => [...prev, ...items]);
    setAddedPubKeys((prev) => [...prev, ...pubResults.map((r) => pubKey(r))]);
    setUpdateMsg(`✓ ${items.length} publication(s) added · ${pubResults.length - items.length} already in the table.`);
  };

  /* Publications dont la liste d'auteurs manque ou se réduit au titulaire seul
     (travaux importés depuis ORCID avant que les co-auteurs ne soient récupérés,
     ou ajoutés à la main) : la liste RÉELLE est redemandée au web — DOI →
     OpenAlex, identifiant PubMed → eSummary — puis enregistrée, et les
     co-auteurs du laboratoire sont recalculés pour que le papier apparaisse aussi
     sous leur nom. Rien n'est écrasé quand le web ne trouve pas le papier. */
  const refreshPubAuthors = async () => {
    const targets = pubs.filter((p) => {
      const authors = String(p.authors || '').trim();
      if (!authors) return true;
      return authors === String(p.scientist || '').trim();
    });
    if (targets.length === 0) {
      setUpdateMsg('✓ Every publication already lists its authors.');
      return;
    }
    setPubAuthorsFixing(true);
    setUpdateMsg('');
    try {
      const lookup = await authorListLookup(targets);
      const updates = new Map();
      targets.forEach((p) => {
        const authors = lookup(p);
        if (!authors || authors === String(p.authors || '').trim()) return;
        updates.set(p.id, { authors, coauthors: matchCoauthors(authors, scientistOptions, p.scientist) });
      });
      if (updates.size > 0) {
        setPubs((prev) => prev.map((p) => (updates.has(p.id) ? { ...p, ...updates.get(p.id) } : p)));
      }
      setUpdateMsg(updates.size
        ? `✓ ${updates.size} publication(s) completed with their full author list (${targets.length - updates.size} not found online).`
        : '⛔ No author list found online for these papers (no DOI or PMID stored) — fill them in by hand.');
    } finally {
      setPubAuthorsFixing(false);
    }
  };

  // ---- Relevant papers (subject + scientist classification) ----
  const [papers, setPapers] = useState(() => {
    try {
      const saved = localStorage.getItem(RELEVANT_PAPERS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((p) => ({
            ...p,
            labels: Array.isArray(p.labels) ? p.labels : (p.subject ? [p.subject] : [])
          }));
        }
      }
    } catch { /* ignore malformed saved data */ }
    return [];
  });
  const [paperFilterLabels, setPaperFilterLabels] = useState([]); // all selected labels must be on the paper (AND)
  const [paperFilterScientist, setPaperFilterScientist] = useState('all');
  const [paperExpanded, setPaperExpanded] = useState(null);
  /* ⟳ « Complete author lists » DES « RELEVANT PAPERS » (voir plus bas) : l'état
     du bouton et son compte rendu, affiché en tête de la section. */
  const [paperAuthorsFixing, setPaperAuthorsFixing] = useState(false);
  const [paperAuthorsMsg, setPaperAuthorsMsg] = useState('');
  const [pbTransferStatus, setPbTransferStatus] = useState('');
  const [showAddPaper, setShowAddPaper] = useState(false);
  const [paperDraft, setPaperDraft] = useState({ title: '', link: '', labels: [], scientist: '', comments: '', authors: '', year: '' });
  // Custom subjects defined by the user (persisted)
  const [customSubjects, setCustomSubjects] = useState(() => {
    try {
      const s = localStorage.getItem(SUBJECTS_KEY);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });
  const [showSubjectsMgr, setShowSubjectsMgr] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  // Web search for relevant papers (always visible, same as the publications table)
  const [paperQuery, setPaperQuery] = useState('');
  const [paperSearching, setPaperSearching] = useState(false);
  const [paperSearchError, setPaperSearchError] = useState('');
  const [paperResults, setPaperResults] = useState([]);
  const [addedPaperKeys, setAddedPaperKeys] = useState([]);

  // ---- Project bibliography (papers labeled with a project name; stored in
  //      the matching project's `bibliography` array in labWorkspace_projects) ----
  const pbIsSuper = currentUser?.role === 'superuser';
  // Scoped to the dataset currently open (loadProjects/saveProjects honour the
  // active dataset), so project bibliographies never bleed across datasets.
  const [pbProjects, setPbProjects] = useState(() => {
    try {
      const list = loadProjects();
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  });
  const [pbFilter, setPbFilter] = useState('all');
  const [pbShowAdd, setPbShowAdd] = useState(false);
  const [pbDraft, setPbDraft] = useState({ project: '', title: '', link: '', comments: '', authors: '', year: '' });
  const [pbExpanded, setPbExpanded] = useState(null);
  /* ⟳ « Complete author lists » DE LA BIBLIOGRAPHIE DES PROJETS : le bouton
     travaille (voir completePbAuthorLists) pendant que les auteurs sont
     cherchés ; le compte rendu passe par le statut déjà affiché pour les
     imports de la section. */
  const [pbAuthorsFixing, setPbAuthorsFixing] = useState(false);
  // Import papers (from Relevant papers / Publications of the scientist) into a project
  const [pbImportOpen, setPbImportOpen] = useState(false);
  const [pbImportProject, setPbImportProject] = useState('');
  const [pbImportSel, setPbImportSel] = useState(new Set());
  /* RÉCUPÉRATION DE PAPIERS depuis une ancienne sauvegarde (.html) : on ne relit
     QUE les papiers du fichier (voir applyPapersRecovery) — les expériences,
     définitions, stockage, rapport… de la version actuelle ne bougent pas. */
  const [recovOpen, setRecovOpen] = useState(false);
  const [recovState, setRecovState] = useState(null); // null | { papers, parts, source, counts, applied }
  const [recovStatus, setRecovStatus] = useState('');
  const [recovBusy, setRecovBusy] = useState(false);
  const [recovBackups, setRecovBackups] = useState(null); // null | [{ id, name, size }]

  useEffect(() => {
    try { saveProjects(pbProjects); } catch { /* ignore */ }
  }, [pbProjects]);

  useEffect(() => {
    if (!pbTransferStatus) return;
    const t = setTimeout(() => setPbTransferStatus(''), 4000);
    return () => clearTimeout(t);
  }, [pbTransferStatus]);

  const myProjects = useMemo(() => {
    return (pbProjects || []).filter((prj) => pbIsSuper || prj.scientist === defaultScientist);
  }, [pbProjects, pbIsSuper, defaultScientist]);

  const pbRows = useMemo(() => {
    const rows = [];
    myProjects.forEach((prj) => {
      (prj.bibliography || []).forEach((paper) => {
        /* Chaque ligne est complétée par la publication d'origine : les papiers
           importés avant la prise en charge des co-auteurs n'ont qu'un titre, et
           la liste affichait alors le seul titulaire du projet. */
        rows.push({
          ...paper,
          ...pubCitationData(paper, pubs),
          projectId: prj.id, projectName: prj.name, projectScientist: prj.scientist
        });
      });
    });
    if (pbFilter !== 'all') return rows.filter((r) => r.projectName === pbFilter);
    return rows;
  }, [myProjects, pbFilter, pubs]);

  /* Format de citation à appliquer à une ligne : celui du projet concerné
     (« Publication format » par projet) sinon le format par défaut. */
  const pbFormatOf = (projectId) =>
    (myProjects.find((prj) => prj.id === projectId) || {}).pubFormat || pubFormat;

  const addPbPaper = () => {
    const title = (pbDraft.title || '').trim();
    if (!title || !pbDraft.project) return;
    setPbProjects((prev) => prev.map((prj) => {
      if (prj.name !== pbDraft.project) return prj;
      return {
        ...prj,
        bibliography: [...(prj.bibliography || []), {
          id: 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          title, link: pbDraft.link.trim(), scientist: prj.scientist, comments: pbDraft.comments.trim(),
          authors: pbDraft.authors.trim(), year: pbDraft.year.trim()
        }]
      };
    }));
    setPbDraft({ project: '', title: '', link: '', comments: '', authors: '', year: '' });
    setPbShowAdd(false);
  };

  const patchPbPaper = (projectId, paperId, patch) =>
    setPbProjects((prev) => prev.map((prj) => {
      if (prj.id !== projectId) return prj;
      return { ...prj, bibliography: (prj.bibliography || []).map((p) => (p.id === paperId ? { ...p, ...patch } : p)) };
    }));

  const movePbPaper = (fromProjectId, paperId, toProjectName) =>
    setPbProjects((prev) => {
      const from = prev.find((prj) => prj.id === fromProjectId);
      const paper = from ? (from.bibliography || []).find((p) => p.id === paperId) : null;
      if (!paper) return prev;
      return prev.map((prj) => {
        if (prj.id === fromProjectId) return { ...prj, bibliography: (prj.bibliography || []).filter((p) => p.id !== paperId) };
        if (prj.name === toProjectName) return { ...prj, bibliography: [...(prj.bibliography || []), { ...paper, scientist: prj.scientist }] };
        return prj;
      });
    });

  const removePbPaper = (projectId, paperId) =>
    setPbProjects((prev) => prev.map((prj) => {
      if (prj.id !== projectId) return prj;
      return { ...prj, bibliography: (prj.bibliography || []).filter((p) => p.id !== paperId) };
    }));

  // Candidates for import: every "Relevant papers" entry + the publications of
  // the scientist(s) of the target project.
  const pbImportCandidates = useMemo(() => {
    const targetPrj = pbImportProject ? myProjects.find((p) => p.name === pbImportProject) : null;
    const relevant = (papers || []).map((p) => ({ ...p, source: 'Relevant papers' }));
    const pubsForProject = targetPrj
      ? (pubs || []).filter((p) => {
          const authors = [p.scientist, ...(p.coauthors || [])].filter(Boolean);
          return !authors.length || authors.includes(targetPrj.scientist);
        })
      : (pubs || []);
    return [...relevant, ...pubsForProject.map((p) => ({ ...p, source: 'Publications of the scientist' }))];
  }, [papers, pubs, pbImportProject, myProjects]);

  const toggleImportSel = (key) =>
    setPbImportSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const importPapersToProject = () => {
    const prjName = pbImportProject;
    if (!prjName) return;
    const selected = pbImportCandidates.filter((p) => pbImportSel.has(`${p.source}:${p.id}`));
    if (selected.length === 0) return;
    let added = 0;
    setPbProjects((prev) => prev.map((prj) => {
      if (prj.name !== prjName) return prj;
      const existingTitles = new Set((prj.bibliography || []).map((b) => (b.title || '').trim()));
      const fresh = selected.filter((p) => !existingTitles.has((p.title || '').trim()));
      const newPapers = fresh.map((p) => ({
        id: 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + added,
        title: p.title || 'Untitled',
        link: p.link || p.doi || '',
        /* La liste COMPLÈTE des auteurs (co-auteurs du laboratoire et auteurs
           extérieurs) suit le papier : sans elle, la bibliographie du projet ne
           pouvait afficher que le titulaire du projet. */
        authors: p.authors || '',
        journal: p.journal || '',
        year: p.year || '',
        doi: p.doi || '',
        volume: p.volume || '',
        pages: p.pages || '',
        /* Lien vers la publication d'origine (publication importée ou papier de
           « Relevant papers ») : elle sera retrouvée par identifiant, DOI ou
           identifiant PubMed — voir pubOriginOf. */
        sourceId: p.id || '',
        source: p.source || '',
        pmid: p.pmid || '',
        scientist: prj.scientist,
        comments: p.comments || '',
        labels: Array.isArray(p.labels) ? p.labels : (p.subject ? [p.subject] : [])
      }));
      added += fresh.length;
      return { ...prj, bibliography: [...(prj.bibliography || []), ...newPapers] };
    }));
    setPbTransferStatus(`✅ ${added} paper(s) imported into “${prjName}”${selected.length > added ? ` (${selected.length - added} already present)` : ''}`);
    setPbImportOpen(false);
    setPbImportSel(new Set());
    setPbImportProject('');
  };

  /* ⟳ « COMPLETE AUTHOR LISTS » DE LA BIBLIOGRAPHIE DES PROJETS.
     Signalé : « project bibliography does not find all authors of the
     publication — il faudrait un bouton “complete author list” comme dans la
     section “publication of the scientist” ». Chaque entrée dont la liste
     d'auteurs est VIDE (papier ajouté à la main) ou COUPÉE par un « et al. »
     (la revue abrégeait la liste) est donc complétée par le moteur de référence
     du laboratoire : la publication d'origine d'abord — les publications des
     scientifiques ET les « Relevant papers », hors ligne, une entrée importée
     gardant l'identifiant de son papier (voir pubOriginOf) — puis Crossref (par
     DOI, sinon par titre exact, voir utils/referenceEnrich.js). Les autres
     champs vides de ces entrées (revue, année, volume, pages, DOI) en profitent :
     c'est le bouton « ✨ Complete missing fields » de la page projet, ici pour
     cette liste. Les listes trouvées sont ÉCRITES dans la bibliographie du
     projet — pas seulement affichées — et un papier dont la liste est déjà
     écrite en entier n'est jamais touché. */
  const completePbAuthorLists = async () => {
    if (pbAuthorsFixing) return;
    const pending = [];
    myProjects.forEach((prj) => (prj.bibliography || []).forEach((paper) => {
      if (authorsIncomplete(paper)) pending.push({ paper, projectId: prj.id });
    }));
    if (pending.length === 0) {
      setPbTransferStatus('✓ Every project paper already lists all its authors.');
      return;
    }
    setPbAuthorsFixing(true);
    setPbTransferStatus(`⏳ Looking for the author lists of ${pending.length} paper(s)…`);
    try {
      const res = await enrichReferences(pending.map((t) => t.paper), { pool: [...pubs, ...papers], all: false, max: 60 });
      /* La liste complétée porte le MÊME id : elle remplace son entrée dans la
         bibliographie du projet concerné (rien d'autre n'est réécrit). */
      const patches = new Map(); // projectId → Map(paperId → entrée complétée)
      res.list.forEach((entry, i) => {
        if (entry === pending[i].paper) return;
        const projectId = pending[i].projectId;
        if (!patches.has(projectId)) patches.set(projectId, new Map());
        patches.get(projectId).set(entry.id, entry);
      });
      if (patches.size > 0) {
        setPbProjects((prev) => prev.map((prj) => {
          const byPaper = patches.get(prj.id);
          if (!byPaper) return prj;
          return {
            ...prj,
            bibliography: (prj.bibliography || []).map((b) => (byPaper.has(b.id) ? { ...b, ...byPaper.get(b.id) } : b))
          };
        }));
      }
      setPbTransferStatus(res.completed
        ? `✓ ${res.completed} project paper(s) completed with their full author list`
          + (pending.length - res.completed ? ` (${pending.length - res.completed} not found in the publications or on Crossref)` : '')
          + (res.offline ? ' — the online service could not be reached' : '')
          + (res.stillShortened ? ` · ⚠ ${res.stillShortened} paper(s) still show “et al.”: write the co-authors by hand.` : '')
        : '⛔ No author list found for these papers (no DOI in the link, and the title found nothing) — write the co-authors by hand.');
    } catch (err) {
      setPbTransferStatus(`⚠ ${(err && err.message) || 'Author lookup failed'}`);
    } finally {
      setPbAuthorsFixing(false);
    }
  };

  /* ---- Récupération de papiers depuis une ancienne sauvegarde -------------
     Un fichier « Save HTML » (ou une sauvegarde hebdomadaire Drive) contient
     tout le dataset ; ici on n'en extrait QUE les papiers — publications,
     « Relevant papers », étiquettes, bibliographies de projets — et on les
     FUSIONNE avec ce qui est déjà enregistré (rien n'est remplacé). Aucune
     autre section du fichier n'est lue : c'est ce qui permet de récupérer des
     papiers perdus sans perdre le travail récent ailleurs. */

  const openRecovery = (papers, source) => {
    if (!papers) {
      setRecovStatus('⚠ This file is not a Lab Workspace backup (no saved-data block inside).');
      setRecovOpen(true);
      return;
    }
    const counts = backupPaperCount(papers);
    setRecovState({
      papers,
      source: source || 'backup',
      counts,
      applied: false,
      parts: {
        publications: counts.publications > 0,
        relevantPapers: counts.relevantPapers > 0,
        projects: counts.projectBib > 0,
        subjects: (papers.relevantSubjects || []).length > 0
      }
    });
    setRecovStatus('');
    setRecovOpen(true);
  };

  const loadRecoveryFile = async (file) => {
    if (!file) return;
    setRecovBusy(true);
    setRecovStatus(`Reading ${file.name}…`);
    try {
      const text = await file.text();
      openRecovery(papersFromBackupHtml(text, (s) => LZString.decompressFromUTF16(s)), file.name);
    } catch (err) {
      setRecovStatus(`⚠ ${(err && err.message) || 'Could not read this file'}`);
    }
    setRecovBusy(false);
  };

  const loadDriveBackups = async () => {
    setRecovBusy(true);
    if (!getDriveToken()) {
      setRecovBackups([]);
      setRecovStatus('Google Drive is not connected — use “Choose a backup file” instead (download the .html from Lab Workspace/<dataset>/backups).');
      setRecovBusy(false);
      return;
    }
    setRecovStatus('Looking for backups in Google Drive…');
    const list = await listDatasetBackups();
    setRecovBackups(list);
    setRecovStatus(list.length
      ? `${list.length} backup(s) found in this dataset’s Drive “backups” folder.`
      : 'No backup found in Lab Workspace/<dataset>/backups on Drive.');
    setRecovBusy(false);
  };

  const loadDriveBackup = async (item) => {
    setRecovBusy(true);
    setRecovStatus(`Downloading ${item.name}…`);
    try {
      const text = await downloadDriveFileText(item.id);
      openRecovery(papersFromBackupHtml(text, (s) => LZString.decompressFromUTF16(s)), item.name);
    } catch (err) {
      setRecovStatus(`⚠ ${(err && err.message) || 'Download failed'}`);
    }
    setRecovBusy(false);
  };

  const runRecovery = () => {
    if (!recovState) return;
    /* `excluded: false` : la liste des publications masquées de la sauvegarde
       n'est PAS reprise ici (elle déciderait de ce qui s'affiche ; elle reste
       disponible via « Load HTML » où l'élément se coche explicitement). */
    const res = applyPapersRecovery(recovState.papers, { ...recovState.parts, excluded: false });
    /* La page montre immédiatement ce qui vient d'être relu. */
    setPbProjects(loadProjects());
    setPubs(readPublications());
    setPapers(loadRelevantPapers());
    setCustomSubjects(readRelevantSubjects());
    const bits = [];
    if (res.publications) bits.push(`${res.publications} publication(s)`);
    if (res.relevantPapers) bits.push(`${res.relevantPapers} relevant paper(s)`);
    if (res.refs) bits.push(`${res.refs} reference(s) in ${res.projects} project(s)`);
    if (res.subjects) bits.push(`${res.subjects} label(s)`);
    setRecovStatus(bits.length
      ? `✅ Added ${bits.join(', ')}${res.filled ? ` — ${res.filled} existing entr${res.filled > 1 ? 'ies' : 'y'} completed` : ''}. Nothing was removed.`
      : '✅ Nothing new: the papers of this backup are already here.');
    setRecovState({ ...recovState, applied: true });
  };

  useEffect(() => {
    try { localStorage.setItem(SUBJECTS_KEY, JSON.stringify(customSubjects)); } catch { /* ignore */ }
  }, [customSubjects]);

  useEffect(() => {
    try { localStorage.setItem(RELEVANT_PAPERS_KEY, JSON.stringify(papers)); } catch { /* ignore */ }
  }, [papers]);

  const paperSubjects = useMemo(() => {
    const set = new Set(DEFAULT_SUBJECTS);
    (customSubjects || []).forEach((s) => { if (s) set.add(s); });
    papers.forEach((p) => { paperLabelsOf(p).forEach((l) => { if (l) set.add(l); }); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [customSubjects, papers]);

  const paperScientists = useMemo(() => {
    const set = new Set(scientistOptions);
    papers.forEach((p) => { if (p.scientist) set.add(p.scientist); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [scientistOptions, papers]);

  const filteredPapers = useMemo(() => {
    return papers
      .filter((p) => {
        if (paperFilterLabels.length > 0 && !paperFilterLabels.every((l) => paperLabelsOf(p).includes(l))) return false;
        if (paperFilterScientist !== 'all' && p.scientist !== paperFilterScientist) return false;
        return true;
      })
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }, [papers, paperFilterLabels, paperFilterScientist]);

  const patchPaper = (id, p) => setPapers((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const removePaper = (id, title) => {
    if (!window.confirm(`Delete "${title || 'this paper'}"?`)) return;
    setPapers((prev) => prev.filter((x) => x.id !== id));
    if (paperExpanded === id) setPaperExpanded(null);
  };

  const addPaper = () => {
    const title = paperDraft.title.trim();
    const link = normalizeLink(paperDraft.link);
    if (!title && !link) { alert('Enter a title or a link for the paper.'); return; }
    const scientist = (defaultScientist || '').trim();
    if (!scientist) { alert('Log in first — you can only add relevant papers under your own name.'); return; }
    const labels = (paperDraft.labels || []).map((l) => String(l).trim()).filter(Boolean);
    const finalLabels = labels.length > 0 ? labels : ['Other'];
    setPapers((prev) => [...prev, {
      id: genPubId(),
      title,
      link,
      labels: finalLabels,
      subject: finalLabels[0],
      scientist,
      /* Les auteurs du papier suivent l’entrée : la bibliographie d’un projet
         (et donc la citation du document) les affiche au complet. */
      authors: paperDraft.authors.trim(),
      year: paperDraft.year.trim(),
      comments: paperDraft.comments || '',
      createdAt: Date.now()
    }]);
    setPaperDraft({ title: '', link: '', labels: [], scientist: '', comments: '', authors: '', year: '' });
    setShowAddPaper(false);
  };

  // ---- Subjects management ----
  const addSubject = () => {
    const s = newSubject.trim();
    if (!s) return;
    setCustomSubjects((prev) => (prev.includes(s) ? prev : [...prev, s]));
    setNewSubject('');
  };
  const removeSubject = (s) => setCustomSubjects((prev) => prev.filter((x) => x !== s));

  // ---- Web search for relevant papers ----
  const paperKey = (r) => `${r.title || ''}|${r.year || ''}`;

  const doPaperSearch = async (source) => {
    const q = paperQuery.trim();
    if (!q) return;
    setPaperSearching(true);
    setPaperSearchError('');
    setPaperResults([]);
    try {
      const res = source === 'crossref' ? await searchCrossref(q) : await searchPubMed(q);
      setPaperResults(res);
      if (res.length === 0) setPaperSearchError('No results found. Try a different query.');
    } catch (e) {
      setPaperSearchError(`Search failed: ${e && e.message ? e.message : e}`);
    } finally {
      setPaperSearching(false);
    }
  };

  const addPaperResult = (r) => {
    const labels = (paperDraft.labels || []).map((l) => String(l).trim()).filter(Boolean);
    const finalLabels = labels.length > 0 ? labels : ['Other'];
    const scientist = (defaultScientist || '').trim();
    if (!scientist) { alert('Log in first — you can only add relevant papers under your own name.'); return; }
    const link = r.doi ? `https://doi.org/${r.doi}` : (r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : '');
    setPapers((prev) => [...prev, {
      id: genPubId(), title: r.title || '', link, labels: finalLabels, subject: finalLabels[0],
      scientist, authors: r.authors || '', journal: r.journal || '', year: r.year || '', comments: '', createdAt: Date.now()
    }]);
    setAddedPaperKeys((prev) => [...prev, paperKey(r)]);
  };

  const addAllPaperResults = () => {
    const labels = (paperDraft.labels || []).map((l) => String(l).trim()).filter(Boolean);
    const finalLabels = labels.length > 0 ? labels : ['Other'];
    const scientist = (defaultScientist || '').trim();
    if (!scientist) { alert('Log in first — you can only add relevant papers under your own name.'); return; }
    const seen = new Set(papers.map((p) => p.link || p.title).filter(Boolean).map((x) => String(x).toLowerCase()));
    const items = [];
    for (const r of paperResults) {
      const link = r.doi ? `https://doi.org/${r.doi}` : (r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : '');
      const k = (link || r.title || '').toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push({ id: genPubId(), title: r.title || '', link, labels: finalLabels, subject: finalLabels[0], scientist, authors: r.authors || '', journal: r.journal || '', year: r.year || '', comments: '', createdAt: Date.now() });
    }
    if (items.length > 0) setPapers((prev) => [...prev, ...items]);
    setAddedPaperKeys((prev) => [...prev, ...paperResults.map((r) => paperKey(r))]);
  };

  /* ⟳ « COMPLETE AUTHOR LISTS » DES « RELEVANT PAPERS ».
     Signalé : « relevant paper … does not find all authors of the publication —
     il faudrait un bouton “complete author list” comme dans la section
     “publication of the scientist” ». Les papiers dont la liste d'auteurs est
     VIDE (ajoutés à la main, import ancien) ou COUPÉE par un « et al. » sont
     donc repris par le moteur de référence du laboratoire : la publication
     d'origine (les publications des scientifiques, hors ligne — voir
     pubCitationData) puis Crossref, par DOI sinon par titre exact. Les autres
     champs vides de ces papiers (revue, année, DOI…) suivent le même chemin.
     Une liste écrite en entier n'est jamais retouchée. */
  const completePaperAuthors = async () => {
    if (paperAuthorsFixing) return;
    const pending = papers.filter(authorsIncomplete);
    if (pending.length === 0) {
      setPaperAuthorsMsg('✓ Every relevant paper already lists all its authors.');
      return;
    }
    setPaperAuthorsFixing(true);
    setPaperAuthorsMsg('');
    try {
      const res = await enrichReferences(pending, { pool: pubs, all: false, max: 60 });
      const byId = new Map();
      res.list.forEach((entry, i) => { if (entry !== pending[i]) byId.set(entry.id, entry); });
      if (byId.size > 0) setPapers((prev) => prev.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p)));
      setPaperAuthorsMsg(res.completed
        ? `✓ ${res.completed} relevant paper(s) completed with their full author list`
          + (pending.length - res.completed ? ` (${pending.length - res.completed} not found in the publications or on Crossref)` : '')
          + (res.offline ? ' — the online service could not be reached' : '')
          + (res.stillShortened ? ` · ⚠ ${res.stillShortened} paper(s) still show “et al.”: write the co-authors by hand.` : '')
        : '⛔ No author list found for these papers (no DOI in the link, and the title found nothing) — write the co-authors by hand.');
    } catch (err) {
      setPaperAuthorsMsg(`⚠ ${(err && err.message) || 'Author lookup failed'}`);
    } finally {
      setPaperAuthorsFixing(false);
    }
  };

  const patch = (id, p) =>
    setJournals((prev) => prev.map((j) => (j.id === id ? { ...j, ...p } : j)));

  const remove = (id, name) => {
    if (!window.confirm(`Delete "${name}" from the journal list?`)) return;
    setJournals((prev) => prev.filter((j) => j.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const addJournal = () => {
    const name = draft.name.trim();
    if (!name) { alert('Enter a journal name first.'); return; }
    setJournals((prev) => [
      ...prev,
      { id: `journal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...draft, name, links: draft.links || [] }
    ]);
    setDraft(emptyJournal());
    setShowAdd(false);
  };

  // Look up the current impact factor of every journal from the web (OpenAlex)
  // and update the table. Runs sequentially with a small delay to respect the
  // API rate limit; each row gets a ✓/✗ status in the IF column.
  const updateImpactFactors = async () => {
    if (ifUpdating) return;
    setIfUpdating(true);
    setIfStatus('Starting lookup…');
    setIfResults({});
    const targets = [...journals].filter((j) => j.name && j.name.trim());
    let updated = 0;
    let notFound = 0;
    let failed = 0;
    const results = {};
    for (let i = 0; i < targets.length; i++) {
      const j = targets[i];
      const name = j.name.trim();
      setIfStatus(`Looking up “${name}”… (${i + 1}/${targets.length})`);
      try {
        const found = await fetchJournalImpactFactor(name);
        if (found) {
          patch(j.id, {
            impactFactor: found.impactFactor,
            ifSource: found.source,
            ifMatchedName: found.matchedName,
            ifUpdatedAt: new Date().toISOString().slice(0, 10)
          });
          results[j.id] = { status: 'ok', impactFactor: found.impactFactor, matchedName: found.matchedName };
          updated++;
        } else {
          results[j.id] = { status: 'notfound', impactFactor: j.impactFactor || '', matchedName: '' };
          notFound++;
        }
      } catch (e) {
        results[j.id] = { status: 'error', impactFactor: j.impactFactor || '', message: e?.message || String(e) };
        failed++;
      }
      setIfResults({ ...results });
      await new Promise((r) => setTimeout(r, 200)); // be nice to the API
    }
    setIfStatus(
      targets.length === 0
        ? 'No journals to update.'
        : `Done — ${updated} updated · ${notFound} not found · ${failed} failed.`
    );
    setIfUpdating(false);
  };

  // Always sorted by impact factor, highest → lowest (journals without an IF go last, alphabetically)
  const sorted = useMemo(() => {
    return [...journals].sort((a, b) => {
      const ia = ifNum(a.impactFactor);
      const ib = ifNum(b.impactFactor);
      if (ia < 0 && ib < 0) return String(a.name || '').localeCompare(String(b.name || ''));
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ib - ia;
    });
  }, [journals]);

  const usableLinks = (j) => (Array.isArray(j.links) ? j.links.filter((l) => l && l.url) : []);

  const tableCols = [
    { k: 'name', l: 'Journal' },
    { k: 'if', l: 'IF' },
    { k: 'cost', l: 'Cost' },
    { k: 'format', l: 'Format' },
    { k: 'scope', l: 'Scope' },
    { k: 'publisher', l: 'Publisher / Type' },
    { k: 'comments', l: 'Comments' },
    { k: 'links', l: 'Links' },
    { k: 'actions', l: '' }
  ];
  const renderTable = () => (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="max-h-96 overflow-y-auto custom-scrollbar">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              {tableCols.map((c) => (
                <th key={c.k} className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                  {c.l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={tableCols.length} className="text-xs text-slate-400 italic px-3 py-3">
                  No journals yet. Use “+ Add Journal” to create the first entry.
                </td>
              </tr>
            ) : (
              sorted.map((j, idx) => {
                const isOpen = expandedId === j.id;
                const links = usableLinks(j);
                return (
                  <React.Fragment key={j.id}>
                    <tr
                      className={`cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'} ${isOpen ? 'bg-indigo-50/60' : ''}`}
                      onClick={() => setExpandedId(isOpen ? null : j.id)}
                      title="Click to view / edit details"
                    >
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-800 align-top">
                        <span className="font-bold text-slate-800">{j.name || '—'}</span>
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={j.impactFactor || ''}
                          onChange={(e) => patch(j.id, { impactFactor: e.target.value })}
                          readOnly={!isSuper}
                          placeholder="—"
                          title={isSuper ? 'Edit Impact Factor — the table re-sorts automatically' : 'Only the supervisor can edit impact factors'}
                          className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-right font-semibold text-slate-800 outline-none focus:border-indigo-400 read-only:bg-slate-50 read-only:text-slate-600"
                        />
                        {(ifResults[j.id] || (j.ifUpdatedAt && j.ifSource)) && (
                          <div className="mt-1 text-[9px] leading-tight">
                            {ifResults[j.id] ? (
                              ifResults[j.id].status === 'ok' ? (
                                <span className="text-emerald-600 font-bold whitespace-nowrap" title={`Updated from ${ifResults[j.id].matchedName || j.name} (OpenAlex, 2-year mean citedness)`}>
                                  ✓ {ifResults[j.id].impactFactor}
                                </span>
                              ) : ifResults[j.id].status === 'notfound' ? (
                                <span className="text-amber-600 font-bold whitespace-nowrap" title="No matching journal found on OpenAlex">✗ not found</span>
                              ) : (
                                <span className="text-red-600 font-bold whitespace-nowrap" title={ifResults[j.id].message || 'Lookup failed'}>✗ error</span>
                              )
                            ) : (
                              <span className="text-slate-400 font-bold whitespace-nowrap" title={`Updated ${j.ifUpdatedAt} from ${j.ifSource}${j.ifMatchedName ? ` (matched ${j.ifMatchedName})` : ''}`}>
                                ✓ {j.ifSource} {j.ifUpdatedAt}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-600 align-top text-xs">{j.cost || '—'}</td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-600 align-top text-xs"><span className="line-clamp-2">{j.format || '—'}</span></td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-600 align-top text-xs">{j.scope || '—'}</td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-600 align-top text-xs">{j.publisher || '—'}</td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-600 align-top text-xs"><span className="line-clamp-2">{j.comments || '—'}</span></td>
                      <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                        {links.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {links.slice(0, 2).map((l, i) => (
                              <a key={i} href={l.url} target="_blank" rel="noreferrer"
                                 className="text-blue-600 hover:underline text-[11px] truncate block max-w-[150px]" title={l.url}>
                                {l.description || l.url}
                              </a>
                            ))}
                            {links.length > 2 && <span className="text-[10px] text-slate-400">+{links.length - 2} more</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 text-right align-top whitespace-nowrap">
                        {isSuper && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); remove(j.id, j.name); }}
                            className="text-red-400 hover:text-red-600 text-xs px-1" title="Delete journal">
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-indigo-50/40">
                        <td colSpan={tableCols.length} className="px-4 py-3 border-b border-slate-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            <div>
                              <label className={labelCls}>Journal name</label>
                              <input className={inputCls} value={j.name || ''} onChange={(e) => patch(j.id, { name: e.target.value })} />
                            </div>
                            <div>
                              <label className={labelCls}>Impact Factor</label>
                              <input className={inputCls} value={j.impactFactor || ''} onChange={(e) => patch(j.id, { impactFactor: e.target.value })} readOnly={!isSuper}
                                     title={isSuper ? 'Edit Impact Factor' : 'Only the supervisor can edit impact factors'} placeholder="e.g. 9.1" />
                            </div>
                            <div>
                              <label className={labelCls}>Cost / APC</label>
                              <input className={inputCls} value={j.cost || ''} onChange={(e) => patch(j.id, { cost: e.target.value })} placeholder="e.g. 2600$" />
                            </div>
                            <div>
                              <label className={labelCls}>Format / Word limits</label>
                              <input className={inputCls} value={j.format || ''} onChange={(e) => patch(j.id, { format: e.target.value })} placeholder="e.g. Max 6000 words" />
                            </div>
                            <div>
                              <label className={labelCls}>Scope</label>
                              <input className={inputCls} value={j.scope || ''} onChange={(e) => patch(j.id, { scope: e.target.value })} placeholder="e.g. Chemistry/biology" />
                            </div>
                            <div>
                              <label className={labelCls}>Publisher / Type</label>
                              <input className={inputCls} value={j.publisher || ''} onChange={(e) => patch(j.id, { publisher: e.target.value })} placeholder="e.g. Elsevier, ACS" />
                            </div>
                            <div className="lg:col-span-3">
                              <label className={labelCls}>Comments</label>
                              <textarea className={`${inputCls} h-20`} value={j.comments || ''}
                                onChange={(e) => patch(j.id, { comments: e.target.value })}
                                placeholder="Personal notes, reviewer experience, invitation status..." />
                            </div>
                            <div className="lg:col-span-3">
                              <LinksEditor links={j.links || []} setLinks={(ls) => patch(j.id, { links: ls })} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
  const pubCols = ['Scientist', 'Title', 'Authors', 'Journal', 'Year', 'Links', 'PDF', 'Comments', ''];

  const renderPublications = () => (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-emerald-50/50 border-b border-emerald-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-600 text-white text-sm shrink-0">👥</span>
          Publications of the scientists
          <span className="text-slate-400 font-bold">({showExcludedPubs ? pubs.length : pubs.filter((p) => !excludedSet.has(pubExistsKey(p))).length})</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={pubFilter} onChange={(e) => setPubFilter(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
            <option value="all">All scientists</option>
            {scientistOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {showAddScientist ? (
            <div className="flex items-center gap-1.5">
              <input className="border border-slate-300 rounded px-2 py-1 text-xs w-40 bg-white outline-none focus:border-blue-500"
                     value={newScientistName} onChange={(e) => setNewScientistName(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') addScientist(); }} placeholder="Add scientist…" />
              <button type="button" onClick={addScientist} className="text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 px-2 py-1 rounded">Add</button>
              <button type="button" onClick={() => setShowAddScientist(false)} className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-1 rounded">✕</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowAddScientist(true)} title="Add a scientist not in the list"
                    className="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200">➕</button>
          )}
          <button type="button" onClick={togglePubSearch}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition">
            {pubShowSearch ? 'Close search' : '🔎 Search & Add publication'}
          </button>
          <button type="button" onClick={() => setShowExcludedPubs((v) => !v)}
                  className="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                  title={showExcludedPubs ? 'Hide the excluded papers again' : 'Show the papers you excluded (never add again)'}>
            {showExcludedPubs ? '🙈 Hide excluded' : `🚫 Excluded (${excludedPubKeys.length})`}
          </button>
          <button type="button" onClick={() => checkPublications(pubFilter)} disabled={!!updating || !defaultScientist}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition"
                  title={defaultScientist
                    ? `Search the web (PubMed + Crossref) for new publications of ${defaultScientist} (the logged-in user) and add them to the table`
                    : 'Log in first — publications can only be added under your own name'}>
            {updating ? `⏳ Checking ${updating === 'all' ? defaultScientist : updating}…` : '🔄 Check new publications'}
          </button>
          <button type="button" onClick={refreshPubAuthors} disabled={pubAuthorsFixing || pubs.length === 0}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 disabled:opacity-40 transition"
                  title="Fetch the FULL author list of the papers that show their owner only (older ORCID imports, papers typed by hand): DOI → OpenAlex, PMID → PubMed">
            {pubAuthorsFixing ? '⏳ Fetching authors…' : '⟳ Complete author lists'}
          </button>
        </div>
      </div>
      {updateMsg && <div className="px-4 pt-3 text-xs font-semibold text-emerald-700">{updateMsg}</div>}
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm text-slate-500">
          Publications per scientist — select a scientist above to filter the list. Use “Search &amp; Add” to fetch
          papers from the web (PubMed, Crossref, Web of Science, ORCID). Everything is visible to everyone, but a
          publication can only be added under <b>your own name</b> (the logged-in user). Papers with co-authors who
          are also users appear automatically under those co-authors too — you can edit the co-authors in each row.
        </p>

      {pubShowSearch && (
        <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Scientist (owner) — logged user only</label>
              {defaultScientist ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-white border border-slate-300 rounded-lg px-2 py-1.5">
                  👤 {defaultScientist}
                  <span className="text-[9px] text-slate-400 font-semibold">(only you can add under your name)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5">
                  ⚠️ Log in to add publications under your name
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Search query (title, authors, topic…)</label>
              <input className={inputCls} value={pubQuery} onChange={(e) => setPubQuery(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') doSearch('pubmed'); }}
                     placeholder="e.g. antimicrobial peptides molecular dynamics" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="button" onClick={() => doSearch('pubmed')} disabled={!pubQuery.trim() || pubSearching}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">🔍 PubMed</button>
            <button type="button" onClick={() => doSearch('crossref')} disabled={!pubQuery.trim() || pubSearching}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">📚 Crossref</button>
            <button type="button" onClick={() => doSearch('orcid')} disabled={!pubQuery.trim() || pubSearching}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40">🆔 ORCID (by name)</button>
            <a href={`https://www.webofscience.com/wos/woscc/basic-search?q=${encodeURIComponent(pubQuery.trim())}`} target="_blank" rel="noreferrer"
               className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">🌐 Web of Science ↗</a>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 bg-white border border-sky-200 rounded-lg p-2">
            <label className="text-[10px] font-bold text-sky-800 uppercase">Import from an ORCID profile (paste iD or URL):</label>
            <input className="flex-1 min-w-[220px] border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-sky-500"
                   value={orcidId} onChange={(e) => setOrcidId(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') importOrcidId(); }}
                   placeholder="e.g. 0000-0002-1825-0097 or https://orcid.org/0000-0002-1825-0097" />
            <button type="button" onClick={importOrcidId} disabled={!orcidId.trim() || pubSearching}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40">⬇ Fetch works</button>
          </div>
          {pubSearching && <div className="mt-2 text-xs font-bold text-blue-700 animate-pulse">⏳ Searching…</div>}
          {pubError && <div className="mt-2 bg-red-50 border border-red-300 text-red-700 rounded-lg p-2 text-xs font-semibold">⚠️ {pubError}</div>}
          {pubResults.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-3 mb-1">
                <span className="text-xs font-bold text-slate-600">{pubResults.length} result(s)</span>
                <button type="button" onClick={addAllResults} disabled={!defaultScientist}
                        className="text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 px-2.5 py-1 rounded">
                  ⤵ Insert all ({pubResults.length})
                </button>
              </div>
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto custom-scrollbar">
                {pubResults.map((r, i) => {
                  const added = addedPubKeys.includes(pubKey(r));
                  return (
                    <div key={i} className="flex items-start justify-between gap-3 bg-white border border-indigo-100 rounded-lg p-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800">{r.title || 'Untitled'}</div>
                        <div className="text-[10px] text-slate-500">{r.authors}{r.authors && r.journal ? ' · ' : ''}{r.journal}{r.year ? ` · ${r.year}` : ''}</div>
                        {r.doi && <div className="text-[10px] text-blue-600 break-all">{r.doi}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {r.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">PubMed</a>}
                        {r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">DOI</a>}
                        <button type="button" disabled={added || !defaultScientist} onClick={() => addPubResult(r)}
                                className="text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-default px-2 py-1 rounded">
                          {added ? '✓ Added' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="max-h-96 overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr>
                {pubCols.map((h, hi) => (
                  <th key={hi} className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPubs.length === 0 ? (
                <tr><td colSpan={pubCols.length} className="text-xs text-slate-400 italic px-3 py-3">No publications yet — use “Search &amp; Add publication” to fetch them from the web.</td></tr>
              ) : (
                filteredPubs.map((p, idx) => {
                  const isOpen = pubExpanded === p.id;
                  const links = usableLinks(p);
                  return (
                    <React.Fragment key={p.id}>
                      <tr className={`cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'} ${isOpen ? 'bg-indigo-50/60' : ''}`}
                          onClick={() => setPubExpanded(isOpen ? null : p.id)} title="Click to view / edit">
                        <td className="px-3 py-2 border-b border-slate-100 align-top">
                          <span className="text-xs font-bold text-slate-800">{p.scientist || '—'}</span>
                          {(p.coauthors || []).length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {p.coauthors.map((c) => (
                                <span key={c} className="text-[8px] font-bold px-1 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">@{c}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top">
                          <span className="text-xs font-semibold text-slate-800">{p.title || '—'}</span>
                          {excludedSet.has(pubExistsKey(p)) && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 ml-1 align-middle">🚫 excluded</span>
                          )}
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600"><span className="line-clamp-2">{p.authors || '—'}</span></td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600">{p.journal || '—'}</td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600">{p.year || '—'}</td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                          {links.length === 0 ? <span className="text-slate-300">—</span> : (
                            <div className="flex flex-col gap-0.5">
                              {links.slice(0, 2).map((l, i) => (
                                <a key={i} href={l.url} target="_blank" rel="noreferrer"
                                   className="text-blue-600 hover:underline text-[11px] truncate block max-w-[140px]" title={l.url}>
                                  {l.description || l.url}
                                </a>
                              ))}
                              {links.length > 2 && <span className="text-[10px] text-slate-400">+{links.length - 2} more</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                          <PubPdfCell p={p} path={['publications', p.scientist || '', 'own_publications']} fileSuffix={p.year || ''}
                                      onSetPdf={(pdf) => patchPub(p.id, { pdf })} />
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600"><span className="line-clamp-2">{p.comments || '—'}</span></td>
                        <td className="px-3 py-2 border-b border-slate-100 text-right align-top whitespace-nowrap">
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggleExcludePub(p); }}
                                  className={excludedSet.has(pubExistsKey(p)) ? 'text-red-600 text-xs px-1' : 'text-slate-300 hover:text-red-500 text-xs px-1'}
                                  title="Never add this entry again (belongs to another author with the same name)">🚫</button>
                          {canManageEntry(p.scientist) && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); removePub(p.id, p.title); }}
                                    className="text-red-400 hover:text-red-600 text-xs px-1" title="Delete publication">✕</button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-indigo-50/40">
                          <td colSpan={pubCols.length} className="px-4 py-3 border-b border-slate-200">
                            <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3">
                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">
                                Formatted citation {pubFormat.preset !== 'custom' ? `(${PUB_FORMAT_PRESETS[pubFormat.preset]?.label || pubFormat.preset})` : '(custom)'}
                              </div>
                              <div className="text-xs text-slate-800" dangerouslySetInnerHTML={{ __html: pubCitationHtml(p, pubFormat, citationScientists) || '—' }} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              <div>
                                <label className={labelCls}>Scientist (owner — fixed at insertion)</label>
                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">
                                  🔒 {p.scientist || '—'}
                                </div>
                              </div>
                              <div className="lg:col-span-2">
                                <label className={labelCls}>Title</label>
                                <input className={inputCls} value={p.title || ''} onChange={(e) => patchPub(p.id, { title: e.target.value })} placeholder="Article title" />
                              </div>
                              <div className="lg:col-span-2">
                                <label className={labelCls}>Authors</label>
                                <input className={inputCls} value={p.authors || ''} onChange={(e) => patchPub(p.id, { authors: e.target.value })} placeholder="e.g. Rossi M, Bianchi A…" />
                              </div>
                              <div className="lg:col-span-3">
                                <label className={labelCls}>Co-authors who are also users (the paper will appear under their names too)</label>
                                <div className="flex flex-wrap gap-1.5">
                                  {scientistOptions.filter((s) => s !== p.scientist).map((s) => {
                                    const on = (p.coauthors || []).includes(s);
                                    return (
                                      <button type="button" key={s}
                                              onClick={() => patchPub(p.id, {
                                                coauthors: on ? (p.coauthors || []).filter((c) => c !== s) : [...(p.coauthors || []), s]
                                              })}
                                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition ${on ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                        {on ? '✓ ' : ''}{s}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <label className={labelCls}>Journal</label>
                                <input className={inputCls} value={p.journal || ''} onChange={(e) => patchPub(p.id, { journal: e.target.value })} />
                              </div>
                              <div>
                                <label className={labelCls}>Year</label>
                                <input className={inputCls} value={p.year || ''} onChange={(e) => patchPub(p.id, { year: e.target.value })} />
                              </div>
                              <div>
                                <label className={labelCls}>DOI</label>
                                <input className={inputCls} value={p.doi || ''} onChange={(e) => patchPub(p.id, { doi: e.target.value })} placeholder="10.xxxx/…" />
                              </div>
                              <div>
                                <label className={labelCls}>Type</label>
                                <input className={inputCls} value={p.type || ''} onChange={(e) => patchPub(p.id, { type: e.target.value })} placeholder="e.g. research article, review" />
                              </div>
                              <div className="lg:col-span-3">
                                <label className={labelCls}>Comments</label>
                                <textarea className={`${inputCls} h-20`} value={p.comments || ''} onChange={(e) => patchPub(p.id, { comments: e.target.value })}
                                          placeholder="Personal notes, status (submitted / in revision / accepted)…" />
                              </div>
                              <div className="lg:col-span-3">
                                <LinksEditor links={p.links || []} setLinks={(ls) => patchPub(p.id, { links: ls })} />
                              </div>
                              <label className="lg:col-span-3 flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                                <input type="checkbox" checked={excludedSet.has(pubExistsKey(p))} onChange={() => toggleExcludePub(p)} className="w-3.5 h-3.5 accent-red-600" />
                                🚫 Never add this entry again — it belongs to another author with the same name
                              </label>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </section>

  );
  const paperCols = ['Labels', 'Title', 'Authors', 'Link', 'Scientist', 'PDF', 'Comments', ''];

  const renderPapers = () => (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-sky-50/50 border-b border-sky-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-sky-600 text-white text-sm shrink-0">📄</span>
          Relevant papers
          <span className="text-slate-400 font-bold">({papers.length})</span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wide">Labels (match all):</span>
          <button type="button" onClick={() => setPaperFilterLabels([])}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${paperFilterLabels.length === 0 ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            All
          </button>
          {paperSubjects.map((s) => (
            <button type="button" key={s}
                    onClick={() => setPaperFilterLabels((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${paperFilterLabels.includes(s) ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {paperFilterLabels.includes(s) ? '✓ ' : ''}{s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={paperFilterScientist} onChange={(e) => setPaperFilterScientist(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
            <option value="all">All scientists</option>
            {paperScientists.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={() => setShowAddPaper((v) => !v)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition">
            {showAddPaper ? 'Cancel' : '+ Add paper'}
          </button>
          <button type="button" onClick={() => setShowSubjectsMgr((v) => !v)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition">
            {showSubjectsMgr ? 'Close' : '⚙️ Subjects'}
          </button>
          {/* ⟳ Le même bouton que les publications des scientifiques : les
              papiers dont la liste d'auteurs est vide ou coupée par un « et al. »
              sont complétés — publications du laboratoire puis Crossref. */}
          <button type="button" onClick={completePaperAuthors} disabled={paperAuthorsFixing || papers.length === 0}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 disabled:opacity-40 transition"
                  title="Fetch the FULL author list of the relevant papers that show none, or that a journal cut with “et al.”: the lab publications first (offline), then Crossref by DOI — read in the link too — else by exact title. Their other empty fields (journal, year, volume, pages, DOI) are filled the same way.">
            {paperAuthorsFixing ? '⏳ Fetching authors…' : '⟳ Complete author lists'}
          </button>
        </div>
      </div>
      {paperAuthorsMsg && <div className="px-4 pt-3 text-xs font-semibold text-emerald-700">{paperAuthorsMsg}</div>}
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm text-slate-500">
          Curated relevant papers — add a publication with its link, label it with one or more topics
          (e.g. antimicrobial peptides, structure calculation, NMR methods). Everything is visible to everyone, but a
          paper can only be added under <b>your own name</b> (the logged-in user).
          Filter the list by labels and/or scientist — papers must match <b>all</b> the selected labels.
        </p>

      {showSubjectsMgr && (
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <span className="text-xs font-bold text-slate-600">Define the subjects used to classify papers</span>
            <div className="flex items-center gap-1.5">
              <input className="border border-slate-300 rounded px-2 py-1 text-xs w-44 bg-white outline-none focus:border-blue-500"
                     value={newSubject} onChange={(e) => setNewSubject(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') addSubject(); }} placeholder="New subject…" />
              <button type="button" onClick={addSubject} className="text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 px-2 py-1 rounded">Add</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {paperSubjects.map((s) => {
              const isDefault = DEFAULT_SUBJECTS.includes(s);
              const isUsed = papers.some((p) => paperLabelsOf(p).includes(s));
              return (
                <span key={s} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${subjectColor(s)}`}>
                  {s}
                  {!isDefault && (
                    <button type="button" onClick={() => removeSubject(s)} title="Remove subject"
                            className="text-red-600 hover:text-red-800 font-black">×</button>
                  )}
                  {isDefault && !isUsed && <span className="text-[8px] text-slate-400 font-normal">(default)</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="text-[10px] font-black text-slate-400 uppercase mb-2">🔎 Search the web for relevant papers</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className={labelCls}>Search query (keywords)</label>
              <input className={inputCls} value={paperQuery} onChange={(e) => setPaperQuery(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') doPaperSearch('pubmed'); }}
                     placeholder="e.g. antimicrobial peptides molecular dynamics" />
            </div>
            <div>
              <label className={labelCls}>Scientist (who inserts it) — logged user only</label>
              {defaultScientist ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-white border border-slate-300 rounded-lg px-2 py-1.5">
                  👤 {defaultScientist}
                  <span className="text-[9px] text-slate-400 font-semibold">(only you can add under your name)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5">
                  ⚠️ Log in to add relevant papers under your name
                </div>
              )}
            </div>
          </div>
          <div className="mt-2">
            <label className={labelCls}>Labels to apply to the new papers (select one or more)</label>
            <LabelChips labels={paperDraft.labels || []} options={paperSubjects}
                        onChange={(ls) => setPaperDraft((d) => ({ ...d, labels: ls }))}
                        placeholder="Type a new label…" />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="button" onClick={() => doPaperSearch('pubmed')} disabled={!paperQuery.trim() || paperSearching}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">🔍 PubMed</button>
            <button type="button" onClick={() => doPaperSearch('crossref')} disabled={!paperQuery.trim() || paperSearching}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">📚 Crossref</button>
          </div>
          {paperSearching && <div className="mt-2 text-xs font-bold text-blue-700 animate-pulse">⏳ Searching…</div>}
          {paperSearchError && <div className="mt-2 bg-red-50 border border-red-300 text-red-700 rounded-lg p-2 text-xs font-semibold">⚠️ {paperSearchError}</div>}
          {paperResults.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-3 mb-1">
                <span className="text-xs font-bold text-slate-600">{paperResults.length} result(s)</span>
                <button type="button" onClick={addAllPaperResults} disabled={!defaultScientist}
                        className="text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 px-2.5 py-1 rounded">
                  ⤵ Insert all ({paperResults.length})
                </button>
              </div>
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto custom-scrollbar">
                {paperResults.map((r, i) => {
                  const added = addedPaperKeys.includes(paperKey(r));
                  return (
                    <div key={i} className="flex items-start justify-between gap-3 bg-white border border-blue-100 rounded-lg p-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800">{r.title || 'Untitled'}</div>
                        <div className="text-[10px] text-slate-500">{r.authors}{r.authors && r.journal ? ' · ' : ''}{r.journal}{r.year ? ` · ${r.year}` : ''}</div>
                        {r.doi && <div className="text-[10px] text-blue-600 break-all">{r.doi}</div>}
                      </div>
                      <button type="button" disabled={added || !defaultScientist} onClick={() => addPaperResult(r)}
                              className="text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-default px-2 py-1 rounded shrink-0">
                        {added ? '✓ Added' : '+ Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

      {showAddPaper && (
        <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className={labelCls}>Title *</label>
              <input className={inputCls} value={paperDraft.title} onChange={(e) => setPaperDraft({ ...paperDraft, title: e.target.value })}
                     placeholder="Paper title" />
            </div>
            <div className="lg:col-span-2">
              <label className={labelCls}>Link / DOI *</label>
              <input className={inputCls} value={paperDraft.link} onChange={(e) => setPaperDraft({ ...paperDraft, link: e.target.value })}
                     placeholder="https://doi.org/… or 10.xxxx/…" />
            </div>
            <div className="lg:col-span-2">
              <label className={labelCls}>Authors (all of them — lab members and outside co-authors)</label>
              <input className={inputCls} value={paperDraft.authors} onChange={(e) => setPaperDraft({ ...paperDraft, authors: e.target.value })}
                     placeholder="e.g. Rossi M, Bianchi A, Smith J…" />
            </div>
            <div>
              <label className={labelCls}>Year</label>
              <input className={inputCls} value={paperDraft.year} onChange={(e) => setPaperDraft({ ...paperDraft, year: e.target.value })}
                     placeholder="2024" />
            </div>
            <div className="lg:col-span-3">
              <label className={labelCls}>Labels (select one or more — e.g. antimicrobial peptides, structure calculation, NMR methods)</label>
              <LabelChips labels={paperDraft.labels || []} options={paperSubjects}
                          onChange={(ls) => setPaperDraft((d) => ({ ...d, labels: ls }))}
                          placeholder="Type a new label…" />
            </div>
            <div>
              <label className={labelCls}>Scientist (who inserts it) — logged user only</label>
              {defaultScientist ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-white border border-slate-300 rounded-lg px-2 py-1.5">
                  👤 {defaultScientist}
                  <span className="text-[9px] text-slate-400 font-semibold">(only you can add under your name)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5">
                  ⚠️ Log in to add relevant papers under your name
                </div>
              )}
            </div>
            <div className="lg:col-span-2">
              <label className={labelCls}>Comments (optional)</label>
              <input className={inputCls} value={paperDraft.comments} onChange={(e) => setPaperDraft({ ...paperDraft, comments: e.target.value })}
                     placeholder="Why is it relevant?" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setShowAddPaper(false)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
              Cancel
            </button>
            <button type="button" onClick={addPaper} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              + Add paper
            </button>
          </div>
        </div>
      )}

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="max-h-96 overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr>
                {paperCols.map((h, hi) => (
                  <th key={hi} className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPapers.length === 0 ? (
                <tr><td colSpan={paperCols.length} className="text-xs text-slate-400 italic px-3 py-3">No relevant papers yet — use “+ Add paper” to insert the first one.</td></tr>
              ) : (
                filteredPapers.map((p, idx) => {
                  const isOpen = paperExpanded === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr className={`cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'} ${isOpen ? 'bg-indigo-50/60' : ''}`}
                          onClick={() => setPaperExpanded(isOpen ? null : p.id)} title="Click to view / edit">
                        <td className="px-3 py-2 border-b border-slate-100 align-top">
                          <div className="flex flex-wrap gap-1">
                            {paperLabelsOf(p).length === 0 ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">—</span>
                            ) : (
                              paperLabelsOf(p).map((l, i) => (
                                <span key={i} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${subjectColor(l)}`}>{l}</span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top"><span className="text-xs font-semibold text-slate-800">{p.title || '—'}</span></td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600"><span className="line-clamp-2">{p.authors || '—'}</span></td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                          {p.link ? (
                            <a href={normalizeLink(p.link)} target="_blank" rel="noreferrer"
                               className="text-blue-600 hover:underline text-[11px] truncate block max-w-[200px]" title={p.link}>
                              {p.link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || p.link}
                            </a>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600">{p.scientist || '—'}</td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                          <PubPdfCell p={p} path={['publications', p.scientist || '', 'relevant_publications']} fileSuffix={p.labels || []}
                                      onSetPdf={(pdf) => patchPaper(p.id, { pdf })} />
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600"><span className="line-clamp-2">{p.comments || '—'}</span></td>
                        <td className="px-3 py-2 border-b border-slate-100 text-right align-top whitespace-nowrap">
                          {canManageEntry(p.scientist) && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); removePaper(p.id, p.title); }}
                                    className="text-red-400 hover:text-red-600 text-xs px-1" title="Delete paper">✕</button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-indigo-50/40">
                          <td colSpan={paperCols.length} className="px-4 py-3 border-b border-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              <div className="lg:col-span-2">
                                <label className={labelCls}>Title</label>
                                <input className={inputCls} value={p.title || ''} onChange={(e) => patchPaper(p.id, { title: e.target.value })} />
                              </div>
                              <div className="lg:col-span-2">
                                <label className={labelCls}>Authors (all of them — lab members and outside co-authors)</label>
                                <input className={inputCls} value={p.authors || ''} onChange={(e) => patchPaper(p.id, { authors: e.target.value })}
                                       placeholder="e.g. Rossi M, Bianchi A, Smith J…" />
                              </div>
                              <div>
                                <label className={labelCls}>Year</label>
                                <input className={inputCls} value={p.year || ''} onChange={(e) => patchPaper(p.id, { year: e.target.value })} placeholder="2024" />
                              </div>
                              <div className="lg:col-span-3">
                                <label className={labelCls}>Labels (select one or more)</label>
                                <LabelChips labels={paperLabelsOf(p)} options={paperSubjects}
                                            onChange={(ls) => patchPaper(p.id, { labels: ls })} />
                              </div>
                              <div className="lg:col-span-2">
                                <label className={labelCls}>Link / DOI</label>
                                <input className={inputCls} value={p.link || ''} onChange={(e) => patchPaper(p.id, { link: e.target.value })}
                                       placeholder="https://doi.org/…" />
                              </div>
                              <div>
                                <label className={labelCls}>Scientist (who inserted it — fixed at insertion)</label>
                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">
                                  🔒 {p.scientist || '—'}
                                </div>
                              </div>
                              <div className="lg:col-span-3">
                                <label className={labelCls}>Comments</label>
                                <textarea className={`${inputCls} h-16`} value={p.comments || ''}
                                          onChange={(e) => patchPaper(p.id, { comments: e.target.value })}
                                          placeholder="Why is it relevant?" />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </section>
  );
  const PUB_FIELD_LABELS = {
    authors: 'Authors', year: 'Year', title: 'Title', journal: 'Journal',
    volume: 'Volume', pages: 'Pages', doi: 'DOI'
  };
  // The format being edited: the default (global) or a specific project's own format
  const scopedProject = pubFormatScope !== 'default' ? myProjects.find((p) => p.name === pubFormatScope) : null;
  const activeFormat = (scopedProject && scopedProject.pubFormat) || pubFormat;
  const setActiveFormat = (fmt) => {
    if (pubFormatScope === 'default') {
      setPubFormat(fmt);
      /* LE FORMAT PAR DÉFAUT VAUT POUR TOUT LE MONDE — y compris les projets qui
         portaient leur PROPRE copie du format. Cette copie était figée : elle
         gardait la mise en forme du jour où elle avait été choisie, et changer
         le format ensuite ne touchait plus les publications du projet
         (« je change les paramètres et les publications déjà dans le projet ne
         bougent pas »). Elle suit donc le défaut ; un projet qui doit garder son
         format à lui se choisit dans « Format for: » — et là, seul ce projet
         change (voir la ligne du dessous). */
      setPbProjects((prev) => prev.map((p) => (p.pubFormat ? { ...p, pubFormat: fmt } : p)));
    } else {
      setPbProjects((prev) => prev.map((p) => (p.name === pubFormatScope ? { ...p, pubFormat: fmt } : p)));
    }
  };
  /* CE QUI N'APPARTIENT PAS À LA CITATION — le journal choisi (« Journal preset »,
     groupe « Journal »), l'ordre
     de ses sections et l'intitulé de sa bibliographie, puis L'ORDRE ET LES INTITULÉS DES
     BLOCS DU DOCUMENT (voir PUB_DOC_BLOCKS). Un réglage de CITATION (un champ, la police
     du corps, les noms des membres du laboratoire…) ne doit jamais les perdre : le
     panneau promet « everything stays editable below », et changer un champ ne peut ni
     décrocher le journal ni remettre le document dans l'ordre du programme. */
  const pubDocSettings = (fmt) => ({
    ...(fmt && fmt.journal ? { journal: fmt.journal } : {}),
    ...(fmt && Array.isArray(fmt.order) ? { order: fmt.order.slice() } : {}),
    ...(fmt && typeof fmt.bibLabel === 'string' ? { bibLabel: fmt.bibLabel } : {}),
    docOrder: normalizePubDocOrder(fmt && fmt.docOrder),
    docTitles: normalizePubDocTitles(fmt && fmt.docTitles),
    /* …ET LES INTITULÉS QUE LE FORMAT NE VEUT PAS (une case décochée au panneau, un
       style qui n'écrit pas ce titre — voir normalizePubDocNoTitle) : régler un champ
       de la citation ne doit pas les rallumer. */
    docNoTitle: normalizePubDocNoTitle(fmt && fmt.docNoTitle)
  });
  const pubCustomFormat = (fields) => ({
    ...pubDocSettings(activeFormat),
    preset: 'custom',
    /* LE NOM DU STYLE ENREGISTRÉ QUE CE FORMAT VIENT DE RAPPELER (« My styles ») : il
       reste affiché pendant qu'on retouche le format, pour que 💾 sache sous quel nom
       réécrire. Choisir un journal ou un preset l'efface (c'est un autre choix). */
    style: activeFormat.style || '',
    etAlLimit: activeFormat.etAlLimit || 0,
    alwaysShowScientists: !!activeFormat.alwaysShowScientists,
    underlineScientists: !!activeFormat.underlineScientists,   // legacy default style
    scientistStyles: { ...(activeFormat.scientistStyles || {}) },
    inTextStyle: normalizeInTextStyle(activeFormat.inTextStyle),
    /* LA FORME DES NOMS D'AUTEURS voyage avec le format : sans cette ligne, régler
       un champ de la citation la remettrait à « as written ». */
    nameStyle: normalizeNameStyle(activeFormat.nameStyle),
    layout: normalizePubLayout(activeFormat.layout),
    fields
  });
  const pubPatchField = (fieldId, patch) =>
    setActiveFormat(pubCustomFormat(activeFormat.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f))));
  const pubPatchFormat = (patch) =>
    setActiveFormat({ ...pubCustomFormat(activeFormat.fields), ...patch });
  // Style of one lab member in the citation ('none' | 'underline' | 'bold').
  // All the authors of the paper stay listed: this only decides how that
  // member's name is dressed up wherever it appears in the author list.
  const pubSetScientistStyle = (name, style) => {
    const key = String(name || '').trim();
    if (!key || !AUTHOR_STYLE_IDS.includes(style)) return;
    const next = { ...(activeFormat.scientistStyles || {}), [key]: style };
    setActiveFormat({ ...pubCustomFormat(activeFormat.fields), scientistStyles: next });
  };
  // Bulk choice: it writes the style for every known lab member and clears the
  // legacy « underline all lab scientists » flag it then replaces.
  const pubSetAllScientistStyles = (style) => {
    if (!AUTHOR_STYLE_IDS.includes(style)) return;
    const next = {};
    citationScientists.forEach((n) => { next[n] = style; });
    setActiveFormat({
      ...pubCustomFormat(activeFormat.fields), scientistStyles: next, underlineScientists: false
    });
  };
  /* ── LA MISE EN FORME DU DOCUMENT D'UN PROJET (voir pubLayoutCss) ──────────
     « vorrei poter scegliere font, police, posizione, stile, colore … per le
     figure le stesse cose », et que cela « si applichi al progetto come per le
     citazioni ». Chaque réglage vit dans le format (`layout.<partie>`) : le
     panneau en montre une ligne par partie du document, avec un aperçu vivant,
     et la page du projet — document imprimé et PDF compris — le suit. */
  const pubSetLayout = (partId, patch) => {
    const layout = normalizePubLayout(activeFormat.layout);
    if (!layout[partId]) return;
    setActiveFormat({
      ...pubCustomFormat(activeFormat.fields),
      layout: { ...layout, [partId]: { ...layout[partId], ...patch } }
    });
  };
  /* Le style d'un texte a TROIS états : non touché (comme le programme),
     imposé, ou explicitement retiré — un titre, que le programme écrit en gras,
     doit pouvoir redevenir normal. Un clic avance d'un état. */
  const pubToggleLayoutStyle = (partId, key) => {
    const layout = normalizePubLayout(activeFormat.layout);
    const current = layout[partId] ? layout[partId][key] : null;
    pubSetLayout(partId, { [key]: current === true ? false : current === false ? null : true });
  };
  const pubResetLayout = (partId) => {
    const layout = normalizePubLayout(activeFormat.layout);
    setActiveFormat({
      ...pubCustomFormat(activeFormat.fields),
      layout: { ...layout, [partId]: buildPubLayout()[partId] }
    });
  };
  const pubResetAllLayout = () => setActiveFormat({ ...pubCustomFormat(activeFormat.fields), layout: buildPubLayout() });
  /* ── L'ORDRE ET LES INTITULÉS DES BLOCS DU DOCUMENT (voir PUB_DOC_BLOCKS) ─────
     La demande : « In the publication format I cannot change the order of the sections
     nor change the titles of the subsections. I want to be able for example to put the
     author before the title or change the name of “materials and methods” into
     “experimental section” or whatever. »
     ON GLISSE UNE RANGÉE SUR UNE AUTRE (« movable by drag and drop rather than
     arrows ») : elle prend sa place (pubDocOrderDropped), le champ écrit l'intitulé
     d'un bloc que le PROGRAMME nomme (« Materials and Methods », « Experiments »,
     « References »), ↺ remet l'ordre et les intitulés du programme. Rien de tout cela
     ne touche au texte de l'auteur : seuls l'ORDRE des blocs et les intitulés que le
     programme écrit lui-même changent. */
  const docOrder = normalizePubDocOrder(activeFormat.docOrder);
  const docTitles = normalizePubDocTitles(activeFormat.docTitles);
  /* LES INTITULÉS QUE LE FORMAT NE VEUT PAS (voir normalizePubDocNoTitle) : la case de
     la rubrique « References (citation & bibliography) » les décoche, et un style peut
     les décocher pour nous (Science) ; le document n'écrit alors aucun `<h2>` pour ces
     blocs — leur texte, leurs figures et leur place restent. */
  const docNoTitle = normalizePubDocNoTitle(activeFormat.docNoTitle);
  const pubDropDocBlock = (targetId) => {
    const moved = pubDocOrderDropped(docOrder, pubDocDragId, targetId);
    if (moved.join('|') !== docOrder.join('|')) pubPatchFormat({ docOrder: moved });
    setPubDocDragId('');
    setPubDocOverId('');
  };
  const pubSetDocTitle = (id, value) => pubPatchFormat({
    /* Le texte est gardé TEL QUEL pendant la frappe (un espace en fin de mot ne doit pas
       disparaître sous les doigts) : c'est pubDocTitleOf qui le nettoie à l'affichage. */
    docTitles: { ...docTitles, [id]: String(value == null ? '' : value).replace(/[<>]/g, '').slice(0, 120) }
  });
  const pubResetDocSections = () => pubPatchFormat({ docOrder: buildPubDocOrder(), docTitles: buildPubDocTitles() });
  /* LE CHOIX « Bibliography style — the references only » N'EST PLUS. La demande :
     « You can remove the “bibliography style - reference only” subsection of the
     drop-down menu because now it has become obsolete. » Chaque journal porte en effet
     SA forme de citation (son `preset`, appliqué par pubSetJournal) : choisir la
     citation toute seule ne disait donc plus rien de plus, et la forme d'une référence
     reste réglable champ par champ, dans la rubrique des références ci-dessous. */

  /* APPLIQUER UN JOURNAL — les TROIS choses du changement de journal d'un coup (la
     demande : « l'ordine delle sezioni, il formato della bibliografia, il carattere
     delle varie sezioni »). La citation est reconstruite comme le fait « Journal
     preset », donc les champs de la bibliographie changent vraiment; le caractère
     de chaque partie vient du journal; l'ordre des sections est écrit dans le
     format (order) pour l'export du document. Le reste — styles des noms des
     membres, forme des renvois dans le texte, largeurs déjà réglées — est CONSERVÉ :
     applyJournalFormat copie le format de l'utilisateur. « As in the app » retire
     ces réglages et rend le document tel qu'il était avant le changement. */
  const pubSetJournal = (id) => {
    if (!id) { setActiveFormat(clearJournalFormat(activeFormat, buildPubLayout())); return; }
    const def = JOURNAL_FORMATS[id];
    if (!def) { setActiveFormat(activeFormat); return; }
    const withPreset = applyJournalFormat({
      ...activeFormat,
      ...buildPubFormat(def.preset),
      /* L'ORDRE ET LES INTITULÉS DES BLOCS DU DOCUMENT RESTENT À L'UTILISATEUR : le
         journal qui arrive apporte sa citation, le caractère de ses parties et l'ordre
         de SES sections (voir `order`), pas la structure du document de quelqu'un
         d'autre. « ↺ Default order & titles » les remet à ceux du programme. */
      docOrder: normalizePubDocOrder(activeFormat.docOrder),
      docTitles: normalizePubDocTitles(activeFormat.docTitles)
    }, id);
    setActiveFormat({ ...withPreset, layout: normalizePubLayout(withPreset.layout) });
  };

  /* « Journal preset: » EST LE CONTROLE DU JOURNAL — un seul, pour que sa fonction
     soit claire : une seule liste, avec ses groupes visibles, dit ce que chaque
     choix change, et l'aperçu comme le document suivent. Il porte donc
     DEUX natures d'options, en deux groupes visibles (le groupe « Bibliography style —
     the references only » a DISPARU : la demande « You can remove the “bibliography
     style - reference only” subsection of the drop-down menu because now it has become
     obsolete », puisque chaque journal porte sa forme de citation et que les champs d'une
     référence se règlent plus bas) :
       • `journal:<id>`  — un JOURNAL entier, qui refait d'un coup la citation, le
                           caractère de chaque partie du document, L'ORDRE de ses sections
                           et LES INTITULÉS qu'il leur donne (pubSetJournal ; c'est lui
                           qui écrit « Introduction » là où la revue l'écrit ainsi) ;
                           `journal:` = « As in the app » (aucun journal).
       • `style:<nom>`   — UN STYLE QUE L'UTILISATEUR A SAUVEGARDÉ, sous le groupe
                           « User defined » :
                           tout le format d'un coup, tel qu'il l'a mis de côté
                           (pubRecallStyle). C'est la réponse à « when I click on
                           custom I will be able to define other styles that I must be
                           able to save and recall. »
     La valeur affichée suit ces deux-là (un style rappelé reste affiché, même si les
     champs se règlent ensuite à la main). */
  const pubJournalChoice = (fmt) => {
    const style = fmt && fmt.style && pubStyles[fmt.style] ? fmt.style : '';
    if (style) return `style:${style}`;
    return fmt && fmt.journal ? `journal:${fmt.journal}` : 'journal:';
  };
  const pubSetJournalChoice = (value) => {
    const v = String(value || '');
    if (v.startsWith('style:')) pubRecallStyle(v.slice('style:'.length));
    else pubSetJournal(v.slice('journal:'.length));
  };
  /* ── LES STYLES SAUVEGARDÉS (le groupe « User defined ») ─────────────────────
     💾 SAUVEGARDER le format affiché sous un nom (celui du style rappelé est proposé,
     sinon celui du journal) ; 🗑 OUBLIER le style affiché ; la liste du contrôle les
     propose dans son groupe « User defined » (la demande : « I must be able to save new
     settings with a different name and this name must appear in the drop-down menu under
     a subsection: user defined. »). Sauver sous un nom déjà pris le REMPLACE, un nom
     NOUVEAU s'ajoute à côté des autres — c'est ce que l'utilisateur demande en le tapant. */
  const pubStyleName = () => activeFormat.style
    || (journalOf(activeFormat) ? journalLabelOf(journalOf(activeFormat)) : '');
  const pubSaveStyle = () => {
    let name = '';
    try {
      name = window.prompt('Save this publication format — its name appears in the “User defined” group (type a NEW name to keep this one beside the others):', pubStyleName()) || '';
    } catch { name = ''; }
    if (!String(name).trim()) return;
    const styles = savePubStyle(name, activeFormat);
    setPubStyles(styles);
    const key = Object.keys(styles).find((k) => k.toLowerCase() === String(name).trim().toLowerCase())
      || String(name).trim();
    /* LE FORMAT AFFICHÉ DEVIENT CE STYLE (il en porte le nom) : la liste le montre, et
       💾 le réécrira sous ce nom-là. */
    setActiveFormat({ ...activeFormat, style: key });
    setPubStyleMsg(`💾 saved “${key}” — it is in “User defined”, and it follows you on the Drive`);
  };
  const pubForgetStyle = () => {
    const key = activeFormat.style;
    if (!key) return;
    let go = true;
    try {
      go = window.confirm(`Forget the style “${key}”? The format you are using stays as it is — only the saved copy goes.`);
    } catch { go = false; }
    if (!go) return;
    setPubStyles(removePubStyle(key));
    setActiveFormat({ ...activeFormat, style: '' });
    setPubStyleMsg(`🗑 “${key}” forgotten (the format in use is untouched)`);
  };
  /** RAPPELER UN STYLE : le format enregistré devient celui qui s'applique — citation,
     caractère des parties, ordre ET intitulés des sections, renvois du texte. Un nom
     qui n'existe plus (oublié sur un autre poste) ne rappelle rien. */
  const pubRecallStyle = (name) => {
    const stored = pubStyles[String(name || '')];
    if (!stored) { setActiveFormat(activeFormat); return; }
    setActiveFormat({ ...stored, style: stored.style || String(name) });
    setPubStyleMsg(`↺ “${stored.style || name}” is back: citation, typography, section order and titles`);
  };

  const pubMoveField = (fieldId, dir) => {
    const fields = [...activeFormat.fields].sort((a, b) => a.order - b.order);
    const idx = fields.findIndex((f) => f.id === fieldId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= fields.length) return;
    const tmp = fields[idx].order;
    fields[idx] = { ...fields[idx], order: fields[j].order };
    fields[j] = { ...fields[j], order: tmp };
    setActiveFormat(pubCustomFormat(fields));
  };
  // Add a field (e.g. DOI) that is not part of the current format yet.
  const pubAddNewField = () => {
    if (!pubAddField || activeFormat.fields.some((f) => f.id === pubAddField)) return;
    const maxOrder = activeFormat.fields.reduce((m, f) => Math.max(m, f.order), -1);
    setActiveFormat(pubCustomFormat([
      ...activeFormat.fields,
      { id: pubAddField, enabled: true, order: maxOrder + 1, style: 'normal', prefix: '', suffix: '' }
    ]));
    // Keep the dropdown on a field that is still missing (never the one just added).
    setPubAddField((prev) => {
      const stillMissing = Object.keys(PUB_FIELD_LABELS).filter(
        (id) => id !== prev && !activeFormat.fields.some((f) => f.id === id)
      );
      return stillMissing.length ? stillMissing[0] : prev;
    });
  };
  // Sample citation: a realistic long author list, extended with the current
  // lab members so the “et al.” / always-show / per-scientist style options are
  // all visible in the preview. The first lab member sits near the top of the
  // list, so their underline / bold shows whatever the cutoff is.
  const samplePub = useMemo(() => {
    const baseAuthors = ['Rossi M', 'Bianchi A', 'Smith J', 'Verdi G', 'Müller K', 'Suzuki H', 'Almeida P', 'Costa L'];
    const mine = citationScientists
      .filter((s) => s && !baseAuthors.some((b) => authorMatchesCandidate(b, s)))
      .slice(0, 3);
    const authors = [...baseAuthors];
    if (mine.length) authors.splice(1, 0, mine[0]);
    return {
      authors: [...authors, ...mine.slice(1)].join(', '),
      year: '2024', title: 'Structure and dynamics of antimicrobial peptides in lipid bilayers',
      journal: 'Journal of Biological Chemistry', volume: '300', pages: '105678', doi: '10.1016/j.jbc.2024.105678'
    };
  }, [citationScientists]);

  /* L'APERÇU de la forme choisie pour les renvois du texte : il passe par le
     moteur RÉEL (inTextCitationHtml, utils/referenceLinks.js) sur deux
     références de démonstration. « as written », lui, n'a pas de forme à
     montrer : l'exemple dit simplement que le document garde son écriture. */
  const inTextSampleRefs = [
    { number: 1, authors: 'Rossi M, Bianchi A', year: '2018' },
    { number: 2, authors: 'Dupont J', year: '2020' }
  ];
  const inTextSample = (style) => {
    if (!style || style === 'keep') {
      return 'As shown previously\u00b9\u00b2 — or [12], or (12) — exactly as the document wrote it.';
    }
    const one = (n) => inTextCitationHtml([n], {
      style, refs: inTextSampleRefs, hrefFor: () => '#ref-1'
    });
    return `As shown previously${one(1)}, and elsewhere${one(2)}.`;
  };

  const renderPubFormat = () => (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-indigo-50/50 border-b border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h2 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white shrink-0"><Icon name="🎨" size={16} /></span>
          Publication format
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[10px] font-black uppercase tracking-wide text-slate-400">Format for:</label>
          <select value={pubFormatScope} onChange={(e) => setPubFormatScope(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
            <option value="default">🌍 Default (all publications)</option>
            {myProjects.map((prj) => (
              <option key={prj.id} value={prj.name}>📁 {prj.name}{prj.pubFormat ? ' ✎' : ''}</option>
            ))}
          </select>
          <label className="text-[10px] font-black uppercase tracking-wide text-slate-400"
                 title="The journal the paper is meant for. One control, two groups: a JOURNAL changes the citation style, the character (font, size, alignment, bold, italic), the ORDER of the sections and the TITLES it gives them, all in one click; the styles you saved (User defined) put a whole format of your own back.">
            Journal preset:
          </label>
          <select value={pubJournalChoice(activeFormat)} onChange={(e) => pubSetJournalChoice(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
                  title="Send the SAME work to another journal in one click: the citation and the bibliography style, the character (font, size, alignment, bold, italic) of every part of a project document, the ORDER of its sections and the NAMES it gives them (« Scientific background » becomes « Introduction ») change together — and a journal whose reference list carries no heading leaves that heading unticked below. Everything stays editable below, and « As in the app » puts the document back the way it was.">
            <optgroup label="Journal — references, typography, section order and titles">
              <option value="journal:">↺ As in the app (no journal)</option>
              {JOURNAL_IDS.map((id) => (
                <option key={id} value={`journal:${id}`}>{JOURNAL_FORMATS[id].label}</option>
              ))}
            </optgroup>
            {/* LES STYLES QUE L'UTILISATEUR A SAUVEGARDÉS (« Custom » à rappeler) :
                le nom rappelle TOUT le format d'un coup, et 💾/🗑 juste à côté les
                sauvent ou les oublient. */}
            <optgroup label="User defined">
              {Object.keys(pubStyles).length === 0 ? (
                <option value="style:" disabled>· none saved yet — 💾 saves the format shown ·</option>
              ) : (
                Object.keys(pubStyles).map((name) => (
                  <option key={name} value={`style:${name}`}>{name}</option>
                ))
              )}
            </optgroup>
          </select>
          <button type="button" onClick={pubSaveStyle}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                  title="Save the publication format shown (citation, typography, section order and titles, headings you unticked, in-text style) under a name: it appears in “User defined”, here and on every computer (it follows you on the Drive). Type a NEW name and this format is kept beside the others; saving under a name that already exists replaces it.">
            💾 Save style…
          </button>
          {activeFormat.style && (
            <button type="button" onClick={pubForgetStyle}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
                    title="Forget the saved style shown. The format you are using stays exactly as it is — only the saved copy goes.">
              🗑 Forget “{activeFormat.style}”
            </button>
          )}
          {pubStyleMsg && (
            <span className="text-[10px] italic text-slate-500 max-w-[20rem] truncate" title={pubStyleMsg}>{pubStyleMsg}</span>
          )}
          {journalOf(activeFormat) && (
            <span className="text-[10px] italic text-slate-500 max-w-[22rem] truncate"
                  title={`${JOURNAL_FORMATS[journalOf(activeFormat)].notes} — sections of the exported document, in this journal's order: ${journalSectionOrder(activeFormat).join(' → ')}. A title this journal does not name does not move, and every setting stays editable in the panel below.`}>
              📰 {journalLabelOf(journalOf(activeFormat))}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {/* L'APERÇU VIVANT — LE DOCUMENT DU PROJET (il REMPLACE l'ancien aperçu de
            la seule citation, « Live preview — default », qui ne montrait ni la mise
            en forme ni l'ordre des sections — la demande : « the following "Live
            preview — default" subsection is obsolete and it should be substituted by
            the "Live preview — project document" section »). C'est le MÊME moteur que
            la page du projet : la feuille de style en cours de réglage (pubLayoutCss)
            sur une tête de document, ses sections, sa figure et sa bibliographie. */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1"
               title="What the project document will look like: the live sheet of the settings below, on a document that has the same parts as a project's.">
            Live preview — project document{pubFormatScope !== 'default' ? ` (project “${pubFormatScope}”)` : ' (default format)'}
          </div>
          <div id="pub-layout-preview" className="bg-white border border-slate-200 rounded-lg p-3">
            <style>{pubLayoutCss(activeFormat, '#pub-layout-preview')}</style>
            {/* LA TÊTE COMME LE DOCUMENT FINAL LA LIT : le titre, une LIGNE VIDE, les
                auteurs, une LIGNE VIDE, les affiliations, une LIGNE VIDE, la ligne
                d'information — « in the final document the list of authors must be
                separated by the title with one empty line. an empty line must also
                separate the authors from the affiliations. » puis « in the formatted
                paper there must be an empty line after the affiliations. » La ligne vide
                est le même paragraphe que la page du projet écrit (voir
                DOC_EMPTY_LINE_CLASS, journalFormats.js) : l'aperçu ne peut pas promettre
                autre chose que le document. */}
            <h1 className="pf-title text-lg font-black text-slate-800 mb-1">Antimicrobial peptides in lipid bilayers</h1>
            <div className={DOC_EMPTY_LINE_CLASS} aria-hidden="true">&nbsp;</div>
            <p className="pf-authors text-xs font-semibold text-slate-700">
              Rossi M<sup>1,2</sup>, Bianchi A<sup>3</sup>, Smith J<sup>1</sup>
            </p>
            <div className={DOC_EMPTY_LINE_CLASS} aria-hidden="true">&nbsp;</div>
            <p className="pf-affiliations text-[10px] text-slate-500 italic whitespace-pre-line mb-2">
              1 Dipartimento di Agraria, Portici, Italy{'\n'}3 INRAE, Villenave d’Ornon, France
            </p>
            <div className={DOC_EMPTY_LINE_CLASS} aria-hidden="true">&nbsp;</div>
            <p className="pf-meta text-[10px] text-slate-500 mb-2">Project: Aphid · Scientist: Rossi M</p>
            {/* L'INTITULÉ DE LA SECTION SUIT LE PANNEAU : renommer « Results and
                discussion » (ou choisir un journal qui l'appelle autrement) se voit ici,
                comme dans le document. */}
            <h2 className="pf-heading text-sm font-black text-slate-800 border-b border-slate-200 pb-1 mb-1">{docTitles.discussion || 'Results and Discussion'}</h2>
            <p className="pf-body text-xs text-slate-800 mb-2">
              The peptides were tested against <i>M. persicae</i>; the activity was confirmed previously
              <sup><a className="cite-ref" href="#ref-1" data-ref="1">1</a></sup>.
            </p>
            <figure className="pf-figure m-0">
              <div className="border border-slate-200 rounded bg-white h-10 flex items-center justify-center text-[10px] text-slate-400">
                🖼 figure
              </div>
              <figcaption className="pf-caption text-[10px] text-slate-500 mt-1">
                Figure 1. Aphid transmission of the virus.
              </figcaption>
            </figure>
            {/* L'INTITULÉ DE LA BIBLIOGRAPHIE SE VOIT ICI AUSSI : la case de la rubrique
                « References (citation & bibliography) » (et un style qui n'en écrit pas,
                Science) le retire — l'aperçu ne peut pas promettre autre chose que le
                document. */}
            {!docNoTitle.includes('references') && (
              <h2 className="pf-heading text-sm font-black text-slate-800 border-b border-slate-200 pb-1 mb-1 mt-2">{docTitles.references || 'References'}</h2>
            )}
            {/* LA RÉFÉRENCE DE L'APERÇU EST UNE VRAIE CITATION — rendue par le MÊME
                moteur que la page du projet (pubCitationHtml) : les champs cochés
                (le titre, que Science décoche), leur ordre, leur caractère,
                l'écriture des noms et le style des membres du laboratoire s'y
                voient tout de suite. La demande : « se imposto uno stile di
                giornale… questo non ha effetto sulla zona delle references » —
                l'aperçu ne peut pas montrer autre chose que ce que le document
                imprimera. */}
            <ol className="pf-bib list-decimal pl-4 text-[10px] text-slate-800 mt-2 space-y-0.5">
              <li dangerouslySetInnerHTML={{ __html: pubCitationHtml(samplePub, activeFormat, citationScientists) }} />
            </ol>
          </div>
        </div>

        {/* LES RÉGLAGES DES RÉFÉRENCES SONT PLUS BAS (« the settings of references
            must follow » la mise en forme et les sections du document). */}

        {/* LES MEMBRES DU LABORATOIRE DANS LA CITATION SONT PLUS BAS : la demande
            « followed by the “Lab members in the citation” » les met APRÈS les
            réglages des références. */}

        {/* ══ LA MISE EN FORME *ET* LES SECTIONS DU DOCUMENT, DANS UNE CARTE ═══════
            La demande : « The “document layout” section must be fused with the
            “document sections” ». Ce sont les deux faces de la même chose : le
            CARACTÈRE de chaque partie du document (ci-dessous) et l'ORDRE de ces
            parties dans le document (la rubrique qui suit, dans cette même carte,
            avec ses intitulés). « il formato del testo per le varie sezioni » :
            police, taille, position (gauche / centré / droite / justifié), style
            (gras, italique, souligné) et couleur — figures comprises. Comme la forme
            des renvois, le choix vit dans le format et s'applique à la page du
            projet, à son document imprimé, à son PDF et à son export (voir
            pubLayoutCss : une seule feuille de style, écrite ici). */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400"
                  title="Formatting of the project document — font, size, position (left / centre / right / justified), style (bold, italic, underlined) and colour of every part, figures included — AND the order and titles of its sections (just below). Nothing is imposed until you choose it.">
              Document layout & sections (project document)
            </span>
            <button type="button" onClick={pubResetAllLayout}
                    className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200"
                    title="Remove every formatting choice: the project document goes back to the look of the app">
              ↺ Reset all
            </button>
          </div>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5"
               title="One row per part of the document: font family, size in points, position (left / centre / right / justified), bold / italic / underlined (three states: imposed, removed, as in the app) and colour.">
            Formatting of every part
          </div>
          <div className="flex flex-col gap-1.5">
            {PUB_LAYOUT_PARTS.map((part) => {
              const st = normalizePubLayout(activeFormat.layout)[part.id];
              const styled = pubTextStyleIsSet(st);
              return (
                <div key={part.id}
                     className={`flex flex-wrap items-center gap-1.5 border rounded-lg px-2 py-1.5 ${
                       styled ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-100'}`}>
                  <span className="w-32 text-xs font-bold text-slate-700">{part.label}</span>
                  <select value={st.font} onChange={(e) => pubSetLayout(part.id, { font: e.target.value })}
                          title="Font family"
                          className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none w-40">
                    {PUB_FONTS.map((f) => <option key={f.id || 'app'} value={f.id}>{f.label}</option>)}
                    {st.font && !PUB_FONTS.some((f) => f.id === st.font) && (
                      <option value={st.font}>{st.font}</option>
                    )}
                  </select>
                  <input type="number" min="4" max="96" step="0.5" value={st.size || ''}
                         onChange={(e) => pubSetLayout(part.id, { size: Number(e.target.value) || 0 })}
                         placeholder="—" title="Font size in points (empty = as in the app)"
                         className="w-14 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
                  <span className="text-[10px] text-slate-400">pt</span>
                  <div className="flex items-center gap-0.5">
                    {PUB_TEXT_ALIGNMENTS.map((a) => (
                      <button type="button" key={a.id} title={a.title}
                              onClick={() => pubSetLayout(part.id, { align: st.align === a.id ? '' : a.id })}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition ${
                                st.align === a.id ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <PubTriButton state={st.bold} label="B"
                                  title={`Bold — ${part.label} (click again: normal, then as in the app)`}
                                  onClick={() => pubToggleLayoutStyle(part.id, 'bold')} />
                    <PubTriButton state={st.italic} label="I"
                                  title={`Italic — ${part.label} (click again: normal, then as in the app)`}
                                  onClick={() => pubToggleLayoutStyle(part.id, 'italic')} />
                    <PubTriButton state={st.underline} label="U"
                                  title={`Underlined — ${part.label} (click again: normal, then as in the app)`}
                                  onClick={() => pubToggleLayoutStyle(part.id, 'underline')} />
                  </div>
                  <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500"
                         title={`Colour of the ${part.id === 'figure' ? 'figure caption' : 'text'}`}>
                    <input type="color" value={st.color || '#1e293b'}
                           onChange={(e) => pubSetLayout(part.id, { color: e.target.value })}
                           className="w-6 h-6 rounded border border-slate-300 bg-white cursor-pointer p-0" />
                    {st.color ? (
                      <button type="button" onClick={() => pubSetLayout(part.id, { color: '' })}
                              className="text-slate-400 hover:text-red-600" title="No colour of its own">
                        ✖
                      </button>
                    ) : 'colour'}
                  </label>
                  {part.width && (
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500"
                           title="Width of the figure image, as a percentage of the column">
                      <input type="range" min="10" max="100" step="5" value={st.width}
                             onChange={(e) => pubSetLayout(part.id, { width: Number(e.target.value) })}
                             className="w-24 accent-indigo-600" />
                      {st.width}%
                    </label>
                  )}
                  <button type="button" onClick={() => pubResetLayout(part.id)}
                          className="ml-auto px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200"
                          title={`Reset the ${part.label} formatting`}>
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
          {/* L'aperçu vivant du document est REMONTÉ EN TÊTE du panneau (voir « Live
              preview — project document ») : il n'a pas à être répété ici, et cette
              carte porte désormais AUSSI l'ordre et les intitulés des sections. */}

        {/* ── LES SECTIONS DU DOCUMENT : ORDRE ET INTITULÉS (dans la MÊME carte que
            la mise en forme — « the “document layout” section must be fused with the
            “document sections” ») ───────────────────────────────────────────────
            La demande : « In the publication format I cannot change the order of the
            sections nor change the titles of the subsections. I want to be able for
            example to put the author before the title or change the name of “materials
            and methods” into “experimental section” or whatever. »
            ON GLISSE UNE RANGÉE SUR UNE AUTRE (« movable by drag and drop rather than
            arrows ») : la rangée prise prend la place de la rangée visée (voir
            pubDocOrderDropped). Ceux dont le PROGRAMME écrit l'intitulé ont en plus un
            champ — c'est le seul texte du document qu'il écrit lui-même — et un ↺ rend
            l'intitulé du programme. Le texte de l'auteur, lui, n'est jamais touché. */}
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400"
                  title="The blocks of the project document, in the order they are printed (page, printed document, PDF, export). Drag a row onto another one to move it; rename a heading the program writes with its field.">
              Document sections (order & titles)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] italic text-slate-400" aria-hidden="true">⠿ drag a row onto another one</span>
              <button type="button" onClick={pubResetDocSections}
                      className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200"
                      title="Put the blocks of the document back in the app's order, with the app's own section titles">
                ↺ Default order & titles
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {docOrder.map((id) => {
              const block = PUB_DOC_BLOCKS.find((b) => b.id === id);
              if (!block) return null;
              return (
                <div key={id}
                     draggable={!block.fixed}
                     onDragStart={(e) => {
                       if (block.fixed) return;
                       setPubDocDragId(id);
                       e.dataTransfer.effectAllowed = 'move';
                       try { e.dataTransfer.setData('text/plain', id); } catch { /* navigateur sans dataTransfer */ }
                     }}
                     onDragOver={(e) => {
                       /* Un bloc FIXE (la liste vivante des références) n'est pas une
                          cible : la rangée prise ne peut pas passer derrière lui. */
                       if (block.fixed) return;
                       e.preventDefault();
                       e.dataTransfer.dropEffect = 'move';
                       setPubDocOverId(id);
                     }}
                     onDragLeave={() => setPubDocOverId((v) => (v === id ? '' : v))}
                     onDrop={(e) => { e.preventDefault(); e.stopPropagation(); pubDropDocBlock(id); }}
                     onDragEnd={() => { setPubDocDragId(''); setPubDocOverId(''); }}
                     title={block.fixed
                       ? 'The live list of the references of the project is always printed last'
                       : 'Drag this row onto another one: the block takes its place'}
                     className={`flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 transition ${
                       block.fixed ? '' : 'cursor-grab active:cursor-grabbing'} ${
                       pubDocDragId === id ? 'opacity-50' : ''} ${
                       pubDocOverId === id && pubDocDragId && pubDocDragId !== id ? 'ring-2 ring-indigo-400 border-indigo-300' : ''}`}>
                  <span className="text-xs text-slate-400 select-none" aria-hidden="true">{block.fixed ? '🔒' : '⠿'}</span>
                  <span className="w-32 text-[11px] font-bold text-slate-700">{block.label}</span>
                  {block.titled ? (
                    <input type="text" value={docTitles[id] || ''} placeholder={block.title}
                           onChange={(e) => pubSetDocTitle(id, e.target.value)}
                           title={`The heading the document prints for “${block.label}” — empty = the app's own title (${block.title})`}
                           className="flex-1 min-w-[8rem] border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none focus:border-indigo-400" />
                  ) : (
                    <span className="flex-1 text-[10px] italic text-slate-400">{block.hint}</span>
                  )}
                  {block.titled && (
                    <button type="button" onClick={() => pubSetDocTitle(id, '')}
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                            title={`Back to “${block.title}”`}>↺</button>
                  )}
                  {block.fixed && (
                    <span className="ml-auto text-[9px] italic text-slate-400 whitespace-nowrap">always printed last</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Ici se ferme la carte « Document layout & sections » : la mise en forme ET
            l'ordre des sections sont une seule rubrique (« fused »). */}
        </div>

        {/* ══ LES RÉGLAGES DES RÉFÉRENCES (« the settings of references must follow ») ══
            Ce que le format écrit pour une référence et pour un renvoi du texte : la
            règle « et al. », la forme des renvois dans le texte, et les champs de la
            citation (auteurs, année, titre, revue, volume, pages, DOI) avec leur style,
            leur préfixe et leur suffixe. Les noms des membres du laboratoire se règlent
            juste après (« Lab members in the citation »). */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2"
               title="How a reference is written and how the numbered citations of the text are printed.">
            References (citation &amp; bibliography)
          </div>

          {/* LE TITRE DE LA BIBLIOGRAPHIE SE COCHE ICI — la demande : « If in the style
              of science references have no title then the title tick must be unchecked in
              the “References (citation & bibliography)” section. » La case lit
              `docNoTitle` du format : choisir Science la décoche (sa liste suit le texte,
              sans intitulé), la décocher soi-même retire le `<h2>` du document sur la
              page, à l'impression, dans le PDF et dans le .docx — la liste des références,
              elle, reste entière. Le champ de l'intitulé, lui, est dans « Document
              sections (order & titles) », à la rangée « References ». */}
          <label className="flex w-fit items-center gap-1.5 mb-3 text-[11px] font-bold text-slate-600 cursor-pointer"
                 title="Print the heading over the reference list of the project document (page, print, PDF, .docx). Unticked — the habit of some journals, Science among them — the list follows the text with no heading of its own.">
            <input type="checkbox" checked={!docNoTitle.includes('references')}
                   onChange={(e) => pubPatchFormat({
                     docNoTitle: e.target.checked
                       ? docNoTitle.filter((id) => id !== 'references')
                       : [...docNoTitle, 'references']
                   })}
                   className="w-3.5 h-3.5 accent-indigo-600" />
            Print the “{docTitles.references || 'References'}” heading
          </label>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-slate-600 whitespace-nowrap"
                     title="Author position after which the citation is cut short with “et al.” (0 = never truncate)">
                et al. after
              </label>
              <input type="number" min="0" max="99" value={activeFormat.etAlLimit || 0}
                     onChange={(e) => pubPatchFormat({ etAlLimit: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                     className="w-16 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
              <span className="text-[10px] text-slate-400 whitespace-nowrap">authors (0 = never)</span>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer"
                   title="The scientists of the user list always keep their name in the citation, even when they come after the “et al.” cutoff">
              <input type="checkbox" checked={!!activeFormat.alwaysShowScientists}
                     onChange={(e) => pubPatchFormat({ alwaysShowScientists: e.target.checked })}
                     className="w-3.5 h-3.5 accent-indigo-600" />
              Always show lab scientists even after “et al.”
            </label>
          </div>

          {/* LA FORME DES RENVOIS DANS LE TEXTE (« come appaiono i riferimenti
              bibliografici nel testo ») : exposant, crochets, parenthèses, ou le nom
              des auteurs suivi de l'année. C'est une propriété du FORMAT, donc elle
              vaut pour le document du projet, sa version imprimée et son export —
              document figé compris, où les renvois sont reformés à l'affichage (voir
              applyInTextStyle dans utils/referenceLinks.js). */}
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400"
                    title="How every numbered citation of the project document is printed in the text">
                In-text citations (project document)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {IN_TEXT_STYLES.map((s) => {
                const current = normalizeInTextStyle(activeFormat.inTextStyle) === s.id;
                return (
                  <button type="button" key={s.id} onClick={() => pubPatchFormat({ inTextStyle: s.id })}
                          title={s.title}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                            current ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Example:{' '}
              <span className="text-slate-800"
                    dangerouslySetInnerHTML={{ __html: inTextSample(activeFormat.inTextStyle) }} />
            </p>
          </div>

          {/* LA FORME DES NOMS D'AUTEURS — la demande : « il programma non
              distingue tra nome e cognome degli autori… la parte di autori rimane
              nel formato del giornale dove è stato pubblicato. » C'est ici que le
              format DÉCIDE : les mêmes auteurs s'écrivent « Smith JA »,
              « Smith J. A. », « J. A. Smith » ou « Smith, J. A. » — quelle que
              soit la revue d'où vient la liste (Crossref, PubMed, OpenAlex…).
              Choisir un journal en pose une (voir journalFormats.js) ;
              « as written » laisse chaque liste exactement comme importée. */}
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400"
                    title="How the name of every author of a reference is written — the same rule for all the lists, whatever journal they came from.">
                Author names
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {NAME_STYLES.map((s) => {
                const current = normalizeNameStyle(activeFormat.nameStyle) === s.id;
                return (
                  <button type="button" key={s.id} onClick={() => pubPatchFormat({ nameStyle: s.id })}
                          title={`${s.title}${s.id === 'asis' ? '' : ' — « Smith, John A. » imported from an editor is written this way too'}`}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                            current ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5"
               title="One row per field of a reference: shown or hidden, its style, and the text written before and after it.">
            Fields of a reference
          </div>
          <div className="flex flex-col gap-1.5">
            {[...activeFormat.fields].sort((a, b) => a.order - b.order).map((f) => (
            <div key={f.id} className={`flex flex-wrap items-center gap-2 bg-white border rounded-lg px-2.5 py-1.5 ${f.enabled ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
              <input type="checkbox" checked={f.enabled}
                     onChange={(e) => pubPatchField(f.id, { enabled: e.target.checked })}
                     className="w-3.5 h-3.5 accent-indigo-600" />
              <span className="w-24 text-xs font-bold text-slate-700">{PUB_FIELD_LABELS[f.id] || f.id}</span>
              <select value={f.style} onChange={(e) => pubPatchField(f.id, { style: e.target.value })}
                      className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="italic">Italic</option>
                <option value="underline">Underline</option>
                <option value="bolditalic">Bold + Italic</option>
              </select>
              <input type="text" value={f.prefix || ''} onChange={(e) => pubPatchField(f.id, { prefix: e.target.value })}
                     placeholder="prefix" title="Text before this field"
                     className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
              <input type="text" value={f.suffix || ''} onChange={(e) => pubPatchField(f.id, { suffix: e.target.value })}
                     placeholder="suffix" title="Text after this field"
                     className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
              {f.id === 'doi' && (
                <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer whitespace-nowrap"
                       title="Show the word “doi” as the link to the paper page instead of the DOI value">
                  <input type="checkbox" checked={!!f.linkText}
                         onChange={(e) => pubPatchField(f.id, { linkText: e.target.checked ? 'doi' : '' })}
                         className="w-3.5 h-3.5 accent-indigo-600" />
                  “doi” link
                </label>
              )}
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button" onClick={() => pubMoveField(f.id, -1)} title="Move up"
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold">▲</button>
                <button type="button" onClick={() => pubMoveField(f.id, 1)} title="Move down"
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold">▼</button>
              </div>
            </div>
          ))}
        </div>

        {Object.keys(PUB_FIELD_LABELS).some((id) => !activeFormat.fields.some((f) => f.id === id)) && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-[11px] font-bold text-slate-500">+ Add field:</span>
            <select value={pubAddField} onChange={(e) => setPubAddField(e.target.value)}
                    className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
              {Object.entries(PUB_FIELD_LABELS)
                .filter(([id]) => !activeFormat.fields.some((f) => f.id === id))
                .map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button type="button" onClick={pubAddNewField}
                    className="px-2.5 py-0.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition">
              Add
            </button>
          </div>
        )}
        </div>

        {/* ══ LES MEMBRES DU LABORATOIRE DANS LA CITATION (« followed by the “Lab
            members in the citation” » : c'est la dernière rubrique du panneau) ═════
            Every author of the paper is listed (la règle « et al. » ci-dessus, elle, est
            intacte) : ici on choisit comment le nom de chaque membre du laboratoire
            s'écrit dans la citation — chacun pour soi. L'aperçu de la citation montre
            les noms ainsi habillés. */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
              Lab members in the citation ({citationScientists.length})
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-bold text-slate-400">Set all to</span>
              {AUTHOR_STYLES.map((s) => (
                <button type="button" key={s.id} onClick={() => pubSetAllScientistStyles(s.id)}
                        title={`${s.title} — for every lab member`}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700">
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {citationScientists.length === 0 ? (
            <p className="text-xs italic text-slate-400">
              No lab member yet — the scientists of the user list (plus the names added with ➕ in
              the publications table) can be styled here.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {citationScientists.map((name) => {
                const current = scientistStyleOf(name, activeFormat);
                return (
                  <div key={name} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-2 py-1">
                    <span className="text-xs font-semibold text-slate-700 truncate" title={name}>{name}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {AUTHOR_STYLES.map((s) => (
                        <button type="button" key={s.id} onClick={() => pubSetScientistStyle(name, s.id)}
                                title={s.title}
                                className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition ${current === s.id ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!!activeFormat.underlineScientists && (
            <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
              ⚠ The old “Underline their names” setting of this format is still on: every lab member
              without a style of its own is underlined. Pick a style (or “Set all to”) to replace it.
            </p>
          )}
          {/* L'APERÇU DE LA CITATION : la liste des références du format COURANT, avec
              les noms des membres habillés — c'est ici que le réglage se voit. */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 mt-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">
              Live preview — citation{pubFormatScope !== 'default' ? ` (project “${pubFormatScope}”)` : ''}
            </div>
            <div className="text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: pubCitationHtml(samplePub, activeFormat, citationScientists) || '—' }} />
          </div>
        </div>
      </div>
    </section>
  );

  /* Fenêtre « Recover papers » : on choisit un ancien fichier de sauvegarde
     (téléchargé depuis Drive, ou listé directement ici) et on n'en reprend que
     les papiers — voir applyPapersRecovery pour les règles de fusion. */
  const renderPapersRecovery = () => {
    if (!recovOpen) return null;
    const counts = recovState ? recovState.counts : null;
    const parts = [
      { key: 'publications', label: '📰 Publications of the scientists', n: counts ? counts.publications : 0 },
      { key: 'relevantPapers', label: '📄 Relevant papers', n: counts ? counts.relevantPapers : 0 },
      { key: 'projects', label: '📁 Project bibliographies', n: counts ? counts.projectBib : 0 },
      { key: 'subjects', label: '🏷 Relevant-paper labels', n: recovState ? (recovState.papers.relevantSubjects || []).length : 0 }
    ];
    const fileProjects = recovState ? (recovState.papers.projects || []).filter((p) => (p.bibliography || []).length) : [];
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRecovOpen(false)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-800">♻️ Recover papers from an old backup</h3>
            <button type="button" onClick={() => setRecovOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm px-1">✕</button>
          </div>
          <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Only the <b>papers</b> are read from the backup: publications, Relevant papers, labels and each project’s
              bibliography. What is already saved here is kept — missing papers are added and empty fields are completed,
              nothing is overwritten or deleted. Experiments, definitions, storage, reports… are <b>not</b> touched, so
              recovering papers never costs you the work done since that backup.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 cursor-pointer">
                📂 Choose a backup file (.html)
                <input type="file" accept=".html,.htm" className="hidden"
                       onChange={(e) => { loadRecoveryFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </label>
              <button type="button" onClick={loadDriveBackups} disabled={recovBusy}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                🔎 List this dataset’s Drive backups
              </button>
              {recovStatus && <span className="text-xs text-slate-600">{recovStatus}</span>}
            </div>
            {recovBackups && recovBackups.length > 0 && (
              <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto custom-scrollbar">
                {recovBackups.map((b) => (
                  <button type="button" key={b.id} onClick={() => loadDriveBackup(b)} disabled={recovBusy}
                          className="w-full text-left px-3 py-2 text-xs border-b border-slate-100 last:border-0 hover:bg-slate-50 disabled:opacity-50">
                    <span className="font-semibold text-slate-700">{b.name}</span>
                    <span className="text-slate-400"> · {Math.max(1, Math.round((b.size || 0) / 1024))} kB</span>
                  </button>
                ))}
              </div>
            )}
            {recovState && (
              <div className="border border-violet-200 bg-violet-50/40 rounded-lg p-3">
                <div className="text-xs font-bold text-slate-700 mb-2">What was found in “{recovState.source}”</div>
                <div className="flex flex-col gap-1.5">
                  {parts.map((p) => (
                    <label key={p.key} className={`flex items-center gap-2 text-xs ${p.n ? 'text-slate-700' : 'text-slate-400'}`}>
                      <input type="checkbox" checked={p.n > 0 ? !!recovState.parts[p.key] : false} disabled={!p.n}
                             onChange={(e) => setRecovState((s) => ({ ...s, parts: { ...s.parts, [p.key]: e.target.checked } }))} />
                      {p.label} <span className="font-bold">{p.n}</span>
                    </label>
                  ))}
                </div>
                {fileProjects.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Projects in the file: {fileProjects.map((p) => `${p.name || '(unnamed)'} (${p.bibliography.length})`).join(' · ')}
                    {' '}— a project is only completed if it still exists in the open dataset; no project is created here.
                  </div>
                )}
                <div className="flex justify-end mt-3">
                  <button type="button" onClick={runRecovery}
                          disabled={recovBusy || !Object.values(recovState.parts).some(Boolean)}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    ➕ Add the missing papers
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderProjectBibliography = () => (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-violet-50/50 border-b border-violet-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-600 text-white text-sm shrink-0">📁</span>
          Project bibliography
          <span className="text-slate-400 font-bold">({pbRows.length})</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={pbFilter} onChange={(e) => setPbFilter(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
            <option value="all">All projects</option>
            {myProjects.map((prj) => (
              <option key={prj.id} value={prj.name}>{prj.name} ({(prj.bibliography || []).length})</option>
            ))}
          </select>
          <button type="button" onClick={() => setPbImportOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                  title="Import papers from the Relevant papers table or from the scientist's publications">
            ⬇ Import papers
          </button>
          <button type="button" onClick={() => { setRecovStatus(''); setRecovOpen(true); }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition"
                  title="Recover lost papers from an old Lab Workspace backup (.html). Only the papers are read — experiments, definitions, storage and every other section stay as they are.">
            ♻️ Recover papers
          </button>
          <button type="button" onClick={() => setPbShowAdd((v) => !v)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition">
            {pbShowAdd ? 'Cancel' : '+ Add paper'}
          </button>
          {/* ⟳ Même bouton que les publications des scientifiques : les entrées
              dont la liste d'auteurs est vide ou coupée par un « et al. » sont
              complétées — publications du laboratoire + « Relevant papers »,
              puis Crossref — et la liste trouvée est écrite dans le projet. */}
          <button type="button" onClick={completePbAuthorLists} disabled={pbAuthorsFixing || myProjects.length === 0}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 disabled:opacity-40 transition"
                  title="Fetch the FULL author list of the project papers that show none, or that a journal cut with “et al.”: the lab publications and the “Relevant papers” first (offline), then Crossref by DOI — read in the link too — else by exact title. Their other empty fields (journal, year, volume, pages, DOI) are filled the same way, and the result is saved in the project.">
            {pbAuthorsFixing ? '⏳ Fetching authors…' : '⟳ Complete author lists'}
          </button>
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm text-slate-500 mb-3">
          Papers labeled with a project name — the same table as “Relevant papers”, but each entry is attached to one
          of the projects. These papers (plus the scientist's publications) feed the references of the project pages.
          {pbIsSuper ? ' Superusers see the bibliography of every project.' : ` You only see the papers of your own projects (${defaultScientist || 'not logged in'}).`}
        </p>


        {pbShowAdd && (
          <div className="mb-4 p-3 bg-violet-50 border border-violet-200 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Project *</label>
                <select className={inputCls} value={pbDraft.project} onChange={(e) => setPbDraft({ ...pbDraft, project: e.target.value })}>
                  <option value="">Choose a project…</option>
                  {myProjects.map((prj) => <option key={prj.id} value={prj.name}>{prj.name}</option>)}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className={labelCls}>Title *</label>
                <input className={inputCls} value={pbDraft.title} onChange={(e) => setPbDraft({ ...pbDraft, title: e.target.value })}
                       placeholder="Paper title" />
              </div>
              <div>
                <label className={labelCls}>Link / DOI</label>
                <input className={inputCls} value={pbDraft.link} onChange={(e) => setPbDraft({ ...pbDraft, link: e.target.value })}
                       placeholder="https://doi.org/…" />
              </div>
              <div className="lg:col-span-2">
                <label className={labelCls}>Authors</label>
                <input className={inputCls} value={pbDraft.authors} onChange={(e) => setPbDraft({ ...pbDraft, authors: e.target.value })}
                       placeholder="e.g. Rossi M, Bianchi A…" />
              </div>
              <div>
                <label className={labelCls}>Year</label>
                <input className={inputCls} value={pbDraft.year} onChange={(e) => setPbDraft({ ...pbDraft, year: e.target.value })}
                       placeholder="2024" />
              </div>
              <div className="lg:col-span-3">
                <label className={labelCls}>Comments (optional)</label>
                <input className={inputCls} value={pbDraft.comments} onChange={(e) => setPbDraft({ ...pbDraft, comments: e.target.value })}
                       placeholder="Why is it relevant for the project?" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => setPbShowAdd(false)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
              <button type="button" onClick={addPbPaper} disabled={!pbDraft.project || !pbDraft.title.trim()}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">+ Add paper</button>
            </div>
          </div>
        )}

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="max-h-96 overflow-y-auto custom-scrollbar">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-100 z-10">
                <tr>
                  {['Project', 'Title', 'Authors', 'Link', 'Scientist', 'PDF', 'Comments', ''].map((h, hi) => (
                    <th key={hi} className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pbRows.length === 0 ? (
                  <tr><td colSpan={8} className="text-xs text-slate-400 italic px-3 py-3">No project bibliography papers yet — use “+ Add paper” to label a paper with a project name.</td></tr>
                ) : (
                  pbRows.map((p, idx) => {
                    const isOpen = pbExpanded === p.id;
                    return (
                      <React.Fragment key={p.id}>
                        <tr className={`cursor-pointer hover:bg-violet-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}`}
                            onClick={() => setPbExpanded(isOpen ? null : p.id)}>
                          <td className="px-3 py-2 border-b border-slate-100 align-top">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">📁 {p.projectName || '—'}</span>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 align-top"><span className="text-xs font-semibold text-slate-800">{p.title || '—'}</span></td>
                          <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600">
                            <span className="line-clamp-2">{p.authors || '—'}</span>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                            {p.link ? (
                              <a href={normalizeLink(p.link)} target="_blank" rel="noreferrer"
                                 className="text-blue-600 hover:underline text-[11px] truncate block max-w-[200px]" title={p.link}>
                                {p.link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || p.link}
                              </a>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600">{p.projectScientist || '—'}</td>
                          <td className="px-3 py-2 border-b border-slate-100 align-top" onClick={(e) => e.stopPropagation()}>
                            <PubPdfCell p={p} path={['publications', 'Project publications', p.projectName || '']} fileSuffix={null}
                                        onSetPdf={(pdf) => patchPbPaper(p.projectId, p.id, { pdf })} />
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 align-top text-xs text-slate-600"><span className="line-clamp-2">{p.comments || '—'}</span></td>
                          <td className="px-3 py-2 border-b border-slate-100 text-right align-top whitespace-nowrap">
                            <button type="button" onClick={(e) => { e.stopPropagation(); removePbPaper(p.projectId, p.id); }}
                                    className="text-red-400 hover:text-red-600 text-xs px-1" title="Delete paper">✕</button>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="bg-violet-50/40">
                            <td colSpan={8} className="px-4 py-3 border-b border-slate-200">
                              <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3">
                                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">
                                  Formatted citation — the project document “References” uses the same format
                                </div>
                                <div className="text-xs text-slate-800"
                                     dangerouslySetInnerHTML={{ __html: pubCitationHtml(p, pbFormatOf(p.projectId), citationScientists) || '—' }} />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                <div className="lg:col-span-2">
                                  <label className={labelCls}>Title</label>
                                  <input className={inputCls} value={p.title || ''} onChange={(e) => patchPbPaper(p.projectId, p.id, { title: e.target.value })} />
                                </div>
                                <div>
                                  <label className={labelCls}>Project</label>
                                  <select className={inputCls} value={p.projectName} onChange={(e) => movePbPaper(p.projectId, p.id, e.target.value)}>
                                    {myProjects.map((prj) => <option key={prj.id} value={prj.name}>{prj.name}</option>)}
                                  </select>
                                </div>
                                <div className="lg:col-span-2">
                                  <label className={labelCls}>Authors (all of them — lab members and outside co-authors)</label>
                                  <input className={inputCls} value={p.authors || ''} onChange={(e) => patchPbPaper(p.projectId, p.id, { authors: e.target.value })}
                                         placeholder="e.g. Rossi M, Bianchi A, Smith J…" />
                                </div>
                                <div>
                                  <label className={labelCls}>Year</label>
                                  <input className={inputCls} value={p.year || ''} onChange={(e) => patchPbPaper(p.projectId, p.id, { year: e.target.value })} placeholder="2024" />
                                </div>
                                <div className="lg:col-span-2">
                                  <label className={labelCls}>Link / DOI</label>
                                  <input className={inputCls} value={p.link || ''} onChange={(e) => patchPbPaper(p.projectId, p.id, { link: e.target.value })} placeholder="https://doi.org/…" />
                                </div>
                                <div>
                                  <label className={labelCls}>Scientist (owner of the project)</label>
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">🔒 {p.projectScientist || '—'}</div>
                                </div>
                                <div className="lg:col-span-3">
                                  <label className={labelCls}>Comments</label>
                                  <textarea className={`${inputCls} h-16`} value={p.comments || ''} onChange={(e) => patchPbPaper(p.projectId, p.id, { comments: e.target.value })} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

        {/* Import papers into a project bibliography */}
        {pbImportOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
               onClick={() => setPbImportOpen(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
                 onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800">⬇ Import papers</h3>
                <button onClick={() => setPbImportOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm px-1">✕</button>
              </div>
              <div className="p-3 overflow-y-auto custom-scrollbar flex flex-col gap-4">
                <div>
                  <label className={labelCls}>Import into project *</label>
                  <select className={inputCls} value={pbImportProject}
                          onChange={(e) => { setPbImportProject(e.target.value); setPbImportSel(new Set()); }}>
                    <option value="">Choose a project…</option>
                    {myProjects.map((prj) => <option key={prj.id} value={prj.name}>{prj.name}</option>)}
                  </select>
                </div>
                {['Relevant papers', 'Publications of the scientist'].map((group) => {
                  const items = pbImportCandidates.filter((c) => c.source === group);
                  return (
                    <div key={group}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">{group} ({items.length})</span>
                        <button type="button"
                                onClick={() => {
                                  const allKeys = items.map((c) => `${c.source}:${c.id}`);
                                  const allSelected = allKeys.length > 0 && allKeys.every((k) => pbImportSel.has(k));
                                  setPbImportSel((prev) => {
                                    const next = new Set(prev);
                                    allKeys.forEach((k) => { if (allSelected) next.delete(k); else next.add(k); });
                                    return next;
                                  });
                                }}
                                className="text-[10px] font-bold text-blue-600 hover:underline">Select all</button>
                      </div>
                      {items.length === 0 ? (
                        <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-2">No papers available in this list.</div>
                      ) : (
                        <div className="flex flex-col gap-1 max-h-56 overflow-y-auto custom-scrollbar">
                          {items.map((it) => {
                            const key = `${it.source}:${it.id}`;
                            const checked = pbImportSel.has(key);
                            return (
                              <label key={key}
                                     className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer text-xs ${checked ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleImportSel(key)}
                                       className="mt-0.5 w-3.5 h-3.5 accent-emerald-600" />
                                <span className="min-w-0">
                                  <span className="block font-bold text-slate-800 leading-snug">{it.title || 'Untitled'}</span>
                                  <span className="block text-[10px] text-slate-500">{[it.authors, it.journal, it.year].filter(Boolean).join(' · ')}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
                <button type="button" onClick={() => setPbImportOpen(false)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
                <button type="button" onClick={importPapersToProject}
                        disabled={!pbImportProject || pbImportSel.size === 0}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                  ⬇ Import selected ({pbImportSel.size})
                </button>
              </div>
            </div>
          </div>
        )}

        {pbTransferStatus && (
          <div className="fixed bottom-4 right-4 z-[70] bg-slate-900 text-white text-xs font-bold rounded-lg px-4 py-2 shadow-lg no-print">
            {pbTransferStatus}
          </div>
        )}
    </section>
  );

  return (
    <div className="flex flex-col gap-5">

      {/* ================= 1) JOURNALS ================= */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-indigo-50/50 border-b border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white shrink-0"><Icon name="newspaper" size={16} /></span>
            Journals
            <span className="text-slate-400 font-bold">({sorted.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={updateImpactFactors}
              disabled={ifUpdating || sorted.length === 0 || !isSuper}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition flex items-center gap-1.5"
              title={isSuper ? 'Look up the current impact factor of every journal on the web (OpenAlex) and update the table' : 'Only the supervisor can update impact factors'}
            >
              {ifUpdating ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Updating…
                </>
              ) : (
                <>🔄 Update Impact Factors</>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
            >
              {showAdd ? 'Cancel' : '+ Add Journal'}
            </button>
          </div>
        </div>
        <div className="p-4">
          <p className="text-sm text-slate-500 mb-4">
            Target journals and impact factors (from the attached Journals table). The list is always sorted by
            impact factor, highest first — edit the IF in any row and the table re-sorts automatically.
            Click a row to edit its full details, comments and links.
          </p>

          {ifStatus && (
            <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-semibold border ${ifUpdating ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
              {ifUpdating ? `⏳ ${ifStatus}` : `ℹ️ ${ifStatus}`}
            </div>
          )}

          {showAdd && (
            <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className={labelCls}>Journal name *</label>
                  <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Nature Communications" />
                </div>
                <div>
                  <label className={labelCls}>Impact Factor</label>
                  <input className={inputCls} value={draft.impactFactor} onChange={(e) => setDraft({ ...draft, impactFactor: e.target.value })} placeholder="e.g. 14.7" />
                </div>
                <div>
                  <label className={labelCls}>Cost / APC</label>
                  <input className={inputCls} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} placeholder="e.g. 3500$" />
                </div>
                <div>
                  <label className={labelCls}>Publisher / Type</label>
                  <input className={inputCls} value={draft.publisher} onChange={(e) => setDraft({ ...draft, publisher: e.target.value })} placeholder="e.g. Elsevier" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
                  Cancel
                </button>
                <button type="button" onClick={addJournal} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                  + Add to table
                </button>
              </div>
            </div>
          )}

          {renderTable()}
        </div>
      </section>

      {renderPublications()}

      {renderPapers()}

      {renderProjectBibliography()}

      {renderPubFormat()}

      {renderPapersRecovery()}
    </div>
  );
};

export default PublicationsSection;




const DEFAULT_JOURNALS = [
  { id: 'seed_01', name: 'Molecular Plant', impactFactor: '24.1', scope: 'Peptides and elicitors', publisher: 'Cell Press', comments: 'They are interested in peptides and elicitors.' },
  { id: 'seed_02', name: 'Angewandte Chemie Int. Ed.', impactFactor: '17', cost: 'free', format: 'Length limitations', scope: 'Chemistry/biology', publisher: 'Wiley', comments: 'Redirected to ChemBioChem and ChemMedChem.' },
  { id: 'seed_03', name: 'Nucleic Acids Research', impactFactor: '16.8', scope: 'Nucleic acids/databases', publisher: 'Oxford University Press' },
  { id: 'seed_04', name: 'JACS', impactFactor: '15.6', cost: '5000$', scope: 'Chemistry-wide', publisher: 'ACS' },
  { id: 'seed_05', name: 'Science Translational Medicine', impactFactor: '14.6', publisher: 'AAAS', comments: 'Paper SAAP-148: AMP activity assays, biofilms, cryo-transmission EM.' },
  { id: 'seed_06', name: 'Aggregate', impactFactor: '13.7', cost: '2600€', publisher: 'Wiley', comments: 'Papers I reviewed: lipopeptides, MIC, MD, NMR (as ours, solution only). “Aggregates” because they try to avoid lipopeptide aggregation.' },
  { id: 'seed_07', name: 'Molecular Therapy', impactFactor: '12', publisher: 'Cell Press' },
  { id: 'seed_08', name: 'Plant Communications', impactFactor: '11.6', scope: 'Peptides and elicitors', publisher: 'Cell Press', comments: 'They are interested in peptides and elicitors.' },
  { id: 'seed_09', name: 'Food Chemistry', impactFactor: '9.8', publisher: 'Elsevier' },
  { id: 'seed_10', name: 'Acta Biomaterialia', impactFactor: '9.6', publisher: 'Elsevier', links: [{ description: 'Example article', url: 'https://doi.org/10.1016/j.actbio.2016.04.003' }] },
  { id: 'seed_11', name: 'PNAS', impactFactor: '9.1', cost: '2600$' },
  { id: 'seed_12', name: 'Journal of Cheminformatics', impactFactor: '8.9', scope: 'Adaptable / cheminformatics', publisher: 'BMC' },
  { id: 'seed_13', name: 'Int. J. Biological Macromolecules', impactFactor: '8.5', publisher: 'Elsevier', comments: 'I have reviewed for them multiple times and they also publish our stuff.' },
  { id: 'seed_14', name: 'Phytomedicine', impactFactor: '8.3', publisher: 'Elsevier' },
  { id: 'seed_15', name: 'EMBO Journal', impactFactor: '8.2', cost: '195€/typeset page', scope: 'Molecular mechanism & physiological relevance', publisher: 'EMBO Press', comments: 'Fast reply.' },
  { id: 'seed_16', name: 'Food Research International', impactFactor: '8.0', format: 'Max 6000 words', publisher: 'Elsevier', comments: 'Requires testing on real food.' },
  { id: 'seed_17', name: 'British Journal of Pharmacology', impactFactor: '7.7', cost: '4000£', publisher: 'Wiley' },
  { id: 'seed_18', name: 'Biomedicine & Pharmacotherapy', impactFactor: '7.5', cost: '2740$+', format: 'No limitations', publisher: 'Elsevier', comments: 'Only open access.' },
  { id: 'seed_19', name: 'Chemical Science', impactFactor: '7.4', cost: 'free', format: 'free', scope: 'Chemistry', publisher: 'RSC' },
  { id: 'seed_20', name: 'PLOS Biology', impactFactor: '7.2', cost: '$5,500', scope: 'Biology', publisher: 'PLOS', comments: 'Redirected to PLOS ONE but could be also PLOS Computational Biology.' },
  { id: 'seed_21', name: 'Cell Chemical Biology', impactFactor: '7.2', format: '8000', scope: 'Chemistry/biology', publisher: 'Cell Press' },
  { id: 'seed_22', name: 'Microbiological Research', impactFactor: '6.9', publisher: 'Elsevier' },
  { id: 'seed_23', name: 'Neurotherapeutics', impactFactor: '6.9', publisher: 'Springer' },
  { id: 'seed_24', name: 'J. Med. Chem.', impactFactor: '6.8', cost: '4000$ (open)', format: 'free', scope: 'Medicinal chemistry', publisher: 'ACS' },
  { id: 'seed_25', name: 'Innovative Food Science & Emerging Technologies', impactFactor: '6.8', format: 'Max 8000 words', publisher: 'Elsevier' },
  { id: 'seed_26', name: 'Int. J. Nanomedicine', impactFactor: '6.5', publisher: 'Dove', comments: 'AMPs content — I reviewed an ACPs review for them.' },
  { id: 'seed_27', name: 'Computers in Biology and Medicine', impactFactor: '6.3', publisher: 'Elsevier', comments: 'Docking…', links: [{ description: 'Example 1', url: 'https://doi.org/10.1016/j.compbiomed.2021.104936' }, { description: 'Example 2', url: 'https://doi.org/10.1016/j.compbiomed.2022.105632' }] },
  { id: 'seed_28', name: 'Food Control', impactFactor: '6.3', format: 'Max 7000 (soft)', publisher: 'Elsevier' },
  { id: 'seed_29', name: 'EMBO Reports', impactFactor: '6.2', cost: '195€/typeset page', publisher: 'EMBO Press', comments: 'Same as EMBO Journal (long and short papers).' },
  { id: 'seed_30', name: 'J. Agricultural and Food Chemistry', impactFactor: '6.2', publisher: 'ACS' },
  { id: 'seed_31', name: 'mBio', impactFactor: '4.7', scope: 'Biology', publisher: 'ASM' },
  { id: 'seed_32', name: 'Inorganic Chemistry', impactFactor: '4.7', publisher: 'ACS' },
  { id: 'seed_33', name: 'European Journal of Pharmacology', impactFactor: '4.7', publisher: 'Elsevier' },
  { id: 'seed_34', name: 'Biodesign Research', impactFactor: '4.7', cost: '2500$', publisher: 'Elsevier' },
  { id: 'seed_35', name: 'Fungal Biology Reviews', impactFactor: '4.6', publisher: 'Elsevier', comments: 'Reviews only.' },
  { id: 'seed_36', name: 'Int. J. Antimicrobial Agents', impactFactor: '4.6', format: '4000 words + 40 refs', publisher: 'Elsevier', comments: 'Fast.' },
  { id: 'seed_37', name: 'J. Phys. Chem. Letters', impactFactor: '4.6', publisher: 'ACS' },
  { id: 'seed_38', name: 'Antibiotics', impactFactor: '4.6', cost: '2500$', format: 'free', scope: 'Chemistry/biology', publisher: 'MDPI' },
  { id: 'seed_39', name: 'Spectrochimica Acta Part A', impactFactor: '4.6', scope: 'NMR, CD', publisher: 'RSC', links: [{ description: 'Example (DOI)', url: 'https://doi.org/10.1016/j.saa.2021.120273' }] },
  { id: 'seed_40', name: 'RSC Advances', impactFactor: '4.6', publisher: 'RSC' },
  { id: 'seed_41', name: 'JMB', impactFactor: '4.5', cost: '3300$+taxes or subscription', scope: 'Chemistry/biology', publisher: 'Elsevier' },
  { id: 'seed_42', name: 'Molecular Pharmaceutics', impactFactor: '4.5', scope: 'Drug delivery incl. peptides', publisher: 'ACS' },
  { id: 'seed_43', name: 'BMC Biology', impactFactor: '4.5', publisher: 'BMC' },
  { id: 'seed_44', name: 'Antimicrobial Agents & Chemotherapy', impactFactor: '4.5', cost: '~4000$ OA or 180$/page +355$ supp.', publisher: 'ASM', comments: 'Q2.' },
  { id: 'seed_45', name: 'Cancers', impactFactor: '4.4', cost: '2000$', publisher: 'MDPI' },
  { id: 'seed_46', name: 'Biochemical Journal', impactFactor: '4.3', publisher: 'Portland Press' },
  { id: 'seed_47', name: 'Macromolecular Rapid Communications', impactFactor: '4.3', publisher: 'Wiley' },
  { id: 'seed_48', name: 'ACS Omega', impactFactor: '4.3', cost: '1125$', publisher: 'ACS' },
  { id: 'seed_49', name: 'Structure', impactFactor: '4.3', publisher: 'Cell Press' },
  { id: 'seed_50', name: 'FEBS Journal', impactFactor: '4.2', cost: '1650€+taxes', publisher: 'Wiley', comments: 'Does not accept papers lacking biological insight; NMR studies, not MD alone.' },
  { id: 'seed_51', name: 'J. Molecular Medicine', impactFactor: '4.2', publisher: 'Springer', comments: 'Requires models higher than cell lines.' },
  { id: 'seed_52', name: 'FASEB Journal', impactFactor: '4.2', publisher: 'FASEB', comments: 'Split results and discussion.' },
  { id: 'seed_53', name: 'BMC Microbiology', impactFactor: '4.2', cost: '€2690', publisher: 'BMC' },
  { id: 'seed_54', name: 'Frontiers in Chemistry', impactFactor: '4.2', publisher: 'Frontiers' },
  { id: 'seed_55', name: 'J. Lipid Research', impactFactor: '4.1', publisher: 'Elsevier', comments: 'We were invited.' },
  { id: 'seed_56', name: 'iScience', impactFactor: '4.1', cost: '2600€', publisher: 'Cell Press', comments: 'Wide scope, open access, fast.' },
  { id: 'seed_57', name: 'Computational & Structural Biotechnology Journal', impactFactor: '4.1', publisher: 'Elsevier' },
  { id: 'seed_58', name: 'Neurochemistry International', impactFactor: '4.0', publisher: 'Elsevier', comments: 'Broad.' },
  { id: 'seed_59', name: 'Frontiers in Molecular Biosciences', impactFactor: '4.0', cost: 'free', scope: 'Chemistry/biology', publisher: 'Frontiers' },
  { id: 'seed_60', name: 'ACS Chem. Neuroscience', impactFactor: '3.9', format: '~50 refs, combined results & discussion', publisher: 'ACS' },
  { id: 'seed_61', name: 'JBC', impactFactor: '3.9', cost: '2500$ free', scope: 'Chemistry/biology', publisher: 'ASBMB' },
  { id: 'seed_62', name: 'Scientific Reports', impactFactor: '3.9', format: 'Length limitations', scope: 'Biology-wide', publisher: 'Nature' },
  { id: 'seed_63', name: 'Langmuir', impactFactor: '3.9', scope: 'Bio-interfaces, membrane dynamics, AMP–membrane interactions', publisher: 'ACS' },
  { id: 'seed_64', name: 'ACS Infectious Diseases', impactFactor: '3.8', scope: 'Structural biology of pathogenesis', publisher: 'ACS', comments: 'MD-only works seen.' },
  { id: 'seed_65', name: 'Molecular Diversity', impactFactor: '3.8', publisher: 'Springer', comments: 'Q2-Q3.' },
  { id: 'seed_66', name: 'J. Pharmaceutical Sciences', impactFactor: '3.8', format: '~6000 words', publisher: 'Elsevier', comments: 'Q1.' },
  { id: 'seed_67', name: 'ACS Chemical Biology', impactFactor: '3.8', format: 'Max 6500 words incl. refs', publisher: 'ACS' },
  { id: 'seed_68', name: 'Chemistry — A European Journal', impactFactor: '3.7', publisher: 'Wiley' },
  { id: 'seed_69', name: 'Dalton Transactions', impactFactor: '3.3', publisher: 'RSC' },
  { id: 'seed_70', name: 'BMC Bioinformatics', impactFactor: '3.3', publisher: 'BMC' },
  { id: 'seed_71', name: 'J. Global Antimicrobial Resistance', impactFactor: '3.2', cost: '1900$', publisher: 'Elsevier' },
  { id: 'seed_72', name: 'Int. J. Microbiology', impactFactor: '3.2', publisher: 'Wiley', comments: 'We have been invited.' },
  { id: 'seed_73', name: 'Faraday Discussions', impactFactor: '3.1', publisher: 'RSC', comments: 'Abstract needed before invitation; Bechinger publishes AMPs there.' },
  { id: 'seed_74', name: 'Biophysical Journal', impactFactor: '3.1', scope: 'Chemistry/biology', publisher: 'Cell Press', comments: 'Expensive: subscription + page charges + color figures.' },
  { id: 'seed_75', name: 'J. Chem. Phys.', impactFactor: '3.1', publisher: 'AIP' },
  { id: 'seed_76', name: 'J. Computer-Aided Molecular Design', impactFactor: '3.1', publisher: 'Springer' },
  { id: 'seed_77', name: 'Archives of Biochemistry and Biophysics', impactFactor: '3.0', publisher: 'Elsevier' },
  { id: 'seed_78', name: 'Biochimie', impactFactor: '3.0', publisher: 'Elsevier' },
  { id: 'seed_79', name: 'Bioorg. & Medicinal Chemistry', impactFactor: '3.0', publisher: 'Elsevier', comments: 'Elsevier contacted me to recommend it.' },
  { id: 'seed_80', name: 'BBA Advances', impactFactor: '3.0', publisher: 'Elsevier' },
  { id: 'seed_81', name: 'FEBS Letters', impactFactor: '3.0', format: 'Free format for reviews/articles', publisher: 'Wiley' },
  { id: 'seed_82', name: 'Biochemistry', impactFactor: '3.0', scope: 'Chemistry/biology', publisher: 'ACS' },
  { id: 'seed_83', name: 'J. Molecular Graphics and Modelling', impactFactor: '3.0', publisher: 'Elsevier', comments: 'MD sims with peptides; I reviewed an AMP paper for them.' },
  { id: 'seed_84', name: 'PCCP', impactFactor: '2.9', publisher: 'RSC' },
  { id: 'seed_85', name: 'Peptides', impactFactor: '2.9', publisher: 'Elsevier' },
  { id: 'seed_86', name: 'J. Phys. Chem. B', impactFactor: '2.9', scope: 'Chemistry/biology', publisher: 'ACS', comments: 'Many studies like ours.' },
  { id: 'seed_87', name: 'J. Membrane Biology', impactFactor: '2.9', publisher: 'Springer' },
  { id: 'seed_88', name: 'Chemistry and Physics of Lipids', impactFactor: '2.8', publisher: 'Elsevier' },
  { id: 'seed_89', name: 'ChemBioChem', impactFactor: '2.8', scope: 'Chemistry/biology', publisher: 'Wiley' },
  { id: 'seed_90', name: 'J. Structural Biology', impactFactor: '2.7', scope: 'NMR', publisher: 'Elsevier' },
  { id: 'seed_91', name: 'J. Microbiology', impactFactor: '2.6', publisher: 'Springer' },
  { id: 'seed_92', name: 'PLOS ONE', impactFactor: '2.6', cost: '$1,805', scope: 'Chemistry/biology', publisher: 'PLOS' },
  { id: 'seed_93', name: 'FEBS Open Bio', impactFactor: '2.6', publisher: 'Wiley' },
  { id: 'seed_94', name: 'Molecular Microbiology', impactFactor: '2.6', publisher: 'Wiley' },
  { id: 'seed_95', name: 'BBA Biomembranes', impactFactor: '2.5', scope: 'Chemistry/biology', publisher: 'Elsevier' },
  { id: 'seed_96', name: 'NJC', impactFactor: '2.5', publisher: 'RSC', comments: 'Pure sims.' },
  { id: 'seed_97', name: 'Amino Acids', impactFactor: '2.4', publisher: 'Springer' },
  { id: 'seed_98', name: 'Virology', impactFactor: '2.4', scope: 'AMPs against viruses', publisher: 'Elsevier', comments: 'Simple docking studies.' },
  { id: 'seed_99', name: 'European Biophysics Journal', impactFactor: '2.4', publisher: 'Springer', comments: 'MD alone is possible.' },
  { id: 'seed_100', name: 'Int. J. Peptide Research & Therapeutics', impactFactor: '2.4', publisher: 'Springer' },
  { id: 'seed_101', name: 'Chemical Physics', impactFactor: '2.4', publisher: 'Elsevier' },
  { id: 'seed_102', name: 'BBA Proteins and Proteomics', impactFactor: '2.3', publisher: 'Elsevier', comments: 'Also AMPs.' },
  { id: 'seed_103', name: 'Biophysical Chemistry', impactFactor: '2.2', publisher: 'Elsevier', comments: 'AMPs and studies similar to ours.' },
  { id: 'seed_104', name: 'BBA General Subjects', impactFactor: '2.2', publisher: 'Elsevier', comments: 'They like NMR and peptides.' },
  { id: 'seed_105', name: 'BBRC', impactFactor: '2.2', publisher: 'Elsevier' },
  { id: 'seed_106', name: 'Biochemistry and Biophysics Reports', impactFactor: '2.2', publisher: 'Elsevier' },
  { id: 'seed_107', name: 'Bioorg. & Medicinal Chem. Letters', impactFactor: '2.2', publisher: 'Elsevier' },
  { id: 'seed_108', name: 'J. Theoretical Biology', impactFactor: '2.0', publisher: 'Elsevier' },
  { id: 'seed_109', name: 'J. Biomolecular NMR', impactFactor: '1.9', publisher: 'Springer', comments: 'NMR with membranes.' },
  { id: 'seed_110', name: 'Applied Biomolecules: Bioactive Materials', cost: 'free until Nov 2027', publisher: 'Elsevier', comments: 'New; open access; we were invited to publish for free until November 2027.' },
  { id: 'seed_111', name: 'Computational & Structural Biotechnology Reports', publisher: 'Elsevier', comments: 'New; simulations; I reviewed for them. Open access.' },
  { id: 'seed_112', name: 'npj Antimicrobials and Resistance', publisher: 'Springer Nature', comments: 'New; I reviewed AMPs papers with simulations and some biophysics.' },



];

