/* _probe_cites.mjs — QUELLES formes de citation le bouton « 🔗 Link citations »
   sait-il transformer en liens ? (diagnostic du message « Nothing to link ») */
import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);

const RL = await import('./src/utils/referenceLinks.js');

const refs = [1, 2, 3, 12].map((n) => ({ id: `r${n}`, number: n, title: `Paper ${n}`, authors: 'Rossi M', year: '2018' }));
const numbers = RL.referenceNumbers(refs);

const cases = [
  ['bracketed single        ', '<p>as shown previously [12].</p>'],
  ['bracketed list          ', '<p>see [3,12] and [12; 3].</p>'],
  ['bracketed range known   ', '<p>see [1-3].</p>'],
  ['bracketed range unknown ', '<p>see [5-7].</p>'],
  ['bracket with 1 unknown  ', '<p>see [12,99].</p>'],
  ['parens single  (12)     ', '<p>as shown previously (12).</p>'],
  ['parens list    (3,12)   ', '<p>see (3,12).</p>'],
  ['parens range   (1-3)    ', '<p>see (1-3).</p>'],
  ['parens unknown (99)     ', '<p>see (99).</p>'],
  ['year in parens (2021)   ', '<p>published (2021) somewhere.</p>'],
  ['function sin(2)         ', '<p>amplitude sin(2) units.</p>'],
  ['HTML sup <sup>12</sup>  ', '<p>as shown previously<sup>12</sup>.</p>'],
  ['HTML sup m<sup>2</sup>  ', '<p>area in m<sup>2</sup>.</p>'],
  ['unicode superscript     ', '<p>as shown previously¹².</p>'],
  ['unicode sup unit m²     ', '<p>area in m².</p>'],
  ['unicode sup 10⁻³        ', '<p>diluted 10⁻³.</p>'],
  ['parens glued prev(12)   ', '<p>as previously(12) known.</p>'],
  ['parens after space      ', '<p>and (12) also.</p>'],
  ['parens after short word ', '<p>in (12) also.</p>'],
  ['HTML sup 2<sup>nd</sup> ', '<p>the 2<sup>nd</sup> time.</p>'],
  ['HTML sup list           ', '<p>see<sup>3,12</sup> now.</p>'],
  ['unicode sup ions Ca²⁺   ', '<p>ions Ca²⁺ here.</p>'],
  ['bare number             ', '<p>as shown previously 12.</p>'],
  ['bare number list        ', '<p>as shown previously 12,13.</p>'],
  ['author-year             ', '<p>as shown previously (Rossi et al., 2018).</p>'],
  ['already linked          ', '<p>see <a class="cite-ref" href="#ref-12" data-ref="12">12</a>.</p>']
];

for (const [label, html] of cases) {
  const out = RL.linkCitationNumbers(html, { numbers, hrefFor: (n) => `#ref-${n}` });
  const verdict = out === html ? 'NO  (rien à lier → message d\'erreur)' : 'YES (lien créé)';
  console.log(`${label} | ${verdict}`);
  if (out !== html) console.log(`                     → ${out}`);
}
