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
import {
  UI_CUSTOM_ACCENTS, UI_CUSTOM_NEUTRALS, UI_SKIN_CUSTOM, UI_SKIN_DEFAULT, UI_SKINS,
  readUiCustomSkin, readUiSkin, saveUiCustomSkin, saveUiSkin, uiSkinCustomVars
} from '../../utils/uiSkin';
/* LE FOND DES PAGES voyage avec l'accent : il vit dans le MÊME réglage (une
   couleur et un nom de motif, à côté de l'accent et de la famille neutre), donc
   `saveUiCustomSkin` l'écrit et l'applique, et `uiSkinCustomVars` le pose sur la
   miniature comme sur <html>. */
import {
  UI_BG_DEFAULT, UI_BG_PATTERN_DEFAULT, UI_BG_PATTERNS, UI_BG_PRESETS,
  oklchToHex, uiBgStops
} from '../../utils/uiSkin';

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

/* ── Interface skin ────────────────────────────────────────────────────────
   A skin is ONLY a set of CSS variables (src/index.css, one block per skin id)
   that Tailwind's colour utilities all read — `bg-slate-800` really is
   `var(--color-slate-800)`, `text-white` really is `var(--color-white)`. So a
   skin repaints the whole program without touching one component, and the
   SAME attribute re-paints any element: the miniature below carries
   `data-skin` and is drawn with the very classes of the real interface
   (a chrome bar, a card, an accent button), so what the button shows IS what
   the program will look like. The value belongs to the OPERATOR who chose it
   (utils/uiSkin.js; the skin of the COMPUTER is its fallback, and the starter
   value for an operator who has never chosen one), and main.jsx applies the
   one of the session before the first paint. Every user sees the control — and
   the choice follows HIM from one computer to the next, like the other browser
   keys. */
const SkinMiniature = ({ skin, tone = '', pattern = '', style = null }) => (
  <span
    data-skin={skin.id === UI_SKIN_DEFAULT ? undefined : skin.id}
    data-tone={tone || undefined}
    data-pattern={pattern && pattern !== UI_BG_PATTERN_DEFAULT ? pattern : undefined}
    style={style || undefined}
    className="flex w-40 flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 no-print"
  >
    <span className="rounded bg-slate-800 px-1.5 py-1 text-center text-[10px] font-bold text-white">
      Lab Workspace
    </span>
    <span className="rounded-md border border-slate-200 bg-white p-1.5">
      <span className="block text-[10px] font-bold text-slate-700">Experiment 12</span>
      <span className="block text-[10px] text-slate-400">2026-10-03</span>
      <span className="mt-1 block rounded bg-blue-600 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
        Save
      </span>
    </span>
  </span>
);

/* `operator` = l'opérateur connecté (null quand personne ne l'est) : LA PEAU
   LUI APPARTIENT (utils/uiSkin.js) — on lit et on écrit donc SA clé, et sur un
   poste partagé chacun retrouve la sienne après s'être connecté. */
const SkinControl = ({ operator = null }) => {
  const [skin, setSkin] = React.useState(() => readUiSkin(operator));
  /* LE RÉGLAGE DE LA PEAU PERSONNALISÉE (accent + famille neutre) : lu une fois,
     écrit à chaque clic — `saveUiCustomSkin` applique AUSSITÔT quand c'est la
     peau en service, donc la miniature et le programme bougent ensemble. */
  const [custom, setCustom] = React.useState(() => readUiCustomSkin(operator));
  /* L'opérateur peut changer PENDANT que le panneau est ouvert (connexion, puis
     fermeture de session, depuis la barre latérale) : la commande se relit alors
     sur la peau du nouvel opérateur — sinon elle afficherait celle du poste à
     côté de pages peintes avec la sienne. */
  React.useEffect(() => {
    setSkin(readUiSkin(operator));
    setCustom(readUiCustomSkin(operator));
  }, [operator]);
  const pick = (id) => { setSkin(id); saveUiSkin(id, operator); };
  const setAccent = (color) => setCustom(saveUiCustomSkin({ ...custom, accent: color }, operator));
  const setNeutral = (neutral) => setCustom(saveUiCustomSkin({ ...custom, neutral }, operator));
  /* LE FOND DES PAGES : une couleur (n'importe laquelle — elle est RAMENÉE DANS
     LA BANDE de lisibilité par uiSkin.js, donc la page ne peut pas devenir
     illisible) et un motif sobre. `UI_BG_DEFAULT` = la page de la famille
     neutre choisie, c'est-à-dire celle que le programme livre. */
  const setBg = (bg) => setCustom(saveUiCustomSkin({ ...custom, bg }, operator));
  const setPattern = (pattern) => setCustom(saveUiCustomSkin({ ...custom, pattern }, operator));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {UI_SKINS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pick(s.id)}
            title={`${s.label} — ${s.hint}. Repaints every page of the program at once, and is remembered for the operator who picks it.`}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 p-2 shadow-sm transition-colors ${
              skin === s.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-slate-300 bg-white hover:border-slate-400'
            }`}
          >
            <SkinMiniature
              skin={s}
              tone={s.id === UI_SKIN_CUSTOM ? custom.neutral : ''}
              pattern={s.id === UI_SKIN_CUSTOM ? custom.pattern : ''}
              style={s.id === UI_SKIN_CUSTOM ? uiSkinCustomVars(custom) : null}
            />
            <span className="flex flex-col items-center">
              <span className="text-xs font-bold text-slate-700">{s.label}</span>
              <span className="text-[10px] text-slate-500">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {skin === UI_SKIN_CUSTOM && (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-slate-300 bg-white p-3">
          <span className="text-xs font-bold text-slate-700">Custom skin — the accent</span>
          <div className="flex flex-wrap items-center gap-2">
            {UI_CUSTOM_ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccent(a.color)}
                title={`${a.label} accent — the whole accent ramp is derived from this one colour`}
                className={`h-7 w-7 rounded-full border-2 shadow-sm ${
                  custom.accent === a.color ? 'border-slate-800' : 'border-white'
                }`}
                style={{ backgroundColor: a.color }}
              />
            ))}
            <label
              title="Any colour at all: the eleven accent stops are derived from it, so the palette stays coherent."
              className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"
            >
              <input
                type="color"
                value={custom.accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-7 w-10 cursor-pointer rounded border border-slate-300 bg-white"
              />
              {custom.accent}
            </label>
          </div>
          <span className="text-xs font-bold text-slate-700">…and the neutral family</span>
          <div className="flex flex-wrap gap-2">
            {UI_CUSTOM_NEUTRALS.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setNeutral(n.id)}
                title={`Neutral family: ${n.label} — it repaints the pages, the cards, the borders and the inks.`}
                className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${
                  custom.neutral === n.id
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-bold text-slate-700">…and the page background</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBg(UI_BG_DEFAULT)}
              title={`The page the program ships with — the lightest grey of the neutral family above (${custom.neutral}).`}
              className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${
                custom.bg === UI_BG_DEFAULT
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {custom.neutral} page
            </button>
            {UI_BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setBg(p.hex)}
                title={`${p.label} page — a pastel page, kept light enough for the ink the program writes on it.`}
                className={`h-7 w-7 rounded-full border-2 shadow-sm ${
                  custom.bg === p.hex ? 'border-slate-800' : 'border-white'
                }`}
                style={{ backgroundColor: p.hex }}
              />
            ))}
            <label
              title="Any colour at all: it is pulled back into a legible band (lightness, chroma, and the sRGB gamut), so the writing on the page always stays readable."
              className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"
            >
              <input
                type="color"
                value={custom.bg || oklchToHex(uiBgStops(UI_BG_DEFAULT).page)}
                onChange={(e) => setBg(e.target.value)}
                className="h-7 w-10 cursor-pointer rounded border border-slate-300 bg-white"
              />
              {custom.bg || 'page colour'}
            </label>
          </div>
          <span className="text-xs font-bold text-slate-700">…and a sober pattern</span>
          <div className="flex flex-wrap gap-2">
            {UI_BG_PATTERNS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPattern(p.id)}
                title={`${p.label} — ${p.hint}. A few CSS hairlines (nothing to download), painted on the pages only, and never on a printed document.`}
                className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${
                  custom.pattern === p.id
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-500 leading-relaxed">
            The accent repaints every button, link, highlight and chip; the neutral family repaints the
            pages, the cards, the borders and the inks. The eleven accent stops are <b>derived from the
            one colour</b> you pick — the same shape as the shipped ramp — so a custom skin keeps the
            contrast of the program instead of producing an unreadable mix. The page background is the one
            colour you can pick freely: whatever you choose is <b>pulled back into a legible band</b>
            (lightness, chroma, sRGB gamut), and the panels that sit on the page follow it, so the titles
            and captions the program writes there stay readable. The pattern is a few CSS hairlines drawn
            on the page — and never on a printed document.
          </span>
        </div>
      )}
      <p className="text-xs text-slate-500 leading-relaxed">
        The choice applies <b>immediately to every page</b> and is remembered{' '}
        {operator ? (
          <>
            <b>for {operator.name || 'the signed-in operator'}</b> — on every computer he signs in
            to, and it changes nothing for anybody else who uses this one.
          </>
        ) : (
          <>
            for this <b>computer</b>: nobody is signed in, so this is the palette of the entry
            screen. An operator who signs in gets HIS own skin back, and the skin he chooses is
            kept for him, not for the machine.
          </>
        )}
      </p>
      <p className="text-xs text-slate-500 leading-relaxed">
        A skin repaints the program — colours, inks, borders — and nothing else: the layout,
        the display scale, the printed documents and the figures keep their own settings.
        A <b>dark</b> skin (Night, Carbon) repaints the <b>pages themselves</b>: the
        background goes dark and the writing turns light so it stays readable, while
        printing still goes out on white paper.
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
  datasetsList, deleteDataset, deleteEmptyDatasets, datasetTitle,
  // Vrai quand les connexions passent par le serveur de jetons : les mots de
  // passe sont vérifiés par le serveur, un changement doit donc y être envoyé.
  serverMode = false
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
                    title="Interface skin — the colours of the whole program"
                    subtitle="Repaints every page, modal, table and badge at once — the neutral greys, the ink and the accent colour — by restating the palette Tailwind's classes read. Graphite drops the blue cast, Warm paper turns the greys warm, Indigo, Violet, Purple, Red and Rose move the accent, Dimmed softens the white for long sessions, High contrast deepens every ink and border, and Custom lets you pick your own accent and neutral family. The choice is immediate, belongs to the OPERATOR who picks it (each one has his own, on every computer he signs in to; when nobody is signed in it is the skin of this computer), and every user sees it. The PAGE BACKGROUND, too: pick the colour of the pages — any colour, since it is pulled back into a band that keeps the writing readable — and a sober pattern (grid, dots, ruled lines, slanted hairlines) drawn with CSS, on screen only."
                    defaultOpen={false}
                  >
                    <SkinControl operator={currentUser} />
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
                      serverMode={serverMode}
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
