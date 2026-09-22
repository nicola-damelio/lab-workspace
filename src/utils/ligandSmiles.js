/* =========================================================================
   ligandSmiles.js — LE SMILES D'UN LIGAND ORGANIQUE ÉCRIT DANS UN PDB.

   Un PDB standard ne contient AUCUNE chaîne SMILES : il ne nomme son ligand que
   par le CODE À 3 LETTRES de ses enregistrements HETATM (STI, ATP, JZ4…). Le
   SMILES vit donc là où le format le met : le Chemical Component Dictionary du
   RCSB, dont c'est exactement le rôle.

       GET https://data.rcsb.org/rest/v1/core/chemcomp/<CODE>

   renvoie (vérifié sur ATP) :
       rcsb_chem_comp_descriptor.SMILES         → le SMILES
       rcsb_chem_comp_descriptor.SMILES_stereo  → sa version stéréo
       chem_comp.name / .formula / .type        → le nom, la formule, le genre
   et, dans les réponses plus anciennes, une liste
   `pdbx_chem_comp_descriptor[]` d'objets { type: 'SMILES' | 'SMILES_CANONICAL',
   descriptor } — les deux formes sont lues (readCcdSmiles).

   Le fichier ne fait AUCUN calcul chimique : il lit le code du fichier, demande
   le SMILES au dictionnaire, et le garde en cache (mémoire + localStorage) — un
   même ligand n'est demandé qu'UNE fois par poste, et une réponse en cache
   continue de servir hors ligne. `fetch` est injectable, donc une suite de tests
   peut vérifier la logique sans réseau.
   ========================================================================= */

// The 3-letter codes that are NOT the organic molecule of a file: water, the
// crystallisation / MD additives and every single-atom ion. A code outside this
// list AND outside the polymer residues is what « the ligand » means.
export const LIGAND_EXCLUDED_CODES = new Set([
  // water (every spelling seen in PDB / MD files)
  'HOH', 'DOD', 'WAT', 'H2O', 'OH2', 'SOL', 'TIP', 'TIP3', 'TIP4', 'TIP5', 'SPC', 'SPCE', 'T3P', 'T4P', 'HHO',
  // ions / metals
  'NA', 'K', 'CL', 'BR', 'IOD', 'F', 'MG', 'CA', 'ZN', 'MN', 'FE', 'FE2', 'CU', 'CO', 'NI', 'LI', 'RB', 'CS',
  'SR', 'BA', 'CD', 'HG', 'PB', 'AL', 'CR', 'MO', 'V', 'SOD', 'CLA', 'POT', 'CAL', 'CES', 'LIT',
  // buffers, cryoprotectants, detergents, common additives
  'SO4', 'PO4', 'NO3', 'ACT', 'ACY', 'FMT', 'MES', 'TRS', 'HEP', 'EPE', 'BIS', 'CIT', 'TLA', 'MPD', 'GOL', 'EDO',
  'PEG', 'PG4', 'PGE', '1PE', 'P6G', 'DMS', 'DMSO', 'BME', 'DTV', 'DTU', 'TCE', 'AZI', 'SCN', 'NH4', 'CO3', 'BCT',
  'BOG', 'LDA', 'C8E', 'UNX', 'UNL', 'UNK',
]);

// A residue of a POLYMER is never « the organic ligand » — the sequence machinery
// already reports it (protein / DNA / RNA, the modified residues included).
const POLYMER_CODES = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER',
  'THR', 'TRP', 'TYR', 'VAL', 'MSE', 'SEC', 'PYL', 'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU',
]);

// The 3-letter code of a PDB HETATM record: columns 18-20 (1-based), i.e.
// slice(17, 20). A line shorter than that is not a record we can read.
export const codeOfHETATM = (line) => {
  const s = String(line || '');
  if (!/^HETATM/.test(s) || s.length < 20) return '';
  return s.slice(17, 20).trim().toUpperCase();
};

/**
 * Which LIGAND codes a PDB text carries, most frequent first.
 * Only HETATM records count (an ATOM record is a polymer), and the water / ion /
 * additive codes of LIGAND_EXCLUDED_CODES are skipped, so what is left IS the
 * organic molecule a file declares.
 * @param {string} text PDB / mmCIF-less text
 * @returns {{code: string, count: number}[]}
 */
export const ligandCodesFromPdbText = (text) => {
  const counts = new Map();
  String(text || '').split(/\r?\n/).forEach((line) => {
    const code = codeOfHETATM(line);
    if (!code) return;
    if (LIGAND_EXCLUDED_CODES.has(code) || POLYMER_CODES.has(code)) return;
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  return Array.from(counts, ([code, count]) => ({ code, count }))
    .sort((a, b) => (b.count - a.count) || a.code.localeCompare(b.code));
};

/**
 * The SMILES (and name / formula) inside a Chemical Component Dictionary answer.
 * Reads BOTH shapes of the RCSB API — the current
 * `rcsb_chem_comp_descriptor.SMILES` and the older
 * `pdbx_chem_comp_descriptor[]` list — and returns null when the payload holds
 * no usable SMILES (so a caller can say « the dictionary knows no SMILES for this
 * code » instead of showing an empty string).
 * @param {any} payload parsed JSON of /rest/v1/core/chemcomp/<CODE>
 * @returns {{smiles: string, stereo: string, name: string, formula: string, type: string}|null}
 */
export const readCcdSmiles = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const desc = (payload.rcsb_chem_comp_descriptor && typeof payload.rcsb_chem_comp_descriptor === 'object')
    ? payload.rcsb_chem_comp_descriptor
    : {};
  const list = Array.isArray(payload.pdbx_chem_comp_descriptor) ? payload.pdbx_chem_comp_descriptor : [];
  const fromList = (kind) => {
    const hit = list.find((d) => d && String(d.type || '').toUpperCase() === kind && d.descriptor);
    return hit ? String(hit.descriptor) : '';
  };
  const smiles = String(desc.SMILES || desc.smiles || fromList('SMILES') || '').trim();
  const stereo = String(desc.SMILES_stereo || desc.smiles_stereo || fromList('SMILES_CANONICAL') || '').trim();
  if (!smiles && !stereo) return null;
  const comp = (payload.chem_comp && typeof payload.chem_comp === 'object') ? payload.chem_comp : {};
  return {
    smiles: smiles || stereo,
    stereo,
    name: String(comp.name || '').trim(),
    formula: String(comp.formula || '').trim(),
    type: String(comp.type || '').trim(),
  };
};

/* ── Le DICTIONNAIRE, et son cache ───────────────────────────────────────────
   One code is asked ONCE per browser: the answer (SMILES + name + formula) is
   kept in memory AND in localStorage, so a page reload — or a laptop that goes
   offline — keeps showing the SMILES of a ligand it has already resolved. */
export const CCD_URL = 'https://data.rcsb.org/rest/v1/core/chemcomp/';
export const LIGAND_SMILES_KEY = 'labLigandSmiles';
const memory = new Map();

const readStore = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LIGAND_SMILES_KEY) || 'null');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch { return {}; }
};
const writeStore = (store) => {
  try { localStorage.setItem(LIGAND_SMILES_KEY, JSON.stringify(store)); } catch { /* quota / private mode */ }
};

/** The cached answer of ONE code, or null. */
export const cachedLigandSmiles = (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  if (memory.has(c)) return memory.get(c);
  const hit = readStore()[c];
  if (hit && hit.smiles) { memory.set(c, hit); return hit; }
  return null;
};

/** Remember ONE answer (used by the fetch AND by a caller that resolved it itself). */
export const rememberLigandSmiles = (code, info) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c || !info || !info.smiles) return null;
  const entry = { code: c, ...info };
  memory.set(c, entry);
  const store = readStore();
  store[c] = entry;
  writeStore(store);
  return entry;
};

/**
 * The SMILES of ONE Chemical Component Dictionary code, from the cache when it is
 * there, from the RCSB otherwise. Throws an Error with a readable message when
 * the code is unknown / the network is unreachable / the answer holds no SMILES —
 * the caller shows that message instead of an empty field.
 * @param {string} code 3-letter HETATM code (any case)
 * @param {{fetchImpl?: Function, timeoutMs?: number}} [opts] injectable fetch (tests)
 */
export const fetchLigandSmiles = async (code, opts = {}) => {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(c)) throw new Error(`"${code}" is not a chemical component code`);
  const hit = cachedLigandSmiles(c);
  if (hit) return hit;
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('no fetch available in this environment');
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 12000;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch { /* ignore */ } }, timeoutMs) : null;
  try {
    const res = await doFetch(`${CCD_URL}${encodeURIComponent(c)}`, {
      headers: { Accept: 'application/json' },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!res || !res.ok) throw new Error(`the RCSB dictionary does not know « ${c} » (HTTP ${res ? res.status : '?'})`);
    const info = readCcdSmiles(await res.json());
    if (!info) throw new Error(`the RCSB dictionary has no SMILES for « ${c} »`);
    return rememberLigandSmiles(c, { ...info, source: 'RCSB Chemical Component Dictionary' });
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * The SMILES of the ORGANIC LIGAND of a PDB text: the most frequent ligand code
 * first, then the others, until one of them resolves. Returns null when the file
 * declares no ligand at all (nothing to look up).
 * @param {string} text PDB text
 * @param {{fetchImpl?: Function, timeoutMs?: number}} [opts]
 * @returns {Promise<{code: string, count: number, smiles: string, name: string, formula: string, source: string}|null>}
 */
export const resolveLigandSmilesFromPdbText = async (text, opts = {}) => {
  const codes = ligandCodesFromPdbText(text);
  if (!codes.length) return null;
  const errors = [];
  for (const { code, count } of codes.slice(0, 4)) {
    try {
      const info = await fetchLigandSmiles(code, opts);
      return { ...info, code, count };
    } catch (e) {
      errors.push(`${code}: ${(e && e.message) || e}`);
    }
  }
  throw new Error(errors.join(' · ') || 'no ligand could be resolved');
};

