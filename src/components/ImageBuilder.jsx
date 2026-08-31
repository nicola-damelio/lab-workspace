import React, { useState, useRef, useEffect } from 'react';
import {
  readLibrary, readProjectLibrary, moveLibraryItem,
  renameLibraryItem, removeLibraryItem, renameProjectLibraryItem, removeProjectLibraryItem
} from '../utils/figuresLibrary';
import { loadProjects, saveProjects, genProjectId } from './AppModules/projectsModule';

const ptToMm = (pt) => pt * 0.352778;
const PX_PER_MM = 96 / 25.4; // CSS: 1 mm ≈ 3.78 px

export const ImageBuilder = ({ projectId, jumpToTest }) => {
  const storageKey = `labImageBuilder_${projectId || 'global'}`;
  const svgRef = useRef(null);
  const dragState = useRef(null);
  const fsAreaRef = useRef(null);   // fullscreen canvas area (measured for "zoom on object")
  const initialZoomRef = useRef(1.5);        // zoom when fullscreen was entered ("↩ Initial zoom")
  const initialPanRef = useRef({ x: 0, y: 0 });

  const [canvasW, setCanvasW] = useState(180);
  const [canvasH, setCanvasH] = useState(120);
  const [gridCols, setGridCols] = useState(4);
  const [gridRows, setGridRows] = useState(5);
  const [objects, setObjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryTab, setLibraryTab] = useState('project');
  const [libVersion, setLibVersion] = useState(0); // forces a re-read of the library lists after a transfer
  const [libProjectId, setLibProjectId] = useState(null); // which project's library to browse (null = the active one)
  const [placeTextMode, setPlaceTextMode] = useState(false); // click on the object to add text there
  const [globalCaption, setGlobalCaption] = useState('');     // figure-wide caption at the bottom
  const [editingText, setEditingText] = useState(null);       // { objId, txId, mmX, mmY, value } — type directly on the canvas
  const [insertOpen, setInsertOpen] = useState(false);        // "insert into project section" modal
  const [insertTarget, setInsertTarget] = useState({ projectId: projectId || '', section: 'background', caption: '' });
  const [insertMsg, setInsertMsg] = useState('');

  const allProjects = loadProjects();
  const activeLibProjectId = libProjectId || projectId; // project library scope currently browsed
  const captionH = globalCaption && globalCaption.trim() ? 14 : 0; // reserved caption band (mm)

  // Fullscreen & Zoom states
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState(1.5); // Start at 150% for better visibility
  const [panX, setPanX] = useState(0);   // fullscreen canvas pan (px) — used by "zoom on object"
  const [panY, setPanY] = useState(0);
  const [focusObjId, setFocusObjId] = useState(null); // object zoomed on (persisted so "◀ Back" restores it)

  // Load persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.canvasW) setCanvasW(data.canvasW);
        if (data.canvasH) setCanvasH(data.canvasH);
        if (data.gridCols) setGridCols(data.gridCols);
        if (data.gridRows) setGridRows(data.gridRows);
        if (data.objects) {
          // Only the small thumbnail is persisted; re-resolve the full-resolution
          // image from its library entry so the canvas never exceeds the
          // localStorage quota (and the object does not "disappear" after the
          // user navigates to the original graph and back).
          setObjects((data.objects || []).map((o) => {
            if (!o.libId) return o;
            try {
              // Search every scope the image could live in — the project it was
              // picked from (libProjectId), the currently-active project, then
              // the common library — so the full-resolution copy is always found
              // even if the project context changed while away.
              const scopes = [];
              if (o.libScope === 'project') {
                if (o.libProjectId) scopes.push(['project', o.libProjectId]);
                scopes.push(['project', projectId], ['common', null]);
              } else {
                scopes.push(['common', null], ['project', o.libProjectId || projectId]);
              }
              let it = null;
              for (const [scope, pid] of scopes) {
                const lib = scope === 'project' ? readProjectLibrary(pid) : readLibrary();
                it = lib.find((x) => x.id === o.libId);
                if (it) break;
              }
              if (it) return { ...o, imgSrc: it.full || it.url, imgThumb: it.url || it.full };
            } catch { /* keep the persisted thumbnail */ }
            return o;
          }));
        }
        if (data.globalCaption !== undefined) setGlobalCaption(data.globalCaption);
        // Restore the "zoom on object" view the user left — e.g. when returning
        // from the original graph via the test page's ◀ Back button.
        if (data.focusObjId && data.objects && data.objects.some((o) => o.id === data.focusObjId)) {
          setFocusObjId(data.focusObjId);
          setIsFullScreen(true);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      // Persist a lightweight copy (the small thumbnail instead of the
      // full-resolution dataURL) so the layout always re-opens after
      // navigating away and back.
      const persisted = (objects || []).map((o) => (o.libId ? { ...o, imgSrc: o.imgThumb || o.imgSrc } : o));
      localStorage.setItem(storageKey, JSON.stringify({ canvasW, canvasH, gridCols, gridRows, objects: persisted, focusObjId, globalCaption }));
    } catch {}
  }, [canvasW, canvasH, gridCols, gridRows, objects, focusObjId, globalCaption, storageKey]);

  const cellW = canvasW / gridCols;
  const cellH = canvasH / gridRows;

  const addObject = () => {
    const id = `obj_${Date.now()}`;
    const nextLetter = objects.length < 26 ? String.fromCharCode(65 + objects.length) : `${objects.length + 1}`;
    const newObj = {
      id, x: 0, y: 0, w: 1, h: 1,
      letter: nextLetter,
      letterStyle: { fontSize: 14, color: '#000000', bold: true },
      caption: '',
      captionStyle: { fontSize: 10, color: '#000000', bold: false },
      imgSrc: null, imgFit: 'contain', imgScale: 1, imgPadding: 2,
      imgOffsetX: 0, imgOffsetY: 0,  // shift the image inside the object frame (mm)
      imgRotate: 0,                   // image rotation (degrees)
      texts: [],                      // free text overlays [{ id, x, y, text, fontSize, color, bold, italic }]
      src: null                       // { testId, testName, elementLabel } — link back to the original graph
    };
    setObjects([...objects, newObj]);
    setSelectedId(id);
  };

  const updateObj = (patch) => {
    setObjects(prev => prev.map(o => o.id === selectedId ? { ...o, ...patch } : o));
  };

  const handlePickImage = (item) => {
    updateObj({
      imgSrc: item.full || item.url,
      imgThumb: item.url || item.full,
      libScope: libraryTab,
      libProjectId: libraryTab === 'project' ? activeLibProjectId : null,
      libId: item.id,
      src: item.src || null
    });
    setShowLibrary(false);
  };

  // Move an image between a project library and the common (dataset) library.
  const transferItem = (item) => {
    const from = libraryTab; // 'project' | 'common'
    const to = from === 'project' ? 'common' : 'project';
    moveLibraryItem(from, to, libraryTab === 'project' ? activeLibProjectId : projectId, item.id);
    setLibVersion((v) => v + 1);
  };

  // Rename / delete a library image.
  const renameLib = (id) => {
    const current = (libraryTab === 'project' ? readProjectLibrary(activeLibProjectId) : readLibrary()).find((i) => i.id === id);
    const name = window.prompt('Image label:', (current && current.label) || '');
    if (name && name.trim()) {
      if (libraryTab === 'project') renameProjectLibraryItem(activeLibProjectId, id, name.trim());
      else renameLibraryItem(id, name.trim());
      setLibVersion((v) => v + 1);
    }
  };
  const deleteLib = (id) => {
    if (!window.confirm('Delete this image from the library?')) return;
    if (libraryTab === 'project') removeProjectLibraryItem(activeLibProjectId, id);
    else removeLibraryItem(id);
    setLibVersion((v) => v + 1);
  };

  // Open the original experiment AND scroll to the exact chart/spectrum the
  // image was captured from (the ChartStarLayer marks each chart with
  // data-figure-origin and scrolls to the pending key on arrival).
  const openOriginalGraph = (src) => {
    if (!src || !src.testId) return;
    if (src.elementKey) {
      try { localStorage.setItem('labPendingFigureScroll', JSON.stringify({ key: src.elementKey, at: Date.now() })); } catch { /* ignore */ }
    }
    if (jumpToTest) jumpToTest(src.testId);
  };

  // Drag & Resize Logic
  const startDrag = (e, id) => {
    e.stopPropagation();
    const obj = objects.find(o => o.id === id);
    if (!obj) return;
    // Hold Shift while dragging the object frame to SHIFT the image instead.
    if (e.shiftKey && obj.imgSrc) {
      dragState.current = { type: 'imgShift', id, startX: e.clientX, startY: e.clientY, origX: obj.imgOffsetX || 0, origY: obj.imgOffsetY || 0 };
      window.addEventListener('mousemove', onDrag);
      window.addEventListener('mouseup', endDrag);
      return;
    }
    dragState.current = { type: 'move', id, startX: e.clientX, startY: e.clientY, origX: obj.x, origY: obj.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  const startResize = (e, id) => {
    e.stopPropagation();
    const obj = objects.find(o => o.id === id);
    dragState.current = { type: 'resize', id, startX: e.clientX, startY: e.clientY, origW: obj.w, origH: obj.h, origX: obj.x, origY: obj.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  const onDrag = (e) => {
    if (!dragState.current) return;
    const { type, id, textId, startX, startY, origX, origY, origW, origH, origScale } = dragState.current;
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const rect = svgEl.getBoundingClientRect();
    const scaleX = canvasW / rect.width;
    const scaleY = canvasH / rect.height;

    const dxMm = (e.clientX - startX) * scaleX;
    const dyMm = (e.clientY - startY) * scaleY;

    // Dragging the image inside its frame → shift it (mouse pan).
    if (type === 'imgShift') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id) return o;
        return { ...o, imgOffsetX: +(origX + dxMm).toFixed(2), imgOffsetY: +(origY + dyMm).toFixed(2) };
      }));
      return;
    }

    // Dragging the image resize handle → resize the image by drag & drop.
    if (type === 'imgResize') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id) return o;
        const baseW = Math.max(1, (o.w * cellW) - (o.imgPadding || 0) * 2);
        const factor = Math.max(0.1, Math.min(5, (baseW + dxMm) / baseW));
        return { ...o, imgScale: +(origScale * factor).toFixed(3) };
      }));
      return;
    }

    // Dragging a free text overlay → move it by millimetres inside the object.
    if (type === 'text') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id || !Array.isArray(o.texts)) return o;
        return { ...o, texts: o.texts.map(tx => tx.id === textId ? { ...tx, x: +(origX + dxMm).toFixed(2), y: +(origY + dyMm).toFixed(2) } : tx) };
      }));
      return;
    }

    const dCols = Math.round(dxMm / cellW);
    const dRows = Math.round(dyMm / cellH);

    setObjects(prev => prev.map(o => {
      if (o.id !== id) return o;
      if (type === 'move') {
        return { ...o, x: Math.max(0, Math.min(gridCols - o.w, origX + dCols)), y: Math.max(0, Math.min(gridRows - o.h, origY + dRows)) };
      } else {
        return { ...o, w: Math.max(1, Math.min(gridCols - origX, origW + dCols)), h: Math.max(1, Math.min(gridRows - origY, origH + dRows)) };
      }
    }));
  };

  const endDrag = () => {
    dragState.current = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
  };

  // Start dragging a free text overlay (millimetre coordinates inside the object).
  const startTextDrag = (e, objId, txId) => {
    e.stopPropagation();
    const obj = objects.find(o => o.id === objId);
    const tx = ((obj && obj.texts) || []).find(t => t.id === txId);
    if (!tx) return;
    dragState.current = { type: 'text', id: objId, textId: txId, startX: e.clientX, startY: e.clientY, origX: tx.x, origY: tx.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Start dragging the IMAGE inside its frame (mouse pan).
  const startImageShift = (e, objId) => {
    e.stopPropagation();
    const obj = objects.find(o => o.id === objId);
    if (!obj || !obj.imgSrc) return;
    dragState.current = { type: 'imgShift', id: objId, startX: e.clientX, startY: e.clientY, origX: obj.imgOffsetX || 0, origY: obj.imgOffsetY || 0 };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Start dragging the IMAGE RESIZE handle (bottom-right corner of the image).
  const startImageResize = (e, objId) => {
    e.stopPropagation();
    const obj = objects.find(o => o.id === objId);
    if (!obj || !obj.imgSrc) return;
    dragState.current = { type: 'imgResize', id: objId, startX: e.clientX, startY: e.clientY, origScale: obj.imgScale || 1 };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // ---- free text overlays --------------------------------------------------
  // Add a text at a given position (mm inside the object) — used by the
  // "+ Add Text" button (centre) and by "Place by click" (mouse position).
  const addTextAt = (obj, xMm, yMm) => {
    const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tx = {
      id,
      x: +Math.max(1, Math.min((obj.w * cellW) - 1, xMm)).toFixed(1),
      y: +Math.max(4, Math.min((obj.h * cellH) - 4, yMm)).toFixed(1),
      text: 'Text', fontSize: 12, color: '#000000', bold: false, italic: false
    };
    setObjects(prev => prev.map(o => o.id === obj.id ? { ...o, texts: [...(o.texts || []), tx] } : o));
    setPlaceTextMode(false);
    // Start typing directly on the canvas at the placed position.
    setEditingText({ objId: obj.id, txId: id, mmX: obj.x * cellW + tx.x, mmY: obj.y * cellH + tx.y, value: tx.text });
  };
  const setTextValue = (objId, txId, value) => {
    setObjects(prev => prev.map(o => o.id === objId ? { ...o, texts: (o.texts || []).map(t => t.id === txId ? { ...t, text: value } : t) } : o));
    setEditingText(prev => (prev && prev.txId === txId ? { ...prev, value } : prev));
  };
  const stopEditing = () => setEditingText(null);
  const addText = () => {
    if (!selectedId) return;
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    addTextAt(obj, (obj.w * cellW) / 2, (obj.h * cellH) / 2);
  };
  const updateText = (txId, patch) => {
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    updateObj({ texts: (obj.texts || []).map(tx => tx.id === txId ? { ...tx, ...patch } : tx) });
  };
  const deleteText = (txId) => {
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    updateObj({ texts: (obj.texts || []).filter(tx => tx.id !== txId) });
  };

  // ---- zoom fullscreen onto the selected object ----------------------------
  const zoomToObject = (id) => {
    if (!objects.some(o => o.id === id)) return;
    setSelectedId(id);
    setFocusObjId(id);
    setZoom(1.5);
    setIsFullScreen(true);
  };

  // Centre the focused object in the fullscreen canvas area (measured live so
  // it fits any screen size).
  const recenterFocus = () => {
    const area = fsAreaRef.current;
    if (!area || !focusObjId) return;
    const obj = objects.find(o => o.id === focusObjId);
    if (!obj) return;
    const aw = Math.max(120, area.clientWidth - 64); // p-8 padding
    const ah = Math.max(120, area.clientHeight - 64);
    const oxMm = obj.x * cellW, oyMm = obj.y * cellH;
    const owMm = Math.max(12, obj.w * cellW), ohMm = Math.max(12, obj.h * cellH);
    // The canvas is styled in CSS millimetres (≈3.78 px/mm): convert the object
    // size to pixels so the WHOLE object fits the viewport (with a small margin)
    // instead of being over-zoomed to a fragment of it.
    const owPx = owMm * PX_PER_MM, ohPx = ohMm * PX_PER_MM;
    const scale = Math.max(0.05, Math.min((aw - 24) / owPx, (ah - 24) / ohPx));
    const px = (aw - owPx * scale) / 2 - oxMm * PX_PER_MM * scale;
    const py = (ah - ohPx * scale) / 2 - oyMm * PX_PER_MM * scale;
    // The object-fit view is the "initial" view of this fullscreen session.
    initialZoomRef.current = scale;
    initialPanRef.current = { x: px, y: py };
    setZoom(scale);
    setPanX(px);
    setPanY(py);
  };

  // Centre the whole canvas in the fullscreen viewport (no focused object).
  const centerCanvasAt = (z) => {
    const area = fsAreaRef.current;
    if (!area) return;
    const aw = Math.max(120, area.clientWidth - 64); // p-8 padding
    const ah = Math.max(120, area.clientHeight - 64);
    const cw = canvasW * PX_PER_MM * z;
    const ch = (canvasH + captionH) * PX_PER_MM * z;
    setPanX(Math.max(0, (aw - cw) / 2));
    setPanY(Math.max(0, (ah - ch) / 2));
  };
  const centerCanvas = () => centerCanvasAt(zoom);

  // Restore the zoom (and centring) that was active when fullscreen was entered.
  const restoreInitialZoom = () => {
    setZoom(initialZoomRef.current);
    if (focusObjId) {
      setPanX(initialPanRef.current.x);
      setPanY(initialPanRef.current.y);
    } else {
      centerCanvasAt(initialZoomRef.current);
    }
  };

  useEffect(() => {
    if (!isFullScreen) return;
    if (focusObjId) recenterFocus();
    else centerCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreen, focusObjId]);

  // Render the composition (without selection UI) to a PNG data URL.
  const renderToDataUrl = (outScale = 11.8) => new Promise((resolve) => {
    const svgEl = svgRef.current;
    if (!svgEl) { resolve(null); return; }
    const clone = svgEl.cloneNode(true);
    clone.querySelectorAll('[data-selection-ui="true"]').forEach(el => el.remove());
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(canvasW * outScale);
      canvas.height = Math.round((canvasH + captionH) * outScale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });

  // Export to 300 DPI PNG
  const exportPng = async () => {
    const dataUrl = await renderToDataUrl(11.8);
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `figure_${Date.now()}.png`;
    a.click();
  };

  const selectedObj = objects.find(o => o.id === selectedId);
  void libVersion; // re-read the library lists on every transfer (the bump triggers a re-render)
  const libraryItems = libraryTab === 'project' ? readProjectLibrary(activeLibProjectId) : readLibrary();

  // Helper to render the SVG content (shared between normal and fullscreen)
  const renderSvg = () => (
    <svg ref={svgRef} viewBox={`0 0 ${canvasW} ${canvasH + captionH}`} width="100%" height="100%" onClick={(e) => { e.stopPropagation(); setSelectedId(null); }}>
      {/* Grid Lines */}
      {Array.from({ length: gridCols - 1 }).map((_, i) => (
        <line key={`v${i}`} x1={(i + 1) * cellW} y1={0} x2={(i + 1) * cellW} y2={canvasH} stroke="#e2e8f0" strokeWidth={0.2} />
      ))}
      {Array.from({ length: gridRows - 1 }).map((_, i) => (
        <line key={`h${i}`} x1={0} y1={(i + 1) * cellH} x2={canvasW} y2={(i + 1) * cellH} stroke="#e2e8f0" strokeWidth={0.2} />
      ))}

      {/* Objects */}
      <defs>
        {objects.map(obj => (
          <clipPath key={`cp-${obj.id}`} id={`clip-${obj.id}`}>
            <rect x={obj.x * cellW} y={obj.y * cellH} width={obj.w * cellW} height={obj.h * cellH} />
          </clipPath>
        ))}
      </defs>
      {objects.map(obj => {
        const isSelected = obj.id === selectedId;
        const ox = obj.x * cellW;
        const oy = obj.y * cellH;
        const ow = obj.w * cellW;
        const oh = obj.h * cellH;

        const imgW = (ow - obj.imgPadding * 2) * (obj.imgScale || 1);
        const imgH = (oh - obj.imgPadding * 2) * (obj.imgScale || 1);
        const imgX = ox + obj.imgPadding + (ow - obj.imgPadding * 2 - imgW) / 2 + (obj.imgOffsetX || 0);
        const imgY = oy + obj.imgPadding + (oh - obj.imgPadding * 2 - imgH) / 2 + (obj.imgOffsetY || 0);

        return (
          <g key={obj.id} onClick={(e) => {
            e.stopPropagation();
            setSelectedId(obj.id);
            // "Place by click": add a text exactly where the user clicked.
            if (placeTextMode && svgRef.current) {
              const r = svgRef.current.getBoundingClientRect();
              const xMm = (e.clientX - r.left) * (canvasW / r.width) - ox;
              const yMm = (e.clientY - r.top) * (canvasH / r.height) - oy;
              addTextAt(obj, xMm, yMm);
            }
          }}>
            <rect x={ox} y={oy} width={ow} height={oh} fill="white" stroke={isSelected ? '#3b82f6' : '#cbd5e1'} strokeWidth={isSelected ? 0.5 : 0.2} onMouseDown={(e) => startDrag(e, obj.id)} style={{ cursor: 'move' }} />

            {obj.imgSrc && (
              <g clipPath={`url(#clip-${obj.id})`}>
                <image
                  href={obj.imgSrc}
                  x={imgX} y={imgY} width={imgW} height={imgH}
                  transform={(obj.imgRotate || 0) ? `rotate(${obj.imgRotate} ${imgX + imgW / 2} ${imgY + imgH / 2})` : undefined}
                  preserveAspectRatio={obj.imgFit === 'cover' ? 'xMidYMid slice' : obj.imgFit === 'stretch' ? 'none' : 'xMidYMid meet'}
                  style={{ pointerEvents: 'none' }}
                />
                {isSelected && (
                  <rect data-selection-ui="true" x={Math.max(ox, imgX)} y={Math.max(oy, imgY)} width={Math.min(ow, imgW)} height={Math.min(oh, imgH)} fill="transparent"
                    style={{ cursor: 'move' }} onMouseDown={(e) => startImageShift(e, obj.id)}
                    title="Drag to shift the image inside the frame (or hold Shift while dragging anywhere on the object)" />
                )}
                {isSelected && (
                  <rect data-selection-ui="true" x={Math.max(ox, imgX) + Math.min(ow, imgW) - 5} y={Math.max(oy, imgY) + Math.min(oh, imgH) - 5} width={6} height={6} fill="#3b82f6"
                    style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => startImageResize(e, obj.id)}
                    title="Drag to resize the image" />
                )}
              </g>
            )}

            {obj.letter && (
              <text x={ox + 1.5} y={oy + ptToMm(obj.letterStyle.fontSize) + 1} fontSize={ptToMm(obj.letterStyle.fontSize)} fill={obj.letterStyle.color} fontWeight={obj.letterStyle.bold ? 'bold' : 'normal'} style={{ pointerEvents: 'none' }}>
                {obj.letter}
              </text>
            )}

            {obj.caption && (
              <text x={ox + ow / 2} y={oy + oh - 1.5} fontSize={ptToMm(obj.captionStyle.fontSize)} fill={obj.captionStyle.color} fontWeight={obj.captionStyle.bold ? 'bold' : 'normal'} textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {obj.caption}
              </text>
            )}

            {/* Free text overlays — draggable anywhere inside the object; double-click to edit in place */}
            {(obj.texts || []).map(tx => {
              const isEditing = editingText && editingText.txId === tx.id;
              return (
                <text
                  key={tx.id}
                  x={ox + tx.x}
                  y={oy + tx.y}
                  fontSize={ptToMm(tx.fontSize || 12)}
                  fill={tx.color || '#000000'}
                  fontWeight={tx.bold ? 'bold' : 'normal'}
                  fontStyle={tx.italic ? 'italic' : 'normal'}
                  opacity={isEditing ? 0 : 1}
                  style={{ pointerEvents: isSelected ? 'auto' : 'none', cursor: isSelected ? 'move' : 'default' }}
                  onMouseDown={isSelected && !isEditing ? (e) => startTextDrag(e, obj.id, tx.id) : undefined}
                  onDoubleClick={isSelected ? () => setEditingText({ objId: obj.id, txId: tx.id, mmX: obj.x * cellW + tx.x, mmY: obj.y * cellH + tx.y, value: tx.text }) : undefined}
                >{tx.text}</text>
              );
            })}

            {isSelected && (
              <rect data-selection-ui="true" x={ox + ow - 2} y={oy + oh - 2} width={2} height={2} fill="#3b82f6" style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => startResize(e, obj.id)} />
            )}

            {/* Link back to the original graph lives in the properties panel
                ("↗ Open original graph") — no on-canvas arrow needed. */}
          </g>
        );
      })}
      {captionH > 0 && (
        <text x={canvasW / 2} y={canvasH + captionH - 4} fontSize={ptToMm(12)} fill="#1f2937" textAnchor="middle" fontWeight="bold">{globalCaption}</text>
      )}
    </svg>
  );

  // Properties Panel Component (reused in normal and fullscreen)
  const PropertiesPanel = ({ isFloating = false }) => (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3 ${isFloating ? 'shadow-2xl max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar' : ''}`}>
      <div className="flex justify-between items-center">
        <h4 className="font-bold text-slate-700">Object Properties ({selectedObj.letter || 'No Letter'})</h4>
        <button onClick={() => { setObjects(objects.filter(o => o.id !== selectedObj.id)); setSelectedId(null); }} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100">Delete</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => zoomToObject(selectedObj.id)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">⛶ Zoom Fullscreen on Object</button>
        {selectedObj.src && selectedObj.src.testId && (
          <button onClick={() => openOriginalGraph(selectedObj.src)}
            className="bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-300 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
            title={`Open the original experiment and scroll to the chart/spectrum: ${selectedObj.src.testName || selectedObj.src.elementLabel || ''}`}>
            ↗ Open original graph{selectedObj.src.testName ? ` · ${selectedObj.src.testName}` : ''}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <h5 className="text-xs font-bold text-slate-500 uppercase">Image & Layout</h5>
          <button onClick={() => setShowLibrary(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-lg text-xs">Import Image (High-Res)</button>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-bold text-slate-500">Fit
              <select value={selectedObj.imgFit} onChange={e => updateObj({ imgFit: e.target.value })} className="w-full border rounded p-1 text-xs">
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500">Scale (%)
              <input type="number" min="10" max="500" value={Math.round((selectedObj.imgScale || 1) * 100)} onChange={e => updateObj({ imgScale: Number(e.target.value) / 100 })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Padding (mm)
              <input type="number" min="0" max="20" step="0.5" value={selectedObj.imgPadding} onChange={e => updateObj({ imgPadding: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Shift X (mm)
              <input type="number" min="-200" max="200" step="0.5" value={selectedObj.imgOffsetX || 0} onChange={e => updateObj({ imgOffsetX: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Shift the image horizontally inside the object frame" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Shift Y (mm)
              <input type="number" min="-200" max="200" step="0.5" value={selectedObj.imgOffsetY || 0} onChange={e => updateObj({ imgOffsetY: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Shift the image vertically inside the object frame" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Rotate (°)
              <div className="flex gap-1">
                <input type="number" min="-360" max="360" step="1" value={selectedObj.imgRotate || 0} onChange={e => updateObj({ imgRotate: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Rotate the image" />
                <button type="button" onClick={() => updateObj({ imgRotate: ((selectedObj.imgRotate || 0) + 90) % 360 })} className="bg-slate-100 border border-slate-300 rounded px-1.5 text-xs font-bold hover:bg-slate-200 shrink-0" title="Rotate 90°">↻90°</button>
              </div>
            </label>
            <span className="col-span-2 text-[9px] text-slate-400 italic">Drag the image directly on the canvas to shift it (or hold Shift + drag the object frame); drag its corner to resize it.</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h5 className="text-xs font-bold text-slate-500 uppercase">Labels & Captions</h5>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-bold text-slate-500">Letter
              <input type="text" value={selectedObj.letter} onChange={e => updateObj({ letter: e.target.value })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Letter Size (pt)
              <input type="number" min="4" max="48" value={selectedObj.letterStyle.fontSize} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, fontSize: Number(e.target.value) } })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Caption
              <input type="text" value={selectedObj.caption} onChange={e => updateObj({ caption: e.target.value })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Caption Size (pt)
              <input type="number" min="4" max="48" value={selectedObj.captionStyle.fontSize} onChange={e => updateObj({ captionStyle: { ...selectedObj.captionStyle, fontSize: Number(e.target.value) } })} className="w-full border rounded p-1 text-xs" />
            </label>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[10px] font-bold text-slate-500">Letter Color
              <input type="color" value={selectedObj.letterStyle.color} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, color: e.target.value } })} className="w-8 h-6 rounded border cursor-pointer" />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
              <input type="checkbox" checked={selectedObj.letterStyle.bold} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, bold: e.target.checked } })} /> Bold
            </label>
            <label className="text-[10px] font-bold text-slate-500">Caption Color
              <input type="color" value={selectedObj.captionStyle.color} onChange={e => updateObj({ captionStyle: { ...selectedObj.captionStyle, color: e.target.value } })} className="w-8 h-6 rounded border cursor-pointer" />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
              <input type="checkbox" checked={selectedObj.captionStyle.bold} onChange={e => updateObj({ captionStyle: { ...selectedObj.captionStyle, bold: e.target.checked } })} /> Bold
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-bold text-slate-500 uppercase">Free Text (anywhere in the object)</h5>
          <div className="flex gap-1.5">
            <button onClick={addText} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-2.5 py-1 rounded text-[10px]">+ Add Text</button>
            <button onClick={() => setPlaceTextMode(v => !v)}
              className={`font-bold px-2.5 py-1 rounded text-[10px] border ${placeTextMode ? 'bg-amber-500 text-white border-amber-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              title="Click on the object to place text exactly where you click">✏️ Place by click</button>
          </div>
        </div>
        {placeTextMode && <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Click anywhere on the selected object to add a text there.</p>}
        {(selectedObj.texts || []).length === 0 && <p className="text-[10px] text-slate-400 italic">Add a text with “+ Add Text” or “✏️ Place by click”, then drag it directly on the object to move it.</p>}
        {(selectedObj.texts || []).map((tx, i) => (
          <div key={tx.id} className="border border-slate-200 rounded-lg p-2 bg-white flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black text-slate-400 w-4">{i + 1}</span>
              <input type="text" value={tx.text} onChange={e => updateText(tx.id, { text: e.target.value })} className="flex-1 border rounded p-1 text-xs min-w-0" />
              <button onClick={() => deleteText(tx.id)} className="text-red-400 hover:text-red-600 font-bold text-xs px-1" title="Delete text">✕</button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <label className="text-[9px] font-bold text-slate-500">X (mm)
                <input type="number" step="0.5" value={tx.x} onChange={e => updateText(tx.id, { x: Number(e.target.value) })} className="w-full border rounded p-0.5 text-[10px]" />
              </label>
              <label className="text-[9px] font-bold text-slate-500">Y (mm)
                <input type="number" step="0.5" value={tx.y} onChange={e => updateText(tx.id, { y: Number(e.target.value) })} className="w-full border rounded p-0.5 text-[10px]" />
              </label>
              <label className="text-[9px] font-bold text-slate-500">Size (pt)
                <input type="number" min="4" max="96" value={tx.fontSize} onChange={e => updateText(tx.id, { fontSize: Number(e.target.value) })} className="w-full border rounded p-0.5 text-[10px]" />
              </label>
              <label className="text-[9px] font-bold text-slate-500">Color
                <input type="color" value={tx.color} onChange={e => updateText(tx.id, { color: e.target.value })} className="w-full h-6 rounded border cursor-pointer" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                <input type="checkbox" checked={tx.bold} onChange={e => updateText(tx.id, { bold: e.target.checked })} /> Bold
              </label>
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                <input type="checkbox" checked={tx.italic} onChange={e => updateText(tx.id, { italic: e.target.checked })} /> Italic
              </label>
              <span className="text-[9px] text-slate-400 italic ml-auto">drag on the object to move</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Main Component UI */}
      <div className="flex flex-col gap-4 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-black text-slate-800">🖼️ Image Builder (Publication Quality)</h3>
          <div className="flex gap-2">
            <button onClick={() => { initialZoomRef.current = zoom; setIsFullScreen(true); }} className="text-xs bg-slate-800 text-white border border-slate-800 px-3 py-1.5 rounded-lg font-bold hover:bg-slate-700 flex items-center gap-1">
              🔍 Full Screen
            </button>
            <button onClick={() => { if(window.confirm('Clear the entire canvas?')) { setObjects([]); setSelectedId(null); } }} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100">Clear Canvas</button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Width (mm)
            <input type="number" min="50" max="500" value={canvasW} onChange={e => setCanvasW(Number(e.target.value))} className="border rounded p-1 text-xs w-20" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Height (mm)
            <input type="number" min="50" max="500" value={canvasH} onChange={e => setCanvasH(Number(e.target.value))} className="border rounded p-1 text-xs w-20" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Grid Cols
            <input type="number" min="1" max="20" value={gridCols} onChange={e => setGridCols(Number(e.target.value))} className="border rounded p-1 text-xs w-16" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Grid Rows
            <input type="number" min="1" max="20" value={gridRows} onChange={e => setGridRows(Number(e.target.value))} className="border rounded p-1 text-xs w-16" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col flex-1 min-w-[220px]">Global caption (bottom of the figure)
            <input type="text" value={globalCaption} onChange={e => setGlobalCaption(e.target.value)} placeholder="e.g. Figure 1 — ¹H NMR of compound X" className="border rounded p-1 text-xs" />
          </label>
          <button onClick={addObject} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
          <button onClick={() => selectedId && zoomToObject(selectedId)} disabled={!selectedId} title={selectedId ? 'Zoom fullscreen on the selected object' : 'Select an object first'}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">⛶ Zoom Object</button>
          <button onClick={exportPng} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG (300 DPI)</button>
          <button onClick={() => { setInsertTarget({ projectId: projectId || (allProjects[0] && allProjects[0].id) || '', section: 'background', caption: globalCaption || '' }); setInsertMsg(''); setInsertOpen(true); }}
            className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">📤 Insert into project…</button>
        </div>

        {/* SVG Canvas (Normal View) */}
        <div className="border border-slate-300 rounded-lg bg-slate-100 p-2 flex justify-center overflow-auto">
          <div style={{ width: '100%', maxWidth: '800px', aspectRatio: `${canvasW} / ${canvasH + captionH}` }} className="bg-white shadow-md">
            {renderSvg()}
          </div>
        </div>

        {/* Properties Panel (Normal View) */}
        {selectedObj && <PropertiesPanel />}
      </div>

      {/* Inline text editor — type directly on the canvas at the placed position */}
      {editingText && svgRef.current && (() => {
        const r = svgRef.current.getBoundingClientRect();
        const x = r.left + (editingText.mmX / canvasW) * r.width;
        const y = r.top + (editingText.mmY / (canvasH + captionH)) * r.height;
        return (
          <input
            value={editingText.value}
            autoFocus
            onChange={(e) => setTextValue(editingText.objId, editingText.txId, e.target.value)}
            onBlur={stopEditing}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') stopEditing(); }}
            style={{ position: 'fixed', left: x, top: y - 18, zIndex: 999999, minWidth: 140, fontSize: 14 }}
            className="border-2 border-blue-500 rounded px-1.5 py-0.5 outline-none bg-white shadow-lg"
          />
        );
      })()}

      {/* FULL SCREEN OVERLAY */}
      {isFullScreen && (
        <div className="fixed inset-0 z-[99999] bg-slate-100 flex flex-col">
          {/* Top Toolbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shadow-sm z-10 shrink-0">
            <div className="flex items-center gap-4">
              <h3 className="font-bold text-slate-800">Image Builder</h3>
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5">
                <button onClick={() => setZoom(z => Math.max(0.1, +(z - 0.1).toFixed(1)))} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 font-bold">-</button>
                <input
                  type="range"
                  min="0.1"
                  max="8"
                  step="0.1"
                  value={zoom}
                  onChange={e => setZoom(Number(e.target.value))}
                  className="w-32 accent-blue-600"
                />
                <button onClick={() => setZoom(z => Math.min(8, +(z + 0.1).toFixed(1)))} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 font-bold">+</button>
                <span className="text-xs font-bold text-slate-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(1)} className="text-xs font-bold text-blue-600 hover:underline ml-2">Reset</button>
                <button onClick={restoreInitialZoom} className="text-xs font-bold text-indigo-600 hover:underline ml-1" title="Zoom out to the initial zoom of this fullscreen session">↩ Initial zoom</button>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => (focusObjId ? recenterFocus() : centerCanvas())}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  title={focusObjId ? 'Re-centre the zoomed object in the viewport' : 'Centre the canvas in the viewport'}>
                  ◎ Center
                </button>
                <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg px-1.5 py-1" title="Pan the canvas">
                  <button onClick={() => setPanX(p => p - 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">←</button>
                  <button onClick={() => setPanY(p => p - 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">↑</button>
                  <button onClick={() => setPanY(p => p + 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">↓</button>
                  <button onClick={() => setPanX(p => p + 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">→</button>
                </div>
              </div>

              <div className="flex gap-2">
                 <button onClick={addObject} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
                 <button onClick={exportPng} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG</button>
              </div>
            </div>
            <button onClick={() => { setFocusObjId(null); setIsFullScreen(false); }} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-700 flex items-center gap-2">
              ✕ Exit Full Screen
            </button>
          </div>

          {/* Canvas Area */}
          <div ref={fsAreaRef} className="flex-1 overflow-auto relative bg-slate-200 p-8" onClick={() => setSelectedId(null)}>
            <div
              style={{
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: `${canvasW}mm`,
                height: `${canvasH + captionH}mm`
              }}
              className="shadow-2xl bg-white"
            >
              {renderSvg()}
            </div>
          </div>

          {/* Floating Properties Panel */}
          {selectedObj && (
            <div className="absolute top-16 right-4 bottom-4 w-80 z-20">
              <PropertiesPanel isFloating />
            </div>
          )}
        </div>
      )}

      {/* Library Modal */}
      {showLibrary && (
        <div className="fixed inset-0 bg-black/50 z-[100000] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold text-lg">Select Image (High-Resolution)</h3>
              <button onClick={() => setShowLibrary(false)}>✕</button>
            </div>
            <div className="p-4 border-b flex flex-wrap gap-3 items-center">
              <div className="flex gap-2">
                <button className={`px-3 py-1 rounded font-bold text-xs ${libraryTab === 'project' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setLibraryTab('project')}>Project Library</button>
                <button className={`px-3 py-1 rounded font-bold text-xs ${libraryTab === 'common' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setLibraryTab('common')}>Dataset Library</button>
              </div>
              {libraryTab === 'project' && (
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  Project
                  <select value={activeLibProjectId || 'global'} onChange={(e) => setLibProjectId(e.target.value === 'global' ? null : e.target.value)}
                    className="border border-slate-300 rounded px-2 py-1 text-xs bg-white max-w-[240px]">
                    <option value="global">Current / no project</option>
                    {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 md:grid-cols-4 gap-4">
              {libraryItems.length === 0 && <p className="col-span-full text-center text-slate-400 italic">No images in this library yet.</p>}
              {libraryItems.map(item => (
                <div key={item.id} className="border rounded-lg p-2 cursor-pointer hover:border-blue-500 flex flex-col items-center hover:shadow-md transition-all" onClick={() => handlePickImage(item)}>
                  <img src={item.url} alt={item.label} className="w-full h-24 object-contain bg-slate-50 rounded" />
                  <span className="text-xs mt-1 truncate w-full text-center font-bold">{item.label}</span>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap justify-center">
                    <button type="button" onClick={(e) => { e.stopPropagation(); renameLib(item.id); }}
                      className="text-[9px] font-bold text-slate-500 hover:text-blue-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-blue-300" title="Rename this image">✎</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); deleteLib(item.id); }}
                      className="text-[9px] font-bold text-red-400 hover:text-red-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-red-300" title="Delete this image from the library">🗑</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); transferItem(item); }}
                      className="text-[9px] font-bold text-slate-500 hover:text-blue-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-blue-300"
                      title={`Move this image to the ${libraryTab === 'project' ? 'common (dataset)' : 'project'} library`}>
                      ⇄
                    </button>
                  </div>
                  <span className="text-[8px] text-emerald-600 font-bold">High-Res</span>
                  {item.src && item.src.testName && <span className="text-[8px] text-sky-500 truncate w-full text-center">↗ {item.src.testName}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Insert composition into a project text subsection */}
      {insertOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100000] flex items-center justify-center p-4" onClick={() => setInsertOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">📤 Insert composition into a project section</h3>
              <button onClick={() => setInsertOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Project
              <select value={insertTarget.projectId} onChange={(e) => setInsertTarget({ ...insertTarget, projectId: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white">
                {allProjects.length === 0 && <option value="">No projects yet</option>}
                {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Text subsection
              <select value={insertTarget.section} onChange={(e) => setInsertTarget({ ...insertTarget, section: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white">
                <option value="background">Background</option>
                <option value="discussion">Discussion</option>
                <option value="conclusions">Conclusions</option>
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Caption
              <input type="text" value={insertTarget.caption} onChange={(e) => setInsertTarget({ ...insertTarget, caption: e.target.value })}
                placeholder={globalCaption || 'e.g. Figure 1 — ...'} className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white" />
            </label>
            {insertMsg && <p className={`text-xs font-bold ${insertMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{insertMsg}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setInsertOpen(false)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={async () => {
                  if (!insertTarget.projectId) { setInsertMsg('⚠️ Choose a project first.'); return; }
                  const dataUrl = await renderToDataUrl(Math.max(3, 1800 / canvasW));
                  if (!dataUrl) { setInsertMsg('⚠️ Could not render the composition.'); return; }
                  const projects = loadProjects();
                  const prj = projects.find((p) => p.id === insertTarget.projectId);
                  if (!prj) { setInsertMsg('⚠️ Project not found.'); return; }
                  const sec = insertTarget.section || 'background';
                  prj.figures = prj.figures || {};
                  prj.figures[sec] = prj.figures[sec] || [];
                  prj.figures[sec].push({
                    id: genProjectId(),
                    url: dataUrl,
                    caption: insertTarget.caption || globalCaption || `Image Builder composition (${new Date().toLocaleDateString()})`,
                    addedAt: new Date().toISOString(),
                    source: 'image-builder'
                  });
                  saveProjects(projects);
                  setInsertMsg(`✅ Inserted into "${prj.name}" → ${sec}.`);
                }}
                className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs"
              >Insert</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};