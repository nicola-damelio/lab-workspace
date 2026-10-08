/* =========================================================================
   src/utils/folderRace.js — UNE SEULE OPÉRATION À LA FOIS PAR (CONTENEUR, NOM).

   CE QUE LE MAGASIN PROTÈGE. Un DOSSIER : sa création. Un FICHIER : son
   écriture. Dans les deux cas c'est le couple « chercher puis écrire » qui doit
   être unique — sans cela, deux appels simultanés cherchent tous les deux
   « rien », puis écrivent tous les deux, et le Drive reçoit deux objets du même
   nom, avec deux identifiants.

   Le défaut constaté le 20/09/2026 sur le Drive réel (expérience NMR du projet
   p53H) : les dossiers d'INSTANCE y étaient EN DOUBLE.

       projects/p53H/NMR_p53H/Exp_7/    +  projects/p53H/NMR_p53H/Exp_7/
       projects/p53H/NMR_p53H/Exp_19/   +  projects/p53H/NMR_p53H/Exp_19/
       …/Exp_19/data/Structure/         +  …/Exp_19/data/Structure/

   Les dates de création le disent : 73 ms, 221 ms et 245 ms d'écart. DEUX
   chaînes de dossiers avançaient EN MÊME TEMPS sur le même chemin : l'import
   Bruker archive les fichiers bruts pendant que la copie de référence du
   spectre part (NMRSections.jsx lance ce second envoi sans l'attendre — voir
   `void (async () => archiveNmr1dSpectrum…)`), et `findOrCreateFolder` fait
   « chercher puis créer ». Les deux ont donc CHERCHÉ avant que l'un ait créé :
   le Drive a reçu deux dossiers du même nom sous le même parent. La lecture
   prenait ensuite « le premier du nom », dans un ordre que Drive ne garantit
   pas : les fichiers de l'expérience se retrouvaient éparpillés entre jumeaux
   (« le dossier est répété deux fois »).

   Ici vit la partie PURE : un magasin de créations en vol, par (parent, nom).
   Un appel identique pendant qu'une création est en vol ATTEND la MÊME
   promesse — donc rend le même identifiant — et un échec n'est jamais
   mémorisé (l'appelant suivant doit pouvoir réessayer pour de vrai).

   POINT CAPITAL : c'est la RECHERCHE **ET** LA CRÉATION qui doivent être
   uniques, pas la seule création. Si deux appelants cherchent tous les deux
   « rien », puis que le premier crée et efface sa trace avant que le second ne
   consulte le magasin, le second crée un second dossier. En gardant tout le
   couple (chercher → créer) dans une seule opération en vol, le second
   appelant attend, et celui qui arrive APRÈS la création trouve le dossier par
   sa recherche : aucun jumeau ne peut naître dans une page.

   LE MÊME OUTIL PROTÈGE LES FICHIERS. Constaté sur le Drive réel le 21/09/2026 :
   SIX `_meta.json` IDENTIQUES de 519 octets, écrits en 1,8 s (21 h 44 min 15 s à
   21 h 44 min 16 s) dans `agenda/2026-07-02_appointment` — et 141 autres dossiers
   dans le même cas, avec des identifiants DIFFÉRENTS (ce ne sont donc pas des
   artefacts de listage). Des publications simultanées se chevauchaient : chacune
   cherchait le fichier AVANT que l'autre ne l'ait écrit. `uploadDriveFileToFolderOnce`
   garde donc son couple (chercher → écrire) en vol, sous
   `fileInFolderKey(nom, dossier)` : un seul fichier naît, et les appelants
   simultanés reçoivent le MÊME identifiant.

   Aucun accès réseau ici : driveUpload.findOrCreateFolder() (les dossiers) et
   driveUpload.writeFileInResolvedFolder() (les fichiers) branchent cette logique
   sur le vrai Drive. Vérifié par _folder_race_test.mjs et _upload_twins_test.mjs.
   ========================================================================= */

/** Clé d'une création de dossier — ou d'un fichier DANS un dossier — : son
 *  CONTENEUR et son NOM. Deux dossiers du même nom sous des parents différents
 *  sont deux dossiers différents (et deux fichiers du même nom dans deux dossiers
 *  différents n'ont rien à voir). PUR. */
export const folderCreateKey = (name, parentId) =>
  `${String(parentId || '')}\u0000${String(name || '')}`;

/** Clé d'un FICHIER dans un dossier : son NOM et le dossier qui le porte. C'est
 *  la même identité que celle d'un dossier, vue depuis un fichier — et c'est ce
 *  qui rend le magasin utilisable pour les ENVOIS : deux envois simultanés du
 *  même nom dans le même dossier visent LE MÊME fichier (l'envoi remplace déjà
 *  un fichier de même nom), donc un seul doit naître. Le dossier est celui que
 *  l'envoi a RÉSOLU (un identifiant), jamais un chemin nominal : deux chemins
 *  différents peuvent désigner le même dossier, et l'inverse. PUR. */
export const fileInFolderKey = (name, folderId) => folderCreateKey(name, folderId);

/** Exécute `work()` — sauf si le MÊME travail est déjà en vol, auquel cas la
 *  promesse en vol est rendue telle quelle (les deux appelants obtiennent donc
 *  le même identifiant, et le Drive ne reçoit qu'un dossier — ou qu'un FICHIER
 *  quand `work` est un envoi, voir `fileInFolderKey`).
 *
 *  `work` doit contenir la RECHERCHE **ET** L'ÉCRITURE (voir l'en-tête) ;
 *  `store` est une Map fournie par l'appelant (un magasin par module suffit).
 *  Un échec libère la clé aussitôt : le prochain appel réessaie pour de vrai,
 *  et personne ne garde une panne en mémoire.
 *
 *  PUR : `work` est la seule chose qui touche au réseau. */
export const oncePerFolder = (store, key, work) => {
  if (!store || typeof store.get !== 'function') return work();
  const inFlight = store.get(key);
  if (inFlight) return inFlight;
  const pending = (async () => {
    try {
      return await work();
    } finally {
      /* Libéré APRÈS coup (succès comme échec) : le dossier créé est trouvé par
         la RECHERCHE du prochain appelant, donc rien ne se recrée — et un échec
         ne laisse aucune trace. */
      store.delete(key);
    }
  })();
  store.set(key, pending);
  return pending;
};

/** Combien de travaux sont en vol (diagnostic / tests). PUR. */
export const inFlightCount = (store) =>
  (store && typeof store.size === 'number' ? store.size : 0);
