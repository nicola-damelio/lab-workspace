// TEMPORARY probe: runs the seven suspect suites in one pass, one node process each.
// usage: node _base7_run.mjs <outfile>
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const outFile = process.argv[2] || '_base7.txt'
const files = [
  '_docking_scatter_card_test.mjs',
  '_sequence_charge_test.mjs',
  '_cysteine_panel_layout_test.mjs',
  '_md_wall_test.mjs',
  '_viewer_keyframes_test.mjs',
  '_viewer_rings_gradient_test.mjs',
  '_recover_test_copies.mjs',
]

const lines = []
const fails = []
for (const f of files) {
  const t0 = Date.now()
  try {
    const out = execFileSync(process.execPath, [f], { encoding: 'utf8', timeout: 300000, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    const tail = String(out).trim().split('\n').slice(-2).join(' | ').slice(0, 160)
    lines.push(`PASS  ${f}  (${Date.now() - t0}ms)  ${tail}`)
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '')
    const tail = out.trim().split('\n').slice(-3).join(' | ').slice(0, 300)
    lines.push(`FAIL  ${f}  (${Date.now() - t0}ms)  status=${e.status}  ${tail}`)
    fails.push('######## ' + f + ' ########\n' + out)
  }
}
writeFileSync(outFile, lines.join('\n') + '\n', 'utf8')
writeFileSync(outFile.replace(/\.txt$/, '_fails.txt'), fails.join('\n\n'), 'utf8')
console.log('done ' + files.length + ' — failing ' + fails.length)
