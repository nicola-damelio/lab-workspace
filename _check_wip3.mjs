/* TEMPORARY verification probe (not part of the app).
 *
 * Answers ONE question decisively: is every line of the WIP diff snapshots
 * (_wip_src.diff / _wip_tests.diff) present in the LIVE working-tree diff?
 *
 * The snapshots were written through a cp850 console, so their bytes are
 * double-encoded (cp850 -> utf8). TextDecoder has no 'ibm850' in this Node build
 * (it throws ERR_ENCODING_NOT_SUPPORTED), so:
 *   - the DECISIVE pass/fail test uses ASCII skeletons only: every cp850
 *     codepoint for a byte >= 0x80 is non-ASCII, so dropping every non-ASCII
 *     char from the mojibake leaves exactly the original ASCII skeleton.
 *     Mojibake can therefore never produce a false "not applied" / "applied".
 *   - the readable listing uses an embedded cp850 table (and a cp1252 table as
 *     an alternative), scored to pick whichever actually decodes.
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'

// ---- embedded cp850 high half (0x80..0xff) ---------------------------------
const CP850_HIGH =
  '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5' +
  '\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192' +
  '\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb' +
  '\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510' +
  '\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4' +
  '\u00f0\u00d0\u00ca\u00cb\u00c8\u0131\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580' +
  '\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4' +
  '\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0'

const CP1252_HIGH =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f' +
  '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178' +
  '\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af' +
  '\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf' +
  '\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf' +
  '\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df' +
  '\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef' +
  '\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff'

const buildTable = (high) => {
  const map = new Map()
  for (let i = 0; i < 128; i += 1) map.set(String.fromCharCode(i), i)
  for (let i = 0; i < 128; i += 1) map.set(high[i], 0x80 + i)
  return map
}

const undoWith = (table) => (s) => {
  const bytes = []
  for (const ch of s) {
    const b = table.get(ch)
    if (b === undefined) bytes.push(...Buffer.from(ch, 'utf8'))
    else bytes.push(b)
  }
  return Buffer.from(bytes).toString('utf8')
}

// ---- helpers --------------------------------------------------------------
// ASCII skeleton, WITHOUT any accent decomposition: `normalize('NFD')` would turn
// a cp850 mojibake 'Ã' into the LETTER 'A' (and 'Çö' into 'Co'), injecting ASCII
// characters that no real file contains — that is what produced the first run's
// false MISSING lines. Every byte >= 0x80 is one non-ASCII codepoint in cp850 AND
// in cp1252, so stripping the whole non-ASCII range always yields the skeleton of
// the real text. Newlines collapse into spaces, so re-wrapping a line is harmless.
const norm = (s) => s
  .replace(/\r/g, '')
  .replace(/[^\x20-\x7e]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const diffLines = (text) => text.replace(/\r/g, '').split('\n')
const added = (lines) => lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'))
const removed = (lines) => lines.filter((l) => l.startsWith('-') && !l.startsWith('---'))
const live = (path) => execSync(`git --no-pager diff -- "${path}"`, { maxBuffer: 1 << 30 }).toString('utf8')

const readability = (s) => {
  const good = (s.match(/[\x20-\x7e]/g) || []).length
  const weird = (s.match(/[\u0080-\u009f\u2500-\u25ff\u2017-\u201d]/g) || []).length
  return good - weird * 4
}

// ---- report ---------------------------------------------------------------
const report = (label, wipFile, livePath) => {
  const raw = fs.readFileSync(wipFile, 'utf8')
  const out = ['']
  out.push(`######## ${label} ########`)
  out.push(`snapshot ${wipFile}  ->  git diff -- "${livePath}"`)

  const liveText = live(livePath)
  const liveLines = diffLines(liveText)
  const liveSet = new Set(liveLines.map(norm).filter(Boolean))
  out.push(`live diff: ${liveLines.length} lines, ${liveSet.size} distinct ASCII skeletons`)

  // candidate decoders, best readability first (the DECISIVE test below does not
  // depend on this choice at all)
  const cands = [
    ['cp850-reversed', undoWith(buildTable(CP850_HIGH))],
    ['cp1252-reversed', undoWith(buildTable(CP1252_HIGH))],
    ['raw', (s) => s],
    ['latin1-to-utf8', (s) => Buffer.from(s, 'latin1').toString('utf8')],
  ].map(([name, fn]) => {
    let text = raw
    try { text = fn(raw) } catch { text = raw }
    return { name, text, score: readability(text) }
  }).sort((a, b) => b.score - a.score)

  // ---- DECISIVE: every snapshot line's ASCII skeleton must be in the live diff
  const lines = diffLines(raw)
  const plus = [...new Set(added(lines).map(norm).filter(Boolean))]
  const minus = [...new Set(removed(lines).map(norm).filter(Boolean))]
  const missingPlus = plus.filter((l) => !liveSet.has(l))
  const missingMinus = minus.filter((l) => !liveSet.has(l))
  out.push('')
  out.push(`-- DECISIVE (ascii skeletons): snapshot ${lines.length} lines | added ${plus.length} missing ${missingPlus.length} | removed ${minus.length} missing ${missingMinus.length}`)
  missingPlus.slice(0, 80).forEach((l) => out.push(`   MISSING + ${l}`))
  missingMinus.slice(0, 80).forEach((l) => out.push(`   MISSING - ${l}`))

  // A comment may legitimately be reworded after the snapshot was taken, and a
  // re-wrapped comment disappears from the diff without anything being lost: the
  // CODE lines, on the other hand, must be there word for word. This split tells
  // a real regression from prose.
  const isComment = (l) => /^\+\s*(\/\/|\/\*|\*)/.test(l)
  const hard = [...plus, ...minus].filter((l) => !isComment(l))
  const hardMissing = hard.filter((l) => !liveSet.has(l))
  out.push(`-- HARD (non-comment) lines ${hard.length}, missing ${hardMissing.length}`)
  hardMissing.slice(0, 60).forEach((l) => out.push(`   HARD MISSING ${l}`))

  // reverse direction: live added lines the snapshot never contained
  const snapSet = new Set([...plus, ...minus])
  const liveAdded = [...new Set(added(liveLines).map(norm).filter(Boolean))]
  const extraLive = liveAdded.filter((l) => !snapSet.has(l))
  out.push(`-- reverse: live added lines absent from the snapshot: ${extraLive.length}`)
  extraLive.slice(0, 40).forEach((l) => out.push(`   EXTRA + ${l}`))

  out.push('')
  out.push(`-- decoded as ${cands[0].name} (readability ${cands[0].score}; ` +
    cands.slice(1).map((c) => `${c.name} ${c.score}`).join(', ') + ')')
  diffLines(cands[0].text).forEach((l, i) => {
    if (l.startsWith('+') && !l.startsWith('+++') &&
        /plate|ring|frame|setFrame|currentFrame|trajector|Buffer|Mesh/i.test(l)) {
      out.push(`   ${i + 1}: ${l}`)
    }
  })
  return out
}

// ---- IN TREE: is the snapshot content physically there in the live files? -----
// `git diff` compares a REVISION state: once part of the batch has been committed
// (or a comment reworded / re-wrapped) the hunk leaves the diff while the feature
// is still in the tree. So the decisive test for "is the WIP applied?" is the live
// FILE CONTENT: every line the snapshot adds must be readable in the working tree,
// and every line it removes must be gone. norm() collapses whitespace, so a
// re-wrapped line still matches; only a real rewording can fail it.
const rootTests = fs.readdirSync('.').filter((f) => /^_.+\.(mjs|js|cjs)$/.test(f))
const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = `${dir}/${e.name}`
    if (e.isDirectory()) walk(f, acc)
    else if (/\.(jsx?|mjs)$/.test(e.name)) acc.push(f)
  }
  return acc
}
const srcFiles = walk('src')
const corpus = [...srcFiles, ...rootTests]
  .map((f) => { try { return norm(fs.readFileSync(f, 'utf8')) } catch { return '' } })
  .join(' | ')

const snapDiff = (f) => diffLines(fs.readFileSync(f, 'utf8'))
// the delta marker itself must NOT be part of the search key: the files do not
// contain it. (That was the second false-negative: 523 "absent" lines that were
// all present with a leading "+" glued on.)
const snapAdd = [...new Set([
  ...added(snapDiff('_wip_src.diff')),
  ...added(snapDiff('_wip_tests.diff')),
].map(norm).map((l) => l.replace(/^\+/, '')))]
const snapRem = [...new Set([
  ...removed(snapDiff('_wip_src.diff')),
  ...removed(snapDiff('_wip_tests.diff')),
].map(norm).map((l) => l.replace(/^-/, '')))]
const significant = (l) => l.trim().length >= 12
const absent = snapAdd.filter((l) => significant(l) && !corpus.includes(l))
const stillThere = snapRem.filter((l) => significant(l) && corpus.includes(l))

const out = [
  ...report('SRC', '_wip_src.diff', 'src/'),
  ...report('TESTS', '_wip_tests.diff', '.'),
]
out.push('')
out.push('######## IN TREE (working-tree file content vs the WIP snapshot) ########')
out.push(`corpus: ${srcFiles.length} src files + ${rootTests.length} root test files`)
out.push(`snapshot ADDED lines ${snapAdd.length}, significant ${snapAdd.filter(significant).length}, ABSENT from the live files ${absent.length}`)
absent.forEach((l) => out.push(`   ABSENT ${l}`))
out.push(`snapshot REMOVED lines ${snapRem.length}, significant ${snapRem.filter(significant).length}, STILL PRESENT in the live files ${stillThere.length}`)
stillThere.forEach((l) => out.push(`   STILL THERE ${l}`))

fs.writeFileSync('_wipcheck3.txt', out.join('\n'), 'utf8')
console.log(`wrote _wipcheck3.txt (${out.length} lines) | absent ${absent.length} | stillThere ${stillThere.length}`)


