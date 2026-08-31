// Scratch sanity-check for the docking import changes (parseTomlSimple,
// extractDockedMolecules and the molecule PDB resolution logic used by
// handleCalcDir in DockingSections.jsx). Run with: node _docking_sanity.cjs
const fs = require('fs');
const out = [];
const log = (line) => { out.push(line); };

const src = fs.readFileSync('src/components/DockingData.jsx', 'utf8');

const extractFn = (name) => {
  const re = new RegExp('export const ' + name + ' = [\\s\\S]*?\\n};');
  const m = src.match(re);
  if (!m) throw new Error('Could not extract ' + name);
  return m[0].replace(/^export\s+/, '');
};

const code = extractFn('parseTomlSimple') + '\n' + extractFn('extractDockedMolecules');
const { parseTomlSimple, extractDockedMolecules } = new Function(code + ' return { parseTomlSimple, extractDockedMolecules };')();

// ---- 1) parse a realistic HADDOCK 2.4 raw_input.toml ------------------------
const rawToml = `# HADDOCK run parameters
# Parameters are stored in the TOML format
run_dir = "run1"
job_id = "pizza"
seed = 42

[parameters]
structures_it0 = 1000
structures_it1 = 200
structures_w = 200
sampling = 1000
waterrefine = true
randorien = true
mdsteps_rigid = 0

# We have 2 molecules
[[molecules]]
name = "receptor"
pdb = "receptor.pdb"
segid = "A"
automatic = true
  ncs = "off"
[[molecules]]
name = "ligand"
pdb = "ligand.pdb.gz"
segid = "B"
automatic = true
`;

const toml = parseTomlSimple(rawToml);
const molecules = extractDockedMolecules(toml);
log('--- parseTomlSimple ---');
log('top: ' + JSON.stringify(toml.top));
log('sections: ' + JSON.stringify(toml.sections));
log('tables: ' + JSON.stringify(toml.tables));
log('--- extractDockedMolecules ---');
log(JSON.stringify(molecules, null, 2));

if (!toml.tables || !Array.isArray(toml.tables.molecules) || toml.tables.molecules.length !== 2) {
  throw new Error('FAIL: expected tables.molecules to have 2 entries');
}
if (molecules.length !== 2 || molecules[0].name !== 'receptor' || molecules[0].pdb !== 'receptor.pdb' || molecules[1].pdb !== 'ligand.pdb.gz') {
  throw new Error('FAIL: unexpected molecule extraction: ' + JSON.stringify(molecules));
}

// ---- 2) molecule PDB resolution (same logic as handleCalcDir) ---------------
const lower = (s) => String(s || '').toLowerCase();
const list = [
  { name: 'capri_ss.tsv', webkitRelativePath: 'run1/9_caprieval/capri_ss.tsv' },
  { name: 'raw_input.toml', webkitRelativePath: 'run1/data/configurations/raw_input.toml' },
  { name: 'receptor.pdb', webkitRelativePath: 'run1/data/0_topoaa/receptor.pdb' },
  { name: 'ligand.pdb', webkitRelativePath: 'run1/data/ligand.pdb' },
  { name: 'receptor.pdb', webkitRelativePath: 'run1/data/structures/receptor.pdb' }, // duplicate (should NOT win vs 0_topoaa)
  { name: 'cluster_1.pdb', webkitRelativePath: 'run1/8_seletopclusts/cluster_1.pdb' },
  { name: 'cluster_2.pdb.gz', webkitRelativePath: 'run1/8_seletopclusts/cluster_2.pdb.gz' }
];

const resolveMolFile = (pdb) => {
  const wanted = String(pdb || '').toLowerCase().replace(/\.gz$/i, '');
  const candidates = list.filter((f) => {
    const rel = lower(f.webkitRelativePath || f.name);
    const base = String(rel).split('/').pop().replace(/\.gz$/i, '');
    return base === wanted;
  });
  const dirScore = (rel) => (rel.includes('/0_topoaa/') ? 0 : rel.includes('/data/') ? 1 : 2);
  candidates.sort((a, b) => dirScore(lower(a.webkitRelativePath || a.name)) - dirScore(lower(b.webkitRelativePath || b.name)));
  return candidates[0] || null;
};

const rec = resolveMolFile(molecules[0].pdb);
const lig = resolveMolFile(molecules[1].pdb);
log('--- resolution ---');
log('receptor -> ' + (rec && rec.webkitRelativePath));
log('ligand   -> ' + (lig && lig.webkitRelativePath));
if (!rec || rec.webkitRelativePath !== 'run1/data/0_topoaa/receptor.pdb') {
  throw new Error('FAIL: receptor should resolve to data/0_topoaa/receptor.pdb, got ' + (rec && rec.webkitRelativePath));
}
if (!lig || lig.webkitRelativePath !== 'run1/data/ligand.pdb') {
  throw new Error('FAIL: ligand should resolve to data/ligand.pdb, got ' + (lig && lig.webkitRelativePath));
}

// ---- 3) TOML broadened matcher used in handleCalcDir ------------------------
const tomlMatcher = /(^|\/)raw_input\.(toml|toml\.gz|toml\.bak)$/i;
const foundToml = list.find((f) => tomlMatcher.test(lower(f.webkitRelativePath || f.name)));
if (!foundToml) throw new Error('FAIL: broadened TOML matcher should find raw_input.toml');
log('--- toml matcher ---');
log('found: ' + foundToml.webkitRelativePath);

// ---- 4) PDB files list for viewer structures --------------------------------
const pdbFiles = list.filter((f) => /(^|\/)(8_)?seletopclusts?\/[^/]+\.(pdb|pdb\.gz)$/i.test(lower(f.webkitRelativePath || f.name)));
log('--- 8_seletopclusts PDBs ---');
log(pdbFiles.map((f) => f.webkitRelativePath).join('\n'));
if (pdbFiles.length !== 2) throw new Error('FAIL: expected 2 seletopclusts PDBs');

log('\nAll sanity checks passed ✔');
fs.writeFileSync('_sanity_out.txt', out.join('\n'), 'utf8');
process.exit(0);
