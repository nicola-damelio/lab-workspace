import React, { useState, useMemo } from 'react';

// --- COLLAPSIBLE SECTION (reused) ---
const CollapsibleSection = ({ title, icon, defaultOpen = true, children, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${
          isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
        </div>
        <svg
          className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// --- TAG INPUT COMPONENT ---
const TagManager = ({ items, onAdd, onRemove, onRename, color, placeholder, icon }) => {
  const [input, setInput] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editVal, setEditVal] = useState('');

  const handleAdd = () => {
    const v = input.trim();
    if (v && !items.includes(v)) {
      onAdd(v);
      setInput('');
    }
  };

  const handleRename = (idx) => {
    const v = editVal.trim();
    if (v && v !== items[idx]) {
      onRename(items[idx], v);
    }
    setEditingIdx(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder={placeholder}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={handleAdd}
          className={`${color} text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm hover:opacity-90 transition-opacity`}
        >
          + Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && (
          <span className="text-sm text-slate-400 italic py-2">No items defined yet.</span>
        )}
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 bg-white border border-slate-300 px-3 py-1.5 rounded-lg text-sm shadow-sm font-semibold text-slate-700 group"
          >
            {icon && <span className="text-xs opacity-60">{icon}</span>}
            {editingIdx === idx ? (
              <input
                type="text"
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(idx);
                  if (e.key === 'Escape') setEditingIdx(null);
                }}
                onBlur={() => handleRename(idx)}
                autoFocus
                className="border border-blue-400 rounded px-1 py-0.5 text-sm outline-none w-28"
              />
            ) : (
              <span
                className="cursor-pointer hover:text-blue-600 transition-colors"
                onDoubleClick={() => { setEditingIdx(idx); setEditVal(item); }}
                title="Double-click to rename"
              >
                {item}
              </span>
            )}
            <button
              onClick={() => onRemove(item)}
              className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none font-bold opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- CUSTOM FIELD DEFINITION MANAGER ---
const CustomFieldManager = ({ fields, setFields }) => {
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');

  const addField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    if (fields.some((f) => f.name === name)) {
      alert(`Field "${name}" already exists.`);
      return;
    }
    setFields([...fields, { id: Date.now().toString(), name, type: newFieldType, options: [] }]);
    setNewFieldName('');
  };

  const removeField = (id) => {
    setFields(fields.filter((f) => f.id !== id));
  };

  const renameField = (id, newName) => {
    setFields(fields.map((f) => (f.id === id ? { ...f, name: newName } : f)));
  };

  const addOption = (fieldId) => {
    const opt = prompt('Enter option value:');
    if (!opt || !opt.trim()) return;
    setFields(fields.map((f) => (f.id === fieldId ? { ...f, options: [...f.options, opt.trim()] } : f)));
  };

  const removeOption = (fieldId, optIdx) => {
    setFields(
      fields.map((f) =>
        f.id === fieldId ? { ...f, options: f.options.filter((_, i) => i !== optIdx) } : f
      )
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Field Name</label>
          <input
            type="text"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addField(); }}
            placeholder="e.g. Target Protein, Batch ID, Lab Member..."
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="w-40">
          <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Type</label>
          <select
            value={newFieldType}
            onChange={(e) => setNewFieldType(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            <option value="text">Text</option>
            <option value="select">Dropdown</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
        </div>
        <button
          onClick={addField}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm transition-colors"
        >
          + Add Field
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-slate-400 italic py-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-300">
          No custom fields defined. Add fields above to create additional metadata for your tests.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-700">{field.name}</span>
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold uppercase">
                    {field.type}
                  </span>
                </div>
                <div className="flex gap-2">
                  {field.type === 'select' && (
                    <button
                      onClick={() => addOption(field.id)}
                      className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded font-bold transition-colors"
                    >
                      + Option
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const newName = prompt('Rename field:', field.name);
                      if (newName && newName.trim()) renameField(field.id, newName.trim());
                    }}
                    className="text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 px-2 py-1 rounded font-bold transition-colors"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => removeField(field.id)}
                    className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-2 py-1 rounded font-bold transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              {field.type === 'select' && field.options.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {field.options.map((opt, oi) => (
                    <span
                      key={oi}
                      className="text-xs bg-white border border-slate-300 px-2 py-0.5 rounded flex items-center gap-1 group"
                    >
                      {opt}
                      <button
                        onClick={() => removeOption(field.id, oi)}
                        className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- MAIN DEFINITIONS PANEL ---
export const DefinitionsPanel = ({
  customCmpds, setCustomCmpds,
  customCellLines, setCustomCellLines,
  testCategories, setTestCategories,
  protocolCategories, setProtocolCategories,
  customFields, setCustomFields,
  cmpColors, setCmpColors,
  handlePrint
}) => {
  const [cmpSearch, setCmpSearch] = useState('');
  const [cellSearch, setCellSearch] = useState('');

  const filteredCmpds = useMemo(
    () => customCmpds.filter((c) => c.toLowerCase().includes(cmpSearch.toLowerCase())),
    [customCmpds, cmpSearch]
  );

  const filteredCells = useMemo(
    () => customCellLines.filter((c) => c.toLowerCase().includes(cellSearch.toLowerCase())),
    [customCellLines, cellSearch]
  );

  const addCompound = (name) => {
    if (!customCmpds.includes(name)) setCustomCmpds((prev) => [...prev, name]);
  };

  const removeCompound = (name) => {
    if (window.confirm(`Remove compound "${name}"? Tests using it will keep their data but it won't appear in suggestions.`)) {
      setCustomCmpds((prev) => prev.filter((c) => c !== name));
    }
  };

  const renameCompound = (oldName, newName) => {
    setCustomCmpds((prev) => prev.map((c) => (c === oldName ? newName : c)));
  };

  const addCellLine = (name) => {
    if (!customCellLines.includes(name)) setCustomCellLines((prev) => [...prev, name]);
  };

  const removeCellLine = (name) => {
    if (window.confirm(`Remove cell line "${name}"?`)) {
      setCustomCellLines((prev) => prev.filter((c) => c !== name));
    }
  };

  const renameCellLine = (oldName, newName) => {
    setCustomCellLines((prev) => prev.map((c) => (c === oldName ? newName : c)));
  };

  const addCategory = (name) => {
    if (!testCategories.includes(name)) setTestCategories((prev) => [...prev, name]);
  };

  const removeCategory = (name) => {
    if (window.confirm(`Remove test category "${name}"?`)) {
      setTestCategories((prev) => prev.filter((c) => c !== name));
    }
  };

  const renameCategory = (oldName, newName) => {
    setTestCategories((prev) => prev.map((c) => (c === oldName ? newName : c)));
  };

  const addProtoCat = (name) => {
    if (!protocolCategories.includes(name)) setProtocolCategories((prev) => [...prev, name]);
  };

  const removeProtoCat = (name) => {
    setProtocolCategories((prev) => prev.filter((c) => c !== name));
  };

  const renameProtoCat = (oldName, newName) => {
    setProtocolCategories((prev) => prev.map((c) => (c === oldName ? newName : c)));
  };

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-4 gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-slate-800">Definitions & Labels</h2>
          <p className="text-sm text-slate-500">
            Manage compounds, cell lines, categories, and custom metadata fields used across all tests and the Lab Notebook.
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print w-full md:w-auto justify-center"
        >
          🖨️ Print / Save PDF
        </button>
      </div>

      {/* COMPOUNDS */}
      <CollapsibleSection title="Compounds / Samples Library" icon="🧪" defaultOpen={true}>
        <div className="mb-3">
          <input
            type="text"
            value={cmpSearch}
            onChange={(e) => setCmpSearch(e.target.value)}
            placeholder="Search compounds..."
            className="w-full md:w-64 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <TagManager
          items={filteredCmpds}
          onAdd={addCompound}
          onRemove={removeCompound}
          onRename={renameCompound}
          color="bg-blue-600 hover:bg-blue-700"
          placeholder="e.g. Compound A, Doxorubicin, Peptide X..."
          icon="🧬"
        />
        {cmpSearch && (
          <p className="text-xs text-slate-400 mt-2">
            Showing {filteredCmpds.length} of {customCmpds.length} compounds
          </p>
        )}
      </CollapsibleSection>

      {/* CELL LINES */}
      <CollapsibleSection title="Cell Lines / Biological Models" icon="🔬" defaultOpen={true}>
        <div className="mb-3">
          <input
            type="text"
            value={cellSearch}
            onChange={(e) => setCellSearch(e.target.value)}
            placeholder="Search cell lines..."
            className="w-full md:w-64 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        <TagManager
          items={filteredCells}
          onAdd={addCellLine}
          onRemove={removeCellLine}
          onRename={renameCellLine}
          color="bg-emerald-600 hover:bg-emerald-700"
          placeholder="e.g. HeLa, HEK293, MCF-7, Primary T cells..."
          icon="🦠"
        />
      </CollapsibleSection>

      {/* TEST CATEGORIES */}
      <CollapsibleSection title="Test Categories" icon="🏷️" defaultOpen={true}>
        <TagManager
          items={testCategories}
          onAdd={addCategory}
          onRemove={removeCategory}
          onRename={renameCategory}
          color="bg-purple-600 hover:bg-purple-700"
          placeholder="e.g. Activity, Toxicity, Binding, Kinetics..."
          icon="📋"
        />
      </CollapsibleSection>

      {/* PROTOCOL CATEGORIES */}
      <CollapsibleSection title="Protocol Categories" icon="📝" defaultOpen={false}>
        <TagManager
          items={protocolCategories}
          onAdd={addProtoCat}
          onRemove={removeProtoCat}
          onRename={renameProtoCat}
          color="bg-teal-600 hover:bg-teal-700"
          placeholder="e.g. Preparation, Measurement, Analysis..."
          icon="📄"
        />
      </CollapsibleSection>

      {/* CUSTOM METADATA FIELDS */}
      <CollapsibleSection title="Custom Metadata Fields" icon="⚙️" defaultOpen={true}>
        <p className="text-sm text-slate-500 mb-4">
          Define additional fields that will appear in each test's metadata section. These allow you to capture
          experiment-specific information (e.g., target protein, batch number, instrument used) that can be
          filtered in the Lab Notebook.
        </p>
        <CustomFieldManager fields={customFields} setFields={setCustomFields} />
      </CollapsibleSection>

      {/* USAGE INFO */}
      <CollapsibleSection title="How Labels Are Used" icon="ℹ️" defaultOpen={false}>
        <div className="text-sm text-slate-600 flex flex-col gap-3">
          <div className="flex items-start gap-3 bg-blue-50 p-3 rounded-lg border border-blue-100">
            <span className="text-lg">🧫</span>
            <div>
              <p className="font-bold text-blue-800">Plate Tests</p>
              <p>Compounds appear in row/column dropdowns, concentration assignments, and chart legends.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
            <span className="text-lg">📉</span>
            <div>
              <p className="font-bold text-emerald-800">NMR Tests</p>
              <p>Compound labels are used in the sample identification and Lab Notebook export.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-purple-50 p-3 rounded-lg border border-purple-100">
            <span className="text-lg">🌀</span>
            <div>
              <p className="font-bold text-purple-800">CD Tests</p>
              <p>Compound/sample labels identify each CD experiment in reports and filtering.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-amber-50 p-3 rounded-lg border border-amber-100">
            <span className="text-lg">📓</span>
            <div>
              <p className="font-bold text-amber-800">Lab Notebook</p>
              <p>All defined compounds, cell lines, categories, and custom fields become filterable dimensions
                in the consolidated Lab Notebook view.</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default DefinitionsPanel;
