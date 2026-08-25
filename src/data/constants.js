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

// --- CONSTANTS & CONFIGURATIONS ---
export const PLATES_DEF = {
    '96': { rows: 8, cols: 12 }, '48': { rows: 6, cols: 8 }, '24': { rows: 4, cols: 6 },
    '12': { rows: 3, cols: 4 }, '6':  { rows: 2, cols: 3 }, '1':  { rows: 1, cols: 1 },
    '9x9box': { rows: 9, cols: 9 }
};

export const BOX_ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const DEF_COMPOUNDS = ["p53H","p53R","MycH","MycR","BadH","BadR","BidH","BidR","Nutlin","Doxo","PBS","cells","medium"];
export const DEF_CELL_LINES = ["U2OS", "A549", "MCF-7", "HEK293", "Fibroblasts", "HeLa", "HCT116"];

// --- NMR DATABASE & UTILS ---
export const AMINO_ACID_DB = {
    'A': { name: 'Alanine', code3: 'Ala', atoms: ['HN', 'Hα', 'Hβ'], ranges: { 'HN': {min: 7.8, max: 8.6}, 'Hα': {min: 4.0, max: 4.5}, 'Hβ': {min: 1.2, max: 1.5} }, cosy: [['HN','Hα'], ['Hα','Hβ']], spinSystems: [['HN', 'Hα', 'Hβ']] },
    'C': { name: 'Cystéine', code3: 'Cys', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { 'HN': {min: 7.9, max: 8.7}, 'Hα': {min: 4.4, max: 4.8}, 'Hβ1': {min: 2.8, max: 3.3}, 'Hβ2': {min: 2.8, max: 3.3} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
    'D': { name: 'Acide Aspartique', code3: 'Asp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.5, max: 2.9}, 'Hβ2': {min: 2.5, max: 2.9} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
    'E': { name: 'Acide Glutamique', code3: 'Glu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ'], ranges: { 'HN': {min: 8.0, max: 8.7}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ': {min: 2.1, max: 2.5} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ']] },
    'F': { name: 'Phénylalanine', code3: 'Phe', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε', 'Hζ'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.9, max: 3.3}, 'Hβ2': {min: 2.9, max: 3.3}, 'Hδ': {min: 7.1, max: 7.4}, 'Hε': {min: 7.2, max: 7.5}, 'Hζ': {min: 7.1, max: 7.4} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ','Hε'], ['Hε','Hζ']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε', 'Hζ']] },
    'G': { name: 'Glycine', code3: 'Gly', atoms: ['HN', 'Hα1', 'Hα2'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα1': {min: 3.8, max: 4.1}, 'Hα2': {min: 3.8, max: 4.1} }, cosy: [['HN','Hα1'], ['HN','Hα2'], ['Hα1','Hα2']], spinSystems: [['HN', 'Hα1', 'Hα2']] },
    'H': { name: 'Histidine', code3: 'His', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ2', 'Hε1'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.5, max: 5.0}, 'Hβ1': {min: 3.0, max: 3.4}, 'Hβ2': {min: 3.0, max: 3.4}, 'Hδ2': {min: 6.9, max: 7.3}, 'Hε1': {min: 7.6, max: 8.1} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ2','Hε1']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']] },
    'I': { name: 'Isoleucine', code3: 'Ile', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1'], ranges: { 'HN': {min: 7.7, max: 8.5}, 'Hα': {min: 4.0, max: 4.4}, 'Hβ': {min: 1.7, max: 2.0}, 'Hγ1': {min: 1.1, max: 1.6}, 'Hγ2': {min: 0.8, max: 1.1}, 'Hδ1': {min: 0.7, max: 1.0} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ1'], ['Hβ','Hγ2'], ['Hγ1','Hδ1']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1']] },
    'K': { name: 'Lysine', code3: 'Lys', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε', 'Hζ(NH3)'], ranges: { 'HN': {min: 7.9, max: 8.6}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.6, max: 1.9}, 'Hγ': {min: 1.3, max: 1.6}, 'Hδ': {min: 1.5, max: 1.8}, 'Hε': {min: 2.8, max: 3.2}, 'Hζ(NH3)': {min: 7.2, max: 7.6} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hγ','Hδ'], ['Hδ','Hε'], ['Hε','Hζ(NH3)']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ['Hζ(NH3)']] },
    'L': { name: 'Leucine', code3: 'Leu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2'], ranges: { 'HN': {min: 7.9, max: 8.5}, 'Hα': {min: 4.2, max: 4.7}, 'Hβ': {min: 1.5, max: 1.9}, 'Hγ': {min: 1.4, max: 1.8}, 'Hδ1': {min: 0.8, max: 1.0}, 'Hδ2': {min: 0.8, max: 1.0} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hγ','Hδ1'], ['Hγ','Hδ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2']] },
    'M': { name: 'Méthionine', code3: 'Met', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε(CH3)'], ranges: { 'HN': {min: 7.9, max: 8.6}, 'Hα': {min: 4.3, max: 4.7}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ': {min: 2.4, max: 2.7}, 'Hε(CH3)': {min: 2.0, max: 2.2} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε(CH3)']] },
    'N': { name: 'Asparagine', code3: 'Asn', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ21', 'Hδ22'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.6, max: 3.0}, 'Hβ2': {min: 2.6, max: 3.0}, 'Hδ21': {min: 6.8, max: 7.2}, 'Hδ22': {min: 7.4, max: 7.8} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ21','Hδ22']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']] },
    'P': { name: 'Proline', code3: 'Pro', atoms: ['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2'], ranges: { 'Hα': {min: 4.2, max: 4.6}, 'Hβ1': {min: 1.8, max: 2.4}, 'Hβ2': {min: 1.8, max: 2.4}, 'Hγ1': {min: 1.8, max: 2.1}, 'Hγ2': {min: 1.8, max: 2.1}, 'Hδ1': {min: 3.4, max: 3.8}, 'Hδ2': {min: 3.4, max: 3.8} }, cosy: [['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hβ1','Hγ1'], ['Hβ2','Hγ2'], ['Hγ1','Hγ2'], ['Hγ1','Hδ1'], ['Hγ2','Hδ2'], ['Hδ1','Hδ2']], spinSystems: [['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2']] }, 
    'Q': { name: 'Glutamine', code3: 'Gln', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε21', 'Hε22'], ranges: { 'HN': {min: 8.0, max: 8.6}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ': {min: 2.2, max: 2.6}, 'Hε21': {min: 6.7, max: 7.1}, 'Hε22': {min: 7.3, max: 7.7} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hε21','Hε22']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε21', 'Hε22']] },
    'R': { name: 'Arginine', code3: 'Arg', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ranges: { 'HN': {min: 8.0, max: 8.6}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.6, max: 2.0}, 'Hγ': {min: 1.4, max: 1.8}, 'Hδ': {min: 3.0, max: 3.3}, 'Hε': {min: 7.0, max: 7.4} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hγ','Hδ'], ['Hδ','Hε']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ'], ['Hε']] },
    'S': { name: 'Sérine', code3: 'Ser', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { 'HN': {min: 8.0, max: 8.6}, 'Hα': {min: 4.3, max: 4.8}, 'Hβ1': {min: 3.7, max: 4.0}, 'Hβ2': {min: 3.7, max: 4.0} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
    'T': { name: 'Thréonine', code3: 'Thr', atoms: ['HN', 'Hα', 'Hβ', 'Hγ2'], ranges: { 'HN': {min: 7.8, max: 8.5}, 'Hα': {min: 4.2, max: 4.6}, 'Hβ': {min: 4.0, max: 4.4}, 'Hγ2': {min: 1.0, max: 1.3} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ2']] },
    'V': { name: 'Valine', code3: 'Val', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2'], ranges: { 'HN': {min: 7.8, max: 8.5}, 'Hα': {min: 4.0, max: 4.4}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ1': {min: 0.8, max: 1.1}, 'Hγ2': {min: 0.8, max: 1.1} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ1'], ['Hβ','Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2']] },
    'W': { name: 'Tryptophane', code3: 'Trp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ1', 'Hε3', 'Hζ2', 'Hη2', 'Hζ3'], ranges: { 'HN': {min: 7.9, max: 8.7}, 'Hα': {min: 4.5, max: 5.0}, 'Hβ1': {min: 3.1, max: 3.5}, 'Hβ2': {min: 3.1, max: 3.5}, 'Hδ1': {min: 10.0, max: 10.5}, 'Hε3': {min: 7.4, max: 7.7}, 'Hζ2': {min: 7.3, max: 7.6}, 'Hη2': {min: 7.0, max: 7.3}, 'Hζ3': {min: 6.9, max: 7.2} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ1','Hε3'], ['Hε3','Hζ3'], ['Hζ3','Hη2'], ['Hη2','Hζ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ1'], ['Hε3', 'Hζ3', 'Hη2', 'Hζ2']] },
    'Y': { name: 'Tyrosine', code3: 'Tyr', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε'], ranges: { 'HN': {min: 7.9, max: 8.7}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.8, max: 3.2}, 'Hβ2': {min: 2.8, max: 3.2}, 'Hδ': {min: 6.9, max: 7.2}, 'Hε': {min: 6.6, max: 6.9} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ','Hε']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε']] }
};

export const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#6366f1'];

// Generiamo gli array all'avvio del file
export const TICKS_1H = Array.from({length: 111}, (_, i) => parseFloat((i / 10).toFixed(1))); 
export const TICKS_13C = Array.from({length: 281}, (_, i) => parseFloat((10 + i * 0.5).toFixed(1))); 

export const getNMRFillColor = (entry) => { 
    if (entry.colorClass === 'cosy') return '#22c55e'; 
    if (entry.colorClass === 'tocsyDirect') return '#1e3a8a'; 
    if (entry.colorClass === 'tocsyRelay') return '#3b82f6'; 
    if (entry.colorClass === 'noesyIntra') return '#ef4444'; 
    if (entry.colorClass === 'noesyIntra4') return '#fca5a5'; 
    if (entry.colorClass === 'noesySeq') return '#991b1b'; 
    if (entry.colorClass === 'hsqc') return '#8b5cf6'; 
    return '#cbd5e1'; 
};

export const getCarbonName = (char, atom) => {
    if (atom.startsWith('HN') || atom.startsWith('NH') || atom.includes('NH3') || (atom === 'Hε' && char === 'R')) return null;
    let cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C'); 
    if (atom.includes('CH3')) return atom.replace('H', 'C');
    return cName;
};

export const getProtonCount = (char, atom) => {
    if (char === 'A' && atom === 'Hβ') return 3;
    if (char === 'V' && (atom === 'Hγ1' || atom === 'Hγ2')) return 3;
    if (char === 'L' && (atom === 'Hδ1' || atom === 'Hδ2')) return 3;
    if (char === 'I' && (atom === 'Hγ2' || atom === 'Hδ1')) return 3;
    if (char === 'T' && atom === 'Hγ2') return 3;
    if (char === 'M' && atom === 'Hε(CH3)') return 3;
    return 1;
};

export const getPascalRow = (n) => {
    if (n === 0) return [1];
    let row = [1];
    for (let i = 0; i < n; i++) {
        let nextRow = [1];
        for (let j = 0; j < row.length - 1; j++) nextRow.push(row[j] + row[j+1]);
        nextRow.push(1);
        row = nextRow;
    }
    return row;
};

export const getCarbonRange = (char, cName) => {
    if (!cName) return {min: 40, max: 50};
    if (cName.includes('Cα')) return {min: 50, max: 65};
    if (cName.includes('Cβ')) return (char === 'S' || char === 'T') ? {min: 60, max: 70} : {min: 25, max: 45};
    if (cName.includes('Cγ')) return (['V','I','T'].includes(char)) ? {min: 15, max: 25} : {min: 25, max: 35};
    if (cName.includes('Cδ')) return (['F','Y','W','H'].includes(char)) ? {min: 110, max: 135} : {min: 20, max: 50};
    if (cName.includes('Cε')) return (['F','Y','W','H'].includes(char)) ? {min: 110, max: 135} : {min: 25, max: 45};
    if (cName.includes('Cζ') || cName.includes('Cη')) return {min: 110, max: 135};
    return {min: 40, max: 50}; 
};

export const getHexagon = (cx, cy, r, dir) => {
    const pts = []; const baseAngle = dir === 1 ? -Math.PI/2 : Math.PI/2;
    for(let i=0; i<6; i++) pts.push({ x: cx + r * Math.cos(baseAngle + i * (Math.PI/3) * dir), y: cy + r * Math.sin(baseAngle + i * (Math.PI/3) * dir) });
    return pts;
};

export const getPentagon = (cx, cy, r, dir) => {
    const pts = []; const baseAngle = dir === 1 ? -Math.PI/2 : Math.PI/2;
    for(let i=0; i<5; i++) pts.push({ x: cx + r * Math.cos(baseAngle + i * (2*Math.PI/5) * dir), y: cy + r * Math.sin(baseAngle + i * (2*Math.PI/5) * dir) });
    return pts;
};

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
