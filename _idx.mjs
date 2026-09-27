// TEMPORARY probe: index the working-tree diff and the _wip_*.diff snapshots
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }) } catch (e) { return 'ERR ' + e.message }
}
const norm = (s) => s.replace(/\r\n/g, '\n')

const curSrc = norm(run('git --no-pager diff -- src'))
const curTests = norm(run('git --no-pager diff -- "_*.mjs"'))
fs.writeFileSync('_cur_src.diff', curSrc, 'utf8')
fs.writeFileSync('_cur_tests.diff', curTests, 'utf8')

const wipSrc = norm(fs.readFileSync('_wip_src.diff', 'utf8'))
const wipTests = norm(fs.readFileSync('_wip_tests.diff', 'utf8'))

const index = (label, text) => {
  const out = [label + '  (lines ' + text.split('\n').length + ')']
  text.split('\n').forEach(line => {
    if (/^(diff --git|@@)/.test(line)) out.push('  ' + line)
  })
  return out.join('\n')
}

fs.writeFileSync('_idx.txt', [
  index('===== WIP SRC (snapshot)', wipSrc),
  '',
  index('===== CURRENT SRC (working tree)', curSrc),
  '',
  index('===== WIP TESTS (snapshot)', wipTests),
  '',
  index('===== CURRENT TESTS (working tree)', curTests),
  '',
].join('\n'), 'utf8')
console.log('ok')
