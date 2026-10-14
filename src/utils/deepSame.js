/* ============================================================================
   src/utils/deepSame.js — « EST-CE LA MÊME CHOSE ? » SANS RIEN FABRIQUER.

   POURQUOI CE MODULE EXISTE
   `App.jsx` compare la liste des expériences à CHAQUE changement pour savoir
   s'il faut empiler un pas d'historique (undo/redo) : il le faisait avec
   `JSON.stringify(next) !== JSON.stringify(prev)`. Deux chaînes de la taille du
   dataset étaient donc ALLOUÉES à chaque frappe et à chaque clic qui touche une
   fiche. Mesuré sur cette machine (sonde `_save_in_background_test.mjs`, mesure
   jetable rejouée le 2026-10-14) :

     | payload `tests` | deux `JSON.stringify` | `deepSame` |
     |---|---|---|
     | 6,0 Mo  | 41 ms  | 0,00 ms |
     | 26,5 Mo | 125 ms | 0,00 ms |

   Ces dizaines de millisecondes sont du travail sur le FIL PRINCIPAL, souvent au
   moment précis où une page s'ouvre — d'où le rapport « quando clicco su un test
   non si apre subito ».

   POURQUOI ELLE EST PRESQUE GRATUITE
   Les `map` du programme gardent les fiches qu'elles ne touchent pas : les
   valeurs inchangées sont les MÊMES RÉFÉRENCES. La comparaison s'arrête donc à
   la première différence ET court-circuite sur l'identité, au lieu d'écrire tout
   le dataset en texte pour le relire.

   LES RÈGLES (celles de `JSON.stringify`, ni plus ni moins — c'est ce que la
   comparaison remplace) :
     · deux valeurs identiques (`===`) sont égales ; `NaN` vaut `NaN` (comme
       `JSON.stringify`, qui écrit `null`) ;
     · `null` n'est jamais un objet : `null` ≠ `{}` ;
     · un tableau n'est égal qu'à un tableau, de même longueur, dans l'ordre, et
       `undefined` y compte comme `null` (c'est ce que `JSON.stringify` écrit) ;
     · deux objets ne sont égaux qu'avec le même ensemble de clés PROPRES
       énumérables et des valeurs deux à deux égales ; une clé de valeur
       `undefined` est ABSENTE (ce que `JSON.stringify` omet) ;
     · tout objet qui n'est pas un objet simple (Date, Map, classe…) repasse par
       `JSON.stringify` : la comparaison ne peut donc pas mentir sur un type
       exotique, et le chemin rapide reste celui des données JSON du programme.
   ========================================================================= */

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/* Le repli des valeurs exotiques : la même réponse que le geste remplacé. */
const sameJsonText = (a, b) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false; // cycles, BigInt… : on ne prétend pas qu'elles sont égales
  }
};

/** Les clés propres énumérables dont la valeur n'est pas `undefined`. */
const definedKeys = (obj) => {
  const out = [];
  for (const k of Object.keys(obj)) if (obj[k] !== undefined) out.push(k);
  return out;
};

/** Les valeurs que `JSON.stringify` écrit `null` : `null` lui-même, `NaN` et les
 *  infinis (c'est ce qui rend deux valeurs « écrites pareil » non distinctes). */
const isJsonNullish = (value) => value === null || (typeof value === 'number' && !Number.isFinite(value));

/** Vrai quand `a` et `b` portent exactement la même donnée JSON. PUR. */
export const deepSame = (a, b) => {
  if (a === b) return true;
  /* `undefined` d'un côté : `JSON.stringify` omet la clé (objet) ou écrit `null`
     (tableau) — c'est `definedKeys` / l'appelant qui en décide, ici on refuse. */
  if (a === undefined || b === undefined) return false;
  /* `null`, `NaN`, `Infinity` s'écrivent tous `null` : indistinguables en JSON. */
  if (isJsonNullish(a) || isJsonNullish(b)) return isJsonNullish(a) && isJsonNullish(b);
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (!aIsArray && (!isPlainObject(a) || !isPlainObject(b))) return sameJsonText(a, b);
  if (aIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      /* `undefined` dans un tableau s'écrit `null` : les deux formes sont la
         même donnée pour `JSON.stringify`. */
      const av = a[i] === undefined ? null : a[i];
      const bv = b[i] === undefined ? null : b[i];
      if (!deepSame(av, bv)) return false;
    }
    return true;
  }
  const ka = definedKeys(a);
  const kb = definedKeys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || b[k] === undefined) return false;
    if (!deepSame(a[k], b[k])) return false;
  }
  return true;
};

export default deepSame;
