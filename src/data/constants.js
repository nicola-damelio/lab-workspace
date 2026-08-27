import LZString from 'lz-string';

// --- FIREBASE CONFIGURATION ---
export const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AQ.Ab8RN6I7-6yNsQyx8f39A4YT6Hp5jNWxz2JCxq2ZEwJ5Zhy1aQ",
    authDomain: "cell-experiment-tracker.firebaseapp.com",
    projectId: "cell-experiment-tracker",
    storageBucket: "cell-experiment-tracker.firebasestorage.app",
    messagingSenderId: "855790481107",
    appId: "1:855790481107:web:a566455d3f13a48a20ae26"
};

export const LOCAL_STORAGE_KEY = 'lab_datasets_local_v2';

// --- GOOGLE DRIVE UPLOADS ---
// True "save to Google Drive" needs a Google Cloud OAuth client for this
// app's domain. To enable it, in Google Cloud Console:
//   1. Enable the "Google Drive API".
//   2. Create an OAuth 2.0 "Web application" client for this app's domain.
//   3. Add this scope to the OAuth consent screen:
//        https://www.googleapis.com/auth/drive.file
//   4. Paste the Client ID below.
// Empty = the standard Google sign-in cannot get Drive permission from
// Google, so uploaded files are stored locally (with a download option).
export const GOOGLE_DRIVE_CLIENT_ID = '763848765523-kvjohq6qv8oifb2n86ibh6m4vm4057ej.apps.googleusercontent.com';

// --- CONSTANTS & CONFIGURATIONS ---
export const PLATES_DEF = {
    '96': { rows: 8, cols: 12 }, '48': { rows: 6, cols: 8 }, '24': { rows: 4, cols: 6 },
    '12': { rows: 3, cols: 4 }, '6':  { rows: 2, cols: 3 }, '1':  { rows: 1, cols: 1 },
    '9x9box': { rows: 9, cols: 9 }
};

export const BOX_ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const DEF_COMPOUNDS = ["p53H","p53R","MycH","MycR","BadH","BadR","BidH","BidR","Nutlin","Doxo","PBS","cells","medium"];
export const DEF_CELL_LINES = ["U2OS", "A549", "MCF-7", "HEK293", "Fibroblasts", "HeLa", "HCT116"];

// --- MATH & FITTING UTILITIES (4PL) ---
export const fit4PL = (pts) => {
    const validPts = pts.filter(p => !isNaN(p.x) && !isNaN(p.y));
    if (validPts.length < 3) return null;
    
    const minX = Math.min(...validPts.map(p => p.x));
    const maxX = Math.max(...validPts.map(p => p.x));
    
    let bestIC50 = 1, bestH = 1, minErr = Infinity;
    
    for (let v = Math.log10(minX) - 2; v <= Math.log10(maxX) + 2; v += 0.2) {
        for (let h = 0.1; h <= 5; h += 0.2) {
            const ic50 = Math.pow(10, v);
            const e = validPts.reduce((s, p) => s + (p.w || 1) * Math.pow(p.y - (100 / (1 + Math.pow(p.x / ic50, h))), 2), 0);
            if (e < minErr) { minErr = e; bestIC50 = ic50; bestH = h; }
        }
    }
    
    const vb = Math.log10(bestIC50);
    for (let v = vb - 0.2; v <= vb + 0.2; v += 0.01) {
        for (let h = Math.max(0.01, bestH - 0.2); h <= bestH + 0.2; h += 0.01) {
            const ic50 = Math.pow(10, v);
            const e = validPts.reduce((s, p) => s + (p.w || 1) * Math.pow(p.y - (100 / (1 + Math.pow(p.x / ic50, h))), 2), 0);
            if (e < minErr) { minErr = e; bestIC50 = ic50; bestH = h; }
        }
    }
    
    let avg_sd = validPts.reduce((s, p) => s + (p.sd || 0), 0) / validPts.length;
    if (avg_sd === 0) {
        const sse = validPts.reduce((s, p) => s + Math.pow(p.y - (100 / (1 + Math.pow(p.x / bestIC50, bestH))), 2), 0);
        avg_sd = Math.sqrt(sse / Math.max(1, validPts.length - 2));
    }
    
    const slope = (25 * bestH) / bestIC50;
    const se = isFinite(avg_sd / slope) && (avg_sd / slope) >= 0 ? avg_sd / slope : 0;
    
    return { ic50: bestIC50, hill: bestH, se };
};

// --- CHART.JS ERROR BARS PLUGIN ---
export const errBarPlugin = {
    id: 'errBars',
    afterDatasetsDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        chart.data.datasets.forEach((ds, i) => {
            if (!ds.errorBars) return;
            const meta = chart.getDatasetMeta(i);
            if (meta.hidden) return;
            ctx.save();
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
            ctx.clip();
            ctx.lineWidth = 2; 
            ctx.strokeStyle = ds.borderColor || '#000';
            meta.data.forEach((el, idx) => {
                const eb = ds.errorBars[idx];
                if (!eb || (eb.plus === 0 && eb.minus === 0)) return;
                const xp = el.x;
                const yv = typeof ds.data[idx] === 'object' && ds.data[idx] !== null ? ds.data[idx].y : ds.data[idx];
                const yup = chart.scales.y.getPixelForValue(yv + eb.plus);
                const ydn = chart.scales.y.getPixelForValue(yv - eb.minus);
                ctx.beginPath();
                ctx.moveTo(xp, ydn); ctx.lineTo(xp, yup);
                ctx.moveTo(xp - 5, yup); ctx.lineTo(xp + 5, yup);
                ctx.moveTo(xp - 5, ydn); ctx.lineTo(xp + 5, ydn);
                ctx.stroke();
            });
            ctx.restore();
        });
    }
};

// --- COLOR PALETTES & UTILS ---
export const PALETTE = ['#0284c7','#16a34a','#ea580c','#9333ea','#dc2626','#0d9488','#c026d3','#65a30d','#0891b2','#ca8a04','#4f46e5','#e11d48'];
export const REGION_PALETTE = ['#ef4444', '#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f43f5e', '#3b82f6', '#84cc16'];

export function toHex(color) { if (!color) return '#888888'; if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase(); return color; }
export function lighten(hex, f) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return '#' + [r, g, b].map(ch => Math.round(ch + (255 - ch) * f).toString(16).padStart(2, '0')).join(''); }
export function darken(hex, f) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return '#' + [r, g, b].map(ch => Math.round(ch * (1 - f)).toString(16).padStart(2, '0')).join(''); }
export function needsDarkText(hex) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 160; }

export const getRegionColor = (regName) => {
    if (!regName || regName === 'Primary') return 'transparent';
    let hash = 0; 
    for(let i=0; i<regName.length; i++) hash = regName.charCodeAt(i) + ((hash << 5) - hash);
    return REGION_PALETTE[Math.abs(hash) % REGION_PALETTE.length];
};

export const formatConc = (val) => {
    if (typeof val !== 'number' || isNaN(val)) return '';
    if (val === 0) return "0";
    if (val >= 100) return Math.round(val).toString();
    const prec = parseFloat(val.toPrecision(3));
    if (Math.abs(prec) < 0.001) return prec.toExponential(2);
    return parseFloat(prec.toFixed(4)).toString();
};

export const concKey = realX => parseFloat(realX.toPrecision(9)).toString();

export const getDirectImageUrl = (url) => {
    try {
        if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
            const match = url.match(/[-\w]{25,}/);
            if (match) return `https://drive.google.com/thumbnail?id=${match[0]}&sz=w800`;
        }
        return url;
    } catch { return url; }
};

export const parsePayload = (exp) => {
    if (!exp || !exp.payload) return null;
    try {
        let pStr = exp.payload;
        if (exp.isCompressed || (!pStr.startsWith('{') && !pStr.startsWith('['))) {
            try { const dec = LZString.decompressFromUTF16(pStr); if (dec) pStr = dec; }
            catch(err) { console.error("Decompression fail", err); }
        }
        return JSON.parse(pStr);
    } catch { return null; }
};

export const fetchWithRetry = async (url, options, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                let detail = '';
                try { detail = (await res.clone().json())?.error?.message || ''; } catch {}
                throw new Error(`HTTP ${res.status}${detail ? ' - ' + detail : ''}`);
            }
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, delays[i]));
        }
    }
};
