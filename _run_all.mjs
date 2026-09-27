// TEMPORARY probe: run the standalone test scripts of this repo, one node process each.
// usage: node _run_all.mjs <outfile> [regexFilter]
import { readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const outFile = process.argv[2] || '_testrun.txt'
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null

const files = readdirSync('.')
  .filter(f => /\.(mjs|cjs)$/i.test(f) && /test/i.test(f) && !/^_run_all|^_state|^_idx|^_delta/.test(f))
  .filter(f => !filter || filter.test(f))
  .sort()

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
writeFileSync(outFile, lines.join('\n') + '\n\n===== ' + files.length + ' files, ' + lines.filter(l => l.startsWith('FAIL')).length + ' failing =====\n', 'utf8')
writeFileSync(outFile.replace(/\.txt$/, '_fails.txt'), fails.join('\n\n'), 'utf8')
console.log('done ' + files.length)
