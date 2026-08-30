/* =========================================================================
   src/components/AppModules/miscModules.jsx
   Small module screens (Lab Notebook, Calculations, Publications) extracted
   from App.jsx. Props-only.
   ========================================================================= */

import React, { lazy } from 'react';
import { Calculations } from './calculationsModule';
import { FiguresSlidesSection } from '../FiguresSlides';
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
  allCmpds, calculationEntries, setCalculationEntries, currentUser
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
                    />
                  </div>
                );
};

export const PublicationsModule = ({ operatorNames, tests, currentUser, projectId = 'global' }) => (

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
                  <FiguresSlidesSection tests={tests} projectId={projectId} />
                </div>
              </div>
);
