# Mise en sécurité du workspace — accès réservé aux comptes de l'équipe

> Objectif : **une personne sans compte ne doit ni voir ni modifier les données**,
> même en connaissant l'URL de l'application.

---

## 1. Ce qui a été constaté

L'écran de connexion était **un rideau côté navigateur uniquement**. La base
Firestore du projet `cell-experiment-tracker` répondait aux clients **anonymes** :
une simple requête HTTP sans jeton renvoyait `200` sur
`…/documents/artifacts/lab-workspace-app/public/data/datasets/…`.
Conséquence : toute personne connaissant l'URL de l'app (ou l'identifiant de
projet, présent dans le bundle public) pouvait lire **et** écrire l'ensemble du
workspace — et les empreintes des mots de passe étaient elles aussi lisibles.

Deux failles annexes du client ont été corrigées dans le même passage :

* un navigateur neuf (cache local vide) pouvait **écraser par une liste vide** la
  liste des comptes stockée dans le cloud → plus d'écran de connexion pour
  toute l'équipe ;
* le lien « 🔓 Emergency recovery » (affiché dès qu'aucun compte n'avait de mot
  de passe) ouvrait l'accès complet, y compris les boutons réservés
  (Load HTML, Delete Empty, Rendre visibles à toute l'équipe).

## 2. Ce qui protège désormais les données

```
navigateur ──(nom + mot de passe, HTTPS)──▶ serveur de jetons (Cloud Run)
                                              │ vérifie PBKDF2-SHA256
                                              │ signe un jeton Firebase
navigateur ◀──(jeton signé, claims lab/role)──┘
     │
     └─ signInWithCustomToken ─▶ Firestore : les règles n'acceptent QUE ce jeton
```

| Élément | Rôle |
| --- | --- |
| `server/token-server.js` → `POST /api/auth/login` | vérifie le mot de passe **côté serveur** et signe le jeton |
| `firestore.rules` | refuse tout ce qui n'est pas porteur de `request.auth.token.lab == true` |
| `src/utils/labAuth.js` + `App.jsx` | échangent le jeton, reconstruisent nom + rôle depuis les claims signés |
| `Setup → Équipe & accès → 🛡️ Sécurité serveur` | publie la liste de l'équipe vers le serveur |

**Les règles Firestore sont la seule pièce qui compte vraiment** : le reste
sert à ce que l'application continue de fonctionner normalement.

## 3. À faire — dans CET ordre (le désordre peut bloquer l'équipe)

> **Deux déploiements différents, à ne pas confondre**
>
> | Quoi | Où | Comment | Étape |
> | --- | --- | --- | --- |
> | l'**application** (interface, `src/`) | votre hébergeur web | `git push` → reconstruction automatique | 0 (faite) |
> | le **serveur de jetons** (`server/token-server.js`) | Cloud Run `drive-token-server` | **manuel**, en ligne de commande | **3** |
>
> `git push` ne met à jour **que** l'application. Faire l'étape 3 avant l'étape 6.

> **État vérifié du service Cloud Run (à la date de rédaction de ce document)**
> `GET /health` renvoie encore `{"ok":true,…, "version":"dev"}` **sans**
> `authConfigured`, et `GET /api/auth/status` répond `{"error":"method_not_allowed"}` :
> le serveur en production tourne donc toujours **l'ancienne version**. Rien
> n'est encore sécurisé — les étapes 1 à 7 restent à faire.

### Étape 0 — déployer la nouvelle version de l'application

```powershell
npm run build
# puis le déploiement habituel de l'app (hébergement existant)
```

Sur cette machine, le dépôt est poussé avec **GitHub Desktop** : `Commit` puis
`Push` suffisent si l'hébergeur est relié au dépôt. Vérifier ensuite que l'app
s'ouvre et se comporte **exactement** comme avant : tant que les règles Firestore
sont ouvertes, la nouvelle version code est rétro-compatible (la connexion locale
reste disponible en secours).

### Étape 1 — clé de compte de service (signature des jetons)

> **Raccourci recommandé.** Cette étape **et** l'étape 2 sont faites
> automatiquement par la *Voie A bis* de l'étape 3 (une seule commande dans
> Cloud Shell, **aucune navigation dans la console Firebase**). Dans ce cas,
> allez directement à l'étape 3.

Le réglage se trouve ici (lien direct, à ouvrir en étant connecté au bon compte
Google) :

<https://console.firebase.google.com/project/cell-experiment-tracker/settings/serviceaccounts/adminsdk>

Si vous préférez passer par les menus : ouvrir l'app → en haut **à gauche**,
icône **⚙️** juste à côté de *Project Overview* → **Project settings**
(*Paramètres du projet* / *Impostazioni del progetto*) → onglet
**Service accounts** (*Comptes de service* / *Account di servizio*) → bouton
**Generate new private key** → **JSON**.

1. **Générer une nouvelle clé privée** → JSON (le compte `firebase-adminsdk…`
   convient parfaitement).
2. Enregistrer le fichier hors du dépôt Git (ex. `%USERPROFILE%\Downloads`).

> Cette clé ne sert qu'à **signer** les jetons ; elle reste sur le serveur et
> n'est jamais exposée au navigateur.

### Étape 2 — jeton administrateur

> *Voie A bis :* **sautez cette étape** — le script génère le jeton et l'affiche
> à la fin.

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Copier la ligne obtenue (64 caractères) dans un endroit sûr (gestionnaire de
mots de passe / bloc-notes) : il servira **deux fois** — au serveur (variable
`ADMIN_TOKEN`, étape 3) et à l'app (réglage « Sécurité serveur », étape 4). Il
autorise seulement **la publication de la liste de l'équipe**.

### Étape 3 — redéployer le serveur de jetons

⚠️ Sur ce PC, **`gcloud` n'est pas installé** : tout se fait dans **Google Cloud
Shell** (navigateur, aucune installation) :

<https://shell.cloud.google.com/?project=cell-experiment-tracker>

#### Voie A bis — une seule commande (recommandée)

> **Prérequis :** le projet doit avoir un **compte de facturation actif** (Cloud Run
> l'exige). Vérifier/associer ici :
> <https://console.cloud.google.com/billing/linkedaccount?project=cell-experiment-tracker>
> Le coût réel attendu reste **0 €** : Cloud Run s'arrête dès qu'il n'y a plus de
> requête et les paliers gratuits couvrent ce service. Le script vérifie ce point
> au démarrage (étape 1/6) et le dit clairement si ce n'est pas le cas.

Elle exécute les **étapes 1, 2 et 3** d'un coup : création de la clé de service,
tirage du jeton d'administration, redéploiement du serveur, vérification du
résultat. Elle ne touche **ni** au Drive, **ni** au volume `/data`, **ni** aux
origines autorisées.

1. Ouvrir <https://shell.cloud.google.com/?project=cell-experiment-tracker> et
   vérifier que le compte Google affiché (« Authorize » la première fois) est
   bien le **propriétaire du projet**.
2. Dans le terminal, taper `cd ~`, puis **glisser-déposer les trois fichiers**
   directement dans la fenêtre (ou menu **⋮** → *Upload*) :

| Fichier local | À déposer sous le nom |
| --- | --- |
| `…\lab-workspace\server\cloud-shell-quick-update.sh` | `cloud-shell-quick-update.sh` |
| `…\lab-workspace\server\token-server.js` | `token-server.js` |
| `…\lab-workspace\server\package.json` | `package.json` |

3. Lancer **une seule** commande :

```bash
sed -i 's/\r$//' ~/cloud-shell-quick-update.sh && bash ~/cloud-shell-quick-update.sh
```

Le `sed` corrige d'éventuelles fins de ligne Windows (sans effet si le fichier
est déjà propre) : les messages `$'\r': command not found` viennent de là.

Le script se termine par un cadre jaune **ADMIN_TOKEN** : copiez-le (il sert à
l'étape 4) et passez **directement à l'étape 4**.

**En cas d'échec du déploiement**, le script affiche tout seul les 40 dernières
lignes de `gcloud` plus un diagnostic court : c'est **ce texte** qu'il faut me
transmettre (la ligne commençant par `ERROR` est la plus importante), pas le
message final du script. Le journal complet reste lisible dans Cloud Shell :

```bash
tail -40 ~/tsrv-deploy.log
```

##### Trois pannes déjà rencontrées (et déjà gérées)

| Ligne `ERROR` | Cause | Correction |
| --- | --- | --- |
| `FAILED_PRECONDITION: Billing account for project … is not found` | le projet n'a plus de compte de facturation associé (essai terminé, compte supprimé) | associer un compte de facturation actif (lien ci-dessus) puis relancer le script |
| `PERMISSION_DENIED: Build failed because the default service account is missing required IAM permissions` | sur les projets récents, le compte de service Cloud Build (`…-compute@developer.gserviceaccount.com`) a été créé **sans** le rôle Editor : il ne peut donc plus lire le code source envoyé au build | le script **corrige tout seul** : il accorde `roles/run.builder`, `roles/storage.objectViewer`, `roles/artifactregistry.writer`, `roles/logging.logWriter` à ce compte de service, attend la propagation (20 s) puis **retente le déploiement automatiquement** |
| `The user-provided container failed to start and listen on the port defined provided by the PORT=8080` | le conteneur se construit mais `node` s'arrête aussitôt — typiquement un service **créé par erreur dans le mauvais projet** : la révision est alors neuve, donc sans volume `/data`, **sans `GOOGLE_CLIENT_SECRET`** (que `token-server.js` exige, sinon `process.exit(1)`), sans compte de service et sans origines autorisées | le script **ne peut plus** provoquer ce cas : l'étape 1/6 localise le projet qui héberge réellement le service (en comparant l'URL publique utilisée par l'app), refuse de continuer si elle ne le trouve pas, et vérifie que le service porte bien `GOOGLE_CLIENT_SECRET` **avant** de déployer. Supprimer le service fantôme éventuel : `gcloud run services delete drive-token-server --project <projet listé> --region europe-west1 --quiet` |

> ⚠️ **Le service ne vit PAS dans le projet Firebase.** L'app Firebase est
> `cell-experiment-tracker` (n° **855790481107**) — c'est lui qui **signe les
> jetons** (`firebase-sa.json`) et qui porte les règles Firestore. Le service
> Cloud Run, lui, vit dans le projet dont le **numéro apparaît dans l'URL**
> (`drive-token-server-763848765523…`). Le script gère les deux tout seul ;
> les commandes manuelles ci-dessous utilisent `$PROJECT` pour le second.

Aucune de ces pannes ne touche la production : tant que la nouvelle
révision n'est pas déployée, l'ancienne continue de répondre (le Drive de
l'équipe continue de fonctionner).

Réparation manuelle du second cas, si le script n'y arrive pas (Cloud Shell) —
`$PROJECT` = projet qui **héberge le service** :

```bash
# 1) retrouver le projet qui HÉBERGE le service : c'est celui dont le numéro
#    apparaît dans l'URL (le projet Firebase cell-experiment-tracker porte le
#    n° 855790481107 : ce n'est PAS le même)
PROJECT="$(gcloud projects list --filter='projectNumber=763848765523' --format='value(projectId)')"
echo "projet du service : $PROJECT"

# 2) réparer les droits du compte de service Cloud Build
SA="$(gcloud builds get-default-service-account --project "$PROJECT")"
for r in roles/run.builder roles/storage.objectViewer roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$r" --condition=None --quiet
done
```

#### Voie A — manuelle (faire les étapes 1 et 2 à la main)

Le secret OAuth est déjà enregistré dans Secret Manager : on ne touche **qu'aux
trois nouvelles variables**, donc **aucun risque de casser le Drive** ni les
origines autorisées.

1. Ouvrir <https://shell.cloud.google.com> et sélectionner le projet du service
   (celui dont le **numéro** apparaît dans l'URL `drive-token-server-763848765523` ;
   ici : **`project-5bef8353-9780-43db-885`**).
2. Dans le terminal Cloud Shell :

```bash
mkdir -p ~/token-server && cd ~/token-server

# projet qui HÉBERGE le service (≠ projet Firebase) : celui du numéro de l'URL
PROJECT="$(gcloud projects list --filter='projectNumber=763848765523' --format='value(projectId)')"
echo "$PROJECT"          # → project-5bef8353-9780-43db-885
gcloud config set project "$PROJECT"

# (facultatif) voir les origines déjà autorisées — à NE PAS modifier
gcloud run services describe drive-token-server --project "$PROJECT" --region europe-west1 \
  --format='value(spec.template.spec.containers[0].env)'
```

> **Un même service, deux noms.** Cloud Run répond aussi bien à
> `drive-token-server-**763848765523**.europe-west1.run.app` (le nom que l'app
> utilise, dans `src/data/constants.js`) qu'à
> `drive-token-server-**6eq5wljpia**-ew.a.run.app` (le nom que **gcloud** affiche
> par défaut dans `status.url`). Les deux mènent au même conteneur : ne « corrigez »
> donc pas l'URL de l'app parce que gcloud affiche l'autre nom. Le script
> `cloud-shell-quick-update.sh` identifie le projet par le **numéro** présent dans
> l'URL de l'app et vérifie que les deux noms répondent.

3. Déposer dans `~/token-server` (menu **⋮** de Cloud Shell → *Upload*) les
   fichiers `token-server.js` et `package.json` du dossier `server/`, plus
   `firebase-sa.json` (la clé de l'**étape 1**). Si la console Firebase vous
   résiste, la clé se crée aussi **sans quitter Cloud Shell** :

```bash
# ⚠️ la clé doit venir du projet FIREBASE (celui qui signe les jetons)
SA_EMAIL="$(gcloud iam service-accounts list --project cell-experiment-tracker \
  --filter='email~firebase-adminsdk' --format='value(email)' --limit=1 | head -n1)"
echo "$SA_EMAIL"                      # doit afficher …@cell-experiment-tracker.…
gcloud iam service-accounts keys create firebase-sa.json \
  --iam-account "$SA_EMAIL" --project cell-experiment-tracker
```

4. Toujours dans `~/token-server`, déployer (`$PROJECT` = projet du service ; ne
   jamais mettre `cell-experiment-tracker` ici, cela **créerait un second
   service vide** qui refuse de démarrer) :

```bash
SA_B64="$(base64 -w0 firebase-sa.json)"       # une seule ligne, sans virgule
ADMIN_TOKEN='<jeton de l étape 2>'            # entre apostrophes simples

gcloud run deploy drive-token-server \
  --source . \
  --project "$PROJECT" --region europe-west1 \
  --allow-unauthenticated \
  --update-env-vars ACCOUNTS_FILE=/data/workspace-accounts.json,FIREBASE_SERVICE_ACCOUNT_B64="$SA_B64",ADMIN_TOKEN="$ADMIN_TOKEN"
```

5. Vérifier **immédiatement** (la réponse doit contenir `authConfigured:true`) :

```bash
curl -s https://drive-token-server-763848765523.europe-west1.run.app/health
# → {"ok":true,…,"authConfigured":true,"authAccounts":0,…}

# l'autre nom du même service (celui que gcloud affiche) doit répondre aussi :
curl -s "$(gcloud run services describe drive-token-server --project "$PROJECT" \
        --region europe-west1 --format='value(status.url)')/health"
```

6. Vérifier que le volume `/data` (qui garde la liste d'équipe et le jeton Drive)
   et le compte de service sont **restés en place** :

```bash
gcloud run services describe drive-token-server --project "$PROJECT" --region europe-west1 \
  --format='yaml(spec.template.spec.containers[0].volumeMounts,spec.template.spec.serviceAccountName)'
# doit afficher : mountPath: /data  +  serviceAccountName: drive-token-sa@…​.iam.gserviceaccount.com
```

> Si `<url>` change (ce n'est pas le cas ici : le service existe déjà), mettre à
> jour `GOOGLE_TOKEN_EXCHANGE_URL` dans `src/data/constants.js`.

7. Vérifier qu'il n'existe **pas** un second service du même nom dans un autre
   projet (symptôme d'un déploiement dans le mauvais projet) :

```bash
for p in $(gcloud projects list --format='value(projectId)'); do
  u="$(gcloud run services describe drive-token-server --project "$p" --region europe-west1 \
        --format='value(status.url)' 2>/dev/null)" && echo "$p  $u"
done
# → une seule ligne attendue : le projet ci-dessus, avec l'URL …-763848765523…
#   (ou la forme équivalente …-6eq5wljpia-ew.a.run.app : même service)
#   Pour supprimer un service fantôme :
#     gcloud run services delete drive-token-server --project <le fantôme> \
#       --region europe-west1 --quiet
```

#### Voie B — avec le script complet (si vous avez encore `client_secret.json`)

```bash
cd server   # dossier contenant token-server.js, package.json, deploy-cloud-run.sh
export FIREBASE_SERVICE_ACCOUNT_FILE=~/firebase-sa.json     # nouveau
export ADMIN_TOKEN='<jeton de l étape 2>'                   # nouveau
bash deploy-cloud-run.sh -a "https://<url-publique-de-l-app>" -p 763848765523 \
  -c client_secret.json                                     # ⚠️ même valeur -a qu'au 1er déploiement
```

Le script affiche `Team sign-in: enabled (…@….iam.gserviceaccount.com)`.

> ⚠️ `-a/AppOrigin` (PowerShell : `-AppOrigin`) **remplace** la liste des
> origines autorisées : reprendre exactement la valeur du premier déploiement
> (l'URL que vous tapez dans le navigateur pour ouvrir l'app), sinon la
> connexion sera refusée par CORS (`403 origin_not_allowed`). En cas de doute,
> utiliser la **voie A**, qui ne touche pas ce réglage.
> *(Rassurant : le Drive fonctionne déjà depuis l'app en production, donc
> l'origine utilisée est forcément autorisée.)*

Vérification, dans les deux voies :

```powershell
curl.exe https://drive-token-server-763848765523.europe-west1.run.app/health
# → {"ok":true,…,"authConfigured":true,"authAccounts":0,…}

# CORS : le navigateur n'enverra « Publier les comptes » que si le préflight
# autorise l'en-tête X-Admin-Token (sinon « Failed to fetch », sans trace serveur).
curl.exe -s -i -X OPTIONS https://drive-token-server-763848765523.europe-west1.run.app/api/auth/accounts `
  -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" `
  -H "Access-Control-Request-Headers: content-type,x-admin-token" |
  Select-String 'access-control-allow-headers'
# → access-control-allow-headers: Content-Type, X-Admin-Token, Authorization
```

### Étape 4 — publier l'équipe sur le serveur

**Voie normale (depuis l'application)** : ouvrir l'app, se connecter comme
superutilisateur (l'ancien nom + mot de passe fonctionnent toujours), puis
`Setup → Équipe & accès → 🛡️ Sécurité serveur` :

1. coller le jeton administrateur de l'étape 2 ;
2. presser **⬆ Publier les comptes** ;
3. lire le résultat : `N compte(s) publié(s) — N avec mot de passe`.
   ⚠️ Toute fiche **sans mot de passe** est refusée par le serveur.

La publication est ensuite **automatique** à chaque modification de l'équipe
(le jeton reste enregistré dans ce navigateur).

> **Si l'app répond « Serveur de jetons injoignable (Failed to fetch) » en
> pressant « ⬆ Publier les comptes »** — c'est un refus du **navigateur**, pas
> une panne du serveur (une panne du serveur donnerait « HTTP 5xx » ou
> « n'a pas répondu à temps »). Deux causes possibles :
>
> 1. **l'en-tête `X-Admin-Token` n'est pas autorisé par le préflight CORS** : le
>    navigateur annule la requête avant de l'envoyer (elle n'apparaît donc dans
>    aucun log Cloud Run). Ce réglage est dans `server/token-server.js`
>    (`CORS_ALLOW_HEADERS`) : si le service a été déployé avant que cette
>    constante existe, retéléverser `token-server.js` dans Cloud Shell puis
>    relancer `cloud-shell-quick-update.sh` (son étape 5/6 vérifie désormais ce
>    point et le signale) ;
> 2. **le serveur ne répond pas** : ouvrir `/health` dans un onglet (voir
>    l'étape 3).
>
> Le navigateur met en cache le verdict du préflight (`Access-Control-Max-Age`) :
> après correction, **vider le cache ou ouvrir une fenêtre de navigation privée**
> avant de réessayer, sinon l'ancien refus peut persister quelques minutes.

**Voie de secours (PowerShell, sans passer par l'app)** — utile pour un
déploiement neuf ou si l'app est inaccessible :

```powershell
$server = 'https://drive-token-server-763848765523.europe-west1.run.app'
$admin  = '<ADMIN_TOKEN>'
function Sha([string]$p) {
  [BitConverter]::ToString(
    [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($p))
  ).Replace('-','').ToLower()
}
$members = @(
  @{ id='op_1'; name='Nicola D.'; role='superuser'; passwordHash=(Sha 'MotDePasseDeNicola') },
  @{ id='op_2'; name='Marie L.';  role='user';      passwordHash=(Sha 'MotDePasseDeMarie') }
)
Invoke-RestMethod -Method Post -Uri "$server/api/auth/accounts" `
  -Headers @{ 'X-Admin-Token' = $admin } -ContentType 'application/json' `
  -Body (@{ members = $members } | ConvertTo-Json -Depth 5)
```

### Étape 5 — vérifier la connexion par le serveur

```powershell
curl.exe https://drive-token-server-763848765523.europe-west1.run.app/api/auth/roster
# → {"ok":true,"members":[{"id":"op_1","name":"…","role":"superuser"}, …]}   (aucun hash)

# mot de passe valide → un jeton (long) ; mot de passe erroné → 401
curl.exe -s -X POST https://drive-token-server-763848765523.europe-west1.run.app/api/auth/login `
  -H "Content-Type: application/json" -d "{\"name\":\"Nicola D.\",\"password\":\"MotDePasseDeNicola\"}"
```

Puis, dans l'application (fenêtre de navigation privée) : l'écran de connexion
doit afficher « 🔐 Mot de passe vérifié par le serveur sécurisé du laboratoire »
et la liste des noms doit venir du serveur.

### Étape 6 — publier les règles Firestore (ferme l'accès anonyme)

Console Firebase → **Firestore Database** → onglet **Règles** → remplacer tout
le contenu par celui de `firestore.rules` (racine du dépôt) → **Publier**.

*(Variante CLI, si vous préférez : le fichier `firebase.json` à la racine
pointe déjà sur `firestore.rules`, donc `npx firebase deploy --only
firestore:rules` publie exactement ce contenu.)*

### Étape 7 — vérifier que l'accès anonyme est mort

```powershell
$k = 'AIzaSyCVemPUayc_Q-IsbcQxnFRHg8bBLZFSHfA'   # clé publique, présente dans le bundle
$u = "https://firestore.googleapis.com/v1/projects/cell-experiment-tracker/databases/%28default%29/documents/artifacts/lab-workspace-app/public/data/appConfig/global?key=$k"
try { (Invoke-WebRequest -Uri $u -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
# AVANT : 200      APRÈS : 403
```

`403` = plus personne, hors comptes de l'équipe, ne peut lire le workspace.
Contrôlez enfin, sur deux postes, qu'une connexion normale ouvre bien les
datasets (les écritures doivent continuer à s'enregistrer : statut « Cloud »).

---

## 4. Retour arrière (si quelque chose bloque l'équipe)

Console Firebase → Firestore → Règles → coller :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}
```

→ **Publier** : l'ancien comportement (ouvert à tous) revient immédiatement.
Le reste (app + serveur) continue de fonctionner : la connexion locale de
secours reste active tant que les règles sont ouvertes.

## 5. Ce que cela change pour l'équipe

* Écran de connexion, noms et mots de passe **identiques** à avant.
* La session est désormais un jeton signé (renouvelé automatiquement) ; le
  bouton **Sign out** (barre latérale et page d'accueil) ferme réellement
  l'accès — utile sur un poste partagé.
* Ajouter/retirer un membre : `Setup → Équipe & accès` (publication automatique
  si le jeton administrateur est enregistré). Un changement de **rôle** prend
  effet à la prochaine connexion de la personne.
* **Verrouiller les données d'une expérience** : dans l'en-tête de chaque
  expérience, un superutilisateur dispose de **🔒 Lock data** — et, si
  l'expérience a plusieurs conditions, de **🔒 Lock all N** — pour figer les
  données. Les autres membres gardent **toute la lecture** (résultats, graphes,
  tableaux) mais plus aucune modification n'est enregistrée : une bannière leur
  propose de **copier les données dans une nouvelle instance**
  (`⧉ Copy the data to a new instance`) pour mener une autre analyse — la copie
  n'est jamais verrouillée. Seul un superutilisateur peut déverrouiller
  (**🔓 Unlock data**) et modifier ou supprimer une expérience figée. La carte de
  l'expérience affiche un badge « Data locked » (voir `src/utils/dataLock.js`).
* **Nouvelle date / condition** : dans l'expérience, le bouton
  **+ Add Date/Condition** ajoute une condition qui démarre sur une **page
  vierge** (mêmes nom d'expérience, classification, projets et scientifiques,
  mais aucune donnée reprise : ni plaque, ni spectre, ni commentaire, ni image).
  Pour repartir des **données** d'une condition existante, utilisez
  **⧉ Copy the data to a new instance** (bannière de verrouillage).
* **Fichiers utiles d'un projet** : sur la page d'un projet, la section
  **📎 Useful files** enregistre les documents de référence du projet
  (protocoles, PDF, tableurs, feuilles de données…) sur Google Drive, dans un
  répertoire **`useful_files`** créé DANS le dossier du projet :
  `<Lab Workspace>/<dataset>/projects/<projet>/useful_files`. Chaque fichier
  garde son propre nom ; le projet n'en conserve qu'un index (nom, taille, lien,
  auteur, date). **⟳ Refresh from Drive** relit le dossier réel — c'est Drive
  qui fait foi — et **📂 Open the Drive folder ↗** ouvre (et crée au besoin) le
  répertoire (voir `src/utils/projectFiles.js`).
* Si le serveur de jetons est momentanément injoignable, personne ne peut se
  connecter (Firestore refuse alors tout le monde — c'est le prix de la
  protection). `/health` et les logs Cloud Run indiquent l'état du service.

## 6. Détails de sécurité

* **Mots de passe** : vérifiés côté serveur en PBKDF2-SHA256 + sel aléatoire ;
  les empreintes SHA-256 créées par l'application sont **durcies
  automatiquement** lors de la première connexion réussie. Aucun mot de passe
  en clair n'est stocké, et plus aucune empreinte n'est lisible publiquement
  (`appConfig` exige un jeton signé).
* **Rôles signés** : le rôle (`superuser` / `user`) fait partie du jeton ; le
  modifier dans `localStorage` ou dans la console du navigateur n'a plus aucun
  effet.
* **Anti-force brute** : 12 tentatives / 5 minutes / adresse IP.
* **Ne pas activer** les fournisseurs *E-mail/Mot de passe* ni *Anonyme* dans
  Firebase Authentication : seul un jeton signé par le serveur de jetons porte
  la revendication `lab: true` exigée par les règles (une inscription publique
  avec la clé API ne l'obtient jamais). Seuls les fournisseurs *Google* et
  *Personnalisé* doivent rester disponibles.
* **Secrets** : la clé de compte de service (`FIREBASE_SERVICE_ACCOUNT…`) et
  `ADMIN_TOKEN` ne doivent **jamais** être committés ; ils vivent uniquement
  dans les variables d'environnement Cloud Run.

---

## 7. Riepilogo (italiano)

0. **Attenzione**: il push su GitHub (GitHub Desktop) aggiorna **solo
   l'applicazione**. Il **server dei token** (Cloud Run) si aggiorna a parte e a
   mano (passo 4). Su questo PC `gcloud` **non è installato** → usare **Google
   Cloud Shell** (basta il browser). Stato verificato: il server in produzione
   gira ancora la **vecchia** versione → non c'è ancora nessuna protezione.
1. Il problema: la banca dati rispondeva **anche ai client anonimi** (HTTP 200
   senza token) → l'URL dell'app bastava per leggere e modificare tutto.
2. La soluzione: il server dei token verifica lui stesso le password e firma un
   jeton Firebase; le regole Firestore (`firestore.rules`) accettano **solo**
   quei jetons.
3. Ordine da rispettare (i numeri sono gli « Étape » del documento): (0) deploy
   dell'app — **fatto**, (1) chiave di servizio Firebase, (2) ADMIN_TOKEN,
   (3) ridistribuire il server dei token, (4) pubblicare l'equipe
   (`Setup → Équipe & accès → 🛡️ Sécurité serveur`), (5) verificare la
   connessione via server, (6) pubblicare `firestore.rules` nella Console
   Firebase, (7) verificare che un accesso anonimo risponda **403**.
4. Per l'équipe nulla cambia: stessi nomi, stesse password, stesso schermo.
5. In caso di blocco: rimettere le regole permissive (sezione 4) — si torna
   subito alla situazione precedente.
