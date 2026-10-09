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

setTimeout(() => send({ phase: 'boot', after: 9000, painted: boot.painted(), rootKids: boot.rootKids(), screen: boot.screen(), errs: ERRS.slice() }), 9000);
setInterval(() => send({ phase: 'tick', painted: boot.painted(), rootKids: boot.rootKids(), screen: boot.screen(), hrefs: HREF.slice(), errs: ERRS.slice() }), 2500);
