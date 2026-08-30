import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { getStarredItems } from '../utils/starredItems';
import {
  readLibrary, writeLibrary, removeLibraryItem, renameLibraryItem,
  readProjectLibrary, writeProjectLibrary, removeProjectLibraryItem, renameProjectLibraryItem, moveLibraryItem,
  addLibraryItem, addProjectLibraryItem,
  readDeck, writeDeck, uid, makeLibraryImage, blobToDataUrl, resolveImageToDataUrl
} from '../utils/figuresLibrary';
import { uploadWorkspaceFile, getDriveToken } from '../utils/driveUpload';
import { getRenderableDriveUrl } from '../data/constants';

/* =========================================================================
   FiguresSlidesSection — "Figures & Slides" builder (Publications page).
   A PowerPoint-like deck of slides made of image + text blocks:
   • images come from the app-wide library (uploads, pasted images, formulas,
     ⭐-starred experiment charts, 3D viewer captures) and are reusable,
   • drag & drop: reorder slides/blocks with the mouse, or drag a library
     image onto a slide to add it,
   • per-block / per-slide formatting (font size, bold/italic, alignment,
     colours, image size),
   • fullscreen presentation + high-resolution (300 DPI) PDF export.
   ========================================================================= */

const inputCls = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
const btnGhost = 'text-xs font-bold px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50';

// Block formatting presets.
const TEXT_SIZES = { sm: 12, md: 16, lg: 22, xl: 30 };     // editor px
const IMG_SIZES = { sm: '30%', md: '55%', lg: '80%', xl: '100%' }; // width within cell
const ALIGN = ['left', 'center', 'right'];

const emptyBlock = (type) => ({
  id: uid('blk'), type,
  size: 'md', align: type === 'text' ? 'left' : 'center',
  bold: false, italic: false, color: '#1f2937', bg: '',
  w: 100, h: type === 'image' ? 240 : 200,   // panel dimensions (width % / height px)
  zoom: 100,                                  // content zoom inside the panel (%)
  fontSize: null,                             // explicit px font size (falls back to TEXT_SIZES[size])
  panel: '',                                  // multi-panel figure label (A, B, C, …)
  url: '', full: '', caption: '', text: ''
});

// A compact −/value/+ stepper used by the per-block control bar.
const Stepper = ({ label, value, unit = '', min, max, step = 1, onChange }) => (
  <span className="flex items-center gap-0.5 bg-white border border-slate-200 rounded px-1 py-0.5" title={`${label} ${value}${unit}`}>
    <span className="text-[9px] font-bold text-slate-500">{label}</span>
    <button type="button" onClick={() => onChange(Math.max(min, value - step))}
      className="w-3.5 h-3.5 leading-none text-[10px] font-black text-slate-500 hover:text-slate-900">−</button>
    <span className="text-[9px] font-bold text-slate-600 tabular-nums min-w-[26px] text-center">{value}{unit}</span>
    <button type="button" onClick={() => onChange(Math.min(max, value + step))}
      className="w-3.5 h-3.5 leading-none text-[10px] font-black text-slate-500 hover:text-slate-900">+</button>
  </span>
);

// Map a block width (%, 10–100) onto a 12-column grid span.
const COL_SPAN_CLASSES = {
  1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4', 5: 'col-span-5',
  6: 'col-span-6', 7: 'col-span-7', 8: 'col-span-8', 9: 'col-span-9', 10: 'col-span-10',
  11: 'col-span-11', 12: 'col-span-12'
};
const colSpanCls = (b) =>
  COL_SPAN_CLASSES[Math.max(1, Math.min(12, Math.round(((b.w || 100) / 100) * 12)))] || 'col-span-12';
const blockFont = (b) => b.fontSize || TEXT_SIZES[b.size] || 16;

// Editor "page height" reference (px) — height presets are fractions of it,
// and the PDF/PNG exports scale it by ~3 to reach the 300 DPI page.
const PAGE_H = 560;
const H_PRESETS = [['¼', Math.round(PAGE_H / 4)], ['⅓', Math.round(PAGE_H / 3)], ['½', Math.round(PAGE_H / 2)], ['1', PAGE_H]];
const W_PRESETS = [['¼', 25], ['⅓', 33], ['½', 50], ['1', 100]];
// Next panel letter for a slide (A, B, C, … Z).
const nextPanelLetter = (blocks) => {
  const used = new Set((blocks || []).map((b) => String(b.panel || '').trim().toUpperCase()).filter(Boolean));
  for (let i = 0; i < 26; i++) {
    const L = String.fromCharCode(65 + i);
    if (!used.has(L)) return L;
  }
  return 'Z';
};

/* ---- PNG export helpers (canvas-based, A4 landscape @ 300 DPI) ------------- */
const downloadDataUrl = (dataUrl, filename) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
const hexToRgbStyle = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#1f2937';
  return `#${m[1]}`;
};
const drawImageFitted = (ctx, url, x, y, w, h, zoom = 100) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(w / img.width, h / img.height);
        let iw = img.width * scale * (zoom / 100), ih = img.height * scale * (zoom / 100);
        if (iw > w || ih > h) { const f = Math.min(w / iw, h / ih); iw *= f; ih *= f; }
        ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      } catch { /* skip broken image */ }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
const roundRectCanvas = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
const wrapCanvasText = (ctx, text, x, y, width, lineH, align, maxH) => {
  const lines = [];
  String(text || '').split(/\n/).forEach((para) => {
    let cur = '';
    String(para).split(/\s+/).forEach((w2) => {
      const t = cur ? cur + ' ' + w2 : w2;
      if (cur && ctx.measureText(t).width > width) { lines.push(cur); cur = w2; }
      else cur = t;
    });
    if (cur) lines.push(cur);
  });
  const maxLines = Math.max(1, Math.floor(maxH / lineH) - 1);
  lines.slice(0, maxLines).forEach((ln) => {
    const tw = ctx.measureText(ln).width;
    const tx = align === 'center' ? x + (width - tw) / 2 : align === 'right' ? x + width - tw : x;
    ctx.fillText(ln, tx, y);
    y += lineH;
  });
};

// Renders a slide (from the deck) onto a 300-DPI A4-landscape canvas and returns
// its PNG dataURL. Shared by the "⬇ Slide PNG" export and the project sections'
// "🖼 Insert slide" feature. External (Drive) image sources are resolved to
// dataURLs first so the canvas is never tainted.

// Renders a REGION-based slide (the structured 16/20-panel figure) onto a canvas:
// white background, cols×rows grid, every region with its image (clipped at the
// panel limits), panel letter, text line and spectrum peak labels, then the
// global figure caption at the very bottom.
const renderRegionsToDataUrl = async (slide, maxSide = 0) => {
  const orientation = slide.orientation || 'square';
  const g = ORIENT_GRID[orientation] || ORIENT_GRID.square;
  const cols = slide.cols || g.cols, rows = slide.rows || g.rows;
  const W = 2400, titleH = 120, capH = 220, m = 60;
  const gw = W - 2 * m, gh = Math.round((W - 2 * m) * rows / cols);
  const H = titleH + gh + capH + m;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  if ((slide.title || '').trim()) {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 52px Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(slide.title).trim().slice(0, 90), m, titleH / 2);
  }
  const gx = m, gy = titleH;
  const cellW = gw / cols, cellH = gh / rows;
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2;
  for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(gx + i * cellW, gy); ctx.lineTo(gx + i * cellW, gy + gh); ctx.stroke(); }
  for (let j = 0; j <= rows; j++) { ctx.beginPath(); ctx.moveTo(gx, gy + j * cellH); ctx.lineTo(gx + gw, gy + j * cellH); ctx.stroke(); }
  const loadImg = (src) => new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });
  for (const r of (slide.regions || [])) {
    const rx = gx + r.x * cellW, ry = gy + r.y * cellH, rw = r.w * cellW, rh = r.h * cellH;
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3;
    ctx.strokeRect(rx, ry, rw, rh);
    if (r.label) {
      ctx.fillStyle = '#0f172a'; ctx.font = `bold ${Math.max(14, Math.round(40 * (slide.labelSize || 1)))}px Helvetica, Arial, sans-serif`; ctx.textBaseline = 'middle';
      ctx.fillText(String(r.label).slice(0, 2), rx + 12, ry + 36);
    }
    if (r.image) {
      const src = await resolveImageToDataUrl(r.image.full || r.image.url);
      const im = await loadImg(src);
      ctx.save();
      ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
      if (im) {
        if (r.crop && r.crop.x2 - r.crop.x1 > 0.02) {
          // spectrum crop: keep only the selected band, scaled to the panel width
          const { x1, x2 } = r.crop;
          const bandW = im.width * (x2 - x1);
          const fit = Math.min(rw / bandW, (rh - 44) / im.height);
          const iw = bandW * fit, ih = im.height * fit;
          ctx.drawImage(im, im.width * x1, 0, bandW, im.height, rx + (rw - iw) / 2, ry + (rh - 44 - ih) / 2, iw, ih);
        } else {
          const z = (r.zoom || 100) / 100;
          const fit = Math.min(rw / im.width, (rh - 44) / im.height);
          const iw = im.width * fit * z, ih = im.height * fit * z;
          ctx.drawImage(im, rx + (rw - iw) / 2, ry + (rh - 44 - ih) / 2, iw, ih);
        }
      }
      ctx.restore();
      if ((r.textBlocks && r.textBlocks.length > 0)) {
        r.textBlocks.forEach((tb) => {
          ctx.fillStyle = '#334155';
          ctx.font = `${Math.round(22 * (r.fontScale || 1))}px Helvetica, Arial, sans-serif`;
          ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
          ctx.fillText(String(tb.text).trim().slice(0, 70), rx + Math.max(0.05, Math.min(0.95, tb.x)) * rw, ry + rh - 24);
          ctx.textAlign = 'left';
        });
      } else if ((r.text || '').trim()) {
        ctx.fillStyle = '#334155';
        ctx.font = `${Math.round(22 * (r.fontScale || 1))}px Helvetica, Arial, sans-serif`;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(String(r.text).trim().slice(0, 140), rx + rw / 2, ry + rh - 24);
        ctx.textAlign = 'left';
      }
      if (r.isSpectrum && Array.isArray(r.peaks)) {
        for (const p of r.peaks) {
          const pf = r.crop ? (p.fx - r.crop.x1) / Math.max(0.02, r.crop.x2 - r.crop.x1) : p.fx;
          if (pf < -0.02 || pf > 1.02) continue;
          const px = rx + Math.max(0, Math.min(1, pf)) * rw;
          ctx.fillStyle = '#dc2626'; ctx.font = 'bold 26px Helvetica, Arial, sans-serif'; ctx.textBaseline = 'top';
          ctx.fillText('▼', px - 9, ry + 8);
          if ((p.label || '').trim()) {
            ctx.fillStyle = '#0f172a'; ctx.font = `${Math.round(24 * (r.fontScale || 1))}px Helvetica, Arial, sans-serif`;
            ctx.fillText(String(p.label).trim(), px + 10, ry + 36);
          }
        }
      }
    }
  }
  if ((slide.caption || '').trim()) {
    ctx.fillStyle = '#334155';
    ctx.font = 'italic 30px Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'top';
    wrapCanvasText(ctx, String(slide.caption).trim(), m, gy + gh + 40, gw, 38, 'left', capH);
  }
  let dataUrl = canvas.toDataURL('image/png');
  if (maxSide > 0 && Math.max(W, H) > maxSide) {
    const scale = maxSide / Math.max(W, H);
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(W * scale)); c2.height = Math.max(1, Math.round(H * scale));
    c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
    dataUrl = c2.toDataURL('image/png');
  }
  return dataUrl;
};

export const renderSlideToDataUrl = async (slide, maxSide = 0) => {
  if (slide && slide.regions) return renderRegionsToDataUrl(slide, maxSide);
  const W = 2481, H = 1754, left = 70, gap = 44, titleBarH = 150, rowGap = 56;
  const contentW = W - left * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hexToRgbStyle(slide.bg || '#ffffff');
  ctx.fillRect(0, 0, W, H);
  // Title bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, W, titleBarH);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(26, Math.min(64, (slide.titleSize || 20) * 2.4))}px Helvetica, Arial, sans-serif`;
  ctx.fillText(String(slide.title || 'Untitled slide').slice(0, 90), left, titleBarH / 2 + 14);
  // Blocks laid out in wrapping rows honouring W/H/zoom/font/panel
  let rowY = titleBarH + 40, rowH = 0, x = left;
  for (const b of (slide.blocks || [])) {
    const bw = contentW * Math.max(0.1, Math.min(1, (b.w || 100) / 100));
    const bh = Math.max(120, (b.h || 240) * 3);
    if (x + bw > left + contentW + 0.5) { rowY += rowH + rowGap; rowH = 0; x = left; }
    rowH = Math.max(rowH, bh);
    const bx = x, by = rowY;
    x += bw + gap;
    if (b.type === 'image') {
      const src = await resolveImageToDataUrl(b.full || b.url);
      await drawImageFitted(ctx, src, bx, by, bw, bh - 60, b.zoom || 100);
      if (b.panel) {
        ctx.font = 'bold 28px Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.fillText(String(b.panel).slice(0, 2), bx + 8, by + 30);
      }
      if (b.caption) {
        ctx.fillStyle = '#64748b';
        ctx.font = 'italic 13px Helvetica, Arial, sans-serif';
        ctx.fillText(String(b.caption).slice(0, 80), bx, by + bh - 22);
      }
    } else {
      if (b.bg) { ctx.fillStyle = hexToRgbStyle(b.bg); roundRectCanvas(ctx, bx, by, bw, bh, 14); ctx.fill(); }
      ctx.fillStyle = hexToRgbStyle(b.color || '#1f2937');
      ctx.font = `${b.bold ? 'bold ' : ''}${b.italic ? 'italic ' : ''}${blockFont(b) * 2.4}px Helvetica, Arial, sans-serif`;
      wrapCanvasText(ctx, b.text || '', bx, by + 30, bw, blockFont(b) * 2.4 * 1.25, b.align, bh);
    }
  }
  let dataUrl = canvas.toDataURL('image/png');
  if (maxSide > 0 && Math.max(W, H) > maxSide) {
    const scale = maxSide / Math.max(W, H);
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(W * scale));
    c2.height = Math.max(1, Math.round(H * scale));
    c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
    dataUrl = c2.toDataURL('image/png');
  }
  return dataUrl;
};

// Scaled-down live preview of a slide (pure CSS, no canvas) used by the project
// sections' slide picker. Keeps the deck's real block layout (12-col grid).
export const SlidePreview = ({ slide, width = 220, className = '' }) => {
  // Region-based slides: render the structured 16/20-panel figure.
  if (slide && slide.regions) {
    const orientation = slide.orientation || 'square';
    const g = ORIENT_GRID[orientation] || ORIENT_GRID.square;
    const cols = slide.cols || g.cols, rows = slide.rows || g.rows;
    const W = 1000, H = Math.round(W * rows / cols);
    const scale = width / W;
    return (
      <div className={`relative overflow-hidden rounded border border-slate-200 bg-white ${className}`}
        style={{ width, height: Math.round(H * scale) }}>
        <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
          <div className="absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {Array.from({ length: cols * rows }).map((_, i) => <div key={i} className="border border-slate-100" />)}
            {(slide.regions || []).map((r) => (
              <div key={r.id} className="relative overflow-hidden bg-white ring-1 ring-slate-300"
                style={{ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}` }}>
                {r.image && (() => {
                  const url = getRenderableDriveUrl(r.image.url);
                  if (r.crop) {
                    return (
                      <div className="absolute inset-0 overflow-hidden">
                        <img src={url} alt=""
                          className="absolute top-1/2 -translate-y-1/2 left-0"
                          style={{
                            width: `${(1 / Math.max(0.05, r.crop.x2 - r.crop.x1)) * 100}%`,
                            height: 'auto', maxWidth: 'none', maxHeight: 'none',
                            marginLeft: `${-(r.crop.x1 / Math.max(0.05, r.crop.x2 - r.crop.x1)) * 100}%`,
                          }} />
                      </div>
                    );
                  }
                  return (
                    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                      <div className="flex items-center justify-center"
                        style={{ width: `${r.zoom || 100}%`, height: `${r.zoom || 100}%`, flexShrink: 0 }}>
                        <img src={url} alt="" className="w-full h-full object-contain" style={{ flexShrink: 0 }} />
                      </div>
                    </div>
                  );
                })()}
                {r.label && <span className="absolute top-0.5 left-1 z-10 font-black text-slate-900" style={{ fontSize: `${Math.max(7, Math.round(12 * (slide.labelSize || 1)))}px` }}>{r.label}</span>}
                {(r.textBlocks && r.textBlocks.length > 0) ? (
                  r.textBlocks.map((tb, tbi) => (
                    <span key={tbi} className="absolute bottom-0.5 z-10 text-[10px] text-slate-600"
                      style={{ left: `${Math.max(0.05, Math.min(0.95, tb.x)) * 100}%`, transform: 'translateX(-50%)' }}>{tb.text}</span>
                  ))
                ) : (r.text || '').trim() && (
                  <span className="absolute bottom-0.5 left-0 right-0 z-10 text-center text-[10px] text-slate-600">{r.text}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  const W = 2481, H = 1754, left = 70, gap = 44, titleBarH = 150;
  const scale = width / W;
  const contentW = W - left * 2;
  return (
    <div className={`relative overflow-hidden rounded border border-slate-200 bg-white ${className}`}
      style={{ width, height: Math.round(H * scale) }}>
      <div style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, background: slide.bg || '#ffffff' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: titleBarH, background: '#1e293b', color: '#fff', fontWeight: 800, fontSize: Math.max(26, Math.min(64, (slide.titleSize || 20) * 2.4)), padding: '0 70px', lineHeight: `${titleBarH}px`, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {slide.title || 'Untitled slide'}
        </div>
        <div style={{ position: 'absolute', top: titleBarH + 40, left, right: left, display: 'flex', flexWrap: 'wrap', gap }}>
          {(slide.blocks || []).map((b) => (
            <div key={b.id} style={{ width: contentW * Math.max(0.1, Math.min(1, (b.w || 100) / 100)), minHeight: Math.max(120, (b.h || 240) * 3), overflow: 'hidden' }}>
              {b.type === 'image' ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={b.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
              ) : (
                <div style={{ background: b.bg || 'transparent', padding: 16, fontSize: blockFont(b) * 2.4, fontWeight: b.bold ? 700 : 400, fontStyle: b.italic ? 'italic' : 'normal', color: b.color || '#1f2937', textAlign: b.align, whiteSpace: 'pre-wrap' }}>
                  {b.text}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


/* ---- Region-based slide model (the new "structured figure" editor) ----------
   A slide is a white canvas divided into a grid of equal regions:
   • square → 4×4 = 16 regions, rectangular → 4×5 = 20 regions (chosen at
     creation).
   • A region is { x, y, w, h } (grid coordinates) + its content. Adjacent
     regions can be unified by expanding the selected region to a neighbour
     cell, so panels like A/B/C/D (and bigger merged ones) are possible.
   --------------------------------------------------------------------------- */
const ORIENT_GRID = {
  square: { cols: 4, rows: 4 },   // 16 regions
  '5x4': { cols: 5, rows: 4 },    // 20 regions — horizontal
  '4x5': { cols: 4, rows: 5 },    // 20 regions — portrait
  rect: { cols: 5, rows: 4 }      // legacy alias for '5x4'
};

const emptyRegion = (x, y) => ({
  id: uid('rg'), x, y, w: 1, h: 1,
  image: null,          // { url, full }
  zoom: 100,            // % zoom of the image inside the region (clipped)
  fontScale: 1,         // text / peak-label character size scale
  text: '',             // single text line at the bottom of the region
  textBlocks: [],       // merged regions keep each panel's text at its own x: [{ x (0..1), text }]
  peaks: [],            // spectrum peak labels: [{ fx (0..1), label }]
  isSpectrum: false,
  label: ''             // auto panel letter (A, B, C, …)
});

const newRegionSlide = (orientation) => {
  const g = ORIENT_GRID[orientation] || ORIENT_GRID.square;
  return {
    id: uid('slide'),
    title: orientation === 'square' ? 'Figure S1' : `Figure ${orientation === '4x5' ? 'V1' : '1'}`,
    titleSize: 20, bg: '#ffffff',
    orientation,
    cols: g.cols, rows: g.rows,
    regions: [],
    caption: '',        // global figure caption at the very bottom
    labelSize: 1        // panel-letter size multiplier (A, B, C, …)
  };
};

// Region that occupies cell (x,y) — used to find hover/click targets.
const regionAtCell = (regions, x, y) =>
  regions.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;

// Auto-assign panel letters (A, B, C, …) to populated regions in reading order.
const autoLabelRegions = (regions) => {
  const populated = regions
    .filter((r) => r.image || (r.text || '').trim())
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const map = new Map(populated.map((r, i) => [r.id, String.fromCharCode(65 + i)]));
  return regions.map((r) => ({ ...r, label: map.get(r.id) || '' }));
};

// Can region r be placed at grid position (dx, dy) without leaving the grid or
// overlapping another region?
const canPlaceRegion = (regions, r, dx, dy, cols, rows) => {
  if (dx < 0 || dy < 0 || dx + r.w > cols || dy + r.h > rows) return false;
  return !regions.some((o) => o.id !== r.id &&
    dx < o.x + o.w && dx + r.w > o.x && dy < o.y + o.h && dy + r.h > o.y);
};

// Reversible merge: splitting a merged region (w>1 or h>1) back into its
// individual 1×1 cells. The image stays in the top-left cell; each cell gets
// back the text that belonged to its column (textBlocks → bottom-row cells).
const splitRegionCells = (regions, ri) => {
  const r = regions[ri];
  if (!r || (r.w === 1 && r.h === 1)) return regions;
  const bottomY = r.y + r.h - 1;
  const out = [];
  for (let y = r.y; y <= bottomY; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const first = x === r.x && y === r.y;
      const cell = first ? { ...r, w: 1, h: 1, x, y, text: '', textBlocks: [] } : emptyRegion(x, y);
      if (!first) { cell.image = null; cell.peaks = []; cell.zoom = 100; cell.fontScale = 1; cell.isSpectrum = false; }
      out.push(cell);
    }
  }
  (r.textBlocks || []).forEach((t) => {
    const col = Math.min(r.w - 1, Math.max(0, Math.floor(t.x * r.w)));
    const idx = (bottomY - r.y) * r.w + col;
    const cell = out[idx];
    if (cell) cell.text = (cell.text || '').trim() ? `${cell.text} | ${t.text}` : t.text;
  });
  return out;
};

/* ---- StarThumb — reliable thumbnail for ⭐-starred figures -------------------
   Starred images are often Google Drive URLs that need the auth token to
   display. This component resolves them to a self-contained dataURL (Drive API
   with the token, else plain fetch, else the renderable URL). */
const StarThumb = ({ url, alt = '', className = '' }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    resolveImageToDataUrl(url).then((r) => { if (alive && r) setSrc(r); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return (
    <img
      src={src || getRenderableDriveUrl(url)}
      alt={alt}
      className={className}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
};

export const FiguresSlidesSection = ({ tests = [], projectId = 'global', jumpToTest }) => {
  const [library, setLibrary] = useState(readLibrary);
  const [projectLibrary, setProjectLibrary] = useState(() => readProjectLibrary(projectId));
  const [libTab, setLibTab] = useState('common');   // 'common' | 'project'
  const [deck, setDeck] = useState(() => readDeck(projectId));
  const [cur, setCur] = useState(() => readDeck(projectId).cur || 0);
  const [sel, setSel] = useState(null);          // selected block index
  const [libOpen, setLibOpen] = useState(false); // library panel retractable
  const [importsOpen, setImportsOpen] = useState(false); // ⭐ imports bar
  const [presenting, setPresenting] = useState(false);
  const [pi, setPi] = useState(0);
  const [dropIdx, setDropIdx] = useState(null);  // drag feedback position
  const [driveMsg, setDriveMsg] = useState('');
  const [newSlideOrient, setNewSlideOrient] = useState(null); // orientation modal
  const [selRegion, setSelRegion] = useState(null);   // selected region index (region editor)
  const [selCells, setSelCells] = useState(null);     // Set of "x,y" cells selected for merging
  const [hoverRegion, setHoverRegion] = useState(null); // region under the mouse
  const [dragRegion, setDragRegion] = useState(null);  // region index being dragged
  const [leftOpen, setLeftOpen] = useState(false);    // ⭐ sidebar tab (retractable)
  const [rightLibOpen, setRightLibOpen] = useState(false); // 📂 dataset images tab
  const [regionFullscreen, setRegionFullscreen] = useState(false); // ⛶ fullscreen editing
  const [canvasScale, setCanvasScale] = useState(1);   // canvas zoom (1 = fit, 0.4–4)
  const cropDragRef = useRef(null);   // spectrum drag-to-zoom: { ri, startX, rect }
  const [cropPreview, setCropPreview] = useState(null); // { x1, x2 } while dragging
  const suppressRegionClickRef = useRef(false); // swallow the click that follows a crop-drag
  const canvasDragRef = useRef(null);  // drag-select on the canvas: { startX, startY, rect, moved, box }
  const suppressCanvasClickRef = useRef(false); // swallow the click that follows a drag-select
  const [dragSelectBox, setDragSelectBox] = useState(null); // live drag rectangle { x1,y1,x2,y2 } in cells
  // Keep the ⭐ sidebar open long enough to move the mouse into it.
  const hoverTimerRef = useRef(null);
  const clearHoverSoon = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverRegion(null), 350);
  };
  const cancelClearHover = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
  };
  const fileRef = useRef(null);
  // Refs so the global paste listener always uses the latest closure/scope.
  // (Updated after the functions are declared — see the effect at the bottom,
  // otherwise the dependency array would hit the temporal dead zone.)
  const addToLibraryRef = useRef(null);
  const libScopeRef = useRef('common');

  useEffect(() => { writeLibrary(library); }, [library]);
  useEffect(() => { writeProjectLibrary(projectId, projectLibrary); }, [projectLibrary, projectId]);
  useEffect(() => {
    writeDeck(projectId, { ...deck, cur });
    setCur((c) => Math.max(0, Math.min(c, deck.slides.length - 1)));
    setSel((s) => { const sl = deck.slides[cur]; return s !== null && sl && s < (sl.blocks || []).length ? s : null; });
  }, [deck, projectId, cur]);

  // Paste an image from the clipboard anywhere in the Publications module →
  // the image is added to the active library scope (Ctrl+V / ⌘V).
  useEffect(() => {
    const onDocPaste = (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (!f) continue;
          e.preventDefault();
          blobToDataUrl(f).then((d) => {
            addToLibraryRef.current(d, 'Pasted image', libScopeRef.current);
            setLibOpen(true);
          }).catch(() => {});
          break;
        }
      }
    };
    document.addEventListener('paste', onDocPaste);
    return () => document.removeEventListener('paste', onDocPaste);
  }, []);

  // When an HTML backup containing the library is loaded, refresh the panels.
  useEffect(() => {
    const onRestored = () => {
      setLibrary(readLibrary());
      setProjectLibrary(readProjectLibrary(projectId));
    };
    window.addEventListener('lab:figures-library-restored', onRestored);
    return () => window.removeEventListener('lab:figures-library-restored', onRestored);
  }, [projectId]);

  // Charts / figures that were ⭐-starred on the experiment pages.
  const starred = (tests || []).flatMap((t) =>
    getStarredItems(t)
      .filter((s) => s && (s.kind === 'graph' || s.kind === 'figure') && s.url)
      .map((s) => ({ ...s, testName: t.name || t.id || 'test', testId: t.id }))
  );
  // The library items shown in the panel, depending on the active tab.
  const libScope = libTab === 'project' ? projectLibrary : library;
  const libScopeName = libTab === 'project' ? 'project' : 'common';

  // ---- slide operations ---------------------------------------------------
  const createSlideOf = (orientation) => {
    const s = newRegionSlide(orientation);
    const slides = [...deck.slides, s];
    setDeck({ ...deck, slides });
    setCur(slides.length - 1);
    setNewSlideOrient(null);
    setSelRegion(null);
  };
  const addSlide = () => {
    // Ask the figure orientation first: square (16 regions) or rectangular (20).
    setNewSlideOrient('ask');
  };
  const dupSlide = (i) => {
    const src = deck.slides[i];
    const copy = {
      ...src, id: uid('slide'), title: `${src.title || 'Slide'} copy`,
      blocks: (src.blocks || []).map((b) => ({ ...b, id: uid('blk') })),
      regions: (src.regions || []).map((r) => ({ ...r, id: uid('rg') }))
    };
    const slides = [...deck.slides.slice(0, i + 1), copy, ...deck.slides.slice(i + 1)];
    setDeck({ ...deck, slides });
    setCur(i + 1);
  };
  const delSlide = (i) => {
    const slides = deck.slides.filter((_, k) => k !== i);
    setDeck({ ...deck, slides });
    setCur(Math.max(0, Math.min(cur, slides.length - 1)));
  };
  const moveSlide = (from, to) => {
    if (from === to || to < 0 || to >= deck.slides.length) return;
    const slides = [...deck.slides];
    const [s] = slides.splice(from, 1);
    slides.splice(to, 0, s);
    setDeck({ ...deck, slides });
    setCur(to);
  };
  const patchSlide = (i, patch) => {
    setDeck({ ...deck, slides: deck.slides.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  };

  // ---- block operations -----------------------------------------------------
  const addBlock = (i, block) => {
    const s = deck.slides[i];
    const b = { ...emptyBlock(block.type), ...block, id: uid('blk') };
    if (b.type === 'image' && !b.panel) b.panel = nextPanelLetter(s.blocks || []);
    patchSlide(i, { blocks: [...(s.blocks || []), b] });
    setSel((s.blocks || []).length);
  };
  const insertBlockAt = (i, bi, block) => {
    const s = deck.slides[i];
    const blocks = [...(s.blocks || [])];
    const b = { ...emptyBlock(block.type), ...block, id: uid('blk') };
    if (b.type === 'image' && !b.panel) b.panel = nextPanelLetter(blocks);
    blocks.splice(bi, 0, b);
    patchSlide(i, { blocks });
    setSel(bi);
  };
  const patchBlock = (i, bi, patch) => {
    const s = deck.slides[i];
    patchSlide(i, { blocks: (s.blocks || []).map((b, j) => (j === bi ? { ...b, ...patch } : b)) });
  };
  const removeBlock = (i, bi) => {
    const s = deck.slides[i];
    patchSlide(i, { blocks: (s.blocks || []).filter((_, j) => j !== bi) });
    setSel(null);
  };
  const moveBlock = (from, to) => {
    if (!slide || from === to) return;
    const blocks = [...(slide.blocks || [])];
    if (to < 0 || to > blocks.length) return;
    const [b] = blocks.splice(from, 1);
    blocks.splice(to, 0, b);
    patchSlide(cur, { blocks });
    setSel(to);
  };

  // ---- region operations (new structured-figure editor) ----------------------
  const patchRegion = (ri, patch) => {
    const s = deck.slides[cur];
    patchSlide(cur, { regions: autoLabelRegions((s.regions || []).map((r, j) => (j === ri ? { ...r, ...patch } : r))) });
  };
  const setRegionImage = (ri, image) => patchRegion(ri, { image });
  const clearRegion = (ri) => patchRegion(ri, { image: null, peaks: [], text: '', textBlocks: [], crop: null });
  const insertStarredIntoRegion = async (s0, ri) => {
    const img = await makeLibraryImage(s0.url);
    setRegionImage(ri, { url: img.url, full: img.full });
    setHoverRegion(null);
  };
  const insertLibraryIntoRegion = (it, ri) => {
    setRegionImage(ri, { url: it.url, full: it.full });
    setHoverRegion(null);
  };
  // Select / deselect panels: click a panel to add it to the selection
  // (click it again to remove it); clicking an empty cell creates a 1×1
  // panel and selects it. Then "🔗 Merge" unifies the selection.
  const onRegionCellClick = (x, y) => {
    const s = deck.slides[cur];
    if (!s) return;
    const key = `${x},${y}`;
    const regions = s.regions || [];
    const existing = regionAtCell(regions, x, y);
    if (existing) {
      const idx = regions.indexOf(existing);
      const cells = [];
      for (let yy = existing.y; yy < existing.y + existing.h; yy++) {
        for (let xx = existing.x; xx < existing.x + existing.w; xx++) cells.push(`${xx},${yy}`);
      }
      const next = new Set(selCells || []);
      const allIn = cells.every((k) => next.has(k));
      if (allIn) cells.forEach((k) => next.delete(k));
      else cells.forEach((k) => next.add(k));
      setSelCells(next);
      setSelRegion(next.size > 0 ? idx : null);
      setHoverRegion(idx);
      return;
    }
    // Empty cell: create a 1×1 panel and select it.
    const r = emptyRegion(x, y);
    const nextRegions = autoLabelRegions([...regions, r]);
    patchSlide(cur, { regions: nextRegions });
    const newIdx = nextRegions.length - 1;
    setSelRegion(newIdx);
    setHoverRegion(newIdx);
    setSelCells((prev) => new Set([...(prev || []), key]));
  };

  // Merge all selected cells into one panel spanning their
  // bounding box; any cell inside the box that was not selected becomes an
  // empty 1×1 panel. Texts stay at their own positions (textBlocks).
  const mergeSelectedCells = () => {
    const s = deck.slides[cur];
    if (!s || !selCells || selCells.size < 2) return;
    const regions = s.regions || [];
    const g = ORIENT_GRID[s.orientation || 'square'] || ORIENT_GRID.square;
    const cols = s.cols || g.cols, rows = s.rows || g.rows;
    const cells = [...selCells].map((k) => k.split(',').map(Number))
      .filter(([x, y]) => x >= 0 && x < cols && y >= 0 && y < rows);
    if (cells.length < 2) return;
    const minX0 = Math.min(...cells.map((c) => c[0])), minY0 = Math.min(...cells.map((c) => c[1]));
    const maxX0 = Math.max(...cells.map((c) => c[0])), maxY0 = Math.max(...cells.map((c) => c[1]));
    const involved = regions.filter((r) =>
      r.x <= maxX0 && r.x + r.w - 1 >= minX0 && r.y <= maxY0 && r.y + r.h - 1 >= minY0);
    // The merged panel covers the selection plus every involved region fully.
    const minX = Math.min(minX0, ...involved.map((r) => r.x));
    const minY = Math.min(minY0, ...involved.map((r) => r.y));
    const maxX = Math.max(maxX0, ...involved.map((r) => r.x + r.w - 1));
    const maxY = Math.max(maxY0, ...involved.map((r) => r.y + r.h - 1));
    const w = maxX - minX + 1, h = maxY - minY + 1;
    let image = null; let fontScale = 1; const entries = []; const peaks = [];
    involved.forEach((r) => {
      if (!image && r.image) { image = r.image; fontScale = r.fontScale || 1; }
      if ((r.text || '').trim()) entries.push({ x: ((r.x - minX) + r.w / 2) / w, text: r.text });
      (r.textBlocks || []).forEach((t) => entries.push({ x: ((r.x - minX) + r.w / 2) / w, text: t.text }));
      (r.peaks || []).forEach((p) => peaks.push(p));
    });
    const mergedId = uid('rg');
    const merged = { id: mergedId, x: minX, y: minY, w, h, image, zoom: 100, fontScale, text: '', textBlocks: entries, peaks, isSpectrum: false, label: '' };
    const selectedSet = new Set(selCells);
    const coveredBySelection = (x, y) => selectedSet.has(`${x},${y}`) ||
      involved.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const next = [merged];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!coveredBySelection(x, y)) next.push(emptyRegion(x, y));
      }
    }
    const rest = regions.filter((r) => !involved.includes(r));
    const finalRegions = autoLabelRegions([...rest, ...next]);
    patchSlide(cur, { regions: finalRegions });
    setSelCells(new Set([`${minX},${minY}`]));
    setSelRegion(finalRegions.findIndex((r) => r.id === mergedId));
  };

  // Unmerge: split the selected merged panel back into its 1×1 cells.
  const unmergeSelected = () => {
    const s = deck.slides[cur];
    if (!s || selRegion === null) return;
    const r = (s.regions || [])[selRegion];
    if (!r || (r.w === 1 && r.h === 1)) return;
    patchSlide(cur, { regions: autoLabelRegions(splitRegionCells(s.regions || [], selRegion)) });
    setSelCells(new Set([`${r.x},${r.y}`]));
  };


  // Move the region ri to grid position (dx, dy) — validated against the grid
  // bounds and the other regions (drag & drop of a panel).
  const moveRegion = (ri, dx, dy) => {
    const s = deck.slides[cur];
    if (!s) return;
    const regions = s.regions || [];
    const r = regions[ri];
    if (!r || (r.x === dx && r.y === dy)) return;
    const g = ORIENT_GRID[s.orientation || 'square'] || ORIENT_GRID.square;
    const cols = s.cols || g.cols, rows = s.rows || g.rows;
    if (!canPlaceRegion(regions, r, dx, dy, cols, rows)) return;
    patchSlide(cur, { regions: autoLabelRegions(regions.map((o, j) => (j === ri ? { ...o, x: dx, y: dy } : o))) });
    setSelRegion(ri);
  };
  // Reversible merge: split a merged panel back into its 1×1 cells.
  const splitRegion = (ri) => {
    const s = deck.slides[cur];
    if (!s) return;
    patchSlide(cur, { regions: autoLabelRegions(splitRegionCells(s.regions || [], ri)) });
    setSelRegion(ri);
  };


  // ---- drag & drop ----------------------------------------------------------
  const dragData = useRef(null); // { kind: 'lib'|'star'|'block'|'slide', scope?, id, idx }
  const onDragStart = (kind, id, idx, scope) => (e) => {
    dragData.current = { kind, id, idx, scope };
    e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* ignore */ }
    setDropIdx(null);
  };
  const libFind = (scope, id) =>
    (scope === 'project' ? projectLibrary : library).find((x) => x.id === id);
  // Resolve a ⭐-starred figure into a self-contained dataURL pair (Drive URLs
  // would otherwise render as empty files) and add it as an image block.
  const addBlockFromStar = async (s, bi = null) => {
    if (!s || !slide) return;
    const img = await makeLibraryImage(s.url);
    const block = {
      type: 'image', url: img.url, full: img.full,
      caption: s.caption || s.label || '',
      src: { testId: s.testId, testName: s.testName, starId: s.id, kind: s.kind }
    };
    if (bi === null) addBlock(cur, block);
    else insertBlockAt(cur, bi, block);
  };
  const dropOnGrid = (e) => {
    e.preventDefault();
    const d = dragData.current;
    if (!d) return;
    if (d.kind === 'lib') {
      const it = libFind(d.scope, d.id);
      if (it && slide) addBlock(cur, { type: 'image', url: it.url, full: it.full, caption: it.label || '' });
    } else if (d.kind === 'star') {
      const s = starred[d.idx];
      if (s) addBlockFromStar(s);
    } else if (d.kind === 'block') {
      // dropping a block onto the empty grid area → move to the end
      moveBlock(d.idx, (slide.blocks || []).length - 1);
    }
    dragData.current = null;
    setDropIdx(null);
  };
  const dropOnBlock = (bi) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragData.current;
    if (!d) return;
    if (d.kind === 'block' && d.idx !== bi) moveBlock(d.idx, bi);
    else if (d.kind === 'lib') {
      const it = libFind(d.scope, d.id);
      if (it && slide) insertBlockAt(cur, bi, { type: 'image', url: it.url, full: it.full, caption: it.label || '' });
    } else if (d.kind === 'star') {
      const s = starred[d.idx];
      if (s) addBlockFromStar(s, bi);
    }
    dragData.current = null;
    setDropIdx(null);
  };
  const dropOnSlide = (i) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const d = dragData.current;
    if (d && d.kind === 'slide' && d.idx !== i) moveSlide(d.idx, i);
    dragData.current = null;
  };
  const dragOver = (e, i) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('text/plain')) e.preventDefault();
    if (i !== null && i !== undefined) setDropIdx(i);
  };


  // ---- library operations --------------------------------------------------
  const addToLibrary = async (dataUrl, label, scope = 'project') => {
    const img = await makeLibraryImage(dataUrl);
    const item = { id: uid('lib'), label: label || 'Figure', ...img, addedAt: new Date().toISOString() };
    if (scope === 'project' && projectId) setProjectLibrary((p) => [item, ...p]);
    else setLibrary((p) => [item, ...p]);
    return item;
  };
  const onUpload = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { alert('Only image files can be added to the library.'); return; }
    await addToLibrary(await blobToDataUrl(f), f.name.replace(/\.[^.]+$/, '') || 'Image', libScopeName);
  };
  const onPaste = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('unsupported');
      const items = await navigator.clipboard.read();
      const it = items.find((x) => x.types && x.types.some((t) => t.startsWith('image/')));
      if (!it) { alert('No image found in the clipboard.'); return; }
      const type = it.types.find((t) => t.startsWith('image/'));
      const blob = await it.getType(type);
      await addToLibrary(await blobToDataUrl(blob), 'Pasted image', libScopeName);
    } catch {
      alert('Clipboard reading is not available in this browser — press Ctrl+V (or Cmd+V) to paste the image into the active library.');
    }
  };
  // Starred experiment figures are saved to the project library by default
  // (they belong to the project), falling back to the common one.
  const importStarred = async (s) => {
    const img = await makeLibraryImage(s.url);
    const label = `${s.caption || s.label || 'Chart'} · ${s.testName}`;
    if (projectId) addProjectLibraryItem(projectId, { ...img, label });
    else addLibraryItem({ ...img, label });
    setLibrary(readLibrary());
    setProjectLibrary(readProjectLibrary(projectId));
  };
  const renameLib = (id, label) => {
    if (libTab === 'project') { renameProjectLibraryItem(projectId, id, label); setProjectLibrary((p) => p.map((i) => (i.id === id ? { ...i, label } : i))); }
    else { renameLibraryItem(id, label); setLibrary((p) => p.map((i) => (i.id === id ? { ...i, label } : i))); }
  };
  const removeLib = (id) => {
    if (libTab === 'project') { removeProjectLibraryItem(projectId, id); setProjectLibrary(readProjectLibrary(projectId)); }
    else { removeLibraryItem(id); setLibrary(readLibrary()); }
  };
  const moveLib = (id) => {
    const from = libScopeName, to = from === 'project' ? 'common' : 'project';
    moveLibraryItem(from, to, projectId, id);
    setLibrary(readLibrary());
    setProjectLibrary(readProjectLibrary(projectId));
  };
  const addFromLib = (it) => slide && addBlock(cur, { type: 'image', url: it.url, full: it.full, caption: it.label || '' });

  // ---- fullscreen presentation ---------------------------------------------
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setPresenting(false);
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setPi((p) => Math.min(deck.slides.length - 1, p + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPi((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, deck.slides.length]);


  // ---- export to PDF (A4 landscape @ 300 DPI, publication quality) -----------
  const exportPdf = async () => {
    if (!deck.slides.length) { alert('Add at least one slide first.'); return; }
    const PX_W = 2481, PX_H = 1754; // A4 landscape @ 300 DPI
    const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [PX_W, PX_H], hotfixes: ['px_scaling'] });
    const left = 70, gap = 44;
    const contentW = PX_W - left * 2;              // full row width
    const titleBarH = 150, rowGap = 56;
    // Fits an image in the box, then applies the block zoom (grows it up to the
    // box boundary so it never overlaps the next row on the printed page).
    const fitImage = (url, x, y, w, h, zoom = 100) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(w / img.width, h / img.height);
            let iw = img.width * scale * (zoom / 100), ih = img.height * scale * (zoom / 100);
            if (iw > w || ih > h) { const fit = Math.min(w / iw, h / ih); iw *= fit; ih *= fit; }
            doc.addImage(img, 'PNG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, undefined, 'FAST');
          } catch { /* skip broken image */ }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
    const wrap = (text, width) => {
      const lines = [];
      String(text || '').split(/\n/).forEach((para) => {
        let cur = '';
        String(para).split(/\s+/).forEach((w2) => {
          if (cur && (cur + ' ' + w2).length > width / 11) { lines.push(cur); cur = w2; }
          else cur = cur ? cur + ' ' + w2 : w2;
        });
        if (cur) lines.push(cur);
      });
      return lines;
    };
    const hexToRgb = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
      if (!m) return [31, 41, 55];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const drawText = (b, x, y, w, h) => {
      const lines = wrap(b.text || '', w);
      const lead = blockFont(b) * 2.4 * 1.25;
      let yy = y + 30;
      const maxLines = Math.max(1, Math.floor(h / lead) - 1);
      lines.slice(0, maxLines).forEach((ln) => {
        const align = b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left';
        doc.text(ln, align === 'left' ? x : (x + w / 2), yy, { align });
        yy += lead;
      });
    };
    for (let si = 0; si < deck.slides.length; si++) {
      if (si > 0) doc.addPage();
      const s = deck.slides[si];
      const bg = hexToRgb(s.bg || '#ffffff');
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.rect(0, 0, PX_W, PX_H, 'F');
      // Title bar
      doc.setFillColor(30, 41, 59);
      doc.rect(0, 0, PX_W, titleBarH, 'F');
      doc.setFontSize(Math.max(26, Math.min(64, (s.titleSize || 20) * 2.4)));
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text(String(s.title || 'Untitled slide').slice(0, 90), left, titleBarH / 2 + 14);
      // Region-based figures are rendered on canvas first (keeps the 300 DPI
      // grid, letters, peak labels and global caption) and embedded as images.
      if (s.regions) {
        try {
          const img = await renderSlideToDataUrl(s);
          const imgEl = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = img; });
          const mm = 40, availW = PX_W - 2 * mm, availH = PX_H - 2 * mm;
          let iw = availW, ih = availH;
          if (imgEl) {
            const ratio = imgEl.height / imgEl.width;
            if (ih / iw > ratio) ih = iw * ratio; else iw = ih / ratio;
          }
          doc.addImage(img, 'PNG', mm + (availW - iw) / 2, mm + (availH - ih) / 2, iw, ih, undefined, 'FAST');
        } catch { /* leave the blank page */ }
        continue;
      }
      // Blocks laid out in rows with wrapping, honouring each panel's W/H/zoom.
      const blocks = s.blocks || [];
      let rowY = titleBarH + 40, rowH = 0, x = left;
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const bw = contentW * Math.max(0.1, Math.min(1, (b.w || 100) / 100));
        const bh = Math.max(120, (b.h || 240) * 3);
        if (x + bw > left + contentW + 0.5) { rowY += rowH + rowGap; rowH = 0; x = left; }
        rowH = Math.max(rowH, bh);
        const bx = x, by = rowY;
        x += bw + gap;
        if (b.type === 'image') {
          await fitImage(b.full || b.url, bx, by, bw, bh - 60, b.zoom || 100);
          if (b.panel) {
            doc.setFontSize(28);
            doc.setTextColor(15, 23, 42);
            doc.setFont('helvetica', 'bold');
            doc.text(String(b.panel).slice(0, 2), bx + 8, by + 30);
          }
          if (b.caption) {
            doc.setFontSize(13);
            doc.setTextColor(100, 116, 139);
            doc.setFont('helvetica', 'italic');
            const capLines = wrap(b.caption, bw).slice(0, 2);
            if (capLines.length) capLines[0] = (b.panel ? `${b.panel}. ` : '') + capLines[0];
            doc.text(capLines, bx, by + bh - 22, { align: b.align === 'center' ? 'center' : 'left' });
          }
        } else {
          if (b.bg) { const c = hexToRgb(b.bg); doc.setFillColor(c[0], c[1], c[2]); doc.roundedRect(bx, by, bw, bh, 14, 14, 'F'); }
          doc.setFontSize(blockFont(b) * 2.4);
          doc.setTextColor(hexToRgb(b.color || '#1f2937')[0], hexToRgb(b.color || '#1f2937')[1], hexToRgb(b.color || '#1f2937')[2]);
          doc.setFont('helvetica', b.bold ? (b.italic ? 'bolditalic' : 'bold') : (b.italic ? 'italic' : 'normal'));
          drawText(b, bx, by, bw, bh);
        }
      }
    }
    doc.save(`figures_${projectId || 'deck'}.pdf`);
  };

  // ---- PNG export ------------------------------------------------------------
  const downloadPng = (b) => {
    const url = b.full || b.url;
    if (!url) { alert('No image to export.'); return; }
    downloadDataUrl(url, `${(b.caption || b.src?.testName || 'figure').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`);
  };
  const exportSlidePng = async (s) => {
    try {
      const dataUrl = await renderSlideToDataUrl(s);
      downloadDataUrl(dataUrl, `${(s.title || 'slide').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`);
    } catch {
      alert('Could not export the slide as PNG (one of its images cannot be read).');
    }
  };

  // ---- library → Google Drive -------------------------------------------------
  const saveLibraryToDrive = async () => {
    if (!getDriveToken()) { setDriveMsg('⚠️ Connect Google Drive first (⚙️ Settings).'); setTimeout(() => setDriveMsg(''), 5000); return; }
    const payload = {
      savedAt: Date.now(),
      common: library,
      projects: readProjectLibrary(projectId)
    };
    const file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    setDriveMsg('⬆️ Saving library to Google Drive…');
    try {
      const res = await uploadWorkspaceFile({ name: 'figures-library.json', mimeType: 'application/json', file, folder: 'figures' });
      setDriveMsg(res ? '✅ Library saved to Drive (Lab Workspace/figures/figures-library.json).' : '⚠️ Could not save to Drive.');
    } catch {
      setDriveMsg('⚠️ Could not save to Drive.');
    }
    setTimeout(() => setDriveMsg(''), 7000);
  };

  // Keep the paste-listener refs pointing at the latest closures (declared here,
  // after all functions, so the dependency arrays never hit the TDZ).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { addToLibraryRef.current = addToLibrary; }, [addToLibrary]);
  useEffect(() => { libScopeRef.current = libScopeName; }, [libScopeName]);

  const slide = deck.slides[cur];


  // ---- region-based slide editor (structured multi-panel figures) ------------
  const renderRegionEditor = () => {
    const orientation = slide.orientation || 'square';
    const g = ORIENT_GRID[orientation] || ORIENT_GRID.square;
    const cols = slide.cols || g.cols;
    const rows = slide.rows || g.rows;
    const regions = slide.regions || [];
    const targetRi = hoverRegion !== null ? hoverRegion : selRegion;
    const targetRegion = targetRi !== null ? regions[targetRi] : null;
    const ZOOMS = [100, 150, 200, 300, 500];
    const nextZoom = (r) => ZOOMS[(Math.max(0, ZOOMS.indexOf(r.zoom)) + 1) % ZOOMS.length];
    const FONTS = [0.8, 1, 1.25, 1.6, 2];
    const nextFont = (r) => FONTS[(Math.max(0, FONTS.indexOf(r.fontScale)) + 1) % FONTS.length];
    const cells = Array.from({ length: cols * rows }, (_, i) => ({ x: i % cols, y: Math.floor(i / cols) }));
    const libItems = [...(projectLibrary || []), ...(library || [])];
    // Image zoom: drag horizontally to select the part of the image to keep.
    const spectrumStart = (e, ri) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t && t.closest && t.closest('input,button')) return; // ignore clicks on peak labels / controls
      e.preventDefault(); // stop the browser's native image drag (ghost) from hijacking the mouse
      const rect = e.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      suppressRegionClickRef.current = false;
      cropDragRef.current = { ri, startX: e.clientX, rect };
      setCropPreview(null);
    };
    const spectrumMoveTo = (e) => {
      const d = cropDragRef.current;
      if (!d) return;
      const fx = Math.max(0, Math.min(1, (e.clientX - d.rect.left) / d.rect.width));
      const sx = Math.max(0, Math.min(1, (d.startX - d.rect.left) / d.rect.width));
      setCropPreview({ x1: Math.min(sx, fx), x2: Math.max(sx, fx) });
    };
    const spectrumEnd = (e, ri) => {
      const d = cropDragRef.current;
      if (!d) return;
      cropDragRef.current = null;
      const fx = Math.max(0, Math.min(1, (e.clientX - d.rect.left) / Math.max(1, d.rect.width)));
      const sx = Math.max(0, Math.min(1, (d.startX - d.rect.left) / Math.max(1, d.rect.width)));
      setCropPreview(null);
      const x1 = Math.min(sx, fx), x2 = Math.max(sx, fx);
      if (x2 - x1 > 0.06) {
        // drag → zoom into that region of the image and keep it
        suppressRegionClickRef.current = true; // the following click must not deselect the panel
        patchRegion(ri, { crop: { x1, x2 }, zoom: 100 });
      } else if (regions[ri].isSpectrum) {
        // plain click → add a peak label at that position
        const c = regions[ri].crop;
        const imageFx = c ? c.x1 + fx * (c.x2 - c.x1) : fx;
        patchRegion(ri, { peaks: [...(regions[ri].peaks || []), { fx: imageFx, label: '' }] });
      }
    };
    // Drop a dragged panel anywhere on the canvas → compute the target cell.
    const onCanvasDrop = (e) => {
      if (dragRegion === null) return;
      e.preventDefault();
      const gridEl = e.currentTarget;
      const rect = gridEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cx = Math.floor((e.clientX - rect.left) / (rect.width / cols));
      const cy = Math.floor((e.clientY - rect.top) / (rect.height / rows));
      if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) moveRegion(dragRegion, cx, cy);
      setDragRegion(null);
    };
    // Drag on the canvas selects a rectangular region of cells (like a table).
    // It only starts from an EMPTY cell (panels handle their own drags: crop /
    // move), so a normal click on a panel is never hijacked.
    const canvasDragStart = (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t && t.closest && t.closest('input,button,textarea,select,.drag-handle,.img-zoom-target,[data-region-id]')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvasDragRef.current = { startX: e.clientX, startY: e.clientY, rect, moved: false, box: null };
      setDragSelectBox(null);
    };
    const canvasDragMove = (e) => {
      const d = canvasDragRef.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) d.moved = true;
      if (!d.moved) return;
      const rect = d.rect;
      const cw = rect.width / cols, ch = rect.height / rows;
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - rect.left) / cw)));
      const cy = Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - rect.top) / ch)));
      const sx = Math.max(0, Math.min(cols - 1, Math.floor((d.startX - rect.left) / cw)));
      const sy = Math.max(0, Math.min(rows - 1, Math.floor((d.startY - rect.top) / ch)));
      const box = { x1: Math.min(sx, cx), y1: Math.min(sy, cy), x2: Math.max(sx, cx), y2: Math.max(sy, cy) };
      d.box = box;
      setDragSelectBox(box);
      const set = new Set();
      for (let yy = box.y1; yy <= box.y2; yy++) for (let xx = box.x1; xx <= box.x2; xx++) set.add(`${xx},${yy}`);
      setSelCells(set);
    };
    const canvasDragEnd = () => {
      const d = canvasDragRef.current;
      if (!d) return;
      canvasDragRef.current = null;
      setDragSelectBox(null);
      if (!d.moved) return;
      suppressCanvasClickRef.current = true;
      setTimeout(() => { suppressCanvasClickRef.current = false; }, 0);
      const box = d.box;
      if (box) {
        const ex = regionAtCell(regions, box.x1, box.y1);
        if (ex) { const idx = regions.indexOf(ex); setSelRegion(idx); setHoverRegion(idx); }
      }
    };
    const cw = regionFullscreen ? 'min(96vw, 90vh)' : 'min(100%, 72vh)';
    const canvasWidth = canvasScale === 1 ? cw : `calc(${cw} * ${canvasScale})`;
    const editorContent = (
      <>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          <b>Drag</b> on the canvas to select a rectangular region (like a table) → <b>🔗 Merge</b> unifies it into one ·
          <b> click</b> a panel adds/removes it from the selection · <b>✂ Unmerge</b> reverts · <b>drag ⠿</b> moves a panel ·
          <b>drag on an image</b> zooms into that region (⟲ resets) · <b>⭐ (left)</b> / <b>📂 (right)</b> tabs insert images (SVG charts stay vector-crisp) ·
          letters A, B, C… are automatic.
        </p>

        <div className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-lg px-2 py-1.5">
          <button type="button" onClick={mergeSelectedCells} disabled={!selCells || selCells.size < 2}
            className="text-[10px] font-black bg-emerald-600 text-white rounded-lg px-2.5 py-1 hover:bg-emerald-700 disabled:opacity-40"
            title="Click the panels you want to combine, then merge them into one">
            🔗 Merge ({selCells ? selCells.size : 0})
          </button>
          <button type="button" onClick={unmergeSelected}
            disabled={!(selRegion !== null && (slide.regions || [])[selRegion] && ((slide.regions || [])[selRegion].w > 1 || (slide.regions || [])[selRegion].h > 1))}
            className="text-[10px] font-black bg-amber-500 text-white rounded-lg px-2.5 py-1 hover:bg-amber-600 disabled:opacity-40"
            title="Split the selected merged panel back into single cells">
            ✂ Unmerge
          </button>
          <span className="w-px h-4 bg-slate-200 mx-1" />
          <span className="text-[10px] font-black text-slate-500" title="Panel letter (A, B, C…) size">🅰 Letters</span>
          <button type="button" onClick={() => patchSlide(cur, { labelSize: Math.max(0.5, Math.round(((slide.labelSize || 1) - 0.1) * 10) / 10) })}
            className={btnGhost} title="Smaller panel letters">−</button>
          <span className="text-[10px] font-bold text-slate-600 tabular-nums min-w-[34px] text-center">{Math.round((slide.labelSize || 1) * 100)}%</span>
          <button type="button" onClick={() => patchSlide(cur, { labelSize: Math.min(2.5, Math.round(((slide.labelSize || 1) + 0.1) * 10) / 10) })}
            className={btnGhost} title="Larger panel letters">+</button>
          <span className="w-px h-4 bg-slate-200 mx-1" />
          <span className="text-[10px] font-black text-slate-500" title="Canvas zoom — work on regions without being limited by the page">🔍 Canvas</span>
          <button type="button" onClick={() => setCanvasScale(Math.max(0.4, Math.round((canvasScale - 0.2) * 10) / 10))}
            className={btnGhost} title="Zoom out the canvas">−</button>
          <span className="text-[10px] font-bold text-slate-600 tabular-nums min-w-[34px] text-center">{Math.round(canvasScale * 100)}%</span>
          <button type="button" onClick={() => setCanvasScale(Math.min(4, Math.round((canvasScale + 0.2) * 10) / 10))}
            className={btnGhost} title="Zoom in the canvas">+</button>
          <button type="button" onClick={() => setCanvasScale(1)} className={btnGhost} title="Fit the whole figure on screen">Fit</button>
          <span className="w-px h-4 bg-slate-200 mx-1" />
          <button type="button" onClick={() => setRegionFullscreen(!regionFullscreen)}
            className={btnGhost} title="Edit this figure on almost the whole screen">
            {regionFullscreen ? '✕ Close fullscreen' : '⛶ Maximize'}
          </button>
        </div>

        <div className="relative">
          {/* CANVAS — zoomable, scrollable (work on regions, not limited by the page) */}
          <div className="w-full overflow-auto custom-scrollbar"
            style={{ maxHeight: regionFullscreen ? 'calc(100vh - 150px)' : '80vh' }}>
            <div className="flex justify-center min-w-max min-h-full">
              <div className="relative bg-white rounded-lg border border-slate-200 shadow-sm"
                style={{ aspectRatio: `${cols}/${rows}`, width: canvasWidth }}>
              <div className="absolute inset-0 grid"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
                onMouseDown={canvasDragStart}
                onMouseMove={canvasDragMove}
                onMouseUp={canvasDragEnd}
                onMouseLeave={() => { if (canvasDragRef.current) { canvasDragRef.current = null; setDragSelectBox(null); } }}
                onDragOver={(e) => { if (dragRegion !== null) e.preventDefault(); }}
                onDrop={onCanvasDrop}>
                {cells.map((c) => {
                  const key = `${c.x},${c.y}`;
                  const isSelCell = selCells && selCells.has(key);
                  const canDrop = dragRegion !== null && regions[dragRegion] && canPlaceRegion(regions, regions[dragRegion], c.x, c.y, cols, rows);
                  return (
                    <div key={key}
                      className={`border ${canDrop ? 'border-blue-300 bg-blue-50/50' : isSelCell ? 'border-amber-400 bg-amber-100/60' : 'border-slate-100'}`}
                      onMouseEnter={() => { const ex = regionAtCell(regions, c.x, c.y); setHoverRegion(ex ? regions.indexOf(ex) : null); }}
                      onClick={() => { if (suppressCanvasClickRef.current) { suppressCanvasClickRef.current = false; return; } onRegionCellClick(c.x, c.y); }}>
                      {isSelCell && <span className="w-full h-full flex items-center justify-center text-[9px] font-black text-amber-700 select-none">■</span>}
                    </div>
                  );
                })}
                {dragSelectBox && (
                  <div className="absolute pointer-events-none z-20 rounded-sm border-2 border-blue-500 bg-blue-300/25"
                    style={{
                      left: `${(dragSelectBox.x1 / cols) * 100}%`,
                      top: `${(dragSelectBox.y1 / rows) * 100}%`,
                      width: `${((dragSelectBox.x2 - dragSelectBox.x1 + 1) / cols) * 100}%`,
                      height: `${((dragSelectBox.y2 - dragSelectBox.y1 + 1) / rows) * 100}%`,
                    }} />
                )}

                  {regions.map((r, ri) => (
                    <div key={r.id} data-region-id={r.id}
                      onMouseEnter={() => { cancelClearHover(); setHoverRegion(ri); }}
                      onMouseLeave={clearHoverSoon}
                      onClick={(e) => {
                        if (suppressCanvasClickRef.current) { suppressCanvasClickRef.current = false; return; }
                        const t = e.target;
                        if (suppressRegionClickRef.current) { suppressRegionClickRef.current = false; return; }
                        if (t && t.closest && t.closest('input,button,textarea,select,.drag-handle')) return;
                        onRegionCellClick(r.x, r.y);
                      }}
                      className={`relative overflow-hidden bg-white ${selRegion === ri ? 'ring-2 ring-blue-500 z-10' : 'ring-1 ring-slate-300'}`}
                      style={{ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}` }}>
                      {r.label && (
                        <span className="absolute top-0.5 left-1 z-20 font-black text-slate-900 bg-white/90 border border-slate-200 rounded px-1"
                          style={{ fontSize: `${Math.max(8, Math.round(11 * (slide.labelSize || 1)))}px` }}>{r.label}</span>
                      )}
                      {/* drag handle — move the panel to another position */}
                      <span draggable
                        onDragStart={(e) => { e.stopPropagation(); setDragRegion(ri); try { e.dataTransfer.setData('text/plain', 'move'); } catch {} }}
                        onDragEnd={() => setDragRegion(null)}
                        className="drag-handle absolute top-0.5 left-1/2 -translate-x-1/2 z-30 text-[12px] cursor-grab active:cursor-grabbing select-none opacity-70 hover:opacity-100"
                        title="Drag to move this panel to another position">⠿</span>
                      {r.image && (
                        <div className="img-zoom-target absolute inset-0 flex items-center justify-center overflow-hidden"
                          style={{ cursor: 'crosshair' }}
                          onMouseDown={(e) => spectrumStart(e, ri)}
                          onMouseMove={spectrumMoveTo}
                          onMouseUp={(e) => spectrumEnd(e, ri)}
                          onMouseLeave={() => { if (cropDragRef.current) { cropDragRef.current = null; setCropPreview(null); } }}
                          title="Drag to zoom into a region of the image (⟲ resets) · click adds a peak label in spectrum mode">
                          {/* Crop (spectrum zoom): show only the selected band, scaled to the panel width */}
                          {r.crop ? (
                            <img src={getRenderableDriveUrl(r.image.url)} alt="" draggable={false}
                              className="absolute top-1/2 -translate-y-1/2 left-0"
                              style={{
                                width: `${(1 / Math.max(0.05, r.crop.x2 - r.crop.x1)) * 100}%`,
                                height: 'auto', maxWidth: 'none', maxHeight: 'none',
                                marginLeft: `${-(r.crop.x1 / Math.max(0.05, r.crop.x2 - r.crop.x1)) * 100}%`,
                              }} />
                          ) : (
                            /* Zoom: the wrapper's size = zoom%, so SVG/vector images re-render
                               crisply at the enlarged size and raster images are really enlarged. */
                            <div className="flex items-center justify-center"
                              style={{ width: `${r.zoom || 100}%`, height: `${r.zoom || 100}%`, flexShrink: 0 }}>
                              <img src={getRenderableDriveUrl(r.image.url)} alt="" draggable={false} className="w-full h-full object-contain" style={{ flexShrink: 0 }} />
                            </div>
                          )}
                          {cropPreview && (
                            <span className="absolute top-0 bottom-0 z-10 bg-blue-300/40 border-x border-blue-500 pointer-events-none"
                              style={{ left: `${cropPreview.x1 * 100}%`, width: `${Math.max(1, (cropPreview.x2 - cropPreview.x1) * 100)}%` }} />
                          )}
                          {r.isSpectrum && (r.peaks || []).map((p, pi) => {
                            const pf = r.crop ? (p.fx - r.crop.x1) / Math.max(0.05, r.crop.x2 - r.crop.x1) : p.fx;
                            if (pf < -0.02 || pf > 1.02) return null;
                            return (
                              <span key={pi} className="absolute" style={{ left: `${pf * 100}%`, top: '6%' }}>
                                <span className="absolute -translate-x-1/2 top-0 text-[9px] text-red-600 pointer-events-none select-none">▼</span>
                                <input value={p.label || ''}
                                  onChange={(e) => patchRegion(ri, { peaks: (r.peaks || []).map((q, qi) => (qi === pi ? { ...q, label: e.target.value } : q)) })}
                                  placeholder="δ" onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onMouseUp={(e) => e.stopPropagation()}
                                  style={{ transform: 'translateX(-50%)', fontSize: `${Math.max(7, 10 * (r.fontScale || 1))}px` }}
                                  className="absolute top-1.5 left-0 w-12 bg-white/90 border border-red-200 rounded px-0.5 text-center outline-none" />
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {r.image && (
                        <div className="absolute top-0.5 right-1 z-20 flex gap-0.5 no-print">
                          <button type="button" onClick={() => r.crop ? patchRegion(ri, { crop: null, zoom: 100 }) : patchRegion(ri, { zoom: nextZoom(r) })}
                            className="text-[8px] font-black bg-white/90 border border-slate-200 rounded px-1 py-0.5 hover:border-blue-400" title={r.crop ? 'Reset the spectrum crop (back to the full spectrum)' : 'Zoom — the image always stays inside the panel'}>{r.crop ? '⟲ 100%' : `🔍 ${r.zoom}%`}</button>
                          <button type="button" onClick={() => patchRegion(ri, { fontScale: nextFont(r) })}
                            className="text-[8px] font-black bg-white/90 border border-slate-200 rounded px-1 py-0.5 hover:border-blue-400" title="Character size of the labels / text">A{Math.round((r.fontScale || 1) * 100)}%</button>
                          <button type="button" onClick={() => patchRegion(ri, { isSpectrum: !r.isSpectrum })}
                            className="text-[8px] font-black bg-white/90 border border-slate-200 rounded px-1 py-0.5 hover:border-violet-400" title={r.isSpectrum ? 'Spectrum mode on: click the image adds a peak label (drag still zooms)' : 'Spectrum mode off — click the image only selects/zooms (no peak labels)'}>{r.isSpectrum ? '📈' : '📉'}</button>
                          {(r.w > 1 || r.h > 1) && (
                            <button type="button" onClick={() => splitRegion(ri)}
                              className="text-[8px] font-black bg-white/90 border border-slate-200 rounded px-1 py-0.5 hover:border-amber-400" title="Split back into single cells (reversible merge)">✂</button>
                          )}
                          <button type="button" onClick={() => clearRegion(ri)}
                            className="text-[8px] font-black bg-white/90 border border-slate-200 rounded px-1 py-0.5 hover:border-red-400" title="Clear the panel content">✕</button>
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 z-10 bg-white/90 px-1 pb-0.5">
                        {(r.textBlocks && r.textBlocks.length > 0) ? (
                          <div className="relative h-5">
                            {r.textBlocks.map((tb, tbi) => (
                              <input key={tbi} value={tb.text || ''}
                                onChange={(e) => patchRegion(ri, { textBlocks: (r.textBlocks || []).map((q, qi) => (qi === tbi ? { ...q, text: e.target.value } : q)) })}
                                placeholder="Text…" onClick={(e) => e.stopPropagation()}
                                style={{ left: `${Math.max(0.05, Math.min(0.95, tb.x)) * 100}%`, transform: 'translateX(-50%)', width: '46%', fontSize: `${Math.max(7, 10 * (r.fontScale || 1))}px` }}
                                className="absolute top-0 text-center border-b border-slate-200 outline-none focus:border-blue-400 bg-transparent" />
                            ))}
                          </div>
                        ) : (
                          <input value={r.text || ''} onChange={(e) => patchRegion(ri, { text: e.target.value })}
                            placeholder="Text…" onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: `${Math.max(7, 10 * (r.fontScale || 1))}px` }}
                            className="w-full text-center border-b border-slate-200 outline-none focus:border-blue-400 bg-transparent" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            </div>

            {/* global figure caption */}
            <div className="mt-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5 flex items-start gap-2">
              <span className="text-[9px] font-black text-slate-400 uppercase shrink-0 mt-1">Figure caption</span>
              <textarea value={slide.caption || ''} onChange={(e) => patchSlide(cur, { caption: e.target.value })}
                placeholder="Global caption at the very bottom of the figure…" rows={2}
                className="flex-1 text-xs border border-slate-300 rounded p-1.5 outline-none focus:border-blue-500 resize-y custom-scrollbar" />
            </div>

            {/* LEFT retractable ⭐ tab + sidebar */}
            <button type="button" onClick={() => setLeftOpen(!leftOpen)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-40 text-[11px] font-black bg-amber-100 border border-amber-300 border-l-0 rounded-r-lg px-1 py-3 hover:bg-amber-200 shadow"
              title="Starred experiment figures (toggle)">⭐</button>
            {leftOpen && (
              <div className="absolute left-0 top-1/2 z-40 w-64 max-h-[80vh] overflow-y-auto custom-scrollbar bg-amber-50 border border-amber-300 rounded-r-xl shadow-2xl p-2 flex flex-col gap-1.5"
                style={{ transform: 'translateY(-50%)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-black text-amber-800 uppercase">⭐ Starred → panel {targetRegion ? (targetRegion.label || targetRi + 1) : '—'}</span>
                  <button type="button" onClick={() => setLeftOpen(false)} className="text-[10px] font-black text-slate-400 hover:text-slate-600">✕</button>
                </div>
                {starred.length === 0 ? (
                  <p className="text-[9px] text-slate-500 italic">No ⭐ figures yet — star them on the experiment pages.</p>
                ) : starred.map((s) => (
                  <button key={s.id} type="button" onClick={() => targetRegion && insertStarredIntoRegion(s, targetRi)}
                    disabled={!targetRegion}
                    className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg p-1 text-left hover:border-amber-400 disabled:opacity-40">
                    <StarThumb url={s.url} alt="" className="w-9 h-8 object-contain rounded border border-amber-100 bg-white shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[9px] font-bold text-slate-700 truncate">{s.caption || s.label}</span>
                      <span className="block text-[8px] text-slate-400 truncate">{s.testName}</span>
                    </span>
                  </button>
                ))}
                {!targetRegion && <p className="text-[9px] text-slate-400 italic">Select a panel on the canvas first.</p>}
              </div>
            )}

            {/* RIGHT retractable 📂 tab + sidebar */}
            <button type="button" onClick={() => setRightLibOpen(!rightLibOpen)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-40 text-[11px] font-black bg-white border border-slate-300 border-r-0 rounded-l-lg px-1 py-3 hover:bg-slate-50 shadow"
              title="Dataset images (library — toggle)">📂</button>
            {rightLibOpen && (
              <div className="absolute right-0 top-1/2 z-40 w-64 max-h-[80vh] overflow-y-auto custom-scrollbar bg-white border border-slate-300 rounded-l-xl shadow-2xl p-2 flex flex-col gap-1.5"
                style={{ transform: 'translateY(-50%)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-black text-slate-600 uppercase">📂 Dataset images</span>
                  <button type="button" onClick={() => setRightLibOpen(false)} className="text-[10px] font-black text-slate-400 hover:text-slate-600">✕</button>
                </div>
                {libItems.length === 0 ? (
                  <p className="text-[9px] text-slate-400 italic p-1">Upload / paste images into the library (top bar) or save ⭐ figures there.</p>
                ) : libItems.map((it) => (
                  <button key={it.id} type="button" onClick={() => targetRegion && insertLibraryIntoRegion(it, targetRi)}
                    disabled={!targetRegion}
                    className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-1 text-left hover:border-blue-400 disabled:opacity-40">
                    <img src={getRenderableDriveUrl(it.url)} alt="" className="w-9 h-8 object-contain rounded border border-slate-100 bg-white shrink-0" />
                    <span className="text-[9px] font-bold text-slate-600 truncate">{it.label}</span>
                  </button>
                ))}
                {!targetRegion && <p className="text-[9px] text-slate-400 italic p-1">Select a panel on the canvas first.</p>}
              </div>
            )}
          </div>
        </>
    );
    if (regionFullscreen) {
      return (
        <div className="fixed inset-0 z-[99995] bg-slate-100 overflow-auto p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black text-slate-700">⛶ Editing — {slide.title || 'untitled figure'}</span>
            <button type="button" onClick={() => setRegionFullscreen(false)}
              className="font-bold py-1.5 px-3 rounded-lg text-xs bg-slate-800 text-white hover:bg-slate-700">✕ Close fullscreen</button>
          </div>
          {editorContent}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {editorContent}
      </div>
    );
  };





  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-4">
      {/* ---- Section header + actions ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-700">📊 Figures &amp; Slides</h3>
          <p className="text-[10px] text-slate-400">PowerPoint-like deck: import ⭐-starred charts, 3D captures and reusable images (formulas…). Drag to reorder, export at 300 DPI.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveLibraryToDrive}
            className="font-bold py-1.5 px-3 rounded-lg text-xs border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100" title="Save the image library (common + project) as a JSON file in Lab Workspace/figures on Google Drive">☁️ Library → Drive</button>
          <button type="button" onClick={() => slide && exportSlidePng(slide)}
            disabled={!slide}
            className="font-bold py-1.5 px-3 rounded-lg text-xs border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40" title="Export the current slide as a 300 DPI PNG">⬇ Slide PNG</button>
          <button type="button" onClick={exportPdf}
            className="font-bold py-1.5 px-3 rounded-lg text-xs border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">📄 Export PDF (300 DPI)</button>
          <button type="button" onClick={() => { setPi(Math.min(deck.slides.length - 1, cur)); setPresenting(true); }}
            disabled={!deck.slides.length}
            className="font-bold py-1.5 px-3 rounded-lg text-xs border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">▶ Present</button>
        </div>
        {driveMsg && <p className="w-full text-[11px] font-bold text-sky-700">{driveMsg}</p>}
      </div>


      {/* ---- orientation modal (always available — shown on "+ New slide") ---- */}
      {newSlideOrient === 'ask' && (
        <div className="fixed inset-0 z-[99998] bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setNewSlideOrient(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-slate-800 mb-1">New figure — orientation</h3>
            <p className="text-xs text-slate-500 mb-4">Choose how the white canvas is divided. Panels can be merged later (select a panel, then click an adjacent cell).</p>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => createSlideOf('square')}
                className="rounded-xl border-2 border-slate-200 hover:border-blue-500 bg-slate-50 hover:bg-blue-50 p-3 flex flex-col items-center gap-2 transition-colors">
                <div className="w-11 h-11 grid grid-cols-4 grid-rows-4 gap-0.5">{Array.from({ length: 16 }).map((_, i) => <div key={i} className="bg-slate-300" />)}</div>
                <span className="text-xs font-black text-slate-700">Squared</span>
                <span className="text-[10px] text-slate-500">16 · 4×4</span>
              </button>
              <button type="button" onClick={() => createSlideOf('5x4')}
                className="rounded-xl border-2 border-slate-200 hover:border-blue-500 bg-slate-50 hover:bg-blue-50 p-3 flex flex-col items-center gap-2 transition-colors">
                <div className="w-[54px] h-11 grid grid-cols-5 grid-rows-4 gap-0.5">{Array.from({ length: 20 }).map((_, i) => <div key={i} className="bg-slate-300" />)}</div>
                <span className="text-xs font-black text-slate-700">5×4</span>
                <span className="text-[10px] text-slate-500">20 · horizontal</span>
              </button>
              <button type="button" onClick={() => createSlideOf('4x5')}
                className="rounded-xl border-2 border-slate-200 hover:border-blue-500 bg-slate-50 hover:bg-blue-50 p-3 flex flex-col items-center gap-2 transition-colors">
                <div className="w-[44px] h-[54px] grid grid-cols-4 grid-rows-5 gap-0.5">{Array.from({ length: 20 }).map((_, i) => <div key={i} className="bg-slate-300" />)}</div>
                <span className="text-xs font-black text-slate-700">4×5</span>
                <span className="text-[10px] text-slate-500">20 · vertical</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Image library — on TOP, retractable. Common + project scopes ---- */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 cursor-pointer select-none" onClick={() => setLibOpen((v) => !v)}>
          <span className="text-xs font-bold text-slate-600 uppercase flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            Image library ({library.length} common · {projectLibrary.length} project)
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 hidden sm:inline">drag an image onto a slide to add it · Ctrl+V pastes into the active library</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); if (fileRef.current) fileRef.current.click(); }} className={btnGhost}>⬆ Upload</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onPaste(); }} className={btnGhost}>📋 Paste</button>
            <span className="text-slate-400">{libOpen ? '▲' : '▼'}</span>
          </span>
        </div>
        {libOpen && (
          <div className="p-3 bg-white">
            <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} className="hidden" />
            <div className="flex items-center gap-1 mb-2">
              <button type="button" onClick={() => setLibTab('common')}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${libTab === 'common' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                🌐 Common ({library.length})
              </button>
              <button type="button" onClick={() => setLibTab('project')}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${libTab === 'project' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                📁 Project ({projectLibrary.length})
              </button>
              <span className="text-[10px] text-slate-400 ml-1">Uploads/pastes go to the <b>{libScopeName}</b> library{libTab === 'project' && projectId ? ' · ' + projectId : ''}</span>
            </div>
            {libScope.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic">Empty {libScopeName} library — upload formulas / structures / logos here to reuse them in slides.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2 max-h-64 overflow-y-auto custom-scrollbar">
                {libScope.map((it) => (
                  <div key={it.id} draggable
                    onDragStart={onDragStart('lib', it.id, null, libScopeName)}
                    className="flex flex-col gap-1 bg-white border border-slate-200 rounded-lg p-1.5 cursor-grab active:cursor-grabbing hover:border-blue-300">
                    <img src={getRenderableDriveUrl(it.url)} alt={it.label} className="w-full h-14 object-contain rounded border border-slate-100" />
                    <input value={it.label || ''} onChange={(e) => renameLib(it.id, e.target.value)}
                      className="w-full text-[10px] font-bold text-slate-600 bg-transparent outline-none" />
                    <div className="flex items-center justify-between gap-1">
                      <button type="button" onClick={() => addFromLib(it)}
                        disabled={!slide}
                        className="flex-1 text-[10px] font-bold bg-blue-600 text-white rounded px-1 py-0.5 disabled:opacity-40" title="Add this image to the current slide">+ slide</button>
                      <button type="button" onClick={() => downloadDataUrl(it.full || it.url, `${(it.label || 'figure').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`)}
                        className="text-[10px] font-bold text-slate-500 hover:text-emerald-600 px-1" title="Download this image as PNG (high resolution)">⬇</button>
                      {projectId && (
                        <button type="button" onClick={() => moveLib(it.id)}
                          className="text-[10px] font-bold text-slate-500 hover:text-blue-600 px-1" title={libScopeName === 'project' ? 'Also save in the common library' : 'Save in the project library'}>
                          {libScopeName === 'project' ? '🌐' : '📁'}
                        </button>
                      )}
                      <button type="button" onClick={() => removeLib(it.id)}
                        className="text-[10px] text-red-500 hover:text-red-700 font-bold px-1">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>


      {/* ---- ⭐ Imported from experiments — on TOP, retractable ---- */}
      <div className="border border-amber-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-3 py-2 cursor-pointer select-none" onClick={() => setImportsOpen((v) => !v)}>
          <span className="text-xs font-bold text-amber-800 uppercase flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            ⭐ Imported from experiments ({starred.length})
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[10px] text-amber-600 hidden sm:inline">drag a chart onto a slide to add it · clicking a chart on a slide reopens its experiment</span>
            <span className="text-amber-500">{importsOpen ? '▲' : '▼'}</span>
          </span>
        </div>
        {importsOpen && (
          <div className="p-3 bg-white">
            {starred.length === 0 ? (
              <p className="text-[10px] text-slate-500 italic">Star charts / tables / structures with ⭐ on any test page to collect them here.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-64 overflow-y-auto custom-scrollbar">
                {starred.map((s, si) => (
                  <div key={s.id} draggable onDragStart={onDragStart('star', s.id, si)}
                    className="flex flex-col gap-1 bg-white border border-amber-200 rounded-lg p-1.5 cursor-grab active:cursor-grabbing hover:border-amber-400">
                    <StarThumb url={s.url} alt={s.label} className="w-full h-14 object-contain rounded border border-amber-100 bg-white" />
                    <p className="text-[10px] font-bold text-slate-700 truncate">{s.caption || s.label}</p>
                    <p className="text-[9px] text-slate-400 truncate">{s.testName}</p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => addBlockFromStar(s)}
                        disabled={!slide}
                        className="flex-1 text-[10px] font-bold bg-blue-600 text-white rounded px-1 py-0.5 disabled:opacity-40" title="Add to current slide (keeps the link to the experiment)">+ slide</button>
                      <button type="button" onClick={() => importStarred(s)}
                        className="text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded px-1 py-0.5" title={projectId ? 'Save it in the project library' : 'Save it in the common library'}>⇥ {projectId ? 'proj' : 'lib'}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Slide deck editor ---- */}
      <div className="flex flex-col gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 uppercase">Slides ({deck.slides.length}) — drag to reorder</span>
              <button type="button" onClick={addSlide} className="font-bold py-1 px-2.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-700">+ New slide</button>
            </div>
            {deck.slides.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic py-3 text-center bg-slate-50 border border-dashed border-slate-300 rounded-lg">No slides yet — click "+ New slide" to start the deck.</p>
            ) : (
              <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
                {deck.slides.map((s, i) => (
                  <div key={s.id} draggable onDragStart={onDragStart('slide', s.id, i)}
                    onDragOver={(e) => dragOver(e, i)} onDrop={dropOnSlide(i)}
                    className={`shrink-0 min-w-[120px] max-w-[180px] px-2 py-1.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${i === cur ? 'bg-blue-600 border-blue-700 text-white' : (dropIdx === i ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}`}
                    onClick={() => setCur(i)}>
                    <span className="block text-[10px] font-black uppercase opacity-70">Slide {i + 1}</span>
                    <span className="block text-[11px] font-bold truncate">{s.title || 'Untitled'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {slide && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              {/* ---- Slide toolbar ---- */}
              <div className="flex items-center gap-1.5 flex-wrap bg-white border border-slate-200 rounded-lg px-2 py-1.5">
                <input value={slide.title || ''} onChange={(e) => patchSlide(cur, { title: e.target.value })}
                  placeholder="Slide title" className={`${inputCls} flex-1 min-w-[140px] font-bold text-sm`} />
                <span className="text-[10px] font-bold text-slate-500" title="Title size">A</span>
                <button type="button" onClick={() => patchSlide(cur, { titleSize: Math.max(14, (slide.titleSize || 20) - 2) })} className={btnGhost}>−</button>
                <button type="button" onClick={() => patchSlide(cur, { titleSize: Math.min(48, (slide.titleSize || 20) + 2) })} className={btnGhost}>+</button>
                <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500" title="Slide background colour">
                  BG
                  <input type="color" value={slide.bg || '#ffffff'} onChange={(e) => patchSlide(cur, { bg: e.target.value })}
                    className="w-6 h-6 rounded border border-slate-300 bg-white p-0 cursor-pointer" />
                </label>
                <span className="w-px h-5 bg-slate-200 mx-1" />
                <button type="button" onClick={() => dupSlide(cur)} className={btnGhost} title="Duplicate this slide">⧉</button>
                <button type="button" onClick={() => delSlide(cur)} className="text-xs font-bold px-2 py-1 rounded-md border border-red-300 text-red-600 hover:bg-red-50" title="Delete this slide">🗑</button>
              </div>

              {slide.regions ? renderRegionEditor() : (
              <>
              {/* ---- Add-block toolbar ---- */}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => addBlock(cur, { type: 'text', text: '' })}
                  className="font-bold py-1 px-2.5 rounded-lg text-xs bg-slate-700 text-white hover:bg-slate-800">+ Text</button>
                <span className="text-[10px] text-slate-400">add images with "+ slide" or by dragging them here · drag blocks to reorder</span>
              </div>

              {/* ---- Selected-block format bar ---- */}
              {sel !== null && slide && slide.blocks[sel] && (() => {
                const b = slide.blocks[sel];
                const order = ['sm', 'md', 'lg', 'xl'];
                return (
                  <div className="flex items-center gap-1.5 flex-wrap bg-white border border-sky-200 rounded-lg px-2 py-1.5">
                    <span className="text-[10px] font-black text-sky-700 uppercase">Format</span>
                    {b.type === 'text' ? (
                      <>
                        <button type="button" onClick={() => patchBlock(cur, sel, { fontSize: Math.max(8, blockFont(b) - 1) })} className={btnGhost} title="Smaller text">A−</button>
                        <span className="text-[10px] font-bold text-slate-600 tabular-nums min-w-[34px] text-center">{blockFont(b)}px</span>
                        <button type="button" onClick={() => patchBlock(cur, sel, { fontSize: Math.min(72, blockFont(b) + 1) })} className={btnGhost} title="Larger text">A+</button>
                        <select value={b.size || 'md'} onChange={(e) => patchBlock(cur, sel, { size: e.target.value, fontSize: TEXT_SIZES[e.target.value] })}
                          className={`${inputCls} !py-0.5`} title="Font size preset">
                          {['sm', 'md', 'lg', 'xl'].map((sz) => <option key={sz} value={sz}>{sz} ({TEXT_SIZES[sz]}px)</option>)}
                        </select>
                        <button type="button" onClick={() => patchBlock(cur, sel, { bold: !b.bold })}
                          className={`font-black text-xs px-2 py-1 rounded-md border ${b.bold ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>B</button>
                        <button type="button" onClick={() => patchBlock(cur, sel, { italic: !b.italic })}
                          className={`italic font-bold text-xs px-2 py-1 rounded-md border ${b.italic ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>I</button>
                        {ALIGN.map((a) => (
                          <button key={a} type="button" onClick={() => patchBlock(cur, sel, { align: a })}
                            className={`text-xs px-2 py-1 rounded-md border ${b.align === a ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                            title={a}>{a === 'left' ? '⯇' : a === 'center' ? '☰' : '⯈'}</button>
                        ))}
                        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500" title="Text colour">T
                          <input type="color" value={b.color || '#1f2937'} onChange={(e) => patchBlock(cur, sel, { color: e.target.value })} className="w-6 h-6 rounded border border-slate-300 bg-white p-0 cursor-pointer" />
                        </label>
                        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500" title="Text background">BG
                          <input type="color" value={b.bg || '#ffffff'} onChange={(e) => patchBlock(cur, sel, { bg: e.target.value })} className="w-6 h-6 rounded border border-slate-300 bg-white p-0 cursor-pointer" />
                        </label>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] font-bold text-slate-500">Size</span>
                        {order.map((sz) => (
                          <button key={sz} type="button" onClick={() => patchBlock(cur, sel, { size: sz })}
                            className={`text-[10px] px-1.5 py-1 rounded-md border uppercase ${b.size === sz ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{sz}</button>
                        ))}
                        {ALIGN.map((a) => (
                          <button key={a} type="button" onClick={() => patchBlock(cur, sel, { align: a })}
                            className={`text-xs px-2 py-1 rounded-md border ${b.align === a ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{a === 'left' ? '⯇' : a === 'center' ? '☰' : '⯈'}</button>
                        ))}
                      </>
                    )}
                    <span className="flex-1" />
                    <button type="button" onClick={() => removeBlock(cur, sel)} className="text-xs font-bold px-2 py-1 rounded-md border border-red-300 text-red-600 hover:bg-red-50">✕ Remove</button>
                  </div>
                );
              })()}

              {/* ---- Block grid (drop target for images, drag to reorder) ---- */}
              <div className="grid grid-cols-12 gap-2 min-h-[120px] bg-white border border-slate-200 rounded-lg p-2"
                onDragOver={(e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('text/plain')) e.preventDefault(); }}
                onDrop={dropOnGrid}>
                {(slide.blocks || []).map((b, bi) => (
                  <div key={b.id} draggable onDragStart={onDragStart('block', null, bi)}
                    onDragOver={(e) => dragOver(e, bi)} onDrop={dropOnBlock(bi)}
                    onClick={() => setSel(bi)}
                    style={{ minHeight: Math.max(80, b.h || 200) }}
                    className={`flex flex-col gap-1.5 border rounded-lg p-1.5 cursor-grab active:cursor-grabbing transition-colors ${colSpanCls(b)} ${sel === bi ? 'border-sky-400 ring-1 ring-sky-200' : 'border-slate-200'} ${dropIdx === bi ? 'bg-blue-50 border-blue-300' : 'bg-white'}`}>
                    {/* per-panel control bar: dimensions, content zoom, font size */}
                    <div className="flex items-center gap-1 flex-wrap bg-slate-50 border border-slate-200 rounded px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                      <Stepper label="W" value={b.w || 100} unit="%" min={10} max={100} step={10} onChange={(v) => patchBlock(cur, bi, { w: v })} />
                      <span className="flex items-center gap-0.5 bg-white border border-slate-200 rounded px-1 py-0.5" title="Panel width (fraction of the page)">
                        {W_PRESETS.map(([lab, val]) => (
                          <button key={lab} type="button" onClick={() => patchBlock(cur, bi, { w: val })}
                            className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded ${Math.round(b.w || 100) === val ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-900'}`}>{lab}</button>
                        ))}
                      </span>
                      <Stepper label="H" value={b.h || 200} unit="px" min={80} max={600} step={20} onChange={(v) => patchBlock(cur, bi, { h: v })} />
                      <span className="flex items-center gap-0.5 bg-white border border-slate-200 rounded px-1 py-0.5" title="Panel height (fraction of the page)">
                        {H_PRESETS.map(([lab, val]) => (
                          <button key={lab} type="button" onClick={() => patchBlock(cur, bi, { h: val })}
                            className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded ${(b.h || 200) === val ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-900'}`}>{lab}</button>
                        ))}
                      </span>
                      <Stepper label="🔍" value={b.zoom || 100} unit="%" min={50} max={300} step={10} onChange={(v) => patchBlock(cur, bi, { zoom: v })} />
                      {b.type === 'text' && <Stepper label="A" value={blockFont(b)} unit="px" min={8} max={72} step={1} onChange={(v) => patchBlock(cur, bi, { fontSize: v })} />}
                      {b.type === 'image' && (
                        <span className="flex items-center gap-0.5 bg-white border border-slate-200 rounded px-1 py-0.5" title="Panel letter (A, B, C … — multi-panel figures)">
                          <span className="text-[9px] font-bold text-slate-500">🅰</span>
                          <input value={b.panel || ''} onChange={(e) => patchBlock(cur, bi, { panel: e.target.value.slice(0, 2).toUpperCase() })}
                            className="w-6 text-center text-[10px] font-black text-slate-700 bg-transparent outline-none" placeholder="A" />
                          <button type="button" onClick={() => patchBlock(cur, bi, { panel: nextPanelLetter((slide.blocks || []).filter((_, k) => k !== bi)) })}
                            className="text-[9px] font-bold text-blue-500 hover:text-blue-700" title="Auto-assign the next free letter">auto</button>
                        </span>
                      )}
                      {b.src && b.src.testId && (
                        <button type="button" onClick={() => { if (jumpToTest) jumpToTest(b.src.testId); }}
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 ml-auto"
                          title={`Open the experiment "${b.src.testName || b.src.testId}" — Back returns here`}>↗ experiment</button>
                      )}
                    </div>
                    {/* content (zoomed inside the panel) */}
                    <div className="flex-1 flex items-center justify-center overflow-visible p-1">
                      <div className="w-full" style={{ transform: `scale(${(b.zoom || 100) / 100})`, transformOrigin: 'center' }}>
                        {b.type === 'image' ? (
                          <div className={`relative w-full ${b.src && b.src.testId && jumpToTest ? 'cursor-pointer' : ''}`}
                            onClick={(e) => { if (b.src && b.src.testId && jumpToTest) { e.stopPropagation(); jumpToTest(b.src.testId); } }}
                            title={b.src && b.src.testId ? `Click to open the experiment "${b.src.testName || b.src.testId}"` : undefined}>
                            <div className="flex justify-center w-full">
                              <img src={getRenderableDriveUrl(b.url)} alt={b.caption} className="object-contain rounded border border-slate-100"
                                style={{ width: IMG_SIZES[b.size] || '55%', maxHeight: 400 }} />
                            </div>
                            {b.panel && (
                              <span className="absolute top-0 left-0 text-[11px] font-black text-slate-900 bg-white/90 border border-slate-200 rounded px-1.5 py-0.5 shadow-sm">🅰 {b.panel}</span>
                            )}
                            {b.src && b.src.testId && (
                              <span className="absolute top-0 right-0 text-[9px] font-black bg-blue-600 text-white rounded px-1.5 py-0.5 opacity-90">↗ experiment</span>
                            )}
                          </div>
                        ) : (
                          <textarea value={b.text || ''} onChange={(e) => patchBlock(cur, bi, { text: e.target.value })}
                            placeholder="Text…"
                            rows={4}
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: blockFont(b), fontWeight: b.bold ? 700 : 400, fontStyle: b.italic ? 'italic' : 'normal', color: b.color || '#1f2937', textAlign: b.align, background: b.bg || '#ffffff' }}
                            className="w-full border border-slate-300 rounded p-1.5 text-xs outline-none focus:border-blue-500 resize-y custom-scrollbar" />
                        )}
                      </div>
                    </div>
                    {b.type === 'image' && (
                      <input value={b.caption || ''} onChange={(e) => patchBlock(cur, bi, { caption: e.target.value })}
                        placeholder="Caption"
                        onClick={(e) => e.stopPropagation()}
                        className="w-full border border-slate-300 rounded px-1.5 py-1 text-[11px] outline-none focus:border-blue-500" />
                    )}
                    <div className="flex items-center gap-1 text-[9px] text-slate-400">
                      <span>⣿ drag to move</span>
                      {b.src && b.src.testName && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); if (jumpToTest) jumpToTest(b.src.testId); }}
                          className="text-[9px] font-bold text-blue-500 hover:text-blue-700 hover:underline truncate max-w-[45%]" title={`Imported from experiment: ${b.src.testName}`}>
                          ↗ {b.src.testName}
                        </button>
                      )}
                      <span className="flex-1" />
                      {b.type === 'image' && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); downloadPng(b); }}
                          className="text-[10px] font-bold text-emerald-600 hover:bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200" title="Download this figure as PNG (high resolution)">⬇ PNG</button>
                      )}
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeBlock(cur, bi); }} className="text-[10px] px-1.5 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50">✕</button>
                    </div>
                  </div>
                ))}
                {(slide.blocks || []).length === 0 && (
                  <div className="col-span-12 text-[10px] text-slate-400 italic text-center py-8 border border-dashed border-slate-300 rounded-lg">
                    Drop images here or click "+ Text" to start this slide.
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          )}
        </div>

      {presenting && deck.slides[pi] && (
        <div className="fixed inset-0 z-[99999] flex flex-col" style={{ background: deck.slides[pi].bg || '#ffffff' }}>
          <div className="flex items-center justify-between px-4 py-2 text-white shrink-0" style={{ background: '#1e293b' }}>
            <span className="text-xs font-bold">📊 {deck.slides[pi].title || 'Untitled slide'}</span>
            <span className="text-xs text-slate-300">{pi + 1} / {deck.slides.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10">
            <div className="max-w-5xl mx-auto min-h-full">
              <h2 className="font-black text-slate-800 mb-6 border-b border-slate-200 pb-3"
                style={{ fontSize: (deck.slides[pi].titleSize || 20) * 2.4 }}>
                {deck.slides[pi].title || 'Untitled slide'}
              </h2>
              {deck.slides[pi].regions ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-full flex justify-center overflow-x-auto custom-scrollbar">
                    <SlidePreview slide={deck.slides[pi]} width={Math.max(320, Math.min(1000, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 140))} />
                  </div>
                  {deck.slides[pi].caption && (
                    <p className="text-sm text-slate-600 italic max-w-4xl text-center">{deck.slides[pi].caption}</p>
                  )}
                </div>
              ) : (
              <div className="grid grid-cols-12 gap-6">
                {(deck.slides[pi].blocks || []).map((b) => (
                  b.type === 'image' ? (
                    <figure key={b.id} className={`flex flex-col items-center gap-2 ${colSpanCls(b)}`} style={{ minHeight: Math.max(80, b.h || 240) }}>
                      <div className="relative flex-1 flex items-center justify-center w-full" style={{ transform: `scale(${(b.zoom || 100) / 100})`, transformOrigin: 'center' }}>
                        {b.panel && <span className="absolute top-0 left-0 text-base font-black text-slate-900 bg-white/90 border border-slate-200 rounded px-1.5 py-0.5 z-10">🅰 {b.panel}</span>}
                        <img src={getRenderableDriveUrl(b.full || b.url)} alt={b.caption} className="max-w-full max-h-[55vh] object-contain rounded-lg border border-slate-200"
                          style={{ width: b.size === 'sm' ? '40%' : b.size === 'md' ? '65%' : b.size === 'lg' ? '85%' : '100%' }} />
                      </div>
                      {b.caption && <figcaption className="text-sm text-slate-500 italic">{b.panel ? `${b.panel}. ` : ''}{b.caption}</figcaption>}
                    </figure>
                  ) : (
                    <div key={b.id} className={`rounded-xl p-4 ${colSpanCls(b)}`} style={{ background: b.bg || 'transparent', minHeight: Math.max(80, b.h || 200) }}>
                      <div style={{ transform: `scale(${(b.zoom || 100) / 100})`, transformOrigin: 'center' }}>
                        <p className="text-slate-700 whitespace-pre-wrap"
                          style={{ fontSize: blockFont(b) * 1.5, fontWeight: b.bold ? 700 : 400, fontStyle: b.italic ? 'italic' : 'normal', color: b.color || '#1f2937', textAlign: b.align }}>
                          {b.text}
                        </p>
                      </div>
                    </div>
                  )
                ))}
              </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-2 text-white shrink-0" style={{ background: '#1e293b' }}>
            <button type="button" onClick={() => setPi((p) => Math.max(0, p - 1))} disabled={pi === 0}
              className="font-bold px-4 py-1.5 rounded-lg text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40">← Previous</button>
            <button type="button" onClick={() => setPresenting(false)} className="font-bold px-4 py-1.5 rounded-lg text-xs bg-slate-700 hover:bg-slate-600">✕ Exit (Esc)</button>
            <button type="button" onClick={() => setPi((p) => Math.min(deck.slides.length - 1, p + 1))} disabled={pi >= deck.slides.length - 1}
              className="font-bold px-4 py-1.5 rounded-lg text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
};
