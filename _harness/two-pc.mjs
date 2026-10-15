/* =========================================================================
   _harness/two-pc.mjs — DEUX POSTES (« PC A », « PC B ») SUR UN MÊME FAUX
   DRIVE, avec leurs magasins locaux SÉPARÉS.

   CE QUI TOURNE ICI EST LE CODE RÉEL : `globalThis.__driveUseRealUpload = true`
   fait charger `src/utils/driveUpload.js` (et tout ce qui l'importe : le miroir,
   la structure, la copie du dataset) TEEL QUEL — seuls `fetch`, `localStorage`,
   `window` et le serveur de jetons sont faux. C'est la seule façon de dire
   « eseguito » plutôt que « lu ».

   DEUX LIMITES, DITES FRANCHEMENT :
     1. un processus Node ne sert qu'UN poste à la fois : `pc.do(fn)` installe
        le magasin et le jeton du poste, exécute, puis rend les globaux. La
        « simultanéité » de deux postes est donc reproduite par la FENÊTRE DE
        COHÉRENCE (l'un ne voit pas encore l'écriture de l'autre) — le
        mécanisme réel du défaut des jumeaux ;
     2. l'état de MODULE de driveUpload (jeton, contexte de racine, verrous
        `oncePerFolder`) est partagé par les deux postes : `pc.do` le
        RÉ-AFFIRME à chaque opération (ce que fait App.jsx à l'ouverture d'un
        dataset), et les verrous ne protègent donc QUE l'intérieur d'un poste —
        exactement la limite décrite dans la FASE 0 (D3).
   ========================================================================= */
import { register } from 'node:module';
import { createFakeDrive, FOLDER_MIME } from './fake-drive.mjs';

/* LE CROCHET ESM DE L'HARNESS (résolution sans extension, et le module RÉEL de
   driveUpload — voir _harness/real-upload-hook.mjs) : il est posé ICI, une
   fois, pour que les tests n'aient qu'à importer cet harness. */
register('./real-upload-hook.mjs', import.meta.url);

const noop = () => {};

export const makeStore = (seed = {}) => {
  const m = new Map(Object.entries(seed).map(([k, v]) => [String(k), String(v)]));
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    raw: m
  };
};

/** Écrit un global MÊME QUAND NODE LE DÉFINIT EN LECTURE SEULE (Node 24+
 *  expose `navigator`, et un `localStorage` expérimental : l'affectation
 *  directe lève « Cannot set property … which has only a getter »). */
export const setGlobal = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch { /* on garde ce que Node expose */ }
};

/** LA FILE GLOBALE DES OPÉRATIONS : un processus Node n'a qu'UN couple
 *  (`localStorage`, `fetch`) global, donc deux opérations ne peuvent pas
 *  s'entrecroiser — même celles de deux postes différents. Toute opération
 *  passe par cette file et ATTEND son tour : c'est aussi ce que fait un onglet,
 *  qui n'émet qu'une requête à la fois. (Une opération imbriquée dans une autre
 *  attendrait sa propre fin : les tests n'imbriquent jamais.) */
let driveQueue = Promise.resolve();
export const queued = (task) => {
  const run = driveQueue.then(task, task);
  driveQueue = run.then(() => undefined, () => undefined);
  return run;
};
export const driveQueueIdle = () => driveQueue;

const installBrowser = () => {
  if (globalThis.__harnessBrowser) return;
  globalThis.__harnessBrowser = true;
  if (!globalThis.CustomEvent) {
    class HarnessEvent { constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; } }
    setGlobal('CustomEvent', HarnessEvent);
  }
  setGlobal('window', globalThis);
  globalThis.window.addEventListener = noop;
  globalThis.window.removeEventListener = noop;
  globalThis.window.dispatchEvent = noop;
  globalThis.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  setGlobal('document', {
    visibilityState: 'visible', hidden: false, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop })
  });
  /* `navigator` est FOURNI par Node : on n'y ajoute que ce qui manque
     (`onLine`), sans jamais remplacer l'objet. */
  try {
    if (!globalThis.navigator) setGlobal('navigator', { onLine: true, userAgent: 'node-harness' });
    else if (globalThis.navigator.onLine === undefined) {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    }
  } catch { /* un navigateur en lecture seule suffit */ }
  if (!globalThis.sessionStorage) setGlobal('sessionStorage', makeStore());
};

/** Charge les modules RÉELS de l'app (le drapeau du crochet les rend tels
 *  quels). Toute absence d'export se voit tout de suite : c'est voulu. */
export const loadRealModules = async () => ({
  upload: await import('../src/utils/driveUpload.js'),
  structure: await import('../src/utils/driveStructure.js'),
  mirror: await import('../src/utils/driveMirror.js'),
  mirrorStore: await import('../src/utils/driveMirrorStore.js'),
  workspace: await import('../src/utils/workspaceDrive.js'),
  copyMirror: await import('../src/utils/datasetCopyMirror.js'),
  tidy: await import('../src/utils/driveTidy.js'),
  restore: await import('../src/utils/driveRestore.js'),
  naming: await import('../src/utils/driveNaming.js'),
  expTombs: await import('../src/utils/experimentTombstones.js'),
  twins: await import('../src/utils/datasetDirTwins.js')
});

/** Monte le faux Drive + deux postes. `drive` n'est PAS pré-rempli : les
 *  scénarios sèment l'arbre eux-mêmes. */
export const createHarness = async ({
  seed = 1,
  drive: driveOpts = {},
  datasetName = 'DATASET_TEST',
  datasetId = 'ds_test',
  labels = ['PC A', 'PC B']
} = {}) => {
  installBrowser();
  const drive = createFakeDrive({ seed, ...driveOpts });
  const mods = await loadRealModules();
  /* ⛔ UN HARNAIS NEUF EST UNE SESSION NEUVE : driveStructure garde en mémoire
     de module les empreintes déjà publiées, les `_meta.json` lus et les chemins
     résolus. Sans ce nettoyage, un scénario « hérite » du précédent (constaté
     le 15/10/2026 : le second publish du même contenu était ENTIÈREMENT sauté —
     `skipped: 3` — et l'arbre restait vide). */
  mods.structure.resetDriveStructureCache();
  mods.structure.resetPublishedFingerprints();

  /* L'arbre du DÉPART : « Lab Workspace » à la racine, puis le dossier du
     dataset — nommé avec le MÊME slug que l'app (`datasetFolderSlug`), sinon
     l'app ne le reconnaît pas et en crée un second (c'est ce qui se voyait sur
     la sonde du 15/10/2026 : « MON DATASET » semé, « MON_DATASET » créé). */
  const workspaceId = drive.mkFolder('Lab Workspace', '');
  const datasetFolderName = mods.naming.datasetFolderSlug(datasetName) || datasetName;
  const datasetFolderId = drive.mkFolder(datasetFolderName, workspaceId);

  const mkPc = (label, index) => {
    const store = makeStore();
    let token = `tok_${index}`;
    drive.registerToken(token, label);
    const pc = { label, store, drive, mods, get token() { return token; } };
    pc.do = (fn) => queued(async () => {
      const prev = { ls: globalThis.localStorage, ss: globalThis.sessionStorage, f: globalThis.fetch };
      setGlobal('localStorage', store);
      setGlobal('fetch', (url, init) => drive.fetch(url, init));
      drive.setMintFor(label);
      try {
        /* Le jeton du poste : écrit DANS SON magasin s'il n'y est pas (un jeton
           fraîchement renouvelé par l'app n'est jamais écrasé). Pas
           d'expiration par le temps — c'est `pc.expire()` qui la dit. */
        if (!store.getItem('labDriveAccessToken')) mods.upload.setDriveToken(token, 0);
        mods.upload.setDriveRootContext({ id: datasetId, name: datasetName, kind: 'scientific' });
        return await fn(mods, pc);
      } finally {
        setGlobal('localStorage', prev.ls);
        setGlobal('sessionStorage', prev.ss);
        setGlobal('fetch', prev.f);
      }
    });
    pc.expire = () => drive.expireToken(token);
    pc.rotate = (next) => { token = next; drive.registerToken(next, label); return next; };
    pc.read = (k) => store.getItem(k);
    pc.write = (k, v) => store.setItem(k, v);
    return pc;
  };

  const pcs = labels.map((l, i) => mkPc(l, i + 1));
  return {
    drive, mods, pcs, workspaceId, datasetFolderId, datasetFolderName, datasetId, datasetName,
    byLabel: (l) => pcs.find((p) => p.label === l)
  };
};

/* ── LA RÉPLIQUE DE L'AUTOSAVE (App.jsx:4071-4239) ─────────────────────────
   Ligne pour ligne, ce que fait App.jsx :
     • 4078  `clearTimeout` du minuteur précédent, 4077 statut « saving » ;
     • 4083  `runSave(urgent)` : RIEN si une sauvegarde plus récente l'a
             remplacée (4086), `yieldToPaint()` quand ce n'est pas urgent
             (4099), la charge (4100 : tests + projets), puis la COPIE DU
             DATASET (4134 : `copyMirror.schedule`) et la STRUCTURE (4147 :
             `publishDatasetStructure`, qui n'attend personne — .then/.catch) ;
     • 4199  `saveTimeoutRef.current = setTimeout(runSave, 1500)`  ← LE DÉLAI
     • 4205  `flushPendingSave()` : minuteur annulé, `runSave(true)`, puis
             `datasetCopyMirror.flush()` (4215) ;
     • 4220  `window.addEventListener('pagehide', flushPendingSave)` ;
     • 4221  `document.addEventListener('visibilitychange', …)` si caché (4218).
   La charge vient du TEST (`payloadFn`) : c'est `latestDataRef.current` +
   `cloudProjectsPayload()` (App.jsx:4100). */
export const createAutosaveReplica = ({
  pc, payloadFn, datasetId = '', delayMs = 1500
}) => {
  const { structure, copyMirror, workspace } = pc.mods;
  let pending = null;
  let timer = null;
  const report = { saves: 0, published: 0, errors: [], status: 'idle', lastPublish: null };
  const copyMirrorRef = copyMirror.createDatasetCopyMirror({
    // App.jsx:5426 — « write: (body) => writeDatasetCopy(body).catch(() => null) »
    write: (body) => workspace.writeDatasetCopy(body).catch(() => null)
  });

  const runSave = async (urgent = false) => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending !== runSave) return;      // App.jsx:4086
    pending = null;
    report.saves += 1;
    if (!urgent) await Promise.resolve();  // ≈ yieldToPaint (App.jsx:4099)
    const data = payloadFn();              // App.jsx:4100
    const updatedPayload = {
      title: data.datasetTitle || 'Untitled Dataset',
      subtitle: data.datasetSubtitle || '',
      date: (data.tests && data.tests[0] && data.tests[0].date) || '',
      testCount: (data.tests || []).length,
      updatedAt: Date.now(),
      payload: JSON.stringify(data),
      isCompressed: false
    };
    copyMirrorRef.schedule(datasetId, updatedPayload);   // App.jsx:4134
    // App.jsx:4147 — la publication n'est pas ATTENDUE par l'app ; on la garde
    // pour pouvoir dire, à la fin, ce qu'elle a écrit.
    report.lastPublish = structure.publishDatasetStructure({
      datasetId, datasetName: data.datasetTitle || '', data
    }).then((res) => {
      report.published += 1;
      report.lastResult = res;
      if (res && res.ok === false) report.errors.push(`publish:${res.reason || 'refusée'}`);
      return res;
    }).catch((err) => {
      report.errors.push(String((err && err.message) || err));
      return null;
    });
    /* ⚠ App.jsx laisse cette publication SANS l'attendre (« fire and forget »).
       Le harnais, lui, l'attend : dans un processus unique les globaux du poste
       sont rendus à la sortie de `pc.do`, et une publication encore en vol
       sortirait du faux Drive (« publish:cloud-unavailable », constaté le
       15/10/2026). Ce n'est PAS un changement de comportement de l'app. */
    await report.lastPublish;
  };

  return {
    report,
    /** Une modification du modèle repart l'effet d'App.jsx (le minuteur). */
    schedule() {
      report.status = 'saving';
      if (timer) clearTimeout(timer);
      pending = runSave;
      timer = setTimeout(() => {
        pc.do(() => runSave(false)).catch((e) => report.errors.push(e.message));
      }, delayMs);
    },
    /** `pagehide` / passage en arrière-plan (App.jsx:4205-4221). */
    async flush() {
      await pc.do(async () => {
        if (!pending) return;
        /* ⚠ App.jsx n'ATTEND pas ce `runSave(true)` — dans un navigateur il n'y
           a rien à attendre. ICI, si : le processus est unique, et les globaux
           du poste (`localStorage`, `fetch`) sont rendus à la fin de `pc.do` ;
           sans cette attente, la sauvegarde se poursuivait APRÈS le retour des
           globaux et publiait hors du faux Drive (constaté le 15/10/2026 :
           `published: 3, errors: []` et un arbre vide). */
        const save = pending;
        await save(true);
        try { copyMirrorRef.flush(); } catch { /* best-effort (App.jsx:4215) */ }
      });
      report.status = 'saved';
    },
    /** L'ONGLET FERMÉ À MOITIÉ : le minuteur ne se déclenchera jamais et rien
     *  n'a été vidé — le scénario « scheda chiusa a metà » du TEST. */
    killWithoutFlush() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    /** Ce que `pagehide` fait dans la vraie app : pousser la copie du dataset
     *  (`datasetCopyMirrorRef.current.flush()`, App.jsx:4215). Le miroir a son
     *  propre délai ; sans ce geste, un poste qui ferme juste après une
     *  sauvegarde laisse sa copie en route — c'est ce que la mesure compte. */
    async pushCopy() {
      await pc.do(async () => { try { copyMirrorRef.flush(); } catch { /* best-effort */ } });
    },
    pendingCount: () => (pending ? 1 : 0)
  };
};
