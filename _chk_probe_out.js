/* ── la sonde : chaque faute, horodatée, avec la trace ─────────────────── */
const ERRS = [];
const push = (kind, text, extra) => ERRS.push(Object.assign({ t: Math.round(performance.now()), kind, text: String(text).slice(0, 400) }, extra || {}));
window.addEventListener('error', (e) => push('error', (e.message || 'error'), {
  file: String(e.filename || '').split('/').pop(), line: e.lineno, col: e.colno,
  stack: e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 4).join(' | ') : ''
}));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  push('rejection', (r && r.message) || r, { stack: r && r.stack ? String(r.stack).split('\n').slice(0, 4).join(' | ') : '' });
});
const origErr = console.error.bind(console);
console.error = (...a) => { push('console', a.map((x) => (x && x.message) || String(x)).join(' ')); origErr(...a); };

const label = (el) => (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const HREF = [];
const send = (payload) => {
  HREF.push(location.href);
  const body = JSON.stringify(Object.assign({ href: location.href }, payload));
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/report', new Blob([body], { type: 'text/plain' }))) return;
  } catch { /* repli */ }
  fetch('/report', { method: 'POST', body, keepalive: true }).catch(() => {});
};
const boot = {
  rootKids: () => (document.getElementById('root') ? document.getElementById('root').children.length : -1),
  screen: () => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
  painted: () => {
    const el = document.querySelector('[class~="bg-slate-50"]');
    return el ? Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height) : 'none';
  }
};

setTimeout(() => send({ phase: 'boot', after: 7000, painted: boot.painted(), rootKids: boot.rootKids(), screen: boot.screen(), errs: ERRS.slice() }), 7000);
setInterval(() => send({ phase: 'tick', painted: boot.painted(), rootKids: boot.rootKids(), screen: boot.screen(), hrefs: HREF.slice(), errs: ERRS.slice() }), 2500);

setTimeout(async () => {
  const clicked = [];
  const start = ERRS.length;
  const vis = (el) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 8;
  const targets = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(vis);
  const seen = new Set();
  for (const el of targets) {
    const lab = label(el);
    if (!lab || seen.has(lab)) continue;
    seen.add(lab);
    if (seen.size > 60) break;
    const before = ERRS.length;
    try { el.click(); } catch (e) { push('click-throw', lab + ' → ' + ((e && e.message) || e)); }
    await new Promise((r) => setTimeout(r, 500));
    clicked.push({ lab, newErrors: ERRS.slice(before).map((x) => x.text), painted: boot.painted() });
  }
  send({ phase: 'clicks', clicked, totalErrs: ERRS.length - start, errs: ERRS.slice(), labels: targets.map(label).slice(0, 60) });
}, 8500);
