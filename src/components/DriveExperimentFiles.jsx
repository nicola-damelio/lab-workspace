/* =========================================================================
   src/components/DriveExperimentFiles.jsx — CHOISIR UN FICHIER DANS LE DOSSIER
   DE L'EXPÉRIENCE.

   Le geste que les pages de données n'avaient pas : « le fichier est DANS le
   dossier sur le Drive, la page ne le voit pas » (voir
   utils/driveExperimentFiles.js — la reprise automatique cherche par NOM, un
   fichier déposé à la main n'a donc aucun nom à reconnaître).

   Ce composant ne fait que trois choses :
     1. lire le dossier canonique de l'expérience (`listExperimentFiles`) et
        montrer ce qu'il contient, par extension ;
     2. télécharger le fichier choisi (`driveRestore.downloadCloudFile` — la
        même lecture que la reprise automatique, corbeille comprise) ;
     3. le rendre à la page (`onPick(file, meta)`), qui en fait le fichier
        DÉCLARÉ de la condition : c'est lui qui sera rouvert par défaut, ici et
        sur les autres postes.

   Rien n'est envoyé au Drive par ce geste : le fichier y est déjà. La page
   choisit donc un fichier EXISTANT au lieu de re-téléverser le même.

   Le dossier où chaque candidat a été trouvé est affiché tel quel
   (`folderPathText`) : l'utilisateur sait où déposer les fichiers suivants, et
   la remontée « un cran plus haut » de la lecture n'est jamais muette.

   LE SEUL GESTE QUI FABRIQUE vit ici aussi : `DriveExperimentFolderCreator`.
   Quand l'expérience n'a PAS encore de dossier sur le Drive, la lecture ne
   peut rien montrer — la demande est alors « allow me to create it with the
   correct path », puis « …datasetname/projects/projectname/experimentname/
   instancename/subsection/file » : ce bouton crée donc le chemin ENTIER,
   jusqu'aux sous-sections `experiment_setup/Structure` et
   `experiment_setup/Trajectory` (voir
   utils/driveExperimentFiles.createExperimentFolder). COURT (« 📁 Create drive
   folder ») et TOUJOURS dans la rangée des fichiers — la ligne de
   📂 PDB file(s) — c'est le VIEWER qui le rend là (voir NMRMoleculeViewer,
   juste après `fileRowExtra`), donc sur les trois pages qui ont un viewer et un
   contexte de nommage : MD, NMR et Docking.
   ========================================================================= */

import { useState } from 'react';
import { downloadCloudFile, sameRawFileFor } from '../utils/driveRestore';
import { createExperimentFolder, describeDriveFileSize, drivePathText, experimentFileFolderPathOf, EXPERIMENT_FILE_SUBSECTIONS, fullDrivePathText, listExperimentFiles, normalizeFileExts } from '../utils/driveExperimentFiles';
import { getDriveRootName, getDriveToken } from '../utils/driveUpload';

const BTN = 'bg-white hover:bg-slate-50 border border-indigo-300 text-indigo-700 font-bold py-1.5 px-3 rounded-lg text-xs cursor-pointer shadow-sm transition-colors inline-flex items-center gap-1.5 disabled:opacity-50';
const ROW = 'flex items-center gap-2 px-2 py-1 rounded border border-slate-200 bg-white';
const USE = 'ml-auto shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-0.5 rounded text-[10px] disabled:opacity-50';

/**
 * @param {object}   props
 * @param {string}   props.label          texte du bouton (« 📂 Topology from Drive folder »)
 * @param {string}   [props.titleText]    infobulle (ce que le geste fait exactement)
 * @param {object}   [props.ctx]          contexte de nommage de la page
 * @param {object[]} [props.ctxs]         autres contextes à regarder (branches Setup / Data)
 * @param {string[]} props.exts           extensions voulues
 * @param {string}   [props.declaredName] le fichier DÉJÀ déclaré (marqué ✓ dans la liste)
 * @param {string}   [props.note]         phrase d'aide affichée à droite du bouton
 * @param {boolean}  [props.disabled]
 * @param {Function} props.onPick         async (file, meta) => void — meta = la ligne choisie
 */
export const DriveExperimentFilePicker = ({
  label, titleText = '', ctx = null, ctxs = [], exts = [],
  declaredName = '', note = '', disabled = false, onPick
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [paths, setPaths] = useState([]);
  const [msg, setMsg] = useState('');
  const [takingId, setTakingId] = useState('');
  const wanted = normalizeFileExts(exts);

  const load = async () => {
    setBusy(true);
    setMsg('🔎 Reading the experiment folder on Google Drive…');
    // Drive ÉTEINT : le dire tout de suite — sinon la liste vide se lirait
    // « ce dossier ne contient rien », ce qui est faux (on n'a rien pu lire).
    if (!getDriveToken()) {
      setBusy(false);
      setFiles([]);
      setPaths([]);
      setMsg('⚠️ Google Drive is not connected in this browser — connect it (sidebar, “Connect Google Drive”) and press again: the folder is then read.');
      return;
    }
    // Une lecture peut échouer (jeton mort, réseau) : on le DIT, jamais un
    // panneau vide qui laisse croire que le dossier ne contient rien.
    const res = await listExperimentFiles({ ctx, ctxs, exts: wanted }).catch(() => null);
    setBusy(false);
    if (!res) { setFiles([]); setPaths([]); setMsg('⚠️ Google Drive could not be read — connect it (sidebar) and press again.'); return; }
    setFiles(res.files || []);
    setPaths(res.paths || []);
    setMsg((res.files || []).length
      ? `Found in: ${drivePathText(res.path)}`
      : `ℹ️ No ${wanted.map((e) => `.${e}`).join(' / ')} file in this experiment's Drive folders — checked: ${(res.paths || []).map((p) => drivePathText(p)).join(' · ')}. Deposit one there and press ↻ Reload.`);
  };

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    await load();
  };

  const take = async (file) => {
    if (!file || !file.id) return;
    setTakingId(file.id);
    setMsg(`⬇️ Downloading ${file.name} from Google Drive…`);
    const downloaded = await downloadCloudFile(
      { id: file.id, name: file.name, url: file.url },
      { name: file.name }
    ).catch(() => null);
    setTakingId('');
    if (!downloaded) { setMsg(`⚠️ ${file.name} could not be downloaded from Google Drive.`); return; }
    try {
      await onPick?.(downloaded, file);
    } catch (err) {
      setMsg(`⚠️ ${file.name} could not be installed — ${(err && err.message) || 'unknown error'}.`);
      return;
    }
    setMsg(`✅ ${file.name} is now the file this condition opens by default (${file.folderPathText || 'experiment folder'}).`);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={toggle} disabled={disabled}
          title={titleText || 'Read the Drive folder of this experiment and open one of its files'} className={BTN}>
          {label}
        </button>
        {note && <span className="text-[10px] text-slate-400">{note}</span>}
      </div>
      {open && (
        <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-2 flex flex-col gap-1 max-h-72 overflow-auto">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wide">Experiment folder on Drive</span>
            <button type="button" onClick={load} disabled={busy}
              className="ml-auto text-[10px] font-bold text-indigo-700 hover:text-indigo-900 disabled:opacity-50">↻ Reload</button>
          </div>
          {busy && <span className="text-[11px] text-slate-500">⏳ Reading…</span>}
          {!busy && files.length === 0 && <span className="text-[11px] text-slate-600">{msg}</span>}
          {!busy && files.map((file) => (
            <div key={file.id} className={ROW}>
              <span className="text-[11px] font-semibold text-slate-800 truncate" title={file.name}>{file.name}</span>
              <span className="text-[10px] text-slate-400 shrink-0">{describeDriveFileSize(file.size)}</span>
              <span className="text-[10px] text-slate-400 truncate" title={file.folderPathText}>{file.folderPathText}</span>
              {declaredName && sameRawFileFor(file.name, declaredName) && (
                <span className="text-[10px] font-bold text-emerald-700 shrink-0">✓ declared</span>
              )}
              <button type="button" className={USE} onClick={() => take(file)}
                disabled={busy || takingId === file.id} title="Download this file and make it the one this condition opens by default">
                {takingId === file.id ? '…' : 'Use'}
              </button>
            </div>
          ))}
          {!busy && files.length > 0 && <span className="text-[10px] text-slate-500">{msg}</span>}
          {paths.length > 0 && (
            <details className="text-[10px] text-slate-500">
              <summary className="cursor-pointer">Folders checked ({paths.length})</summary>
              <ul className="mt-1 ml-3 list-disc">
                {paths.map((p) => <li key={p.join('/')}>{drivePathText(p)}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * CRÉER les dossiers de l'expérience sur le Drive — le SEUL geste d'écriture de
 * la rangée des fichiers (les 📂, eux, ne font que LIRE).
 *
 * Défaut visé (signalé) : « If the experiment does not exist in drive, allow
 * me to create it with the correct path. » Un geste de lecture ne fabrique
 * jamais d'arborescence : quand le dossier n'existe pas, les 📂 ne montrent
 * rien. Ce bouton-ci est donc EXPLICITE — l'utilisateur demande la création —
 * et il crée le CHEMIN ENTIER où les fichiers se déposent vraiment :
 *
 *     <dataset>/projects/<projet>/<expérience>/<instance?>/experiment_setup/Structure
 *     <dataset>/projects/<projet>/<expérience>/<instance?>/experiment_setup/Trajectory
 *
 * La demande, mot pour mot : « for a trajectory it must be datasetname/projects/
 * projectname/experimentname/instancename/subsection/file where subsection is
 * experiment_setup/trajectory for trajectory files and experiment_setup/
 * Structure for pdb files ». La création est IDEMPOTENTE (un dossier déjà
 * présent est simplement retrouvé) et CHAQUE segment est vérifié : l'échec DIT
 * ce qui n'a pas été créé (voir createExperimentFolder).
 *
 * Le bouton est COURT — « 📁 Create drive folder » : il partage la rangée des
 * fichiers (celle de 📂 PDB file(s)) et n'a qu'une place étroite — mais il
 * montre les chemins COMPLETS, dataset compris, dans son infobulle ET après
 * coup, avec un lien par dossier (la demande : « the description on where it
 * would do it is not complete »).
 *
 * @param {object}   props
 * @param {object}   props.ctx          contexte de nommage de la page (project/test/instance)
 * @param {string}   [props.label]      texte du bouton
 * @param {string}   [props.titleText]  infobulle (ce que le geste fait exactement)
 * @param {boolean}  [props.disabled]
 * @param {Function} [props.onCreated]  async (result) => void — la page peut recharger ses listes
 */
export const DriveExperimentFolderCreator = ({
  ctx = null, label = '📁 Create drive folder', titleText = '',
  disabled = false, onCreated = null
}) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [made, setMade] = useState(null);      // [{ fullText, folderUrl }]

  /* LES CHEMINS VISÉS, dits AVANT le clic : le bouton annonce où il crée, le
     nom du dataset compris — sinon « create the folder » ne dit pas lequel. */
  const datasetName = getDriveRootName();
  const targets = EXPERIMENT_FILE_SUBSECTIONS
    .map((sub) => fullDrivePathText(datasetName, experimentFileFolderPathOf(ctx, sub)))
    .filter(Boolean);
  const where = targets.join('   ·   ');

  const create = async () => {
    setBusy(true);
    setMsg('📁 Creating the experiment folders on Google Drive…');
    const res = await createExperimentFolder({ ctx });
    setBusy(false);
    if (!res || !res.ok) {
      setMade(null);
      setMsg(`⚠️ ${(res && res.error) || 'The experiment folder could not be created.'}`);
      return;
    }
    const entries = (res.entries || []).map((e) => ({ fullText: e.fullText, folderUrl: e.folderUrl }));
    setMade(entries);
    setMsg(`✅ Ready: deposit the files in ${entries.map((e) => e.fullText).join(' · ')} — the 📂 buttons above then read them.`);
    try { await onCreated?.(res); } catch { /* l'appelant décide quoi en faire */ }
  };

  const title = titleText || `Create THIS experiment's Drive folders so its files can be deposited there: ${where}. Idempotent — a folder that is already there is simply found — and nothing else is created.`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={create} disabled={disabled || busy}
          title={title} className={BTN}>
          {busy ? '⏳ Creating…' : label}
        </button>
      </div>
      {msg && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-600">{msg}</span>
          {(made || []).map((e) => (
            <span key={e.fullText} className="flex items-center gap-1 text-[10px] text-slate-500">
              <span className="truncate" title={e.fullText}>📁 {e.fullText}</span>
              {e.folderUrl && (
                <a href={e.folderUrl} target="_blank" rel="noreferrer"
                  className="shrink-0 font-bold text-indigo-700 hover:text-indigo-900">Open ↗</a>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};


