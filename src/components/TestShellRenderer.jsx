import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RichTextEditor } from './RichTextEditor';
import { BufferAdditiveFields } from './DefinitionsExtra';
import { SearchableSelect } from './SearchableSelect';
import { parseSimulationParameters } from './MDData';
import { CLASSIFICATION_MAP, PRIMARY_CATEGORIES } from '../data/testTypes';
import { CollapsibleSection } from './ui';
export { CollapsibleSection };

/* ============================================================================
HELPERS
========================================================================== */

const sortAlpha = (arr) => {
  if (!Array.isArray(arr)) return [];

  return [...arr].sort((a, b) =>
    String(a ?? '').localeCompare(String(b ?? ''), undefined, {
      sensitivity: 'base'
    })
  );
};

const uniqueOptions = (arr) => {
  if (!Array.isArray(arr)) return [];

  return Array.from(
    new Set(
      arr.filter((value) => value !== null && value !== undefined && value !== '')
    )
  );
};

const alignCaptions = (images, captions) => {
  if (!Array.isArray(images)) return [];

  return images.map((_, i) =>
    Array.isArray(captions) && captions[i] != null ? captions[i] : ''
  );
};

const getFieldKey = (field) => field?.key || field?.name || '';

const getFieldLabel = (field) =>
  field?.label || field?.name || field?.key || '';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

/* CollapsibleSection now lives in ./ui (single shared definition). */

/* ============================================================================
MULTI-SELECT DROPDOWN
========================================================================== */

export const MultiSelectDropdown = ({
  label,
  options = [],
  selected = [],
  onToggle,
  onClear,
  placeholder = 'Select…',
  emptyHint = 'No options defined. Add them in Definitions & Labels.',
  accent = 'blue'
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);

    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const optionsSafe = uniqueOptions(Array.isArray(options) ? options : []);
  const selectedSafe = Array.isArray(selected) ? selected : [];

  // Type-ahead: as the user types, only matching options remain.
  const q = query.trim().toLowerCase();
  const visibleOptions = q
    ? optionsSafe.filter((o) => String(o).toLowerCase().includes(q))
    : optionsSafe;

  const emerald = accent === 'emerald';

  const boxCls = emerald
    ? 'bg-emerald-50 border-emerald-200'
    : 'bg-blue-50 border-blue-200';

  const labelCls = emerald ? 'text-emerald-800' : 'text-blue-800';

  const badgeCls = emerald
    ? 'bg-emerald-200 text-emerald-800'
    : 'bg-blue-200 text-blue-800';

  const buttonCls = emerald
    ? 'border-emerald-300 focus:border-emerald-500'
    : 'border-blue-300 focus:border-blue-500';

  const selectedTextCls = emerald
    ? 'font-bold text-emerald-900'
    : 'font-bold text-blue-900';

  const arrowCls = emerald ? 'text-emerald-700' : 'text-blue-700';

  const menuCls = emerald ? 'border-emerald-200' : 'border-blue-200';

  const optionHoverCls = emerald ? 'hover:bg-emerald-50' : 'hover:bg-blue-50';

  const optionSelectedCls = emerald
    ? 'font-bold text-emerald-800'
    : 'font-bold text-blue-800';

  const chipCls = emerald
    ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
    : 'bg-blue-100 border-blue-300 text-blue-900';

  const chipRemoveCls = emerald
    ? 'text-emerald-500 hover:text-red-600'
    : 'text-blue-500 hover:text-red-600';

  const checkboxCls = emerald ? 'accent-emerald-600' : 'accent-blue-600';

  return (
    <div
      ref={ref}
      className={`relative flex flex-col gap-1 p-3 border rounded-lg ${boxCls}`}
    >
      <label
        className={`text-xs font-bold uppercase flex items-center justify-between mb-2 ${labelCls}`}
      >
        <span>{label}</span>
        <span className={`text-[9px] px-2 py-0.5 rounded ${badgeCls}`}>
          Dropdown • Multiple selection
        </span>
      </label>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setQuery('');
        }}
        className={`w-full border rounded-md p-2 text-sm bg-white outline-none flex items-center justify-between gap-3 shadow-sm ${buttonCls}`}
      >
        <span
          className={`truncate ${
            selectedSafe.length ? selectedTextCls : 'text-slate-400'
          }`}
        >
          {selectedSafe.length ? selectedSafe.join(', ') : placeholder}
        </span>
        <span className={`font-bold ${arrowCls}`}>▾</span>
      </button>

      {open && (
        <div
          className={`absolute top-full left-3 right-3 mt-1 z-50 bg-white border rounded-lg shadow-xl max-h-72 overflow-y-auto custom-scrollbar ${menuCls}`}
        >
          <div className="sticky top-0 bg-white border-b border-slate-100 p-2 z-10">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter…"
              autoFocus
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            />
          </div>
          {optionsSafe.length === 0 ? (
            <div className="p-3 text-sm text-slate-400 italic">{emptyHint}</div>
          ) : visibleOptions.length === 0 ? (
            <div className="p-3 text-sm text-slate-400 italic">
              No option matches “{query.trim()}”.
            </div>
          ) : (
            visibleOptions.map((opt, idx) => (
              <label
                key={`${String(opt)}-${idx}`}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-slate-100 last:border-b-0 ${optionHoverCls}`}
              >
                <input
                  type="checkbox"
                  checked={selectedSafe.includes(opt)}
                  onChange={() => onToggle && onToggle(opt)}
                  className={`w-4 h-4 ${checkboxCls}`}
                />
                <span
                  className={`text-sm ${
                    selectedSafe.includes(opt)
                      ? optionSelectedCls
                      : 'text-slate-700'
                  }`}
                >
                  {String(opt)}
                </span>
              </label>
            ))
          )}
        </div>
      )}

      {selectedSafe.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedSafe.map((s, idx) => (
            <span
              key={`${String(s)}-${idx}`}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border ${chipCls}`}
            >
              {String(s)}
              <button
                type="button"
                onClick={() => onToggle && onToggle(s)}
                className={`font-black ${chipRemoveCls}`}
                title={`Remove ${s}`}
              >
                ×
              </button>
            </span>
          ))}

          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-bold text-red-500 hover:text-red-700 underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ============================================================================
IMAGE URL NORMALIZATION
========================================================================== */

const normalizeImageCandidates = (url) => {
  let u = (url || '').trim();
  
  // Automatically prepend https:// if the user pastes a raw domain
  if (u && !/^https?:\/\//i.test(u)) {
    u = `https://${u}`;
  }

  let m = u.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }

  m = u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }

  if (u.includes('dropbox.com')) {
    const clean = u.replace(/[?&]dl=0/g, '');
    const raw = clean + (clean.includes('?') ? '&raw=1' : '?raw=1');
    return [raw, u];
  }

  return [u];
};

/* ============================================================================
SMART IMAGE
========================================================================== */

export const SmartImage = ({ src, alt, style }) => {
  const cands = useMemo(() => normalizeImageCandidates(src), [src]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [src]);

  const fallbackStyle = style || { minHeight: '150px', maxHeight: '400px' };

  if (!src || cands.length === 0) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded text-slate-400 text-xs text-center px-4 py-6"
        style={fallbackStyle}
      >
        ⚠️ No image URL provided.
      </div>
    );
  }

  if (failed) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded text-slate-400 text-xs text-center px-4 py-6"
        style={fallbackStyle}
      >
        ⚠️ Preview not available. If the file is private, set it to “Anyone
        with the link can view”.
      </div>
    );
  }

  const currentSrc = cands[Math.min(idx, cands.length - 1)];

  return (
    <img
      key={currentSrc} // Forces React to recreate the element on fallback, preventing stuck broken images
      src={currentSrc}
      alt={alt}
      referrerPolicy="no-referrer" // Helps bypass Drive hotlinking protections
      className="w-full h-auto object-contain rounded bg-white"
      style={fallbackStyle}
      onError={() => {
        if (idx < cands.length - 1) {
          setIdx(idx + 1);
        } else {
          setFailed(true);
        }
      }}
    />
  );
};


/* ============================================================================
MAIN SHELL
========================================================================== */

export const TestShellRenderer = ({
  config = {},
  custom = {},
  activeTest = {},
  updateActiveTest,
  TestHeader,
  datasetProtocols,
  jumpToProtocol,
  allCmpds,
  allCellLines,
  customFields,
  testCategories: _testCategories,
  ...rest
}) => {
  const update = (u) => {
    if (updateActiveTest) updateActiveTest(u);
  };

  const t = activeTest || {};

  const samplesCfg = config.samples || {};
  const imagesKey = config.imagesKey || 'images';
  const typeKey = config.typeKey || 'test';

  const compound = t.compound || '';
  const comments = typeof t.comments === 'string' ? t.comments : t.comments || '';

  const images = Array.isArray(t[imagesKey]) ? t[imagesKey] : [];
  const documents = Array.isArray(t.documents) ? t.documents : [];
  const cellLines = Array.isArray(t.cellLines) ? t.cellLines : [];

  const linkedProtocolId = t.linkedProtocolId || '';

  const customFieldValues =
    t.customFieldValues && typeof t.customFieldValues === 'object'
      ? t.customFieldValues
      : {};

const experimentPlan = Array.isArray(t.plan) ? t.plan : [];

  const [zoomImage, setZoomImage] = useState(null);
  const [mdParamFileReport, setMdParamFileReport] = useState(null);

const [showGeneral, setShowGeneral] = useState(true);
  const [showSetup, setShowSetup] = useState(true);
  const [showMolSys, setShowMolSys] = useState(true);
  const [showData, setShowData] = useState(true);
  const [showReport, setShowReport] = useState(true);

  const [tableRows, setTableRows] = useState(2);
  const [tableCols, setTableCols] = useState(3);

  const planDateId = `plan-date-${t.id ?? 'unsaved'}`;

  const testCategory = t.testCategory || 'Activity';

  // Primary classification: only the canonical official categories are offered,
  // plus the current test's stored value (so an old/custom value stays visible
  // until it is re-selected). Stale categories inherited from older datasets
  // are intentionally not shown here.
  const categories = [
    ...new Set([...PRIMARY_CATEGORIES, testCategory].filter(Boolean))
  ];

  const operatorsRaw = Array.isArray(rest.operators) ? rest.operators : [];

  const operators = sortAlpha(
    operatorsRaw
      .map((op) =>
        typeof op === 'string'
          ? op
          : `${op?.name || ''} ${op?.surname || ''}`.trim()
      )
      .filter(Boolean)
  );

  const testOperator = t.operator || '';

  const buffersFromDefs = Array.isArray(rest.buffers) ? rest.buffers : [];
  const additivesFromDefs = Array.isArray(rest.additives) ? rest.additives : [];
  const solventsFromDefs = Array.isArray(rest.solvents) ? rest.solvents : [];

  const sortedCompounds = sortAlpha(allCmpds);
  const sortedCellLines = sortAlpha(allCellLines);

  const showCompounds = samplesCfg.compounds !== false;
  const showCellLines = samplesCfg.cellLines !== false;
  const showCompoundsSection = showCompounds || showCellLines;

  const compoundLabel =
    samplesCfg.compoundLabel ||
    config.samplesLabel ||
    'Compound / Sample Label(s)';

  const cellLineLabel =
    samplesCfg.cellLineLabel || 'Cell Lines / Biological Models';

  const selectedCompounds = (() => {
    if (Array.isArray(t.selectedCompounds)) {
      return t.selectedCompounds.filter(Boolean);
    }

    if (Array.isArray(t.compoundsSelected)) {
      return t.compoundsSelected.filter(Boolean);
    }

    if (typeKey !== 'plate' && Array.isArray(t.compounds)) {
      return t.compounds.filter(Boolean);
    }

    if (compound) {
      return String(compound)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    return [];
  })();

  const linkedProtocolIds = Array.isArray(t.linkedProtocolIds)
    ? t.linkedProtocolIds.filter(Boolean)
    : linkedProtocolId
      ? [linkedProtocolId]
      : [];

  const safeDatasetProtocols = Array.isArray(datasetProtocols)
    ? datasetProtocols
    : [];

  const addLinkedProtocol = (id) => {
    if (!id || linkedProtocolIds.includes(id)) return;

    const upd = [...linkedProtocolIds, id];

    update({
      linkedProtocolIds: upd,
      linkedProtocolId: upd[0]
    });
  };

  const removeLinkedProtocol = (id) => {
    const upd = linkedProtocolIds.filter((p) => p !== id);

    update({
      linkedProtocolIds: upd,
      linkedProtocolId: upd[0] || ''
    });
  };

  const toggleCompound = (cmp) => {
    const upd = selectedCompounds.includes(cmp)
      ? selectedCompounds.filter((c) => c !== cmp)
      : [...selectedCompounds, cmp];

    const payload = {
      selectedCompounds: upd,
      compoundsSelected: upd,
      compound: upd.length > 0 ? upd[0] : ''
    };

    if (typeKey !== 'plate') {
      payload.compounds = upd;
    }

    update(payload);
  };

  const clearCompounds = () => {
    const payload = {
      selectedCompounds: [],
      compoundsSelected: [],
      compound: ''
    };

    if (typeKey !== 'plate') {
      payload.compounds = [];
    }

    update(payload);
  };

  const toggleCellLine = (cl) => {
    const upd = cellLines.includes(cl)
      ? cellLines.filter((c) => c !== cl)
      : [...cellLines, cl];

    update({ cellLines: upd });
  };

  const handleCustomFieldChange = (fieldName, value) => {
    update({
      customFieldValues: {
        ...customFieldValues,
        [fieldName]: value
      }
    });
  };

  const figureCaptions = Array.isArray(t.figureCaptions)
    ? t.figureCaptions
    : [];

  const captionsAligned = alignCaptions(images, figureCaptions);

  const updateFigureCaption = (idx, value) => {
    const next = captionsAligned.slice();
    next[idx] = value;

    update({ figureCaptions: next });
  };

  const addImageLink = (url) => {
    update({
      [imagesKey]: [...images, url],
      figureCaptions: [...captionsAligned, `Figure ${images.length + 1}:`]
    });
  };

  const removeImageAt = (idx) => {
    update({
      [imagesKey]: images.filter((_, i) => i !== idx),
      figureCaptions: captionsAligned.filter((_, i) => i !== idx)
    });
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setZoomImage(null);
    };

    document.addEventListener('keydown', handler);

    return () => document.removeEventListener('keydown', handler);
  }, []);

  const normalizeScopeValue = (value) => String(value || '').toLowerCase();

  const currentTabKey = normalizeScopeValue(config.typeKey || t.type || 'test');
  const currentTestType = normalizeScopeValue(t.type || currentTabKey);

  const isMdType =
    currentTestType === 'md_simulation' || currentTestType === 'md';

  const customFieldMatchesTab = (field) => {
    if (!field) return false;

    const scopes = [];

    const addScopes = (value) => {
      if (!value) return;

      if (Array.isArray(value)) {
        value.forEach(addScopes);
      } else {
        scopes.push(normalizeScopeValue(value));
      }
    };

    addScopes(field.appliesTo);
    addScopes(field.applyTo);
    addScopes(field.scope);
    addScopes(field.tab);
    addScopes(field.tabs);
    addScopes(field.testType);
    addScopes(field.types);

    if (scopes.length === 0) return true;
    if (scopes.includes('all') || scopes.includes('*')) return true;

    return scopes.some((scope) => {
      if (!scope) return false;

      if (scope === currentTabKey || scope === currentTestType) return true;

      if (scope === 'plate') {
        return currentTabKey === 'plate' || currentTestType.startsWith('plate');
      }

      return false;
    });
  };

  const typeCustomFields = (customFields || []).filter(customFieldMatchesTab);

  // Resolve which named "subsection" of the current page a custom field
  // belongs to. Prefers the new `subsection` key (a notebookChecks id,
  // e.g. 'cond', 'seq', 'instrument'). Falls back to the legacy binary
  // `placement` ('conditions' / 'instrumental') for fields saved before
  // subsections existed, and finally defaults to 'cond'.
  const getFieldSubsection = (field) => {
    const explicit = String(field?.subsection || '').trim().toLowerCase();
    if (explicit) return explicit;

    const legacy = String(
      field?.placement || field?.section || field?.location || ''
    ).toLowerCase();

    if (legacy === 'instrumental') return 'instrument';
    return 'cond';
  };

  const pageNotebookChecks = Array.isArray(config.notebookChecks)
    ? config.notebookChecks
    : [];

  const conditionCustomFields = typeCustomFields.filter(
    (f) => getFieldSubsection(f) === 'cond'
  );

  const instrumentalCustomFields = typeCustomFields.filter(
    (f) => getFieldSubsection(f) === 'instrument'
  );

  // Any other named subsection this page exposes (Sequence, Table, Images,
  // etc. — sourced from the page's own notebookChecks) that has custom
  // fields assigned to it. These render in their own "Additional Fields"
  // card further down the page, grouped by that subsection's label.
  const otherSubsectionCustomFields = pageNotebookChecks
    .filter((c) => c.id !== 'cond' && c.id !== 'instrument')
    .map((c) => ({
      id: c.id,
      label: c.label,
      fields: typeCustomFields.filter((f) => getFieldSubsection(f) === c.id)
    }))
    .filter((group) => group.fields.length > 0);

  const renderConditionField = (f) => {
    if (!f || !f.key) return null;

    const val =
      t[f.key] !== undefined && t[f.key] !== null ? t[f.key] : '';

    const hasUnits = Array.isArray(f.units) && f.units.length > 0;

    const unitVal =
      t[`${f.key}Unit`] !== undefined && t[`${f.key}Unit`] !== null
        ? t[`${f.key}Unit`]
        : hasUnits
          ? f.units[0]
          : '';

    const cls =
      'w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500';

    const inputCls = hasUnits
      ? 'flex-1 border border-slate-300 rounded-l-lg p-2 text-sm outline-none focus:border-blue-500 min-w-0'
      : cls;

    const isSolventMedia =
      f.type === 'solvent-select' ||
      ['solvent', 'medium', 'media'].includes(f.key);

    if (isSolventMedia) {
      const options = uniqueOptions(
        solventsFromDefs.map((s) =>
          typeof s === 'string' ? s : s?.name || ''
        )
      );

      return (
        <div key={f.key}>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            {f.label}
          </label>
          <SearchableSelect
            value={val}
            onChange={(v) => update({ [f.key]: v })}
            options={options}
            placeholder={f.placeholder || 'Select or type…'}
            allowCustom
            onClear={() => update({ [f.key]: '' })}
          />
        </div>
      );
    }

    const isOtherMolecule =
      f.type === 'compound-select' || f.key === 'otherMolecule';

    if (isOtherMolecule) {
      const options = uniqueOptions(sortedCompounds);

      return (
        <div key={f.key}>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            {f.label}
          </label>
          <SearchableSelect
            value={val}
            onChange={(v) => update({ [f.key]: v })}
            options={options}
            placeholder={f.placeholder || 'Select or type a compound…'}
            allowCustom
            onClear={() => update({ [f.key]: '' })}
          />
        </div>
      );
    }

    return (
      <div key={f.key}>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
          {f.label}
        </label>

        <div className={hasUnits ? 'flex' : ''}>
          {f.type === 'date' ? (
            <input
              type="date"
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className={inputCls}
            />
          ) : f.type === 'number' ? (
            <input
              type="number"
              step={f.step || 'any'}
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className={inputCls}
              placeholder={f.placeholder}
            />
          ) : f.type === 'select' ? (
            <select
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className={inputCls}
            >
              <option value="">{f.placeholder || '-- Select --'}</option>
              {sortAlpha(f.options || []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className={inputCls}
              placeholder={f.placeholder}
              rows={3}
            />
          ) : (
            <input
              type="text"
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className={inputCls}
              placeholder={f.placeholder}
            />
          )}

          {hasUnits && (
            <select
              value={unitVal}
              onChange={(e) => update({ [`${f.key}Unit`]: e.target.value })}
              className="border border-l-0 border-slate-300 rounded-r-lg px-2 py-2 text-sm bg-slate-50 outline-none focus:border-blue-500 text-slate-700 font-medium"
            >
              {f.units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  };

  const handleMdParamFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        const text = ev.target.result;

        const parsed = parseSimulationParameters(text, file.name);

        const parsedUpdates =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};

        const count = Object.keys(parsedUpdates).length;

        if (count > 0) {
          update(parsedUpdates);
          setMdParamFileReport({ ok: true, count, name: file.name });
        } else {
          setMdParamFileReport({ ok: false, count: 0, name: file.name });
        }
      } catch {
        setMdParamFileReport({
          ok: false,
          count: 0,
          name: file.name,
          error: true
        });
      }
    };

    reader.onerror = () =>
      setMdParamFileReport({
        ok: false,
        count: 0,
        name: file.name,
        error: true
      });

    reader.readAsText(file);
    e.target.value = '';
  };

  const renderCustomMetadataField = (field) => {
    const fieldKey = getFieldKey(field);
    if (!fieldKey) return null;

    const fieldLabel = getFieldLabel(field);

    const val =
      customFieldValues[fieldKey] !== undefined &&
      customFieldValues[fieldKey] !== null
        ? customFieldValues[fieldKey]
        : '';

    const cls =
      'w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500';

    return (
      <div key={field.id || fieldKey}>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
          {fieldLabel}
        </label>

        {field.type === 'date' ? (
          <input
            type="date"
            value={val}
            onChange={(e) => handleCustomFieldChange(fieldKey, e.target.value)}
            className={cls}
          />
        ) : field.type === 'number' ? (
          <input
            type="number"
            value={val}
            onChange={(e) => handleCustomFieldChange(fieldKey, e.target.value)}
            className={cls}
            placeholder="Enter value..."
          />
        ) : field.type === 'select' ? (
          <select
            value={val}
            onChange={(e) => handleCustomFieldChange(fieldKey, e.target.value)}
            className={cls}
          >
            <option value="">-- Select --</option>
            {sortAlpha(field.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : field.type === 'textarea' ? (
          <textarea
            value={val}
            onChange={(e) => handleCustomFieldChange(fieldKey, e.target.value)}
            className={cls}
            placeholder="Enter value..."
            rows={3}
          />
        ) : (
          <input
            type="text"
            value={val}
            onChange={(e) => handleCustomFieldChange(fieldKey, e.target.value)}
            className={cls}
            placeholder="Enter value..."
          />
        )}
      </div>
    );
  };

  /* ===== MANDATORY PARAMETERS (per special page + optional subsection) =====
     Rules and per-page behavior come from the Definitions & Labels ->
     Custom Metadata Fields -> Mandatory Parameters manager. Each rule is
     { page: 'all' | typeKey, subsection: '' | notebookCheck id, fieldName }.
     Behavior is looked up per page: 'block' | 'warning' | 'deactivate'
     (defaults to 'warning' to match the previous behavior). */
  const mandatoryRules = Array.isArray(rest.mandatoryRules)
    ? rest.mandatoryRules
    : [];

  const mandatoryBehaviorMap =
    rest.mandatoryBehavior && typeof rest.mandatoryBehavior === 'object'
      ? rest.mandatoryBehavior
      : {};

  const mandatoryBehaviorForPage = mandatoryBehaviorMap[typeKey] || 'warning';

  const applicableMandatoryRules = mandatoryRules.filter(
    (r) => r && (r.page === 'all' || r.page === typeKey)
  );

  const notebookCheckLabelById = pageNotebookChecks.reduce((acc, c) => {
    acc[c.id] = c.label;
    return acc;
  }, {});

  const missingMandatoryRules = useMemo(() => {
    if (
      mandatoryBehaviorForPage === 'deactivate' ||
      !applicableMandatoryRules.length
    ) {
      return [];
    }

    const conditionFieldData = (
      Array.isArray(config.conditionFields) ? config.conditionFields : []
    ).reduce((acc, f) => {
      const value = f?.key ? t[f.key] : undefined;

      if (f?.label) {
        acc[String(f.label).toLowerCase()] = value;
      }

      if (f?.key) {
        acc[String(f.key).toLowerCase()] = value;
      }

      return acc;
    }, {});

    const customValueData = Object.keys(customFieldValues).reduce(
      (acc, k) => {
        acc[k.toLowerCase()] = customFieldValues[k];
        return acc;
      },
      {}
    );

    const customFieldData = typeCustomFields.reduce((acc, field) => {
      const key = getFieldKey(field);
      const label = getFieldLabel(field);
      const value = key ? customFieldValues[key] : undefined;

      if (key) acc[key.toLowerCase()] = value;
      if (label) acc[label.toLowerCase()] = value;

      return acc;
    }, {});

    const currentData = {
      operator: testOperator,
      'experiment type': testCategory,
      'secondary classification': t.secondaryCategory,
      compound: selectedCompounds.length
        ? selectedCompounds
        : compound
          ? [compound]
          : [],
      compounds: selectedCompounds.length
        ? selectedCompounds
        : compound
          ? [compound]
          : [],
      'cell line': cellLines.length ? cellLines : [],
      'cell lines': cellLines.length ? cellLines : [],
      date: t.date,
      'experiment date': t.date,
      instance: t.instanceName,
      ...conditionFieldData,
      ...customValueData,
      ...customFieldData
    };

    return applicableMandatoryRules
      .filter((rule) => {
        const key = String(rule.fieldName || '').toLowerCase().trim();
        if (!key) return false;

        const val = currentData[key];

        if (val === 0) return false;
        if (val === false) return false;

        if (val === undefined || val === null) return true;

        if (typeof val === 'string' && val.trim() === '') return true;

        if (Array.isArray(val) && val.length === 0) return true;

        return false;
      })
      .map((rule) => ({
        ...rule,
        subsectionLabel:
          rule.subsection && rule.subsection !== 'all'
            ? notebookCheckLabelById[rule.subsection] || rule.subsection
            : 'General'
      }));
  }, [
    applicableMandatoryRules,
    mandatoryBehaviorForPage,
    t,
    config.conditionFields,
    customFieldValues,
    typeCustomFields,
    selectedCompounds,
    compound,
    cellLines,
    testCategory,
    testOperator
  ]);

  const mandatoryBlocked =
    mandatoryBehaviorForPage === 'block' && missingMandatoryRules.length > 0;

  const ctx = {
    activeTest: t,
    updateActiveTest,
    allCmpds,
    allCellLines,
    customFields,
    typeCustomFields,
    conditionCustomFields,
    instrumentalCustomFields,
    testCategories: categories,
    datasetProtocols: safeDatasetProtocols,
    jumpToProtocol,
    selectedCompounds,
    cellLines,
    ...rest
  };

  const notebookChecks =
    config.notebookChecks || [
      { id: 'cond', label: 'Experimental Conditions' },
      ...(config.extraNotebookChecks || [])
    ];

  const isEmptyValue = (v) => v === undefined || v === null || v === '';

  const formatNotebookValue = (v, unit) => {
    if (isEmptyValue(v)) return 'N/A';

    const base =
      typeof v === 'object' ? JSON.stringify(v) : String(v);

    const safeBase = escapeHtml(base);
    const safeUnit = unit ? escapeHtml(unit) : '';

    return safeUnit ? `${safeBase} ${safeUnit}` : safeBase;
  };

  const appendToNotebook = () => {
    const checked = {};

    notebookChecks.forEach((c) => {
      const el = document.getElementById(`nb-${typeKey}-${c.id}`);
      checked[c.id] = el ? el.checked : false;
    });

    let html =
      '<div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px; font-family: sans-serif;">';

    html += `<h4 style="color: #1e40af; margin-top: 0; margin-bottom: 12px; font-size: 14px; border-bottom: 2px solid #bfdbfe; padding-bottom: 4px;">📊 ${escapeHtml(
      config.typeLabel || 'Experiment'
    )} Summary</h4>`;

    const builder = custom.buildNotebookHtml || config.buildNotebookHtml;

    if (builder) {
      html += builder(checked, ctx);
    } else if (checked.cond) {
      const operatorNames = (Array.isArray(t.operators) ? t.operators : [])
        .map((op) =>
          typeof op === 'string'
            ? op
            : `${op?.name || ''} ${op?.surname || ''}`.trim()
        )
        .filter(Boolean)
        .join(', ');

      const category = testCategory || 'N/A';
      const secondary = t.secondaryCategory || '';

      const sample =
        selectedCompounds.length > 0
          ? selectedCompounds.join(', ')
          : compound || '';

      const cells = cellLines.length > 0 ? cellLines.join(', ') : '';

      const conditionPairs = (
        Array.isArray(config.conditionFields) ? config.conditionFields : []
      )
        .filter((f) => f && f.key)
        .map((f) => {
          const v = t[f.key];
          const unit =
            t[`${f.key}Unit`] ||
            (Array.isArray(f.units) && f.units.length > 0 ? f.units[0] : '');

          const label = escapeHtml(f.label || f.key);

          return `<b>${label}:</b> ${formatNotebookValue(v, unit)}`;
        })
        .join(' | ');

      const customPairs = conditionCustomFields
        .map((f) => {
          const key = getFieldKey(f);
          const label = escapeHtml(getFieldLabel(f));
          const v = key ? customFieldValues[key] : undefined;

          return `<b>${label}:</b> ${formatNotebookValue(v)}`;
        })
        .join(' | ');

const details = [
  `<b>Experiment Type:</b> ${escapeHtml(category)}`,
  secondary
    ? `<b>Secondary Classification:</b> ${escapeHtml(secondary)}`
    : '',
  testOperator
    ? `<b>Scientist:</b> ${escapeHtml(testOperator)}`
    : operatorNames
      ? `<b>Scientist:</b> ${escapeHtml(operatorNames)}`
      : '',
  sample ? `<b>Sample:</b> ${escapeHtml(sample)}` : '',
  cells ? `<b>Cell lines:</b> ${escapeHtml(cells)}` : '',
  conditionPairs,
  customPairs
]
  .filter(Boolean)
  .join(' | ');

      html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;">${details}</p>`;
    }

    html += '</div>';

    update({
      comments: comments + (comments ? '<br/>' : '') + html
    });

    alert(
      'Data appended successfully to the notes! They will now be visible in the Lab Notebook.'
    );
  };

  const CustomToolbar = custom.Toolbar || null;
  const CustomAll = custom.All || null;

  const CompoundsSection = config.CompoundsSection || custom.Compounds || null;

  const MolecularStructureSection = custom.MolecularStructure || null;

  const SetupSection =
    config.SetupSection || custom.Setup || custom.ExperimentSetup || null;

  const InstrumentalSetupSection = custom.InstrumentalSetup || null;

  const DataSection = config.DataSection || custom.Data || null;

  const DataAnalysisSection =
    custom.DataAnalysis || custom.Analysis || null;

  const FittingSection = config.FittingSection || custom.Fitting || null;

  const FittingErrors = custom.FittingErrors || null;
  const FittingGraphics = custom.FittingGraphics || null;

  const AnalysisSections = custom.AnalysisSections || null;

  const SimulationsSection =
    config.SimulationsSection || custom.Simulations || null;

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {TestHeader}

      {CustomToolbar && <CustomToolbar ctx={ctx} />}
<div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {!mandatoryBlocked && missingMandatoryRules.length > 0 && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-red-500 text-lg">⚠️</span>
              <h3 className="text-sm font-bold text-red-800 uppercase tracking-wide">
                Missing Mandatory Parameters
              </h3>
            </div>

            <p className="text-xs text-red-700 mt-1">
              Please fill in the following required fields to complete this
              record:{' '}
              <span className="font-bold">
                {missingMandatoryRules
                  .map((r) => `${r.fieldName} (${r.subsectionLabel})`)
                  .join(', ')}
              </span>
            </p>
          </div>
        )}

        {mandatoryBlocked && (
          <div className="max-w-2xl mx-auto mb-6 bg-red-50 border-2 border-red-300 rounded-2xl p-8 text-center shadow-sm">
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-base font-bold text-red-800 uppercase tracking-wide mb-2">
              {config.typeLabel || 'This page'} is locked
            </h2>
            <p className="text-sm text-red-700 mb-4">
              Fill in the required fields below before continuing. Everything
              above is still editable.
            </p>
            <ul className="text-sm text-red-800 font-semibold text-left inline-block">
              {missingMandatoryRules.map((r, i) => (
                <li key={i}>
                  • {r.fieldName}{' '}
                  <span className="text-red-500 font-normal">
                    ({r.subsectionLabel})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

{/* ================= GENERAL ================= */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowGeneral(!showGeneral)}
            className="w-full flex items-center justify-center gap-2 mb-4 border-b-2 border-slate-200 pb-2 cursor-pointer group outline-none bg-transparent"
          >
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest group-hover:text-blue-600 transition-colors m-0">GENERAL</h2>
            <span className="text-slate-400 group-hover:text-blue-600 transition-colors text-sm">{showGeneral ? '▼' : '▶'}</span>
          </button>

          {showGeneral && (
            <div className="flex flex-col gap-0">
              <CollapsibleSection title="Classification" icon="🏷️" defaultOpen={false}>
            <div className="max-w-xl flex flex-col gap-5">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">
                  Primary Classification / Experiment Type / Test Category
                </label>

                <select
                  value={testCategory}
                  onChange={(e) => update({ testCategory: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
                >
                  {sortAlpha(categories).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

                         <div>
             <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">
               Secondary Classification / Sub-category
             </label>
             <select
               value={t.secondaryCategory || ''}
               onChange={(e) => update({ secondaryCategory: e.target.value })}
               className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
               disabled={!testCategory || !CLASSIFICATION_MAP[testCategory]}
             >
               <option value="">— None —</option>
               {(CLASSIFICATION_MAP[testCategory] || []).map((cat) => (
                 <option key={`secondary-${cat}`} value={cat}>
                   {cat}
                 </option>
               ))}
             </select>

                <div className="mt-2 flex items-center gap-3">
                  {t.secondaryCategory ? (
                    <span className="text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-1 rounded">
                      {t.secondaryCategory}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 italic">
                      No secondary classification selected.
                    </span>
                  )}

                  {t.secondaryCategory && (
                    <button
                      type="button"
                      onClick={() => update({ secondaryCategory: '' })}
                      className="text-xs font-bold text-red-500 hover:text-red-700 underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-1">
                  Secondary classification uses the same category list defined in
                  Definitions & Labels.
                </p>
              </div>
            </div>

          </CollapsibleSection>

          {(showCompoundsSection || CompoundsSection) && (
            <CollapsibleSection title="Compounds & Biological Models" icon="🧪" defaultOpen={false}>
              {showCompoundsSection && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {showCompounds && (
                    <MultiSelectDropdown
                      label={compoundLabel}
                      accent="blue"
                      options={sortedCompounds}
                      selected={selectedCompounds}
                      onToggle={toggleCompound}
                      onClear={clearCompounds}
                      placeholder="Select compound(s)..."
                      emptyHint="No compounds defined. Add them in Definitions & Labels."
                    />
                  )}

                  {showCellLines && (
                    <MultiSelectDropdown
                      label={cellLineLabel}
                      accent="emerald"
                      options={sortedCellLines}
                      selected={cellLines}
                      onToggle={toggleCellLine}
                      onClear={() => update({ cellLines: [] })}
                      placeholder="Select cell line(s)..."
                      emptyHint="No cell lines defined. Add them in Definitions & Labels."
                    />
                  )}
                </div>
              )}

              {CompoundsSection && (
                <div
                  className={`pt-6 border-t border-slate-200 ${
                    showCompoundsSection ? 'mt-6' : ''
                  }`}
                >
                  <CompoundsSection ctx={ctx} />
                </div>
 )}
            </CollapsibleSection>
          )}
            </div>
          )}
        </div>

        {/* ================= SETUP ================= */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowSetup(!showSetup)}
            className="w-full flex items-center justify-center gap-2 mb-4 border-b-2 border-slate-200 pb-2 cursor-pointer group outline-none bg-transparent"
          >
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest group-hover:text-blue-600 transition-colors m-0">SETUP</h2>
            <span className="text-slate-400 group-hover:text-blue-600 transition-colors text-sm">{showSetup ? '▼' : '▶'}</span>
          </button>

          {showSetup && (
            <div className="flex flex-col gap-0">
              <CollapsibleSection title="Linked Protocols" icon="📋" defaultOpen={false}>
            <div className="flex flex-col gap-1 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <label className="text-xs font-bold text-indigo-800 uppercase flex items-center justify-between mb-2">
                <span>📋 Linked Protocols</span>
                <span className="text-[9px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded">
                  Multiple protocols allowed
                </span>
              </label>

              {linkedProtocolIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {linkedProtocolIds.map((pid) => {
                    const prot = safeDatasetProtocols.find((p) => p.id === pid);

                    return (
                      <div
                        key={pid}
                        className="flex items-center gap-1 bg-white border border-indigo-300 rounded-lg px-2 py-1 shadow-sm"
                      >
                        <span className="text-xs font-bold text-indigo-900 max-w-[220px] truncate">
                          {prot ? `${prot.title} (${prot.category})` : pid}
                        </span>

                        <button
                          type="button"
                          onClick={() => jumpToProtocol && jumpToProtocol(pid)}
                          className="text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-0.5 rounded transition-colors"
                          title="Open this protocol"
                        >
                          📖 Open
                        </button>

                        <button
                          type="button"
                          onClick={() => removeLinkedProtocol(pid)}
                          className="text-slate-400 hover:text-red-500 font-bold px-1"
                          title="Unlink"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <select
                value=""
                onChange={(e) => addLinkedProtocol(e.target.value)}
                className="border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 w-full cursor-pointer font-semibold text-indigo-900"
              >
                <option value="">-- Add a protocol to link --</option>

                {safeDatasetProtocols
                  .filter((p) => !linkedProtocolIds.includes(p.id))
                  .map((p, idx) => (
                    <option key={p.id ?? `protocol-${idx}`} value={p.id}>
                      {p.title} ({p.category})
                    </option>
                  ))}
              </select>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Agenda" icon="📅" defaultOpen={false}>
            <h3 className="text-[11px] font-bold text-slate-600 mb-2 flex justify-between items-center">
              <span>📅 Schedule / Planning (This Item)</span>

              <div className="flex gap-2">
                <input
                  type="date"
                  id={planDateId}
                  className="border border-slate-300 px-2 py-1 text-xs rounded bg-white text-slate-800 outline-none focus:border-blue-500"
                />

                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(planDateId);
                    const d = el ? el.value : '';

                    if (d) {
                      update({
                        plan: [
                          ...experimentPlan,
                          {
                            id: `plan-${Date.now()}-${Math.random()
                              .toString(36)
                              .slice(2)}`,
                            date: d,
                            task: ''
                          }
                        ].sort((a, b) => a.date.localeCompare(b.date))
                      });
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-bold transition shadow-sm"
                >
                  Add Task
                </button>
              </div>
            </h3>

            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
              {experimentPlan.length === 0 && (
                <span className="text-xs text-slate-400 italic">
                  No tasks planned yet.
                </span>
              )}

              {experimentPlan.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-2 items-start flex-wrap bg-slate-50 border border-slate-200 p-1.5 rounded-lg shadow-sm"
                >
                  <span className="text-[10px] font-bold w-20 text-slate-600 pl-2 mt-1.5">
                    {item.date}
                  </span>

                  <input
                    type="text"
                    value={item.task}
                    onChange={(e) =>
                      update({
                        plan: experimentPlan.map((p) =>
                          p.id === item.id ? { ...p, task: e.target.value } : p
                        )
                      })
                    }
                    className="bg-transparent border-none focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 p-1 text-xs flex-1 text-slate-700 rounded transition-all min-w-[120px]"
                    placeholder="Task description..."
                  />

                  {operators.length > 0 && (
                    <select
                      value={item.assignedTo || ''}
                      onChange={(e) =>
                        update({
                          plan: experimentPlan.map((p) =>
                            p.id === item.id
                              ? { ...p, assignedTo: e.target.value }
                              : p
                          )
                        })
                      }
                      className="border border-slate-200 rounded px-1.5 py-0.5 text-[10px] bg-white text-slate-700 outline-none focus:border-blue-500 shrink-0"
                    >
                      <option value="">Assign to...</option>
                      {operators.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  )}

                  {item.assignedTo && (
                    <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full self-center whitespace-nowrap">
                      {item.assignedTo}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      update({
                        plan: experimentPlan.filter((p) => p.id !== item.id)
                      })
                    }
                    className="text-slate-400 hover:text-red-500 text-[10px] font-bold px-2 transition self-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Experimental Conditions" icon="🌡️" defaultOpen={false}>
            {isMdType && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex flex-wrap items-center gap-3">
                <label className="bg-white hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold py-1.5 px-3 rounded-lg text-xs cursor-pointer shadow-sm transition-colors flex items-center gap-2 shrink-0">
                  📄 Auto-fill from GROMACS / CHARMM file
                  <input
                    type="file"
                    accept=".mdp,.top,.itp,.inp,.str,.conf,.namd,.prm,.par,.psf"
                    onChange={handleMdParamFile}
                    className="hidden"
                  />
                </label>

                <p className="text-[11px] text-emerald-700/80 flex-1 min-w-[220px]">
                  Reads force field, water model, temperature, pressure, timestep
                  &amp; more directly from your simulation input file.
                </p>

                {mdParamFileReport && (
                  <span
                    className={`text-[11px] font-bold ${
                      mdParamFileReport.ok
                        ? 'text-emerald-700'
                        : 'text-amber-600'
                    }`}
                  >
                    {mdParamFileReport.error
                      ? `⚠️ Could not read ${mdParamFileReport.name}`
                      : mdParamFileReport.ok
                        ? `✓ Parsed ${mdParamFileReport.count} field${
                            mdParamFileReport.count === 1 ? '' : 's'
                          } from ${mdParamFileReport.name}`
                        : `⚠️ No recognizable parameters found in ${mdParamFileReport.name}`}
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {(Array.isArray(config.conditionFields)
                ? config.conditionFields
                : []
              ).map(renderConditionField)}

              {conditionCustomFields.length > 0 && (
                <div className="col-span-full text-xs font-bold text-slate-400 uppercase pt-2 border-t border-slate-100">
                  Custom Metadata
                </div>
              )}

              {conditionCustomFields.map(renderCustomMetadataField)}
            </div>

            <BufferAdditiveFields
              t={t}
              update={update}
              buffers={buffersFromDefs}
              additives={additivesFromDefs}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Instrumental Setup" icon="🔬" defaultOpen={false}>
            <div className="flex flex-col gap-4">
              {InstrumentalSetupSection ? (
                <InstrumentalSetupSection ctx={ctx} />
              ) : (
                <p className="text-sm text-slate-400 italic">
                  No instrument-specific setup defined for this page type.
                </p>
              )}

              {instrumentalCustomFields.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-xs font-bold text-slate-400 uppercase mb-2">
                    Instrumental Custom Metadata
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {instrumentalCustomFields.map(renderCustomMetadataField)}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {otherSubsectionCustomFields.map((group) => (
            <CollapsibleSection
              key={group.id}
              title={`Additional Fields — ${group.label}`}
              icon="📎"
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {group.fields.map(renderCustomMetadataField)}
              </div>
            </CollapsibleSection>
          ))}

{!mandatoryBlocked && SetupSection && !CustomAll && (
  <CollapsibleSection title="Experiment Setup" icon="⚙️" defaultOpen={false}>
    <SetupSection ctx={ctx} />
  </CollapsibleSection>
)}

{isMdType && !mandatoryBlocked && !CustomAll && SimulationsSection && (
  <CollapsibleSection title="Experiment setup" icon="⚙️" defaultOpen={false}>
    <SimulationsSection ctx={ctx} />
  </CollapsibleSection>
)}
            </div>
          )}
        </div>

{/* ================= MOLECULAR SYSTEM & SIMULATIONS ================= */}
{(MolecularStructureSection || (!isMdType && !mandatoryBlocked && SimulationsSection)) && (
  <div className="mb-8">
    <button
      type="button"
      onClick={() => setShowMolSys(!showMolSys)}
      className="w-full flex items-center justify-center gap-2 mb-4 border-b-2 border-slate-200 pb-2 cursor-pointer group outline-none bg-transparent"
    >
      <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest group-hover:text-blue-600 transition-colors m-0">
        MOLECULAR SYSTEM AND SIMULATIONS
      </h2>
      <span className="text-slate-400 group-hover:text-blue-600 transition-colors text-sm">
        {showMolSys ? '▼' : '▶'}
      </span>
    </button>

    {showMolSys && (
      <div className="flex flex-col gap-0">
        {MolecularStructureSection && (
          <CollapsibleSection
            title="Molecular structure and visualization"
            icon="🧬"
            defaultOpen={false}
          >
            <MolecularStructureSection ctx={ctx} />
          </CollapsibleSection>
        )}

        {!isMdType && !mandatoryBlocked && SimulationsSection && (
          <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}>
            <SimulationsSection ctx={ctx} />
          </CollapsibleSection>
        )}
      </div>
    )}
  </div>
)}

        {/* ================= DATA AND ANALYSIS ================= */}
        {!mandatoryBlocked && (CustomAll || DataSection || DataAnalysisSection || FittingSection || FittingErrors || FittingGraphics) && (
          <div className="mb-8">
            <button
              type="button"
              onClick={() => setShowData(!showData)}
              className="w-full flex items-center justify-center gap-2 mb-4 border-b-2 border-slate-200 pb-2 cursor-pointer group outline-none bg-transparent"
            >
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest group-hover:text-blue-600 transition-colors m-0">DATA AND ANALYSIS</h2>
              <span className="text-slate-400 group-hover:text-blue-600 transition-colors text-sm">{showData ? '▼' : '▶'}</span>
            </button>
            
            {showData && (
              <div className="flex flex-col gap-0">
                {CustomAll ? (
              <CustomAll ctx={ctx} />
            ) : (
              <>
                {DataSection && (
                  <CollapsibleSection title="Data" icon="🔢" defaultOpen={false}>
                    <DataSection ctx={ctx} />
                  </CollapsibleSection>
                )}

{(DataAnalysisSection || FittingSection || FittingErrors || FittingGraphics) && (
                  <CollapsibleSection title="Data Analysis" icon="📉" defaultOpen={false}>
                    <div className="flex flex-col gap-6">
      {DataAnalysisSection && (
        <CollapsibleSection
          title={isMdType ? 'MD general parameters' : 'Per Atom Plot'}
          icon={isMdType ? '⚙️' : '📊'}
          defaultOpen={false}
        >
          <DataAnalysisSection ctx={ctx} />
        </CollapsibleSection>
      )}

                      {Array.isArray(AnalysisSections) && AnalysisSections.map((s) => (
                        <CollapsibleSection key={s.title} title={s.title} icon={s.icon} defaultOpen={!!s.defaultOpen}>
                          <s.Component ctx={ctx} />
                        </CollapsibleSection>
                      ))}

                      {FittingSection ? (
                        <FittingSection ctx={ctx} />
                      ) : (
                        (FittingErrors || FittingGraphics) && (
                          <CollapsibleSection title="Fitting" icon="📐" defaultOpen={false}>
                            <div className="flex flex-col gap-6">
                              {FittingErrors && (
                                <CollapsibleSection title="Error Management" icon="⚠️" defaultOpen={false}>
                                  <FittingErrors ctx={ctx} />
                                </CollapsibleSection>
                              )}
                              {FittingGraphics && (
                                <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
                                  <FittingGraphics ctx={ctx} />
                                </CollapsibleSection>
                              )}
                            </div>
                          </CollapsibleSection>
                        )
                      )}
                    </div>
                  </CollapsibleSection>
                )}
</>
            )}
              </div>
            )}
          </div>
        )}

        {/* ================= REPORT ================= */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowReport(!showReport)}
            className="w-full flex items-center justify-center gap-2 mb-4 border-b-2 border-slate-200 pb-2 cursor-pointer group outline-none bg-transparent"
          >
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest group-hover:text-blue-600 transition-colors m-0">REPORT</h2>
            <span className="text-slate-400 group-hover:text-blue-600 transition-colors text-sm">{showReport ? '▼' : '▶'}</span>
          </button>
          
          {showReport && (
            <div className="flex flex-col gap-0">
              <CollapsibleSection title="Report" icon="📝" defaultOpen={false}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 flex flex-col h-full min-h-[160px]">
<div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-2 gap-2">
                    <label className="text-xs font-bold text-slate-600 whitespace-nowrap">
                      Comments & Notes
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => addImageLink('')}
                        className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-bold px-2 py-1 rounded transition-colors shadow-sm text-[10px]"
                      >
                        + Add Figure
                      </button>

                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 shadow-sm">
                        <label className="text-[10px] font-bold text-slate-500">Rows:</label>
                        <input type="number" min="1" value={tableRows} onChange={(e) => setTableRows(parseInt(e.target.value) || 1)} className="w-10 text-[10px] border border-slate-300 rounded px-1 outline-none" />
                        <label className="text-[10px] font-bold text-slate-500 ml-1">Cols:</label>
                        <input type="number" min="1" value={tableCols} onChange={(e) => setTableCols(parseInt(e.target.value) || 1)} className="w-10 text-[10px] border border-slate-300 rounded px-1 outline-none" />
                        
                        <button
                          type="button"
                          onClick={() => {
                            let tableHtml = '<br/><table style="width:100%; border-collapse: collapse;" border="1"><tbody><tr>';
                            for (let c = 0; c < tableCols; c++) {
                                tableHtml += `<th style="padding:4px; background-color:#f1f5f9; border: 1px solid #cbd5e1;">Header ${c + 1}</th>`;
                            }
                            tableHtml += '</tr>';
                            for (let r = 0; r < tableRows; r++) {
                                tableHtml += '<tr>';
                                for (let c = 0; c < tableCols; c++) {
                                    tableHtml += `<td style="padding:4px; border: 1px solid #cbd5e1;">Data</td>`;
                                }
                                tableHtml += '</tr>';
                            }
                            tableHtml += '</tbody></table><br/>';
                            update({ comments: (comments || '') + tableHtml });
                          }}
                          className="ml-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 font-bold px-2 py-0.5 rounded transition-colors text-[10px]"
                        >
                          + Std Table
                        </button>

<button
                          type="button"
                          onClick={() => {
                            const seq = (t.proteinSequence || '').toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
                            const shifts = t.chemicalShifts || {};
                            const commonAtoms = ['HN', 'N', 'Cα', 'Hα', 'Cβ', 'Hβ', "C'"];
                            let rowsHtml = '';
                            
                            if (seq.length > 0) {
                              seq.split('').forEach((char, idx) => {
                                const resId = `${idx + 1}${char}`;
                                let hasData = false;
                                let rowCells = '';
                                
                                commonAtoms.forEach(ca => {
                                  const val = shifts[`${idx}-${ca}`] || '';
                                  if (val) hasData = true;
                                  rowCells += `<td style="padding: 4px 8px; text-align: center;">${val || '-'}</td>`;
                                });

                                const others = [];
                                Object.keys(shifts).forEach(k => {
                                  if (k.startsWith(`${idx}-`)) {
                                    const atomName = k.slice(String(idx).length + 1);
                                    if (!commonAtoms.includes(atomName)) {
                                      others.push(`${atomName}: ${shifts[k]}`);
                                      hasData = true;
                                    }
                                  }
                                });

                                if (hasData) {
                                  rowsHtml += `<tr><td style="padding: 4px 8px; text-align: left;">${resId}</td>${rowCells}<td style="padding: 4px 8px; text-align: center;">${others.length > 0 ? others.sort().join(', ') : '-'}</td></tr>`;
                                }
                              });
                            }

                            let headerCells = '';
                            commonAtoms.forEach(ca => {
                              headerCells += `<th style="border-top: 2px solid black; border-bottom: 1px solid black; padding: 6px 8px; text-align: center; font-weight: bold;">${ca}</th>`;
                            });

                            const tableHtml = rowsHtml ? 
                              `<br/><table style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: black; border-top: 2px solid black; border-bottom: 2px solid black;"><thead><tr><th style="border-top: 2px solid black; border-bottom: 1px solid black; padding: 6px 8px; text-align: left; font-weight: bold;">Residue</th>${headerCells}<th style="border-top: 2px solid black; border-bottom: 1px solid black; padding: 6px 8px; text-align: center; font-weight: bold;">Others</th></tr></thead><tbody>${rowsHtml}</tbody></table><br/>` :
                              `<br/><table style="width: 100%; border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: black; border-top: 2px solid black; border-bottom: 2px solid black;"><thead><tr><th style="border-top: 2px solid black; border-bottom: 1px solid black; padding: 6px 8px; text-align: left; font-weight: bold;">Residue</th>${headerCells}<th style="border-top: 2px solid black; border-bottom: 1px solid black; padding: 6px 8px; text-align: center; font-weight: bold;">Others</th></tr></thead><tbody><tr><td style="padding: 4px 8px; text-align: left;">1A</td><td style="padding: 4px 8px; text-align: center;">8.25</td><td style="padding: 4px 8px; text-align: center;">120.4</td><td style="padding: 4px 8px; text-align: center;">52.1</td><td style="padding: 4px 8px; text-align: center;">4.35</td><td style="padding: 4px 8px; text-align: center;">-</td><td style="padding: 4px 8px; text-align: center;">-</td><td style="padding: 4px 8px; text-align: center;">-</td><td style="padding: 4px 8px; text-align: center;">-</td></tr></tbody></table><br/>`;

                            update({ comments: (comments || '') + tableHtml });
                          }}
                          className="bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 font-bold px-2 py-0.5 rounded transition-colors text-[10px]"
                        >
                          + Pub Table
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const newDoc = {
                            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                            name: 'New Document Link',
                            type: 'link',
                            data: ''
                          };
                          update({ documents: [...documents, newDoc] });
                        }}
                        className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 font-bold px-2 py-1 rounded transition-colors shadow-sm text-[10px]"
                      >
                        + Add Document
                      </button>
                    </div>
                  </div>

                  <RichTextEditor
                    value={comments}
                    onChange={(val) => update({ comments: val })}
                    placeholder="Enter your experiment notes, observations, etc..."
                  />
                </div>

<div className="flex-shrink-0 flex flex-col justify-start gap-4" style={{ maxWidth: '300px', minWidth: '180px' }}>
                  <div className="w-full flex flex-col items-end border-t lg:border-t-0 border-slate-200 pt-3 lg:pt-0">
                    <div className="flex flex-col gap-2 w-full max-h-[250px] overflow-y-auto custom-scrollbar">
                      {documents.length === 0 && (
                        <span className="text-[10px] text-slate-400 italic text-right w-full">
                          No documents attached.
                        </span>
                      )}

                      {documents.map((doc, idx) => {
                        const docKey = doc.id ?? idx;
                        return (
                          <div key={docKey} className="flex flex-col gap-1.5 bg-slate-50 border border-slate-200 p-2 rounded-lg shadow-sm">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-500">🔗 Document {idx + 1}</span>
                              <button
                                type="button"
                                onClick={() => update({ documents: documents.filter((d, i) => (d.id ?? i) !== docKey) })}
                                className="text-slate-400 hover:text-red-500 font-bold px-1 text-[10px]"
                              >
                                ×
                              </button>
                            </div>
                            <input
                              type="text"
                              value={doc.name || ''}
                              onChange={(e) => update({
                                documents: documents.map((d, i) => (d.id ?? i) === docKey ? { ...d, name: e.target.value } : d)
                              })}
                              placeholder="Document Name"
                              className="w-full border border-slate-300 rounded p-1 text-[10px] outline-none focus:border-blue-500"
                            />
                            <input
                              type="text"
                              value={doc.data || ''}
                              onChange={(e) => update({
                                documents: documents.map((d, i) => (d.id ?? i) === docKey ? { ...d, data: e.target.value } : d)
                              })}
                              placeholder="https://..."
                              className="w-full border border-slate-300 rounded p-1 text-[10px] outline-none focus:border-blue-500"
                            />
                            {doc.data && doc.data.trim() !== '' && (
                              <a href={doc.data} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:text-blue-700 underline truncate block mt-0.5">
                                Open link ↗
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {images.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="mb-4">
                    <h4 className="text-sm font-bold text-slate-700">Figures</h4>
                    <p className="text-xs text-slate-500">Attached image links.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {images.map((imgSrc, idx) => (
                      <div
                        key={idx}
                        className="relative group bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500">
                            Figure {idx + 1}
                          </span>

                          <button
                            type="button"
                            onClick={() => removeImageAt(idx)}
                            className="bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors border border-red-200"
                          >
                            ×
                          </button>
                        </div>

                        <input
                          type="text"
                          value={imgSrc}
                          onChange={(e) => {
                            const newImages = [...images];
                            newImages[idx] = e.target.value;
                            update({ [imagesKey]: newImages });
                          }}
                          placeholder="Paste image URL here (Google Drive, Dropbox, etc.)"
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500"
                        />

                        {imgSrc && imgSrc.trim() !== '' && (
                          <div
                            className="bg-white rounded-lg p-2 border border-slate-200 cursor-pointer mt-1"
                            onClick={() =>
                              setZoomImage(normalizeImageCandidates(imgSrc)[0] || imgSrc)
                            }
                            title="Click to zoom"
                          >
                            <SmartImage src={imgSrc} alt={`Figure ${idx + 1}`} />
                          </div>
                        )}

                        <textarea
                          value={captionsAligned[idx] ?? ''}
                          onChange={(e) => updateFigureCaption(idx, e.target.value)}
                          placeholder={`Figure ${idx + 1} caption...`}
                          rows={2}
                          className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 resize-y"
                        />

                        {imgSrc && imgSrc.trim() !== '' && (
                          <a
                            href={imgSrc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1"
                          >
                            🔗 Open original link
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {!mandatoryBlocked && !config.hideNotebook && notebookChecks.length > 0 && (
            <CollapsibleSection
              title="Lab Notebook Export"
              icon="📓"
              defaultOpen={false}
              className="no-print mt-6"
            >
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-600">
                  Select the data to format and append to the General Comments
                  (Lab Notebook entry).
                </p>

                <div className="flex flex-wrap gap-4 border border-slate-200 p-4 rounded-lg bg-white shadow-sm">
                  {notebookChecks.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"
                    >
                      <input
                        type="checkbox"
                        id={`nb-${typeKey}-${c.id}`}
                        defaultChecked
                        className="w-4 h-4 accent-blue-600 cursor-pointer"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>

  <button
                  type="button"
                  onClick={appendToNotebook}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg transition-all shadow-sm w-fit border border-indigo-700 flex items-center gap-2"
                >
                  <span>+</span> Append Data to Lab Notebook
                </button>
              </div>
            </CollapsibleSection>
          )}
            </div>
          )}
        </div>
      </div>

      {zoomImage && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm"
          onClick={() => setZoomImage(null)}
        >
          <div
            className="relative"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
          >
            <img
              src={zoomImage}
              alt="Zoomed"
              className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
            />

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setZoomImage(null);
              }}
              className="absolute -top-4 -right-4 bg-white text-slate-800 rounded-full w-8 h-8 flex items-center justify-center text-xl font-black shadow-lg hover:bg-slate-100"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default TestShellRenderer;