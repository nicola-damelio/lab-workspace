// components/MicroscopySections.jsx
import React, { useState, useRef, useEffect } from 'react';
import { CollapsibleSection } from './ui';
import { PLATES_DEF } from '../data/constants';
import { uploadLocalFile, withExtension, getDriveToken } from '../utils/driveUpload';
import { blobStore } from '../utils/blobStore';
import { suggestDriveFileName } from '../utils/driveNaming';
import { restoreRawFileFor } from '../utils/driveRestore';
import { useDriveAutoRestore } from './useDriveAutoRestore';
import { ExperimentalSetup as FCExperimentalSetup } from './FlowCytometrySections';

// The microscopy Experimental Setup reuses the Flow Cytometry plate design
// (interactive table + plate map + regions).
export const ExperimentalSetup = FCExperimentalSetup;

const MICROSCOPY_TYPE_OPTIONS = ['Confocal', 'Fluorescence', 'Electron', 'Light', 'Brightfield', 'Time Lapse', 'Other'];

// Heuristic: infer the microscope type from a file name.
const inferMicroscopyType = (name) => {
  const n = String(name || '').toLowerCase();
  if (/(confocal|lsm|sp8|sp5|stella|fv1000|fv3000)/.test(n)) return 'Confocal';
  if (/(electron|sem|tem|semd|em\b)/.test(n)) return 'Electron';
  if (/(fluorescen|fluo|dapi|fitc|trifc|gfp|cy3|cy5|rhodamine|alexa)/.test(n)) return 'Fluorescence';
  if (/(brightfield|bright-field|phase\b)/.test(n)) return 'Brightfield';
  if (/(timelapse|time.lapse|kinetic)/.test(n)) return 'Time Lapse';
  return '';
};

const msVideoKey = (id) => `msv_${id}`;
const msMovieKey = (id) => `msm_${id}`;

/* ── RESTAURATION AUTOMATIQUE DES MÉDIAS DE MICROSCOPIE DEPUIS LE DRIVE ─────
   (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
   Une vidéo de microscope n'entre PAS dans le document du dataset : seul son
   nom y vit (`msVideos`, `msMovies`), les octets sont dans la base du
   navigateur (blobStore → IndexedDB) — donc sur le poste qui a importé, et
   nulle part ailleurs. Le Drive est la copie de RÉFÉRENCE : chaque média
   archivé à l'import laisse un POINTEUR minuscule (`drive = { id, name, url }`)
   dans la liste, qui voyage avec le dataset ; à l'ouverture de la page, un
   média absent de la base du navigateur est re-téléchargé TOUT SEUL (id exact,
   sinon recherche par NOM sur le Drive) et remis dans la base. Rien à demander
   à l'utilisateur : c'est le fonctionnement normal depuis un autre poste.

   Un média n'est pas un spectre : il n'y a rien à archiver en JSON — c'est le
   FICHIER envoyé au Drive qui fait référence (voir restoreRawFileFor). */
const MS_VIDEO_KIND = 'msvideo';
const MS_MOVIE_KIND = 'msmovie';

/** Dossier de la copie de référence : le dossier canonique de l'expérience,
 *  dans la même sous-section que les fichiers envoyés à l'import. */
const msDriveCtx = (test = {}, section = 'Data') => ({
  project: (test.projectNames && test.projectNames[0]) || '',
  test: test.name || '',
  instance: test.instanceName || '',
  scientist: test.operator || '',
  section,
  subsection: 'Microscopy'
});

/** Pointeur minuscule (il voyage dans le dataset) vers la copie Drive d'un
 *  média — null quand l'envoi n'a pas abouti (hors ligne : la recherche par nom
 *  le retrouvera dès que la file de reprise l'aura déposé). */
const msMediaPointer = (res, fallbackName = '') => (
  res && (res.id || res.url || res.driveUrl)
    ? {
      id: String(res.id || ''),
      name: String(res.name || fallbackName || ''),
      url: String(res.url || res.driveUrl || '')
    }
    : null
);

/** Noms sous lesquels chercher un média : le pointeur, le nom déclaré à l'envoi,
 *  puis le nom d'origine du fichier importé. */
const msMediaNames = (entry = {}) => [entry.drive?.name, entry.driveName, entry.filename].filter(Boolean);

/** Nom d'un clip créé dans « Data Analysis » : les anciens n'ont que leurs
 *  métadonnées, le nom se recalcule — c'est celui utilisé à l'envoi. */
const msMovieNames = (movie = {}) => {
  const direct = msMediaNames(movie);
  if (direct.length) return direct;
  const srcBase = String(movie.source || 'clip').replace(/\.[^/.]+$/, '');
  return [`movie_${srcBase}_${movie.start}s-${movie.end}s.webm`];
};

/** Vrai dès qu'un média de la liste n'est pas dans la base du navigateur :
 *  c'est le signal de départ de la restauration. */
const msMediaMissing = async (entries = [], keyOf) => {
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    if (!(await blobStore.load(keyOf(entry)))) return true;
  }
  return false;
};

/** Re-télécharge du Drive les médias absents de la base du navigateur et les y
 *  remet : `{ restored, missing }` — `missing` = ce qui n'existe plus sur le
 *  Drive non plus (on le DIT, au lieu de laisser une vignette vide). */
const msRestoreMedia = async ({ entries = [], keyOf, namesOf, ctx }) => {
  let restored = 0;
  let missing = 0;
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    if (await blobStore.load(keyOf(entry))) continue;
    const found = await restoreRawFileFor({
      pointer: entry.drive || null, ctx, names: namesOf(entry)
    });
    if (!found) { missing += 1; continue; }
    await blobStore.save(keyOf(entry), found.file);
    restored += 1;
  }
  return { restored, missing };
};

// ---------------------------------------------------------------------------
// INSTRUMENTAL SETUP — microscope-specific fields (type from a dropdown,
// plus the other acquisition parameters). Fields autofill when a video file
// is read in the Data section.
// ---------------------------------------------------------------------------
export const InstrumentalSetup = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
  const t = activeTest;

  const fields = [
    { key: 'microscopyType', label: 'Microscope Type', type: 'select' },
    { key: 'microscopeModel', label: 'Microscope Model', type: 'text', placeholder: 'e.g. Zeiss LSM 980' },
    { key: 'objective', label: 'Objective', type: 'text', placeholder: 'e.g. 40x / 1.30 Oil' },
    { key: 'laserLines', label: 'Laser Lines', type: 'text', placeholder: 'e.g. 405, 488, 561, 640 nm' },
    { key: 'detector', label: 'Detector', type: 'text', placeholder: 'e.g. GaAsP PMT' },
    { key: 'filterCubes', label: 'Filter Cubes / Emission', type: 'text', placeholder: 'e.g. DAPI, FITC, TRITC' },
    { key: 'magnification', label: 'Magnification', type: 'text', placeholder: 'e.g. 200x' },
    { key: 'acquisitionSoftware', label: 'Acquisition Software', type: 'text', placeholder: 'e.g. ZEN, LAS X' },
    { key: 'plateName', label: 'Plate Name / ID', type: 'text', placeholder: 'e.g. 96 Well - Flat bottom' },
    { key: 'wellId', label: 'Well ID', type: 'text', placeholder: 'e.g. H01' }
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-slate-500">
        Acquisition settings for this microscopy experiment. Fields are filled in automatically
        from the uploaded video file names where possible.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">{f.label}</label>
            {f.type === 'select' ? (
              <select
                value={t[f.key] || ''}
                onChange={(e) => update({ [f.key]: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
              >
                <option value="">Select…</option>
                {MICROSCOPY_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={t[f.key] || ''}
                onChange={(e) => update({ [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
// ---------------------------------------------------------------------------
// DATA — read WMV / MP4 / WebM / MOV / AVI microscopy videos. Files are kept in
// the browser (IndexedDB) and archived to Google Drive; playback is attempted
// with the native <video> element. Reading a file also autofills instrumental
// fields.
// ---------------------------------------------------------------------------
export const Data = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
  const t = activeTest;
  const [msg, setMsg] = useState('');
  const [videos, setVideos] = useState([]);
  // Incrémenté quand un média restauré du Drive vient d'être remis dans la base
  // du navigateur : les vignettes relisent alors leur blob (voir VideoCard).
  const [cacheEpoch, setCacheEpoch] = useState(0);

  useEffect(() => {
    setVideos(Array.isArray(t.msVideos) ? t.msVideos : []);
  }, [t.id, t.msVideos]);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (e.target.value) e.target.value = '';
    setMsg(`Reading ${files.length} microscope video file(s)…`);
    const added = [];
    let driveSaved = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = 'msv' + Date.now() + i + Math.random().toString(36).slice(2, 6);
      const name = file.name || 'video.mp4';
      const entry = { id, filename: name, type: file.type || 'application/octet-stream', size: file.size, uploadedAt: Date.now() };
      await blobStore.save(msVideoKey(id), file);
      // Le nom déclaré à l'envoi est retenu MÊME quand l'envoi échoue : c'est
      // lui que la restauration cherchera sur le Drive (recherche par nom).
      const driveCtx = msDriveCtx(t, 'Data');
      const base = String(name).replace(/\.[^/.]+$/, '');
      const driveName = withExtension(suggestDriveFileName({ ...driveCtx, title: base }), name);
      let drive = null;
      if (getDriveToken()) {
        try {
          const res = await uploadLocalFile({
            name: driveName,
            mimeType: file.type || 'application/octet-stream',
            file,
            ctx: driveCtx
          });
          drive = msMediaPointer(res, driveName);
          driveSaved++;
        } catch { /* keep going */ }
      }
      // Le pointeur (minuscule) part avec le dataset : c'est lui qui ramène la
      // vidéo sur un autre poste (voir la restauration automatique plus bas).
      added.push({ ...entry, driveName, ...(drive ? { drive } : {}) });
      const inferred = inferMicroscopyType(name);
      if (inferred) update({ microscopyType: t.microscopyType || inferred });
    }
    const next = [...(Array.isArray(t.msVideos) ? t.msVideos : []), ...added];
    update({ msVideos: next });
    setVideos(next);
    setMsg(`✅ ${added.length} video file(s) read${driveSaved ? ` — ${driveSaved} archived to Google Drive.` : '.'}`);
  };

  const removeVideo = async (vid) => {
    await blobStore.remove(msVideoKey(vid.id));
    const next = (t.msVideos || []).filter((v) => v.id !== vid.id);
    update({ msVideos: next });
    setVideos(next);
  };

  // Transcode a WMV (or any undecodable format) to MP4/H.264 in the browser
  // using ffmpeg.wasm, served from the app's OWN origin (public/vendor/ffmpeg).
  // This matters: @ffmpeg/ffmpeg spawns a Web Worker from worker.js, and
  // browsers block workers from a different origin (e.g. a CDN) — the whole
  // ffmpeg package + core are vendored here so the worker is same-origin and
  // the conversion even works offline.
  const convertVideoToMp4 = async (blob) => {
    // eslint-disable-next-line no-undef
    const { FFmpeg } = await import(/* @vite-ignore */ '/vendor/ffmpeg/ffmpeg/index.js');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: '/vendor/ffmpeg/core/ffmpeg-core.js',
      wasmURL: '/vendor/ffmpeg/core/ffmpeg-core.wasm'
    });
    await ffmpeg.writeFile('input.video', new Uint8Array(await blob.arrayBuffer()));
    await ffmpeg.exec(['-i', 'input.video', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', 'output.mp4']);
    const data = await ffmpeg.readFile('output.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  };

  const handleConvertVideo = async (vid, onStatus) => {
    try {
      const blob = await blobStore.load(msVideoKey(vid.id));
      if (!blob) { onStatus('❌ Original file not found in the browser cache.'); return; }
      onStatus('⬇️ Loading the converter…');
      const mp4 = await convertVideoToMp4(blob);
      if (!mp4 || mp4.size < 1000) { onStatus('❌ Conversion produced an empty file.'); return; }
      const id = 'msv' + Date.now() + Math.random().toString(36).slice(2, 6);
      const name = String(vid.filename || 'video').replace(/\.[^/.]+$/, '') + '_converted.mp4';
      const entry = { id, filename: name, type: 'video/mp4', size: mp4.size, uploadedAt: Date.now(), convertedFrom: vid.filename };
      await blobStore.save(msVideoKey(id), mp4);
      const driveCtx = msDriveCtx(t, 'Data');
      const base = String(name).replace(/\.[^/.]+$/, '');
      const driveName = withExtension(suggestDriveFileName({ ...driveCtx, title: base }), name);
      let drive = null;
      if (getDriveToken()) {
        try {
          const res = await uploadLocalFile({
            name: driveName,
            mimeType: 'video/mp4', file: mp4,
            ctx: driveCtx
          });
          drive = msMediaPointer(res, driveName);
        } catch { /* keep going */ }
      }
      const next = [...(Array.isArray(t.msVideos) ? t.msVideos : []), { ...entry, driveName, ...(drive ? { drive } : {}) }];
      update({ msVideos: next });
      setVideos(next);
      onStatus(`✅ Converted to MP4 — "${name}" is now playable and available in the movie maker.`);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      onStatus(`❌ Conversion failed (${msg}). If this keeps happening, download the .wmv from Drive and convert it outside the app, then re-upload the .mp4.`);
    }
  };

  // ── RESTAURATION AUTOMATIQUE DES VIDÉOS DEPUIS LE DRIVE ──────────────────
  // (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
  // La liste `msVideos` voyage avec le dataset — pas les octets. Sur un autre
  // poste (ou après un nettoyage), chaque vidéo absente de la base du
  // navigateur est donc re-téléchargée du Drive TOUTE SEULE et remise dans la
  // base : la vignette redevient jouable sans qu'on demande rien.
  const videosMissing = () => msMediaMissing(
    Array.isArray(t.msVideos) ? t.msVideos : [], (v) => msVideoKey(v.id)
  );

  const restoreVideosFromDrive = async () => {
    const list = Array.isArray(t.msVideos) ? t.msVideos : [];
    const { restored, missing } = await msRestoreMedia({
      entries: list, keyOf: (v) => msVideoKey(v.id), namesOf: msMediaNames, ctx: msDriveCtx(t, 'Data')
    });
    if (restored) setCacheEpoch((n) => n + 1);
    if (!restored) {
      return {
        ok: false,
        message: '⚠️ These videos are not on this machine and no copy was found on Google Drive. Connect Google Drive, then re-upload the files: each one is archived on import.'
      };
    }
    return {
      ok: missing === 0,
      message: missing
        ? `✅ ${restored} video file(s) restored from Google Drive — ${missing} not found there (re-upload ${missing > 1 ? 'them' : 'it'}).`
        : `✅ ${restored} video file(s) restored from Google Drive.`
    };
  };

  const msVideoRestore = useDriveAutoRestore({
    kind: MS_VIDEO_KIND,
    testId: t.id || 'global',
    missing: videosMissing,
    restore: restoreVideosFromDrive
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="bg-indigo-50 border border-indigo-300 hover:bg-indigo-100 text-indigo-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors">
          🎬 Choose microscope video file(s) (.wmv, .mp4, .webm, .mov, .avi)…
          <input type="file" accept=".wmv,.mp4,.webm,.mov,.avi,video/*" multiple onChange={handleFiles} className="hidden" />
        </label>
        {msg && <span className="text-xs font-bold text-indigo-900">{msg}</span>}
        {/* Restauration automatique depuis le Drive (voir MS_VIDEO_KIND en tête
            de ce fichier) : les octets d'une vidéo vivent dans la base du
            navigateur, pas dans le document — depuis un autre poste elles
            reviennent TOUTES SEULES. Ce bouton n'est qu'un secours manuel. */}
        <button
          type="button"
          onClick={() => msVideoRestore.attempt('manual')}
          disabled={msVideoRestore.status === 'restoring'}
          title="Download the archived copy of these videos from Google Drive (each file is archived there on import) — it also happens by itself when the page opens"
          className="ml-auto text-[10px] font-bold bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-2 py-1.5 rounded-lg shadow-sm disabled:opacity-50"
        >
          {msVideoRestore.status === 'restoring' ? '⬇️ Downloading…' : '⬇️ Restore from Drive'}
        </button>
        {(msVideoRestore.status === 'restoring' || msVideoRestore.message) && (
          <span className={`text-[10px] font-semibold rounded-lg px-3 py-1.5 border ${msVideoRestore.status === 'restored'
            ? 'bg-green-50 border-green-200 text-green-800'
            : msVideoRestore.status === 'failed'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'}`}>
            {msVideoRestore.message || 'Checking Google Drive…'}
          </span>
        )}
      </div>
      {videos.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-400">
          No microscope videos yet — upload a .wmv / .mp4 / .webm file above.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} reloadKey={cacheEpoch} onRemove={() => removeVideo(v)} onConvert={(status) => handleConvertVideo(v, status)} />
          ))}
        </div>
      )}
    </div>
  );
};
// Small card showing a video file with a playable preview (object URL from the
// IndexedDB blob). WMV is usually not decodable by the browser — the card
// explains that and the movie maker stays disabled for it.
// `reloadKey` change (une restauration depuis le Drive) force la relecture du
// blob : le même fichier revient, mais cette fois depuis la base du navigateur.
const VideoCard = ({ video, onRemove, onConvert, reloadKey = 0 }) => {
  const [url, setUrl] = useState(null);
  const [playable, setPlayable] = useState(null);
  const [convStatus, setConvStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    let u = null;
    (async () => {
      const blob = await blobStore.load(msVideoKey(video.id));
      if (cancelled || !blob) return;
      u = URL.createObjectURL(blob);
      setUrl(u);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = u;
      v.onloadeddata = () => { if (!cancelled) setPlayable(true); };
      v.onerror = () => { if (!cancelled) setPlayable(false); };
    })();
    return () => { cancelled = true; if (u) URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, reloadKey]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700 truncate" title={video.filename}>{video.filename}</span>
        <button type="button" onClick={onRemove} className="text-slate-400 hover:text-red-500 font-black shrink-0" title="Remove video">×</button>
      </div>
      {url ? (
        <video src={url} controls className="w-full rounded-lg bg-slate-900 aspect-video object-contain" />
      ) : (
        <div className="aspect-video bg-slate-100 rounded-lg flex items-center justify-center text-[11px] text-slate-400">Loading…</div>
      )}
      <p className={`text-[10px] font-bold ${playable === false ? 'text-amber-700' : 'text-slate-400'}`}>
        {playable === false
          ? 'This format (e.g. .wmv) is not decodable by the browser — convert it below to use the movie maker.'
          : `${video.type} · ${video.size ? Math.round(video.size / 1024) + ' KB' : ''}`}
      </p>
      {playable === false && (
        <>
          <button
            type="button"
            onClick={() => { setConvStatus('⬇️ Loading the converter…'); onConvert(setConvStatus); }}
            disabled={!!convStatus}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm"
          >
            🔄 Convert to MP4 (H.264)
          </button>
          {convStatus && <p className="text-[10px] font-bold text-indigo-800">{convStatus}</p>}
        </>
      )}
    </div>
  );
};
// ---------------------------------------------------------------------------
// DATA ANALYSIS — make a movie from a selected region (time range) of a
// microscope video. Frames are drawn to a canvas and encoded to a .webm clip
// with MediaRecorder; the clip is saved in the browser + Drive.
// ---------------------------------------------------------------------------
export const DataAnalysis = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
  const t = activeTest;
  const videos = Array.isArray(t.msVideos) ? t.msVideos : [];
  const movies = Array.isArray(t.msMovies) ? t.msMovies : [];

  const [selId, setSelId] = useState(videos.length ? videos[0].id : '');
  const [url, setUrl] = useState(null);
  const [dur, setDur] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fps, setFps] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [playable, setPlayable] = useState(null);
  // Incrémenté quand un clip restauré du Drive vient d'être remis dans la base
  // du navigateur (voir la restauration automatique plus bas).
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);

  const selVideo = videos.find((v) => v.id === selId) || null;

  useEffect(() => {
    if (!selVideo) { setUrl(null); setDur(0); setPlayable(null); return; }
    let cancelled = false;
    let u = null;
    (async () => {
      const blob = await blobStore.load(msVideoKey(selVideo.id));
      if (cancelled || !blob) return;
      u = URL.createObjectURL(blob);
      setUrl(u);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = u;
      v.onloadedmetadata = () => {
        if (cancelled) return;
        setDur(v.duration || 0);
        setEnd(v.duration || 0);
        setStart(0);
        setPlayable(true);
      };
      v.onerror = () => { if (!cancelled) setPlayable(false); };
    })();
    return () => { cancelled = true; if (u) URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, cacheEpoch]);

  const createMovie = async () => {
    const vid = videoRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas || !selVideo) return;
    const s = Math.max(0, Number(start) || 0);
    const e = Math.min(dur || 0, Number(end) || 0);
    if (e - s <= 0) { setMsg('⚠️ Choose a valid time range (start < end).'); return; }
    const FPS = Math.min(30, Math.max(1, Number(fps) || 10));
    setBusy(true);
    setMsg('🎥 Creating movie…');
    try {
      const W = 640, H = 360;
      canvas.width = W; canvas.height = H;
      const c2 = canvas.getContext('2d');
      const stream = canvas.captureStream(FPS);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.start();
      const totalFrames = Math.max(1, Math.round((e - s) * FPS));
      for (let i = 0; i < totalFrames; i++) {
        vid.currentTime = Math.min(e, s + i / FPS);
        await new Promise((res) => { vid.onseeked = res; });
        c2.drawImage(vid, 0, 0, W, H);
        await new Promise((r) => setTimeout(r, 1000 / FPS));
      }
      rec.stop();
      const blob = await new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
      const id = 'msm' + Date.now();
      const srcBase = String((selVideo && selVideo.filename) || 'clip').replace(/\.[^/.]+$/, '');
      const driveCtx = msDriveCtx(t, 'Data Analysis');
      const driveName = withExtension(suggestDriveFileName({ ...driveCtx, title: `movie_${srcBase}_${s}s-${e}s` }), 'movie.webm');
      const movieMeta = { id, sourceId: selVideo.id, source: selVideo.filename, start: s, end: e, fps: FPS, createdAt: Date.now(), filename: driveName };
      await blobStore.save(msMovieKey(id), blob);
      if (getDriveToken()) {
        try {
          const res = await uploadLocalFile({
            name: driveName,
            mimeType: 'video/webm', file: blob,
            ctx: driveCtx
          });
          // Pointeur minuscule : il part avec le dataset et ramène le clip sur
          // un autre poste (voir MS_MOVIE_KIND en tête de ce fichier).
          const drive = msMediaPointer(res, driveName);
          if (drive) movieMeta.drive = drive;
        } catch { /* keep going */ }
      }
      update({ msMovies: [...movies, movieMeta] });
      setMsg(`✅ Movie created: ${(e - s).toFixed(1)} s @ ${FPS} fps.`);
    } catch (err) {
      setMsg(`⚠️ Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // ── RESTAURATION AUTOMATIQUE DES CLIPS DEPUIS LE DRIVE ───────────────────
  // (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
  // Un clip fabriqué ici est archivé sur le Drive au moment même où il est
  // créé (titre déterministe `movie_<source>_<début>s-<fin>s`) ET reçoit son
  // pointeur : sur un autre poste, un clip absent de la base du navigateur est
  // donc re-téléchargé TOUT SEUL. Les vidéos source relèvent de la section
  // Data (kind différent) : elles y sont restaurées de la même façon.
  const moviesMissing = () => msMediaMissing(movies, (m) => msMovieKey(m.id));

  const restoreMoviesFromDrive = async () => {
    const { restored, missing } = await msRestoreMedia({
      entries: movies, keyOf: (m) => msMovieKey(m.id), namesOf: msMovieNames, ctx: msDriveCtx(t, 'Data Analysis')
    });
    if (restored) setCacheEpoch((n) => n + 1);
    if (!restored) {
      return {
        ok: false,
        message: '⚠️ These clips are not on this machine and no copy was found on Google Drive. Open the Data section (it restores the source videos), then create the clip again.'
      };
    }
    return {
      ok: missing === 0,
      message: missing
        ? `✅ ${restored} clip(s) restored from Google Drive — ${missing} not found there.`
        : `✅ ${restored} clip(s) restored from Google Drive.`
    };
  };

  const msMovieRestore = useDriveAutoRestore({
    kind: MS_MOVIE_KIND,
    testId: t.id || 'global',
    missing: moviesMissing,
    restore: restoreMoviesFromDrive
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-slate-500">
        Select a time range of a microscope video and create a short movie (.webm) from that region.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select value={selId} onChange={(e) => setSelId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none font-semibold">
          {videos.map((v) => <option key={v.id} value={v.id}>{v.filename}</option>)}
        </select>
        <label className="text-[10px] font-bold text-slate-500">Start (s)
          <input type="number" min="0" step="0.1" value={start} onChange={(e) => setStart(e.target.value)}
            className="ml-1 border border-slate-300 rounded px-1.5 py-1 text-xs w-20 outline-none" /></label>
        <label className="text-[10px] font-bold text-slate-500">End (s)
          <input type="number" min="0" step="0.1" value={end} onChange={(e) => setEnd(e.target.value)}
            className="ml-1 border border-slate-300 rounded px-1.5 py-1 text-xs w-20 outline-none" /></label>
        <label className="text-[10px] font-bold text-slate-500">FPS
          <input type="number" min="1" max="30" step="1" value={fps} onChange={(e) => setFps(e.target.value)}
            className="ml-1 border border-slate-300 rounded px-1.5 py-1 text-xs w-16 outline-none" /></label>
        <button type="button" onClick={createMovie} disabled={busy || !url || !selVideo || playable === false}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">
          {busy ? '🎥 Creating…' : '🎬 Create movie from region'}
        </button>
        {playable === false && (
          <span className="text-[10px] font-bold text-amber-700">
            This video format is not decodable by the browser — convert it to .mp4/.webm to create a movie.
          </span>
        )}
        {msg && <span className="text-xs font-bold text-indigo-900">{msg}</span>}
        {/* Restauration automatique des clips depuis le Drive (voir
            MS_MOVIE_KIND en tête de ce fichier) : un clip vit dans la base du
            navigateur, pas dans le document. Ce bouton n'est qu'un secours. */}
        <button
          type="button"
          onClick={() => msMovieRestore.attempt('manual')}
          disabled={msMovieRestore.status === 'restoring'}
          title="Download the archived copy of these clips from Google Drive (each one is archived there when it is created) — it also happens by itself when the page opens"
          className="text-[10px] font-bold bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-2 py-1.5 rounded-lg shadow-sm disabled:opacity-50"
        >
          {msMovieRestore.status === 'restoring' ? '⬇️ Downloading…' : '⬇️ Restore from Drive'}
        </button>
        {(msMovieRestore.status === 'restoring' || msMovieRestore.message) && (
          <span className={`text-[10px] font-semibold rounded-lg px-3 py-1.5 border ${msMovieRestore.status === 'restored'
            ? 'bg-green-50 border-green-200 text-green-800'
            : msMovieRestore.status === 'failed'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'}`}>
            {msMovieRestore.message || 'Checking Google Drive…'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-slate-900 rounded-xl p-2">
          {url ? (
            <video ref={videoRef} src={url} controls className="w-full rounded-lg aspect-video object-contain" />
          ) : (
            <div className="aspect-video flex items-center justify-center text-[11px] text-slate-400">Select a video</div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-2">
          <canvas ref={canvasRef} className="w-full aspect-video rounded-lg bg-black" />
        </div>
      </div>
      {movies.length > 0 && (
        <div className="mt-2">
          <h5 className="text-xs font-bold text-slate-700 uppercase mb-2">Created movies</h5>
          <div className="flex flex-wrap gap-3">
            {movies.map((m) => (
              <div key={m.id} className="bg-white border border-slate-200 rounded-lg p-2 shadow-sm flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-600">
                  {m.source} · {(m.end - m.start).toFixed(1)}s @ {m.fps}fps
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const blob = await blobStore.load(msMovieKey(m.id));
                    if (!blob) return;
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${m.source.replace(/\.[^/.]+$/, '')}_region.webm`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                  }}
                  className="text-[10px] font-bold text-blue-600 underline"
                >Download</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
// ---------------------------------------------------------------------------
// ALL — every microscopy section in one page (used when the page renders with
// a single "All" tab).
// ---------------------------------------------------------------------------
export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <CollapsibleSection title="Instrumental Setup" icon="🔬" defaultOpen={false}>
      <InstrumentalSetup ctx={ctx} />
    </CollapsibleSection>
    <CollapsibleSection title="Experimental Setup" icon="🧪" defaultOpen={false}>
      <ExperimentalSetup ctx={ctx} />
    </CollapsibleSection>
    <CollapsibleSection title="Data" icon="🎬" defaultOpen={false}>
      <Data ctx={ctx} />
    </CollapsibleSection>
    <CollapsibleSection title="Data Analysis" icon="📐" defaultOpen={false}>
      <DataAnalysis ctx={ctx} />
    </CollapsibleSection>
  </div>
);

// Notebook HTML fragments for the Lab Notebook export.
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest = {} } = ctx || {};
  const t = activeTest;
  if (checkId === 'cond') {
    const parts = [];
    if (t.experimentDate) parts.push(`Date: ${t.experimentDate}`);
    if (t.cellNumber) parts.push(`Cells: ${t.cellNumber}`);
    if (t.fixation && t.fixation !== 'None') parts.push(`Fixation: ${t.fixation}`);
    if (t.permeabilization && t.permeabilization !== 'None') parts.push(`Permeabilization: ${t.permeabilization}`);
    if (t.otherConditions) parts.push(`Other: ${t.otherConditions}`);
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Microscopy Conditions:</b> ${parts.join(' | ') || 'N/A'}</p>`;
  }
  if (checkId === 'instrument') {
    const parts = [];
    if (t.microscopyType) parts.push(`Type: ${t.microscopyType}`);
    if (t.microscopeModel) parts.push(`Model: ${t.microscopeModel}`);
    if (t.objective) parts.push(`Objective: ${t.objective}`);
    if (t.laserLines) parts.push(`Lasers: ${t.laserLines}`);
    if (t.detector) parts.push(`Detector: ${t.detector}`);
    if (t.filterCubes) parts.push(`Filters: ${t.filterCubes}`);
    if (t.magnification) parts.push(`Magnification: ${t.magnification}`);
    if (t.acquisitionSoftware) parts.push(`Software: ${t.acquisitionSoftware}`);
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Microscopy Instrumental Setup:</b> ${parts.join(' | ') || 'N/A'}</p>`;
  }
  if (checkId === 'data') {
    const vids = Array.isArray(t.msVideos) ? t.msVideos : [];
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Microscopy Videos:</b> ${vids.length ? vids.map((v) => v.filename).join(', ') : 'none'}</p>`;
  }
  if (checkId === 'analysis') {
    const movies = Array.isArray(t.msMovies) ? t.msMovies : [];
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Created Movies:</b> ${movies.length ? movies.map((m) => `${m.source} (${(m.end - m.start).toFixed(1)}s @ ${m.fps}fps)`).join(' · ') : 'none'}</p>`;
  }
  if (checkId === 'setup') {
    const fcPlate = t.fcPlate || {};
    const rows = PLATES_DEF[fcPlate.plateType] ? PLATES_DEF[fcPlate.plateType].rows : 8;
    const cols = PLATES_DEF[fcPlate.plateType] ? PLATES_DEF[fcPlate.plateType].cols : 12;
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Microscopy Plate Setup:</b> ${fcPlate.plateType || '96'}-well (${rows}×${cols})</p>`;
  }
  return '';
};
