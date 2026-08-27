import React, { useState } from 'react';

/* ============================================================================
GEL SCHEME — a visual, translucent light-blue gel editor
================================================================================
Lets the user build a gel-loading scheme for any experiment section:
  * click a well, then pick a compound from the Definitions & Labels list
    (ctx.allCmpds / ctx.selectedCompounds) or the special "Ladder" marker;
  * bands are placed semi-realistically from the compound's molecular weight /
    length (smaller species migrate farther on a log scale);
  * the scheme is persisted on the test under activeTest[storageKey]
    (default "gelScheme") as { wellCount, wells: [{ c: '' | name | '__ladder__' }] }.
Also exports gelSchemeText() / gelSchemeToHtml() for notebook / print exports.
============================================================================ */

const LADDER = '__ladder__';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const GEL_PALETTE = [
  '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777',
  '#0891b2', '#dc2626', '#65a30d', '#ea580c', '#4f46e5',
  '#0284c7', '#16a34a', '#c026d3', '#e11d48', '#ca8a04'
];

/* Deterministic [0,1) hash of a name — used for fallback colors & positions. */
const hash01 = (str) => {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
};

const compoundColor = (name, cmpColors = {}) => {
  if (name === LADDER) return '#64748b';
  const c = cmpColors && cmpColors[name];
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  return GEL_PALETTE[(hash01(name) * GEL_PALETTE.length) | 0];
};

const truncate = (s, n) => {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, Math.max(1, n - 1)) + '…';
};

/* -------- band position (log-scale migration, % of the band area) -------- */
const LOG_MIN = Math.log(120);
const LOG_MAX = Math.log(1200000);

const compoundSize = (name, bandKind, compoundMeta = {}) => {
  const m = (compoundMeta && compoundMeta[name]) || {};
  if (bandKind === 'protein') {
    const mw = Number(m.molecularWeight);
    if (Number.isFinite(mw) && mw > 0) return mw; // Da
    const len = Number(m.length);
    if (Number.isFinite(len) && len > 0) return len * 110; // aa -> Da
    return null;
  }
  const len = Number(m.length);
  if (Number.isFinite(len) && len > 0) return len; // bp
  const seq = String(m.sequence || m.dnaSequence || '').replace(/<[^>]*>/g, '').replace(/[^A-Za-z]/g, '');
  if (seq.length > 0) return seq.length; // bp from sequence
  const mw = Number(m.molecularWeight);
  if (Number.isFinite(mw) && mw > 0) return mw;
  return null;
};

const bandPos = (name, bandKind, compoundMeta = {}) => {
  const size = compoundSize(name, bandKind, compoundMeta);
  let f = hash01(name);
  if (size != null && size > 0) f = (Math.log(size) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  f = clamp(f, 0, 1);
  // smaller species migrate farther from the well (lower on the gel)
  return 14 + (1 - f) * 62; // 14%..76% of the band area
};

const LADDER_FRACTIONS = [0.14, 0.32, 0.5, 0.68, 0.84];

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

const WELL_COUNT_OPTIONS = [6, 8, 10, 12, 16, 20];

/* ============================================================================
React editor
============================================================================ */
export const GelScheme = ({
  ctx = {},
  storageKey = 'gelScheme',
  title = 'Gel scheme',
  subtitle,
  bandKind = 'dna',
  defaultWells = 12,
  minWells = 6,
  maxWells = 20
}) => {
  const { activeTest = {}, updateActiveTest } = ctx;
  const scheme =
    activeTest[storageKey] && typeof activeTest[storageKey] === 'object'
      ? activeTest[storageKey]
      : {};

  const wellCount = clamp(Number(scheme.wellCount) || defaultWells, minWells, maxWells);
  const rawWells = Array.isArray(scheme.wells) ? scheme.wells : [];

  /* Normalized wells — always exactly wellCount entries. */
  const wells = (() => {
    const out = [];
    for (let i = 0; i < wellCount; i++) {
      const raw = rawWells[i];
      out.push({
        c: raw && typeof raw === 'object' ? String(raw.c || '') : String(raw || '')
      });
    }
    return out;
  })();

  const save = (patch) => {
    if (!updateActiveTest) return;
    updateActiveTest({ [storageKey]: { ...scheme, ...patch, updatedAt: Date.now() } });
  };

  const setWell = (i, c) => {
    const next = wells.map((w, idx) => (idx === i ? { c } : { ...w }));
    save({ wells: next, wellCount });
  };

  const onWellCount = (n) => {
    const next = Array.from({ length: n }, (_, i) => (wells[i] ? { c: wells[i].c } : { c: '' }));
    save({ wells: next, wellCount: n });
  };

  const clearAll = () => save({ wells: wells.map(() => ({ c: '' })), wellCount });

  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');

  const allCmpds = Array.isArray(ctx.allCmpds) ? ctx.allCmpds : [];
  const selectedCompounds = Array.isArray(ctx.selectedCompounds)
    ? ctx.selectedCompounds.filter(Boolean)
    : [];
  const allList = [...new Set([...selectedCompounds, ...allCmpds])]
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));

  const q = query.trim().toLowerCase();
  const testList = q ? selectedCompounds.filter((n) => n.toLowerCase().includes(q)) : selectedCompounds;
  const defsList = q ? allList.filter((n) => n.toLowerCase().includes(q)) : allList;

  const filled = wells.filter((w) => w.c).length;
  const usedCompounds = [...new Set(wells.map((w) => w.c).filter((c) => c && c !== LADDER))];
  const hasLadder = wells.some((w) => w.c === LADDER);

  const chipCls =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors cursor-pointer';

  const selectWell = (i) => {
    if (!updateActiveTest) return;
    setSelected(selected === i ? null : i);
    setQuery('');
  };

  const assign = (i, c) => {
    setWell(i, c);
    if (c && c !== LADDER && i + 1 < wellCount) setSelected(i + 1);
  };


  return (
    <div>
      {/* header / controls */}
      <div className="flex justify-between items-center flex-wrap gap-2 mb-2">
        <div>
          <label className="text-xs font-bold text-slate-600 uppercase">{title}</label>
          <p className="text-[10px] text-slate-400 leading-snug">
            {subtitle ||
              'Click a well, then pick a compound from Definitions & Labels to show what runs in each lane.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-slate-400">
            {filled}/{wellCount} wells filled
          </span>
          <label className="text-[10px] font-bold text-slate-500 uppercase">Wells</label>
          <select
            value={wellCount}
            onChange={(e) => onWellCount(Number(e.target.value))}
            className="border border-slate-300 bg-white rounded-lg px-1.5 py-1 text-xs outline-none focus:border-blue-500 font-semibold"
          >
            {WELL_COUNT_OPTIONS.filter((n) => n >= minWells && n <= maxWells).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={clearAll}
            className="bg-white hover:bg-red-50 border border-slate-300 text-slate-600 hover:text-red-600 font-bold px-2.5 py-1 rounded-lg text-[11px] shadow-sm"
          >
            🧹 Clear all
          </button>
        </div>
      </div>

      {/* ---- the gel ---- */}
      <div
        className="relative rounded-2xl border border-blue-200/90 overflow-hidden"
        style={{
          background:
            'linear-gradient(180deg, rgba(191,219,254,0.85), rgba(224,242,254,0.45) 55%, rgba(125,190,240,0.55))',
          boxShadow: 'inset 0 2px 12px rgba(59,130,246,0.18), 0 1px 3px rgba(15,23,42,0.08)'
        }}
      >
        {/* comb bar */}
        <div
          className="absolute top-0 inset-x-0 h-5"
          style={{ background: 'linear-gradient(180deg, #1e293b, #475569)' }}
        />
        {/* lanes */}
        <div className="overflow-x-auto custom-scrollbar">
          <div className="flex px-1.5 pt-5 pb-1" style={{ minWidth: `${Math.max(320, wellCount * 46)}px` }}>

            {wells.map((w, i) => {
              const isSel = selected === i;
              const isLadder = w.c === LADDER;
              const color = w.c ? compoundColor(w.c, ctx.cmpColors) : null;
              const pos = isLadder || !w.c ? null : bandPos(w.c, bandKind, ctx.compoundMeta);
              const label = isLadder ? 'Ladder' : w.c || '';
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`Well ${i + 1}${w.c ? `: ${w.c}` : ' (empty)'}`}
                  onClick={() => selectWell(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectWell(i);
                    }
                  }}
                  className={`relative flex-1 flex flex-col items-center rounded-lg cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    i > 0 ? 'border-l border-white/40' : ''
                  } ${isSel ? 'bg-sky-100/80 ring-2 ring-blue-400 z-10' : 'hover:bg-white/40'}`}
                  title={w.c ? `Well ${i + 1}: ${w.c}` : `Well ${i + 1}: empty — click to add`}
                >
                  <span className="text-[9px] text-slate-500 font-bold mt-0.5 select-none">{i + 1}</span>
                  {/* well slot */}
                  <div className="w-[58%] h-3 rounded-b-md border-x border-b border-blue-300/80 bg-blue-50/80" />
                  {/* band area */}
                  <div className="relative w-full" style={{ height: 170 }}>
                    {/* running front */}
                    <div
                      className="absolute inset-x-[3%] h-0 border-t border-dashed border-sky-500/60 rounded-full"
                      style={{ top: '90%' }}
                    />
                    {isLadder ? (
                      LADDER_FRACTIONS.map((f, j) => (
                        <div
                          key={j}
                          className="absolute left-[17%] right-[17%] h-[4px] rounded-full opacity-75"
                          style={{ top: `${14 + f * 62}%`, background: '#7d8ea0' }}
                        />
                      ))
                    ) : w.c ? (
                      <div
                        className="absolute left-[17%] right-[17%] rounded-full"
                        style={{
                          top: `${pos}%`,
                          height: 6,
                          background: color,
                          boxShadow: `0 0 8px ${color}99`
                        }}
                      />
                    ) : null}
                    {!w.c && isSel && (
                      <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 text-center text-[10px] font-bold text-blue-400/80">
                        + add
                      </div>
                    )}
                  </div>
                  {/* label */}
                  <div className="w-full px-0.5 pb-1 text-center text-[9px] leading-tight select-none">
                    {label ? (
                      <span className="block max-w-full truncate font-bold" style={{ color: color || '#475569' }}>
                        {truncate(label, 11)}
                      </span>
                    ) : (
                      <span className="text-blue-300">·</span>
                    )}
                  </div>
                </div>
              );
            })}

          </div>
        </div>
      </div>

      {/* ---- legend ---- */}
      {(usedCompounds.length > 0 || hasLadder) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase mr-0.5">Legend:</span>
          {hasLadder && (
            <span className="inline-flex items-center gap-1 text-[10px] text-slate-600 bg-white/80 border border-slate-200 rounded-full px-2 py-0.5">
              <span className="w-2 h-2 rounded-full" style={{ background: '#64748b' }} />
              Ladder
            </span>
          )}
          {usedCompounds.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 text-[10px] text-slate-600 bg-white/80 border border-slate-200 rounded-full px-2 py-0.5"
              title={name}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: compoundColor(name, ctx.cmpColors) }}
              />
              {truncate(name, 18)}
            </span>
          ))}
        </div>
      )}


      {/* ---- picker ---- */}
      {selected !== null && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-white/95 backdrop-blur p-3 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <span className="text-xs font-black text-blue-700">
              Well {selected + 1} — {wells[selected]?.c === LADDER ? 'Ladder' : wells[selected]?.c || 'empty'}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setWell(selected, LADDER)}
                className={`${chipCls} bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700 ${
                  wells[selected]?.c === LADDER ? 'ring-2 ring-slate-400' : ''
                }`}
              >
                🧬 Ladder
              </button>
              <button
                type="button"
                onClick={() => setWell(selected, '')}
                className={`${chipCls} bg-red-50 hover:bg-red-100 border-red-200 text-red-600 ${
                  !wells[selected]?.c ? 'ring-2 ring-red-300' : ''
                }`}
              >
                ✖ Empty
              </button>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={`${chipCls} bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-700`}
              >
                ✓ Done
              </button>
            </div>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter compounds…"
            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 bg-white"
          />

          {testList.length > 0 && (
            <div className="mt-2">
              <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">In this test</div>
              <div className="flex flex-wrap gap-1.5">
                {testList.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => assign(selected, name)}
                    title={name}
                    className={`${chipCls} border-blue-200 text-blue-800 ${
                      wells[selected]?.c === name
                        ? 'bg-blue-200 ring-2 ring-blue-400'
                        : 'bg-blue-50 hover:bg-blue-100'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: compoundColor(name, ctx.cmpColors) }}
                    />
                    {truncate(name, 22)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2">
            <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">
              Definitions &amp; Labels — compounds
            </div>
            {defsList.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic">
                No compounds found{q ? ' for that filter' : ''}. Add compounds in Definitions &amp; Labels to load wells.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                {defsList.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => assign(selected, name)}
                    title={name}
                    className={`${chipCls} border-slate-200 text-slate-700 ${
                      wells[selected]?.c === name
                        ? 'bg-slate-200 ring-2 ring-blue-400'
                        : 'bg-slate-50 hover:bg-blue-50 hover:border-blue-300'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: compoundColor(name, ctx.cmpColors) }}
                    />
                    {truncate(name, 22)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};



/* ============================================================================
Export helpers (notebook / print HTML)
============================================================================ */
export const gelSchemeText = (scheme) => {
  if (!scheme || !Array.isArray(scheme.wells)) return '';
  const n = clamp(Number(scheme.wellCount) || scheme.wells.length || 0, 1, 24);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const raw = scheme.wells[i];
    const c = raw && typeof raw === 'object' ? raw.c : raw;
    parts.push(`Well ${i + 1}: ${c === LADDER ? 'Ladder' : c || 'empty'}`);
  }
  return parts.join(' · ');
};

/* Renders the same scheme as a standalone translucent-light-blue SVG. */
export const gelSchemeToHtml = (scheme, ctx = {}, bandKind = 'dna') => {
  if (!scheme || !Array.isArray(scheme.wells)) return '';
  const compoundMeta = ctx.compoundMeta || {};
  const cmpColors = ctx.cmpColors || {};

  const n = clamp(Number(scheme.wellCount) || scheme.wells.length || 12, 2, 24);
  const wells = scheme.wells.slice(0, n);
  const L = wells.length || n;

  const laneW = 64;
  const gelX = 16;
  const gelW = gelX + L * laneW + gelX;
  const H = 330;
  const topBand = 74;
  const bandH = 200;
  const frontY = topBand + bandH + 8;
  const labelY = frontY + 30;
  const gid = `gs_${Math.random().toString(36).slice(2, 9)}`;
  const laneCenter = (i) => gelX + i * laneW + laneW / 2;
  const esc = escHtml;

  let svg = '';
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gelW} ${H}" style="width:100%;max-width:${Math.round(gelW)}px;height:auto;display:block;background:transparent;">`;
  svg +=
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#bae0fd" stop-opacity="0.95"/>` +
    `<stop offset="0.55" stop-color="#dff0fe" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="#7cc0f0" stop-opacity="0.85"/>` +
    `</linearGradient></defs>`;

  /* gel body */
  svg += `<rect x="${gelX}" y="${topBand - 16}" width="${L * laneW}" height="${bandH + 26}" rx="12" fill="url(#${gid})" stroke="#9dc6ea" stroke-width="1.5"/>`;
  /* comb bar + well slots */
  svg += `<rect x="${gelX}" y="${topBand - 34}" width="${L * laneW}" height="16" rx="4" fill="#334155"/>`;
  for (let i = 0; i < L; i++) {
    const cx = laneCenter(i);
    svg += `<rect x="${cx - laneW * 0.27}" y="${topBand - 18}" width="${laneW * 0.54}" height="12" rx="2" fill="#eef6ff" stroke="#b3d3ef" stroke-width="1"/>`;
  }
  /* running front */
  svg += `<line x1="${gelX + 6}" y1="${frontY}" x2="${gelX + L * laneW - 6}" y2="${frontY}" stroke="#5ba3e0" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity="0.7"/>`;


  for (let i = 0; i < L; i++) {
    const raw = wells[i];
    const c = raw && typeof raw === 'object' ? String(raw.c || '') : String(raw || '');
    const cx = laneCenter(i);
    const bw = laneW * 0.58;
    const bx = cx - bw / 2;

    if (c === LADDER) {
      LADDER_FRACTIONS.forEach((f) => {
        svg += `<rect x="${bx}" y="${topBand + f * bandH}" width="${bw}" height="4.5" rx="2.2" fill="#7d8ea0" opacity="0.85"/>`;
      });
    } else if (c) {
      const p = bandPos(c, bandKind, compoundMeta);
      const col = compoundColor(c, cmpColors);
      svg += `<rect x="${bx}" y="${topBand + (p / 100) * bandH}" width="${bw}" height="6" rx="3" fill="${col}"/>`;
    }

    svg += `<text x="${cx}" y="26" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#94a3b8">${i + 1}</text>`;
    const label = c === LADDER ? 'Ladder' : c;
    svg += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="${label ? 'bold' : 'normal'}" fill="${label ? esc(compoundColor(c, cmpColors)) : '#cbd5e1'}">${esc(truncate(label, 12))}</text>`;
  }
  svg += `</svg>`;

  const summary = gelSchemeText(scheme);
  return (
    `<div style="background:rgba(224,242,254,0.3);border:1px solid #bfdbfe;border-radius:10px;padding:10px;margin-bottom:12px;">` +
    `<div style="font-size:11px;font-weight:700;color:#1d4ed8;margin-bottom:6px;">🧪 Gel Scheme — well contents</div>` +
    svg +
    `<div style="font-size:10px;color:#475569;margin-top:8px;line-height:1.5;">${esc(summary)}</div>` +
    `</div>`
  );
};

export default GelScheme;

