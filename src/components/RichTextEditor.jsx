import React, { useRef, useEffect, useState } from 'react';
import { suggestDriveFileName, getDriveFolderUrl, setDriveFolderUrl, openDrive, copyText } from '../utils/driveNaming';
import { DriveUploadButton } from './DriveUpload';
import { docxToHtml } from '../utils/docxImport';
import { getRenderableDriveUrl, repairContentImages } from '../data/constants';
import { archiveFileToDrive, uploadLocalFile, dataUrlToBlob, withExtension, getDriveToken, saveUploadForRetry } from '../utils/driveUpload';

export const RichTextEditor = ({
  value, onChange, placeholder, toolbarExtra = [],
  minHeight = 120, maxHeight = 500, resizable = true, fillHeight = true,
  linkButton = false, figureButton = false, docImportButton = false, onEditFocusChange = null,
  fileNaming = null, readOnly = false
}) => {
    const editorRef = useRef(null);
    const selRef = useRef(null);
    const docImportRef = useRef(null);
    const [importingDoc, setImportingDoc] = useState(false);
    const [linkDraft, setLinkDraft] = useState(null); // null | { text, url }
    const [figureDraft, setFigureDraft] = useState(null); // null | { url, caption }
    const [driveFolderDraft, setDriveFolderDraft] = useState(getDriveFolderUrl());
    const [toolbarOpen, setToolbarOpen] = useState(true); // collapsible toolbar (more vertical space)
    const [pasteNotice, setPasteNotice] = useState(''); // shown when an image had to stay LOCAL (Drive unavailable)
    const [selImg, setSelImg] = useState(null);   // currently selected image (for resizing)
    const [selImgW, setSelImgW] = useState(100);  // its display width (%)
    // Pasted/dropped images that had to stay LOCAL because Drive was down are
    // queued for an automatic re-upload; this map remembers the exact data URL
    // that was inserted (by queue id) so it can be swapped for the Drive URL.
    const pendingPastesRef = useRef(null);
    if (!pendingPastesRef.current) pendingPastesRef.current = new Map();

    // Deselect the resized image and clear its highlight class.
    const clearSelImg = () => {
        if (editorRef.current) {
            editorRef.current.querySelectorAll('img.rte-img-sel').forEach((im) => im.classList.remove('rte-img-sel'));
        }
        setSelImg(null);
    };

    // Full-path suggested file name for the figure being inserted (figure1, figure2, ...)
    const figureSuffix = `figure${(editorRef.current ? editorRef.current.querySelectorAll('figure').length : 0) + 1}`;
    const figureSuggestedName = suggestDriveFileName({ ...(fileNaming || {}), title: figureSuffix });
    useEffect(() => { if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = repairContentImages(value || ''); }, [value]);
    const execCmd = (cmd, val=null) => { document.execCommand(cmd, false, val); onChange(editorRef.current.innerHTML); editorRef.current.focus(); };
    /* Un bouton de la barre d'outils ne doit pas VOLER le focus : sans cela le
       clic sort de la zone de texte, la page se redessine et la commande peut
       être perdue (il fallait cliquer deux fois). `preventDefault` sur mousedown
       garde aussi la SÉLECTION : l'insertion se fait donc au curseur. */
    const keepFocus = (e) => e.preventDefault();
    const storeSel = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
            selRef.current = sel.getRangeAt(0).cloneRange();
        }
    };
    // Resolve the caret/selection range inside the editor (falls back to the end of the content)
    const getEditorRange = (el, sel) => {
        if (selRef.current && el.contains(selRef.current.startContainer)) {
            return selRef.current.cloneRange();
        }
        if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            return sel.getRangeAt(0).cloneRange();
        }
        return null;
    };
    const caretAtEnd = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        return r;
    };
    // Insert text at the last caret position (used by toolbarExtra buttons, e.g. reference markers)
    const insertText = (text) => {
        const el = editorRef.current;
        if (!el) return;
        // Capture the insertion point BEFORE focusing the editor: focusing can
        // move the caret (and handleEditFocus re-stores the selection), which
        // would insert at the START of the content instead of where the user
        // clicked/typed.
        const sel = window.getSelection();
        const range = getEditorRange(el, sel) || caretAtEnd(el);
        el.focus();

        // Prefer the native command where it is still supported (Firefox / Safari)
        try {
            if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
                sel.removeAllRanges();
                sel.addRange(range.cloneRange());
                if (document.execCommand('insertText', false, text)) {
                    onChange(el.innerHTML);
                    return;
                }
            }
        } catch { /* fall through to manual insertion */ }

        // Manual insertion via the Range API
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        const caret = document.createRange();
        caret.setStartAfter(node);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        onChange(el.innerHTML);
    };
    // Insert rich HTML (e.g. an <a> link) at the last caret position
    const insertHtml = (html) => {
        const el = editorRef.current;
        if (!el) return;
        // Capture the insertion point BEFORE focusing the editor (focus can move
        // the caret to the start and handleEditFocus re-stores the selection).
        const sel = window.getSelection();
        const range = getEditorRange(el, sel) || caretAtEnd(el);
        el.focus();

        // Prefer the native command where it is still supported (Firefox / Safari)
        try {
            if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
                sel.removeAllRanges();
                sel.addRange(range.cloneRange());
                if (document.execCommand('insertHTML', false, html)) {
                    onChange(el.innerHTML);
                    return;
                }
            }
        } catch { /* fall through to manual insertion */ }

        // Manual insertion — Chrome 134+ removed execCommand('insertHTML')
        range.deleteContents();
        const template = document.createElement('template');
        template.innerHTML = html;
        const fragment = template.content;
        const lastNode = fragment.lastChild;
        range.insertNode(fragment);

        if (lastNode && lastNode.parentNode) {
            const caret = document.createRange();
            caret.setStartAfter(lastNode);
            caret.collapse(true);
            sel.removeAllRanges();
            sel.addRange(caret);
        }

        onChange(el.innerHTML);
    };
    const escapeHtml = (s) =>
        String(s ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    // Open the link modal, pre-filling the text with the currently selected text
    const openLinkModal = () => {
        const sel = window.getSelection();
        let selected = '';
        if (sel && sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
            selected = sel.toString();
        }
        setLinkDraft({ text: selected || '', url: '' });
    };
    const insertLink = () => {
        if (!linkDraft) return;
        const url = String(linkDraft.url || '').trim();
        if (!url) return;
        const text = String(linkDraft.text || '').trim() || url;
        const safeUrl = /^(https?:|mailto:|tel:|#|\/)/i.test(url) ? url : `https://${url}`;
        insertHtml(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${escapeHtml(text)}</a>`);
        setLinkDraft(null);
    };
    // Insert an image with its caption inline at the caret position (not at the end)
    const insertFigure = () => {
        if (!figureDraft) return;
        const url = String(figureDraft.url || '').trim();
        if (!url) return;
        const caption = String(figureDraft.caption || '').trim();
        const alt = escapeHtml(caption || 'Figure');
        const imgSrc = escapeHtml(getRenderableDriveUrl(url));
        const figCaption = `<figcaption style="font-size:12px;color:#475569;margin-top:4px;min-height:18px;">${caption ? escapeHtml(caption) : '&nbsp;'}</figcaption>`;
        insertHtml(`<figure style="margin:14px 0;text-align:center;break-inside:avoid;"><img src="${imgSrc}" alt="${alt}" style="display:block;margin:0 auto;max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,0.08);"/>${figCaption}</figure>`);
        setFigureDraft(null);
    };
    // Notify parents (and the app) that the user started/stopped editing this
    // text. The window events fire unconditionally (kept for any listener),
    // while `onEditFocusChange` (if given) lets each caller decide its own
    // behaviour — e.g. the protocol editor keeps its right sidebar visible.
    const handleEditFocus = () => {
        storeSel();
        try { window.dispatchEvent(new CustomEvent('lab:edit-focus')); } catch { /* ignore */ }
        if (onEditFocusChange) onEditFocusChange(true);
    };
    const handleBlur = (e) => {
        onChange(e.target.innerHTML);
        try { window.dispatchEvent(new CustomEvent('lab:edit-blur')); } catch { /* ignore */ }
        if (onEditFocusChange) onEditFocusChange(false);
    };
    // Import a Word (.docx) document: converts text + figures, saves figures to Drive
    const handleDocImport = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (e.target.value) e.target.value = '';
        if (!file) return;
        setImportingDoc(true);
        try {
            // Archive the original .docx to Drive as well (figures are already saved separately).
            archiveFileToDrive({ file, ctx: { ...(fileNaming || {}), suffix: 'docx' } }).catch(() => {});
            const arrayBuffer = await file.arrayBuffer();
            // Number the imported figures after the ones already in the editor so
            // they never overwrite existing Drive files (figure1, figure2, …).
            const figureOffset = editorRef.current ? editorRef.current.querySelectorAll('figure').length : 0;
            const result = await docxToHtml({ arrayBuffer, naming: fileNaming || {}, figureOffset });
            if (!result.html.trim()) {
                alert('The Word document produced no readable content.');
                return;
            }
            insertHtml(result.html);
            const { images, uploadedToDrive, locallyStored } = result.stats;
            const saveNote = locallyStored
                ? `, ${locallyStored} stored locally — connect Drive to save them`
                : (uploadedToDrive > 0 ? ' — saved into your Drive folders' : '');
            const msg = images > 0
                ? `Word document imported: ${images} figure${images === 1 ? '' : 's'} (${uploadedToDrive} saved to Google Drive${saveNote}).`
                : 'Word document imported.';
            alert(msg);
        } catch (err) {
            alert('Word import failed: ' + (err && err.message ? err.message : 'unknown error'));
        } finally {
            setImportingDoc(false);
        }
    };
    const toPx = (v) => (typeof v === 'number' ? `${v}px` : v);
    const clampHeight = () => {
        let min = 100; let max = 10000;
        const parse = (v) => {
            if (typeof v === 'number' && isFinite(v)) return v;
            const m = String(v || '').trim().match(/^(\d+(?:\.\d+)?)/);
            return m ? parseFloat(m[1]) : NaN;
        };
        const mn = parse(minHeight); if (!isNaN(mn)) min = mn;
        const mx = parse(maxHeight); if (!isNaN(mx)) max = mx;
        return { min, max };
    };
    // Drag-to-resize vertically with the mouse (on the handle bar below the editor)
    const startResize = (e) => {
        if (!resizable || e.button !== 0) return;
        e.preventDefault();
        const el = editorRef.current;
        if (!el) return;
        const { min, max } = clampHeight();
        const startY = e.clientY;
        const startH = el.getBoundingClientRect().height;
        const onMove = (ev) => {
            const h = Math.max(min, Math.min(max, startH + (ev.clientY - startY)));
            el.style.height = `${h}px`;
            el.style.maxHeight = 'none'; // let the inline height win while dragging
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'ns-resize';
    };
    // Insert an image that was pasted or dropped into the editor: resizes it,
    // saves it to the context's Drive folder (protocols/<protocol>,
    // <project>/<section>, test/…/Report) as a REAL file, and inserts the Drive
    // URL. Falls back to a data URL only when Drive is unavailable — so pasted
    // images live in Drive too, not just as base64 inside the dataset.
    const insertImageBlob = (blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                let width = img.width; let height = img.height;
                const MAX_WIDTH = 1200;
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                let imgSrc = dataUrl;
                let uploadedToDrive = false;
                let driveError = '';
                // The pasted-image file name must survive the try/catch below:
                // it is reused when the image is queued for a later re-upload.
                const pastedNum = (editorRef.current ? editorRef.current.querySelectorAll('img').length : 0) + 1;
                const pastedTitle = `pasted_image_${pastedNum}`;
                try {
                    const drive = await uploadLocalFile({
                        name: withExtension(suggestDriveFileName({ ...(fileNaming || {}), title: pastedTitle }), `${pastedTitle}.jpg`),
                        mimeType: 'image/jpeg',
                        file: dataUrlToBlob(dataUrl),
                        ctx: { ...(fileNaming || {}), title: pastedTitle },
                        skipQueue: true // queued below with the exact data URL (deduplicated)
                    });
                    if (drive && drive.driveUrl) {
                        imgSrc = getRenderableDriveUrl(drive.driveUrl);
                        uploadedToDrive = true;
                    } else {
                        driveError = 'upload returned no Drive link';
                    }
                } catch (err) {
                    driveError = err && err.message ? String(err.message) : 'Drive error';
                }
                if (!uploadedToDrive) {
                    // NOT silent anymore: a local (base64) image never reaches a
                    // Drive folder, so the user must know. If Drive is simply not
                    // connected, offer to connect it right away. The image is ALSO
                    // queued for an automatic re-upload, so as soon as Drive
                    // answers again it is archived in the instance folder and the
                    // local data URL below is replaced by the real Drive link.
                    let queuedForRetry = false;
                    try {
                        const queued = await saveUploadForRetry({
                            name,
                            mimeType: 'image/jpeg',
                            file: dataUrl,
                            ctx: { ...(fileNaming || {}), title: pastedTitle },
                            source: 'paste'
                        });
                        queuedForRetry = !!(queued && queued.queued);
                        if (queuedForRetry) pendingPastesRef.current.set(queued.id, dataUrl);
                    } catch { /* queue is best-effort */ }
                    setPasteNotice(queuedForRetry
                        ? '⚠ Image inserted as a LOCAL copy for now — it will be archived to the instance Google Drive folder AUTOMATICALLY as soon as the connection is restored.'
                        : '⚠ Image inserted as a LOCAL copy — it was NOT saved to Google Drive'
                            + (driveError ? ` (${driveError})` : '')
                            + '. Connect Drive and paste it again to archive it in the instance folder.');
                    if (!getDriveToken()) {
                        try { window.dispatchEvent(new CustomEvent('lab:connect-drive')); } catch { /* ignore */ }
                    }
                }
                document.execCommand('insertImage', false, imgSrc);
                onChange(editorRef.current.innerHTML);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(blob);
    };
    const handlePaste = (e) => {
        const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                insertImageBlob(items[i].getAsFile());
                break;
            }
        }
    };
    // Drag-and-dropped images are saved to Drive just like pasted ones.
    const handleDrop = (e) => {
        const file = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
            .find((f) => f.type && String(f.type).indexOf('image/') === 0);
        if (!file) return;
        e.preventDefault();
        insertImageBlob(file);
    };
    // When a queued (Drive-unavailable) pasted image is finally uploaded after
    // reconnection, replace its local data URL with the real Drive URL inside
    // the editor content, so the saved HTML references the archived file.
    useEffect(() => {
        const onPendingUploaded = (e) => {
            const detail = (e && e.detail) || {};
            if (!detail.id) return;
            const dataUrl = pendingPastesRef.current.get(detail.id);
            const driveUrl = detail.drive && detail.drive.driveUrl;
            if (!dataUrl || !driveUrl || !editorRef.current) return;
            const imgs = editorRef.current.querySelectorAll('img');
            let replaced = false;
            for (let i = 0; i < imgs.length; i++) {
                if (imgs[i].getAttribute('src') === dataUrl) {
                    imgs[i].setAttribute('src', getRenderableDriveUrl(driveUrl));
                    replaced = true;
                }
            }
            pendingPastesRef.current.delete(detail.id);
            if (replaced) {
                onChange(editorRef.current.innerHTML);
                setPasteNotice('✓ Image uploaded to Google Drive after reconnection — the Drive link replaced the local copy.');
            }
        };
        window.addEventListener('lab:pending-uploaded', onPendingUploaded);
        return () => window.removeEventListener('lab:pending-uploaded', onPendingUploaded);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // ---- Image resizing: clicking an inserted figure selects it ----
    const onEditorMouseUp = (e) => {
        storeSel();
        const t = e.target;
        if (!t || !editorRef.current || !editorRef.current.contains(t)) return;
        if (t.tagName === 'IMG') {
            editorRef.current.querySelectorAll('img.rte-img-sel').forEach((im) => im.classList.remove('rte-img-sel'));
            t.classList.add('rte-img-sel');
            setSelImg(t);
            const m = /([\d.]+)%/.exec(t.style.width || '');
            setSelImgW(m ? parseFloat(m[1]) : 100);
        } else {
            clearSelImg();
        }
    };
    const onEditorKeyDown = (e) => { if (e.key === 'Escape') clearSelImg(); };
    const applyImgWidth = (pct) => {
        const img = selImg;
        if (!img) return;
        if (pct >= 100) img.style.removeProperty('width');
        else img.style.width = pct + '%';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        setSelImgW(pct >= 100 ? 100 : pct);
        if (editorRef.current) onChange(editorRef.current.innerHTML);
    };
    return (
        <div className={`w-full ${fillHeight ? 'flex-1 min-h-0' : ''} flex flex-col border border-slate-300 rounded-md bg-white overflow-hidden shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500`}>
            <style>{`.rte-content a { color:#2563eb; text-decoration:underline; } .rte-content a:hover { color:#1d4ed8; } .rte-content img.rte-img-sel { outline: 2px solid #3b82f6; outline-offset: 2px; }`}</style>
            {!readOnly && toolbarOpen && (
            <div className="flex gap-1 p-1 bg-slate-50 border-b border-slate-200 shrink-0 flex-wrap">
                <button onClick={()=>execCmd('undo')} onMouseDown={keepFocus} title="Undo (Ctrl+Z)"
                        className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition font-bold">↩ Undo</button>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <button onClick={()=>execCmd('bold')} onMouseDown={keepFocus} className="font-bold px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition">B</button>
                <button onClick={()=>execCmd('italic')} onMouseDown={keepFocus} className="italic px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition">I</button>
                <button onClick={()=>execCmd('underline')} onMouseDown={keepFocus} className="underline px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition">U</button>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <button onClick={()=>execCmd('justifyLeft')} onMouseDown={keepFocus} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition" title="Align Left">↤</button>
                <button onClick={()=>execCmd('justifyCenter')} onMouseDown={keepFocus} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition" title="Center text">≡ Center</button>
                <button onClick={()=>execCmd('justifyFull')} onMouseDown={keepFocus} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition" title="Justify">▤</button>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <button onClick={()=>execCmd('insertUnorderedList')} onMouseDown={keepFocus} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition font-bold" title="Bullets">• List</button>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <select onChange={e=>execCmd('fontSize', e.target.value)} className="text-xs border border-slate-300 rounded px-1 bg-white text-slate-700 shadow-sm outline-none cursor-pointer">
                    <option value="3">Size...</option>
                    <option value="1">Small</option>
                    <option value="3">Normal</option>
                    <option value="5">Large</option>
                    <option value="7">Huge</option>
                </select>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <label className="flex items-center gap-1 text-xs text-slate-600 bg-white border border-slate-300 rounded shadow-sm px-1 cursor-pointer hover:bg-slate-100 transition">
                    <span>Color:</span>
                    <input type="color" className="w-4 h-4 p-0 border-none cursor-pointer" onChange={e => execCmd('foreColor', e.target.value)} />
                </label>
                {linkButton && (
                    <button onClick={openLinkModal} onMouseDown={keepFocus} title="Insert a link within the text"
                            className="px-2 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded shadow-sm text-xs font-bold transition">
                        🔗 Link
                    </button>
                )}
                {figureButton && (
                    <button onClick={() => setFigureDraft({ url: '', caption: '' })} onMouseDown={keepFocus} title="Insert an image with its caption within the text"
                            className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded shadow-sm text-xs font-bold transition">
                        🖼️ Figure
                    </button>
                )}
                {docImportButton && (
                    <>
                        <input ref={docImportRef} type="file" accept=".docx" onChange={handleDocImport} className="hidden" />
                        <button onClick={() => docImportRef.current && docImportRef.current.click()}
                                onMouseDown={keepFocus}
                                disabled={importingDoc}
                                title="Import a Word (.docx) document INTO THIS TEXT: text, tables and figures are converted (figures are saved to Google Drive). References are NOT imported here — to bring a whole manuscript with its bibliography and its numbered citations, use “📥 Import a manuscript” on the project page (it is the button right here in the toolbar of a project section)."
                                className="px-2 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded shadow-sm text-xs font-bold transition disabled:opacity-50">
                            {importingDoc ? '⏳ Importing…' : '📄 Word text'}
                        </button>
                    </>
                )}
                {toolbarExtra.map((btn, i) => (
                    <button key={i} type="button" onClick={() => btn.onClick(insertText)} onMouseDown={keepFocus} title={btn.title || btn.label}
                            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 rounded shadow-sm text-xs font-bold transition">
                        {btn.label}
                    </button>
                ))}
                <div className="flex-1"></div>
                <button type="button" onClick={() => setToolbarOpen(false)} onMouseDown={keepFocus}
                        title="Collapse toolbar (give more vertical space to the text)"
                        className="px-1.5 py-0.5 text-[10px] font-bold text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded shadow-sm transition">▴</button>
            </div>
            )}
            {pasteNotice && (
                <div className="flex items-start justify-between gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 shrink-0">
                    <span className="flex-1">{pasteNotice}</span>
                    <button type="button" onClick={() => setPasteNotice('')}
                            className="font-bold text-amber-500 hover:text-amber-700 px-1 text-xs" title="Dismiss">×</button>
                </div>
            )}
            {!readOnly && !toolbarOpen && (
            <div className="flex items-center justify-end px-1 py-0.5 bg-slate-50 border-b border-slate-200 shrink-0">
                <button type="button" onClick={() => setToolbarOpen(true)} onMouseDown={keepFocus}
                        title="Show toolbar"
                        className="px-1.5 py-0.5 text-[10px] font-bold text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded shadow-sm transition">▾ Show toolbar</button>
            </div>
            )}
            {!readOnly && selImg && (
                <div className="flex items-center gap-2 px-2 py-1 bg-blue-50 border-b border-blue-200 shrink-0 flex-wrap">
                    <span className="text-[10px] font-bold text-blue-700 uppercase">🖼 Image size</span>
                    <input type="range" min="15" max="100" step="5" value={selImgW}
                           onChange={(e) => applyImgWidth(parseInt(e.target.value, 10))}
                           className="w-32 accent-blue-600" title="Drag to resize the figure" />
                    <span className="text-[10px] font-bold text-blue-700 font-mono w-9">{selImgW}%</span>
                    {[25, 50, 75].map((p) => (
                        <button key={p} type="button" onClick={() => applyImgWidth(p)} onMouseDown={keepFocus}
                                className="text-[10px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-100 shadow-sm">{p}%</button>
                    ))}
                    <button type="button" onClick={() => applyImgWidth(100)} onMouseDown={keepFocus}
                            className="text-[10px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-100 shadow-sm">Full</button>
                    <span className="flex-1" />
                    <button type="button" onClick={clearSelImg} onMouseDown={keepFocus}
                            className="text-xs font-bold text-blue-500 hover:text-blue-700 underline">Done</button>
                </div>
            )}
            <div ref={editorRef} contentEditable={!readOnly} onPaste={handlePaste} onBlur={handleBlur}
                onSelect={storeSel} onKeyUp={storeSel} onMouseUp={onEditorMouseUp} onKeyDown={onEditorKeyDown} onFocus={handleEditFocus}
                onDrop={handleDrop}
                className={`p-3 text-sm text-slate-700 focus:outline-none custom-scrollbar shadow-inner bg-slate-50/50 rte-content ${fillHeight ? 'flex-1 min-h-0' : ''}`} style={{ resize: fillHeight ? 'none' : 'vertical', minHeight: toPx(minHeight), maxHeight: fillHeight ? 'none' : toPx(maxHeight), overflowY: 'auto' }} data-placeholder={placeholder} />
            {!readOnly && !fillHeight && resizable && (
                <div onMouseDown={startResize} title="Drag to resize the editor vertically"
                     className="shrink-0 h-3.5 flex items-center justify-center cursor-ns-resize select-none border-t border-slate-200 bg-slate-50 hover:bg-slate-200/70 transition-colors">
                    <span className="block w-12 h-1 rounded-full bg-slate-300" />
                </div>
            )}

            {linkDraft && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
                     style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
                     onMouseDown={(e) => { if (e.target === e.currentTarget) setLinkDraft(null); }}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-3"
                         onClick={(e) => e.stopPropagation()}>
                        <h4 className="text-sm font-black text-slate-800">🔗 Insert Link</h4>

                        <label className="text-[10px] font-bold text-slate-500 uppercase">Link text</label>
                        <input autoFocus type="text" value={linkDraft.text}
                               onChange={(e) => setLinkDraft({ ...linkDraft, text: e.target.value })}
                               placeholder="Visible text of the link"
                               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } }}
                               className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />

                        <label className="text-[10px] font-bold text-slate-500 uppercase">URL</label>
                        <input type="text" value={linkDraft.url}
                               onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })}
                               placeholder="https://..."
                               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } }}
                               className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />

                        <div className="flex justify-end gap-2 pt-1">
                            <button onClick={() => setLinkDraft(null)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors">
                                Cancel
                            </button>
                            <button onClick={insertLink}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-colors">
                                Insert Link
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {figureDraft && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
                     style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
                     onMouseDown={(e) => { if (e.target === e.currentTarget) setFigureDraft(null); }}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-3"
                         onClick={(e) => e.stopPropagation()}>
                        <h4 className="text-sm font-black text-slate-800">🖼️ Insert Figure</h4>

                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-emerald-700 uppercase">
                            Suggested file name (for Google Drive)
                          </span>

                          <div className="flex gap-1.5 items-center">
                            <input
                              readOnly
                              value={figureSuggestedName}
                              onFocus={(e) => e.target.select()}
                              className="flex-1 border border-emerald-300 rounded-lg px-2 py-1.5 text-xs font-mono bg-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => copyText(figureSuggestedName)}
                              className="px-2 py-1.5 text-[10px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                            >
                              Copy
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-emerald-700/80">
                              Save the file with this name in Drive, then paste its link below.
                            </span>
                            <button
                              type="button"
                              onClick={openDrive}
                              className="text-xs font-bold text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                            >
                              Open Drive ↗
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">
                              Folder
                            </span>
                            <input
                              type="text"
                              value={driveFolderDraft}
                              onChange={(e) => {
                                setDriveFolderDraft(e.target.value);
                                setDriveFolderUrl(e.target.value);
                              }}
                              placeholder="Paste a Drive folder URL to open it directly (optional)"
                              className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-blue-500 bg-white"
                            />
                          </div>
                        </div>

                        <label className="text-[10px] font-bold text-slate-500 uppercase">Image URL</label>
                        <input autoFocus type="text" value={figureDraft.url}
                               onChange={(e) => setFigureDraft({ ...figureDraft, url: e.target.value })}
                               placeholder="Paste image URL here (Google Drive, Dropbox, etc.)"
                               className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />

                        <DriveUploadButton
                          suggestedName={figureSuggestedName}
                          naming={{ ...(fileNaming || {}), title: figureSuffix }}
                          onDone={({ dataUrl, drive }) =>
                            setFigureDraft((d) => ({ ...d, url: drive ? drive.driveUrl : dataUrl }))
                          }
                          label="⬆ Upload from computer"
                        />

                        {figureDraft.url && String(figureDraft.url).trim() !== '' && (
                            <div className="relative h-40 rounded-md overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center">
                                <img src={getRenderableDriveUrl(String(figureDraft.url).trim())} alt="Preview" referrerPolicy="no-referrer"
                                     className="w-full h-full object-contain absolute inset-0"
                                     onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                <span className="text-[10px] text-slate-400 italic px-2">Preview unavailable</span>
                            </div>
                        )}

                        <label className="text-[10px] font-bold text-slate-500 uppercase">Caption</label>
                        <input type="text" value={figureDraft.caption}
                               onChange={(e) => setFigureDraft({ ...figureDraft, caption: e.target.value })}
                               placeholder="Figure caption (optional)"
                               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertFigure(); } }}
                               className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />

                        <div className="flex justify-end gap-2 pt-1">
                            <button onClick={() => setFigureDraft(null)}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors">
                                Cancel
                            </button>
                            <button onClick={insertFigure}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                                Insert Figure
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
