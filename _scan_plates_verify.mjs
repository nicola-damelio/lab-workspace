/* TEMPORARY probe: verify the ring-plate frame-follow refactor of the viewer.
   usage: node _scan_plates_verify.mjs                                  */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'

const VIEW = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n')
const lines = VIEW.split('\n')
const out = []

const report = (title, re) => {
  out.push(`=== ${title} ===`)
  lines.forEach((t, i) => { if (re.test(t)) out.push(`${i + 1}: ${t.trim().slice(0, 190)}`) })
  out.push('')
}

report('helpers', /const (markRingPlates|addRingPlateRep|refreshRingPlates|refreshScenePlates|hookStructurePlates) *=|hookStructurePlates\(/)
report('plate builders', /const (addPlates|addRingPlates) *=|addRingPlateRep\(|makePlates/)
report('MeshBuffer / buffer rep', /MeshBuffer|addBufferRepresentation/)
report('NG locals', /const NG =/)
report('__plates', /__plates/)
report('structure signals', /signals|refreshed|frameChanged/)

// Tests that touch any of these names.
const tests = readdirSync('.').filter((f) => /test.*\.(mjs|cjs)$/i.test(f))
const touched = []
for (const f of tests) {
  const t = readFileSync(f, 'utf8')
  const hits = []
  ;['addPlates', 'addRingPlates', 'nucleicRingPlates', 'MeshBuffer', 'addBufferRepresentation', '__plates', 'refreshRingPlates', 'addRingPlateRep']
    .forEach((n) => { if (t.includes(n)) hits.push(n) })
  if (hits.length) touched.push(`${f}: ${hits.join(', ')}`)
}
out.push('=== tests touching plate code ===')
out.push(...touched)
out.push('')

// Syntax check with the esbuild that vite already ships (JSX loader), if any.
let esbuild = null
try { esbuild = (await import('esbuild')).transformSync } catch { /* not installed */ }
if (esbuild) {
  try {
    esbuild(VIEW, { loader: 'jsx', jsx: 'automatic' })
    out.push('SYNTAX OK (esbuild jsx)')
  } catch (e) {
    out.push('SYNTAX FAIL: ' + String(e.message).slice(0, 1200))
  }
} else {
  out.push('esbuild not importable — no syntax check')
}
out.push(`viewer lines: ${lines.length}`)

writeFileSync('_t_plateverify.txt', out.join('\n'), 'utf8')
console.log('done')
