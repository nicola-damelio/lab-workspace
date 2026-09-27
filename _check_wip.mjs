// TEMPORARY probe: is the WIP diff fully applied to the working tree?
// 1) compare _wip_src.diff / _wip_tests.diff with the live diffs, decoding the
//    WIP snapshots (double-encoded cp850 -> utf8) so accents stop showing as noise.
// 2) list the plate / frame related lines of the WIP diff, so we can see whether
//    the ring-plate refresh was part of the batch and where it landed.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }) } catch (e) { return 'ERR ' + e.message }
}
const out = []

// --- attempt a cp850 reverse decoding of the WIP snapshots -------------------
let cp850 = null
try { cp850 = new TextDecoder('cp850') } catch { cp850 = null }
out.push('cp850 TextDecoder: ' + (cp850 ? 'available' : 'MISSING'))
if (cp850) out.push('0xC3 -> ' + JSON.stringify(cp850.decode(Uint8Array.of(0xc3))) + '  0xA9 -> ' + JSON.stringify(cp850.decode(Uint8Array.of(0xa9))))

const rev = new Map()
if (cp850) { for (let b = 0; b < 256; b++) rev.set(cp850.decode(Uint8Array.of(b)), b) }
const unfix = (s) => {
  if (!cp850) return s
  const bytes = []
  for (const ch of s) {
    if (ch.codePointAt(0) < 128) { bytes.push(ch.codePointAt(0)); continue }
    const b = rev.get(ch)
    if (b === undefined) return s // unknown char: give up, keep the raw text
    bytes.push(b)
  }
  try { return new TextDecoder('utf8', { fatal: true }).decode(Uint8Array.from(bytes)) } catch { return s }
}

const norm = (s) => s.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
const lines = (s) => norm(s).split('\n')

const cmp = (label, wipFile, liveCmd) => {
  const wipRaw = lines(fs.readFileSync(wipFile, 'utf8'))
  const wip = wipRaw.map(unfix)
  const live = lines(run(liveCmd))
  const A = wip, B = live
  const n = A.length, m = B.length
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i, j) => dp[i * (m + 1) + j]
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * (m + 1) + j] = A[i] === B[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++ }
    else if (at(i + 1, j) >= at(i, j + 1)) { ops.push(['-', A[i]]); i++ }
    else { ops.push(['+', B[j]]); j++ }
  }
  while (i < n) ops.push(['-', A[i++]])
  while (j < m) ops.push(['+', B[j++]])
  const bad = ops.filter(([k, t]) => k !== '=' && t.trim() !== '' && !/^(\+\+\+|---|diff --git|index )/.test(t))
  out.push('')
  out.push('=== ' + label + ' === wip ' + n + ' lines / live ' + m + ' lines / differing lines ' + bad.length)
  if (bad.length) {
    ops.forEach((op, k) => {
      if (op[0] === '=') return
      if (op[1].trim() === '' || /^(\+\+\+|---|diff --git|index )/.test(op[1])) return
      const from = Math.max(0, k - 2), to = Math.min(ops.length - 1, k + 2)
      out.push('--- differing @' + k + ' ---')
      for (let x = from; x <= to; x++) out.push(ops[x][0] + ' ' + ops[x][1])
      out.push('')
    })
  }
  return { wip: wipRaw, ops }
}

const src = cmp('SRC', '_wip_src.diff', 'git --no-pager diff -- src')
const tst = cmp('TESTS', '_wip_tests.diff', 'git --no-pager diff -- . ":(exclude)src"')

// --- plate / frame lines of the WIP snapshots -------------------------------
const interesting = (label, arr) => {
  out.push('')
  out.push('=== ' + label + ' plate/frame lines ===')
  arr.forEach((l, k) => {
    if (/(currentFrame|setCurrentFrame|plaque|Plate|plate|ringPlate|MeshBuffer|BufferRepresentation|frame)/.test(l)) {
      out.push(String(k + 1).padStart(5) + ': ' + l.slice(0, 200))
    }
  })
}
interesting('WIP SRC', src.wip)
interesting('WIP TESTS', tst.wip)

fs.writeFileSync('_wipcheck.txt', out.join('\n'), 'utf8')
console.log('wrote _wipcheck.txt, lines ' + out.length)
