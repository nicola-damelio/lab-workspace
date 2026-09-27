/* TEMPORARY verification probe (not part of the app).
 *
 * Answers ONE question decisively: is every line of the WIP diff snapshots
 * (_wip_src.diff / _wip_tests.diff) present in the LIVE working-tree diff?
 *
 * The snapshots were written through a cp850 console, so their bytes are
 * double-encoded (cp850 -> utf8). `TextDecoder('cp850')` throws (the WHATWG
 * label is 'ibm850'), so the reverse map is built from 'ibm850' instead, and
 * BOTH the raw and the reverse-decoded text are compared. Matching is done on
 * ASCII-normalised, trimmed lines, so mojibake can never create a false
 * "not applied".
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'

// ---- reverse cp850 map (ibm850 is the WHATWG label for cp850) --------------
const ibm850 = new TextDecoder('ibm850')
const rev = new Map()
for (let b = 0; b < 256; b += 1) rev.set(ibm850.decode(Uint8Array.of(b)), b)

const undo = (s) => {
  const bytes = []
  for (const ch of s) {
    const b = rev.get(ch)
    if (b === undefined) bytes.push(...Buffer.from(ch, 'utf8'))
    else bytes.push(b)
  }
  return Buffer.from(bytes).toString('utf8')
}

// ---- helpers --------------------------------------------------------------
const norm = (s) => s
  .replace(/\r/g, '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accents gone
  .replace(/[^\x20-\x7e]/g, '')                       // anything still non-ASCII gone
  .replace(/\s+/g, ' ')
  .trim()

const diffLines = (text) => text.replace(/\r/g, '').split('\n')

const added = (lines) => lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'))
const removed = (lines) => lines.filter((l) => l.startsWith('-') && !l.startsWith('---'))

const live = (path) => execSync(`git --no-pager diff -- "${path}"`, { maxBuffer: 1 << 30 }).toString('utf8')

const report = (label, wipFile, livePath) => {
  const raw = fs.readFileSync(wipFile, 'utf8')
  const out = ['']
  out.push(`######## ${label} ########`)
  out.push(`snapshot ${wipFile}  ->  git diff -- ${livePath}`)
  const liveText = live(livePath)
  const liveSet = new Set(diffLines(liveText).map(norm).filter(Boolean))

  for (const [how, text] of [['raw', raw], ['cp850-reversed', undo(raw)]]) {
    const lines = diffLines(text)
    const plus = added(lines).map(norm).filter(Boolean)
    const minus = removed(lines).map(norm).filter(Boolean)
    const missingPlus = plus.filter((l) => !liveSet.has(l))
    const missingMinus = minus.filter((l) => !liveSet.has(l))
    out.push('')
    out.push(`-- ${how}: ${lines.length} lines | added ${plus.length} (missing ${missingPlus.length}) | removed ${minus.length} (missing ${missingMinus.length})`)
    const dup = (arr) => [...new Set(arr)]
    dup(missingPlus).slice(0, 60).forEach((l) => out.push(`   MISSING + ${l}`))
    dup(missingMinus).slice(0, 60).forEach((l) => out.push(`   MISSING - ${l}`))
  }

  // which WIP added lines talk about plates / rings / frames at all
  out.push('')
  out.push('-- WIP added lines mentioning plate/ring/frame:')
  diffLines(undo(raw)).forEach((l, i) => {
    if (l.startsWith('+') && !l.startsWith('+++') && /plate|ring|frame|setFrame|currentFrame/i.test(l)) {
      out.push(`   ${i + 1}: ${l}`)
    }
  })
  return out
}

const out = [
  ...report('SRC', '_wip_src.diff', 'src/'),
  ...report('TESTS', '_wip_tests.diff', '.'),
]
fs.writeFileSync('_wipcheck2.txt', out.join('\n'), 'utf8')
console.log('wrote _wipcheck2.txt, lines ' + out.length)
