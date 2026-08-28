/* =========================================================================
   src/components/AppModules/protocolsModule.jsx
   Protocols & Protocol Categories view, extracted from App.jsx. Props-only.
   ========================================================================= */

import React, { useState, useRef } from 'react';
import { RichTextEditor } from '../RichTextEditor';
import { BrukerPulseSequenceViewer } from '../DefinitionsExtra';
import { getDirectImageUrl } from '../../data/constants';
import { Icon } from '../Icons';
import { suggestDriveFileName, openDrive } from '../../utils/driveNaming';
import { DriveUploadButton } from '../DriveUpload';
import { renameDriveFilesFor, markAttachmentsDeleted } from '../../utils/driveUpload';

export const ProtocolsModule = ({
  datasetProtocols, expandedGroups, handlePrint, nmrExperiments,
  operatorNames, currentUser, protocolCategories,
  setActiveLibrarySelection, setActiveTestId, setCurrentModule,
  setDatasetProtocols, setExpandedGroups, setProtocolCategories,
  tests
}) => {
                const protoSearch = expandedGroups['protoSearch'] || '';
                const protoCatFilter = expandedGroups['protoCatFilter'] || 'ALL';
                const showProtoCatMgr = expandedGroups['showProtoCatMgr'] || false;
                const newProtoCatInput = expandedGroups['newProtoCatInput'] || '';
                const activeProtoId = expandedGroups['activeProtoId'] || null;
                const protoUserFilter = expandedGroups['protoUserFilter'] || 'ALL';
                const protoSidebarOpen = expandedGroups['protoSidebarOpen'] !== false;

                const allUsers = (Array.isArray(operatorNames) ? operatorNames : [])
                  .map((n) => (typeof n === 'string' ? n : n?.name || ''))
                  .filter((n) => String(n).trim());

                const assignedUsers = (p) =>
                  Array.isArray(p?.assignedTo) ? p.assignedTo : [];

                const filteredProtocols = datasetProtocols.filter((p) => {
                  const matchesSearch = p.title
                    .toLowerCase()
                    .includes(protoSearch.toLowerCase());

                  const matchesCat =
                    protoCatFilter === 'ALL' || p.category === protoCatFilter;

                  const matchesUser =
                    protoUserFilter === 'ALL' ||
                    assignedUsers(p).includes(protoUserFilter);

                  return matchesSearch && matchesCat && matchesUser;
                });

const activeProtocol = activeProtoId
  ? datasetProtocols.find((p) => p.id === activeProtoId)
  : null;

const [tableRows, setTableRows] = useState(2);
const [tableCols, setTableCols] = useState(3);
const protoTitleBeforeEditRef = useRef(null); // Drive-file rename tracking

const protocolFigures = Array.isArray(activeProtocol?.images)
  ? activeProtocol.images
  : [];

const protocolDocuments = Array.isArray(activeProtocol?.documents)
  ? activeProtocol.documents
  : [];

const updateProtocol = (patch) =>
  setDatasetProtocols(
    datasetProtocols.map((p) =>
      p.id === activeProtocol.id ? { ...p, ...patch } : p
    )
  );

const updateProtocolFigure = (id, field, val) =>
  updateProtocol({
    images: protocolFigures.map((im) =>
      im.id === id ? { ...im, [field]: val } : im
    )
  });

const removeProtocolFigure = (id) =>
  updateProtocol({
    images: protocolFigures.filter((im) => im.id !== id)
  });

const addProtocolDocument = () =>
  updateProtocol({
    documents: [
      ...protocolDocuments,
      {
        id: Date.now() + '-' + Math.random().toString(36).slice(2),
        name: suggestDriveFileName({
          protocol: activeProtocol.title || '',
          scientist: (activeProtocol.assignedTo || [])[0] || '',
          suffix: 'doc'
        }),
        type: 'link',
        data: ''
      }
    ]
  });

const updateProtocolDocument = (id, field, val) =>
  updateProtocol({
    documents: protocolDocuments.map((d) =>
      (d.id ?? d) === id ? { ...d, [field]: val } : d
    )
  });

const removeProtocolDocument = (id) =>
  updateProtocol({
    documents: protocolDocuments.filter((d) => (d.id ?? d) !== id)
  });

const insertProtocolTable = () => {
  let tableHtml =
    '<br/><table style="width:100%; border-collapse: collapse;" border="1"><tbody><tr>';

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
  updateProtocol({ content: (activeProtocol.content || '') + tableHtml });
};

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
                            onFocus={() => { protoTitleBeforeEditRef.current = activeProtocol.title; }}
                            onBlur={() => {
                              const before = protoTitleBeforeEditRef.current;
                              if (before && before !== activeProtocol.title) {
                                renameDriveFilesFor({ field: 'protocol', oldValue: before, newValue: activeProtocol.title }).catch(() => {});
                              }
                              protoTitleBeforeEditRef.current = null;
                            }}
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

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGroups((p) => ({
                              ...p,
                              protoSidebarOpen: p.protoSidebarOpen === false
                            }))
                          }
                          title={
                            protoSidebarOpen
                              ? 'Hide sidebar (give more space to the text)'
                              : 'Show sidebar'
                          }
                          className="no-print px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors shadow-sm flex items-center gap-1 bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
                        >
                          {protoSidebarOpen ? '◧ Hide sidebar' : '◧ Show sidebar'}
                        </button>
                      </div>

                      {assignedUsers(activeProtocol).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-4 shrink-0">
                          <Icon name="users" size={13} className="text-slate-400" />
                          <span className="text-[11px] font-bold text-slate-500 uppercase mr-1">
                            Assigned to:
                          </span>
                          {assignedUsers(activeProtocol).map((n) => (
                            <span
                              key={n}
                              className="text-[10px] font-bold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200"
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-y-auto custom-scrollbar">
<div className="flex-1 flex flex-col min-h-[300px]">
  <label className="text-xs font-bold text-slate-500 uppercase mb-2">
    Protocol Description & Steps
  </label>

  <div className="flex flex-wrap items-center gap-2 mb-2 no-print shrink-0">
    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 shadow-sm">
      <label className="text-[10px] font-bold text-slate-500">Rows:</label>
      <input
        type="number"
        min="1"
        value={tableRows}
        onChange={(e) => setTableRows(parseInt(e.target.value) || 1)}
        className="w-10 text-[10px] border border-slate-300 rounded px-1 outline-none"
      />
      <label className="text-[10px] font-bold text-slate-500 ml-1">Cols:</label>
      <input
        type="number"
        min="1"
        value={tableCols}
        onChange={(e) => setTableCols(parseInt(e.target.value) || 1)}
        className="w-10 text-[10px] border border-slate-300 rounded px-1 outline-none"
      />

      <button
        type="button"
        onClick={insertProtocolTable}
        title="Insert a table with the selected dimensions at the end of the protocol content"
        className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold px-2 py-1 rounded transition-colors text-[10px]"
      >
        ▦ Insert Table
      </button>
    </div>

    <button
      type="button"
      onClick={addProtocolDocument}
      title="Attach a document link"
      className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 font-bold px-2 py-1 rounded transition-colors shadow-sm text-[10px] flex items-center gap-1"
    >
      <Icon name="link" size={12} /> + Add Document
    </button>

    <DriveUploadButton
      suggestedName={suggestDriveFileName({
        protocol: activeProtocol.title || '',
        scientist: (activeProtocol.assignedTo || [])[0] || '',
        suffix: 'doc'
      })}
      naming={{ protocol: activeProtocol.title || '', scientist: (activeProtocol.assignedTo || [])[0] || '', suffix: 'doc' }}
      onDone={({ name, dataUrl, drive }) =>
        updateProtocol({
          documents: [
            ...protocolDocuments,
            {
              id: Date.now() + '-' + Math.random().toString(36).slice(2),
              name,
              type: 'link',
              data: drive ? drive.driveUrl : dataUrl
            }
          ]
        })
      }
      label="⬆ Upload document"
    />
  </div>

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
    minHeight={560}
    maxHeight={8000}
    fillHeight={false}
    resizable
    linkButton
    figureButton
    docImportButton
    fileNaming={{ protocol: activeProtocol.title || '', scientist: (activeProtocol.assignedTo || [])[0] || '' }}
    onEditFocusChange={(editing) =>
      setExpandedGroups((p) => ({ ...p, protoSidebarOpen: !editing }))
    }
  />

  {protocolFigures.length > 0 && (
    <div className="mt-6 border border-slate-200 rounded-xl bg-slate-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 mb-3">
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase">
            🖼️ Attached images (legacy)
          </h4>
          <p className="text-xs text-slate-400">
            Older attached images kept for compatibility — use the “🖼️ Figure”
            button in the editor toolbar to insert a new figure with its caption
            inside the text.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {protocolFigures.map((img, idx) => (
          <div
            key={img.id}
            className="bg-white border border-slate-200 rounded-lg p-2 shadow-sm flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                Figure {idx + 1}
              </span>
              <button
                type="button"
                onClick={() => removeProtocolFigure(img.id)}
                className="bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors border border-red-200"
                title="Remove figure"
              >
                ×
              </button>
            </div>

            <input
              type="text"
              value={img.url || ''}
              onChange={(e) => updateProtocolFigure(img.id, 'url', e.target.value)}
              placeholder="Paste image URL here (Google Drive, Dropbox, etc.)"
              className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500"
            />

            {img.url && String(img.url).trim() !== '' && (
              <div className="h-28 rounded-md overflow-hidden border border-slate-100 bg-slate-100">
                <img
                  src={getProtocolImagePreview(img.url)}
                  alt={img.name || `Figure ${idx + 1}`}
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
            )}

            <input
              type="text"
              value={img.name || ''}
              onChange={(e) => updateProtocolFigure(img.id, 'name', e.target.value)}
              placeholder="Figure title"
              className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500"
            />

            <textarea
              value={img.caption || ''}
              onChange={(e) => updateProtocolFigure(img.id, 'caption', e.target.value)}
              placeholder={`Figure ${idx + 1} caption...`}
              rows={2}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs outline-none focus:border-blue-500 resize-y"
            />

            {img.url && String(img.url).trim() !== '' && (
              <a
                href={img.url}
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

  {protocolDocuments.length > 0 && (
    <div className="mt-6 border border-slate-200 rounded-xl bg-slate-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 mb-3">
        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase">
              📎 Documents
            </h4>
            <button
              type="button"
              onClick={openDrive}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
              title="Open your Google Drive folder in a new tab"
            >
              Open Drive ↗
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Attached document links (publications, SOPs, files...).
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {protocolDocuments.map((doc, idx) => {
          const docKey = doc.id ?? idx;

          return (
            <div key={docKey} className="flex flex-col gap-1.5 bg-white border border-slate-200 p-2 rounded-lg shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-500">
                  🔗 Document {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeProtocolDocument(docKey)}
                  className="text-slate-400 hover:text-red-500 font-bold px-1 text-[10px]"
                >
                  ×
                </button>
              </div>

              <input
                type="text"
                value={doc.name || ''}
                onChange={(e) => updateProtocolDocument(docKey, 'name', e.target.value)}
                placeholder="Document Name"
                className="w-full border border-slate-300 rounded p-1 text-[10px] outline-none focus:border-blue-500"
              />

              <input
                type="text"
                value={doc.data || ''}
                onChange={(e) => updateProtocolDocument(docKey, 'data', e.target.value)}
                placeholder="https://..."
                className="w-full border border-slate-300 rounded p-1 text-[10px] outline-none focus:border-blue-500"
              />

              {doc.data && String(doc.data).trim() !== '' && (
                <a
                  href={doc.data}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] text-blue-500 hover:text-blue-700 underline truncate block mt-0.5"
                >
                  Open link ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  )}

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
    <div className={`shrink-0 no-print ${protoSidebarOpen ? 'w-full lg:w-80 flex flex-col gap-4 lg:overflow-y-auto custom-scrollbar lg:border-l border-t lg:border-t-0 border-slate-100 pt-4 lg:pt-0 lg:pl-4' : 'lg:w-12 flex items-start justify-center lg:pt-4'}`}>
      {protoSidebarOpen ? (
        <>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-bold text-slate-500 uppercase">
          👥 Assigned Users
        </label>

        {allUsers.length === 0 ? (
          <span className="text-sm text-slate-400 italic">
            No users configured yet.
          </span>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {allUsers.map((name) => {
                const selected = assignedUsers(activeProtocol).includes(name);

                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      const current = assignedUsers(activeProtocol);
                      const beforeScientist = current[0] || '';
                      const next = selected
                        ? current.filter((n) => n !== name)
                        : [...current, name];
                      const afterScientist = next[0] || '';

                      setDatasetProtocols(
                        datasetProtocols.map((p) =>
                          p.id === activeProtocol.id
                            ? { ...p, assignedTo: next }
                            : p
                        )
                      );

                      // Keep the Drive folder in sync: the protocol folder is
                      // protocols/<title>_<scientist>, so a change of the
                      // assigned scientist renames it too.
                      if (beforeScientist !== afterScientist) {
                        renameDriveFilesFor({
                          field: 'scientist',
                          oldValue: beforeScientist,
                          newValue: afterScientist,
                          scope: { protocol: activeProtocol.title || '' }
                        }).catch(() => {});
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border shadow-sm transition-colors flex items-center gap-1 ${
                      selected
                        ? 'bg-violet-600 border-violet-700 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-violet-400'
                    }`}
                  >
                    {selected ? '✓ ' : '+ '}
                    {name}
                  </button>
                );
              })}
            </div>

            {assignedUsers(activeProtocol).length === 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                ⚠️ This protocol is not assigned to any user yet.
              </p>
            )}
          </>
        )}
      </div>

      <div className="w-full h-px bg-slate-200"></div>

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
        </>
      ) : (
        <button
          type="button"
          onClick={() =>
            setExpandedGroups((p) => ({ ...p, protoSidebarOpen: true }))
          }
          title="Show protocol sidebar"
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm flex items-center justify-center shadow-sm"
        >
          ◀
        </button>
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
                          <Icon name="printer" size={14} /> PDF
                        </button>

                        <button
                          onClick={() => {
const newProto = {
  id: 'pr' + Date.now(),
  title: 'Untitled Protocol',
  category: protocolCategories[0] || 'Uncategorized',
  content: '',
  links: [],
  images: [],
  documents: [],
  assignedTo: currentUser && currentUser.name ? [currentUser.name] : []
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

                        <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-2">
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

                          {allUsers.length > 0 && (
                            <select
                              value={protoUserFilter}
                              onChange={(e) =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  protoUserFilter: e.target.value
                                }))
                              }
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-violet-500 font-semibold text-slate-700 cursor-pointer"
                            >
                              <option value="ALL">All Users</option>

                              {allUsers.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          )}

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
          // Mark any Google Drive attachments of this protocol as deleted.
          markAttachmentsDeleted(proto).catch(() => {});
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
        <Icon name="gear" size={14} className="text-blue-600" /> {proto.linkedPulseProgramName}
      </button>
    )}

    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
      <span className="flex items-center gap-1">
        <Icon name="link" size={13} /> {(proto.links || []).length} Links
      </span>
      <span className="flex items-center gap-1">
        <Icon name="image" size={13} /> {(proto.images || []).length} Figures
      </span>
      <span className="flex items-center gap-1">
        <Icon name="document" size={13} /> {(proto.documents || []).length} Docs
      </span>
      <span className="flex items-center gap-1">
        <Icon name="document" size={13} /> {proto.content ? 'Has Content' : 'Empty'}
      </span>
      {proto.linkedPulseProgramName && (
        <span className="flex items-center gap-1 text-blue-600">
          <Icon name="external" size={13} /> Pulse Linked
        </span>
      )}
    </div>

    {assignedUsers(proto).length > 0 ? (
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
        {assignedUsers(proto).map((name) => (
          <span
            key={name}
            className="text-[10px] font-bold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200 flex items-center gap-1"
          >
            <Icon name="users" size={11} /> {name}
          </span>
        ))}
      </div>
    ) : (
      <div className="mt-3 pt-3 border-t border-slate-100">
        <span className="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">
          Unassigned
        </span>
      </div>
    )}
  </div>
))}
                        </div>
                      )}
                    </div>
                  </div>
                );
};

