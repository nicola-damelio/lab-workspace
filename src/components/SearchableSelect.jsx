// src/components/SearchableSelect.jsx
// Reusable combobox with type-ahead filtering.
// Used everywhere a long list (compounds, cell lines, solvents, buffers,
// additives, probes, instruments…) has to be picked: as you type, matching
// options appear. Press Enter (when allowCustom) to use a typed value that is
// not yet in the list. Undefined / null / empty options are always dropped.

import React, { useState, useEffect, useRef, useMemo } from 'react';

const normalizeOption = (o) => {
  if (o === null || o === undefined) return null;
  if (typeof o === 'object') {
    const value = o.value ?? o.name ?? o.label ?? '';
    const label = o.label ?? o.name ?? o.value ?? '';
    return { value: String(value), label: String(label || value) };
  }
  const s = String(o);
  return { value: s, label: s };
};

export const SearchableSelect = ({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  allowCustom = false,
  className = '',
  disabled = false,
  onClear
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const safeOptions = useMemo(() => {
    const arr = Array.isArray(options) ? options : [];
    const seen = new Set();
    const out = [];
    arr.forEach((o) => {
      const n = normalizeOption(o);
      if (!n || !n.value.trim() || seen.has(n.value)) return;
      seen.add(n.value);
      out.push(n);
    });
    return out.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
  }, [options]);

  const q = query.trim().toLowerCase();
  const filtered = safeOptions
    .filter((o) => !q || o.label.toLowerCase().includes(q))
    .slice(0, 120);
  const exactMatch = safeOptions.some((o) => o.label.toLowerCase() === q);
  const canAddCustom = allowCustom && q && !exactMatch;

  const select = (val) => {
    onChange(val);
    setQuery('');
    setOpen(false);
  };

  const display = query !== '' ? query : value || '';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canAddCustom) {
            e.preventDefault();
            select(query.trim());
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            if (inputRef.current) inputRef.current.blur();
          }
        }}
        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 pr-7 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          if (inputRef.current) inputRef.current.focus();
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold px-1"
      >
        ▾
      </button>

      {onClear && !disabled && value ? (
        <button
          type="button"
          tabIndex={-1}
          title="Clear selection"
          onClick={() => {
            onChange('');
            setQuery('');
          }}
          className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-600 font-bold px-1 text-sm"
        >
          ✕
        </button>
      ) : null}

      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto custom-scrollbar">
          {canAddCustom && (
            <button
              type="button"
              onClick={() => select(query.trim())}
              className="w-full text-left px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 border-b border-dashed border-blue-200"
            >
              + Use “{query.trim()}” (add to list)
            </button>
          )}
          {filtered.length === 0 && !canAddCustom && (
            <div className="p-3 text-sm text-slate-400 italic">
              No matching options.
            </div>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => select(o.value)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-slate-100 last:border-b-0 hover:bg-blue-50 ${
                String(value) === o.value
                  ? 'font-bold text-blue-700 bg-blue-50/60'
                  : 'text-slate-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
