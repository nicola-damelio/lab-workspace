/* =========================================================================
   structureRestraints.js — LES DISTANCES DU 🧬, ENREGISTRÉES DANS UN FICHIER.

   La demande, mot pour mot : « Allow to save/upload from file the distance
   constraints in the structure calculation section. »

   Le panneau 🧬 du viewer tient une LISTE de distances (la table du calcul de
   structure : deux atomes, une cible en ångströms). Cette liste vit dans l'état
   React du viewer, donc elle disparaît dès que la page est rechargée — et une
   liste qu'on ne peut pas relire ne sert qu'une fois. Ce module PUR est le
   format de fichier : il ÉCRIT la liste (une ligne par distance, trois colonnes,
   lisible à l'œil) et il la RELIT (tolérant, mais jamais devin : une ligne qu'il
   n'a pas comprise est RENDUE comme telle, elle n'est pas jetée en silence).

   ⚠ CE MODULE NE CONNAÎT NI LA MOLÉCULE NI LE VIEWER : il ne fait que des
   chaînes. La résolution de « ALA 12 CA » sur la structure à l'écran reste au
   viewer (c'est lui qui lit des atomes), et une colonne d'atome est rendue TELLE
   QU'ELLE pour être résolue là-bas.

   FORMAT (texte, UTF-8) :
     · les lignes qui commencent par « # » et les lignes vides sont des
       commentaires : écrites en tête par `restraintsToText`, IGNORÉES à la
       relecture ;
     · une distance par ligne, trois champs : ATOM A, ATOM B, CIBLE (Å) ;
     · ⚖ UN QUATRIÈME CHAMP FACULTATIF, ÉCRIT « w=2 », porte LE POIDS de la ligne —
       le même que la colonne ⚖ de la table (`k = k_NOE × poids`, un poids de 0
       rend la ligne inerte). Il est écrit SEULEMENT quand le poids n'est pas 1,
       donc une liste sans poids s'écrit exactement comme avant, et il se place
       AVANT OU APRÈS les autres champs : « w= » le nomme, il n'est donc jamais
       confondu avec une cible ni avec un nom d'atome ;
     · les champs sont séparés par une TABULATION (ce que ce module écrit), un
       « ; », un « , », un « | » ou DEUX ESPACES ou plus — jamais par une seule
       espace, parce qu'un nom d'atome en contient (« ALA 12 CA ») ;
     · la cible accepte la virgule décimale (« 6,20 ») ; un « # … » qui suit la
       ligne est un commentaire de fin de ligne.
   ========================================================================= */

/** L'extension et le type MIME du fichier écrit (le panneau les nomme). */
export const RESTRAINT_FILE_EXT = 'txt';
export const RESTRAINT_FILE_MIME = 'text/plain;charset=utf-8';

/** La tête écrite en commentaires : ce qu'est le fichier, et comment il se relit. */
export const RESTRAINT_FILE_HEADER = [
  '# Lab Workspace — distance constraints (viewer · 🧬 Structure calculation)',
  '# One distance per line: <atom A> <TAB> <atom B> <TAB> <target in Å>',
  '# An optional 4th field “w=2” carries the ⚖ weight of that line (its force constant',
  '# is k_NOE × weight; a weight of 0 keeps the line but makes it inert). It is written',
  '# only when the weight is not 1, so a table without weights stays a 3-column file.',
  '# Atom names are FREE TEXT, resolved on the molecule on screen when the file is loaded:',
  '#   ALA 12 CA   ·   12:CA   ·   CA12   ·   the raw file name   ·   #123 (atom number)',
  '# Lines starting with # and empty lines are ignored. A target may use a comma.',
];

/** LE POIDS D'UNE LIGNE, EN NOMBRE — `weight`, sinon 1 (le poids par défaut, celui qui
 *  laisse la ligne exactement comme avant la colonne ⚖). Le module ne borne pas le
 *  haut : `k = k_NOE × poids` est l'affaire du champ, pas du format. */
export const restraintWeightOf = (row = {}) => {
  const r = row && typeof row === 'object' ? row : {};
  const given = r.weight;
  /* ⚠ Le même garde que le champ : un booléen n'est pas un poids (voir
     `ffRestraintWeightOf`), et `false` ne doit pas valoir 0. */
  if (typeof given === 'boolean' || given == null || given === '') return 1;
  const w = Number(given);
  return Number.isFinite(w) && w >= 0 ? w : 1;
};

/** La ligne d'UNE distance — trois champs séparés par une tabulation. Une colonne
 *  d'atome vide n'est pas inventée : elle sort vide (le fichier se relit tel quel),
 *  et un atome résolu sans nom écrit sort par son NUMÉRO (« #123 »).
 *
 *  ⚖ …ET UN QUATRIÈME CHAMP « w=2 » QUAND LE POIDS N'EST PAS 1 : il est NOMMÉ (donc
 *  jamais pris pour une cible), il est écrit seulement quand il dit quelque chose, et
 *  une ligne sans poids sort exactement comme avant, au caractère près. */
export const restraintLineOf = (row = {}) => {
  const r = row && typeof row === 'object' ? row : {};
  const a = String(r.a || r.la || (Number.isInteger(r.i) ? `#${r.i}` : '') || '').trim();
  const b = String(r.b || r.lb || (Number.isInteger(r.j) ? `#${r.j}` : '') || '').trim();
  const target = Number(r.target);
  const weight = restraintWeightOf(r);
  const body = `${a}\t${b}\t${Number.isFinite(target) && target > 0 ? target.toFixed(2) : ''}`;
  return weight === 1 ? body : `${body}\tw=${weight}`;
};

/** LE FICHIER — la tête en commentaires, puis chaque distance, dans l'ordre de la
 *  table. `note` (une phrase) est écrite juste après la tête : c'est là que le
 *  viewer dit de quelle molécule la liste vient (une liste sans son origine serait
 *  une liste qu'on ne saurait plus réutiliser). Rend TOUJOURS un texte, même vide,
 *  et le nombre de distances écrites (l'appelant le dit à l'utilisateur). */
export const restraintsToText = ({ restraints = [], note = '' } = {}) => {
  const list = Array.from(restraints || []);
  const head = [...RESTRAINT_FILE_HEADER];
  const said = String(note || '').trim();
  if (said) head.push(`# ${said}`);
  head.push(`# ${list.length} distance${list.length === 1 ? '' : 's'}`);
  const body = list.map((row) => restraintLineOf(row));
  return { text: `${[...head, ...body].join('\n')}\n`, count: list.length };
};

/** LES CHAMPS D'UNE LIGNE, ou `null` quand elle n'en porte pas. Le « # » de fin de
 *  ligne est un commentaire (il ne coupe pas un nom d'atome : ceux-ci n'en ont pas).
 *
 *  ⚠ LA VIRGULE EST DEUX CHOSES — un séparateur (CSV) ET le séparateur décimal d'une
 *  cible (« 6,20 »). Les séparateurs FORTS (tabulation, « ; », « | », deux espaces)
 *  sont donc essayés d'abord, et la virgule seulement s'ils ne donnent qu'un champ ;
 *  dans ce cas, deux champs numériques voisins sont RECOLLÉS par un point, parce que
 *  « 6,20 » coupé en deux vaut 6,20 et non 20.
 *
 *  ⚖ LE POIDS (« w=2 ») EST RETIRÉ DES CHAMPS AVANT TOUTE AUTRE LECTURE — quoi qu'il
 *  arrive : un champ qui DIT ce qu'il est ne peut donc pas être pris pour une cible, ni
 *  pour un nom d'atome, et une ligne à quatre champs se relit comme la ligne à trois
 *  qu'elle prolonge. `weight` est `null` quand la ligne n'en porte pas (le défaut 1 est
 *  celui du champ), et `weightSay` dit POURQUOI un « w= » écrit n'a pas été lu — la
 *  ligne n'est pas jetée pour autant : sa distance, elle, est lue. */
export const restraintRowOf = (line) => {
  const raw = String(line == null ? '' : line);
  const body = raw.split('#')[0].trim();
  if (!body) return null;
  let fields = body.split(/\t|;|\||\s{2,}/).map((f) => f.trim()).filter(Boolean);
  const byComma = fields.length < 2;
  if (byComma) fields = body.split(',').map((f) => f.trim()).filter(Boolean);
  let weight = null;
  let weightSay = '';
  fields = fields.filter((f) => {
    if (!/^w\s*=/i.test(f)) return true;
    const v = Number(String(f).replace(/^w\s*=\s*/i, '').replace(',', '.'));
    if (Number.isFinite(v) && v >= 0) weight = v;
    else weightSay = `the ⚖ field “${f}” is not a weight (a number ≥ 0 was expected) — this line uses the default weight of 1`;
    return false;
  });
  if (fields.length < 2) return null;
  /* LA CIBLE — le dernier champ qui est un nombre positif, en partant de la fin
     (ainsi une colonne de plus, un « # » de tableau ou un commentaire collé ne font
     pas perdre la cible). Les champs AVANT elle sont les atomes. */
  let at = -1;
  let target = NaN;
  if (byComma && fields.length >= 3) {
    const glued = Number(`${String(fields[fields.length - 2]).replace(',', '.')}.${fields[fields.length - 1]}`);
    if (Number.isFinite(glued) && glued > 0) { at = fields.length - 2; target = glued; }
  }
  if (at < 0) {
    for (let i = fields.length - 1; i >= 1; i -= 1) {
      const n = Number(String(fields[i]).replace(',', '.'));
      if (Number.isFinite(n) && n > 0) { at = i; target = n; break; }
    }
  }
  if (at < 1) return null;
  const atoms = fields.slice(0, at);
  return {
    a: atoms[0] || '', b: atoms[1] || '', target: Number(target.toFixed(4)), weight, weightSay,
  };
};

/** CE QU'UN FICHIER DIT — `{ rows, count, skipped, weighted }`. `rows` porte des lignes
 *  PRÊTES À RÉSOUDRE (`{a, b, target, weight, line}` : deux textes d'atome, une cible,
 *  et le poids ⚖ quand la ligne en porte un), `count` leur nombre, `weighted` combien
 *  d'entre elles portent un poids écrit, et `skipped` chaque ligne qui n'a pas été
 *  comprise, avec son numéro et sa raison — jamais un silence : une liste tronquée sans
 *  le dire ferait rater la moitié d'un calcul sans que personne ne le sache. */
export const restraintsFromText = (text) => {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const rows = [];
  const skipped = [];
  lines.forEach((line, i) => {
    const t = String(line || '').trim();
    if (!t || t.startsWith('#')) return;
    const row = restraintRowOf(t);
    if (!row) {
      skipped.push({ line: i + 1, text: t, say: 'no usable target — a line is “atom A  atom B  target in Å”' });
      return;
    }
    rows.push({ ...row, line: i + 1 });
  });
  return {
    rows, count: rows.length, skipped,
    weighted: rows.filter((r) => r.weight != null).length,
  };
};
