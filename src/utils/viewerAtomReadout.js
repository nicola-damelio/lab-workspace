/* =========================================================================
   src/utils/viewerAtomReadout.js
   🔎 LA LECTURE D'UN ATOME SOUS LE CURSEUR — SON NOM, ET CE QU'IL PORTE.

   La demande : « when hovering on an atom display not only the name but also the
   charge. » Le NOM, le viewer le construit déjà (la convention NMR mappée quand la
   séquence le permet, sinon `RESNAME RESNO ATOMNAME`) ; ce module dit le SECOND
   morceau, la charge PARTIELLE de l'atome — et il ne la calcule pas : il met en
   forme le nombre que le viewer lui donne, c'est-à-dire celui de la table unique
   que les deux lectures qui la dessinent déjà partagent (⚡ ESP et « Color by →
   Atom charge », lue par `atomHoverChargeOf` / `espChargesFor`). Un survol ne peut
   donc pas annoncer autre chose que ce que la surface et la rampe peignent.

   PURE, comme tous les utils : ni NGL, ni React, ni état — un nombre entre, une
   phrase sort. Et une charge qui N'EXISTE PAS (une molécule dont ni le fichier ni
   NGL ne décrivent les charges, un atome sans index, un tableau absent) ne
   s'écrit pas : `atomChargeText(null)` rend une chaîne vide, `hoverAtomReadout`
   garde alors le seul nom. Inventer « 0 » pour un ligand muet serait mentir sur
   ce que le fichier dit — c'est la même règle que `atomChargeOf`, qui répond 0
   pour PEINDRE (le neutre est le bon repli d'une couleur) mais ne se raconte pas.
   ========================================================================= */

/** Les décimales de la charge affichée : 1/1000 e, la précision d'une table de
 *  charges (CHARMM donne par exemple −0.8 pour un O de carbonyle, +0.26 pour un
 *  amide H, −0.834 pour un O de TIP3P) — arrondir plus court effacerait un signe
 *  utile, arrondir plus long écrirait des chiffres que la table n'a pas. */
export const ATOM_CHARGE_DECIMALS = 3;

/**
 * La charge d'un atome, écrite pour être lue : `+0.256 e` · `−0.834 e` · `0.000 e`.
 * Aucun signe sur le zéro (un signe y serait un bruit), et le signe du négatif est
 * le VRAI signe moins typographique (−, U+2212), celui de tous les autres chiffres
 * de l'application.
 *
 * @param {number|null|undefined} q la charge partielle, en charge élémentaire
 * @returns {string} la charge écrite, ou '' quand il n'y a rien à écrire
 */
export const atomChargeText = (q) => {
  if (typeof q !== 'number' || !Number.isFinite(q)) return '';
  const p = 10 ** ATOM_CHARGE_DECIMALS;
  const v = Math.round(q * p) / p;   // arrondi AVANT le signe : −0.0004 n'écrit pas « −0.000 »
  const digits = Math.abs(v).toFixed(ATOM_CHARGE_DECIMALS);
  const sign = v > 0 ? '+' : (v < 0 ? '\u2212' : '');
  return `${sign}${digits} e`;
};

/**
 * LA PHRASE ENTIÈRE DU SURVOL : le nom de l'atome, puis sa charge quand il y en a
 * une. C'est exactement ce que le lecteur du viewer affiche — le nom seul quand la
 * table est muette, jamais un « q = » sans nombre.
 *
 * @param {string} label le nom déjà construit par le viewer
 * @param {number|null|undefined} q la charge partielle (null = rien à dire)
 * @returns {string}
 */
export const hoverAtomReadout = (label, q) => {
  const name = String(label == null ? '' : label).trim();
  const charge = atomChargeText(q);
  if (!charge) return name;
  return name ? `${name} · q = ${charge}` : `q = ${charge}`;
};
