// Probe 12: the structure of the viewer file — component boundaries, refs, effects.
import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/);
const out = [];
const hits = (re) => {
  const r = [];
  src.forEach((l, i) => { if (re.test(l)) r.push((i + 1) + ': ' + l.trim().slice(0, 150)); });
  return r;
};
out.push('total lines: ' + src.length);
out.push('');
out.push('=== component / export / module-level function declarations ===');
hits(/^(export )?(default )?(function|const|let|var|class) |^export default/).forEach((l) => out.push(l));
out.push('');
out.push('=== useRef ===');
hits(/useRef\(/).forEach((l) => out.push(l));
out.push('');
out.push('=== useEffect (first 60) ===');
hits(/useEffect\(/).slice(0, 60).forEach((l) => out.push(l));
out.push('');
out.push('=== useCallback ===');
hits(/useCallback\(/).forEach((l) => out.push(l));
out.push('');
out.push('=== flagMeshShadows / nucleicRingPlates / requestSceneRepaint / trajRef / setFrameSafe ===');
hits(/const (flagMeshShadows|nucleicRingPlates|requestSceneRepaint|trajRef|setFrameSafe)|^(const|function) (flagMeshShadows|nucleicRingPlates|setFrameSafe)/).forEach((l) => out.push(l));
fs.writeFileSync('_t_struct.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
