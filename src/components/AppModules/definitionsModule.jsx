/* =========================================================================
   src/components/AppModules/definitionsModule.jsx
   Definitions & Labels module (extracted from App.jsx). Props-only.
   ========================================================================= */

import React from 'react';
import { CollapsibleSectionPanel as CollapsibleSection } from '../ui';
import { LibraryDirectory } from './libraryDirectory';
import { CellLineDefinitionSection, PlasmidDefinitionSection } from './librarySections';
import { CompoundDefinitionSection } from './compoundDefinitionSection';
import { SolventsManager, BuffersManager, AdditivesManager, NMRProbesManager, NMRInstrumentsManager, NMRExperimentsManager } from '../DefinitionsExtra';
import { CustomMetadataFieldsManager, MandatoryParametersManager, ScientistsOperatorsManager } from './definitionsManagers';
import { DatabaseCleanupManager } from './storageModules';
import { normalizeOperators } from '../../utils/auth';

export const DefinitionsModule = ({
  allCmpds, setActiveLibrarySelection, activeLibrarySelection,
  allCellLines,
  compoundMeta, setCompoundMeta, cellLineMeta, setCellLineMeta,
  plasmidMeta, setPlasmidMeta, customCmpds, setCustomCmpds,
  customCellLines, setCustomCellLines,
  solvents, setSolvents, buffers, setBuffers, additives, setAdditives,
  nmrProbes, setNmrProbes, nmrInstruments, setNmrInstruments, nmrExperiments, setNmrExperiments,
  customFields, mandatoryRules, setMandatoryRules,
  mandatoryBehavior, setMandatoryBehavior,
  operators, setOperators, authSettings, setAuthSettings,
  currentUser, tests, setTests, handleSetCustomFields,
  datasetsList, deleteDataset, deleteEmptyDatasets
}) => (

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

                  <CollapsibleSection
                    title="Scientists / Operators"
                    subtitle={currentUser?.role === 'superuser'
                      ? "Manage scientists, roles, passwords, and access control settings."
                      : "Scientists defined in this dataset. Log in or contact a superuser to manage."}
                    defaultOpen={false}
                  >
                    <ScientistsOperatorsManager
                      operators={normalizeOperators(operators)}
                      setOperators={setOperators}
                      authSettings={authSettings}
                      setAuthSettings={setAuthSettings}
                      currentUser={currentUser}
                    />
                  </CollapsibleSection>


  <CollapsibleSection title="Custom Metadata Fields" subtitle="Add custom fields for plate, NMR, CD, Cloning, or all tabs — and target the exact subsection of each page they appear in." defaultOpen={false}>
                    <CustomMetadataFieldsManager customFields={customFields} setCustomFields={handleSetCustomFields} />

                    <div className="mt-6 pt-6 border-t border-slate-200">
                      <MandatoryParametersManager
                        mandatoryRules={mandatoryRules}
                        setMandatoryRules={setMandatoryRules}
                        mandatoryBehavior={mandatoryBehavior}
                        setMandatoryBehavior={setMandatoryBehavior}
                      />
                    </div>
                  </CollapsibleSection>

<CollapsibleSection title="Database Cleanup & Data management" subtitle="Rename items globally, merge duplicates, and delete datasets — this is the only area of the program where data deletion is available." defaultOpen={false}>
                     <DatabaseCleanupManager 
                        tests={tests}
                        setTests={setTests}
                        allCmpds={allCmpds}
                        allCellLines={allCellLines}
                        setCustomCmpds={setCustomCmpds}
                        setCompoundMeta={setCompoundMeta}
                        compoundMeta={compoundMeta}
                        setCustomCellLines={setCustomCellLines}
                        setCellLineMeta={setCellLineMeta}
                        cellLineMeta={cellLineMeta}
                        datasetsList={datasetsList}
                        deleteDataset={deleteDataset}
                        deleteEmptyDatasets={deleteEmptyDatasets}
                     />
                  </CollapsibleSection>

                </div>
              </div>
);
