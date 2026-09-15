// src/components/Publications.jsx
// Publications → Journals table (inspired by the attached Journals.pdf table).
// Sorted by Impact Factor (highest → lowest); IF is editable inline and the list
// re-sorts live. Every journal can carry a comment and one or more links.
// Persisted in localStorage under "labWorkspace_journals".

import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icons';
import { DriveUploadButton } from './DriveUpload';
import { extractDriveFileIds, trashDriveFile } from '../utils/driveUpload';
import { loadProjects, saveProjects } from './AppModules/projectsModule';
import {
  AUTHOR_STYLE_IDS, AUTHOR_STYLES, PUB_FORMAT_KEY, PUB_FORMAT_PRESETS,
  authorMatchesCandidate, buildPubFormat, loadPubFormat, matchCoauthors,
  pubCitationHtml, scientistStyleOf
} from './pubCitation';

const JOURNALS_STORAGE_KEY = 'labWorkspace_journals';

const inputCls =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white';
const labelCls = 'block text-[10px] font-bold text-slate-400 uppercase mb-1';

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
  AUTHOR_STYLES, AUTHOR_STYLE_IDS, PUB_FORMAT_PRESETS,
  buildPubFormat, loadPubFormat, normalizePubFormat,
  pubCitationHtml, pubCitationText, pubFieldValue, pubDoiUrl,
  authorMatchesCandidate, matchCoauthors, isLabAuthor, labMemberOf,
  scientistStyleOf, authorStyleOf, sanitizeScientistStyles
} from './pubCitation';

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
      authors: (r.authors || []).map((a) => a.name).join(', '),
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
        authors: (it.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean).join(', '),
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
        authors: (it.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean).join(', '),
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
      authors: authorName || '',
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
  return out;
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
  const [pubFormat, setPubFormat] = useState(loadPubFormat);
  const [pubFormatScope, setPubFormatScope] = useState('default'); // 'default' | project name
  const [pubAddField, setPubAddField] = useState('doi'); // field id to add via the "+ Add field" control
  useEffect(() => {
    try { localStorage.setItem(PUB_FORMAT_KEY, JSON.stringify(pubFormat)); } catch { /* ignore */ }
  }, [pubFormat]);
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
  const [pbTransferStatus, setPbTransferStatus] = useState('');
  const [showAddPaper, setShowAddPaper] = useState(false);
  const [paperDraft, setPaperDraft] = useState({ title: '', link: '', labels: [], scientist: '', comments: '' });
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
  const [pbDraft, setPbDraft] = useState({ project: '', title: '', link: '', comments: '' });
  const [pbExpanded, setPbExpanded] = useState(null);
  // Import papers (from Relevant papers / Publications of the scientist) into a project
  const [pbImportOpen, setPbImportOpen] = useState(false);
  const [pbImportProject, setPbImportProject] = useState('');
  const [pbImportSel, setPbImportSel] = useState(new Set());

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
        rows.push({ ...paper, projectId: prj.id, projectName: prj.name, projectScientist: prj.scientist });
      });
    });
    if (pbFilter !== 'all') return rows.filter((r) => r.projectName === pbFilter);
    return rows;
  }, [myProjects, pbFilter]);

  const addPbPaper = () => {
    const title = (pbDraft.title || '').trim();
    if (!title || !pbDraft.project) return;
    setPbProjects((prev) => prev.map((prj) => {
      if (prj.name !== pbDraft.project) return prj;
      return {
        ...prj,
        bibliography: [...(prj.bibliography || []), {
          id: 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          title, link: pbDraft.link.trim(), scientist: prj.scientist, comments: pbDraft.comments.trim()
        }]
      };
    }));
    setPbDraft({ project: '', title: '', link: '', comments: '' });
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
      comments: paperDraft.comments || '',
      createdAt: Date.now()
    }]);
    setPaperDraft({ title: '', link: '', labels: [], scientist: '', comments: '' });
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
      scientist, comments: '', createdAt: Date.now()
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
      items.push({ id: genPubId(), title: r.title || '', link, labels: finalLabels, subject: finalLabels[0], scientist, comments: '', createdAt: Date.now() });
    }
    if (items.length > 0) setPapers((prev) => [...prev, ...items]);
    setAddedPaperKeys((prev) => [...prev, ...paperResults.map((r) => paperKey(r))]);
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
  const paperCols = ['Labels', 'Title', 'Link', 'Scientist', 'PDF', 'Comments', ''];

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
        </div>
      </div>
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
    } else {
      setPbProjects((prev) => prev.map((p) => (p.name === pubFormatScope ? { ...p, pubFormat: fmt } : p)));
    }
  };
  const pubCustomFormat = (fields) => ({
    preset: 'custom',
    etAlLimit: activeFormat.etAlLimit || 0,
    alwaysShowScientists: !!activeFormat.alwaysShowScientists,
    underlineScientists: !!activeFormat.underlineScientists,   // legacy default style
    scientistStyles: { ...(activeFormat.scientistStyles || {}) },
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
          <label className="text-[10px] font-black uppercase tracking-wide text-slate-400">Journal preset:</label>
          <select value={activeFormat.preset} onChange={(e) => setActiveFormat(buildPubFormat(e.target.value))}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
            {Object.entries(PUB_FORMAT_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm text-slate-500 mb-3">
          Choose how every citation is built: the order of the fields, the style of each field
          (bold / italic / underline / prefix / suffix) and which fields are shown at all.
          Every author of the paper is listed; you can cut long author lists with “et al.” after
          a given number of authors, always keep the lab members (user list) in the citation
          even past that cutoff, and choose how each of their names is styled — underlined or
          bold — wherever it appears among the authors. Formats can be set per project (each
          project keeps its own) or left to the default. The formatted citations are used in the
          publications table and in the project documents that reference these publications.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">
            Live preview {pubFormatScope !== 'default' ? `— project “${pubFormatScope}”` : '— default'}
          </div>
          <div className="text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: pubCitationHtml(samplePub, activeFormat, citationScientists) || '—' }} />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
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

        {/* Every author of the paper is listed (the “et al.” rule above is
            untouched): here you choose how the lab members' names are dressed
            up in the citation — each member independently. */}
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
          <p className="text-[11px] text-slate-500 mb-2">
            This does not remove anybody: it only styles the lab members' names wherever they appear
            among the authors of a paper.
            <b className="text-slate-700"> Aa</b> = normal,
            <b className="text-slate-700"> U</b> = underline,
            <b className="text-slate-700"> B</b> = bold.
          </p>
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
    </section>
  );

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
          <button type="button" onClick={() => setPbShowAdd((v) => !v)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition">
            {pbShowAdd ? 'Cancel' : '+ Add paper'}
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
                  {['Project', 'Title', 'Link', 'Scientist', 'PDF', 'Comments', ''].map((h, hi) => (
                    <th key={hi} className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pbRows.length === 0 ? (
                  <tr><td colSpan={7} className="text-xs text-slate-400 italic px-3 py-3">No project bibliography papers yet — use “+ Add paper” to label a paper with a project name.</td></tr>
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
                            <td colSpan={7} className="px-4 py-3 border-b border-slate-200">
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

