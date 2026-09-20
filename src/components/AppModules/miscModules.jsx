/* =========================================================================
   src/components/AppModules/miscModules.jsx
   Small module screens (Lab Notebook, Calculations, Publications, Image
   Builder) extracted from App.jsx. Props-only.
   ========================================================================= */

import React, { lazy } from 'react';
import { Calculations } from './calculationsModule';
import { ImageBuilder } from '../ImageBuilder';
const LabNotebook = lazy(() => import('../LabNotebook').then(m => ({ default: m.LabNotebook })));
const PublicationsSection = lazy(() => import('../Publications').then(m => ({ default: m.PublicationsSection })));

export const NotebookModule = ({
  tests, allCellLines, testCategories, setActiveTestId, setCurrentModule,
  customConc, cmpColors, allCmpds, customFields, operatorNames, plasmidMeta,
  solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments, currentUser
}) => (

              <div className="flex-1 overflow-hidden relative flex flex-col h-full w-full">
                <LabNotebook
                  tests={tests}
                  allCellLines={allCellLines}
                  testCategories={testCategories}
                  jumpToTest={(id) => {
                    setActiveTestId(id);
                    setCurrentModule('active-test');
                  }}
                  customConc={customConc}
                  cmpColors={cmpColors}
                  allCmpds={allCmpds}
                  customFields={customFields}
                  operators={operatorNames}
                  plasmidMeta={plasmidMeta}
                  solvents={solvents}
                  buffers={buffers}
                  additives={additives}
                  nmrInstruments={nmrInstruments}
                  nmrProbes={nmrProbes}
                  nmrExperiments={nmrExperiments}
                  currentUser={currentUser}
                />
              </div>
);

export const CalculationsModule = ({
  compoundMeta, plasmidMeta, solvents, buffers, additives,
  allCmpds, calculationEntries, setCalculationEntries, currentUser, datasetDrivePath
}) => {
                const combinedMeta = { ...compoundMeta };
                Object.keys(plasmidMeta || {}).forEach(k => { if(!combinedMeta[k]) combinedMeta[k] = plasmidMeta[k]; });
                (solvents || []).forEach(s => { if(s.name && !combinedMeta[s.name]) combinedMeta[s.name] = s; });
                (buffers || []).forEach(b => { if(b.name && !combinedMeta[b.name]) combinedMeta[b.name] = b; });
                (additives || []).forEach(a => { if(a.name && !combinedMeta[a.name]) combinedMeta[a.name] = a; });
                
                const combinedOptions = [...new Set([
                    ...allCmpds,
                    ...Object.keys(plasmidMeta || {}),
                    ...(solvents || []).map(s => s.name),
                    ...(buffers || []).map(b => b.name),
                    ...(additives || []).map(a => a.name)
                ].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

                return (
                  <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
                    <Calculations
                      compoundOptions={combinedOptions}
                      compoundMeta={combinedMeta}
                      calculationEntries={calculationEntries}
                      setCalculationEntries={setCalculationEntries}
                      currentUser={currentUser}
                      datasetDrivePath={datasetDrivePath}
                    />
                  </div>
                );
};

export const PublicationsModule = ({ operatorNames, tests, currentUser }) => (
          <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
            <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
              <PublicationsSection
                scientists={[...new Set([
                  ...operatorNames,
                  ...(tests || []).map((t) => t.operator).filter(Boolean)
                ])]}
                defaultScientist={currentUser?.name || ''}
                currentUser={currentUser}
              />
            </div>
          </div>
);

// The Image Builder now has its OWN page (sidebar entry right below
// Publications, same hierarchical level) instead of being appended to the
// bottom of the Publications page: composing a figure no longer means
// scrolling past the whole publication list. `projectId` selects the project
// library + saved canvas (the builder persists its state per project).
// `openCanvasId` is the saved canvas the project page asked to reopen (its
// "🖼 Saved canvases" link) and `onCanvasOpened` clears that request once it
// has been loaded; `onBackToProject` returns to the project page.
// `currentUser` is the identity the builder checks against a project's access
// list: the figures of a project are shown only to the people who may open it.
export const ImageBuilderModule = ({ projectId, jumpToTest, openCanvasId = null, onCanvasOpened, onBackToProject, currentUser = null }) => (
          <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
            <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
              <ImageBuilder projectId={projectId} jumpToTest={jumpToTest}
                            openCanvasId={openCanvasId} onCanvasOpened={onCanvasOpened}
                            onBackToProject={onBackToProject} currentUser={currentUser} />
            </div>
          </div>
);
