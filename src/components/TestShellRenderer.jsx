import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RichTextEditor } from './RichTextEditor';
import { BufferAdditiveFields } from './DefinitionsExtra';

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
  return Array.from(new Set(arr.filter(Boolean)));
};

const alignCaptions = (images, captions) => {
  if (!Array.isArray(images)) return [];
  return images.map((_, i) =>
    Array.isArray(captions) && captions[i] != null ? captions[i] : ''
  );
};

/* ============================================================================
COLLAPSIBLE SECTION
========================================================================== */

export const CollapsibleSection = ({
  title,
  icon,
  defaultOpen = true,
  children,
  headerExtra,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left cursor-pointer ${
          isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate select-none">{title}</h3>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && (
            <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>
          )}

          <svg
            className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

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
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const optionsSafe = Array.isArray(options) ? options : [];
  const selectedSafe = Array.isArray(selected) ? selected : [];

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
        onClick={() => setOpen((v) => !v)}
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
          className={`absolute top-full left-3 right-3 mt-1 z-50 bg-white border rounded-lg shadow-xl max-h-56 overflow-y-auto custom-scrollbar ${menuCls}`}
        >
          {optionsSafe.length === 0 ? (
            <div className="p-3 text-sm text-slate-400 italic">{emptyHint}</div>
          ) : (
            optionsSafe.map((opt) => (
              <label
                key={opt}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-slate-100 last:border-b-0 ${optionHoverCls}`}
              >
                <input
                  type="checkbox"
                  checked={selectedSafe.includes(opt)}
                  onChange={() => onToggle(opt)}
                  className={`w-4 h-4 ${checkboxCls}`}
                />
                <span
                  className={`text-sm ${
                    selectedSafe.includes(opt)
                      ? optionSelectedCls
                      : 'text-slate-700'
                  }`}
                >
                  {opt}
                </span>
              </label>
            ))
          )}
        </div>
      )}

      {selectedSafe.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedSafe.map((s) => (
            <span
              key={s}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border ${chipCls}`}
            >
              {s}
              <button
                type="button"
                onClick={() => onToggle(s)}
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
  const u = (url || '').trim();

  let m = u.match(/drive.google.com\/file\/d\/([^/?]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }

  m = u.match(/drive.google.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }

  if (u.includes('dropbox.com')) {
    return [
      u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1'),
      u
    ];
  }

  return [u];
};

/* ============================================================================
SMART IMAGE
========================================================================== */

export const SmartImage = ({ src, alt, style }) => {
  const cands = React.useMemo(() => normalizeImageCandidates(src), [src]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        className="w-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded text-slate-400 text-xs text-center px-4 py-6"
        style={style || { minHeight: '150px', maxHeight: '400px' }}
      >
        ⚠️ Preview not available. If the file is private, set it to “Anyone
        with the link can view”.
      </div>
    );
  }

  return (
    <img
      src={cands[Math.min(idx, cands.length - 1)]}
      alt={alt}
      className="w-full h-auto object-contain rounded bg-white"
      style={style || { minHeight: '150px', maxHeight: '400px' }}
      onError={() => {
        if (idx < cands.length - 1) setIdx(idx + 1);
        else setFailed(true);
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
  testCategories,
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
  const comments = t.comments || '';
  const images = t[imagesKey] || [];
  const documents = t.documents || [];
  const linkedProtocolId = t.linkedProtocolId || '';
  const cellLines = t.cellLines || [];
  const customFieldValues = t.customFieldValues || {};
  const experimentPlan = t.plan || [];

  const [zoomImage, setZoomImage] = useState(null);

  const definitionCategories = Array.isArray(testCategories)
    ? testCategories.filter(Boolean)
    : [];

  const fallbackCategories =
    config.fallbackCategories || config.categories || ['Activity'];

  const baseCategories =
    definitionCategories.length > 0 ? definitionCategories : fallbackCategories;

  const testCategory = t.testCategory || baseCategories[0] || 'Activity';

  const categories = [
    ...new Set([...baseCategories, testCategory].filter(Boolean))
  ];

  /* ===== OPERATORS ===== */

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

  /* ===== DEFINITIONS ===== */

  const buffersFromDefs = Array.isArray(rest.buffers) ? rest.buffers : [];
  const additivesFromDefs = Array.isArray(rest.additives)
    ? rest.additives
    : [];
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
    if (Array.isArray(t.selectedCompounds))
      return t.selectedCompounds.filter(Boolean);

    if (Array.isArray(t.compoundsSelected))
      return t.compoundsSelected.filter(Boolean);

    if (typeKey !== 'plate' && Array.isArray(t.compounds))
      return t.compounds.filter(Boolean);

    if (compound)
      return String(compound)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return [];
  })();

  const linkedProtocolIds =
    t.linkedProtocolIds || (linkedProtocolId ? [linkedProtocolId] : []);

  const addLinkedProtocol = (id) => {
    if (!id || linkedProtocolIds.includes(id)) return;

    const upd = [...linkedProtocolIds, id];
    update({ linkedProtocolIds: upd, linkedProtocolId: upd[0] });
  };

  const removeLinkedProtocol = (id) => {
    const upd = linkedProtocolIds.filter((p) => p !== id);
    update({ linkedProtocolIds: upd, linkedProtocolId: upd[0] || '' });
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

    if (typeKey !== 'plate') payload.compounds = upd;

    update(payload);
  };

  const clearCompounds = () => {
    const payload = {
      selectedCompounds: [],
      compoundsSelected: [],
      compound: ''
    };

    if (typeKey !== 'plate') payload.compounds = [];

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
      customFieldValues: { ...customFieldValues, [fieldName]: value }
    });
  };

  /* ===== FIGURE CAPTIONS ===== */

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
      figureCaptions: [
        ...captionsAligned,
        `Figure ${images.length + 1}: `
      ]
    });
  };

  const removeImageAt = (idx) => {
    update({
      [imagesKey]: images.filter((_, i) => i !== idx),
      figureCaptions: captionsAligned.filter((_, i) => i !== idx)
    });
  };

  /* ===== ESCAPE KEY ===== */

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setZoomImage(null);
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  /* ===== CUSTOM FIELD TAB MATCHING ===== */

  const normalizeScopeValue = (value) => String(value || '').toLowerCase();

  const currentTabKey = normalizeScopeValue(config.typeKey || t.type || 'test');
  const currentTestType = normalizeScopeValue(t.type || currentTabKey);

  const customFieldMatchesTab = (field) => {
    if (!field) return false;

    const scopes = [];

    const addScopes = (value) => {
      if (!value) return;

      if (Array.isArray(value)) value.forEach(addScopes);
      else scopes.push(normalizeScopeValue(value));
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

      if (scope === 'plate')
        return currentTabKey === 'plate' || currentTestType.startsWith('plate');

      return false;
    });
  };

  const typeCustomFields = (customFields || []).filter(customFieldMatchesTab);

  const getFieldPlacement = (field) =>
    String(
      field?.placement || field?.section || field?.location || 'conditions'
    ).toLowerCase();

  const conditionCustomFields = typeCustomFields.filter(
    (f) => getFieldPlacement(f) !== 'instrumental'
  );

  const instrumentalCustomFields = typeCustomFields.filter(
    (f) => getFieldPlacement(f) === 'instrumental'
  );

  /* ===== CONDITION FIELDS ===== */

  const renderConditionField = (f) => {
    const val =
      t[f.key] !== undefined && t[f.key] !== null ? t[f.key] : '';

    const unitVal =
      t[`${f.key}Unit`] !== undefined && t[`${f.key}Unit`] !== null
        ? t[`${f.key}Unit`]
        : f.units?.[0] || '';

    const cls =
      'w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500';

    const inputCls = f.units
      ? 'flex-1 border border-slate-300 rounded-l-lg p-2 text-sm outline-none focus:border-blue-500 min-w-0'
      : cls;

const isSolventMedia =
      f.type === 'solvent-select' ||
      ['solvent', 'medium', 'media'].includes(f.key);

    if (isSolventMedia) {
      const options = sortAlpha(
        uniqueOptions([...solventsFromDefs.map(s => typeof s === 'string' ? s : (s?.name || '')), val])
      );

      return (
        <div key={f.key}>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            {f.label}
          </label>

          <div className="flex gap-1">
            <select
              value={options.includes(val) ? val : ''}
              onChange={(e) =>
                e.target.value && update({ [f.key]: e.target.value })
              }
              className="border border-slate-300 rounded-l-lg p-2 text-sm bg-white outline-none focus:border-blue-500 flex-1"
            >
              <option value="">— Select —</option>
              {options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className="border border-slate-300 rounded-r-lg p-2 text-sm outline-none focus:border-blue-500 flex-1"
              placeholder="or type..."
            />
          </div>
        </div>
      );
    }

    const isOtherMolecule =
      f.type === 'compound-select' || f.key === 'otherMolecule';

    if (isOtherMolecule) {
      const options = sortAlpha(
        uniqueOptions([...sortedCompounds, val])
      );

      return (
        <div key={f.key}>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            {f.label}
          </label>

          <div className="flex gap-1">
            <select
              value={options.includes(val) ? val : ''}
              onChange={(e) =>
                e.target.value && update({ [f.key]: e.target.value })
              }
              className="border border-slate-300 rounded-l-lg p-2 text-sm bg-white outline-none focus:border-blue-500 flex-1"
            >
              <option value="">— Select compound —</option>
              {options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={val}
              onChange={(e) => update({ [f.key]: e.target.value })}
              className="border border-slate-300 rounded-r-lg p-2 text-sm outline-none focus:border-blue-500 flex-1"
              placeholder="or type..."
            />
          </div>
        </div>
      );
    }

    return (
      <div key={f.key}>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
          {f.label}
        </label>

        <div className={f.units ? 'flex' : ''}>
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

          {f.units && (
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

  /* ===== CUSTOM METADATA FIELD RENDER ===== */

  const renderCustomMetadataField = (field) => {
    const val =
      customFieldValues[field.name] !== undefined &&
      customFieldValues[field.name] !== null
        ? customFieldValues[field.name]
        : '';

    const cls =
      'w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500';

    return (
      <div key={field.id || field.name}>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
          {field.name}
        </label>

        {field.type === 'date' ? (
          <input
            type="date"
            value={val}
            onChange={(e) => handleCustomFieldChange(field.name, e.target.value)}
            className={cls}
          />
        ) : field.type === 'number' ? (
          <input
            type="number"
            value={val}
            onChange={(e) => handleCustomFieldChange(field.name, e.target.value)}
            className={cls}
            placeholder="Enter value..."
          />
        ) : field.type === 'select' ? (
          <select
            value={val}
            onChange={(e) => handleCustomFieldChange(field.name, e.target.value)}
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
            onChange={(e) => handleCustomFieldChange(field.name, e.target.value)}
            className={cls}
            placeholder="Enter value..."
            rows={3}
          />
        ) : (
          <input
            type="text"
            value={val}
            onChange={(e) => handleCustomFieldChange(field.name, e.target.value)}
            className={cls}
            placeholder="Enter value..."
          />
        )}
      </div>
    );
  };

  /* ===== MISSING MANDATORY FIELDS LOGIC ===== */
  const mandatoryFields = Array.isArray(rest.mandatoryFields) ? rest.mandatoryFields : [];
  const missingFields = useMemo(() => {
    if (!mandatoryFields.length) return [];
    
    // Costruiamo un dizionario di tutti i dati correnti per un rapido controllo
    const currentData = {
      'operator': testOperator,
      'experiment type': testCategory,
      'secondary classification': t.secondaryCategory,
      'compound': selectedCompounds.length ? selectedCompounds : (compound ? [compound] : []),
      'compounds': selectedCompounds.length ? selectedCompounds : (compound ? [compound] : []),
      'cell line': cellLines.length ? cellLines : [],
      'cell lines': cellLines.length ? cellLines : [],
      'date': t.date,
      'experiment date': t.date,
      'instance': t.instanceName,
      ...((config.conditionFields || []).reduce((acc, f) => { 
          acc[f.label.toLowerCase()] = t[f.key]; 
          acc[f.key.toLowerCase()] = t[f.key]; // Fallback by key
          return acc; 
      }, {})),
      ...(Object.keys(t.customFieldValues || {}).reduce((acc, k) => { 
          acc[k.toLowerCase()] = t.customFieldValues[k]; 
          return acc; 
      }, {}))
    };

    return mandatoryFields.filter(req => {
       const key = req.toLowerCase().trim();
       const val = currentData[key];
       
       if (val === 0) return false; // valid number
       if (val === false) return false; // valid boolean
       if (val === undefined || val === null) return true; // missing
       if (typeof val === 'string' && val.trim() === '') return true; // empty string
       if (Array.isArray(val) && val.length === 0) return true; // empty array
       
       return false;
    });
  }, [mandatoryFields, t, config.conditionFields, selectedCompounds, compound, cellLines, testCategory, testOperator]);

  /* ===== CONTEXT ===== */
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
    datasetProtocols,
    jumpToProtocol,
    selectedCompounds,
    cellLines,
    ...rest
  };

  /* ===== NOTEBOOK EXPORT ===== */
  const notebookChecks =
    config.notebookChecks || [
      { id: 'cond', label: 'Experimental Conditions' },
      ...(config.extraNotebookChecks || [])
    ];

  const appendToNotebook = () => {
    const checked = {};
    notebookChecks.forEach((c) => {
      const el = document.getElementById(`nb-${typeKey}-${c.id}`);
      checked[c.id] = el ? el.checked : false;
    });

    let html =
      '<div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px; font-family: sans-serif;">';

    html += `<h4 style="color: #1e40af; margin-top: 0; margin-bottom: 12px; font-size: 14px; border-bottom: 2px solid #bfdbfe; padding-bottom: 4px;">📊 ${
      config.typeLabel || 'Experiment'
    } Summary</h4>`;

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
          : compound || 'N/A';
      const cells =
        cellLines.length > 0 ? cellLines.join(', ') : 'N/A';

      const conditionPairs = (config.conditionFields || [])
        .map((f) => {
          const v = t[f.key];
          const unit = t[`${f.key}Unit`] || f.units?.[0] || '';
          const displayVal = v ? `${v}${unit ? ' ' + unit : ''}` : 'N/A';
          return `<b>${f.label}:</b> ${displayVal}`;
        })
        .join(' | ');

      const customPairs = conditionCustomFields
        .map(
          (f) =>
            `<b>${f.name}:</b> ${customFieldValues[f.name] || 'N/A'}`
        )
        .join(' | ');

      const details = [
        `<b>Experiment Type:</b> ${category}`,
        secondary ? `<b>Secondary Classification:</b> ${secondary}` : '',
        testOperator ? `<b>Operator:</b> ${testOperator}` : '',
        sample && sample !== 'N/A' ? `<b>Sample:</b> ${sample}` : '',
        cells && cells !== 'N/A' ? `<b>Cell lines:</b> ${cells}` : '',
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

  /* ===== CUSTOM SECTIONS ===== */
  const CustomToolbar = custom.Toolbar || null;
  const CustomAll = custom.All || null;
  const CompoundsSection = config.CompoundsSection || custom.Compounds || null;
  const SetupSection = config.SetupSection || custom.Setup || null;
  const InstrumentalSetupSection = custom.InstrumentalSetup || null;
  const DataSection = config.DataSection || custom.Data || null;
  const FittingSection = config.FittingSection || custom.Fitting || null;
  const FittingErrors = custom.FittingErrors || null;
  const FittingGraphics = custom.FittingGraphics || null;
  const SimulationsSection = config.SimulationsSection || custom.Simulations || null;

  /* ===== RENDER ===== */
  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {TestHeader}

      {CustomToolbar && <CustomToolbar ctx={ctx} />}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        
        {/* ===== MANDATORY WARNING BANNER ===== */}
        {missingFields.length > 0 && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-red-500 text-lg">⚠️</span>
              <h3 className="text-sm font-bold text-red-800 uppercase tracking-wide">Missing Mandatory Parameters</h3>
            </div>
            <p className="text-xs text-red-700 mt-1">
              Please fill in the following required fields to complete this record: 
              <span className="font-bold"> {missingFields.join(', ')}</span>
            </p>
          </div>
        )}

        {/* ===== CLASSIFICATION ===== */}
        <CollapsibleSection title="Classification" icon="🏷️">
          <div className="max-w-xl flex flex-col gap-5">
            {/* PRIMARY CLASSIFICATION */}
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

            {/* SECONDARY CLASSIFICATION */}
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">
                Secondary Classification / Sub-category
              </label>
              <select
                value={t.secondaryCategory || ''}
                onChange={(e) => update({ secondaryCategory: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
              >
                <option value="">— None —</option>
                {sortAlpha(categories).map((cat) => (
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

            {/* OPERATORS */}
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">
                Operator / Scientist who performed the experiment
              </label>

              {operators.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No operators defined. Add them in Definitions & Labels →
                  Scientists / Operators.
                </p>
              ) : (
                <select
                  value={testOperator}
                  onChange={(e) => update({ operator: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="">— Select Operator —</option>
                  {operators.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              )}

              {testOperator && (
                <button
                  type="button"
                  onClick={() => update({ operator: '' })}
                  className="mt-2 text-xs font-bold text-red-500 hover:text-red-700 underline"
                >
                  Clear operator
                </button>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== COMPOUNDS & BIOLOGICAL MODELS ===== */}
        {(showCompoundsSection || CompoundsSection) && (
          <CollapsibleSection
            title="Compounds & Biological Models"
            icon="🧪"
          >
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

        {/* ===== EXPERIMENTAL CONDITIONS ===== */}
        <CollapsibleSection title="Experimental Conditions" icon="🌡️">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(config.conditionFields || []).map(renderConditionField)}

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

        {/* ===== INSTRUMENTAL SETUP ===== */}
        <CollapsibleSection
          title="Instrumental Setup"
          icon="🔬"
          defaultOpen={false}
        >
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

        {/* ===== LINKED PROTOCOLS ===== */}
        <CollapsibleSection title="Linked Protocols" icon="📋">
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
                  const prot = (datasetProtocols || []).find(
                    (p) => p.id === pid
                  );

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

              {(datasetProtocols || [])
                .filter((p) => !linkedProtocolIds.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.category})
                  </option>
                ))}
            </select>
          </div>
        </CollapsibleSection>

        {/* ===== AGENDA ===== */}
        <CollapsibleSection title="Agenda" icon="📅" defaultOpen={false}>
          <h3 className="text-[11px] font-bold text-slate-600 mb-2 flex justify-between items-center">
            <span>📅 Schedule / Planning (This Item)</span>

            <div className="flex gap-2">
              <input
                type="date"
                id={`plan-date-${t.id}`}
                className="border border-slate-300 px-2 py-1 text-xs rounded bg-white text-slate-800 outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(`plan-date-${t.id}`);
                  const d = el ? el.value : '';

                  if (d) {
                    update({
                      plan: [
                        ...experimentPlan,
                        { id: Date.now(), date: d, task: '' }
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
                        p.id === item.id
                          ? { ...p, task: e.target.value }
                          : p
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

        {/* ===== REPORT ===== */}
        <CollapsibleSection title="Report" icon="📝">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 flex flex-col h-full min-h-[160px]">
              <label className="text-xs font-bold text-slate-600 mb-2">
                Comments & Notes
              </label>

              <RichTextEditor
                value={comments}
                onChange={(val) => update({ comments: val })}
                placeholder="Enter your experiment notes, observations, etc..."
              />
            </div>

            <div
              className="flex-shrink-0 flex flex-col justify-start gap-4"
              style={{ maxWidth: '300px', minWidth: '180px' }}
            >
              <div className="w-full flex flex-col items-end border-t border-slate-200 pt-3">
                <label className="text-xs font-bold text-slate-600 mb-2 w-full text-right">
                  🔗 Document Links
                </label>

                <div className="flex flex-col gap-1 w-full mb-3 max-h-[140px] overflow-y-auto custom-scrollbar">
                  {documents.length === 0 && (
                    <span className="text-[10px] text-slate-400 italic text-right w-full">
                      No documents attached.
                    </span>
                  )}

                  {documents.map((doc, idx) => (
                    <div
                      key={doc.id || idx}
                      className="flex items-center justify-between bg-slate-50 border border-slate-200 p-1.5 rounded-lg shadow-sm group"
                    >
                      <div
                        className="flex items-center gap-2 truncate flex-1 cursor-pointer"
                        onClick={() => {
                          const nn = prompt('Rename document:', doc.name);

                          if (nn) {
                            update({
                              documents: documents.map((d) =>
                                (d.id || idx) === (doc.id || idx)
                                  ? { ...d, name: nn.trim() }
                                  : d
                              )
                            });
                          }
                        }}
                      >
                        <span className="text-sm">🔗</span>
                        <span className="text-[10px] font-bold text-slate-700 truncate group-hover:text-blue-600">
                          {doc.name}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          update({
                            documents: documents.filter(
                              (d, i) => (d.id || i) !== (doc.id || idx)
                            )
                          })
                        }
                        className="text-slate-400 hover:text-red-500 font-bold px-1 opacity-0 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="cursor-pointer text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors w-full text-center"
                  onClick={() => {
                    const urlsText = prompt(
                      'Paste external link(s) separated by commas (Drive, PDF, Image URL):'
                    );

                    if (urlsText && urlsText.trim()) {
                      const urls = urlsText
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);

                      const newDocs = urls.map((url, i) => {
                        let name = url;

                        try {
                          name = new URL(url).hostname;
                        } catch (e) {}

                        return {
                          id: Date.now().toString() + i + Math.random(),
                          name,
                          type: 'link',
                          data: url
                        };
                      });

                      update({ documents: [...documents, ...newDocs] });
                    }
                  }}
                >
                  + Add Document Link(s)
                </button>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== FIGURES ===== */}
        <CollapsibleSection title="Figures" icon="🖼️">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <p className="text-sm text-slate-500">
              Attach image links (Google Drive/Dropbox supported). Each figure
              gets an editable caption.
            </p>

            <button
              type="button"
              onClick={() => {
                const url = prompt(
                  'Paste image link (Google Drive, Dropbox, or direct URL):'
                );

                if (url && url.trim()) addImageLink(url.trim());
              }}
              className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-bold px-3 py-1.5 rounded transition-colors shadow-sm text-xs"
            >
              + Add Link
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {images.length === 0 ? (
              <div className="col-span-full text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
                No images attached.
              </div>
            ) : (
              images.map((imgSrc, idx) => (
                <div
                  key={idx}
                  className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
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

                  <div
                    className="bg-slate-50 rounded-lg p-2 border border-slate-100 cursor-pointer"
                    onClick={() =>
                      setZoomImage(normalizeImageCandidates(imgSrc)[0])
                    }
                    title="Click to zoom"
                  >
                    <SmartImage src={imgSrc} alt={`Figure ${idx + 1}`} />
                  </div>

                  <textarea
                    value={captionsAligned[idx] ?? ''}
                    onChange={(e) => updateFigureCaption(idx, e.target.value)}
                    placeholder={`Figure ${idx + 1} caption...`}
                    rows={2}
                    className="mt-2 w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 resize-y"
                  />

                  <a
                    href={imgSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    🔗 Open original link
                  </a>
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>

        {/* ===== TYPE-SPECIFIC CONTENT ===== */}
        {CustomAll ? (
          <CustomAll ctx={ctx} />
        ) : (
          <>
            {SetupSection && <SetupSection ctx={ctx} />}
            {DataSection && <DataSection ctx={ctx} />}
            {FittingSection ? (
              <FittingSection ctx={ctx} />
            ) : (
              (FittingErrors || FittingGraphics) && (
                <CollapsibleSection title="Data Analysis" icon="📐">
                  <div className="flex flex-col gap-6">
                    {FittingErrors && (
                      <CollapsibleSection
                        title="Error Management"
                        icon="⚠️"
                        defaultOpen={false}
                      >
                        <FittingErrors ctx={ctx} />
                      </CollapsibleSection>
                    )}

                    {FittingGraphics && (
                      <CollapsibleSection
                        title="Graphical Parameters"
                        icon="🎨"
                        defaultOpen={false}
                      >
                        <FittingGraphics ctx={ctx} />
                      </CollapsibleSection>
                    )}
                  </div>
                </CollapsibleSection>
              )
            )}
            {SimulationsSection && <SimulationsSection ctx={ctx} />}
          </>
        )}

        {/* ===== LAB NOTEBOOK EXPORT ===== */}
        {!config.hideNotebook && notebookChecks.length > 0 && (
          <CollapsibleSection
            title="Lab Notebook Export"
            icon="📓"
            defaultOpen={false}
            className="no-print"
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

      {/* ===== ZOOM IMAGE MODAL ===== */}
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