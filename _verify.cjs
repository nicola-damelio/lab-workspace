// Les trente-neuf suites du VIEWER 3D seul — les plus rapides à relancer après une
// retouche de src/components/NMRMoleculeViewer.jsx (l'ensemble du dépôt, c'est
// _run_all.cjs). _viewer_render_smoke_test.mjs est la SEULE ICI qui exécute un
// vrai rendu : elle construit son probe en SSR et monte la page docking, chaque
// section docking, le viewer et toutes les autres pages (c'est elle qui aurait
// attrapé le « Cannot access 'extraMols' before initialization » de la page
// docking). Résultat : EXIT + dernière ligne de chacune, sur la console et dans
// _verify.txt.
// Les DEUX garde-fous qui LISENT DE VRAIS PIXELS WebGL sont les derniers de la liste
// (_viewer_surface_seethrough_pixels_test.cjs et _viewer_ray_shadow_pixels_test.cjs) :
// ils ouvrent Chrome en --headless=new et rendent une vraie scène — c'est le premier
// qui a prouvé que SEE_THROUGH_SURFACE (`opaqueBack: false`) laisse vraiment voir le
// fond à travers la paroi arrière d'une surface translucide (luminance du centre
// 184.4 contre 161.9 pour le défaut NGL), et le second que les ombres du « ✨ Ray »
// se posent sur le dessin sans toucher UN SEUL pixel du fond blanc. ≈8 s et ≈15 s,
// et SAUTÉS (exit 0) sur une machine sans Chrome ni Edge.
const { spawnSync } = require('child_process');
const fs = require('fs');
const tests = [
  '_viewer_scheme_test.mjs', '_viewer_style_controls_test.mjs', '_viewer_ui_layout_test.mjs',
  '_viewer_rings_gradient_test.mjs', '_dock_style_test.mjs', '_large_system_style_test.mjs',
  '_viewer_color_settings_test.mjs', '_viewer_structure_classes_test.mjs',
  // « In the “molecule styling” window add a “color by” option: atom charge. » : la
  // rampe de la charge PARTIELLE de chaque atome (trois pastilles éditables de la
  // roue ⚙ : négatif · neutre · positif, ±1 e pleine échelle), la MÊME table de
  // charges que le ⚡ ESP (la charge du fichier, la table CHARMM de NGL pour une
  // protéine, la charge formelle d'un ion, l'estimation d'électronégativité des
  // hétéro-atomes), et le schéma maison lab-atom-charge, enregistré dans le VRAI
  // NGL et instancié sur une structure réellement parsée : cette suite EXÉCUTE la
  // rampe et le schéma (l'oxygène d'un ligand peint vers le rouge, un sodium vers
  // le bleu, un atome sans structure peint le NEUTRE), et vérifie que la liste
  // « Color by » de CHAQUE type de molécule — et son libellé — l'offrent, la barre
  // des sélections comprise. Sans le schéma maison, le repli est le colormaker
  // `partialcharge` de NGL, jamais un aplat d'éléments.
  '_viewer_atom_charge_test.mjs',
  // « in the section analysis of the viewer, add a button to display H-bonds. » et
  // « when hovering on an atom display not only the name but also the charge. » —
  // LES DEUX DEMANDES DE CETTE SESSION, mesurées d'un bout à l'autre : la règle des
  // ponts hydrogène est PURE (utils/hydrogenBonds.js) et EXÉCUTÉE sur des géométries
  // construites à la main (le N–H···O linéaire en est un, le donneur couché non ;
  // paires 1-2 et 1-3, même résidu et solvant écartés ; le mode « lourds » sans
  // aucun hydrogène, le plafond du dessin), puis appliquée à une VRAIE structure
  // parsée par le NGL de la page ; le bouton de 📏 Analysis est vérifié par ses
  // marqueurs — il ne dessine qu'UNE représentation `distance` pour TOUS les ponts,
  // et `clearHydrogenBonds()` accompagne CHAQUE `clearMeasurements()` du viewer ; et
  // le survol écrit le nom PUIS la charge, lue dans la MÊME table que le ⚡ ESP
  // (helpers EXTRAITS puis EXÉCUTÉS sur la structure), une molécule sans charges ne
  // disant rien de plus au lieu d'annoncer « 0 ».
  '_viewer_hbonds_test.mjs',
  // LA DEMANDE « styling window » DE CETTE SESSION, mesurée d'un bout à l'autre :
  // une teinte par TYPE peint l'ESPACE de la barre de style — et les rangées de cet
  // espace s'éclaircissent vers le blanc, General d'abord — toutes deux des pastilles
  // de la roue ⚙, persistées comme les autres palettes ; la roue n'est plus répétée
  // en tête de chaque espace (il n'en reste qu'une, celle de l'en-tête de la fenêtre) ;
  // l'espace « SELECTED » est bâti par le MÊME catalogue qu'une molécule (une section
  // synthétique par type présent, aucune seconde implémentation) ; et les trois
  // palettes ÉTENUES de la roue — trois pastilles par classe de lipide (tête ·
  // glycérol · chaînes acyle), deux par base (la base · son sucre), deux par résidu
  // (squelette · chaînes latérales) — remplacent les grilles redondantes qu'il ne
  // fallait plus offrir (« the color of aminoacids is defined in "the 20 residues"
  // and for the two subgroups (backbone and chain) in "backbone (B) / side chains
  // (S)". In this case the first is obsolete (only two colors have to be defined). »).
  // Les helpers PURS de la roue y sont EXTRAITS puis EXÉCUTÉS, le JSX vérifié par
  // ses marqueurs : c'est cette suite qui rougit si l'on ressuscite une des deux
  // grilles retirées ou si l'on rouvre un second ⚙ dans un espace.
  '_viewer_selected_space_test.mjs',
  // Le ✔ de la barre « Molecules · styling » EFFACE vraiment la molécule (le
  // bug : le rendu comparait la clé locale d'une section à un ensemble d'ids).
  '_viewer_section_visibility_test.mjs',
  // Le REBUILD de la structure principale laisse UNE seule série de
  // représentations, et la liste qui la suit est complète : le double appel
  // d'addDefaultReps laissait une copie orpheline dans la scène — une molécule
  // décochée restait dessinée et une surface ne partait plus (le rapport :
  // « hide still does not hide », « there is no way to remove a surface »).
  '_viewer_main_reps_ownership_test.mjs',
  // Les CINQ défauts du dernier rapport : le paragraphe de §2 dessiné au milieu du
  // viewer (un commentaire de bloc écrit NU entre deux éléments JSX), le rainbow
  // sans colorMaker NGL, les deux couleurs « first → last » que plus rien ne
  // pouvait changer, les chaînes latérales flottantes (CB–CA jamais dessiné) et le
  // 🔢 renumérotation qui n'ouvrait rien et ne changeait rien.
  '_viewer_report_fixes_test.mjs',
  // Les couleurs de la 2° structure sont ÉDITABLES partout où elles se choisissent :
  // la rangée « Color by » de la barre de style, le menu §2 (dont le bouton ouvrait
  // un panneau 🎨 qui n'existe plus) et une section À ELLE dans la roue ⚙ (le
  // rapport : « colors for secondary structure definition are not present in the
  // setting wheel »).
  '_viewer_sstruc_colors_test.mjs',
  // Les SIX défauts du rapport « styling window » : la barre de style d'un GRAND
  // système (protéines + phospholipides + eau) s'ouvrait VIDE, la rangée d'un
  // ligand offrait « Sugar type », la couleur des chaînes ne se définissait nulle
  // part, le potentiel électrostatique d'un ligand n'était pas calculé, le dégradé
  // était mesuré après le dessin (et écrasé d'une molécule à l'autre) et un
  // changement sur la rangée GENERAL devait mettre les parties de la molécule sur
  // « Hide ».
  '_viewer_style_gaps_test.mjs',
  // Les DEUX suites qui EXÉCUTENT `sectionStyleReps`/`buildSectionReps` (le rendu
  // réel, pas une lecture de la source) et qui manquaient ici : une retouche du
  // viewer qui casse la traduction d'un style y casse une extraction — c'est ce qui
  // est arrivé au drapeau SEE_THROUGH_SURFACE (`opaqueBack: false` sur les
  // surfaces), absent de leur liste d'extraction (`ReferenceError` immédiat).
  // `_viewer_general_row_test.mjs` est aussi celle qui vérifie la cascade de la
  // rangée General jusqu'à la surface, opaqueBack compris.
  '_viewer_general_row_test.mjs', '_viewer_style_coverage_test.mjs',
  // CE QUE LA RANGÉE GENERAL DESSINE, règle par règle, EXÉCUTÉE sur une protéine de
  // quatre résidus : le geste de l'utilisateur — « General en ball and stick = la
  // molécule entière en ball and stick ; puis Lines sur les chaînes latérales → les
  // billes/bâtons disparaissent pour les SEULES chaînes latérales ». Une sous-rangée
  // qui a son PROPRE style (`follow: false`) l'emporte sur General pour exactement les
  // atomes qu'elle dessine (`generalCession` / `partAtomsHeldBack`) ; une enveloppe
  // (surface · mesh, un seul objet) ne cède pas ; l'atome qu'un voisin ne dessinerait
  // plus reste à General ; un parcours ne se coupe pas (General → cartoon garde son
  // ruban quand le squelette est CACHÉ) ; et quand les parties ont tout pris, la rangée
  // n'est pas construite du tout (la panne « nothing is displayed »). La suite rejoue
  // aussi la règle sur une version d'avant : elle y est ROUGE.
  '_viewer_general_cession_test.mjs',
  // Le SMILES d'un ligand organique : le PDB ne donne que le code HETATM, donc le
  // SMILES vient du Chemical Component Dictionary du RCSB (fetch injecté, testé sans
  // réseau) — et la sous-section « Organic Molecule » du docking est revenue.
  // Le pont PyMOL → NGL, la VRAIE cause du rapport « la scheda a sinistra non
  // funziona, tutto rimane in spheres e gli hide non funzionano » : NGL 2.4 ne
  // connaît ni `resn`/`name`/`resi`, ni `z>90`, ni les jokers — un mot inconnu
  // de ≤4 caractères devient un nom de résidu et un plus long JETTE, en
  // silence. Le pont traduit, résout `z>90` en liste d'index et développe les
  // jokers contre la structure ; le garde-fou EXÉCUTE cette traduction et
  // vérifie que le VRAI NGL accepte tout ce qu'elle produit. Il mesure aussi
  // les FEUILLETS (axe normal, plan médian, têtes) : « z était un moyen de
  // distinguer l'upper du lower leaflet », la géométrie le fait mieux.
  '_pymol_selection_bridge_test.mjs',
  // Ce qu'une macro doit dessiner, et ce que l'utilisateur doit pouvoir défaire
  // à la main (l'ordre des « show / hide », la barre Selections à gauche, §2
  // qui reprend la main, les `set … , <sélection>` devenus propriétés d'ATOMES).
  '_pymol_selections_test.mjs',
  // « la fenêtre de gauche n'a aucun contrôle sur la molécule : POPC reste en
  // sphères ». Dans une macro, les MÊMES atomes sont dessinés par plusieurs
  // lignes (« show sphere, resn POPC+… » ET « show spheres, upper_headgroups ») :
  // décocher un style sur une ligne ne changeait donc RIEN à l'écran, puisque
  // les billes de l'autre ligne restaient. Le geste a maintenant le poids du
  // dernier commandement PyMOL : il soustrait ses atomes aux autres lignes qui
  // dessinent le même style, via le `hideFor` que le rendu applique déjà
  // atome par atome. L'aller-retour est vérifié, ainsi que l'indépendance des
  // familles et la non-mutation des styles.
  '_viewer_selection_toggle_test.mjs',
  // « era headgroups che invece di selezionare gli headgroups selezionava tutta
  // la membrana e finché non nascondo headgroups la membrana resta » — la cause
  // trouvée par l'utilisateur lui-même. Dans la macro, `select headgroups,
  // phosphate or POPC` attrape TOUS les atomes des phospholipides (`POPC` est un
  // nom de résidu), queues comprises : la ligne dessinait donc la bicouche
  // entière, qu'aucune autre ligne ne peut reprendre. Le viewer CONNAÎT les
  // têtes (lipidGroupOf, le classificateur du menu Lipids, celui dont la mesure
  // des feuillets se sert) : quand un nom PROMET les têtes et que son
  // expression les dépasse, la mesure gagne (comme `upper_leaflet` écrit `z>90`),
  // la ligne le DIT (⚠), et le `hide` du macro résout le même nom sur les mêmes
  // atomes — une seule carte nom → clause pour toutes les expansions. Le
  // garde-fou EXÉCUTE la décision sur une structure simulée (le nom corrigé, le
  // nom déjà juste, celui qui ne parle pas des têtes, l'absence de mesure) et
  // vérifie le câblage sur la source.
  '_viewer_headgroups_test.mjs',
  // LES FEUILLETS DANS L'ESPACE PHOSPHOLIPIDES, et les DEUX BARRES aux MÊMES
  // commandes : les ticks « upper / lower leaflet » ont quitté la boîte « Membrane »
  // de la barre de GAUCHE — qui ne garde que la MESURE et renvoie au styling — pour
  // devenir des RANGÉES du groupe « 🧫 Membrane · leaflets » de la fenêtre de style,
  // une seule fois par molécule, avec les feuillets MESURÉS et toute sélection qu'un
  // script PyMOL fait sur les lipides ; chaque rangée écrit dans le MÊME état que les
  // ticks (`selStyles`), donc ce qui était dessiné l'est encore, mais stylable
  // sélection par sélection. Les deux fenêtres passent par UNE SEULE implémentation
  // des commandes (renderLookControls), chacune gardant la curation de ses propres
  // listes. La règle du propriétaire des têtes (membraneHeadOwnerExprs) y est
  // EXÉCUTÉE : un feuillet soustrait les atomes de ses têtes pour TOUS les styles
  // qu'il dessine, donc ni l'ordre des clics ni le premier style choisi ne peuvent
  // plus enterrer les têtes sous les grosses sphères du feuillet.
  '_viewer_membrane_rows_test.mjs',
  // …et la suite qui garde les CHAÎNES ACYLE du même geste : « I select CPK for upper
  // headgroup and the result is that the headgroup becomes CPK but the acyl chains of
  // the upper leaflet disappear. » La résolution des quatre noms mesurés retombait sur
  // la définition du SCRIPT (« resn POPC and z>90 », une tranche qui couvre tout le
  // feuillet) dès que la mesure du viewer manquait : le feuillet se dessinait alors
  // `(feuillet) and not (feuillet)`, l'ensemble vide. `selKeyExpr` et
  // `expandSelectionExpr` résolvent désormais ces noms par la GÉOMÉTRIE — les deux
  // endroits qui décident de ce qu'une rangée dessine et de ce que les `hideFor`
  // écrits par les gestes soustraient.
  '_viewer_membrane_chains_test.mjs',
  // Le RIG DE LUMIÈRE (§3 Scene → ◐ Shadows / 🌑 Darkness / 💡 Light) est extrait
  // dans src/utils/viewerLightRig.js : les nombres de la référence (blanc, key
  // 1.15 / ambiante 0.34 hors ombres, 1.3 + 0.7·dark / max(0.12, 0.34 − 0.22·dark)
  // avec les ombres, direction azimut/élévation, lampe à 100× la boîte englobante,
  // sampleLevel 2) sont VÉRIFIÉS identiques à ceux qui étaient écrits en clair, et
  // leur traduction vers Mol* (Molstar) — le moteur qui sait dessiner les ombres
  // portées et l'ambient occlusion (postprocessing.occlusion = 'on') — est passée
  // au VRAI schéma de paramètres de molstar 4.18 (PD.merge sur RendererParams /
  // PostprocessingParams / Canvas3DParams) et à la fonction de direction de Mol*
  // elle-même (Vec3.directionFromSpherical) : la lumière ne bouge pas d'un iota.
  // …et, depuis la demande « in the molecular viewer add the possibility to change
  // the color of the light and put it just before the clipping in the scene section
  // of the toolbar », la COULEUR de cette lumière-clé (💡 Light colour, §2 Scene →
  // juste avant ✂ Clipping) : validée par le module (tout ce qui n'est pas #rrggbb
  // retombe sur le blanc de la référence), elle ne colore QUE la key light (l'am-
  // biante reste blanche, comme `ambient_color` chez PyMOL) et le viewer la
  // persiste, la pousse dans le payload du rig et la range dans un ⚙️ setup.
  '_viewer_light_rig_test.mjs',
  // Le MATÉRIAU des quatre familles (🎛 Material) ne faisait RIEN : la cible
  // était fausse. `addRepresentation` ne renvoie pas la représentation mais
  // l'ÉLÉMENT qui l'enveloppe (ngl 2.4.0, component.ts), et un élément n'a ni
  // geometryList ni uniforms : l'ancien code ressortait en silence, donc chaque
  // curseur semblait mort. Le garde-fou EXÉCUTE le réglage sur une doublure
  // d'élément ET relit les sources de ngl dans sa sourcemap — roughness /
  // metalness sont des paramètres de PREMIÈRE CLASSE (`{ uniform: true }`), que
  // setParameters applique en place, sans rebuild.
  '_viewer_materials_test.mjs',
  // Le bouton « ✨ Ray » — l'image statique haute résolution de la scène, À
  // CÔTÉ du 📷 Figure et sans rien y changer. Le « ray » est le SUPERSAMPLING
  // DE NGL (`makeImage({ factor, antialias, transparent })`) : le garde-fou
  // relit le code livré de ngl 2.4.0 pour prouver le contrat sur lequel il
  // repose (défauts trim:false / factor:1 · toile = canvas × factor · promesse
  // de Blob PNG · restauration de l'alpha et de l'échantillonnage), EXÉCUTE les
  // fonctions pures du module (taille annoncée, plafonnement budget + GPU, nom
  // du fichier, progression) sur une doublure de stage, et vérifie
  // l'ADDITIVITÉ : le 📷 publie toujours dans la bibliothèque, ✨ Ray écrit
  // seulement un PNG sur l'ordinateur, et aucune représentation n'est touchée.
  '_viewer_ray_test.mjs',
  // …ET L'OMBRE VIVANTE DE LA MÊME « ray » (la demande de cette session :
  // « wow! it works! will it be possible to see it while the molecule is moving
  // and not only as a still picture? »). Le fichier mesure la POLITIQUE sans
  // navigateur (la parité calculée entre le produit du PNG et la toile noire
  // d'alpha `s·m`, les trois régimes et leur défaut `auto`, la pose, la
  // signature de la scène, la couche peinte avec un faux contexte 2D, le pilote
  // conduit avec des doublures), puis le CÂBLAGE dans le viewer — la couche dans
  // le JSX, le signal `rendered`, la préférence mémorisée et la composition dans
  // les DEUX films (🎬 trajectoire et film de poses). La parité sur de VRAIS
  // pixels WebGL est mesurée juste après, par la sonde des ombres portées.
  '_viewer_ray_shadow_live_test.mjs',
  // Les DEUX MODES d'enregistrement de l'environnement (la demande) : le THÈME
  // cumulatif par classe moléculaire (merge verrouillé par le fichier, prompt de
  // conflit) et le SNAPSHOT exact de la scène, clé par section.
  '_viewer_theme_snapshot_test.mjs',
  // LES QUATRE RÉGLAGES DE CETTE SESSION, du côté du viewer : la couleur unie de
  // General qui descend sur les parties de la molécule (« the solid color is not
  // transferred to the subsections backbone, sidechains, etc. »), la section qui
  // ne parle QUE pour elle (les autres chaînes / structures sont ÉPINGLÉES avant
  // que le look du type ne soit écrit : « the setting of the general section does
  // not affect only the molecule but all the molecules in different chains »), le
  // « Color by : Lipid type » d'une rangée de 🧫 membrane qui prend enfin les
  // couleurs de la roue ⚙ (NGL n'enregistre pas de colormaker « lipidtype »), et
  // la macro PyMOL qu'on enregistre DEPUIS le panneau du viewer, dans la réserve
  // de la Library (« without having to go to the library page to save a new one »).
  '_viewer_section_scope_test.mjs',
  // ⧉ UNE PAGE DANS UNE AUTRE FENÊTRE : `?mod=…` (pageFromUrl · urlWithoutMod,
  // EXÉCUTÉS), le geste de la barre latérale (openPageInNewWindow, EXÉCUTÉ sur un
  // faux window : base + page dans l'URL, page inconnue → accueil, fenêtre
  // bloquée DITE) et le câblage — une seule liste de pages (APP_NAV_ITEMS).
  '_app_page_window_test.mjs',
  // LA PAGE QUITTÉE RESTE VIVANTE (le rapport : « Sometimes loading of files is
  // very long and in the meantime i could do something else. can the loading be
  // done in background while I change page to work elsewhere? », choix retenu
  // « keep alive EVERY page I leave (one at a time, hidden) ») : les trois règles
  // EXÉCUTÉES (parkedAfter · pageSlotIds · pageSlotClass), l'état de la page
  // gardée ajusté PENDANT LE RENDU (dans un effet, la page quittée disparaîtrait
  // de l'arbre pendant un rendu et serait remontée vide — c'est le piège que la
  // sonde mesure), l'événement `resize` redonné à la page qui revient (NGL
  // n'écoute que lui), et les quatorze pages de la zone principale — aucune ne
  // doit rester sans place. Les deux pages « storage » en sont exclues, et c'est
  // voulu : StorageModule est monté en permanence, le garder ferait une seconde
  // page storage.
  '_page_parking_test.mjs',
  // LE MESSAGE D'ARRÊT REMPLACÉ PAR UNE BARRE DE CHARGEMENT (la demande) : le
  // bouton « ⏹ Stop (structure loading) » qui vivait en haut à droite de CHAQUE
  // page — même au repos, où il était grisé — a disparu, et la barre du haut de
  // la fenêtre montre à la place la progression de l'opération en cours. Le
  // magasin (utils/loadProgress.js) est EXÉCUTÉ (paliers réels, rapporteur
  // périmé, auditeur qui jette, désabonnement), le câblage du viewer vérifié
  // (les deux chargements, et la barre refermée sur leurs quatre chemins de
  // sortie), puis la barre est RENDUE POUR DE VRAI (build SSR d'un probe
  // exécuté dans Node) dans ses cinq états — au repos, elle ne dessine RIEN.
  '_load_progress_bar_test.mjs',
  '_ligand_smiles_test.mjs',
  '_viewer_render_smoke_test.mjs',
  // …et le SEUL qui LIT DE VRAIS PIXELS, à la toute fin : quatre surfaces
  // identiques (pleine · translucide par défaut · translucide AVEC
  // SEE_THROUGH_SURFACE · témoin opaqueBack:true) rendues par un vrai WebGL, et
  // la luminance de leur PNG. C'est le garde-fou de `opaqueBack: false` : une
  // retouche qui perdrait SEE_THROUGH_SURFACE sur un des appels de surface (ou
  // qui remettrait le paramètre au défaut NGL) y casse la mesure du fond qui
  // traverse la paroi arrière, alors qu'aucune lecture de source ne la voit.
  '_viewer_surface_seethrough_pixels_test.cjs',
  // …ET LE MÊME VERDICT DE PIXELS POUR LES OMBRES PORTÉES DU « ✨ Ray » (≈15 s) :
  // une VRAIE scène NGL (un ruban, des bâtons, la PLAQUE d'un cycle aromatique), et
  // les pixels du PNG que NGL a rendu avant/après l'ombre. Il prouve les trois
  // faits que le rapport contestait : le maillage d'un cartoon est INDEXÉ et LU
  // (l'ancien lecteur y voyait « 12 flottants par sommet », rendait `null`, et un
  // cartoon NE PROJETAIT RIEN), la plaque d'un cycle est lue (un MeshBuffer sans
  // `structureView`) et l'ombre tombe vraiment sur le dessin — pendant que LE FOND
  // BLANC N'EST PAS TOUCHÉ D'UN SEUL PIXEL (c'est le « ça salit la molécule »).
  '_viewer_ray_shadow_pixels_test.cjs',
  // …ET LE MÊME MÉCANISME DE PLACES DE PAGE, MESURÉ PAR UN VRAI NAVIGATEUR
  // (≈10 s) : le seul garde-fou qui prouve ce que React fait vraiment des places
  // (keyed siblings) — la page quittée garde LE MÊME nœud DOM, continue de vivre
  // cachée, et les deux places ÉCHANGENT leur rang au retour (un remontage aurait
  // remis le compteur à zéro). Le témoin négatif — le motif d'avant, montage
  // conditionnel — est monté à côté et se fait bien détruire/recréer, sinon la
  // sonde serait verte sans rien mesurer. SAUTÉE (exit 0) sans Chrome ni Edge.
  '_page_parking_render_test.cjs',
];
const rows = tests.map((t) => {
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).filter((l) => l.trim() !== '');
  return `[${t}] EXIT=${r.status} :: ${out[out.length - 1] || '(vide)'}`;
});
fs.writeFileSync('_verify.txt', `${rows.join('\n')}\n`);
console.log(rows.join('\n'));
console.log(`total ${rows.length}, failed ${rows.filter((r) => !r.includes('EXIT=0')).length}`);
