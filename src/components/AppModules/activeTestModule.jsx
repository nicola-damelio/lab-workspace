/* =========================================================================
   src/components/AppModules/activeTestModule.jsx
   Active Test detail view, extracted from App.jsx. Props-only.
   ========================================================================= */

import React, { lazy, useRef, useState, useEffect } from 'react';
import { BoxDetail } from '../Storage';
import { CLASSIFICATION_MAP, PRIMARY_CATEGORIES, EXPERIMENT_TYPES } from '../../data/testTypes';
import { markAttachmentsDeleted, renameDriveFilesFor, deleteTestDriveFolder } from '../../utils/driveUpload';
import { renameStorageBoxDriveFolder, tidyStorageFiles } from '../../utils/storageDrive';
import { removeTestFcsBlobs } from '../../utils/fcsBlobStore';
import { setSectionsCommand } from '../ui';
// Les champs obligatoires d'une BOÎTE (nom, propriétaire, date — sur la boîte
// et dans chaque puits rempli) : voir utils/storageBoxes.js.
import { describeBoxIssues, requiredBoxIssues } from '../../utils/storageBoxes';
import { testProjectAccess, getProjectAccessForUser } from './projectsModule';
import {
  applyDataLock, clearDataLock, dataLockLabel, guardLockedInstances, isDataLocked, lockedIdSet
} from '../../utils/dataLock';
// Pourquoi CETTE page refuse d'écrire (droits « view » du projet / donnée
// gelée) — et la règle qui oblige à le DIRE à l'écran : voir utils/readOnly.js.
import { decidingProjectAccess, experimentReadOnly, readOnlyLabel } from '../../utils/readOnly';
import { blankConditionName, withExperimentContext } from '../../utils/conditionInstance';
import { Icon } from '../Icons';
// Lazy renderers (kept as dynamic imports so each stays its own chunk).
const NMRTestRenderer = lazy(() => import('../NMRTestRenderer').then(m => ({ default: m.NMRTestRenderer })));
const PlateTestRenderer = lazy(() => import('../PlateTestRenderer').then(m => ({ default: m.PlateTestRenderer })));
const CDTestRenderer = lazy(() => import('../CDTestRenderer').then(m => ({ default: m.CDTestRenderer })));
const SSNMRTestRenderer = lazy(() => import('../ssNMRTestRenderer').then(m => ({ default: m.SSNMRTestRenderer })));
const NMRFittingsTestRenderer = lazy(() => import('../NMRFittingsTestRenderer').then(m => ({ default: m.NMRFittingsTestRenderer })));
const DOSYTestRenderer = lazy(() => import('../DOSYTestRenderer').then(m => ({ default: m.DOSYTestRenderer })));
const CloningTestRenderer = lazy(() => import('../CloningTestRenderer').then(m => ({ default: m.CloningTestRenderer })));
const ProteinExpressionTestRenderer = lazy(() => import('../ProteinExpressionTestRenderer').then(m => ({ default: m.ProteinExpressionTestRenderer })));
const DockingTestRenderer = lazy(() => import('../DockingTestRenderer'));
const FlowCytometryTestRenderer = lazy(() => import('../FlowCytometryTestRenderer').then(m => ({ default: m.FlowCytometryTestRenderer })));
const MicroscopyTestRenderer = lazy(() => import('../MicroscopyTestRenderer').then(m => ({ default: m.MicroscopyTestRenderer })));

/* Clé sessionStorage du repli de l'en-tête d'expérience : « ▸ More details » /
   « ▾ Fewer details ». Le choix suit l'onglet (comme la mémoire « où j'étais »)
   et survit donc aussi au re-render du 🔄 Refresh. */
const EXPERIMENT_HEADER_KEY = 'labExperimentHeaderOpen';

export const ActiveTestModule = ({
  activeTestId, additives, allCellLines, allCmpds, appClipboard, buffers,
  cmpColors, compoundMeta, createEmptyTest, currentUser, customCmpds, customConc, customFields,
  datasetProtocols, expandedGroups, jumpToTest, mandatoryBehavior, mandatoryRules,
  molecules, nmrExperiments, nmrInstruments, nmrProbes, operatorNames, plasmidMeta,
  returnTarget, setActiveStorageId, setReturnTarget, setActiveTestId, setAppClipboard,
  setCmpColors, setCurrentModule, setCurrentProjectId,
  setCustomCmpds, setCustomConc, setExpandedGroups, setMoveModal, setTests,
  solvents, storages, testCategories, tests, unlockedTestIds,
  MDTestRenderer,
  // « 🔄 Refresh » de CETTE page (fourni par App) et l'horodatage du dernier
  // rafraîchissement : App RELIT d'abord la source partagée (cloud, sinon la
  // copie du Drive), puis re-monte le contenu de la page — la barre fine
  // confirme l'opération, et l'utilisateur ne quitte jamais sa page.
  // `refreshState` porte ce que la relecture a donné : { busy: true } pendant,
  // puis { ok, text }. Un rafraîchissement muet ferait croire que le bouton ne
  // fait rien — c'est exactement le défaut corrigé ici.
  onRefreshPage = () => {},
  refreshedAt = 0,
  refreshState = null
}) => {
                const dragInstanceId = React.useRef(null); // dragged instance tab (for reordering)
                const testNameBeforeEditRef = useRef(null); // Drive-file rename tracking
                const instanceNameBeforeEditRef = useRef(null); // Drive-file rename tracking (instance)
                // Top-bar "Expand all / Collapse all" toggle for the page sections.
                const [allSectionsOpen, setAllSectionsOpen] = useState(false);
                // Switching to a different test resets the toggle (its sections
                // all start collapsed again).
                useEffect(() => { setAllSectionsOpen(false); }, [activeTestId]);
                // ── COLLAPSIBLE experiment chrome ──────────────────────────────
                // The top bar (identity + identification fields + Date/Conditions)
                // is worth a third of the screen, so it is FOLDED by default: the
                // thin bar above keeps ◀ Back, the name, the condition, 🔄 Refresh,
                // ▸ Expand all and this toggle. The choice is remembered for the
                // browser session (and therefore survives the 🔄 Refresh re-mount).
                const [headerOpen, setHeaderOpen] = useState(() => {
                  try { return sessionStorage.getItem(EXPERIMENT_HEADER_KEY) === '1'; } catch { return false; }
                });
                useEffect(() => {
                  try { sessionStorage.setItem(EXPERIMENT_HEADER_KEY, headerOpen ? '1' : '0'); } catch { /* storage unavailable */ }
                }, [headerOpen]);
                // Confirmation of « 🔄 Refresh » : App re-monte le contenu de la
                // page, cet effet repart donc sur un montage neuf et le message
                // s'efface tout seul.
                const [showRefreshDone, setShowRefreshDone] = useState(false);
                useEffect(() => {
                  if (!refreshedAt) return undefined;
                  setShowRefreshDone(true);
                  const id = setTimeout(() => setShowRefreshDone(false), 2500);
                  return () => clearTimeout(id);
                }, [refreshedAt]);
                const activeTest = tests.find((t) => t.id === activeTestId);

                if (!activeTest) return <div className="p-6">Test not found.</div>;

                // ── Auth gate ─────────────────────────────────────
                const isSuperuserSession = currentUser?.role === 'superuser';
                // An experiment is a GROUP of instances that share the same `name`:
                // the sibling "Date / Conditions" chips and every group operation
                // (rename, reorder, duplicate instance, delete experiment) act on
                // the whole group. Access is therefore checked at the group level —
                // once the user may legitimately open any instance of the
                // experiment, switching to a sibling instance must not bounce back
                // to the tests list (that check has to hold for co-scientists too).
                const isBoxGroup = activeTest.type === 'plate-9x9box';
                const groupName = isBoxGroup || !(activeTest.name && activeTest.name.trim())
                  ? null
                  : activeTest.name;
                const groupTests = groupName
                  ? tests.filter((t) => t.name === groupName)
                  : [activeTest];
                // True when the user may open this instance: an assigned scientist
                // (operator or co-scientist), an unlocked test, a project the user
                // belongs to (same rights as the project), a superuser session, or
                // an instance without any assigned scientist (boxes / unassigned).
                const isTestAccessible = (test) => {
                  if (!test) return false;
                  if (isSuperuserSession) return true;
                  if (!test.operator) return true;
                  if (currentUser) {
                    const scientists = [test.operator, ...(test.coScientists || [])];
                    if (scientists.includes(currentUser.name)) return true;
                    if (testProjectAccess(test, currentUser.name)) return true;
                  }
                  return unlockedTestIds.has(test.id);
                };
                if (!groupTests.some(isTestAccessible)) {
                  // No instance of this experiment is accessible (e.g. stale deep
                  // link): redirect to the test list.
                  setCurrentModule('tests');
                  return null;
                }
                // Project permission on the ACTIVE instance (instances of a group
                // are normally linked to the same projects). The project that
                // DECIDES is kept as well: the read-only notice below names it,
                // so the user knows which project to ask rights on (same
                // first-match rule as testProjectAccess — see utils/readOnly).
                const projectAccessMap = currentUser ? getProjectAccessForUser(currentUser.name) : {};
                const decidingProject = decidingProjectAccess(activeTest.projectNames, projectAccessMap);
                const projectPerm = decidingProject.permission;
                // Read-only enforcement: a user who only has 'view' on the linked
                // project (and is not one of the assigned scientists / a superuser /
                // the test is unlocked or unassigned) can open the experiment but
                // every update is ignored. The rule itself, and the reason it has
                // to be DISPLAYED, live in src/utils/readOnly.js; the state is
                // computed below (with the data lock, which is the other reason).
                const isAssignedScientist = !!(currentUser &&
                  (currentUser.name === activeTest.operator || (activeTest.coScientists || []).includes(currentUser.name)));
                // ─────────────────────────────────────────────────

                // ── Data lock (🔒 in the header, see src/utils/dataLock.js) ────
                // A superuser can FREEZE the data of a condition — or of every
                // condition of the experiment. For everybody else the page then
                // becomes read-only: it stays fully readable (results, plots,
                // tables) but every write funnel below restores the frozen data
                // instead of storing the change, and a copy is proposed so a
                // scientist who needs ANOTHER analysis can work on that copy.
                // Ids of EVERY frozen instance of the dataset (not only this
                // experiment's group): frozen data is frozen everywhere, so the
                // guards below also cover a write aimed at another experiment.
                const lockedIds = lockedIdSet(tests);
                const activeInstanceLocked = isDataLocked(activeTest);
                // Read-only for THIS user on THIS page — and the page SAYS it.
                // Two independent reasons refuse every write (src/utils/readOnly.js):
                //   • 'project'   — view-only rights on the project that decides;
                //   • 'data-lock' — a superuser froze this condition.
                // A refusal nobody can see is the real trap: a value just typed
                // stays on screen (nothing re-renders the stored value back) and is
                // gone at the next load. Both cases therefore render a notice.
                const access = experimentReadOnly({
                  isSuperuser: isSuperuserSession,
                  isAssignedScientist,
                  projectPerm,
                  isUnlocked: unlockedTestIds.has(activeTest.id),
                  hasOperator: !!activeTest.operator,
                  isDataLocked: activeInstanceLocked
                });
                const projectViewOnly = access.projectViewOnly;
                const dataReadOnly = access.dataReadOnly;
                const readOnlyReason = access.reason; // '' | 'project' | 'data-lock'
                // Is `instId` frozen for this user? (per-instance write guard)
                const isFrozenForMe = (instId) => !isSuperuserSession && lockedIds.has(instId);
                const allGroupLocked = groupTests.length > 0 && groupTests.every((t) => isDataLocked(t));
                const lockTargetLabel = (test) =>
                  `"${activeTest.name || 'this experiment'}" — ${test.instanceName || test.date || 'this condition'}`;
                const setDataLock = (lock, ids, what) => {
                  const ok = window.confirm(lock
                    ? `Lock the data of ${what}?\n\nEverybody except a superuser will still be able to READ it and to COPY it into a new instance, but nothing they change (import, processing, fit, comment…) is saved. Only a superuser can unlock it again.`
                    : `Unlock the data of ${what}?\n\nThe scientists will be able to edit this experiment again.`);
                  if (!ok) return;
                  setTests((prev) => applyDataLock(prev, ids, lock, currentUser?.name || 'unknown', Date.now()));
                };

                /* `targetTestId` : un calcul LANCÉ sur une condition doit écrire
                   ses résultats sur CETTE condition. Les analyses MD durent
                   plusieurs minutes, et l'utilisateur peut passer à une autre
                   condition (ou en supprimer une) entre-temps : sans cible, les
                   résultats d'une simulation atterrissaient sur la condition
                   devenue active — des valeurs calculées ailleurs apparaissaient
                   donc sur la mauvaise page (et « les données différaient »
                   d'une fenêtre à l'autre). Sans cible, rien ne change : c'est
                   la condition affichée qui est écrite. */
                const updateActiveTest = (updates, targetTestId = '') => {
                  if (projectViewOnly) return; // view-only project member — read-only (see the notice)
                  if (dataReadOnly) return;    // data frozen by a superuser — read-only (see the notice)
                  const targetId = targetTestId || activeTestId;
                  setTests((prev) =>
                    prev.map((t) => (t.id === targetId ? { ...t, ...updates } : t))
                  );
                };

                // Guarded `setTests` handed to the experiment renderers: a
                // non-superuser can never modify or delete a frozen instance,
                // but may still ADD new ones (the copies) and freely work on the
                // instances that are not frozen.
                const guardedSetTests = (updater) => {
                  if (isSuperuserSession || lockedIds.size === 0) { setTests(updater); return; }
                  setTests((prev) => {
                    const next = typeof updater === 'function' ? updater(prev) : updater;
                    return guardLockedInstances(prev, next, lockedIds);
                  });
                };

                // Renaming the experiment NAME renames the WHOLE group — all
                // sibling instances share the same `name`, so editing only the
                // active one would detach it into a 1-instance "copy" while the
                // old name keeps the other instances. Per-instance labels are
                // edited separately via instanceName.
                const handleTestNameChange = (value) => {
                  if (projectViewOnly || dataReadOnly) return; // read-only (project view / frozen data)
                  const prevName = activeTest.name;
                  if (value === prevName) return;
                  setTests((prevTests) =>
                    prevTests.map((t) =>
                      t.id === activeTestId || (!isBox && prevName && prevName.trim() && t.name === prevName)
                        ? { ...t, name: value }
                        : t
                    )
                  );
                };

                const isBox = activeTest.type === 'plate-9x9box';

                const siblingTests = isBox
                  ? []
                  : tests
                      .filter((t) => t.name === activeTest.name && t.name.trim() !== '')
                      .sort((a, b) => {
                        // User-dragged order (instanceOrder) wins; fall back to date
                        // order for datasets that never had an explicit order.
                        const oa = a.instanceOrder;
                        const ob = b.instanceOrder;
                        const hasA = Number.isFinite(oa);
                        const hasB = Number.isFinite(ob);
                        if (hasA && hasB) return oa - ob;
                        if (hasA) return -1;
                        if (hasB) return 1;
                        return (a.date || '').localeCompare(b.date || '');
                      });

                // Reorder the sibling conditions by dragging a tab onto another one.
                const reorderInstances = (dragId, targetId) => {
                  if (projectViewOnly) return; // read-only: dragging a chip is a write (disabled below)
                  if (!dragId || dragId === targetId) return;
                  setTests((prev) => {
                    const drag = prev.find((x) => x.id === dragId);
                    const target = prev.find((x) => x.id === targetId);
                    if (!drag || !target || drag.name !== target.name || !drag.name.trim()) return prev;
                    const ordered = prev
                      .filter((x) => x.name === drag.name && x.name.trim() !== '')
                      .sort((a, b) => {
                        const oa = a.instanceOrder; const ob = b.instanceOrder;
                        const hasA = Number.isFinite(oa); const hasB = Number.isFinite(ob);
                        if (hasA && hasB) return oa - ob;
                        if (hasA) return -1;
                        if (hasB) return 1;
                        return (a.date || '').localeCompare(b.date || '');
                      });
                    const from = ordered.findIndex((x) => x.id === dragId);
                    const to = ordered.findIndex((x) => x.id === targetId);
                    if (from < 0 || to < 0) return prev;
                    ordered.splice(from, 1);
                    ordered.splice(to, 0, drag);
                    const orderMap = {};
                    ordered.forEach((x, i) => { orderMap[x.id] = i; });
                    return prev.map((x) => (orderMap[x.id] !== undefined ? { ...x, instanceOrder: orderMap[x.id] } : x));
                  });
                };

                const jumpToProtocolFn = (id) => {
                  setExpandedGroups((p) => ({ ...p, activeProtoId: id }));
                  setCurrentModule('protocols');
                };

                const handleDuplicateInstance = () => {
                  // A view-only project member cannot write, and a copy would land
                  // in the SAME projects → it would be read-only for them too. The
                  // button is disabled with the reason in its tooltip.
                  if (projectViewOnly) return;
                  const id = 't' + Date.now();
                  // A copy NEVER inherits the data lock: copying the data into an
                  // editable instance is precisely the way out offered to a
                  // scientist who must run a different analysis on frozen data.
                  const copiedLocked = isDataLocked(activeTest);
                  const newTest = clearDataLock(JSON.parse(JSON.stringify(activeTest)));

                  newTest.id = id;
                  newTest.date = new Date().toISOString().split('T')[0];
                  newTest.instanceName = 'New Instance ' + (siblingTests.length + 1) + (copiedLocked ? ' (copy)' : '');
                  newTest.comments = '';
                  newTest.images = [];
                  newTest.documents = [];

                  // Flow Cytometry raw data must NOT be inherited: the FCS
                  // cache is keyed per instance id, so a copy would share the
                  // same files and deleting them would affect the original.
                  delete newTest.fcParsed;
                  delete newTest.fcExtraFiles;

                  if (
                    newTest.type.startsWith('plate-') &&
                    newTest.type !== 'plate-9x9box'
                  ) {
                    newTest.grid = newTest.grid.map((row) => row.map(() => ''));
                  }

                  if (newTest.type === 'nmr-fittings') {
                    newTest.grid = newTest.grid.map((row) => row.map(() => ''));
                  }

                  setTests((prev) => [...prev, newTest]);

                  setActiveTestId(id);
                };

                // "+ Add Date/Condition": a NEW condition of this experiment
                // opens on a VIRGIN page — the blank defaults of its type
                // (createEmptyTest) plus the experiment context ONLY (name,
                // classification, projects, scientists). No data at all is
                // copied: to start from the data of an existing condition, use
                // the "⧉ Copy the data to a new instance" button of the
                // data-lock banner (handleDuplicateInstance above).
                // The rule itself lives in src/utils/conditionInstance.js.
                const handleAddBlankInstance = () => {
                  if (projectViewOnly) return; // read-only: creating a condition is a write (disabled below)
                  const id = 't' + Date.now() + Math.floor(Math.random() * 1e4);
                  const created = withExperimentContext(
                    createEmptyTest(id, siblingTests.length + 1, activeTest.type),
                    activeTest,
                    { instanceName: blankConditionName(siblingTests.length) }
                  );
                  setTests((prev) => [...prev, created]);
                  setActiveTestId(id);
                };

                /* Ce qui MANQUE à une boîte (utils/storageBoxes.js) : nom de
                   l'échantillon, propriétaire, date — sur la boîte et dans chaque
                   puits rempli. Affiché dans la barre d'identité, jamais bloquant. */
                const boxIssues = activeTest.type === 'plate-9x9box' ? requiredBoxIssues(activeTest) : [];

                // Condition (date / instance) currently displayed — shown on the
                // thin bar so the page still says WHICH condition it shows while
                // the Date / Conditions strip is folded.
                const conditionLabel = String(activeTest.instanceName || activeTest.date || '').trim();

                /* « ◀ Back » — returns to where the user came from (project page,
                   storage, publications…) instead of always the experiment list.
                   It lives in the THIN BAR, which is always visible, so navigation
                   stays one click away while the rest of the chrome is folded. */
                const backButton = (
                        <button
                          onClick={() => {
                            // "◀ Back" returns to where the user came from
                            // (e.g. the project page) instead of always the list.
                            if (returnTarget && returnTarget.module === 'project-detail' && returnTarget.projectId) {
                              setCurrentProjectId(returnTarget.projectId);
                              setCurrentModule('project-detail');
                              setReturnTarget(null);
                            } else if (returnTarget && returnTarget.module === 'storage-detail' && returnTarget.storageId) {
                              setActiveStorageId(returnTarget.storageId);
                              setCurrentModule('storage-detail');
                              setReturnTarget(null);
                            } else if (returnTarget && returnTarget.module === 'publications') {
                              // Back to the Publications page with its project
                              // context (the Image Builder is its own module
                              // now, handled by the generic branch below).
                              setCurrentProjectId(returnTarget.projectId || null);
                              setCurrentModule('publications');
                              setReturnTarget(null);
                            } else if (returnTarget && returnTarget.module && returnTarget.module !== 'active-test') {
                              // Tout autre module (Library, Lab Notebook, Projects,
                              // Agenda, Calculations, Settings…) : on y retourne
                              // tel quel — son contexte est conservé (filtres,
                              // sélection, onglet…). Sans cela « ◀ Back » renvoyait
                              // toujours à la liste des expériences.
                              if (returnTarget.projectId) setCurrentProjectId(returnTarget.projectId);
                              if (returnTarget.storageId) setActiveStorageId(returnTarget.storageId);
                              setCurrentModule(returnTarget.module);
                              setReturnTarget(null);
                            } else if (isBox && activeTest.storageId) {
                              setActiveStorageId(activeTest.storageId);
                              setCurrentModule('storage-detail');
                            } else {
                              setCurrentModule('tests');
                            }
                          }}
                          title={(returnTarget && returnTarget.module && returnTarget.module !== 'active-test')
                            ? `Back to ${String(returnTarget.module).replace(/-/g, ' ')}`
                            : 'Back to the experiment list'}
                          className="shrink-0 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors bg-slate-50 hover:bg-blue-50 px-2 py-1 rounded-lg shadow-sm border border-slate-200"
                        >
                          ◀ Back
                        </button>
                );

const TestHeader = (
                  <div className="flex flex-col shrink-0 z-20 no-print">
                    {/* ══ THIN BAR — THE ONLY LINE THAT IS ALWAYS SHOWN ═══════
                        The chrome of an experiment page (identity, identification
                        fields, Date / Conditions chips, actions) used to eat a
                        third of the screen before the first plot ever appeared. It
                        is COLLAPSIBLE (« ▸ More details ») and folded by default:
                        this one thin line keeps the way back (◀ Back), the name,
                        the condition on screen, « 🔄 Refresh », « ▸ Expand all » and
                        the toggle itself. The open/folded choice is remembered for
                        the browser session. */}
                    <div className="bg-white border-b border-slate-200 px-3 md:px-4 py-1 flex flex-wrap items-center gap-x-2 gap-y-1 shadow-sm">
                      {backButton}
                      <span
                        className={`flex-1 min-w-[120px] truncate text-sm font-black ${String(activeTest.name || '').trim() ? 'text-slate-800' : 'text-red-500 italic'}`}
                        title={isBox ? 'Box name' : 'Experiment name'}
                      >
                        {String(activeTest.name || '').trim() || (isBox ? 'Untitled box' : 'Untitled experiment')}
                      </span>
                      {conditionLabel && (
                        <span className="shrink-0 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-0.5 whitespace-nowrap" title="Condition (date / instance) shown on this page">
                          <Icon name="calendar" size={11} className="mr-1 text-blue-700" />{conditionLabel}
                        </span>
                      )}
                      {/* A box that cannot be identified must keep saying so even
                          while the chrome is folded: the warning lives in the
                          identification bar below (Bar 2), which is hidden. */}
                      {boxIssues.length > 0 && (
                        <span
                          className="shrink-0 max-w-[260px] truncate text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg px-2 py-0.5"
                          title={`${describeBoxIssues(boxIssues)}\n\nA box must be identifiable: sample name, owner and date — on the box and in every filled well.`}
                        >
                          ⚠ {describeBoxIssues(boxIssues)}
                        </span>
                      )}
                      {/* Read-only must survive the folded chrome exactly like the
                          box warning above: the notice rendered under the
                          « Date / Conditions » strip is hidden while the chrome is
                          folded, and a write refused in SILENCE is precisely what
                          makes a typed value look saved (see utils/readOnly.js). */}
                      {readOnlyReason && (
                        <span
                          className={`shrink-0 max-w-[340px] truncate text-[10px] font-bold rounded-lg px-2 py-0.5 border ${readOnlyReason === 'project' ? 'text-slate-700 bg-slate-100 border-slate-300' : 'text-amber-800 bg-amber-50 border-amber-300'}`}
                          title={`${readOnlyLabel(readOnlyReason, decidingProject.project)} — this page stays fully readable, but nothing you change on it is saved.`}
                        >
                          <Icon name={readOnlyReason === 'project' ? 'key' : 'lock'} size={11} className="inline mr-1 -mt-0.5" />
                          {readOnlyReason === 'project' ? 'View-only' : 'Data locked'} — read-only
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={onRefreshPage}
                        title="Refresh this page: the experiment is FIRST re-read from the shared copy (the cloud document, or its Drive copy) — so a number typed in another window shows up here, exactly like a full reload — and every section, plot, table and 3D viewer is then rebuilt. You STAY on this page — no path to walk back (a reload from the browser bar loses the experiment you were on)."
                        className="shrink-0 font-bold py-1 px-2 rounded-lg text-xs border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50 transition-colors whitespace-nowrap"
                      >
                        🔄 Refresh
                      </button>
                      {showRefreshDone && (
                        <span className="shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5 whitespace-nowrap">
                          ✓ page refreshed
                        </span>
                      )}
                      {/* Ce que la RELECTURE de la source partagée a donné : sans
                          ce témoin, un cloud injoignable ressemblerait à un
                          bouton qui ne fait rien (l'ancien défaut). */}
                      {refreshState && refreshState.busy && (
                        <span className="shrink-0 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 whitespace-nowrap animate-pulse">
                          ⟳ re-reading the shared data…
                        </span>
                      )}
                      {refreshState && !refreshState.busy && (
                        <span
                          className={`shrink-0 max-w-[320px] truncate text-[10px] font-bold rounded-lg px-2 py-0.5 whitespace-nowrap border ${refreshState.ok ? 'text-slate-600 bg-slate-50 border-slate-200' : 'text-amber-700 bg-amber-50 border-amber-300'}`}
                          title={refreshState.text}
                        >
                          {refreshState.ok ? '↻ ' : '⚠ '}{refreshState.text}
                        </span>
                      )}
                      {!isBox && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = !allSectionsOpen;
                            setAllSectionsOpen(next);
                            setSectionsCommand(next);
                          }}
                          // Stable hook: the Image Builder's "↗ Open original graph"
                          // opens the page with this button when the captured chart
                          // sits inside a CLOSED section (it would not be in the DOM
                          // otherwise, so it could not be scrolled to). Only exposed
                          // while it would EXPAND the page.
                          data-expand-all={allSectionsOpen ? undefined : '1'}
                          className={`shrink-0 font-bold py-1 px-2 rounded-lg text-xs border shadow-sm transition-colors whitespace-nowrap ${allSectionsOpen ? 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}
                          title={allSectionsOpen ? 'Close all sections and subsections' : 'Expand all sections and subsections'}
                        >
                          {allSectionsOpen ? '▾ Collapse all' : '▸ Expand all'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setHeaderOpen((v) => !v)}
                        aria-expanded={headerOpen}
                        data-experiment-chrome={headerOpen ? 'open' : 'closed'}
                        title={headerOpen
                          ? 'Fold the experiment chrome (name, identification fields, conditions, actions) — the plots get the whole screen'
                          : 'Show the experiment chrome: name, identification fields (classification, type, date, scientists…), Date / Conditions and the actions (lock, delete)'}
                        className={`shrink-0 font-bold py-1 px-2 rounded-lg text-xs border shadow-sm transition-colors whitespace-nowrap ${headerOpen ? 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}
                      >
                        {headerOpen ? '▾ Fewer details' : '▸ More details'}
                      </button>
                    </div>

                    {headerOpen && (
                      <>

                    {/* ── Bar 1 — identity + actions on ONE wrapping line ─────
                        Everything above the plots is chrome: every row the
                        header adds is a row of plot it takes away, so the name,
                        the classification chips, “◀ Back” and the action buttons
                        share ONE line instead of stacking (the wrap only kicks in
                        on a really narrow window). */}
                    <div className="bg-white border-b border-slate-200 px-3 md:px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 shadow-sm">
                      <div className="flex flex-1 min-w-[240px] items-center gap-2 md:gap-3">
                        <div className="flex flex-1 min-w-[200px] flex-wrap items-center gap-x-2 gap-y-0.5">
                          <input
                            value={activeTest.name}
                            onChange={(e) => handleTestNameChange(e.target.value)}
                            onFocus={() => { testNameBeforeEditRef.current = activeTest.name; }}
                            onBlur={() => {
                              const before = testNameBeforeEditRef.current;
                              // Rename the Drive folder even when the old name
                              // was EMPTY (never skip '').
                              if (before !== null && before !== activeTest.name) {
                                /* Une BOÎTE de stockage n'est pas une
                                   expérience : son dossier est
                                   storage/<storage>/boxes/<nom>, donc c'est CE
                                   dossier qu'il faut renommer (le nom « Test 74 »
                                   de la création ne doit pas rester). */
                                if (isBox) {
                                  const boxStorageName = ((storages || []).find((s) => s.id === activeTest.storageId)?.name) || '';
                                  renameStorageBoxDriveFolder({
                                    storage: boxStorageName,
                                    oldName: before,
                                    newName: activeTest.name
                                  }).catch(() => {});
                                  /* Le dossier de la boîte vient de prendre son nom
                                     DÉFINITIF : c'est MAINTENANT (une fois, pas à
                                     chaque lettre) qu'on range ses photos sous ce
                                     nom — un dossier par nom intermédiaire restait
                                     sinon sur le Drive (j, ja, jac). */
                                  tidyStorageFiles({
                                    storage: boxStorageName,
                                    box: activeTest.name || 'box',
                                    urls: [activeTest.boxImageUrl || '', activeTest.boxContentsImageUrl || '']
                                  }).catch(() => {});
                                } else {
                                  renameDriveFilesFor({ field: 'test', oldValue: before, newValue: activeTest.name }).catch(() => {});
                                }
                              }
                              testNameBeforeEditRef.current = null;
                            }}
                            className="text-base font-black text-slate-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 flex-1 min-w-[120px]"
                            placeholder={isBox ? 'Box Name' : 'Test Name'}
                          />

                          <div className="text-[10px] text-slate-500 font-medium flex flex-wrap items-center gap-1">
                            {activeTest.testCategory && (
                              <span className="uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                {activeTest.testCategory}
                              </span>
                            )}
                            {activeTest.secondaryCategory && (
                              <span className="uppercase text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                {activeTest.secondaryCategory}
                              </span>
                            )}
                            {activeTest.bestMeasurement && (
                              <span className="uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold">
                                ⭐ Best
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons — their own line only when the line above
                          is full; the identification fields no longer travel with
                          them (see “Bar 2” below). */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {/* ── 🔒 Data lock — superuser only ────────────────
                            Freezes the data of this condition (page becomes
                            read-only for everybody else) with an escape hatch:
                            they can copy the data into a new instance to run a
                            different analysis. See src/utils/dataLock.js */}
                        {isSuperuserSession && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setDataLock(
                                !activeInstanceLocked,
                                new Set([activeTest.id]),
                                lockTargetLabel(activeTest)
                              )}
                              title={activeInstanceLocked
                                ? 'Unlock this condition — its data can be edited again by everybody who can open the experiment'
                                : 'Freeze this condition: other users keep full read access (results, plots, tables) but nothing they change is saved. They are offered to copy the data into a new instance instead.'}
                              className={`font-bold py-1 px-2 rounded-lg text-xs border shadow-sm transition-colors ${activeInstanceLocked ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                            >
                              {activeInstanceLocked ? '🔓 Unlock data' : '🔒 Lock data'}
                            </button>
                            {siblingTests.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setDataLock(
                                  !allGroupLocked,
                                  new Set(groupTests.map((t) => t.id)),
                                  `all ${groupTests.length} conditions of "${activeTest.name}"`
                                )}
                                title={allGroupLocked
                                  ? 'Unlock every condition of this experiment'
                                  : `Freeze the data of all ${groupTests.length} conditions of this experiment at once`}
                                className="font-bold py-1 px-2 rounded-lg text-xs border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
                              >
                                {allGroupLocked ? '🔓 Unlock all' : `🔒 Lock all ${groupTests.length}`}
                              </button>
                            )}
                          </div>
                        )}
                        {/* (« ▸ Expand all » now lives in the thin bar at the top
                            of the page, so it stays reachable while the chrome is
                            folded — see TestHeader.) */}
                        <button
                          disabled={dataReadOnly || projectViewOnly}
                          title={projectViewOnly
                            ? `${readOnlyLabel('project', decidingProject.project)} — you cannot delete this experiment.`
                            : dataReadOnly
                              ? 'Data locked — only a superuser can delete this experiment.'
                              : 'Permanently delete this experiment (all its conditions)'}
                          onClick={() => {
                            // Deleting an experiment removes ALL its instances
                            // (they share the name); a box is a single item.
                            const group = (isBox || !(activeTest.name && activeTest.name.trim()))
                              ? [activeTest]
                              : tests.filter((t) => t.name === activeTest.name && t.name.trim() !== '');
                            const count = group.length;
                            if (
                              window.confirm(
                                isBox
                                  ? 'Are you sure you want to permanently delete this box?'
                                  : count > 1
                                    ? `Are you sure you want to permanently delete the experiment "${activeTest.name}" (${count} instances)?`
                                    : 'Are you sure you want to permanently delete this experiment?'
                              )
                            ) {
                              const ids = new Set(group.map((t) => t.id));
                              setTests((prev) => prev.filter((t) => !ids.has(t.id)));
                              setCurrentModule('tests');
                              group.forEach((t) => {
                                markAttachmentsDeleted(t).catch(() => {});
                                // Remove the test's Drive folder too — the Drive tree mirrors the program.
                                deleteTestDriveFolder(t).catch(() => {});
                                // Drop the raw .fcs files cached in the browser (IndexedDB).
                                removeTestFcsBlobs(t).catch(() => {});
                              });
                            }
                          }}
                          className={`font-bold py-1 px-2 rounded-lg text-xs transition-colors border shadow-sm border-red-200 bg-red-50 text-red-600 ${dataReadOnly ? 'opacity-40 cursor-not-allowed' : 'hover:bg-red-100 hover:border-red-300'}`}
                        >
                          <Icon name="trash" size={14} /> Delete
                        </button>
                        
                      </div>
                    </div>

                    {/* ── Bar 2 — the identification fields, FULL width of the page ──
                        Primary/secondary class, experiment type, instance, date,
                        scientists, box owner… used to share the width of the
                        action buttons above, so a laptop window squeezed them
                        into a column a few hundred pixels wide and eight fields
                        became three or four rows. On a full-width grid they fit
                        in TWO rows of COMPACT fields — the label sits IN LINE
                        with its control, which is what halves their height. */}
                    <div className="bg-white border-b border-slate-200 px-3 md:px-4 py-1.5 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-x-2 gap-y-1 shadow-sm">
                        <React.Fragment>
  {activeTest.type === 'plate-9x9box' ? (
    <>
    <label className="flex items-center gap-1.5 min-w-0">
      <span className={`shrink-0 text-[10px] font-bold uppercase ${!String(activeTest.boxOwner || '').trim() ? 'text-red-500' : 'text-slate-400'}`}>
        Box Owner
      </span>
      <select
        value={activeTest.boxOwner || ''}
        onChange={(e) => updateActiveTest({ boxOwner: e.target.value })}
        className={`flex-1 min-w-0 bg-slate-50 border text-xs px-1.5 py-1 rounded-lg outline-none focus:border-blue-500 ${!String(activeTest.boxOwner || '').trim() ? 'border-red-300 text-red-700' : 'border-slate-200'}`}
      >
        <option value="">Select Box Owner...</option>
        {operatorNames.map((op) => (<option key={`owner-${op}`} value={op}>{op}</option>))}
      </select>
    </label>
    {/* OÙ VIT LA BOÎTE : son meuble et son emplacement, cliquables. Une boîte
        est toujours rattachée à un meuble (voir utils/storageBoxes.js) : si ce
        n'est pas le cas, on le dit ici en rouge au lieu de la laisser
        introuvable. */}
    {(() => {
      const st = (storages || []).find((s) => s.id === activeTest.storageId) || null;
      const slot = activeTest.storageIndex === null || activeTest.storageIndex === undefined || activeTest.storageIndex === ''
        ? null
        : Number(activeTest.storageIndex);
      const where = st ? `${st.name}${Number.isFinite(slot) ? ` · slot ${slot + 1}` : ' · no slot'}` : 'No storage';
      return (
        <button type="button"
          onClick={() => { if (st) { setActiveStorageId(st.id); setCurrentModule('storage-detail'); } }}
          disabled={!st}
          className={`flex items-center gap-1.5 min-w-0 text-xs px-1.5 py-1 rounded-lg border ${st ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' : 'bg-red-50 border-red-200 text-red-600'}`}
          title={st
            ? `This box lives in ${st.name}${Number.isFinite(slot) ? ` · slot ${slot + 1}` : ' · no visible slot'}. Click to open the storage.`
            : 'This box has no storage. Open the Storage module to give it one.'}>
          <Icon name="box" size={12} />
          <span className="truncate">{where}</span>
        </button>
      );
    })()}
    {/* Rien n'est bloqué : la boîte dit simplement ce qui lui manque pour être
        identifiable (nom de l'échantillon, propriétaire, date). */}
    {boxIssues.length > 0 && (
      <span className="flex items-center gap-1 min-w-0 text-[10px] font-bold text-red-600"
            title={`${describeBoxIssues(boxIssues)}\n\nA box must be identifiable: sample name, owner and date — on the box and in every filled well.`}>
        ⚠ <span className="truncate">{describeBoxIssues(boxIssues)}</span>
      </span>
    )}
    </>
  ) : (
    <>
    <label className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
        Primary Scientist
      </span>
      <select
        value={activeTest.operator || ''}
        onChange={(e) => updateActiveTest({ operator: e.target.value })}
        className="flex-1 min-w-0 bg-slate-50 border border-slate-200 text-xs px-1.5 py-1 rounded-lg outline-none focus:border-blue-500"
      >
        <option value="">Select Scientist...</option>
        {operatorNames.map((op) => (<option key={`sci-${op}`} value={op}>{op}</option>))}
      </select>
    </label>
    <label className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
        Co-Scientists
      </span>
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 min-h-[28px]">
        {(activeTest.coScientists || []).map((cs) => (
          <span key={cs} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {cs}
            <button type="button" onClick={() => updateActiveTest({ coScientists: (activeTest.coScientists || []).filter(x => x !== cs) })} className="hover:text-red-500 font-black leading-none">×</button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const existing = activeTest.coScientists || [];
            if (!existing.includes(v) && v !== activeTest.operator) {
              updateActiveTest({ coScientists: [...existing, v] });
            }
          }}
          className="text-[10px] bg-transparent outline-none text-slate-400 flex-1 min-w-[80px]"
        >
          <option value="">+ Add co-scientist…</option>
          {operatorNames.filter(op => op !== activeTest.operator && !(activeTest.coScientists || []).includes(op)).map(op => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      </div>
    </label>
    </>
  )}
</React.Fragment>

                    {!isBox && (
                    <>
                    <label className="flex items-center gap-1.5 min-w-0">
                       <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
                         Primary Class.
                       </span>
                       <select
                         value={activeTest.testCategory || ''}
                         onChange={(e) => {
                           updateActiveTest({ 
                             testCategory: e.target.value,
                             secondaryCategory: '' 
                           });
                         }}
                         className="flex-1 min-w-0 bg-slate-50 border border-slate-200 text-xs px-1.5 py-1 rounded-lg outline-none focus:border-blue-500"
                       >
                         <option value="">Select...</option>
                         {PRIMARY_CATEGORIES.map((cat) => (
                           <option key={cat} value={cat}>{cat}</option>
                         ))}
                       </select>
                     </label>
                     <label className="flex items-center gap-1.5 min-w-0">
                       <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
                         Sec. Class.
                       </span>
                       <select
                         value={activeTest.secondaryCategory || ''}
                         onChange={(e) => updateActiveTest({ secondaryCategory: e.target.value })}
                         className="flex-1 min-w-0 bg-slate-50 border border-slate-200 text-xs px-1.5 py-1 rounded-lg outline-none focus:border-blue-500"
                         disabled={!activeTest.testCategory || !CLASSIFICATION_MAP[activeTest.testCategory]}
                       >
                         <option value="">Select...</option>
                         {activeTest.testCategory && CLASSIFICATION_MAP[activeTest.testCategory] ? 
                           CLASSIFICATION_MAP[activeTest.testCategory].map((cat, idx) => (
                             <option key={idx} value={cat}>{cat}</option>
                           )) 
                           : null
                         }
                       </select>
                     </label>

                        <label className="flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
                            Experiment Type
                          </span>
                          <select
                            value={
                           activeTest.type === 'plate-96' || activeTest.type === 'plate-384' || activeTest.type === 'plate-24' ? 'Multiwell plate essay' : 
                           activeTest.type === 'nmr-fittings' ? 'NMR Fitting' :
                           activeTest.type === 'dosy' ? 'DOSY' :
                           activeTest.type === 'md_simulation' ? 'MD Simulation' :
                           activeTest.type === 'protein_expression' ? 'Protein expression & Purification' :
                           activeTest.type === 'ssnmr' ? 'Solid State NMR' :
                           activeTest.type === 'cd' ? 'Circular Dichroism' :
                           activeTest.type === 'nmr' ? 'NMR' :
                           activeTest.type === 'cloning' ? 'Cloning' :
                           activeTest.type === 'docking' ? 'Molecular Docking' :
                           activeTest.type === 'flow_cytometry' ? 'Flow Cytometry' : 'Multiwell plate essay'
                         }
                            disabled
                            className="flex-1 min-w-0 bg-slate-100 border border-slate-200 text-xs px-1.5 py-1 rounded-lg outline-none text-slate-500 cursor-not-allowed"
                          >
                            {EXPERIMENT_TYPES.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </label>
                    </>
                    )}

                        {/* Une BOÎTE de stockage n'a PAS de niveau « instance »
                            (son dossier Drive porte le nom de la boîte) : le
                            champ est réservé aux expériences. */}
                        {!isBox && (
                        <label className="flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
                            Instance
                          </span>
                          <input
                            type="text"
                            value={activeTest.instanceName || ''}
                            onChange={(e) => updateActiveTest({ instanceName: e.target.value })}
                            onFocus={() => { instanceNameBeforeEditRef.current = activeTest.instanceName || ''; }}
                            onBlur={() => {
                              const before = instanceNameBeforeEditRef.current;
                              const after = activeTest.instanceName || '';
                              if (before !== null && before !== after) {
                                renameDriveFilesFor({
                                  field: 'instance',
                                  oldValue: before,
                                  newValue: after,
                                  scope: {
                                    project: (activeTest.projectNames || [])[0] || '',
                                    test: activeTest.name || ''
                                  }
                                }).catch(() => {});
                              }
                              instanceNameBeforeEditRef.current = null;
                            }}
                            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 text-xs px-1.5 py-1 rounded-lg outline-none focus:border-blue-500"
                            placeholder="e.g. 24h / Rep 1"
                          />
                        </label>
                        )}

                        <label className="flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0 text-[10px] font-bold text-slate-400 uppercase">
                            Date
                          </span>
                          <input
                            type="date"
                            value={activeTest.date}
                            onChange={(e) => updateActiveTest({ date: e.target.value })}
                            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 text-xs px-1.5 py-1 rounded-lg outline-none focus:border-blue-500"
                          />
                        </label>
                        
                        {!isBox && (
                        <label className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer hover:text-blue-600 transition-colors">
                            <input
                              type="checkbox"
                              checked={!!activeTest.bestMeasurement}
                              onChange={(e) => updateActiveTest({ bestMeasurement: e.target.checked })}
                              className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            ⭐ Best
                          </label>
                        )}
                        </div>

                    {siblingTests.length > 0 && (
                      /* Date / Conditions strip — the conditions WRAP onto the next
                          line instead of pushing a sideways scrollbar: at the full
                          character size the row was wider than the page on a laptop
                          screen, which is what forced the whole program to be used at
                          50% zoom. The chips keep their size; only the row spacing and
                          the vertical padding are tighter. */
                      <div className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-1.5 flex flex-wrap items-center gap-1.5 shadow-inner">
                        <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mr-2 shrink-0">
                          <Icon name="calendar" size={12} className="mr-1 text-blue-700" /> Date / Conditions:
                        </span>

                        {siblingTests.map((t, idx) => (
                          <button
                            key={t.id}
                            draggable={siblingTests.length > 1 && !projectViewOnly}
                            onDragStart={(e) => {
                              dragInstanceId.current = t.id;
                              e.dataTransfer.effectAllowed = 'move';
                              try { e.dataTransfer.setData('text/plain', t.id); } catch {}
                            }}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const dragId = dragInstanceId.current || e.dataTransfer.getData('text/plain');
                              reorderInstances(dragId, t.id);
                            }}
                            onClick={() => setActiveTestId(t.id)}
                            className={`shrink-0 px-3 py-1.5 md:py-1 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-sm group cursor-grab active:cursor-grabbing ${
                              activeTestId === t.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                            }`}
                            title={siblingTests.length > 1 ? 'Drag to reorder conditions' : undefined}
                          >
                            <span className="opacity-40 text-[9px] mr-0.5" aria-hidden="true">⠿</span>
                            <Icon name="calendar" size={12} className="mr-1 text-blue-700" /> {t.instanceName || t.date || `Cond ${idx + 1}`}
                            {isDataLocked(t) && (
                              <span title={dataLockLabel(t)} className="flex items-center">
                                <Icon
                                  name="lock"
                                  size={10}
                                  className={activeTestId === t.id ? 'text-amber-200' : 'text-amber-600'}
                                />
                              </span>
                            )}

                            {!isFrozenForMe(t.id) && !projectViewOnly && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const isLast = siblingTests.length <= 1;
                                  if (
                                    window.confirm(
                                      isLast
                                        ? `Delete condition ${t.instanceName || t.date}? This is the last instance — the whole experiment will be deleted.`
                                        : `Delete condition ${t.instanceName || t.date}?`
                                    )
                                  ) {
                                    setTests((prev) => {
                                      const next = prev.filter((test) => test.id !== t.id);
                                      if (!isLast && activeTestId === t.id) {
                                        setActiveTestId(
                                          next.find((x) => x.name === t.name)?.id ||
                                            next[0]?.id
                                        );
                                      }
                                      return next;
                                    });
                                    if (isLast) setCurrentModule('tests');
                                  }
                                }}
                                className={`ml-1 px-1 opacity-100 md:opacity-0 group-hover:opacity-100 ${
                                  activeTestId === t.id
                                    ? 'text-blue-300 hover:text-white'
                                    : 'text-red-400 hover:text-red-600'
                                }`}
                              >
                                &times;
                              </span>
                            )}
                          </button>
                        ))}

                        <button
                          onClick={handleAddBlankInstance}
                          disabled={projectViewOnly}
                          title={projectViewOnly
                            ? `${readOnlyLabel('project', decidingProject.project)} — you can read this experiment but not add a condition to it.`
                            : 'Add a new date/condition to this experiment — it starts on a blank page'}
                          className={`shrink-0 px-3 py-1.5 md:py-1 text-xs font-bold text-blue-600 border border-dashed border-blue-400 rounded-full transition-colors bg-white shadow-sm ml-2 ${projectViewOnly ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-100'}`}
                        >
                          + Add Date/Condition
                        </button>
                      </div>
                    )}

                    {/* ── 🔒 Read-only notice when this condition is frozen ──
                        Everybody (superusers excepted) keeps full read access
                        and is offered the way out: copy the data into a NEW
                        instance and run a different analysis on that copy. */}
                    {activeInstanceLocked && (
                      <div className={`border-b px-4 md:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] ${isSuperuserSession ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-100 border-slate-300 text-slate-700'}`}>
                        <span className="font-black uppercase tracking-wide flex items-center gap-1.5">
                          <Icon name="lock" size={12} /> {dataLockLabel(activeTest) || 'Data locked'}
                        </span>
                        <span className="font-medium max-w-3xl">
                          {isSuperuserSession
                            ? 'You are a superuser — you can still edit this experiment. Use “Unlock data” above to reopen it for the scientists.'
                            : 'Read-only for you: the results stay visible, but nothing you change here is saved (the stored values are restored). To run a different analysis, copy the data into a new instance — the copy is yours to edit.'}
                        </span>
                        {/* The way out of a lock is to COPY the data — but a copy
                            let a view-only member write on an experiment of a
                            project they cannot edit (the copy lands in the SAME
                            projects), so the button is not offered to them: the
                            view-only notice below says what to ask for instead. */}
                        {!projectViewOnly && (
                          <button
                            type="button"
                            onClick={handleDuplicateInstance}
                            title="Create an editable copy of this condition (same experiment) and run your own analysis on it"
                            className="ml-auto shrink-0 px-3 py-1 rounded-full text-[11px] font-bold bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 shadow-sm transition-colors"
                          >
                            ⧉ Copy the data to a new instance
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── 🔑 Read-only notice when the user only has 'view' on the
                        project that decides ──────────────────────────────────
                        Same promise as the lock banner: the page stays fully
                        readable, and it SAYS that nothing typed on it is saved.
                        Without this, a refused write is invisible: React never
                        renders the stored value back over the text just typed, so
                        the value looks saved and is gone at the next load. */}
                    {projectViewOnly && (
                      <div className="border-b px-4 md:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] bg-slate-100 border-slate-300 text-slate-700">
                        <span className="font-black uppercase tracking-wide flex items-center gap-1.5">
                          <Icon name="key" size={12} /> View-only project
                        </span>
                        <span className="font-medium max-w-3xl">
                          {`You have view-only rights on ${decidingProject.project ? `project “${decidingProject.project}”` : 'the linked project'}: you can read this experiment (results, plots, tables), but NOTHING YOU CHANGE HERE IS SAVED — the stored values are restored at the next load. Ask the project owner for “modify” rights to edit it.`}
                        </span>
                      </div>
                    )}
                      </>
                    )}
                  </div>
                );

                if (activeTest.type === 'md_simulation') {
                  return (
                    <MDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      instances={siblingTests}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'nmr') {
                  return (
                    <NMRTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      currentUser={currentUser}
                      allTests={tests}
                      setTests={guardedSetTests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      jumpToTest={jumpToTest}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      instances={siblingTests}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'cd') {
                  const updateInstance = (instId, updates) => {
                    if (isFrozenForMe(instId)) return; // frozen condition — write ignored
                    setTests((prev) => prev.map((t) => t.id === instId ? { ...t, ...updates } : t));
                  };
                  return (
                    <CDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      setTests={guardedSetTests}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      updateInstance={updateInstance}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }
if (activeTest.type === 'ssnmr') {
  const ssNmrInstances = (() => {
    const base = Array.isArray(siblingTests) && siblingTests.length
      ? siblingTests
      : [activeTest];

    const filtered = base.filter(
      (t) => t && (t.id === activeTest.id || t.type === 'ssnmr')
    );

    return filtered.length ? filtered : [activeTest];
  })();

  const updateInstance = (instId, updates) => {
    if (isFrozenForMe(instId)) return; // frozen condition — write ignored
    setTests((prev) =>
      prev.map((t) => (t.id === instId ? { ...t, ...updates } : t))
    );
  };

  return (
    <SSNMRTestRenderer
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      allTests={tests}
      setTests={guardedSetTests}
      appClipboard={appClipboard}
      setAppClipboard={setAppClipboard}
      TestHeader={TestHeader}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
      operators={operatorNames}
      instances={ssNmrInstances}
      updateInstance={updateInstance}
      solvents={solvents}
      buffers={buffers}
      additives={additives}
      compoundMeta={compoundMeta}
      mandatoryRules={mandatoryRules}
      mandatoryBehavior={mandatoryBehavior}
    />
  );
}
                if (activeTest.type === 'plate-9x9box') {
                  return (
                    <BoxDetail
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      storages={storages}
                      expandedGroups={expandedGroups}
                      setExpandedGroups={setExpandedGroups}
                      customCmpds={customCmpds}
                      jumpToTest={jumpToTest}
                      setMoveModal={setMoveModal}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                    />
                  );
                }
                if (activeTest.type === 'flow_cytometry') {
               return (
                 <FlowCytometryTestRenderer
                   activeTest={activeTest}
                   updateActiveTest={updateActiveTest}
                   allTests={tests}
                   setTests={guardedSetTests}
                   TestHeader={TestHeader}
                   datasetProtocols={datasetProtocols}
                   jumpToProtocol={jumpToProtocolFn}
                   allCmpds={allCmpds}
                   allCellLines={allCellLines}
                   customFields={customFields}
                   testCategories={testCategories}
                   operators={operatorNames}
                   instances={siblingTests}
                   solvents={solvents}
                   buffers={buffers}
                   additives={additives}
                   compoundMeta={compoundMeta}
                   mandatoryRules={mandatoryRules}
                   mandatoryBehavior={mandatoryBehavior}
                 />
               );
             }
if (activeTest.type === 'microscopy') {
               return (
                 <MicroscopyTestRenderer
                   activeTest={activeTest}
                   updateActiveTest={updateActiveTest}
                   allTests={tests}
                   setTests={guardedSetTests}
                   TestHeader={TestHeader}
                   datasetProtocols={datasetProtocols}
                   jumpToProtocol={jumpToProtocolFn}
                   allCmpds={allCmpds}
                   allCellLines={allCellLines}
                   customFields={customFields}
                   testCategories={testCategories}
                   operators={operatorNames}
                   instances={siblingTests}
                   solvents={solvents}
                   buffers={buffers}
                   additives={additives}
                   compoundMeta={compoundMeta}
                   mandatoryRules={mandatoryRules}
                   mandatoryBehavior={mandatoryBehavior}
                 />
               );
             }
                if (activeTest.type === 'cloning') {
                  return (
                    <CloningTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      compoundMeta={compoundMeta}
                      plasmidMeta={plasmidMeta}
                      molecules={molecules}
                      cmpColors={cmpColors}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'nmr-fittings') {
                  return (
                    <NMRFittingsTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                      molecules={molecules}
                      compoundMeta={compoundMeta}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      customConc={customConc}
                      setCustomConc={setCustomConc}
                      cmpColors={cmpColors}
                      setCmpColors={setCmpColors}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'dosy') {
                  return (
                    <DOSYTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                      molecules={molecules}
                      compoundMeta={compoundMeta}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'protein_expression') {
                  return (
                    <ProteinExpressionTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      cmpColors={cmpColors}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (
                  activeTest.type.startsWith('plate-') &&
                  activeTest.type !== 'plate-9x9box'
                ) {
                  return (
                    <PlateTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      customConc={customConc}
                      setCustomConc={setCustomConc}
                      cmpColors={cmpColors}
                      setCmpColors={setCmpColors}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      jumpToTest={(id) => {
                        setActiveTestId(id);
                        setCurrentModule('active-test');
                      }}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'docking') {
                  return (
                    <DockingTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                return <div className="p-6">Unknown test type.</div>;
};

