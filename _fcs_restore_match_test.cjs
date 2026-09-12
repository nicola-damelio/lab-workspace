// Validates the FIX of "Restore from Drive" for flow cytometry: files were
// downloaded and parsed, the message said "Restored N .fcs file(s) …", but the
// data appeared on ANOTHER condition tab instead of the open one.
//
// The component (src/components/FlowCytometrySections.jsx, handleRestoreFromDrive)
// cannot be imported here (JSX module), so the two matching rules under test are
// mirrored verbatim. Keep them in sync with the component:
//   * sameStem()  – tolerant stem comparison (declared name VS archived Drive name)
//   * targetOf()  – which condition tab a downloaded Drive file belongs to
const sanitizeSlug = (s) => String(s || '')
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  .replace(/[\uFE0F\u200D]/g, '')
  .replace(/\s+/g, '_')
  .replace(/[^\w.-]+/g, '')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60);

const stemOf = (n) => String(n || '').replace(/\.[^/.]+$/, '').trim().toLowerCase();
const slugOf = (s) => sanitizeSlug(String(s || '')).toLowerCase();
const sameStem = (a, b) => {
  const x = slugOf(stemOf(a));
  const y = slugOf(stemOf(b));
  if (!x || !y) return false;
  return x === y || x.startsWith(y + '_') || y.startsWith(x + '_');
};

// `activeId` is the condition tab the user has open (the restore button lives
// there). OLD = the previous fallback (`return 0`), NEW = the fix (the active tab).
const targetOf = (cand, targets, activeId, mode) => {
  const candInstance = slugOf(cand.ctx && cand.ctx.instance);
  const candStem = stemOf(cand.ctx && cand.ctx.title) || stemOf(cand.name);
  if (candInstance) {
    const byInstance = targets.findIndex((x) => slugOf(x.instanceName) && slugOf(x.instanceName) === candInstance);
    if (byInstance >= 0) return byInstance;
    const byFile = targets.findIndex((x) => stemOf(x.fcsFileName) && (mode === 'new' ? sameStem(x.fcsFileName, candInstance) : stemOf(x.fcsFileName) === candInstance));
    if (byFile >= 0) return byFile;
    if (mode === 'new') {
      const byLabel = targets.findIndex((x) => stemOf(x.instanceName) && sameStem(x.instanceName, candInstance));
      if (byLabel >= 0) return byLabel;
    }
  }
  if (candStem) {
    const byFile = targets.findIndex((x) => stemOf(x.fcsFileName) && (mode === 'new' ? sameStem(x.fcsFileName, candStem) : stemOf(x.fcsFileName) === candStem));
    if (byFile >= 0) return byFile;
    const byExtra = targets.findIndex((x) => (x.fcExtraFiles || []).some((f) => f && (mode === 'new' ? sameStem(f.filename, candStem) : stemOf(f.filename) === candStem)));
    if (byExtra >= 0) return byExtra;
  }
  if (mode === 'new') {
    const activeIdx = targets.findIndex((x) => x && x.id === activeId);
    return activeIdx >= 0 ? activeIdx : 0;
  }
  return 0;
};

// ---- the experiment: three conditions, the user has the THIRD one open ----
const targets = [
  { id: 't1', instanceName: 'Sample 1', fcsFileName: 'Sample 1.fcs', fcExtraFiles: [] },
  { id: 't2', instanceName: 'Sample 1', fcsFileName: 'Sample 1.fcs', fcExtraFiles: [
    // An earlier restore overwrote this extra's declared name with the ARCHIVED
    // Drive name — the exact drift that broke the match afterwards.
    { id: 'x1', filename: 'Sample_2_Nic.fcs' }
  ] },
  { id: 't3', instanceName: 'Sample 3', fcsFileName: 'Sample 3.fcs', fcExtraFiles: [] }
];
const ACTIVE = 't3';

const labelOf = (i) => (i < 0 ? 'none' : `${targets[i].id} (${targets[i].instanceName})`);
const results = [];
const check = (name, got, want) => {
  const ok = got === want;
  results.push({ name, got: labelOf(got), want: labelOf(want), ok });
  return ok;
};
const checkBool = (name, got, want) => {
  const ok = got === want;
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};

// 1) A registry entry whose recorded context matches NO condition (old upload
//    without a title, a renamed condition, an upload from another computer).
const orphan = { name: 'Sample_9_Nic.fcs', ctx: { instance: 'Sample_9_Nic', title: '' } };
check('unmatched file → OLD fallback lands on the first tab', targetOf(orphan, targets, ACTIVE, 'old'), 0);
check('unmatched file → FIX lands on the open tab',            targetOf(orphan, targets, ACTIVE, 'new'), 2);

// 2) The extra spectrum of condition 2 whose stored name is the Drive name:
//    the declared stem ("Sample 2") only matches tolerantly.
const drifted = { name: 'Sample_2_Nic.fcs', ctx: { instance: 'Sample_2_Nic', title: 'Sample 2' } };
check('drifted extra name → OLD fallback lands on the first tab', targetOf(drifted, targets, ACTIVE, 'old'), 0);
check('drifted extra name → FIX lands on its own condition',      targetOf(drifted, targets, ACTIVE, 'new'), 1);

// 3) Negative control: two DIFFERENT conditions must never collapse into one.
checkBool('"Sample 20" is not "Sample 2"', sameStem('Sample 20.fcs', 'Sample 2'), false);
checkBool('exact declared name still matches', sameStem('Sample 3.fcs', 'Sample 3'), true);
checkBool('Drive name matches its declared name', sameStem('Sample_3_Nic.fcs', 'Sample 3.fcs'), true);

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
