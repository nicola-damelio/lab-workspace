import fs from 'fs';
import { execSync } from 'child_process';

const git = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }); }
  catch (e) { return `ERR: ${e.message}`; }
};

const skel = (s) => s.replace(/[^\x20-\x7e]/g, '.');

const viewer = git('git --no-pager diff -U3 -- src/components/NMRMoleculeViewer.jsx');
fs.writeFileSync('_live_viewer_diff.txt', viewer, 'utf8');

const others = ['src/App.jsx', 'src/components/NMRSections.jsx', 'src/components/MDSections.jsx',
  'src/components/DockingSections.jsx', 'src/utils/mdAnalysis.js'];
fs.writeFileSync('_live_other_diff.txt',
  others.map((f) => `##### ${f}\n${skel(git(`git --no-pager diff -U2 -- "${f}"`))}`).join('\n'), 'utf8');

const out = [];
out.push(`viewer diff lines: ${viewer.split(/\r?\n/).length}`);
const added = viewer.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'));
out.push(`added lines: ${added.length}`);
out.push('');
out.push('########## viewer added lines (skeleton, 200 chars) ##########');
added.forEach((l, i) => out.push(`${i + 1}| ${skel(l.slice(1)).slice(0, 200)}`));
fs.writeFileSync('_live_viewer_added.txt', out.join('\n'), 'utf8');
console.log('ok');
