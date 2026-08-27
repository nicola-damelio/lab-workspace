import React, { useRef, useEffect } from 'react';

export const RichTextEditor = ({ value, onChange, placeholder, toolbarExtra = [] }) => {
    const editorRef = useRef(null);
    const selRef = useRef(null);
    useEffect(() => { if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value || ''; }, [value]);
    const execCmd = (cmd, val=null) => { document.execCommand(cmd, false, val); onChange(editorRef.current.innerHTML); editorRef.current.focus(); };
    const storeSel = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editorRef.current && editorRef.current.contains(sel.anchorNode)) {
            selRef.current = sel.getRangeAt(0).cloneRange();
        }
    };
    // Insert text at the last caret position (used by toolbarExtra buttons, e.g. reference markers)
    const insertText = (text) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (selRef.current && el.contains(selRef.current.startContainer)) {
            sel.removeAllRanges();
            sel.addRange(selRef.current);
        }
        document.execCommand('insertText', false, text);
        onChange(el.innerHTML);
    };
    const handlePaste = (e) => {
        const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width; let height = img.height;
                        const MAX_WIDTH = 1200;
                        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                        canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                        document.execCommand('insertImage', false, dataUrl);
                        onChange(editorRef.current.innerHTML);
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(blob);
                break;
            }
        }
    };
    return (
        <div className="w-full flex-1 flex flex-col border border-slate-300 rounded-md bg-white overflow-hidden shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500">
            <div className="flex gap-1 p-1 bg-slate-50 border-b border-slate-200 shrink-0 flex-wrap">
                <button onClick={()=>execCmd('bold')} className="font-bold px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition">B</button>
                <button onClick={()=>execCmd('italic')} className="italic px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition">I</button>
                <button onClick={()=>execCmd('underline')} className="underline px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition">U</button>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <button onClick={()=>execCmd('justifyLeft')} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition" title="Align Left">↤</button>
                <button onClick={()=>execCmd('justifyCenter')} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition" title="Center">≡</button>
                <button onClick={()=>execCmd('justifyFull')} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition" title="Justify">▤</button>
                <div className="w-px bg-slate-300 mx-1 my-0.5"></div>
                <button onClick={()=>execCmd('insertUnorderedList')} className="px-2 py-0.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 text-xs text-slate-700 transition font-bold" title="Bullets">• List</button>
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
                {toolbarExtra.map((btn, i) => (
                    <button key={i} type="button" onClick={() => btn.onClick(insertText)} title={btn.title || btn.label}
                            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 rounded shadow-sm text-xs font-bold transition">
                        {btn.label}
                    </button>
                ))}
            </div>
            <div ref={editorRef} contentEditable onPaste={handlePaste} onBlur={e => onChange(e.target.innerHTML)}
                onSelect={storeSel} onKeyUp={storeSel} onMouseUp={storeSel} onFocus={storeSel}
                className="p-3 text-sm text-slate-700 focus:outline-none custom-scrollbar shadow-inner bg-slate-50/50" style={{ resize: 'vertical', minHeight: '120px', maxHeight: '500px', overflowY: 'auto' }} data-placeholder={placeholder} />
        </div>
    );
};
