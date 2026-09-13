/* =========================================================================
   src/components/AppModules/settingsModule.jsx
   Settings module (scientists, custom metadata, database cleanup and Drive
   file management), extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';
import { CollapsibleSectionPanel as CollapsibleSection } from '../ui';
import { CustomMetadataFieldsManager, MandatoryParametersManager, ScientistsOperatorsManager } from './definitionsManagers';
import { DatabaseCleanupManager } from './storageModules';
import { DriveImageMigration } from '../DriveImageMigration';
import { CloudStorageSettings } from './cloudStorageSettings';
import { FigureStylePanel } from '../FigureStylePanel';
import { normalizeOperators } from '../../utils/auth';
import { openDrive } from '../../utils/driveNaming';
import { UI_SCALE_PRESETS, readUiScale, saveUiScale } from '../../utils/uiScale';

/* ── Display scale ─────────────────────────────────────────────────────────
   Tailwind v4 computes every text size and every spacing step from the ROOT
   character size (`text-sm` = 0.875rem, `p-3` = 0.75rem, the sidebar `w-64` =
   16rem), so ONE number rescales the whole program: characters, paddings,
   gaps, sidebars, modals — every page at once. src/utils/uiScale.js holds the
   value and main.jsx applies it before the first render. It is a per-BROWSER
   preference (the size of a screen is not a property of the dataset), which is
   why this control is shown to EVERY user and not only to the superuser. */
const DisplayScaleControl = () => {
  const [scale, setScale] = React.useState(() => readUiScale());
  const pick = (px) => { setScale(px); saveUiScale(px); };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {UI_SCALE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pick(p.px)}
            title={`${p.label} — about ${p.hint} of the standard size, applied to every page of the program`}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-colors ${
              scale === p.px
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {p.label} <span className="opacity-70 font-semibold">{p.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        The change applies <b>immediately to every page</b> and is remembered for this browser
        only. A few elements sized in <b>pixels</b> (some minimum table widths, the chart boxes
        and the Image Builder canvas) keep their absolute size: they simply take a little more
        room than the rest.
      </p>
    </div>
  );
};

export const SettingsModule = ({
  operators, setOperators, authSettings, setAuthSettings,
  currentUser, tests, setTests, handleSetCustomFields,
  customFields, mandatoryRules, setMandatoryRules,
  mandatoryBehavior, setMandatoryBehavior,
  allCmpds, allCellLines,
  setCustomCmpds, setCompoundMeta, compoundMeta,
  setCustomCellLines, setCellLineMeta, cellLineMeta,
  datasetsList, deleteDataset, deleteEmptyDatasets, datasetTitle
}) => {
  /* Dans un dataset scientifique, les comptes scientist non superutilisateurs
     ne voient que la section « Scientists / Operators » (en lecture seule) ;
     les autres sections de réglages (métadonnées personnalisées, nettoyage de
     la base, stockage cloud, fichiers Google Drive) sont réservées au
     superutilisateur. */
  const isSuper = !!currentUser && currentUser.role === 'superuser';

  return (
              <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
                <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">

                  <CollapsibleSection
                    title="Display scale — character size of every page"
                    subtitle="Rescales the whole program at once — characters, paddings, gaps, the sidebar, the modals — by moving the root character size every Tailwind size is computed from. Use it when the pages are too large (or too small) for your screen. Remembered for this browser only."
                    defaultOpen={false}
                  >
                    <DisplayScaleControl />
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

                  {isSuper && (
                  <>
                  <CollapsibleSection
                    title="Figure style — uniform fonts & character sizes"
                    subtitle="One global character size for every chart and spectrum of every experiment: axis / tick characters, peak labels, x-label rotation and the plot-box ratio — plus the axis-title style (bold / italic), the number of decimals, the format and the scale of the axis numbers (exponential notation, logarithmic scale) — the last two set PER AXIS (X / Y) and PER KIND of figure (spectra, per-atom plots, per-residue plots, graphs) — and the ink of the figure: the colour of the axis numbers, the colour of the axis titles and the thickness of the curves. Applied per page with the 🎨 Figure style button (bottom-left of each experiment page) before the 📷 figures are captured, so figures of different experiments line up in one Image Builder slide / PDF. The box at the top SAVES your configurations: keep the oversized style a set of figures needs next to your everyday one and switch between them in one click."
                    defaultOpen={false}
                  >
                    <FigureStylePanel />
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

                   <CollapsibleSection title="Cloud storage — Google Drive or Nextcloud" subtitle="Choose where files and figures are stored: Google Drive (OAuth) or your Nextcloud server (WebDAV). One global switch applies to every upload." defaultOpen={false}>
                      <CloudStorageSettings />
                   </CollapsibleSection>

                   <CollapsibleSection title="Google Drive folder" subtitle="Open the Lab Workspace Google Drive folder in a new browser tab — visible to the superuser only." defaultOpen={false}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <span className="text-xs text-slate-500 leading-relaxed">
                          Opens the Google Drive folder currently used by this app (workspace root, dataset folders and
                          backups) in a new tab.
                        </span>
                        <button
                          type="button"
                          onClick={openDrive}
                          className="shrink-0 text-xs font-bold text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                        >
                          Open ↗
                        </button>
                      </div>
                   </CollapsibleSection>

                   <CollapsibleSection title="Files on Google Drive" subtitle="Move misplaced Drive files into the canonical folders — test attachments (figures, ⭐ starred items, PDFs/documents, links) into Lab Workspace/<dataset>/projects/<project>/<test>/<instance>/Report, and image-library figures (captures, Image Builder canvases) into Lab Workspace/<dataset>/projects/<project>/images." defaultOpen={false}>
                      <DriveImageMigration tests={tests} setTests={setTests} datasetTitle={datasetTitle} />
                   </CollapsibleSection>
                  </>
                  )}

                  {!isSuper && (
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 leading-relaxed">
                      🔒 Les autres sections de réglages — champs de métadonnées personnalisés,
                      nettoyage &amp; gestion de la base de données, stockage cloud
                      (Google Drive / Nextcloud), fichiers de tests sur Google Drive — sont
                      réservées au superutilisateur.
                    </div>
                  )}

                </div>
              </div>
  );
};
