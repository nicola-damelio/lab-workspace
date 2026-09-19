/* =========================================================================
   src/components/BoxLabelFile.jsx
   « storage/<storage>/boxes/<boîte>/label.pdf » — l'étiquette d'une boîte est
   fabriquée et déposée sur le Drive TOUT SEUL : dès que la table de la boîte
   change (un puits rempli, un nom, une position), un nouveau label.pdf remplace
   le précédent ~2 s après la dernière modification.

   Rien n'est envoyé quand le contenu n'a pas changé (signature enregistrée dans
   la boîte) ni quand le Drive ne répond pas : le fichier repart à la
   modification suivante, ou tout de suite avec « ⬆ Save to Drive now ».

   Props (aucune donnée n'est écrite par ce composant lui-même) :
     storageName, boxName, position, rows, signature,
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
import { storageBoxFolderPath, BOX_LABEL_FILE_NAME } from '../utils/driveNaming';

export const BoxLabelFile = ({
  storageName = '', boxName = 'box', position = null, rows = [],
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
      setStatus(`☁ ${folder}/${BOX_LABEL_FILE_NAME} is up to date on Drive.`);
      return undefined;
    }
    setStatus('⏳ Building label.pdf…');
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const blob = buildBoxLabelPdf({ storageName, position, boxName, rows });
        const drive = await saveBoxLabelFile({ storage: storageName, box: boxName, blob });
        if (drive && drive.driveUrl) {
          if (onSavedRef.current) onSavedRef.current({ url: drive.driveUrl, signature });
          setStatus(`✓ ${BOX_LABEL_FILE_NAME} saved to ${folder}`);
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
  }, [signature, savedSignature, savedUrl, folder, rowCount, manualTick, storageName, boxName, position, rows]);

  return (
    <div className="flex flex-col gap-1 min-w-[230px] max-w-[420px]">
      <label className="text-xs font-bold text-slate-500 uppercase">Box label (PDF on Drive)</label>
      <div className="text-[10px] font-mono text-slate-500 break-all bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
        {folder}/{BOX_LABEL_FILE_NAME}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setManualTick((t) => t + 1)}
          disabled={busy || rowCount === 0}
          className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 disabled:opacity-50 flex items-center justify-center gap-1"
          title="Build label.pdf (all filled slots) and save it into the box folder on Google Drive"
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
