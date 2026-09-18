import React from 'react';
import { DEFAULT_ARROW, DEFAULT_SHADOW, normalizeArrow, shadowSpec } from '../utils/figureArrows';

/* ============================================================================
   FIGURE ANNOTATIONS — the properties of a SHADOW and of an ARROW, for the
   Image Builder canvas.

   Both blocks live here (instead of inside ImageBuilder.jsx, which is already
   the biggest file of the app) and both are MODULE-LEVEL components: a
   component declared INSIDE ImageBuilder would be a new function on every
   render, so React would remount the block at each keystroke and the number
   fields would lose focus as soon as the canvas re-rendered.

   • ShadowControls — ONE control block for every shadowed element: a PANEL
     (Object Properties), a FIGURE of a panel and an ARROW share it, and all
     three write the very same record `{ dx, dy, blur, color, opacity }` (mm)
     that the canvas renders with
     ONE <feDropShadow> filter (see utils/figureArrows). The filter is part of
     the composition SVG, so Export PNG / Save canvas / Insert into project keep
     the shadow — those paths rasterize that very SVG.

   • ArrowPropertiesPanel — the panel of ONE selected arrow: shape (straight /
     curved), ends (one head / double), bow, the two ends in mm, thickness,
     head size, colour, dashed and the arrow's own shadow.
   ========================================================================= */

/** The four numeric shadow fields, with the ranges shadowSpec() clamps to. */
export const SHADOW_FIELDS = [
  { key: 'dx', label: 'X (mm)', min: -40, max: 40, step: 0.5 },
  { key: 'dy', label: 'Y (mm)', min: -40, max: 40, step: 0.5 },
  { key: 'blur', label: 'Blur (mm)', min: 0, max: 12, step: 0.2 },
  { key: 'opacity', label: 'Opacity', min: 0.02, max: 1, step: 0.05 }
];

export const ShadowControls = ({ value, onChange, hint }) => (
  <div className="flex flex-col gap-1.5">
    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer"
      title="A drop shadow behind this element — drawn in the composition, so every export keeps it.">
      <input type="checkbox" checked={!!value}
        onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_SHADOW } : null)} /> 🌓 Drop shadow
    </label>
    {value ? (
      <>
        <div className="grid grid-cols-4 gap-1.5">
          {SHADOW_FIELDS.map((f) => (
            <label key={f.key} className="text-[9px] font-bold text-slate-500">{f.label}
              <input type="number" min={f.min} max={f.max} step={f.step} value={value[f.key]}
                onWheel={(e) => e.target.blur()}
                onChange={(e) => onChange({ ...value, [f.key]: Number(e.target.value) })}
                className="w-full border rounded p-0.5 text-[10px]" />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] font-bold text-slate-500 flex items-center gap-1">Colour
            <input type="color" value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value })}
              className="w-8 h-6 rounded border cursor-pointer" />
          </label>
          <button type="button" onClick={() => onChange({ ...DEFAULT_SHADOW })}
            className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-2 py-0.5 rounded text-[10px]"
            title="Back to the default shadow (1.5 mm down-right, 1.2 mm blur)">↺ Default</button>
        </div>
      </>
    ) : null}
    {hint ? <span className="text-[9px] text-slate-400 italic">{hint}</span> : null}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   ARROW PROPERTIES — the panel of ONE selected annotation.

   An arrow is a CANVAS annotation (see utils/figureArrows): two ends in mm plus
   how it is drawn. The three shapes a figure needs come from two independent
   switches — Shape (straight | curved) and Ends (one head | double) — so every
   combination works (a curved double-headed arrow included) and the panel stays
   honest about what is drawn. The numeric ends and the on-canvas handles are the
   same data: typing X1/Y1 moves the end the blue handle sits on.
   ──────────────────────────────────────────────────────────────────────────── */
export const ArrowPropertiesPanel = ({ arrow, isFloating = false, onChange, onDelete }) => {
  if (!arrow) return null;
  const a = normalizeArrow(arrow);
  const pick = (on) => `font-bold px-2.5 py-1 rounded text-[11px] border ${on
    ? 'bg-slate-800 text-white border-slate-800'
    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`;
  const cell = 'text-[10px] font-bold text-slate-500';
  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3 ${isFloating ? 'shadow-2xl max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar' : ''}`}>
      <div className="flex justify-between items-center">
        <h4 className="font-bold text-slate-700">↗ Arrow properties</h4>
        {/* ⚠️ `onClick={() => onDelete()}` — et NON `onClick={onDelete}` : le
            gestionnaire recevrait l'ÉVÉNEMENT DE CLIC comme premier argument,
            c'est-à-dire comme identifiant de la flèche à supprimer. Le bouton
            semblait alors ne rien faire (le panneau se refermait, la flèche
            restait sur le canevas). */}
        <button type="button" onClick={() => onDelete()}
          className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100"
          title="Remove this arrow from the canvas (Ctrl+Z brings it back)">Delete</button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-slate-500 uppercase">Shape</span>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" onClick={() => onChange({ style: 'straight' })} className={pick(a.style === 'straight')}
            title="A straight arrow from one end to the other">➡ Straight</button>
          <button type="button" onClick={() => onChange({ style: 'curved' })} className={pick(a.style === 'curved')}
            title="A curved (bowed) arrow — how much it bows is the “Curve (mm)” value below">⤴ Curved</button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-slate-500 uppercase">Ends</span>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" onClick={() => onChange({ double: false })} className={pick(!a.double)}
            title="One head, at the second end">→ One head</button>
          <button type="button" onClick={() => onChange({ double: true })} className={pick(a.double)}
            title="A head at BOTH ends — a double arrow">↔ Double</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className={cell}>Curve (mm)
          <input type="number" min="-80" max="80" step="0.5" value={a.curve} disabled={a.style !== 'curved'}
            onWheel={(e) => e.target.blur()}
            onChange={(e) => onChange({ curve: Number(e.target.value) })}
            className="w-full border rounded p-1 text-xs disabled:bg-slate-100 disabled:text-slate-400" />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={() => onChange({ curve: -a.curve })} disabled={a.style !== 'curved'}
            className="w-full bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-2 py-1 rounded text-[11px] disabled:opacity-40"
            title="Bow it the other way">⇅ Flip the bow</button>
        </div>
        {[['x1', 'X1 (mm)'], ['y1', 'Y1 (mm)'], ['x2', 'X2 (mm)'], ['y2', 'Y2 (mm)']].map(([key, label]) => (
          <label key={key} className={cell}>{label}
            <input type="number" step="0.5" value={+Number(a[key]).toFixed(1)} onWheel={(e) => e.target.blur()}
              onChange={(e) => onChange({ [key]: Number(e.target.value) })}
              className="w-full border rounded p-1 text-xs" />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className={cell}>Thickness (mm)
          <input type="number" min="0.05" max="4" step="0.05" value={a.width} onWheel={(e) => e.target.blur()}
            onChange={(e) => onChange({ width: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" />
        </label>
        <label className={cell}>Head size (mm)
          <input type="number" min="0.5" max="12" step="0.2" value={a.headSize} onWheel={(e) => e.target.blur()}
            onChange={(e) => onChange({ headSize: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[10px] font-bold text-slate-500 flex items-center gap-1">Colour
          <input type="color" value={a.color} onChange={(e) => onChange({ color: e.target.value })}
            className="w-8 h-6 rounded border cursor-pointer" />
        </label>
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer">
          <input type="checkbox" checked={a.dash} onChange={(e) => onChange({ dash: e.target.checked })} /> Dashed
        </label>
        <button type="button" onClick={() => onChange({ ...DEFAULT_ARROW, shadow: a.shadow })}
          className="ml-auto bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-2 py-0.5 rounded text-[10px]"
          title="Back to the default look (red, 0.7 mm, 3 mm head, straight, one head) — the ends and the shadow stay">↺ Defaults</button>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-slate-200 pt-2">
        <span className="text-xs font-bold text-slate-500 uppercase">Shadow</span>
        <ShadowControls value={shadowSpec(a.shadow)} onChange={(v) => onChange({ shadow: v })}
          hint="The arrow casts its own drop shadow — in the composition and in every export." />
      </div>

      <span className="text-[9px] text-slate-400 italic">
        On the canvas: drag the arrow to move it, drag a blue end handle to aim it. The arrow is drawn on top of the
        panels and IS part of Export PNG / Save canvas / Insert into project — the selection handles never are.
      </span>
    </div>
  );
};

