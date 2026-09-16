/* =========================================================================
   src/utils/nextcloud.js
   Nextcloud (WebDAV) cloud backend for the app + the GLOBAL storage-provider
   switch (Google Drive ⇄ Nextcloud).

   Nextcloud exposes files over WebDAV at:
       <server>/remote.php/dav/files/<user>/<path>
   with HTTP Basic auth (username + an “App password” created in
   Nextcloud → Settings → Security → App passwords).

   ⚠ IMPORTANT browser constraint: the Nextcloud server must answer CORS
   preflight requests from the app origin (OPTIONS + Authorization + PUT /
   MKCOL / PROPFIND …). If your Nextcloud does not allow that, the browser
   silently blocks every request. Use testNextcloud() in the Settings page to
   find out.

   Nothing in this module imports other app modules (it is the leaf of the
   storage stack), so both driveUpload.js and figuresLibrary.js can depend on
   it without creating import cycles.
   ========================================================================= */

const PROVIDER_KEY = 'labCloudProvider';           // 'google' | 'nextcloud'
const NC_URL_KEY = 'labNcServer';
const NC_USER_KEY = 'labNcUser';
const NC_PASS_KEY = 'labNcAppPassword';

export const getCloudProvider = () => {
  try { return localStorage.getItem(PROVIDER_KEY) === 'nextcloud' ? 'nextcloud' : 'google'; } catch { return 'google'; }
};
export const setCloudProvider = (provider) => {
  try { localStorage.setItem(PROVIDER_KEY, provider === 'nextcloud' ? 'nextcloud' : 'google'); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('lab:cloud-provider-changed', { detail: getCloudProvider() })); } catch { /* ignore */ }
};

export const getNextcloudConfig = () => {
  try {
    return {
      url: String(localStorage.getItem(NC_URL_KEY) || '').trim().replace(/\/+$/, ''),
      user: String(localStorage.getItem(NC_USER_KEY) || '').trim(),
      password: String(localStorage.getItem(NC_PASS_KEY) || '')
    };
  } catch { return { url: '', user: '', password: '' }; }
};

export const saveNextcloudConfig = ({ url = '', user = '', password = '' }) => {
  try {
    localStorage.setItem(NC_URL_KEY, String(url || '').trim().replace(/\/+$/, ''));
    localStorage.setItem(NC_USER_KEY, String(user || '').trim());
    localStorage.setItem(NC_PASS_KEY, String(password || ''));
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('lab:cloud-provider-changed', { detail: getCloudProvider() })); } catch { /* ignore */ }
};

export const clearNextcloudConfig = () => {
  try {
    localStorage.removeItem(NC_URL_KEY);
    localStorage.removeItem(NC_USER_KEY);
    localStorage.removeItem(NC_PASS_KEY);
  } catch { /* ignore */ }
};

/** True when a Nextcloud server/user/password are configured (even if the
 *  server itself is unreachable — that is detected by testNextcloud). */
export const nextcloudConfigured = () => {
  const c = getNextcloudConfig();
  return !!(c.url && c.user && c.password);
};

export const nextcloudDavBase = () => {
  const c = getNextcloudConfig();
  if (!c.url || !c.user) return '';
  return `${c.url}/remote.php/dav/files/${encodeURIComponent(c.user)}`;
};

export const isNextcloudUrl = (url) => /\/remote\.php\/dav\//i.test(String(url || ''));

const authHeaders = () => {
  const c = getNextcloudConfig();
  return { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${c.user}:${c.password}`))) };
};

const enc = (segment) => encodeURIComponent(String(segment).replace(/^\//, ''));

/** Run a WebDAV request against the configured Nextcloud. Throws a friendly
 *  Error when the browser cannot reach it (CORS / network / auth). */
export const ncRequest = async (method, davUrl, { headers = {}, body = null, timeout = 120000 } = {}) => {
  const c = getNextcloudConfig();
  if (!c.url || !c.user || !c.password) throw new Error('Nextcloud is not configured.');
  let res;
  try {
    res = await fetch(davUrl, {
      method,
      headers: { ...authHeaders(), ...headers },
      body,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    const msg = (err && err.name === 'AbortError')
      ? 'Nextcloud request timed out.'
      : (err && err.message && /Failed to fetch|NetworkError|load failed/i.test(err.message))
        ? 'Nextcloud blocked by the browser (CORS / network). Ask your Nextcloud admin to allow this app origin, then retry.'
        : String((err && err.message) || err);
    throw new Error(msg);
  }
  return res;
};

/** Read oc:fileid from a PROPFIND multistatus response (Nextcloud). */
const fileIdFromXml = (xml) => {
  const m = String(xml || '').match(/<oc:fileid>(\d+)<\/oc:fileid>/i);
  return m && m[1] ? m[1] : '';
};

/** PROPFIND depth 0 → { found, fileId }. */
const propfind = async (davUrl) => {
  const res = await ncRequest('PROPFIND', davUrl, { headers: { Depth: '0' } });
  if (res.status === 207 || res.status === 200) {
    const xml = await res.text();
    return { found: true, fileId: fileIdFromXml(xml) };
  }
  if (res.status === 404) return { found: false, fileId: '' };
  if (res.status === 401 || res.status === 403) throw new Error('Nextcloud authentication failed — check the username and app password.');
  throw new Error(`Nextcloud answered ${res.status} on ${davUrl}.`);
};

/** Create every missing folder along `parts` (relative to the user's DAV root)
 *  and return the DAV URL of the leaf folder. */
export const ncEnsureFolders = async (parts) => {
  const base = nextcloudDavBase();
  if (!base) throw new Error('Nextcloud is not configured.');
  let cur = base;
  for (const p of (parts || [])) {
    const seg = String(p).trim();
    if (!seg) continue;
    cur = `${cur}/${enc(seg)}`;
    const check = await propfind(cur);
    if (check.found) continue;
    try {
      const mk = await ncRequest('MKCOL', cur, {});
      if (!(mk.status === 201 || mk.status === 204 || mk.status === 405)) {
        throw new Error(`Could not create the folder “${seg}” (Nextcloud answered ${mk.status}).`);
      }
    } catch (err) {
      if (err && err.message && /authentication failed/i.test(err.message)) throw err;
      const again = await propfind(cur);
      if (!again.found) throw err;
    }
  }
  return cur;
};



/**
 * Upload a file (Blob/File or data URL) into `parts` folders on Nextcloud.
 * Returns a Drive-like object so callers can keep using the same shape:
 *   { id, name, url (dav URL), driveUrl (web link), webLink }
 */
export const ncUploadFile = async ({ parts = [], name = 'file', mimeType = 'application/octet-stream', file }) => {
  if (!name || !file) return null;
  const leaf = await ncEnsureFolders(parts);
  const davUrl = `${leaf}/${enc(name)}`;
  let blob = file;
  if (typeof file === 'string') {
    const m = String(file).match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    const mime = mimeType || (m ? m[1] : 'application/octet-stream');
    if (m && m[2]) {
      const bin = atob(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: mime });
    } else if (m) {
      blob = new Blob([decodeURIComponent(m[3])], { type: mime });
    } else {
      blob = new Blob([file], { type: mimeType });
    }
  }
  const type = mimeType || blob.type || 'application/octet-stream';
  const res = await ncRequest('PUT', davUrl, {
    headers: { 'Content-Type': type },
    body: blob,
    timeout: 10 * 60 * 1000
  });
  if (res.status !== 201 && res.status !== 204 && res.status !== 200) {
    throw new Error(`Nextcloud refused the upload (${res.status}).`);
  }
  const info = await propfind(davUrl);
  const id = info.fileId || `nc_${Date.now().toString(36)}`;
  const cfg = getNextcloudConfig();
  const webLink = cfg.url && info.fileId ? `${cfg.url}/f/${info.fileId}` : davUrl;
  return { id: String(id), name: String(name), url: davUrl, driveUrl: webLink, webLink };
};

/** Delete a single file/folder given its DAV URL (true when gone). */
export const ncDelete = async (davUrl) => {
  if (!davUrl) return false;
  try {
    const res = await ncRequest('DELETE', davUrl, {});
    return res.status === 204 || res.status === 200 || res.status === 404;
  } catch { return false; }
};

/**
 * Rename / move a file or folder (WebDAV MOVE): `fromUrl` becomes `toUrl`.
 * Used by the Drive mirror so a dataset or project RENAME is reflected on
 * Nextcloud exactly like on Google Drive (never a second folder beside the
 * old one). Returns true when the move happened (or was already done).
 */
export const ncMove = async (fromUrl, toUrl) => {
  if (!fromUrl || !toUrl || fromUrl === toUrl) return false;
  try {
    const res = await ncRequest('MOVE', fromUrl, {
      headers: { Destination: toUrl, Overwrite: 'F' }
    });
    return res.status === 201 || res.status === 204 || res.status === 207;
  } catch { return false; }
};

/** Fetch a Nextcloud DAV URL's bytes (with the configured Basic auth). Returns
 *  a Blob, or null when unreachable. */
export const ncFetchBlob = async (davUrl) => {
  try {
    const res = await ncRequest('GET', davUrl, {});
    if (!res.ok) return null;
    return await res.blob();
  } catch { return null; }
};

/**
 * End-to-end connectivity test used by the Settings page:
 *   1. PROPFIND the user root (authentication)
 *   2. MKCOL a probe folder + DELETE it (write permission + CORS)
 * Returns { ok, msg } with a human-readable explanation.
 */
export const testNextcloud = async ({ url = '', user = '', password = '' } = {}) => {
  saveNextcloudConfig({ url, user, password });
  try {
    const base = nextcloudDavBase();
    if (!base) return { ok: false, msg: 'Missing server URL, username or password.' };
    const probe = await propfind(base);
    if (!probe.found) return { ok: false, msg: 'The user root folder was not found on this server.' };
    const probeName = `appProbe_${Date.now()}`;
    const mk = await ncRequest('MKCOL', `${base}/${enc(probeName)}`, {});
    if (mk.status === 201 || mk.status === 204 || mk.status === 405) {
      await ncDelete(`${base}/${enc(probeName)}`);
    } else {
      return { ok: false, msg: `Authentication works, but creating folders is blocked (Nextcloud answered ${mk.status}).` };
    }
    return { ok: true, msg: 'Connected to Nextcloud — authentication and file creation work.' };
  } catch (err) {
    return { ok: false, msg: String((err && err.message) || err) };
  }
};
