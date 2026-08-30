import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { getStarredItems } from '../utils/starredItems';
import {
  readLibrary, writeLibrary, removeLibraryItem, renameLibraryItem,
  readDeck, writeDeck, uid, downscaleImage, blobToDataUrl
} from '../utils/figuresLibrary';

/* =========================================================================
   FiguresSlidesSection — "Figures & Slides" builder (Publications page).
   A PowerPoint-like deck of slides, each made of image + text blocks:
   • images come from the app-wide library (uploads, pasted images, formulas,
     ⭐-starred experiment charts, 3D viewer captures) and are reusable,
   • slides are persisted per project (localStorage) and can be presented
     fullscreen or exported to PDF.
   ========================================================================= */

const inputCls = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
const btnGhost = 'text-xs font-bold px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50';

export const FiguresSlidesSection = ({ tests = [], projectId = 'global' }) => {
  const [library, setLibrary] = useState(readLibrary);
  const [deck, setDeck] = useState(() => readDeck(projectId));
  const [cur, setCur] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [pi, setPi] = useState(0);
  const fileRef = useRef(null);

  useEffect(() => { writeLibrary(library); }, [library]);
  useEffect(() => {
    writeDeck(projectId, deck);
    setCur((c) => Math.max(0, Math.min(c, deck.slides.length - 1)));
  }, [deck, projectId]);

  // Charts / figures that were ⭐-starred on the experiment pages.
  const starred = (tests || []).flatMap((t) =>
    getStarredItems(t)
      .filter((s) => s && (s.kind === 'graph' || s.kind === 'figure') && s.url)
      .map((s) => ({ ...s, testName: t.name || t.id || 'test' }))
  );

  // ---- slide operations ---------------------------------------------------
  const addSlide = () => {
    const slides = [...deck.slides, { id: uid('slide'), title: `Slide ${deck.slides.length + 1}`, blocks: [] }];
    setDeck({ ...deck, slides });
    setCur(slides.length - 1);
  };
  const dupSlide = (i) => {
    const src = deck.slides[i];
    const copy = { ...src, id: uid('slide'), title: `${src.title || 'Slide'} copy`, blocks: (src.blocks || []).map((b) => ({ ...b, id: uid('blk') })) };
    const slides = [...deck.slides.slice(0, i + 1), copy, ...deck.slides.slice(i + 1)];
    setDeck({ ...deck, slides });
    setCur(i + 1);
  };
  const delSlide = (i) => {
    const slides = deck.slides.filter((_, k) => k !== i);
    setDeck({ ...deck, slides });
    setCur(Math.max(0, Math.min(cur, slides.length - 1)));
  };
  const moveSlide = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= deck.slides.length) return;
    const slides = [...deck.slides];
    [slides[i], slides[j]] = [slides[j], slides[i]];
    setDeck({ ...deck, slides });
    setCur(j);
  };
  const patchSlide = (i, patch) => {
    setDeck({ ...deck, slides: deck.slides.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  };
  const addBlock = (i, block) => {
    const s = deck.slides[i];
    patchSlide(i, { blocks: [...(s.blocks || []), { id: uid('blk'), ...block }] });
  };
  const patchBlock = (i, bi, patch) => {
    const s = deck.slides[i];
    patchSlide(i, { blocks: (s.blocks || []).map((b, j) => (j === bi ? { ...b, ...patch } : b)) });
  };
  const removeBlock = (i, bi) => {
    const s = deck.slides[i];
    patchSlide(i, { blocks: (s.blocks || []).filter((_, j) => j !== bi) });
  };
  const moveBlock = (i, bi, dir) => {
    const blocks = [...(deck.slides[i].blocks || [])];
    const j = bi + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[bi], blocks[j]] = [blocks[j], blocks[bi]];
    patchSlide(i, { blocks });
  };

  // ---- library operations --------------------------------------------------
  const addToLibrary = async (url, label) => {
    const item = { id: uid('lib'), label: label || 'Figure', url: await downscaleImage(url), addedAt: new Date().toISOString() };
    setLibrary((p) => [item, ...p]);
    return item;
  };
  const onUpload = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { alert('Only image files can be added to the library.'); return; }
    await addToLibrary(await blobToDataUrl(f), f.name.replace(/\.[^.]+$/, '') || 'Image');
  };
  const onPaste = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('unsupported');
      const items = await navigator.clipboard.read();
      const it = items.find((x) => x.types && x.types.some((t) => t.startsWith('image/')));
      if (!it) { alert('No image found in the clipboard.'); return; }
      const type = it.types.find((t) => t.startsWith('image/'));
      const blob = await it.getType(type);
      await addToLibrary(await blobToDataUrl(blob), 'Pasted image');
    } catch {
      alert('Clipboard reading is not available in this browser — use the Upload button instead.');
    }
  };
  const importStarred = async (s) => {
    await addToLibrary(s.url, `${s.caption || s.label || 'Chart'} · ${s.testName}`);
  };
  const renameLib = (id, label) => {
    renameLibraryItem(id, label);
    setLibrary((p) => p.map((i) => (i.id === id ? { ...i, label } : i)));
  };

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

  // ---- export to PDF --------------------------------------------------------
  const exportPdf = async () => {
    if (!deck.slides.length) { alert('Add at least one slide first.'); return; }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const left = 44, top = 64, gap = 18, cols = 2;
    const cw = (W - left * 2 - gap * (cols - 1)) / cols;
    const cellH = 250;
    const rowH = cellH + 22;
    const fitImage = (url, x, y, w, h) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(w / img.width, h / img.height);
            const iw = img.width * scale, ih = img.height * scale;
            doc.addImage(img, 'PNG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
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
          if (cur && (cur + ' ' + w2).length > width / 5.2) { lines.push(cur); cur = w2; }
          else cur = cur ? cur + ' ' + w2 : w2;
        });
        if (cur) lines.push(cur);
      });
      return lines;
    };
    for (let si = 0; si < deck.slides.length; si++) {
      if (si > 0) doc.addPage();
      const s = deck.slides[si];
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, W, 46, 'F');
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42);
      doc.text(s.title || 'Untitled slide', left, 30);
      const blocks = s.blocks || [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const x = left + (bi % cols) * (cw + gap);
        const y = top + Math.floor(bi / cols) * rowH;
        if (b.type === 'image') {
          await fitImage(b.url, x, y, cw, cellH - 16);
          if (b.caption) {
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text(wrap(b.caption, cw).slice(0, 2), x, y + cellH - 4);
          }
        } else {
          doc.setFontSize(12);
          doc.setTextColor(51, 65, 85);
          doc.text(wrap(b.text || '', cw).slice(0, 6), x, y + 14);
        }
      }
    }
    doc.save(`figures_${projectId || 'deck'}.pdf`);
  };


  const slide = deck.slides[cur];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-4">
      {/* Section header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-700">📊 Figures &amp; Slides</h3>
          <p className="text-[10px] text-slate-400">PowerPoint-like deck: import ⭐-starred experiment charts, 3D viewer captures and reusable images (formulas…). Persisted per project.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportPdf}
            className="font-bold py-1.5 px-3 rounded-lg text-xs border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">📄 Export PDF</button>
          <button type="button" onClick={() => { setPi(Math.min(deck.slides.length - 1, cur)); setPresenting(true); }}
            disabled={!deck.slides.length}
            className="font-bold py-1.5 px-3 rounded-lg text-xs border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">▶ Present</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* ---- Left: image library + imports ---- */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-600 uppercase">Image library</span>
              <span className="flex gap-1.5">
                <button type="button" onClick={() => fileRef.current && fileRef.current.click()} className={btnGhost}>⬆ Upload</button>
                <button type="button" onClick={onPaste} className={btnGhost}>📋 Paste</button>
              </span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} className="hidden" />
            {library.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic">Empty — upload formulas/structures/logos here to reuse them in slides.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto custom-scrollbar">
                {library.map((it) => (
                  <div key={it.id} className="flex flex-col gap-1 bg-white border border-slate-200 rounded-lg p-1.5 group">
                    <img src={it.url} alt={it.label} className="w-full h-16 object-contain rounded border border-slate-100" />
                    <input value={it.label || ''} onChange={(e) => renameLib(it.id, e.target.value)}
                      className="w-full text-[10px] font-bold text-slate-600 bg-transparent outline-none" />
                    <div className="flex items-center justify-between gap-1">
                      <button type="button" onClick={() => addBlock(cur, { type: 'image', url: it.url, caption: it.label || '' })}
                        disabled={!slide}
                        className="flex-1 text-[10px] font-bold bg-blue-600 text-white rounded px-1 py-0.5 disabled:opacity-40" title="Add this image to the current slide">+ slide</button>
                      <button type="button" onClick={() => { removeLibraryItem(it.id); setLibrary(readLibrary()); }}
                        className="text-[10px] text-red-500 hover:text-red-700 font-bold px-1">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
            <span className="text-xs font-bold text-amber-800 uppercase">⭐ Imported from experiments</span>
            {starred.length === 0 ? (
              <p className="text-[10px] text-slate-500 italic">Star charts/tables/structures with ⭐ on any test page to collect them here.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto custom-scrollbar">
                {starred.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg p-1.5">
                    <img src={s.url} alt={s.label} className="w-12 h-10 object-contain rounded border border-amber-100 bg-white shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-700 truncate">{s.caption || s.label}</p>
                      <p className="text-[9px] text-slate-400 truncate">{s.testName}</p>
                    </div>
                    <button type="button" onClick={() => addBlock(cur, { type: 'image', url: s.url, caption: s.caption || s.label || '' })}
                      disabled={!slide}
                      className="text-[10px] font-bold bg-blue-600 text-white rounded px-1.5 py-0.5 disabled:opacity-40 shrink-0" title="Add to current slide">+ slide</button>
                    <button type="button" onClick={() => importStarred(s)}
                      className="text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5 shrink-0" title="Also save it in the library">⇥ lib</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- Right: slide deck editor ---- */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 uppercase">Slides ({deck.slides.length})</span>
              <button type="button" onClick={addSlide} className="font-bold py-1 px-2.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-700">+ New slide</button>
            </div>
            {deck.slides.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic py-3 text-center bg-slate-50 border border-dashed border-slate-300 rounded-lg">No slides yet — click "+ New slide" to start the deck.</p>
            ) : (
              <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
                {deck.slides.map((s, i) => (
                  <button key={s.id} type="button" onClick={() => setCur(i)}
                    className={`shrink-0 min-w-[120px] max-w-[180px] px-2 py-1.5 rounded-lg border text-left transition-colors ${i === cur ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    <span className="block text-[10px] font-black uppercase opacity-70">Slide {i + 1}</span>
                    <span className="block text-[11px] font-bold truncate">{s.title || 'Untitled'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {slide && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input value={slide.title || ''} onChange={(e) => patchSlide(cur, { title: e.target.value })}
                  placeholder="Slide title"
                  className={`${inputCls} flex-1 min-w-[160px] font-bold text-sm`} />
                <button type="button" onClick={() => dupSlide(cur)} className={btnGhost} title="Duplicate this slide">⧉</button>
                <button type="button" onClick={() => moveSlide(cur, -1)} disabled={cur === 0} className={btnGhost} title="Move slide up">↑</button>
                <button type="button" onClick={() => moveSlide(cur, 1)} disabled={cur >= deck.slides.length - 1} className={btnGhost} title="Move slide down">↓</button>
                <button type="button" onClick={() => delSlide(cur)} className="text-xs font-bold px-2 py-1 rounded-md border border-red-300 text-red-600 hover:bg-red-50" title="Delete this slide">🗑</button>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={() => addBlock(cur, { type: 'text', text: '' })}
                  className="font-bold py-1 px-2.5 rounded-lg text-xs bg-slate-700 text-white hover:bg-slate-800">+ Text</button>
                <span className="text-[10px] text-slate-400">add images from the library / ⭐ imports above (their "+ slide" buttons)</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(slide.blocks || []).map((b, bi) => (
                  <div key={b.id} className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col gap-1.5">
                    {b.type === 'image' ? (
                      <>
                        <img src={b.url} alt={b.caption} className="w-full h-32 object-contain rounded border border-slate-100" />
                        <input value={b.caption || ''} onChange={(e) => patchBlock(cur, bi, { caption: e.target.value })}
                          placeholder="Caption"
                          className="w-full border border-slate-300 rounded px-1.5 py-1 text-[11px] outline-none focus:border-blue-500" />
                      </>
                    ) : (
                      <textarea value={b.text || ''} onChange={(e) => patchBlock(cur, bi, { text: e.target.value })}
                        placeholder="Text…"
                        rows={4}
                        className="w-full border border-slate-300 rounded p-1.5 text-xs outline-none focus:border-blue-500 resize-y custom-scrollbar" />
                    )}
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveBlock(cur, bi, -1)} disabled={bi === 0} className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">↑</button>
                      <button type="button" onClick={() => moveBlock(cur, bi, 1)} disabled={bi >= slide.blocks.length - 1} className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">↓</button>
                      <span className="flex-1" />
                      <button type="button" onClick={() => removeBlock(cur, bi)} className="text-[10px] px-1.5 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50">✕ remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {presenting && deck.slides[pi] && (
        <div className="fixed inset-0 z-[99999] bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-white shrink-0">
            <span className="text-xs font-bold">📊 {deck.slides[pi].title || 'Untitled slide'}</span>
            <span className="text-xs text-slate-300">{pi + 1} / {deck.slides.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10">
            <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl p-8 min-h-full">
              <h2 className="text-3xl font-black text-slate-800 mb-6 border-b border-slate-100 pb-3">{deck.slides[pi].title || 'Untitled slide'}</h2>
              <div className="grid grid-cols-2 gap-6">
                {(deck.slides[pi].blocks || []).map((b) => (
                  b.type === 'image' ? (
                    <figure key={b.id} className="flex flex-col items-center gap-2">
                      <img src={b.url} alt={b.caption} className="max-w-full max-h-[60vh] object-contain rounded-lg border border-slate-200" />
                      {b.caption && <figcaption className="text-sm text-slate-500 italic">{b.caption}</figcaption>}
                    </figure>
                  ) : (
                    <p key={b.id} className="text-base text-slate-700 whitespace-pre-wrap">{b.text}</p>
                  )
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-white shrink-0">
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

