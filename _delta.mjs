// TEMPORARY probe: line diff between _wip_src.diff (snapshot) and the live working-tree diff
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }) } catch (e) { return 'ERR ' + e.message }
}
const norm = (s) => s.replace(/\r\n/g, '\n')
const A = norm(fs.readFileSync('_wip_src.diff', 'utf8')).split('\n')
const B = norm(run('git --no-pager diff -- src')).split('\n')

// LCS table
const n = A.length, m = B.length
const dp = new Uint32Array((n + 1) * (m + 1))
const at = (i, j) => dp[i * (m + 1) + j]
for (let i = n - 1; i >= 0; i--) {
  for (let j = m - 1; j >= 0; j--) {
    dp[i * (m + 1) + j] = A[i] === B[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  }
}
const ops = []
let i = 0, j = 0
while (i < n && j < m) {
  if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++ }
  else if (at(i + 1, j) >= at(i, j + 1)) { ops.push(['-', A[i]]); i++ }
  else { ops.push(['+', B[j]]); j++ }
}
while (i < n) ops.push(['-', A[i++]])
while (j < m) ops.push(['+', B[j++]])

const out = []
const CTX = 3
ops.forEach((op, k) => {
  if (op[0] === '=') return
  const from = Math.max(0, k - CTX), to = Math.min(ops.length - 1, k + CTX)
  out.push('--- @op ' + k + ' ---')
  for (let x = from; x <= to; x++) out.push(ops[x][0] + ' ' + ops[x][1])
  out.push('')
})
fs.writeFileSync('_delta.txt', 'wip lines ' + n + ' / current lines ' + m + '\n\n' + out.join('\n'), 'utf8')
console.log('ok ' + out.length)
