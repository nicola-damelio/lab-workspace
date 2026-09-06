/* =========================================================================
   src/administration/useDepenseLinkRepair.js
   Réparation AUTOMATIQUE des dépenses dont la « Catégorie » (Fonctionnement /
   Investissement) contredit la fiche « Recettes » imputée (recetteId).

   Une dépense « Fonctionnement » peut se retrouver liée à une fiche
   « Investissement » du même intitulé (et inversement) à cause d’anciens
   imports, de changements de type de ligne, de liaisons manuelles, etc. À
   l’ouverture des pages Recettes et Dépenses, ces incohérences sont
   réparées silencieusement :
     · la dépense est réimputée sur la fiche homonyme du bon type si elle
       existe (trace ajoutée dans « Commentaires ») ;
     · sinon elle est comptée comme « non réattribuable » et signalée.

   Le hook est idempotent : une empreinte du jeu de données évite de
   reparcourir en boucle ce qui vient d’être réparé.
   ========================================================================= */
import { useEffect, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import {
  depenseLinkStatus, relinkTraceText, appendComment,
} from './recetteLink';

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

export const useDepenseLinkRepair = () => {
  const { data, updateMany } = useAdmin();
  const [report, setReport] = useState(null); // { fixed, stuck } | null
  const checkedSig = useRef('');
  const fixedTotal = useRef(0);

  useEffect(() => {
    const recettes = Array.isArray(data.recettes) ? data.recettes : [];
    const depenses = Array.isArray(data.depenses) ? data.depenses : [];
    if (recettes.length === 0 || depenses.length === 0) return;

    /* Empreinte pertinente : si rien ne change sur les liaisons, inutile de
       reparcourir (l’updateMany ci-dessous change l’empreinte → un second
       passage confirme la cohérence puis s’arrête). */
    const sig = [
      JSON.stringify(recettes.map((r) => [r.id, r.type, r.ligne])),
      JSON.stringify(depenses.map((d) => [d.id, d.recetteId, d.categorie])),
    ].join('|');
    if (sig === checkedSig.current) return;
    checkedSig.current = sig;

    let fixedNow = 0;
    let stuck = 0;
    const fixes = [];
    depenses.forEach((d) => {
      if (!d || !d.id) return;
      const st = depenseLinkStatus(recettes, d);
      if (st.ok || !st.cur) return;
      if (!st.twin) { stuck += 1; return; }
      fixes.push({
        id: d.id,
        patch: {
          recetteId: st.twin.id,
          ligneBudgetaire: txt(st.twin.ligne),
          commentaires: appendComment(d, relinkTraceText(d, st.cur, st.twin)),
        },
      });
    });

    /* Un SEUL changement atomique : `upsert` en boucle repartirait de
       l’instantané d’origine à chaque appel et seul le dernier correctif
       survivrait (état React). */
    if (fixes.length) updateMany('depenses', fixes);
    fixedNow = fixes.length;
    if (fixedNow) fixedTotal.current += fixedNow;
    if (fixedNow || stuck) {
      setReport({ fixed: fixedTotal.current, stuck });
    }
  }, [data.recettes, data.depenses, updateMany]);

  return { report, clearReport: () => setReport(null) };
};
