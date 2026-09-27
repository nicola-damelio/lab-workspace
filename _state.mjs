// TEMPORARY probe: dump repo state into _state.txt (shell output capture is unreliable here)
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const out = []
const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch (e) { return 'ERR ' + e.message + '\n' + (e.stdout || '') }
}

out.push('===== git diff --stat (working tree vs HEAD) =====')
out.push(run('git --no-pager diff --stat'))
out.push('===== git status --porcelain =====')
out.push(run('git --no-pager status --porcelain'))

const src = run('git --no-pager diff -- src')
out.push('===== current working diff size src chars: ' + src.length)
const norm = (s) => s.replace(/\r\n/g, '\n')
const wip = fs.readFileSync('_wip_src.diff', 'utf8')
out.push('wip_src.diff chars: ' + wip.length)
out.push('identical(after CRLF normalisation): ' + (norm(src) === norm(wip)))

const wipTests = fs.readFileSync('_wip_tests.diff', 'utf8')
const tests = run('git --no-pager diff -- _app_page_window_test.mjs _dock_style_test.mjs _pymol_selections_test.mjs _viewer_color_settings_test.mjs _viewer_scheme_test.mjs _viewer_section_scope_test.mjs _viewer_ui_layout_test.mjs')
out.push('===== tests diff: current ' + tests.length + ' vs wip ' + wipTests.length + ' identical: ' + (norm(tests) === norm(wipTests)))

out.push('===== files tracked-modified =====')
out.push(run('git --no-pager diff --name-only'))

fs.writeFileSync('_state.txt', out.join('\n'), 'utf8')
console.log('written _state.txt')
