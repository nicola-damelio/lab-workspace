import React, { useEffect, useRef, useState } from 'react';
import {
  readFigureStyle, figureStyleTag, subscribeFigureStyle, subscribeFigureStyleSlots,
  figureStyleSlotCount, registerFigureStyleSlot, applyFigureStyleToSlots,
  applyFigureStyleEverywhere, undoFigureStyleSlots, figureStyleUndoAvailable,
  normalizeFigureKind, figureAspectSummary,
  readFigureStyleConfigs, subscribeFigureStyleConfigs, figureStyleConfigForStyle,
  figureStyleConfigName, saveFigureStyleConfig, applyFigureStyleConfig
} from '../utils/figureStyle';

/* =========================================================================
   src/components/FigureStyleTools.jsx
   The two halves of the global "Figure style" system:

   • <FigureStyleApplyButton> — the 🎨 chip the ChartStarLayer puts on every
     experiment page. It pushes the profile of Settings → "Figure style" into
     EVERY chart / spectrum of the page (through the style-slot registry of
     utils/figureStyle.js, i.e. the same setters the 🎨 Graphical Parameters
     panels use), can reach the charts of the CLOSED sections ("▸ Expand all"
     first) and can undo the last apply. The profile signature is written on the
     experiment (`test.figureStyleTag`) so a page knows it is already styled.
     It also carries the SAVED CONFIGURATIONS of Settings → Figure style: the
     select switches the profile AND restyles the page in the same click, so a
     figure style with oversized characters is one gesture away.

   • <FigureStylePanel> (in FigureStylePanel.jsx) — the profile editor.
   ========================================================================= */

/** The profile, live (re-renders on every change, this tab or another one). */
export const useFigureStyleProfile = () => {
  const [profile, setProfile] = useState(() => readFigureStyle());
  useEffect(() => subscribeFigureStyle(setProfile), []);
  return profile;
};

/** How many charts of the current page have a style panel right now. */
export const useFigureStyleSlots = () => {
  const [count, setCount] = useState(() => figureStyleSlotCount());
  useEffect(() => subscribeFigureStyleSlots(setCount), []);
  return count;
};

/** The configurations saved in Settings → Figure style, live. */
export const useFigureStyleConfigs = () => {
  const [configs, setConfigs] = useState(() => readFigureStyleConfigs());
  useEffect(() => subscribeFigureStyleConfigs(setConfigs), []);
  return configs;
};

/**
 * Called by ChartInspector / ChartJsInspector: registers the cfg + setCfg pair
 * of one chart so the page-level 🎨 button can style it. The refs keep the
 * registration valid across renders without re-registering (and without
 * re-running the effect on every keystroke in the style panel).
 *
 * `kind` says WHAT the figure is (see FIGURE_KINDS in utils/figureStyle.js): a
 * spectrum, a per-atom plot, a per-residue plot or a graph. The profile of
 * Settings → Figure style carries one plot-box ratio per kind, and this is how a
 * figure gets the one that belongs to it. Left out → 'graph'.
 */
export const useFigureStyleSlot = (cfg, setCfg, kind = null) => {
  const editable = !!cfg && typeof setCfg === 'function';
  const slotKind = normalizeFigureKind(kind);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const setRef = useRef(setCfg);
  setRef.current = setCfg;
  useEffect(() => {
    if (!editable) return undefined;
    return registerFigureStyleSlot({
      get: () => cfgRef.current,
      set: (next) => setRef.current(next),
      kind: slotKind
    });
  }, [editable, slotKind]);
};

const CHIP = 'flex items-center gap-1.5 rounded-full border shadow-md px-3 h-7 text-[11px] font-bold transition-colors';

export const FigureStyleApplyButton = ({ test, update }) => {
  const profile = useFigureStyleProfile();
  const slots = useFigureStyleSlots();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);     // { ok, msg }
  const [undoable, setUndoable] = useState(false);
  const timer = useRef(null);
  const autoRef = useRef('');                     // experiment already auto-styled
  const tag = figureStyleTag(profile);
  const applied = !!test && test.figureStyleTag === tag;
  // The configurations saved in Settings → Figure style: switching one here
  // writes the profile AND pushes it into the charts of this page, in one click.
  const configs = useFigureStyleConfigs();
  const current = figureStyleConfigForStyle(profile);
  // ONE plot-box ratio per kind of figure (spectra / per-atom / per-residue /
  // graphs): the chip lists only the ones the profile really imposes.
  const boxRatios = figureAspectSummary(profile).filter((a) => a.ratio > 0);

  const flash = (ok, msg) => {
    setStatus({ ok, msg });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 6000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const applyToSlots = (options = null) => {
    const res = applyFigureStyleToSlots(profile, options);
    if (update) update({ figureStyleTag: res.tag, figureStyleAppliedAt: new Date().toISOString() });
    if (res.changed) setUndoable(true);
    return res;
  };
  const messageOf = (res) => (res.changed
    ? `🎨 Figure style ${res.tag} applied to ${res.changed} chart${res.changed > 1 ? 's' : ''} (${res.total} on the page)`
    : `🎨 Nothing to change — the ${res.total} chart(s) of this page already use ${res.tag}`);

  const applyThisPage = () => {
    const res = applyToSlots();
    setOpen(false);
    flash(true, messageOf(res));
  };

  // Closed sections are not rendered at all, so their charts register only once
  // the page is expanded. The "▸ Expand all" button only EXISTS while it would
  // expand (see ActiveTestModule), hence clicking it is always safe. The whole
  // dance lives in utils/figureStyle (the automatic re-capture uses it too).
  const applyEverywhere = () => {
    const res = applyFigureStyleEverywhere(profile);
    setOpen(false);
    flash(true, `${messageOf(res)}${res.expanded ? ' · closed sections opened' : ''}`);
  };

  const undo = () => {
    const n = undoFigureStyleSlots();
    if (update) update({ figureStyleTag: '' });
    setUndoable(false);
    flash(n > 0, n > 0 ? `↺ Figure style removed from ${n} chart${n > 1 ? 's' : ''}` : '↺ Nothing to undo');
  };

  /* The one-click switch: the configuration BECOMES the profile — so the next
     page opens with it — and is pushed into the charts of this page right away,
     without pressing “Apply”. */
  const switchConfig = (id) => {
    const res = applyFigureStyleConfig(id, { slots: true });
    if (!res) { flash(false, '↔ That configuration no longer exists'); return; }
    if (update) update({ figureStyleTag: res.tag, figureStyleAppliedAt: new Date().toISOString() });
    if (res.changed) setUndoable(true);
    flash(true, `↔ “${res.config.name}” → ${res.changed} chart${res.changed > 1 ? 's' : ''} restyled (${res.total} on the page)`);
  };

  /* Saving from the page uses the name of the configuration in use when there is
     one — i.e. it UPDATES it — and the sizes of the profile otherwise. */
  const saveConfigHere = () => {
    const res = saveFigureStyleConfig(current ? current.name : '', profile);
    flash(true, `💾 “${res.config.name}” ${res.replaced ? 'updated' : 'saved'}`);
  };

  /* Auto-apply on open (a Settings option): the page is lazy — charts mount while
     the sections open — so the profile is pushed twice, a moment apart. */
  useEffect(() => {
    if (!profile.applyOnOpen || !test) return undefined;
    if (test.figureStyleTag === tag) return undefined;
    const key = `${test.id || test.name || ''}|${tag}`;
    if (autoRef.current === key) return undefined;
    autoRef.current = key;
    const timers = [
      setTimeout(() => { if (figureStyleSlotCount() > 0) applyToSlots(); }, 1500),
      setTimeout(() => applyToSlots(), 3500)
    ];
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.applyOnOpen, tag, test && test.id, test && test.name, test && test.figureStyleTag]);

  return (
    <div style={{ position: 'fixed', left: 12, bottom: 16, zIndex: 62, pointerEvents: 'auto' }}
      className="no-print" data-figure-style-tools="1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Global figure style ${tag} — apply the character sizes of Settings → Figure style to every chart / spectrum of this page`}
        className={`${CHIP} ${applied ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50'}`}
      >
        🎨 <span>Figure style</span>
        <span className="font-mono text-[10px] text-slate-500">{tag}</span>
        {applied ? <span>✓</span> : null}
      </button>
      {open && (
        <div
          className="absolute bg-white border border-slate-300 rounded-xl shadow-lg p-3 w-[19rem] text-xs text-slate-700"
          style={{ bottom: 36, left: 0 }}
        >
          <div className="font-bold text-slate-800 mb-1">Uniform figure style</div>
          <div className="text-[11px] text-slate-500 leading-relaxed mb-2">
            Ticks <b>{profile.fontSize} px</b> · axis titles <b>{profile.axisTitleFontSize} px</b> ·
            {' '}legends <b>{profile.legendFontSize} px</b> · data labels <b>{profile.simLabelFontSize} px</b> ·
            {' '}x rotation <b>{profile.tickAngle}°</b>
            {' '}· plot box <b>{boxRatios.length
              ? boxRatios.map((a) => `${a.kind} ${a.ratio} : 1`).join(' · ')
              : 'per chart'}</b>
            {profile.fontFamily
              ? <> · font <b>{profile.fontFamily.split(',')[0].replace(/"/g, '').trim()}</b></>
              : null}
            {' '}— {slots} styled chart{slots === 1 ? '' : 's'} on this page.
            Rules: Settings → Figure style.
          </div>
          <div className="flex flex-col gap-1.5 mb-2 border-b border-slate-100 pb-2">
            <div className="text-[10px] font-black text-slate-400 uppercase">Saved configuration</div>
            <select
              value={current ? current.id : ''}
              onChange={(e) => { if (e.target.value) switchConfig(e.target.value); }}
              title="Switching applies the configuration to the charts of this page immediately"
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-[11px] bg-white outline-none focus:border-indigo-500"
            >
              <option value="">{current ? `— ${current.name} —` : '— not saved (my own sizes) —'}</option>
              {configs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" onClick={saveConfigHere}
              className="rounded-md bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold py-1">
              💾 {current ? `Update “${current.name}”` : `Save as “${figureStyleConfigName(profile)}”`}
            </button>
            <div className="text-[10px] text-slate-400 leading-snug">
              The list is managed in Settings → Figure style (rename, delete, backup).
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={applyThisPage}
              className="rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5">
              Apply to every chart of this page
            </button>
            <button type="button" onClick={applyEverywhere}
              className="rounded-md bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold py-1.5">
              Apply incl. closed sections (expands them)
            </button>
            <button type="button" onClick={undo} disabled={!undoable && !figureStyleUndoAvailable()}
              className="rounded-md bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold py-1.5 disabled:opacity-40">
              ↺ Undo the last apply
            </button>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 leading-relaxed">
            A 📷 figure keeps the style it was rendered with — apply first, then capture, and figures of
            different experiments line up in the Image Builder.
          </div>
        </div>
      )}
      {status && (
        <div style={{ position: 'fixed', left: 12, bottom: 52, zIndex: 63 }}>
          <span className={`text-[11px] font-bold px-3 py-1.5 rounded-full shadow-md border whitespace-nowrap ${
            status.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-red-50 text-red-600 border-red-300'}`}>
            {status.msg}
          </span>
        </div>
      )}
    </div>
  );
};

export default FigureStyleApplyButton;
