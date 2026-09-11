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

### Étape 0 — déployer la nouvelle version de l'application

```powershell
npm run build
# puis le déploiement habituel de l'app (hébergement existant)
```

Tant que les règles ne sont pas publiées, cette version fonctionne **exactement
comme avant** (la connexion locale reste disponible en secours).

### Étape 1 — clé de compte de service (signature des jetons)

1. Console Firebase → ⚙️ **Paramètres du projet** → onglet **Comptes de service**.
2. **Générer une nouvelle clé privée** → JSON (le compte `firebase-adminsdk…`
   convient parfaitement).
3. Enregistrer le fichier hors du dépôt Git (ex. `%USERPROFILE%\Downloads`).

> Cette clé ne sert qu'à **signer** les jetons ; elle reste sur le serveur et
> n'est jamais exposée au navigateur.

### Étape 2 — jeton administrateur

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Il servira au serveur (variable `ADMIN_TOKEN`) et à l'app (réglage
« Sécurité serveur ») : il autorise seulement **la publication de la liste de
l'équipe**.

### Étape 3 — redéployer le serveur de jetons

Reprenez les paramètres du premier déploiement (`-ClientSecretFile`, `-Bucket`
s'ils ont été utilisés) et ajoutez les deux nouveaux :

```powershell
cd server
.\deploy-cloud-run.ps1 `
  -AppOrigin "https://<url-publique-de-l-app>" `
  -ClientSecretFile "$HOME\Downloads\client_secret.json" `
  -FirebaseServiceAccountFile "$HOME\Downloads\cell-experiment-tracker-firebase-adminsdk-xxxxx.json" `
  -AdminToken "<jeton-de-l-etape-2>"
```

Le script affiche `Team sign-in: enabled (…@….iam.gserviceaccount.com)`.
Vérification immédiate :

```powershell
curl.exe https://drive-token-server-763848765523.europe-west1.run.app/health
# → {"ok":true,…,"authConfigured":true,"authAccounts":0,…}
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

1. Il problema: la banca dati rispondeva **anche ai client anonimi** (HTTP 200
   senza token) → l'URL dell'app bastava per leggere e modificare tutto.
2. La soluzione: il server dei token verifica lui stesso le password e firma un
   jeton Firebase; le regole Firestore (`firestore.rules`) accettano **solo**
   quei jetons.
3. Ordine da rispettare: (1) déployer l'app, (2) chiave di servizio Firebase,
   (3) ADMIN_TOKEN, (4) ridistribuire il server dei token, (5) pubblicare
   l'equipe (`Setup → Équipe & accès → 🛡️ Sécurité serveur`), (6) pubblicare
   `firestore.rules` nella Console Firebase, (7) verificare che un accesso
   anonimo risponda **403**.
4. Per l'équipe nulla cambia: stessi nomi, stesse password, stesso schermo.
5. In caso di blocco: rimettere le regole permissive (sezione 4) — si torna
   subito alla situazione precedente.
