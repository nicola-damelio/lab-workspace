/* =========================================================================
   src/components/AppModules/appSidebar.jsx
   Left navigation sidebar (extracted from App.jsx). Props-only component.
   ========================================================================= */

import React, { useState, useEffect } from 'react';
import { Icon } from '../Icons';
import { getDriveToken, getDriveAccountEmail } from '../../utils/driveUpload';
import { openDrive } from '../../utils/driveNaming';

export const AppSidebar = ({
  isSidebarOpen, setIsSidebarOpen,
  handleBackToExplorer,
  datasetTitle, setDatasetTitle, datasetSubtitle, setDatasetSubtitle,
  saveStatus, saveErrorMsg,
  currentUser, setCurrentUser, setUnlockedTestIds, setLoginModal,
  currentModule, setCurrentModule,
  handlePrint, loadHTML, exportHTML,
  handleUndo, handleRedo, historyIndex, historyRef,
  user, onGoogleLogin, onConnectDrive
}) => {
  const [driveConnected, setDriveConnected] = useState(!!getDriveToken());
  const [driveAccount, setDriveAccount] = useState('');

  useEffect(() => {
    const refreshAccount = () => {
      if (getDriveToken()) {
        getDriveAccountEmail().then((email) => setDriveAccount(email || '')).catch(() => setDriveAccount(''));
      } else {
        setDriveAccount('');
      }
    };
    const onConnected = () => { setDriveConnected(!!getDriveToken()); refreshAccount(); };
    window.addEventListener('lab:drive-connected', onConnected);
    refreshAccount(); // on first load, show which account is connected
    return () => window.removeEventListener('lab:drive-connected', onConnected);
  }, []);

  return (

          <div
            className={`bg-white border-r border-slate-200 flex flex-col shadow-sm z-50 shrink-0 no-print transition-all duration-300 absolute md:relative h-full ${
              isSidebarOpen
                ? 'translate-x-0 w-64'
                : '-translate-x-full md:translate-x-0 md:w-16 items-center'
            }`}
          >
            <div
              className={`p-4 border-b border-slate-200 flex items-center gap-2 ${
                isSidebarOpen ? 'justify-between' : 'flex-col justify-center'
              }`}
            >
              <button
                onClick={handleBackToExplorer}
                className="text-slate-400 hover:text-blue-600 transition-colors"
                title="Back to Workspace"
              >
                ◀
              </button>

              {isSidebarOpen && (
                <div className="min-w-0 flex-1">
                  <input
                    value={datasetTitle}
                    onChange={(e) => setDatasetTitle(e.target.value)}
                    className="w-full text-sm font-black text-slate-800 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1"
                    placeholder="Dataset Title"
                  />

                  <input
                    value={datasetSubtitle}
                    onChange={(e) => setDatasetSubtitle(e.target.value)}
                    className="w-full text-[10px] font-medium text-slate-500 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1 mt-0.5"
                    placeholder="Subtitle / Project info"
                  />
                </div>
              )}

              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg"
                title="Toggle Sidebar"
              >
                {isSidebarOpen ? '⮜' : '☰'}
              </button>
            </div>

            {isSidebarOpen && (
              <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-[10px] font-bold text-slate-500">
                <span>Status:</span>

                {saveStatus === 'saving' ? (
                  <span className="text-blue-500 animate-pulse flex items-center gap-1"><Icon name="save" size={12} /> Saving...</span>
                ) : saveStatus === 'saved' ? (
                  <span className="text-emerald-600 flex items-center gap-1"><Icon name="cloud" size={12} /> Cloud Sync</span>
                ) : saveStatus === 'error' ? (
                  <span className="text-red-600 flex items-center gap-1" title={saveErrorMsg}><Icon name="x" size={12} /> Error</span>
                ) : (
                  <span className="text-slate-600">...</span>
                )}
              </div>
            )}

            <nav
              className={`flex-1 overflow-y-auto py-4 flex flex-col gap-1 ${
                isSidebarOpen ? 'px-2' : 'px-1 items-center'
              }`}
            >
              {/* ── User identity bar ── */}
              {isSidebarOpen ? (
                <div className={`mb-3 rounded-xl border px-3 py-2.5 flex items-center gap-2 text-sm ${
                  currentUser?.role === 'superuser'
                    ? 'bg-amber-50 border-amber-200'
                    : currentUser
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <span className="text-base shrink-0">
                    {currentUser?.role === 'superuser' ? '👑' : currentUser ? '🧪' : '👤'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-black uppercase text-slate-400">Logged in as</div>
                    <div className="font-bold text-slate-700 truncate text-xs">
                      {currentUser ? currentUser.name : <span className="text-slate-400 italic">Guest</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (currentUser) {
                        setCurrentUser(null);
                        setUnlockedTestIds(new Set());
                      } else {
                        setLoginModal({ isEntryGate: false });
                      }
                    }}
                    className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                      currentUser
                        ? 'bg-slate-200 hover:bg-red-100 text-slate-600 hover:text-red-700'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {currentUser ? 'Logout' : 'Login'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (currentUser) { setCurrentUser(null); setUnlockedTestIds(new Set()); }
                    else setLoginModal({ isEntryGate: false });
                  }}
                  title={currentUser ? `Logged in as ${currentUser.name} — click to logout` : 'Login'}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center text-base mb-2 transition-colors ${
                    currentUser?.role === 'superuser' ? 'bg-amber-50 border-amber-200' :
                    currentUser ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:bg-blue-50'
                  }`}
                >
                  {currentUser?.role === 'superuser'
                    ? <Icon name="crown" size={20} className="text-amber-500" />
                    : currentUser ? <Icon name="user" size={20} className="text-blue-600" />
                      : <Icon name="lock" size={20} className="text-slate-400" />}
                </button>
              )}

              {[
                { id: 'dashboard', icon: '📊', label: 'Dataset Overview' },
                { id: 'projects', icon: '📁', label: 'Projects' },
                { id: 'notebook', icon: '📓', label: 'Lab Notebook' },
                { id: 'definitions', icon: '🏷️', label: 'Definitions & Labels' },
                { id: 'tests', icon: '🧪', label: 'Tests & Fittings' },
                { id: 'agenda', icon: '🗓️', label: 'Agenda (Timeline)' },
                { id: 'protocols', icon: '📝', label: 'Protocols' },
                { id: 'storage', icon: '📦', label: 'Storage & Boxes' },
                { id: 'calculations', icon: '🧮', label: 'Calculations' },
                { id: 'publications', icon: '📰', label: 'Publications' }
              ].map((nav) => (
                <button
                  key={nav.id}
                  onClick={() => {
                    setCurrentModule(nav.id);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  title={!isSidebarOpen ? nav.label : ''}
                  className={`flex items-center gap-3 py-2 rounded-lg text-sm transition-all text-left ${
                    isSidebarOpen ? 'px-3 w-full' : 'px-0 w-10 justify-center'
                  } ${
                    currentModule === nav.id
                      ? 'bg-blue-50 text-blue-700 font-bold shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon name={nav.icon} size={18} className="shrink-0" />
                  {isSidebarOpen && <span>{nav.label}</span>}
                </button>
              ))}
            </nav>

            <div
              className={`p-4 border-t border-slate-200 flex flex-col gap-2 ${
                !isSidebarOpen ? 'items-center px-1' : ''
              }`}
            >
              <div className={`flex flex-col gap-2 w-full`}>
                {!user && onGoogleLogin && (
                  <button
                    onClick={onGoogleLogin}
                    className={`w-full text-center bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors flex items-center justify-center gap-1 ${
                      !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                    }`}
                    title="Optional: sign in with Google to enable cloud sync (the app works fully without it)"
                  >
                    <Icon name="cloud" size={14} /> {isSidebarOpen ? 'Cloud sign-in (optional)' : ''}
                  </button>
                )}

                {/* Google Drive: uploads are auto-renamed and saved here */}
                {driveConnected ? (
                  <div
                    className={`flex items-center justify-between gap-1 bg-emerald-50 border border-emerald-200 rounded py-1.5 px-2 ${
                      !isSidebarOpen ? 'flex-col px-1' : ''
                    }`}
                    title="Google Drive connected — uploaded files are renamed and saved to your Drive folder automatically"
                  >
                    <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                      <Icon name="cloud" size={12} />
                      {isSidebarOpen ? `Drive · ${driveAccount || 'connected'}` : ''}
                    </span>
                    <button
                      onClick={openDrive}
                      className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline"
                    >
                      Open ↗
                    </button>
                  </div>
                ) : (
                  onConnectDrive && (
                    <button
                      onClick={onConnectDrive}
                      className={`w-full text-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors flex items-center justify-center gap-1 ${
                        !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                      }`}
                      title="Connect Google Drive so uploaded images/documents are automatically renamed and saved to your Drive folder"
                    >
                      <Icon name="cloud" size={14} /> {isSidebarOpen ? 'Connect Drive' : ''}
                    </button>
                  )
                )}
                <button
                  onClick={handlePrint}
                  className={`w-full text-center bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors flex items-center justify-center gap-1 ${
                    !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                  }`}
                  title="Print / Export PDF"
                >
                  <Icon name="printer" size={14} /> {isSidebarOpen ? 'Print / Export PDF' : ''}
                </button>

                {/* Load HTML + Save HTML — superuser only */}
                {currentUser?.role === 'superuser' && (
                  <div className={`flex ${isSidebarOpen ? 'gap-2' : 'flex-col gap-2 w-full'}`}>
                    <label
                      className={`flex-1 text-center bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold py-1.5 rounded text-xs cursor-pointer shadow-sm transition-colors ${
                        !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                      }`}
                      title="Load HTML"
                    >
                      {isSidebarOpen ? '📂 Load HTML' : '📂'}
                      <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                    </label>

                    <button
                      onClick={exportHTML}
                      className={`flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors ${
                        !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                      }`}
                      title="Save HTML"
                    >
                      {isSidebarOpen ? '💾 Save HTML' : '💾'}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-center mt-2">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex === 0}
                  className={`p-2 rounded border shadow-sm transition-colors ${
                    historyIndex > 0
                      ? 'bg-white hover:bg-slate-50 text-slate-700'
                      : 'bg-slate-50 text-slate-300'
                  }`}
                  title="Undo"
                >
                  ↩
                </button>

                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= historyRef.current.length - 1}
                  className={`p-2 rounded border shadow-sm transition-colors ${
                    historyIndex < historyRef.current.length - 1
                      ? 'bg-white hover:bg-slate-50 text-slate-700'
                      : 'bg-slate-50 text-slate-300'
                  }`}
                  title="Redo"
                >
                  ↪
                </button>
              </div>
            </div>
          </div>
);
};
