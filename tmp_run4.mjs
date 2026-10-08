/* Relance les suites de l'espace de travail et écrit un résumé UTF-8
   (les redirections PowerShell écrivent en UTF-16 et abîment les accents).
   TEMPORAIRE. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const suites = [
  '_workspace_drive_test.mjs',
  '_workspace_keys_test.mjs',
  '_workspace_resync_test.mjs',
  '_workspace_resync_ui_test.mjs'
];

const out = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [s], { encoding: 'utf8', cwd: process.cwd() });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const verdicts = lines.filter((l) => /assertions?\s*(OK|K)/i.test(l) || /EXIT=|échou|fail/i.test(l));
  const last = lines.slice(-4);
  out.push(`########## ${s} — code=${r.status} lignes=${lines.length}`);
  out.push(...verdicts.slice(-6));
  if (!verdicts.length) out.push(...last);
  out.push('');
}
writeFileSync('tmp_doc_run.txt', out.join('\n'), 'utf8');
console.log('tmp_doc_run.txt écrit');
