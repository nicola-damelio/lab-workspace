/* =========================================================================
   src/components/AppModules/protocolsModule.jsx
   Protocols & Protocol Categories view, extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';
import { RichTextEditor } from '../RichTextEditor';
import { BrukerPulseSequenceViewer } from '../DefinitionsExtra';
import { getDirectImageUrl } from '../../data/constants';

export const ProtocolsModule = ({
  datasetProtocols, expandedGroups, handlePrint, nmrExperiments,
  protocolCategories, protoImgInput, setActiveLibrarySelection,
  setActiveTestId, setCurrentModule, setDatasetProtocols, setExpandedGroups,
  setProtocolCategories, setProtoImgInput, tests
}) => {
                const protoSearch = expandedGroups['protoSearch'] || '';
                const protoCatFilter = expandedGroups['protoCatFilter'] || 'ALL';
                const showProtoCatMgr = expandedGroups['showProtoCatMgr'] || false;
                const newProtoCatInput = expandedGroups['newProtoCatInput'] || '';
                const activeProtoId = expandedGroups['activeProtoId'] || null;

                const filteredProtocols = datasetProtocols.filter((p) => {
                  const matchesSearch = p.title
                    .toLowerCase()
                    .includes(protoSearch.toLowerCase());

                  const matchesCat =
                    protoCatFilter === 'ALL' || p.category === protoCatFilter;

                  return matchesSearch && matchesCat;
                });

const activeProtocol = activeProtoId
  ? datasetProtocols.find((p) => p.id === activeProtoId)
  : null;

const extractGoogleDriveId = (url) => {
  try {
    const u = String(url || '');

    const fileMatch = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];

    const idMatch = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];

    const openMatch = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (openMatch) return openMatch[1];
  } catch {}

  return '';
};

const getProtocolImagePreview = (url) => {
  if (!url) return '';

  const u = String(url);

  if (u.includes('drive.google.com')) {
    const id = extractGoogleDriveId(u);

    if (id) {
      return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
    }
  }

  return getDirectImageUrl(u);
};

const getProtocolImageFallback = (url) => {
  const direct = getProtocolImagePreview(url);

  if (!direct) return '';

  if (String(direct).includes('drive.google.com')) {
    return `https://wsrv.nl/?url=${encodeURIComponent(direct)}`;
  }

  return direct;
};

                if (activeProtocol) {
                  return (
                    <div className="p-4 md:p-6 h-full flex flex-col bg-white">
                      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 mb-6 border-b border-slate-100 pb-4 shrink-0">
                        <button
                          onClick={() =>
                            setExpandedGroups((p) => ({ ...p, activeProtoId: null }))
                          }
                          className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 p-2 rounded-lg transition-colors shadow-sm no-print self-start"
                        >
                          ◀ Back
                        </button>

                        <div className="flex-1 w-full">
                          <input
                            type="text"
                            value={activeProtocol.title}
                            onChange={(e) =>
                              setDatasetProtocols(
                                datasetProtocols.map((p) =>
                                  p.id === activeProtocol.id
                                    ? { ...p, title: e.target.value }
                                    : p
                                )
                              )
                            }
                            className="text-xl md:text-2xl font-black text-slate-800 bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-blue-500 rounded px-1"
                            placeholder="Protocol Title"
                          />
                        </div>

                        <select
                          value={activeProtocol.category}
                          onChange={(e) =>
                            setDatasetProtocols(
                              datasetProtocols.map((p) =>
                                p.id === activeProtocol.id
                                  ? { ...p, category: e.target.value }
                                  : p
                              )
                            )
                          }
                          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-slate-50 font-semibold text-slate-700 outline-none cursor-pointer w-full md:w-auto no-print"
                        >
                          {protocolCategories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-y-auto lg:overflow-hidden">
<div className="flex-1 flex flex-col h-auto lg:h-full min-h-[300px]">
  <label className="text-xs font-bold text-slate-500 uppercase mb-2">
    Protocol Description & Steps
  </label>

  <RichTextEditor
    value={activeProtocol.content || ''}
    onChange={(val) =>
      setDatasetProtocols(
        datasetProtocols.map((p) =>
          p.id === activeProtocol.id ? { ...p, content: val } : p
        )
      )
    }
    placeholder="Write the detailed protocol steps here. You can paste images directly..."
  />

  <div className="mt-6 border border-slate-200 rounded-xl bg-slate-50 p-4 shadow-sm">
    <div className="flex flex-col gap-3 mb-3">
      <div>
        <h4 className="text-xs font-bold text-slate-500 uppercase">
          Protocol Images
        </h4>
        <p className="text-xs text-slate-400">
          Paste Google Drive image links. Previews appear immediately.
        </p>
      </div>

      {/* Inline URL input — no prompt() required */}
      <div className="flex gap-2 items-center no-print">
        <input
          type="text"
          value={protoImgInput}
          onChange={(e) => setProtoImgInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const urls = protoImgInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
              if (!urls.length) return;
              const existingCount = (activeProtocol.images || []).length;
              const newImgs = urls.map((url, idx) => ({ id: `proto_img_${Date.now()}_${idx}`, name: `Image ${existingCount + idx + 1}`, url }));
              setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, images: [...(p.images || []), ...newImgs] } : p));
              setProtoImgInput('');
            }
          }}
          placeholder="Paste Google Drive URL(s), comma-separated… then press Enter or Add"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 bg-white"
        />
        <button
          type="button"
          onClick={() => {
            const urls = protoImgInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
            if (!urls.length) return;
            const existingCount = (activeProtocol.images || []).length;
            const newImgs = urls.map((url, idx) => ({ id: `proto_img_${Date.now()}_${idx}`, name: `Image ${existingCount + idx + 1}`, url }));
            setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, images: [...(p.images || []), ...newImgs] } : p));
            setProtoImgInput('');
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-xs shadow-sm transition-colors whitespace-nowrap"
        >
          + Add
        </button>
      </div>
    </div>

    {(activeProtocol.images || []).length === 0 ? (
      <div className="text-sm text-slate-400 italic bg-white border border-dashed border-slate-300 rounded-lg p-4">
        No images added yet. Use “+ Add Image Link(s)” and paste Google Drive
        image URLs.
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {(activeProtocol.images || []).map((img) => (
          <div
            key={img.id}
            className="bg-white border border-slate-200 rounded-lg p-2 shadow-sm flex flex-col gap-2"
          >
            <div className="h-28 rounded-md overflow-hidden border border-slate-100 bg-slate-100">
              <img
                src={getProtocolImagePreview(img.url)}
                alt={img.name || 'Protocol image'}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={(e) => {
                  if (!e.currentTarget.dataset.fallback) {
                    e.currentTarget.dataset.fallback = '1';
                    e.currentTarget.src = getProtocolImageFallback(img.url);
                  }
                }}
              />
            </div>

            <input
              type="text"
              value={img.name || ''}
              onChange={(e) =>
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? {
                          ...p,
                          images: (p.images || []).map((im) =>
                            im.id === img.id
                              ? { ...im, name: e.target.value }
                              : im
                          )
                        }
                      : p
                  )
                )
              }
              className="border border-slate-200 rounded-md px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
              placeholder="Image name"
            />

            <div className="flex gap-2">
              <a
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-bold py-1 px-2 rounded text-xs transition-colors"
              >
                Open
              </a>

              <button
                type="button"
                onClick={() =>
                  setDatasetProtocols(
                    datasetProtocols.map((p) =>
                      p.id === activeProtocol.id
                        ? {
                            ...p,
                            images: (p.images || []).filter(
                              (im) => im.id !== img.id
                            )
                          }
                        : p
                    )
                  )
                }
                className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-1 px-2 rounded text-xs transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  <div className="mt-6 border-t border-slate-100 pt-4 no-print shrink-0">
    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
      🧪 Tests Using This Protocol
    </h4>
    <div className="flex flex-wrap gap-2">
      {
        tests.filter(
          (t) =>
            t.linkedProtocolId === activeProtocol.id ||
            (Array.isArray(t.linkedProtocolIds) &&
              t.linkedProtocolIds.includes(activeProtocol.id))
        ).length === 0 && (
          <span className="text-sm text-slate-400 italic">
            No tests are currently linked to this protocol.
          </span>
        )
      }
      {tests
        .filter(
          (t) =>
            t.linkedProtocolId === activeProtocol.id ||
            (Array.isArray(t.linkedProtocolIds) &&
              t.linkedProtocolIds.includes(activeProtocol.id))
        )
        .map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setActiveTestId(t.id);
              setCurrentModule('active-test');
            }}
            className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1"
          >
            {t.type === 'nmr' ? '📉' : t.type === 'cd' ? '🌀' : '🧫'}{' '}
            {t.name} {t.instanceName ? `(${t.instanceName})` : ''}
          </button>
        ))}
    </div>
  </div>
</div>
{(() => {
  const pulsePrograms = (Array.isArray(nmrExperiments) ? nmrExperiments : [])
    .map((exp) => (typeof exp === 'string' ? { name: exp } : exp))
    .filter((exp) => exp && exp.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const linkedPulseName = activeProtocol.linkedPulseProgramName || '';
  const linkedPulse = pulsePrograms.find((exp) => exp.name === linkedPulseName) || null;

  const normalizeProtocolPulseLinkUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return '#';
    if (/^(https?:|mailto:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    return `https://${raw}`;
  };

  const openLinkedPulseInDefinitions = () => {
    if (!linkedPulseName) return;

    setActiveLibrarySelection({ type: 'nmrExperiment', id: linkedPulseName });
    setCurrentModule('definitions');

    setTimeout(() => {
      const el = document.getElementById('section-nmrExperiment');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 180);
  };

  return (
    <div className="w-full lg:w-80 flex flex-col gap-4 lg:overflow-y-auto custom-scrollbar shrink-0 lg:border-l border-t lg:border-t-0 border-slate-100 pt-4 lg:pt-0 lg:pl-4 no-print">
      <label className="text-xs font-bold text-slate-500 uppercase">
        Attached Resources
      </label>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-col gap-2">
        <label className="text-[10px] font-bold text-blue-700 uppercase">
          Pulse Sequence Link (Definitions & Labels)
        </label>

        <select
          value={linkedPulseName}
          onChange={(e) => {
            const value = e.target.value;

            setDatasetProtocols(
              datasetProtocols.map((p) =>
                p.id === activeProtocol.id
                  ? { ...p, linkedPulseProgramName: value }
                  : p
              )
            );

            setExpandedGroups((prev) => ({
              ...prev,
              protoPulseViewerOpen: false
            }));
          }}
          className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
        >
          <option value="">— No pulse program linked —</option>
          {pulsePrograms.map((exp) => (
            <option key={exp.name} value={exp.name}>
              {exp.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openLinkedPulseInDefinitions}
            disabled={!linkedPulseName}
            className="bg-white border border-blue-300 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed text-blue-700 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
          >
            Open in Definitions
          </button>

          <button
            type="button"
            onClick={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                protoPulseViewerOpen: true
              }))
            }
            disabled={!linkedPulse || !String(linkedPulse.pulseSequence || '').trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
          >
            Preview Graphical
          </button>

          {linkedPulse && String(linkedPulse.pulseSequenceLink || '').trim() && (
            <a
              href={normalizeProtocolPulseLinkUrl(linkedPulse.pulseSequenceLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
            >
              Open Drive
            </a>
          )}
        </div>

        {!linkedPulse && (
          <p className="text-[11px] text-blue-700/80">
            Choose a pulse program defined under Definitions & Labels → NMR
            Experiments / Pulse Programs.
          </p>
        )}

        {linkedPulse && !String(linkedPulse.pulseSequence || '').trim() && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            This pulse program is linked, but it does not contain pulse-sequence
            text yet. Open it in Definitions & Labels and paste the Bruker
            pulse-program text.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {(activeProtocol.links || []).length === 0 && (
          <span className="text-sm text-slate-400 italic">
            No external links or documents attached.
          </span>
        )}

        {(activeProtocol.links || []).map((link) => (
          <div
            key={link.id}
            className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg flex items-center justify-between group shadow-sm"
          >
            <div
              className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1"
              onClick={() => {
                const newName = prompt('Rename link:', link.name);
                if (newName) {
                  setDatasetProtocols(
                    datasetProtocols.map((p) =>
                      p.id === activeProtocol.id
                        ? {
                            ...p,
                            links: p.links.map((l) =>
                              l.id === link.id ? { ...l, name: newName } : l
                            )
                          }
                        : p
                    )
                  );
                }
              }}
            >
              <span className="text-lg">
                {link.url.match(/\.(jpeg|jpg|gif|png|svg)$/i) ? '🖼️' : '🔗'}
              </span>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-slate-700 truncate group-hover:text-blue-600"
                onClick={(e) => e.stopPropagation()}
              >
                {link.name}
              </a>
            </div>

            <button
              onClick={() =>
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? {
                          ...p,
                          links: p.links.filter((l) => l.id !== link.id)
                        }
                      : p
                  )
                )
              }
              className="text-slate-400 hover:text-red-500 font-bold px-2 py-1 transition-opacity"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => {
            const urlsText = prompt(
              'Paste external link(s) separated by commas (Drive, PDF, Image URL):'
            );

            if (urlsText && urlsText.trim()) {
              const urls = urlsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

              const newLinks = urls.map((url, idx) => ({
                id: Date.now().toString() + idx + Math.random(),
                name: 'Linked Resource',
                url
              }));

              setDatasetProtocols(
                datasetProtocols.map((p) =>
                  p.id === activeProtocol.id
                    ? { ...p, links: [...(p.links || []), ...newLinks] }
                    : p
                )
              );
            }
          }}
          className="border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm"
        >
          + Add External Link(s)
        </button>

        <label className="border-2 border-dashed border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm cursor-pointer block">
          + Attach Multiple Files
          <input
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files);
              if (!files.length) return;

              const newLinksPromises = files.map(
                (file) =>
                  new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (ev) =>
                      resolve({
                        id: Date.now().toString() + Math.random(),
                        name: file.name,
                        url: ev.target.result
                      });
                    reader.readAsDataURL(file);
                  })
              );

              Promise.all(newLinksPromises).then((newLinks) => {
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? { ...p, links: [...(p.links || []), ...newLinks] }
                      : p
                  )
                );
              });

              e.target.value = '';
            }}
            className="hidden"
          />
        </label>
      </div>

      {expandedGroups['protoPulseViewerOpen'] &&
        linkedPulse &&
        String(linkedPulse.pulseSequence || '').trim() && (
          <BrukerPulseSequenceViewer
            open={true}
            onClose={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                protoPulseViewerOpen: false
              }))
            }
            name={linkedPulse.name}
            pulseSequence={linkedPulse.pulseSequence || ''}
            pulseSequenceLink={linkedPulse.pulseSequenceLink || ''}
          />
        )}
    </div>
  );
})()}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="p-4 md:p-6 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <h2 className="text-xl md:text-2xl font-black text-slate-800">
                          Protocols Library
                        </h2>

                        <p className="text-sm text-slate-500">
                          Draft, store, and link your experimental procedures.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 no-print w-full md:w-auto">
                        <button
                          onClick={handlePrint}
                          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm flex-1 md:flex-none"
                        >
                          🖨️ PDF
                        </button>

                        <button
                          onClick={() => {
const newProto = {
  id: 'pr' + Date.now(),
  title: 'Untitled Protocol',
  category: protocolCategories[0] || 'Uncategorized',
  content: '',
  links: [],
  images: []
};

                            setDatasetProtocols([newProto, ...datasetProtocols]);

                            setExpandedGroups((p) => ({
                              ...p,
                              activeProtoId: newProto.id
                            }));
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg shadow-sm text-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2"
                        >
                          ➕ New Protocol
                        </button>
                      </div>
                    </div>

                    <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center">
                        <div className="flex-1 w-full relative">
                          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>

                          <input
                            type="text"
                            placeholder="Search protocols..."
                            value={protoSearch}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, protoSearch: e.target.value }))
                            }
                            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="w-full md:w-64 flex gap-2">
                          <select
                            value={protoCatFilter}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({
                                ...p,
                                protoCatFilter: e.target.value
                              }))
                            }
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-500 font-semibold text-slate-700 cursor-pointer"
                          >
                            <option value="ALL">All Categories</option>

                            {protocolCategories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() =>
                              setExpandedGroups((p) => ({
                                ...p,
                                showProtoCatMgr: !showProtoCatMgr
                              }))
                            }
                            className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${
                              showProtoCatMgr
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Manage Categories"
                          >
                            ⚙️
                          </button>
                        </div>
                      </div>

                      {showProtoCatMgr && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase">
                            Manage Protocol Categories
                          </h4>

                          <div className="flex flex-col md:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="New category name..."
                              value={newProtoCatInput}
                              onChange={(e) =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  newProtoCatInput: e.target.value
                                }))
                              }
                              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-emerald-500"
                            />

                            <button
                              onClick={() => {
                                const v = newProtoCatInput.trim();

                                if (v && !protocolCategories.includes(v)) {
                                  setProtocolCategories([...protocolCategories, v]);

                                  setExpandedGroups((p) => ({
                                    ...p,
                                    newProtoCatInput: ''
                                  }));
                                }
                              }}
                              className="bg-emerald-600 text-white font-bold px-4 py-2 rounded text-sm shadow-sm hover:bg-emerald-700 transition-colors"
                            >
                              Add
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2 mt-2">
                            {protocolCategories.map((c) => (
                              <div
                                key={c}
                                className="flex items-center gap-1 bg-white border border-slate-300 px-2 py-1 rounded text-xs shadow-sm font-semibold text-slate-700"
                              >
                                {c}

                                <button
                                  onClick={() =>
                                    setProtocolCategories(
                                      protocolCategories.filter((cat) => cat !== c)
                                    )
                                  }
                                  className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none font-bold"
                                >
                                  &times;
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {filteredProtocols.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic">
                          No protocols match your filters.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
{filteredProtocols.map((proto) => (
  <div
    key={proto.id}
    className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 shadow-sm hover:shadow-md hover:border-emerald-400 cursor-pointer transition-all flex flex-col group relative"
    onClick={() =>
      setExpandedGroups((p) => ({
        ...p,
        activeProtoId: proto.id
      }))
    }
  >
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (confirm('Delete this protocol?')) {
          setDatasetProtocols(
            datasetProtocols.filter((p) => p.id !== proto.id)
          );
        }
      }}
      className="absolute top-3 right-3 text-slate-300 hover:text-red-500 text-lg md:opacity-0 group-hover:opacity-100 transition-opacity no-print"
      title="Delete Protocol"
    >
      &times;
    </button>

    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded self-start mb-3 border border-emerald-200">
      {proto.category}
    </span>

    <h3 className="font-bold text-slate-800 text-lg truncate pr-6">
      {proto.title}
    </h3>

    {proto.linkedPulseProgramName && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();

          setActiveLibrarySelection({
            type: 'nmrExperiment',
            id: proto.linkedPulseProgramName
          });

          setCurrentModule('definitions');

          setTimeout(() => {
            const el = document.getElementById('section-nmrExperiment');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 180);
        }}
        className="mt-3 self-start bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1"
      >
        🎛️ {proto.linkedPulseProgramName}
      </button>
    )}

    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
      <span className="flex items-center gap-1">
        🔗 {(proto.links || []).length} Links
      </span>
      <span className="flex items-center gap-1">
        📝 {proto.content ? 'Has Content' : 'Empty'}
      </span>
      {proto.linkedPulseProgramName && (
        <span className="flex items-center gap-1 text-blue-600">
          📡 Pulse Linked
        </span>
      )}
    </div>
  </div>
))}
                        </div>
                      )}
                    </div>
                  </div>
                );
};

