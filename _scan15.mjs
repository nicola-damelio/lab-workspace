import fs from 'fs';
import { execSync } from 'child_process';

const out = [];
const git = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }); }
  catch (e) { return `ERR: ${e.message}`; }
};

out.push('########## git ##########');
out.push('## status --porcelain');
out.push(git('git status --porcelain').slice(0, 4000));
out.push('## diff --stat (working tree vs HEAD)');
out.push(git('git diff --stat').slice(0, 4000));
out.push('## log -3 --oneline');
out.push(git('git --no-pager log -3 --oneline'));
out.push('## diff --numstat -- src');
out.push(git('git diff --numstat -- src').slice(0, 3000));

// ---- live-tree feature inventory -------------------------------------------
const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!/node_modules|\.git|dist|_ngl_src/.test(e.name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
};
const files = [...walk('src'), ...fs.readdirSync('.').filter((f) => /\.(mjs|js)$/.test(f) && !f.startsWith('_scan')).map((f) => f)];
const skel = (s) => s.replace(/[^\x20-\x7e]/g, '.');
const corpus = files.map((f) => ({ f, lines: fs.readFileSync(f, 'utf8').split(/\r?\n/) }));

const scan = (label, re, cap = 25) => {
  out.push('');
  out.push(`########## ${label} ##########`);
  let n = 0;
  corpus.forEach(({ f, lines }) => {
    lines.forEach((ln, i) => {
      if (re.test(ln)) {
        n += 1;
        if (n <= cap) out.push(`${f}:${i + 1}| ${skel(ln).slice(0, 165)}`);
      }
    });
  });
  out.push(`   total ${n}`);
};

scan('lipid type colouring', /lipidtype|lipid[ _-]?type|lab-lipid/i, 12);
scan('lab-lipid schemes', /lab-lipid/i, 12);
scan('fit-selected', /fit[ _-]?sele/i, 12);
scan('all-none styling window', /all\s*\/\s*none|allnone|ALL_NONE/i, 10);
scan('worldDeltaForScreen (per-molecule move)', /worldDeltaForScreen/, 8);
scan('sequence and structure group', /sequence and structure/i, 10);
scan('loadProgress util', /loadProgress|loadRep\./, 15);
scan('viewer settings persistence', /VIEWER_SETTINGS|viewerSettings|saveViewer/, 12);
scan('instanceKey / per-instance persistence', /instanceKey|instanceKeyOf/, 12);
scan('localStorage keys', /localStorage\.(set|get|remove)Item|_[A-Z]*KEY\s*=\s*'/, 25);
scan('wheel wiring', /addEventListener\(\s*['"]wheel|onWheel|WHEEL_/, 15);
scan('shift xyz number fields', /shiftX|shiftY|shiftZ|Shift X|shift of/, 15);
scan('type="number"', /type="number"/, 25);
scan('setPosition / setExtraMolPosition', /setExtraMolPosition|setMainPosition|\.setPosition\(/, 15);

fs.writeFileSync('_live_scan15.txt', out.join('\n'), 'utf8');
console.log('ok');
