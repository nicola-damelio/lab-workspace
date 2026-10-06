/* =========================================================================
   src/components/AppModules/libraryModule.jsx
   Library module (compounds, cell lines, plasmids, solvents, buffers,
   additives and NMR equipment), extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';
import { CollapsibleSectionPanel as CollapsibleSection } from '../ui';
import { LibraryDirectory } from './libraryDirectory';
import { CellLineDefinitionSection, PlasmidDefinitionSection } from './librarySections';
import { CompoundDefinitionSection } from './compoundDefinitionSection';
import { SolventsManager, BuffersManager, AdditivesManager, NMRProbesManager, NMRInstrumentsManager, NMRExperimentsManager } from '../DefinitionsExtra';
import { PyMOLScriptsSection } from './PyMOLScriptsSection';
import { libraryPlanPatch } from '../../utils/libraryCsv';

export const LibraryModule = ({
  allCmpds, setActiveLibrarySelection, activeLibrarySelection,
  allCellLines,
  compoundMeta, setCompoundMeta, cellLineMeta, setCellLineMeta,
  plasmidMeta, setPlasmidMeta, customCmpds, setCustomCmpds,
  customCellLines, setCustomCellLines,
  solvents, setSolvents, buffers, setBuffers, additives, setAdditives,
  nmrProbes, setNmrProbes, nmrInstruments, setNmrInstruments, nmrExperiments, setNmrExperiments
}) => {
  /* ── 🗑 SUPPRIMER PLUSIEURS ENTRÉES D'UN COUP ────────────────────────────
     La page Librairie envoie le TYPE de la sous-catégorie et les NOMS cochés :
     la suppression se fait ICI, le seul endroit qui tient les setters et les
     listes — une écriture par liste, donc pas de suppression « une fois sur
     deux ». La règle est celle des fiches et des gestionnaires : un élément se
     retire PAR SON NOM (SolventsManager, NMRProbesManager… font exactement
     `list.filter(it => it.name !== nom)`), et une fiche (composé, lignée,
     plasmide) quitte AUSSI sa liste « personnalisée ». */
  const deleteResources = (type, names) => {
    const list = Array.isArray(names) ? names : [];
    if (!list.length) return;
    const map = new Set(list);
    const dropNames = (current) => (Array.isArray(current) ? current : [])
      .filter((it) => !map.has(typeof it === 'string' ? it : (it && it.name)));
    const dropMeta = (current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      list.forEach((name) => { delete next[name]; });
      return next;
    };
    if (type === 'compound') { setCompoundMeta(dropMeta); setCustomCmpds(dropNames); return; }
    if (type === 'cellLine') { setCellLineMeta(dropMeta); setCustomCellLines(dropNames); return; }
    if (type === 'plasmid') { setPlasmidMeta(dropMeta); return; }
    if (type === 'solvent') { setSolvents(dropNames); return; }
    if (type === 'buffer') { setBuffers(dropNames); return; }
    if (type === 'additive') { setAdditives(dropNames); return; }
    if (type === 'nmrInstrument') { setNmrInstruments(dropNames); return; }
    if (type === 'nmrProbe') { setNmrProbes(dropNames); return; }
    if (type === 'nmrExperiment') { setNmrExperiments(dropNames); return; }
  };

  /* ── 📤 IMPORTER CE QUI A ÉTÉ COCHÉ DANS LE FICHIER ─────────────────────
     `libraryPlanPatch` (utils/libraryCsv.js) fait la FUSION — additive, par
     nom, jamais destructrice — et ne rend QUE les listes qui changent ; ici on
     pose ces listes dans l'état, puis on dit à l'écran ce qui est entré. Les
     compteurs viennent du plan (ce que l'utilisateur a coché), pas du fichier :
     une sous-catégorie décochée n'entre pas d'un seul élément. */
  const importLibrary = (plan) => {
    const patch = libraryPlanPatch({
      compoundMeta, customCmpds, cellLineMeta, customCellLines, plasmidMeta,
      solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments,
    }, plan);
    if (patch.compoundMeta) { setCompoundMeta(patch.compoundMeta); setCustomCmpds(patch.customCmpds); }
    if (patch.cellLineMeta) { setCellLineMeta(patch.cellLineMeta); setCustomCellLines(patch.customCellLines); }
    if (patch.plasmidMeta) setPlasmidMeta(patch.plasmidMeta);
    if (patch.solvents) setSolvents(patch.solvents);
    if (patch.buffers) setBuffers(patch.buffers);
    if (patch.additives) setAdditives(patch.additives);
    if (patch.nmrInstruments) setNmrInstruments(patch.nmrInstruments);
    if (patch.nmrProbes) setNmrProbes(patch.nmrProbes);
    if (patch.nmrExperiments) setNmrExperiments(patch.nmrExperiments);

    const UNITS = {
      compounds: 'compound', cellLines: 'cell line', plasmids: 'plasmid', solvents: 'solvent',
      buffers: 'buffer', additives: 'additive', nmrInstruments: 'NMR instrument',
      nmrProbes: 'NMR probe', nmrExperiments: 'NMR experiment',
    };
    const summary = Object.entries(UNITS).map(([key, unit]) => {
      const n = plan && Array.isArray(plan[key]) ? plan[key].length : 0;
      return n ? `${n} ${unit}${n > 1 ? 's' : ''}` : '';
    }).filter(Boolean).join(' · ');
    if (summary) alert(`Imported into the library: ${summary}.`);
  };

  return (

              <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
                <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">

                  <CollapsibleSection title="Library Directory" subtitle="Click any item to view or edit its full details." defaultOpen={true}>
                    <LibraryDirectory
                      compoundMeta={compoundMeta}
                      cellLineMeta={cellLineMeta}
                      plasmidMeta={plasmidMeta}
                      customCmpds={customCmpds}
                      customCellLines={customCellLines}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrProbes={nmrProbes}
                      nmrInstruments={nmrInstruments}
                      nmrExperiments={nmrExperiments}
                      onSelectResource={(id, type) => {
                        setActiveLibrarySelection({ id, type });
                        setTimeout(() => {
                          const el = document.getElementById(`section-${type}`);
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }, 150);
                      }}
                      onDeleteResources={deleteResources}
                      onImportLibrary={importLibrary}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-compound" title="Compound Sequence / Structure" subtitle="Define sequence, SMILES, modifications, MW." defaultOpen={activeLibrarySelection.type === 'compound'}>
                    <CompoundDefinitionSection
                      compoundOptions={allCmpds}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      compoundMeta={compoundMeta}
                      setCompoundMeta={setCompoundMeta}
                      selectedId={activeLibrarySelection.type === 'compound' ? activeLibrarySelection.id : null}
                      onSelect={(id) => setActiveLibrarySelection({ id, type: 'compound' })}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-cellLine" title="Cell Line Definitions" subtitle="Define organism, tissue, and culture medium." defaultOpen={activeLibrarySelection.type === 'cellLine'}>
                    <CellLineDefinitionSection
                      cellLineOptions={allCellLines}
                      customCellLines={customCellLines}
                      setCustomCellLines={setCustomCellLines}
                      cellLineMeta={cellLineMeta}
                      setCellLineMeta={setCellLineMeta}
                      selectedId={activeLibrarySelection.type === 'cellLine' ? activeLibrarySelection.id : null}
                      onSelect={(id) => setActiveLibrarySelection({ id, type: 'cellLine' })}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-plasmid" title="Plasmid Definitions" subtitle="Define backbone, promoters, resistance, and sequences." defaultOpen={activeLibrarySelection.type === 'plasmid'}>
                    <PlasmidDefinitionSection
                      plasmidMeta={plasmidMeta}
                      setPlasmidMeta={setPlasmidMeta}
                      selectedId={activeLibrarySelection.type === 'plasmid' ? activeLibrarySelection.id : null}
                      onSelect={(id) => setActiveLibrarySelection({ id, type: 'plasmid' })}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-solvent" title="Solvents & Media" subtitle="Define solvents that appear in dropdowns across all pages." defaultOpen={activeLibrarySelection.type === 'solvent'}>
                    <SolventsManager solvents={solvents} setSolvents={setSolvents} selectedId={activeLibrarySelection.type === 'solvent' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'solvent', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-buffer" title="Buffers" subtitle="Define buffers with optional description (e.g. PBS pH 7.4)." defaultOpen={activeLibrarySelection.type === 'buffer'}>
                    <BuffersManager buffers={buffers} setBuffers={setBuffers} selectedId={activeLibrarySelection.type === 'buffer' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'buffer', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-additive" title="Additives" subtitle="Define additives (NaN3, DTT, EDTA...) for Experimental Conditions." defaultOpen={activeLibrarySelection.type === 'additive'}>
                    <AdditivesManager additives={additives} setAdditives={setAdditives} selectedId={activeLibrarySelection.type === 'additive' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'additive', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-nmrProbe" title="NMR Probes" subtitle="Define probe name, type, subtype, field, diameter, cryo, and sample state." defaultOpen={activeLibrarySelection.type === 'nmrProbe'}>
                    <NMRProbesManager nmrProbes={nmrProbes} setNmrProbes={setNmrProbes} selectedId={activeLibrarySelection.type === 'nmrProbe' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrProbe', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-nmrInstrument" title="NMR Instruments" subtitle="Define spectrometers with frequency and available probes." defaultOpen={activeLibrarySelection.type === 'nmrInstrument'}>
                    <NMRInstrumentsManager nmrInstruments={nmrInstruments} setNmrInstruments={setNmrInstruments} nmrProbes={nmrProbes} selectedId={activeLibrarySelection.type === 'nmrInstrument' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrInstrument', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-nmrExperiment" title="NMR Experiments / Pulse Programs" subtitle="Define pulse programs: nuclei, dimensions, and custom acquisition parameters." defaultOpen={activeLibrarySelection.type === 'nmrExperiment'}>
                    <NMRExperimentsManager nmrExperiments={nmrExperiments} setNmrExperiments={setNmrExperiments} selectedId={activeLibrarySelection.type === 'nmrExperiment' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrExperiment', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-pymol" title="PyMOL Scripts" subtitle="Reusable rendering scripts offered as a drop-down in the 3D molecule viewers (🧪 Selections & PyMOL → Load script).">
                    <PyMOLScriptsSection />
                  </CollapsibleSection>

                </div>
              </div>
  );
};
