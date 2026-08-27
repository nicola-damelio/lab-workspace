import React, { useState, useEffect, useMemo } from 'react';
import { RichTextEditor } from '../RichTextEditor';
import { SmartImage } from '../TestShellRenderer';
import { loadPubFormat, pubCitationHtml } from '../Publications';
import { getStarredItems, buildStarCaption, buildMaterialsAndMethods, tabConfigForType } from '../../utils/starredItems';
import { loadProjects, saveProjects, loadPublications, TEST_TYPE_OPTIONS, testTypeLabel, genProjectId } from './projectsModule';

/* =========================================================================
   PROJECT DETAIL — a project page with subsections:
   • Scientific background (rich text + references)
   • Experiments (add multiple tests → buttons that link to the classic pages)
   • Discussion (rich text + references)
   • Conclusions (rich text + references)
   • Bibliography (numbered references from Project bibliography and the
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
    <figcaption className="text-xs text-slate-500 mt-1 flex flex-wrap items-start gap-1.5">
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
      <figure key={item.id} className="mb-4">
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
    <figure key={item.id} className="mb-4">
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

export const ProjectDetailModule = ({
  currentUser, setCurrentModule, setCurrentProjectId, currentProjectId,
  createEmptyTest, tests, setTests, setActiveTestId, jumpToTest, operatorNames
}) => {
  const isSuper = currentUser?.role === 'superuser';
  const myName = currentUser?.name || '';
  const [projects, setProjects] = useState(loadProjects);
  const [openSections, setOpenSections] = useState({ background: true, materials: true, comments: false });
  const [refPicker, setRefPicker] = useState(null); // null | { insertText?: fn }
  const [showBibForm, setShowBibForm] = useState(false);
  const [bibDraft, setBibDraft] = useState({ title: '', link: '' });
  const [linkTestId, setLinkTestId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pubs = useMemo(loadPublications, []);
  const [tableDraft, setTableDraft] = useState(null); // null | { section, insertText }
  const [showExport, setShowExport] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(4);
  const [mmFeedback, setMmFeedback] = useState(''); // "✓ Updated HH:MM" flash after manual M&M refresh
  const [docMode, setDocMode] = useState('view');   // export doc: 'view' | 'edit' | 'suggest'
  const [suggestBaseHtml, setSuggestBaseHtml] = useState(''); // HTML snapshot when suggestion mode starts
  const [mmEditOpen, setMmEditOpen] = useState(false); // edit the M&M text on the project page
  const [mmDraft, setMmDraft] = useState('');           // M&M textarea draft
  const [capEditKey, setCapEditKey] = useState(null);   // 'testId:itemId' being caption-edited
  const [capDraft, setCapDraft] = useState('');         // caption textarea draft
  const [commentDraft, setCommentDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [openReplyId, setOpenReplyId] = useState(null);

  const visibleTests = useMemo(() => {
    if (isSuper) return tests;
    return tests.filter((t) => !t.operator || t.operator === myName);
  }, [tests, isSuper, myName]);

  const project = projects.find((p) => p.id === currentProjectId);
  const pubFormat = useMemo(() => project?.pubFormat || loadPubFormat(), [project]);

  useEffect(() => { saveProjects(projects); }, [projects]);

  // Keep the persisted "Materials and Methods" snapshot fresh every time the
  // export document is opened (it pulls the latest Experimental Conditions,
  // Instrumental Setup and Experiment Setup of the included tests).
  useEffect(() => {
    if (!showExport || !project) return;
    // Never overwrite a manually edited Materials & Methods text.
    if (project.materialsAndMethods?.edited) return;
    const parts = mmPartsFor(project, tests, true);
    setProjects((prev) => prev.map((p) =>
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

  const isOwner = isSuper || project.scientist === myName;

  const updateProject = (patch) =>
    setProjects((prev) => prev.map((p) =>
      p.id === project.id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p));

  // ---- Comments & review ----
  // Authorized people are selected (by the owner) from the list of users.
  // The owner and superusers are always authorized.
  const authorizedPeople = project.authorizedPeople || [];
  const isAuthorized = !!currentUser && (isSuper || project.scientist === myName || authorizedPeople.includes(myName));
  const comments = project.comments || [];
  const openComments = comments.filter((c) => !c.resolved).length;

  const toggleAuthorized = (name) =>
    updateProject({
      authorizedPeople: authorizedPeople.includes(name)
        ? authorizedPeople.filter((x) => x !== name)
        : [...authorizedPeople, name].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    });

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
    setSuggestBaseHtml(el.innerHTML);
    setDocMode('suggest');
    setMmFeedback('');
  };

  // Save the (possibly edited) document text as a frozen snapshot on the project,
  // so the user can modify the exported text and it survives reopening.
  const saveDocText = () => {
    const el = document.getElementById('project-doc-container');
    if (!el) return;
    updateProject({ exportDocHtml: el.innerHTML, docSuggestion: null });
    setDocMode('view');
    setMmFeedback('✓ Document text saved');
    setTimeout(() => setMmFeedback(''), 2500);
  };

  // Save the edited text as a *suggestion*: keep the base document untouched and
  // store a marked-up diff (insertions/deletions highlighted) for review.
  const saveDocSuggestion = () => {
    const el = document.getElementById('project-doc-container');
    if (!el) return;
    const editedHtml = el.innerHTML;
    const baseHtml = suggestBaseHtml || editedHtml;
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
  const addSectionFigure = (sec) =>
    patchFigures(sec, [...sectionFigures(sec), { id: genProjectId(), url: '', caption: '' }]);
  const patchSectionFigure = (sec, figId, patch) =>
    patchFigures(sec, sectionFigures(sec).map((f) => (f.id === figId ? { ...f, ...patch } : f)));
  const removeSectionFigure = (sec, figId) =>
    patchFigures(sec, sectionFigures(sec).filter((f) => f.id !== figId));
  const addSectionDoc = (sec) =>
    patchDocs(sec, [...sectionDocs(sec), { id: genProjectId(), name: 'New Document Link', data: '' }]);
  const patchSectionDoc = (sec, docId, patch) =>
    patchDocs(sec, sectionDocs(sec).map((d) => (d.id === docId ? { ...d, ...patch } : d)));
  const removeSectionDoc = (sec, docId) =>
    patchDocs(sec, sectionDocs(sec).filter((d) => d.id !== docId));

  const toggleInclude = (expId) =>
    updateProject({ experiments: (project.experiments || []).map((e) =>
      (e.id === expId ? { ...e, includeInDocument: !e.includeInDocument } : e)) });

  const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const backToList = () => { setCurrentProjectId(null); setCurrentModule('projects'); };

  // ---- References: from "Project bibliography" + "Publications of the scientist" ----
  const projectBib = project.bibliography || [];
  const scientistPubs = pubs.filter((p) => {
    const authors = [p.scientist, ...(p.coauthors || [])].filter(Boolean);
    return !authors.length || authors.includes(project.scientist);
  });
  const refs = project.references || [];

  const findOrAddRef = (paper, insertText) => {
    const existing = refs.find((r) => r.sourceId === paper.id && r.source === paper.source);
    const number = existing ? existing.number : refs.length + 1;
    if (!existing) {
      setProjects((prev) => prev.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          references: [...(p.references || []), {
            id: genProjectId(), number,
            sourceId: paper.id, source: paper.source,
            title: paper.title || 'Untitled',
            link: paper.link || paper.doi || '',
            doi: paper.doi || '',
            authors: paper.authors || '',
            journal: paper.journal || '',
            year: paper.year || ''
          }],
          updatedAt: new Date().toISOString()
        };
      }));
    }
    if (insertText) insertText(`[${number}]`);
  };

  const removeRef = (refId) =>
    updateProject({ references: refs.filter((r) => r.id !== refId) });

  const addBibPaper = () => {
    const title = bibDraft.title.trim();
    if (!title) return;
    updateProject({
      bibliography: [...projectBib, {
        id: genProjectId(), title, link: bibDraft.link.trim(),
        scientist: project.scientist, comments: ''
      }]
    });
    setBibDraft({ title: '', link: '' });
    setShowBibForm(false);
  };

  const removeBibPaper = (paperId) =>
    updateProject({ bibliography: projectBib.filter((b) => b.id !== paperId) });

  // ---- Experiments: create classic tests and link them to the project ----
  const addExperiment = (type) => {
    const id = 't' + Date.now() + Math.floor(Math.random() * 1e4);
    const created = createEmptyTest(id, tests.length + 1, type);
    created.projectNames = [...new Set([...(created.projectNames || []), project.name])];
    setTests((prev) => [...prev, created]);
    const nextProjects = projects.map((p) => {
      if (p.id !== project.id) return p;
      return {
        ...p,
        experiments: [...(p.experiments || []), {
          id: genProjectId(), testId: created.id, type, label: testTypeLabel(type),
          includeInDocument: false, addedAt: new Date().toISOString()
        }],
        updatedAt: new Date().toISOString()
      };
    });
    setProjects(nextProjects);
    saveProjects(nextProjects);
    // Navigate through openTest so "◀ Back" returns to this project page.
    openTest(created.id);
  };

  const linkExistingTest = () => {
    const test = tests.find((t) => t.id === linkTestId);
    if (!test) return;
    if ((project.experiments || []).some((e) => e.testId === test.id)) return;
    setTests((prev) => prev.map((t) => t.id === test.id
      ? { ...t, projectNames: [...new Set([...(t.projectNames || []), project.name])] } : t));
    updateProject({
      experiments: [...(project.experiments || []), {
        id: genProjectId(), testId: test.id, type: test.type || 'plate-96',
        label: testTypeLabel(test.type) || 'Test',
        includeInDocument: false, addedAt: new Date().toISOString()
      }]
    });
    setLinkTestId('');
  };

  const removeExperiment = (expId) =>
    updateProject({ experiments: (project.experiments || []).filter((e) => e.id !== expId) });

  const openTest = (testId) => { if (jumpToTest) jumpToTest(testId); else { setActiveTestId(testId); setCurrentModule('active-test'); } };


  // ---- Reference picker modal ----
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
              { group: '📄 Project bibliography', items: projectBib },
              { group: '📰 Publications of the scientist', items: scientistPubs }
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
          toolbarExtra={[
            { label: '🖼️ + Figure', title: 'Add a figure (image link + caption)', onClick: () => addSectionFigure(id) },
            { label: '▦ + Std Table', title: 'Insert a standard table at the cursor position', onClick: (insertText) => setTableDraft({ section: id, insertText }) },
            { label: '📎 + Document', title: 'Attach a document link', onClick: () => addSectionDoc(id) },
            { label: '📚 + Reference', title: 'Insert a numbered reference at the cursor position', onClick: (insertText) => setRefPicker({ insertText }) }
          ]}
        />

        {figures.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 mb-2">Figures</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {figures.map((fig) => (
                <div key={fig.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500">Figure</span>
                    <button onClick={() => removeSectionFigure(id, fig.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-500 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold border border-red-200">×</button>
                  </div>
                  <input type="text" value={fig.url} onChange={(e) => patchSectionFigure(id, fig.id, { url: e.target.value })}
                         placeholder="Paste image URL here (Google Drive, Dropbox, etc.)"
                         className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 bg-white" />
                  {fig.url.trim() !== '' && (
                    <div className="bg-white rounded-lg p-2 border border-slate-200">
                      <SmartImage src={fig.url} alt="Figure" />
                    </div>
                  )}
                  <textarea value={fig.caption} onChange={(e) => patchSectionFigure(id, fig.id, { caption: e.target.value })}
                            placeholder="Figure caption…" rows={2}
                            className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 resize-y bg-white" />
                </div>
              ))}
            </div>
          </div>
        )}

        {docs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <h4 className="text-sm font-bold text-slate-700 mb-2">Documents</h4>
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
  const printProjectDoc = () => {
    const docEl = document.getElementById('project-doc-container');
    if (!docEl) return;
    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) { window.print(); return; }
    const title = `${project.name} — project document`;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; padding: 2cm 2.2cm; line-height: 1.55; font-size: 13px; }
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
    button { font-family: Georgia, 'Times New Roman', serif; }
  </style>
</head>
<body>${docEl.innerHTML}</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 350);
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
    const sectionBlocks = [
      { id: 'background', title: 'Scientific background', html: project.background || '' },
      { id: 'discussion', title: 'Discussion', html: project.discussion || '' },
      { id: 'conclusions', title: 'Conclusions', html: project.conclusions || '' }
    ];
    const renderFigures = (list) => list.filter((f) => (f.url || '').trim() !== '').length > 0 && (
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.filter((f) => (f.url || '').trim() !== '').map((f) => (
          <figure key={f.id}>
            <img src={f.url} alt={f.caption || 'Figure'} style={{ maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
            {f.caption && <figcaption className="text-xs text-slate-500 mt-1">{f.caption}</figcaption>}
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
    return (
      <div className="fixed inset-0 z-[60] bg-slate-100 overflow-y-auto custom-scrollbar">
        <style>{`
          .doc-ins { background: #dcfce7; color: #166534; text-decoration: none; }
          .doc-del { background: #fee2e2; color: #991b1b; text-decoration: line-through; }
        `}</style>
        <div className="max-w-4xl mx-auto p-4 md:p-8">
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
              {project.exportDocHtml && docMode === 'view' && (
                <button onClick={rebuildDoc}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200"
                        title="Discard the saved text edits and rebuild the document from the project data">
                  ↩️ Rebuild from data
                </button>
              )}
              <button onClick={printProjectDoc}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700">🖨️ Print / Save as PDF</button>
              <button onClick={() => setShowExport(false)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Close</button>
            </div>
          </div>
          {docMode === 'edit' && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3 no-print">
              ✏️ Edit mode: click any text to modify it. “💾 Save changes” keeps your edits in the document, “🖨️ Print” prints it as-is.
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
                        className="px-3 py-1 text-[11px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">✔ Accept suggestion</button>
                <button onClick={rejectSuggestion}
                        className="px-3 py-1 text-[11px] font-bold rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300">✖ Reject</button>
              </div>
            </div>
          )}

          <div id="project-doc-container"
               contentEditable={docMode !== 'view'}
               suppressContentEditableWarning
               className={`bg-white rounded-xl shadow-sm p-6 md:p-10 text-slate-900 ${
                 docMode === 'edit' ? 'border-2 border-dashed border-amber-400 outline-none'
                   : docMode === 'suggest' ? 'border-2 border-dashed border-violet-400 outline-none'
                     : 'border border-slate-200'}`}>
            {project.docSuggestion && docMode === 'view' ? (
              <div dangerouslySetInnerHTML={{ __html: project.docSuggestion.markedHtml }} />
            ) : project.exportDocHtml ? (
              <div dangerouslySetInnerHTML={{ __html: project.exportDocHtml }} />
            ) : (
              <>
            <h1 className="text-2xl font-black text-slate-900 mb-1">📁 {project.name}</h1>
            <p className="text-xs text-slate-500 mb-6">
              Scientist: {project.scientist || '—'} · Created: {new Date(project.createdAt).toLocaleDateString()}
            </p>

            {sectionBlocks.map((s) => (
              <div key={s.id} className="mb-6">
                <h2 className="text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">{s.title}</h2>
                {s.html ? <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: s.html }} />
                        : <p className="text-xs italic text-slate-400">—</p>}
                {renderFigures(sectionFigures(s.id))}
                {renderDocs(sectionDocs(s.id))}
              </div>
            ))}


            {includedExps.length > 0 && (
              <div className="mb-6">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-1 mb-2">
                  <h2 className="text-base font-black text-slate-800">Materials and Methods</h2>
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
                <p className="text-[10px] text-slate-400 mb-3">
                  Automatically generated from the Experimental Conditions, Instrumental Setup and Experiment Setup
                  of each included test
                  {project.materialsAndMethods?.edited
                    ? ` · hand-edited ${project.materialsAndMethods.editedAt ? new Date(project.materialsAndMethods.editedAt).toLocaleString() : ''}`
                    : project.materialsAndMethods?.generatedAt
                      ? ` · last updated ${new Date(project.materialsAndMethods.generatedAt).toLocaleString()}`
                      : ''}.
                </p>
                <div className="flex flex-col gap-2">
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
            )}

            {includedExps.length > 0 && (
              <div className="mb-6">
                <h2 className="text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">Experiments ({includedExps.length})</h2>
                <p className="text-[10px] text-slate-400 mb-3">
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
                      <h3 className="text-sm font-black text-slate-800 flex flex-wrap items-center gap-2">
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
            )}

            <div className="mb-4">
              <h2 className="text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">Bibliography ({refs.length})</h2>
              {refs.length === 0 ? <p className="text-xs italic text-slate-400">No references.</p> : (
                <ol className="list-decimal pl-5 text-sm text-slate-800 space-y-1">
                  {refs.map((r) => (
                    <li key={r.id} dangerouslySetInnerHTML={{
                      __html: pubCitationHtml({ authors: r.authors, year: r.year, title: r.title, journal: r.journal, doi: r.doi, volume: r.volume, pages: r.pages }, pubFormat, operatorNames) || r.title
                    }} />
                  ))}
                </ol>
              )}
            </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ---- Comments & review section ----
  const renderCommentsSection = () => {
    const userList = (operatorNames || []).filter((n) => String(n).trim());
    const ownerInList = project.scientist && !userList.includes(project.scientist);
    const shownUsers = [...new Set([...userList, ...(ownerInList ? [project.scientist] : [])])]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return (
      <SectionCard title="💬 Comments & review"
                   open={openSections.comments} onToggle={() => toggleSection('comments')}
                   badge={<span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${openComments ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                     {openComments} open
                   </span>}>
        {/* Authorized people */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Authorized people (from the list of users)</h4>
            {isOwner && <span className="text-[10px] text-slate-400">owner &amp; superusers always included</span>}
          </div>
          <p className="text-[10px] text-slate-500 mb-2">
            Only the people below can add comments, answer them and resolve them.
          </p>
          {shownUsers.length === 0 ? (
            <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-2">
              No users in the list yet — add scientists in Definitions → Scientists &amp; Operators.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {shownUsers.map((u) => {
                const isOwnerName = u === project.scientist;
                const on = isOwnerName || authorizedPeople.includes(u);
                const disabled = !isOwner || isOwnerName;
                return (
                  <button key={u} type="button" disabled={disabled}
                          onClick={() => toggleAuthorized(u)}
                          title={isOwnerName
                            ? 'The project owner is always authorized'
                            : (disabled ? 'Only the project owner can change this list' : (on ? 'Click to remove access' : 'Click to give access'))}
                          className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
                            on
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                          } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                    {isOwnerName ? '👑 ' : ''}{u}{on ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
      <div className="max-w-5xl mx-auto flex flex-col gap-4 pb-10">

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
              <button onClick={() => setShowExport(true)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                      title="Export the project as a text document (includes figures and text of the tests marked for inclusion)">
                📄 Export document
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
                 placeholder="Project name" />
          {!isSuper && currentUser && (
            <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              🧪 You are editing your own project. Superusers see all projects and can filter by scientist.
            </div>
          )}
        </div>

        {/* ---------- Scientific background ---------- */}
        {textSection('background', '🔬 Scientific background',
          'Rationale, state of the art, hypotheses and aims of the project.',
          project.background || '', (val) => updateProject({ background: val }))}


        {/* ---------- Experiment planner ---------- */}
        <SectionCard title="🧪 Experiment planner" open={openSections.experiments} onToggle={() => toggleSection('experiments')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{(project.experiments || []).length}</span>}>
          <p className="text-xs text-slate-500 mb-3">
            Plan as many tests as needed (NMR, ssNMR, DOSY, CD, plate assays, cloning, expression…). Clicking a test
            type creates the classic test page and makes its button appear inside the collapsible window below —
            each button is the link to that test page.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEST_TYPE_OPTIONS.map((opt) => (
              <button key={opt.type} type="button" onClick={() => addExperiment(opt.type)}
                      className={`px-3 py-1.5 text-xs font-bold text-white rounded-lg transition-colors ${opt.color}`}>
                + {opt.label}
              </button>
            ))}
          </div>
          {visibleTests.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-black uppercase tracking-wide text-slate-400">Link existing test:</label>
              <select value={linkTestId} onChange={(e) => setLinkTestId(e.target.value)}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700 max-w-xs">
                <option value="">Choose a test…</option>
                {visibleTests.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {testTypeLabel(t.type)}</option>
                ))}
              </select>
              <button onClick={linkExistingTest} disabled={!linkTestId}
                      className="px-3 py-1 text-[10px] font-bold rounded-lg bg-slate-600 text-white hover:bg-slate-700 disabled:opacity-40">
                + Link
              </button>
            </div>
          )}
        </SectionCard>


        {/* ---------- Experiments: collapsible window with the added tests ---------- */}
        <SectionCard title="🧪 Experiments in this project" open={openSections.expWindow} onToggle={() => toggleSection('expWindow')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{(project.experiments || []).length}</span>}>
          {(project.experiments || []).length === 0 ? (
            <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">
              No experiments yet — click a test type above to add the first one. Its button will appear here as a link
              to the classic test page.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {(project.experiments || []).map((exp) => {
                const test = tests.find((t) => t.id === exp.testId);
                return (
                  <div key={exp.id}
                       className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-2 hover:border-blue-300 hover:shadow-sm transition-shadow">
                    <button onClick={() => openTest(exp.testId)}
                            className="flex items-center gap-2 min-w-0 text-left">
                      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-white bg-blue-600 rounded px-2 py-1">
                        {exp.label}
                      </span>
                      <span className="text-xs font-bold text-slate-700 truncate">{test?.name || 'Test'}</span>
                      <span className="text-[10px] text-slate-400 hidden md:inline">📅 {test?.date || '—'}</span>
                    </button>
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer"
                           title="Include this test in the exported project document (its ⭐-starred figures, plots and tables)">
                      <input type="checkbox" checked={!!exp.includeInDocument} onChange={() => toggleInclude(exp.id)}
                             className="w-3.5 h-3.5 accent-blue-600" />
                      Include
                    </label>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap"
                          title="Items ⭐-starred on the test page that will be imported into the document">
                      ⭐ {getStarredItems(test).length}
                    </span>
                    <button onClick={() => removeExperiment(exp.id)}
                            className="shrink-0 text-red-400 hover:text-red-600 text-xs px-1.5" title="Remove from project">
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

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

        {/* ---------- Discussion ---------- */}
        {textSection('discussion', '💬 Discussion',
          'Interpretation of the results, comparisons, limitations and open questions.',
          project.discussion || '', (val) => updateProject({ discussion: val }))}

        {/* ---------- Conclusions ---------- */}
        {textSection('conclusions', '✅ Conclusions',
          'Main take-aways, significance and next steps of the project.',
          project.conclusions || '', (val) => updateProject({ conclusions: val }))}


        {/* ---------- Bibliography ---------- */}
        <SectionCard title="📚 Bibliography" open={openSections.bibliography} onToggle={() => toggleSection('bibliography')}
                     badge={<span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{refs.length}</span>}>
          <p className="text-xs text-slate-500 mb-3">
            Numbered references collected from the text sections. They are taken from the
            <strong> “Project bibliography”</strong> (papers labeled with this project in Publications) and the
            <strong> “Publications of the scientist”</strong> (the imported publication list of {project.scientist || 'the project owner'}).
          </p>

          {refs.length === 0 ? (
            <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-center mb-3">
              No references yet — use “📚 Insert reference” inside the text sections, or add them below.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 mb-3">
              {refs.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 bg-white border border-slate-200 rounded-lg p-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800">
                      <span className="text-indigo-600 font-black mr-1">[{r.number}]</span>
                      {r.title || 'Untitled'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {[r.authors, r.journal, r.year, r.source].filter(Boolean).join(' · ')}
                    </div>
                    {r.link && <a href={r.link} target="_blank" rel="noreferrer"
                                  className="text-[10px] text-blue-600 hover:underline break-all">{r.link}</a>}
                  </div>
                  <button onClick={() => removeRef(r.id)}
                          className="shrink-0 text-red-400 hover:text-red-600 text-xs px-1.5" title="Remove reference">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={() => setRefPicker({ insertText: null })}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              + Add reference from bibliography / publications
            </button>
          </div>


          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                Project bibliography papers ({projectBib.length}) — also editable in Publications → “Project bibliography”
              </div>
              <button onClick={() => setShowBibForm((v) => !v)}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800">
                {showBibForm ? 'Cancel' : '+ Add paper'}
              </button>
            </div>
            {showBibForm && (
              <div className="bg-indigo-50/50 border border-indigo-200 rounded-lg p-3 mb-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 mb-1 block">Title *</label>
                    <input className={inputCls} value={bibDraft.title}
                           onChange={(e) => setBibDraft((d) => ({ ...d, title: e.target.value }))}
                           placeholder="Paper title" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 mb-1 block">Link / DOI</label>
                    <input className={inputCls} value={bibDraft.link}
                           onChange={(e) => setBibDraft((d) => ({ ...d, link: e.target.value }))}
                           placeholder="https://doi.org/…" />
                  </div>
                </div>
                <div className="flex justify-end mt-2">
                  <button onClick={addBibPaper} disabled={!bibDraft.title.trim()}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                    + Add to project bibliography
                  </button>
                </div>
              </div>
            )}
            {projectBib.length === 0 ? (
              <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3 text-center">
                No papers labeled with “{project.name}” yet.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {projectBib.map((b) => (
                  <div key={b.id} className="flex items-start justify-between gap-3 bg-white border border-slate-200 rounded-lg p-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800">{b.title}</div>
                      {b.link && <a href={b.link} target="_blank" rel="noreferrer"
                                    className="text-[10px] text-blue-600 hover:underline break-all">{b.link}</a>}
                    </div>
                    <button onClick={() => removeBibPaper(b.id)}
                            className="shrink-0 text-red-400 hover:text-red-600 text-xs px-1.5" title="Remove paper">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>


        {renderCommentsSection()}

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
                  const remaining = projects.filter((p) => p.id !== project.id);
                  setProjects(remaining);
                  saveProjects(remaining);
                  backToList();
                }}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {renderRefPicker()}
      {renderTableDraft()}
      {renderExport()}
    </div>
  );
};

