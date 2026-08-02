import React, { useState } from 'react';

export const TagInput = ({ tags, setTags, options, placeholder }) => {
    const [input, setInput] = useState('');
    const handleAdd = () => { const val = input.trim(); if (val && !tags.includes(val)) { setTags([...tags, val]); setInput(''); } };
    return (
        <div className="flex flex-col gap-1 w-full">
            <div className="flex gap-1 items-center">
                <input list={placeholder.replace(/\s/g,'')+"-list"} type="text" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAdd()} className="border border-slate-300 rounded p-1 text-xs flex-1 min-w-[100px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all" placeholder={placeholder}/>
                <button onClick={handleAdd} className="bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold px-2 py-1 rounded text-xs transition-colors">+</button>
            </div>
            {options && <datalist id={placeholder.replace(/\s/g,'')+"-list"}>{options.map(o=><option key={o} value={o}/>)}</datalist>}
            <div className="flex flex-wrap gap-1 mt-1">
                {tags.map(t=>(
                    <span key={t} className="bg-blue-50 border border-blue-200 text-blue-800 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                        {t} <button onClick={()=>setTags(tags.filter(x=>x!==t))} className="text-red-400 hover:text-red-600 font-bold">×</button>
                    </span>
                ))}
            </div>
        </div>
    );
};