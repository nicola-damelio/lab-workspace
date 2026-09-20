/* =========================================================================
   src/components/BoxLabelFile.jsx
   « storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf » —
   l'étiquette d'une boîte est fabriquée et déposée sur le Drive TOUT SEUL : dès
   que la table de la boîte change (un puits rempli, un nom, une position, sa
   date, son propriétaire, ses commentaires), une nouvelle étiquette remplace la
   précédente ~2 s après la dernière modification. La date et le propriétaire
   sont ceux de la BOÎTE (ses deux champs obligatoires), donc le fichier
   s'identifie tout seul dès qu'il sort de son dossier.

   Rien n'est envoyé quand le contenu n'a pas changé (signature enregistrée dans
   la boîte) ni quand le Drive ne répond pas : le fichier repart à la
   modification suivante, ou tout de suite avec « ⬆ Save to Drive now ».

   Props (aucune donnée n'est écrite par ce composant lui-même) :
     storageName, boxName, position, owner, date, boxNotes, rows, signature,
     savedSignature / savedUrl (ce que la boîte garde du dernier envoi),
     onSaved({ url, signature }).
   Le bouton « Print Label » de la boîte, lui, continue d'imprimer la SÉLECTION
   (voir Storage.BoxDetail) ; l'étiquette archivée, elle, est la table complète
   de la boîte — c'est elle qui décrit la boîte sur son étiquette.
   ========================================================================= */
import React, { useEffect, useRef, useState } from 'react';
import { cloudBackendAvailable } from '../utils/driveUpload';
import { buildBoxLabelPdf } from '../utils/boxLabelPdf';
import { saveBoxLabelFile } from '../utils/storageDrive';
import { storageBoxFolderPath, boxLabelFileName } from '../utils/driveNaming';

export const BoxLabelFile = ({
  storageName = '', boxName = 'box', position = null, rows = [],
  owner = '', date = '', boxNotes = '',
  signature = '', savedSignature = '', savedUrl = '', onSaved
}) => {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualTick, setManualTick] = useState(0);
  /* Le rappel du parent change à chaque rendu : on le garde dans une ref pour
     que l'effet d'envoi ne dépende QUE du contenu de l'étiquette. */
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const folder = storageBoxFolderPath(storageName, boxName).join('/');
  /* Le nom du fichier : <date>_<propriétaire>_boxlabel.pdf, avec la date et le
     propriétaire de la BOÎTE (voir driveNaming.boxLabelFileName). */
  const fileName = boxLabelFileName(date, owner);
  const filePath = `${folder}/${fileName}`;
  const rowCount = rows.length;

  useEffect(() => {
    if (rowCount === 0) {
      setStatus('Nothing to label yet — fill at least one slot.');
      return undefined;
    }
    if (!cloudBackendAvailable()) {
      setStatus('Drive not connected — the label will be saved as soon as it answers.');
      return undefined;
    }
    if (savedUrl && savedSignature === signature) {
      setStatus(`☁ ${filePath} is up to date on Drive.`);
      return undefined;
    }
    setStatus(`⏳ Building ${fileName}…`);
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        /* La date, le propriétaire et le commentaire de boîte font partie du PDF
           (en-tête, et nom du fichier) et les notes des puits sont reprises EN
           CALCE, rappelées par la position du puits : l'étiquette archivée décrit
           donc la boîte comme l'écran la montre (voir boxLabelPdf). */
        const blob = buildBoxLabelPdf({ storageName, position, boxName, owner, date, rows, boxNotes });
        const drive = await saveBoxLabelFile({ storage: storageName, box: boxName, blob, name: fileName });
        if (drive && drive.driveUrl) {
          if (onSavedRef.current) onSavedRef.current({ url: drive.driveUrl, signature });
          setStatus(`✓ ${fileName} saved to ${folder}`);
        } else {
          setStatus('⚠ Drive did not answer — the label will be saved at the next change.');
        }
      } catch {
        setStatus('⚠ The label could not be saved right now.');
      } finally {
        setBusy(false);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [signature, savedSignature, savedUrl, filePath, fileName, folder, rowCount, manualTick, storageName, boxName, position, owner, date, boxNotes, rows]);

  return (
    <div className="flex flex-col gap-1 min-w-[230px] max-w-[420px]">
      <label className="text-xs font-bold text-slate-500 uppercase">Box label (PDF on Drive)</label>
      <div className="text-[10px] font-mono text-slate-500 break-all bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
        {filePath}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setManualTick((t) => t + 1)}
          disabled={busy || rowCount === 0}
          className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 disabled:opacity-50 flex items-center justify-center gap-1"
          title="Build the label PDF (all filled slots, notes repeated at the foot) and save it into the box folder on Google Drive"
        >
          {busy ? '⏳ Saving…' : '⬆ Save to Drive now'}
        </button>
        {savedUrl && (
          <a href={savedUrl} target="_blank" rel="noopener noreferrer"
             className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline">
            Open ↗
          </a>
        )}
      </div>
      {status && <div className="text-[10px] font-bold text-slate-500">{status}</div>}
    </div>
  );
};
