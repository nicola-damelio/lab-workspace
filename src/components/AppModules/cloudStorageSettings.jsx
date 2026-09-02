/* =========================================================================
   src/components/AppModules/cloudStorageSettings.jsx
   Settings → Cloud storage: choose the global storage provider
   (Google Drive ⇄ Nextcloud) and configure / test the Nextcloud connection.
   ========================================================================= */

import React, { useState } from 'react';
import { getDriveToken } from '../../utils/driveUpload';
import {
  getCloudProvider, setCloudProvider,
  getNextcloudConfig, testNextcloud, nextcloudConfigured
} from '../../utils/nextcloud';

export const CloudStorageSettings = () => {
  const initial = getNextcloudConfig();
  const [provider, setProvider] = useState(getCloudProvider());
  const [url, setUrl] = useState(initial.url || 'https://extra.u-picardie.fr/nextcloud');
  const [user, setUser] = useState(initial.user);
  const [password, setPassword] = useState(initial.password);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, msg }
  const [saved, setSaved] = useState(nextcloudConfigured());

  const chooseProvider = (p) => {
    setProvider(p);
    setCloudProvider(p);
  };

  const handleSaveTest = async () => {
    setBusy(true);
    setResult(null);
    const r = await testNextcloud({ url, user, password });
    setResult(r);
    setSaved(nextcloudConfigured());
    setBusy(false);
  };

  const inputCls = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 w-full';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-slate-500 uppercase">Where do files go?</span>
        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" onClick={() => chooseProvider('google')}
            className={`flex-1 text-left border-2 rounded-xl px-4 py-3 transition-colors ${provider === 'google' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}>
            <span className="flex items-center gap-2 font-bold text-sm text-slate-800"><span className="text-lg">☁️</span> Google Drive</span>
            <span className="text-xs text-slate-500 mt-1 block">
              {getDriveToken()
                ? 'Connected via Google (OAuth). Files go to Lab Workspace → dataset → …'
                : 'Not connected — use “Connect Google Drive” in the sidebar.'}
            </span>
          </button>
          <button type="button" onClick={() => chooseProvider('nextcloud')}
            className={`flex-1 text-left border-2 rounded-xl px-4 py-3 transition-colors ${provider === 'nextcloud' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-300'}`}>
            <span className="flex items-center gap-2 font-bold text-sm text-slate-800"><span className="text-lg">🗂️</span> Nextcloud</span>
            <span className="text-xs text-slate-500 mt-1 block">
              {saved ? 'Configured (server/user set).' : 'Enter your UPJV Nextcloud details below.'}
            </span>
          </button>
        </div>
      </div>

      {provider === 'nextcloud' && (
        <div className="flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
          <span className="text-xs font-bold text-slate-500 uppercase">Nextcloud connection (WebDAV)</span>

          <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
            Server URL
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://extra.u-picardie.fr/nextcloud" />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              Username
              <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)}
                placeholder="your UPJV username" autoComplete="username" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              App password
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Nextcloud → Security → App passwords" autoComplete="current-password" />
            </label>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Create an <b>app password</b> in Nextcloud (Settings → Security → App passwords) and use it here —
            never your account password. It stays in your browser, like the Google Drive token.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={handleSaveTest} disabled={busy || !url || !user || !password}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-sm">
              {busy ? 'Testing connection…' : 'Save & test connection'}
            </button>
            {result && (
              <span className={`text-sm font-bold ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                {result.ok ? '✅ ' : '⚠️ '}{result.msg}
              </span>
            )}
          </div>

          {!saved && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              ⚠️ Browser security (CORS): your Nextcloud must allow this app to call its WebDAV API from the app's origin.
              If the test fails with “blocked by the browser / CORS”, ask the UPJV administrator to allow this app origin.
            </p>
          )}
        </div>
      )}


      {provider === 'google' && (
        <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-3">
          Uploads use your Google account (connect it with <b>“Connect Google Drive”</b> in the sidebar). Files are stored
          under <b>Lab Workspace → dataset → project/test/section</b>. Switching back to Google Drive restores this behaviour.
        </p>
      )}
    </div>
  );
};

export default CloudStorageSettings;

