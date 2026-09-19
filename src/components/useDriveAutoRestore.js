/* =========================================================================
   src/components/useDriveAutoRestore.js — restaurer SANS RIEN DEMANDER.

   Le geste que l'utilisateur ne doit JAMAIS avoir à faire : ouvrir une page et
   retrouver ses données. À l'affichage du module :

     1. la page dit si la donnée lourde manque (`missing`) — absente, vidée par
        compressDatasetForSave, ou présente sans sa copie plein format ;
     2. si elle manque ET que le cloud est connecté, `restore` est appelée UNE
        FOIS par expérience et par session (portillon de driveRestore.js) ;
     3. si le cloud n'était pas connecté, rien n'est réservé : dès l'événement
        « lab:drive-connected » (bouton « Connect Google Drive », bascule de
        fournisseur), la restauration part toute seule.

   Le module appelant ne s'occupe que du MÉTIER (télécharger quoi, réinjecter
   où, dire quoi à l'écran) : la mécanique ci-dessus est la même pour le FCS, le
   NMR 1D, le ssNMR, le CD, le docking et les trajectoires MD.
   ========================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react';
import { claimRestore, hasCloudAccess, releaseRestore } from '../utils/driveRestore';

/**
 * @param {object}   opts
 * @param {string}   opts.kind      type de donnée (« nmr1d », « fcsevents », …)
 * @param {string}   opts.testId    id de l'expérience ouverte (clé du portillon)
 * @param {Function} opts.missing   () => boolean | Promise<boolean> — la donnée manque-t-elle ?
 * @param {Function} opts.restore   ({ reason }) => Promise<{ ok, message }>
 * @param {boolean}  [opts.enabled] false = ne rien faire (page sans Drive, données présentes)
 * @returns {{ status: string, message: string, attempt: Function }}
 *          status : 'idle' | 'restoring' | 'restored' | 'failed'
 */
export const useDriveAutoRestore = ({
  kind, testId, missing, restore, enabled = true
}) => {
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  // Les fermetures changent à chaque rendu : elles sont lues par référence,
  // sinon l'effet de démarrage se relancerait en boucle.
  const missingRef = useRef(missing);
  const restoreRef = useRef(restore);
  missingRef.current = missing;
  restoreRef.current = restore;

  const aliveRef = useRef(true);
  const runningRef = useRef(false);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const attempt = useCallback(async (reason = 'auto') => {
    if (!enabled || !testId || runningRef.current) return null;
    if (!hasCloudAccess()) return null;
    let needs = false;
    try { needs = await missingRef.current?.(); } catch { needs = false; }
    if (!needs || !aliveRef.current) return null;
    // Une seule tentative par expérience et par session : sans ce portillon,
    // chaque rendu relancerait des requêtes sur le Drive. Un essai MANUEL
    // (« Try again ») est explicite : il libère d'abord la réservation.
    const forced = reason !== 'open' && reason !== 'cloud-connected';
    if (forced) releaseRestore(kind, testId);
    if (!claimRestore(kind, testId)) return null;
    runningRef.current = true;
    setStatus('restoring');
    setMessage('');
    try {
      const res = await restoreRef.current?.({ reason });
      if (!aliveRef.current) return res || null;
      setStatus(res && res.ok ? 'restored' : 'failed');
      setMessage((res && res.message) || '');
      return res || null;
    } catch (err) {
      if (aliveRef.current) {
        setStatus('failed');
        setMessage((err && err.message) || 'restore failed');
      }
      return { ok: false, message: (err && err.message) || '' };
    } finally {
      runningRef.current = false;
    }
  }, [enabled, kind, testId]);

  // 1) À l'ouverture (ou au changement d'expérience) : la tentative automatique.
  useEffect(() => {
    aliveRef.current = true;
    attempt('open');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // 2) Après une connexion au cloud : retenter, même si la page est déjà ouverte.
  useEffect(() => {
    if (!enabled) return undefined;
    const onConnected = () => {
      // La tentative précédente a échoué faute de connexion : le portillon
      // n'avait rien réservé, mais on le libère quand même par sûreté.
      releaseRestore(kind, testId);
      attempt('cloud-connected');
    };
    window.addEventListener('lab:drive-connected', onConnected);
    window.addEventListener('lab:cloud-provider-changed', onConnected);
    return () => {
      window.removeEventListener('lab:drive-connected', onConnected);
      window.removeEventListener('lab:cloud-provider-changed', onConnected);
    };
  }, [attempt, enabled, kind, testId]);

  return { status, message, attempt };
};
