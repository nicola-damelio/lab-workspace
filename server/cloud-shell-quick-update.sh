#!/usr/bin/env bash
# =============================================================================
#  server/cloud-shell-quick-update.sh
#
#  VOIE A — mise à jour « en une commande » du serveur de jetons Cloud Run.
#  À exécuter DANS GOOGLE CLOUD SHELL (navigateur), jamais sur un PC.
#
#  Ce que ce script ne touche PAS (donc rien ne peut casser côté Drive) :
#     - le volume /data (jeton Drive permanent + copie de l'équipe)
#     - le secret OAuth (GOOGLE_CLIENT_SECRET / Secret Manager)
#     - la liste des origines autorisées (ALLOWED_ORIGINS)
#     - le compte de service du service et les droits IAM
#  Il ajoute UNIQUEMENT trois variables d'environnement :
#     ACCOUNTS_FILE, FIREBASE_SERVICE_ACCOUNT_B64, ADMIN_TOKEN
#  L'ADMIN_TOKEN déjà présent sur le service est RÉUTILISÉ : un redéploiement ne
#  casse donc pas le jeton collé dans le navigateur. Rotation volontaire :
#     ROTATE_ADMIN_TOKEN=1 bash ~/cloud-shell-quick-update.sh
#
#  Il crée aussi la clé de service Firebase et le jeton administrateur :
#  AUCUNE navigation dans la console Firebase n'est nécessaire.
#
#  ATTENTION — DEUX PROJETS DIFFÉRENTS :
#    - le projet FIREBASE (cell-experiment-tracker) : il signe les jetons, c'est
#      de lui que vient firebase-sa.json ;
#    - le projet qui HÉBERGE LE SERVICE (celui dont le numéro apparaît dans
#      l'URL publique que l'app utilise déjà) : c'est là que se déploie.
#  Le script localise ce second projet tout seul, en comparant l'URL du service
#  trouvé dans chaque projet avec l'URL de l'app. Si aucun ne correspond, il
#  s'arrête : il ne peut donc pas créer un second service vide (sans volume
#  /data ni secret OAuth), qui planterait au démarrage.
#
#  PRÉPARATION (une seule fois)
#    1. Ouvrir https://shell.cloud.google.com avec LE COMPTE GOOGLE
#       PROPRIÉTAIRE du projet qui héberge le service (l'étape 1/6 affiche le
#       compte actif et liste les projets qu'il voit ; avec un autre compte,
#       elle ne trouvera pas le service)
#    2. Dans le terminal :  cd ~
#    3. Glisser-déposer dans la fenêtre les DEUX fichiers du dossier server/ :
#         token-server.js
#         package.json
#       (ce script-ci est déposé de la même façon ; ou menu ⋮ → Upload)
#    4. Lancer :
#         sed -i 's/\r$//' ~/cloud-shell-quick-update.sh
#         bash ~/cloud-shell-quick-update.sh
# =============================================================================
set -euo pipefail

FIREBASE_PROJECT="cell-experiment-tracker"   # projet Firebase : signe les jetons
PROJECT="${TSRV_PROJECT:-}"                  # projet qui HÉBERGE le service (localisé à l'étape 1)
REGION="europe-west1"
SERVICE="drive-token-server"
HEALTH_URL="https://drive-token-server-763848765523.europe-west1.run.app/health"
WORK="$HOME/tsrv"
OTHERS=""

host_of()     { printf '%s' "$1" | sed -E 's#^https?://##; s#/.*$##'; }
# --platform=managed est TOUJOURS explicite. Si la propriété `run/platform` n'est
# pas définie dans la configuration gcloud active (cas d'un Cloud Shell neuf :
# AUCUNE section [run] n'apparaît dans `gcloud config list`), alors
#   gcloud run services describe … --region europe-west1
# échoue avec « The --platform flag is required, or set property run/platform ».
# L'erreur étant avalée par « 2>/dev/null », l'étape 1/6 concluait « service
# introuvable » alors que le compte ET le projet étaient parfaitement bons.
service_url() { gcloud run services describe "$SERVICE" --project "$1" --region "$REGION" \
                  --platform=managed --format='value(status.url)' 2>/dev/null \
                  | tr -d '\r' | head -n1 || true; }
# Relance la MÊME commande en CONSERVANT l'erreur (stderr) : service_url() tourne
# dans une sous-couche $( ), toute variable qu'elle poserait serait perdue. On ne
# l'appelle donc que sur le chemin d'échec, pour afficher la vraie raison.
describe_err() {
  gcloud run services describe "$SERVICE" --project "$1" --region "$REGION" \
    --platform=managed --format='value(status.url)' 2>&1 >/dev/null \
    | tr -d '\r' | grep -v '^[[:space:]]*$' | head -n1 || true
}
# Traduit la première ligne d'erreur gcloud en consigne actionnable. $1 = erreur,
# $2 = projet concerné.
explain_err() {
  case "$1" in
    *"The --platform flag is required"*)
      printf 'gcloud exige --platform=managed : mets à jour ce script (version ancienne).' ;;
    *"has not been used in project"*|*"is disabled"*)
      printf "l'API Cloud Run n'est pas activée dans ce projet :\n         gcloud services enable run.googleapis.com --project %s" "$2" ;;
    *"PERMISSION_DENIED"*|*"permission"*|*"denied"*)
      printf "le compte actif n'a pas le droit d'administrer Cloud Run ici :\n         gcloud auth login   (avec le compte propriétaire du projet)" ;;
    *billing*|*BILLING*|*FAILED_PRECONDITION*)
      printf 'facturation absente ou invalide sur ce projet :\n         https://console.cloud.google.com/billing/linkedaccount?project=%s' "$2" ;;
    *"not found"*|*"was not found"*|*"Not Found"*)
      printf "aucun service « %s » en %s dans ce projet (nom ou région différents ?)" "$SERVICE" "$REGION" ;;
    '')
      printf "aucune erreur gcloud — la commande a réussi mais n'a rien renvoyé" ;;
    *)
      printf 'erreur gcloud (voir la ligne ci-dessus)' ;;
  esac
}
project_number() { gcloud projects describe "$1" --format='value(projectNumber)' 2>/dev/null \
                     | tr -d '\r\n' | head -n1 || true; }
# num_of_host "drive-token-server-763848765523.europe-west1.run.app" → 763848765523
num_of_host() { local n="${1%%.*}"; n="${n#"$SERVICE"-}"
                case "$n" in ''|*[!0-9]*) return 1 ;; esac; printf '%s' "$n"; }
# `has "$chaine" "motif"` : teste une sous-chaîne SANS pipeline. Indispensable ici,
# car sous « set -o pipefail » un `printf … | grep -q` échoue AU HASARD : grep -q
# sort dès la 1re correspondance, le producteur reçoit SIGPIPE (141) et le pipeline
# est donc considéré comme en échec... alors que la chaîne EST présente (faux
# « secret OAuth absent », faux « authConfigured manquant »).
has()         { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
# Le service répond-il ? Sert à distinguer un vrai service d'un service « fantôme »
# qui boucle au démarrage (« container failed to start ») et ne répond jamais.
alive()       { has "$(curl -fsS -m 15 "$1/health" 2>/dev/null)" '"ok":true'; }

# Affiché SEULEMENT quand l'étape 1/6 échoue. Sans lui, « aucun service » laisse
# trois causes indiscernables : Cloud Shell ouvert avec un AUTRE compte Google,
# une erreur gcloud (droits insuffisants, API Cloud Run non activée, facturation)
# ou un service réellement déplacé/renommé. On montre donc ce que le script voit
# vraiment : compte actif, projets visibles, services de chaque projet, et la
# première ligne d'erreur éventuelle de gcloud.
diagnose_projects() {
  local out err pid pnum derr
  out="$(mktemp)"; err="$(mktemp)"
  echo "   ── ce que ce Cloud Shell voit réellement ──"
  echo "      compte actif     : ${ACCOUNT:-aucun}"
  echo "      comptes gcloud   : $(gcloud auth list --format='value(account)' 2>/dev/null | tr -d '\r' | tr '\n' ' ' || true)"
  if alive "https://$HOST"; then
    echo "      ✔ l'URL de l'app répond : le service EXISTE, il est seulement"
    echo "        invisible pour le compte actif ci-dessus (voir cause 1)."
  else
    echo "      ✘ l'URL de l'app ne répond pas : le service a peut-être été"
    echo "        supprimé, ou son URL a changé (voir cause 2)."
  fi
  gcloud projects list --format='value(projectId,projectNumber)' >"$out" 2>"$err" || true
  printf '      projets visibles : %s\n' "$(grep -c . "$out" || true)"
  if [ ! -s "$out" ]; then
    printf '      ✘ « gcloud projects list » a échoué : %s\n' "$(head -n1 "$err" | cut -c1-150)"
  fi
  while read -r pid pnum; do
    [ -n "${pid:-}" ] || continue
    gcloud run services list --platform=managed --project "$pid" \
      --format='value(metadata.name,status.url)' >"$out" 2>"$err" || true
    printf '        • %s (n° %s) : %s service(s)' "$pid" "${pnum:-?}" "$(grep -c . "$out" || true)"
    if [ -s "$out" ]; then
      echo
      grep -F "$SERVICE" "$out" | sed 's/^/            → /' || true
    elif [ -s "$err" ]; then
      printf '  ⚠ %s\n' "$(head -n1 "$err" | cut -c1-150)"
    else
      echo
    fi
    # `services list` peut réussir là où `services describe` échoue (API Cloud Run
    # non activée, droits, propriété run/platform) : c'est pourtant DESCRIBE que
    # l'étape 1/6 utilise pour comparer les URL, donc on montre aussi son erreur.
    derr="$(describe_err "$pid")"
    if [ -n "$derr" ]; then
      printf '            ⚠ « describe » : %s\n' "$(printf '%s' "$derr" | cut -c1-150)"
      printf '              → %s\n' "$(explain_err "$derr" "$pid")"
    fi
  done < <(gcloud projects list --format='value(projectId,projectNumber)' 2>/dev/null | tr -d '\r' || true)
  rm -f "$out" "$err"
}

cyan() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m  ✘ %s\033[0m\n\n' "$*" >&2; exit 1; }

# ── 0 · fichiers source ------------------------------------------------------
# L'étape 4 fait « cd $WORK » (=$HOME/tsrv), y RECOPIE $HOME/token-server.js et
# $HOME/package.json, puis « gcloud run deploy --source . ». Ces deux fichiers de
# $HOME sont donc la SEULE source déployée. Tout ce qui est déposé ailleurs est
# ignoré, ce qui a déjà produit un « old build » invisible :
#   - $HOME/tsrv est le dossier de travail du script : il est écrasé à chaque
#     lancement, y déposer les fichiers ne sert à rien ;
#   - un dossier intermédiaire (ex. ~/token-server) n'est JAMAIS lu — c'est ce
#     qui arrive quand le glisser-déposer a lieu alors que le terminal n'est pas
#     dans ~ : la NOUVELLE version tombe dans le sous-dossier, l'ANCIENNE dans ~
#     est déployée, la révision reste ancienne et l'app affiche « older build ».
# Le contrôle ci-dessous refuse ce cas AVANT d'avoir touché au service.
cyan "0/6 · fichiers source (lus UNIQUEMENT dans $HOME)"
cd "$HOME"
for f in token-server.js package.json; do
  [ -f "$HOME/$f" ] || die "Fichier manquant : $HOME/$f
   → dans Cloud Shell, tape « cd ~ » puis glisse-dépose $f dans la fenêtre, et relance.
   → un fichier déposé dans un SOUS-DOSSIER (ex. ~/tsrv, ~/token-server) ne compte
     pas : seul $HOME/$f part dans l'image."
done
grep -q '/api/auth/login' "$HOME/token-server.js" \
  || die "Ce token-server.js est une ANCIENNE version (routes /api/auth/* absentes).
   → reprends le fichier server/token-server.js du projet et relance."
grep -q '"start"' "$HOME/package.json" || die "package.json invalide (script \"start\" absent)."
# Marqueur de version : l'app teste la VALEUR « authChangePassword === true »
# (src/utils/labAuth.js), pas l'existence de la fonction serveur. Le contrôle
# porte donc sur le littéral « authChangePassword: true » et NON sur le seul mot
# « authChangePassword » : le nom de la fonction handleAuthChangePassword() vit
# aussi dans une version intermédiaire (commit « password ») qui possède la ROUTE
# mais n'annonce RIEN dans /api/auth/status (ok, configured, accounts, savedAt,
# adminPushEnabled, version) — la déployer « réussit », et l'app affiche quand
# même « older build ». Deux marqueurs attendus : /health ET /api/auth/status.
MARKER_RE='authChangePassword[[:space:]]*:[[:space:]]*true'
MARKERS="$(grep -Ec "$MARKER_RE" "$HOME/token-server.js" 2>/dev/null || true)"
if [ "${MARKERS:-0}" -lt 1 ]; then
  warn "$HOME/token-server.js n'annonce pas « authChangePassword: true » :"
  warn "  l'app le lit donc comme un build ANCIEN (elle refuse d'y enregistrer un"
  warn "  mot de passe), et c'est CE fichier qui serait déployé — même si une"
  warn "  copie à jour existe ailleurs."
  FOUND="$(find "$HOME" -maxdepth 3 -type f -name 'token-server.js' 2>/dev/null \
           -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- \
           | while IFS= read -r p; do
               if [ "$p" != "$HOME/token-server.js" ] && grep -Eq "$MARKER_RE" "$p"; then
                 printf '%s\n' "$p"
               fi
             done || true)"
  if [ -n "$FOUND" ]; then
    SRC="$(printf '%s\n' "$FOUND" | head -n1)"
    SRC_DIR="$(dirname "$SRC")"
    printf '\n  Copie(s) à jour trouvée(s) ailleurs :\n'
    printf '%s\n' "$FOUND" | sed 's/^/    /'
    cat <<EOF

  Corrige, puis relance le script (les DEUX fichiers doivent être dans \$HOME) :
      cp "$SRC" "$HOME/token-server.js"
      cp "$SRC_DIR/package.json" "$HOME/package.json"     # s'il existe dans ce dossier
      rm -rf "$HOME/tsrv"                                 # dossier de travail propre
      bash "$HOME/cloud-shell-quick-update.sh"
EOF
  else
    cat <<'EOF'

  Aucune copie à jour trouvée : le ou les fichiers téléversés sont périmés.
  → re-dépose server/token-server.js et server/package.json du projet dans ~
    (tape « cd ~ » AVANT de les glisser-déposer), puis relance le script.
EOF
  fi
  die "Refus de déployer un token-server.js périmé (aucun « authChangePassword: true »)."
fi
ok "token-server.js à jour : $MARKERS × « authChangePassword: true » + package.json"
[ "${MARKERS:-0}" -ge 2 ] \
  || warn "un seul endpoint annonce le marqueur (attendu : /health ET /api/auth/status)"
# Empreintes des fichiers RÉELLEMENT envoyés au build : en cas de doute, compare-les
# avec le PC :  Get-FileHash .\server\token-server.js -Algorithm SHA256
if command -v sha256sum >/dev/null 2>&1; then
  ok "sha256 token-server.js : $(sha256sum "$HOME/token-server.js" | cut -c1-16)…"
  ok "sha256 package.json    : $(sha256sum "$HOME/package.json" | cut -c1-16)…"
fi

# ── 1 · projet Google Cloud --------------------------------------------------
# ATTENTION : le service ne vit PAS forcément dans le projet Firebase
# (cell-experiment-tracker). Ici il vit dans le projet dont le NUMÉRO apparaît
# dans l'URL publique utilisée par l'app. On ne devine pas : on localise le
# service par son URL, sinon un déploiement créerait un service « fantôme »
# (sans volume /data, sans secret OAuth) qui plante au démarrage.
cyan "1/6 · projet Google Cloud"
ACCOUNT="$(gcloud config get-value account 2>/dev/null | tr -d '\r' | head -n1 || true)"
case "$ACCOUNT" in ''|'(unset)') ACCOUNT="" ;; esac
if [ -n "$ACCOUNT" ]; then
  ok "compte gcloud : $ACCOUNT"
else
  warn "aucun compte gcloud actif dans ce Cloud Shell — lance : gcloud auth login"
fi
HOST="$(host_of "$HEALTH_URL")"                # nom utilisé par l'application
APP_NUM="$(num_of_host "$HOST" || true)"       # 763848765523 (format <service>-<num>)
PROJECT="${TSRV_PROJECT:-}"
PROJECT_URL=""
if [ -n "$PROJECT" ]; then
  PROJECT_URL="$(service_url "$PROJECT")"
  if [ -z "$PROJECT_URL" ]; then
    DERR="$(describe_err "$PROJECT")"
    if [ -n "$DERR" ]; then HINT="$(explain_err "$DERR" "$PROJECT")"
    else HINT="le service n'existe pas dans ce projet (nom ou région différents ?)"; fi
    die "TSRV_PROJECT=$PROJECT : impossible de lire le service « $SERVICE » en $REGION.
   → erreur gcloud : ${DERR:-aucune}
   → $HINT"
  fi
  ok "projet forcé (TSRV_PROJECT) : $PROJECT"
else
  CAND=""; CAND_COUNT=0
  NEAR=""; NEAR_ERR=""   # projet dont le NUMÉRO est celui de l'app, mais illisible par gcloud
  MATCH_HOST=""; MATCH_HOST_URL=""; MATCH_NUM=""; MATCH_NUM_URL=""; SOLO=""; SOLO_URL=""
  # On parcourt TOUS les projets (sans s'arrêter au premier service trouvé) :
  # cela permet de signaler un éventuel service « fantôme » du même nom laissé
  # par un déploiement dans le mauvais projet.
  # UN SEUL appel gcloud pour toute la liste (identifiant + NUMÉRO) : le numéro de
  # projet est justement celui qui figure dans l'URL utilisée par l'app, on peut
  # donc comparer les deux directement, sans un `gcloud projects describe` par projet.
  PROJ_LIST="$(gcloud projects list --format='value(projectId,projectNumber)' 2>/dev/null | tr -d '\r' || true)"
  # ATTENTION : surtout PAS « IFS= read -r p pnum » ici. « IFS= » DÉSACTIVE le
  # découpage : la ligne entière — « <projet><TABULATION><numéro> », le format de
  # `--format='value(a,b)'` — partait dans $p et $pnum restait VIDE. $p contenait
  # alors une tabulation, donc chaque `run services describe` échouait, CAND
  # restait vide et l'étape 1/6 concluait « service introuvable » alors que le
  # compte, le projet et le service étaient parfaits (le diagnostic, lui, utilise
  # `read` SANS IFS= et listait bien le service : c'est ce qui rendait le
  # diagnostic et l'échec contradictoires). Cas réel : service nommé
  # drive-token-server-6eq5wljpia-ew.a.run.app dans le projet n° 763848765523,
  # alors que l'app utilise drive-token-server-763848765523.europe-west1.run.app.
  # « IFS= » ne se justifie que pour lire UNE variable (`while IFS= read -r l`).
  while read -r p pnum; do
    [ -n "${p:-}" ] || continue
    # Format inattendu (une seule colonne, séparateur changé…) : on redemande le
    # numéro au lieu de comparer une chaîne vide.
    case "${pnum:-}" in
      ''|*[!0-9]*) pnum="$(project_number "$p")" ;;
    esac
    [ -n "${pnum:-}" ] || pnum="$p"
    u="$(service_url "$p")"
    if [ -z "$u" ]; then
      # Ce projet porte-t-il le numéro écrit dans l'URL de l'app ? Si oui, l'échec
      # vient de gcloud (API Cloud Run, droits, propriété run/platform) et NON de
      # l'emplacement du service : on mémorise le projet ET l'erreur exacte.
      if [ -n "$APP_NUM" ] && [ -z "$NEAR" ] && [ "$pnum" = "$APP_NUM" ]; then
        NEAR="$p"; NEAR_ERR="$(describe_err "$p")"
      fi
      continue
    fi
    CAND_COUNT=$((CAND_COUNT + 1)); CAND="$CAND
     - $p → $u"
    if [ -z "$MATCH_HOST" ] && [ "$(host_of "$u")" = "$HOST" ]; then
      MATCH_HOST="$p"; MATCH_HOST_URL="$u"; continue
    fi
    if [ -z "$MATCH_NUM" ] && [ -n "$APP_NUM" ] && [ "$pnum" = "$APP_NUM" ]; then
      MATCH_NUM="$p"; MATCH_NUM_URL="$u"; continue
    fi
    SOLO="$p"; SOLO_URL="$u"
  done <<< "$PROJ_LIST"

  if [ -n "$MATCH_HOST" ]; then
    PROJECT="$MATCH_HOST"; PROJECT_URL="$MATCH_HOST_URL"
    ok "projet identifié par le nom du service utilisé par l'app"
  elif [ -n "$MATCH_NUM" ]; then
    # Cloud Run expose chaque service sous DEUX noms : l'ancien
    # <service>-<numéro>.run.app (celui que l'app utilise) et le nouveau
    # <service>-<jeton>-<région>.a.run.app (celui que rend gcloud). Les deux
    # répondent : on se fie au numéro de projet contenu dans l'URL de l'app.
    PROJECT="$MATCH_NUM"; PROJECT_URL="$MATCH_NUM_URL"
    ok "projet identifié par le numéro de l'URL utilisée par l'app ($APP_NUM)"
    warn "gcloud nomme ce service : $(host_of "$PROJECT_URL")"
    warn "  (c'est le même service : l'app continue d'utiliser $HOST)"
  elif [ "$CAND_COUNT" -eq 1 ] && alive "$SOLO_URL"; then
    # Aucune correspondance de nom, mais un seul service de ce nom, et il répond :
    # mieux vaut continuer que s'arrêter sur une simple différence d'URL.
    PROJECT="$SOLO"; PROJECT_URL="$SOLO_URL"
    warn "aucune URL ne correspondait, mais un seul service « $SERVICE » existe et il répond : $(host_of "$PROJECT_URL")"
  else
    [ -n "$CAND" ] || CAND="
     aucun"
    diagnose_projects
    if [ -n "$NEAR" ]; then
      if [ -n "$NEAR_ERR" ]; then HINT="$(explain_err "$NEAR_ERR" "$NEAR")"
      else HINT="le service n'a pas été renvoyé par gcloud (nom ou région différents ?)"; fi
      die "gcloud ne parvient pas à LIRE le service dans le projet qui l'héberge.
   → projet attendu  : $NEAR (numéro $APP_NUM, celui de l'URL de l'app : $HOST)
   → erreur gcloud   : ${NEAR_ERR:-aucune}
   → $HINT
   → une fois la cause corrigée, force le projet si besoin :
        TSRV_PROJECT=$NEAR bash ~/cloud-shell-quick-update.sh"
    fi
    die "Service « $SERVICE » introuvable parmi les projets visibles de CE compte.
   → l'app utilise : $HOST
   → services portant ce nom :$CAND
   → causes probables, dans l'ordre :
     1. Cloud Shell est ouvert avec un AUTRE compte Google que le propriétaire
        du projet qui héberge le service (le diagnostic ci-dessus affiche le
        compte actif et les projets qu'il voit) :
           gcloud auth list
           gcloud auth login                       # ajoute le bon compte
           gcloud config set account <adresse@gmail.com>
        puis relance ce script.
     2. Le service a été déplacé/renommé : ouvre https://console.cloud.google.com/run
        (colonne « Projet ») pour lire son identifiant, puis :
           TSRV_PROJECT=<identifiant-du-projet> bash ~/cloud-shell-quick-update.sh"
  fi
  OTHERS="$(printf '%s\n' "$CAND" | grep -v -F -- " - $PROJECT →" | sed '/^[[:space:]]*$/d' || true)"
  if [ -n "$OTHERS" ]; then
    warn "autre(s) service(s) du même nom, dans un autre projet (à supprimer pour éviter la confusion) :$OTHERS"
  fi
fi
gcloud config set project "$PROJECT" >/dev/null 2>&1 || true
HEALTH_URL="$PROJECT_URL/health"
ok "projet : $PROJECT (celui qui héberge le service)"
ok "service : $(host_of "$PROJECT_URL")"
ok "compte : $(gcloud config get-value account 2>/dev/null || echo '?')"
# L'app utilise peut-être l'AUTRE nom du même service : on vérifie aussi son URL,
# et on prévient si elle ne répond plus (l'app pointerait alors dans le vide).
if [ "https://$HOST/health" != "$HEALTH_URL" ]; then
  if alive "https://$HOST"; then
    ok "l'URL utilisée par l'app répond aussi : $HOST"
  else
    warn "l'URL utilisée par l'app ne répond PAS : https://$HOST/health"
    warn "  → mets à jour GOOGLE_TOKEN_EXCHANGE_URL dans src/data/constants.js avec :"
    warn "     https://$(host_of "$PROJECT_URL")"
  fi
fi
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)"
case "$BILLING" in
  True)  ok "facturation active" ;;
  False) die "Ce projet n'a PAS de compte de facturation associé : Cloud Run refuse de déployer dans ce cas.
   → ouvre https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT
     et associe un compte de facturation actif (ou crée-le : « Create account »,
     avec un moyen de paiement), puis relance le script.
   → coût réel attendu : 0 € — Cloud Run s'arrête tout seul sans requête et les
     paliers gratuits couvrent largement ce service." ;;
  *)     warn "facturation non vérifiable (on continue quand même)" ;;
esac
# Pré-vol : le service existant doit déjà porter le secret OAuth, sinon le serveur
# sort immédiatement (process.exit(1)) et Cloud Run signalerait « failed to start ».
has "$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --platform=managed --format='yaml(spec.template.spec.containers[0].env)' 2>/dev/null || true)" 'GOOGLE_CLIENT_SECRET' \
  || die "Le service « $SERVICE » ($PROJECT) n'a pas de variable GOOGLE_CLIENT_SECRET :
   le serveur refuserait de démarrer. Complète d'abord le service avec
     server/deploy-cloud-run.sh -a <origine de l'app> -p $PROJECT -c client_secret.json"
ok "secret OAuth présent (GOOGLE_CLIENT_SECRET)"
has "$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --platform=managed --format='yaml(spec.template.spec.containers[0].volumeMounts)' 2>/dev/null || true)" '/data' \
  || warn "aucun volume monté sur /data : le jeton Drive ne survivrait pas à un redémarrage"

# ── 2 · clé de service Firebase ---------------------------------------------
cyan "2/6 · clé de service Firebase (signature des jetons)"
mkdir -p "$WORK"
cd "$WORK"
cp "$HOME/token-server.js" "$HOME/package.json" .
# la clé de service ne doit jamais partir dans l'image : elle reste locale.
cat > .gcloudignore <<'IGNORE'
firebase-sa.json
node_modules
IGNORE

create_key() {   # $1 = e-mail du compte de service
  gcloud iam service-accounts keys create firebase-sa.json \
    --iam-account "$1" --project "$FIREBASE_PROJECT" >/dev/null 2>&1
}

if [ -s firebase-sa.json ]; then
  ok "clé existante réutilisée (inutile d'en créer une autre)"
else
  SA_EMAIL="$(gcloud iam service-accounts list --project "$FIREBASE_PROJECT" \
    --filter='email~firebase-adminsdk' --format='value(email)' --limit=1 2>/dev/null | head -n1 || true)"
  if [ -z "$SA_EMAIL" ]; then
    warn "compte firebase-adminsdk introuvable — création d'un compte dédié"
    SA_EMAIL="drive-token-signer@$FIREBASE_PROJECT.iam.gserviceaccount.com"
    gcloud iam service-accounts create drive-token-signer --project "$FIREBASE_PROJECT" \
      --display-name "Lab Workspace token signer" >/dev/null 2>&1 || true
  fi
  if ! create_key "$SA_EMAIL"; then
    warn "clé refusée pour $SA_EMAIL — essai avec un compte dédié"
    SA_EMAIL="drive-token-signer@$FIREBASE_PROJECT.iam.gserviceaccount.com"
    gcloud iam service-accounts create drive-token-signer --project "$FIREBASE_PROJECT" \
      --display-name "Lab Workspace token signer" >/dev/null 2>&1 || true
    create_key "$SA_EMAIL" || die "Création de clé impossible.
   → console Cloud : IAM et administration → Comptes de service → $SA_EMAIL
     → onglet Clés → Ajouter une clé → JSON ; téléverse ensuite le fichier dans
     ce dossier (~/tsrv) sous le nom firebase-sa.json et relance le script.
   → si le bouton est grisé, la politique d'organisation du projet interdit les
     clés (iam.disableServiceAccountKeyCreation) : il faut l'autoriser d'abord."
  fi
  ok "clé créée pour $SA_EMAIL"
fi
[ -s firebase-sa.json ] || die "firebase-sa.json vide ou illisible."
SA_B64="$(base64 -w0 firebase-sa.json)"
ok "clé encodée (${#SA_B64} caractères)"

# ── 3 · jeton administrateur -------------------------------------------------
# RÉUTILISÉ par défaut : ce redéploiement sert à faire entrer du CODE (une route
# nouvelle), pas à changer le jeton. En générer un nouveau à chaque fois
# invalidait silencieusement celui déjà collé dans le navigateur (Setup →
# Sécurité serveur) : « ⬆ Publier les comptes » se mettait alors à répondre 401,
# sans aucun rapport apparent avec la mise à jour. On reprend donc le jeton du
# service s'il en a un ; sinon celui de ~/ADMIN_TOKEN.txt ; sinon on en crée un.
# Rotation volontaire :  ROTATE_ADMIN_TOKEN=1 bash ~/cloud-shell-quick-update.sh
cyan "3/6 · jeton d'administration (ADMIN_TOKEN)"
TOKEN_REUSED=0
ENV_YAML="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --platform=managed --format='yaml(spec.template.spec.containers[0].env)' 2>/dev/null || true)"
LIVE_TOKEN="$(printf '%s\n' "$ENV_YAML" \
  | awk '/name: ADMIN_TOKEN/{getline; sub(/^[[:space:]]*value:[[:space:]]*/,""); gsub(/"/,""); print; exit}')"
FILE_TOKEN=""
if [ -s "$HOME/ADMIN_TOKEN.txt" ]; then
  FILE_TOKEN="$(tr -d '\r\n' < "$HOME/ADMIN_TOKEN.txt" 2>/dev/null || true)"
fi
if [ "${ROTATE_ADMIN_TOKEN:-}" = "1" ]; then
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  warn "ROTATE_ADMIN_TOKEN=1 : le jeton CHANGE — il faudra le recoller dans l'app"
elif [ -n "$LIVE_TOKEN" ]; then
  ADMIN_TOKEN="$LIVE_TOKEN"; TOKEN_REUSED=1
  ok "jeton déjà en service RÉUTILISÉ (aucun recollage à faire dans l'app)"
elif [ -n "$FILE_TOKEN" ]; then
  ADMIN_TOKEN="$FILE_TOKEN"; TOKEN_REUSED=1
  ok "jeton repris de ~/ADMIN_TOKEN.txt (le service n'en avait pas encore)"
else
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  ok "jeton généré (première mise en place)"
fi
printf '%s\n' "$ADMIN_TOKEN" > "$HOME/ADMIN_TOKEN.txt"
chmod 600 "$HOME/ADMIN_TOKEN.txt" 2>/dev/null || true
ok "longueur : ${#ADMIN_TOKEN} caractères — copie de secours : ~/ADMIN_TOKEN.txt"

# ── 4 · déploiement ----------------------------------------------------------
cyan "4/6 · déploiement Cloud Run (2 à 4 minutes, ne rien fermer)"
# Étiquette de build : passée dans l'environnement du service, donc relue dans
# /health (« version »). Sans elle, /health affiche la valeur du déploiement
# PRÉCÉDENT (un commit, ou « dev » posé par deploy-cloud-run.sh) : impossible de
# distinguer « la mise à jour n'est jamais passée » de « elle est passée ». C'est
# ce champ qu'on vérifie à l'étape 5.
BUILD_TAG="qs-$(date -u +%Y%m%d-%H%M%S)"
LOG="$HOME/tsrv-deploy.log"
deploy_run() {
  gcloud run deploy "$SERVICE" \
    --source . \
    --project "$PROJECT" --region "$REGION" --platform=managed \
    --allow-unauthenticated \
    --update-env-vars "ACCOUNTS_FILE=/data/workspace-accounts.json,FIREBASE_SERVICE_ACCOUNT_B64=$SA_B64,ADMIN_TOKEN=$ADMIN_TOKEN,CODE_VERSION=$BUILD_TAG" \
    --quiet 2>&1 | tee "$LOG"
}
deploy_diagnose() {
  echo
  warn "journal complet conservé dans : $LOG"
  echo "────────── dernières lignes de gcloud (à recopier) ──────────"
  tail -n 40 "$LOG"
  echo "─────────────────────── diagnostic rapide ───────────────────"
  grep -inE "error|permission|denied|not enabled|has not been used|billing|quota|exhausted|build fail|artifact|bad syntax|invalid|not found|FAILED_PRECONDITION|UNAUTHENTICATED|expired" "$LOG" | head -n 15 || true
  echo "─────────────────────────────────────────────────────────────"
  # Panne très fréquente juste après un premier déploiement : l'image se
  # construit mais le conteneur ne prend pas la main (revue dans les logs).
  if grep -qiE "failed to start and listen|container failed to start" "$LOG"; then
    echo "────────── cause probable : le serveur n'a pas démarré ──────"
    echo "  node s'est arrêté immédiatement. Deux causes classiques :"
    echo "   • GOOGLE_CLIENT_SECRET absent sur le service (token-server.js sort"
    echo "     volontairement en erreur) ;"
    echo "   • service déployé dans un projet où il N'EXISTAIT PAS : la révision"
    echo "     est alors neuve, donc sans volume /data, sans secret, sans compte"
    echo "     de service → le script a été lancé avec un service absent."
    echo "  Logs du conteneur :"
    echo "     gcloud run services logs read $SERVICE --project $PROJECT --region $REGION --platform=managed --limit 30"
    echo "─────────────────────────────────────────────────────────────"
  fi
}

# Rattrapage automatique nº 1 : sur les projets récents, le compte de service
# Cloud Build (…-compute@developer.gserviceaccount.com) n'a plus le rôle Editor
# et ne peut donc pas lire le code source envoyé au build.
fix_build_permissions() {
  BUILD_SA="$(gcloud builds get-default-service-account --project "$PROJECT" 2>/dev/null | tr -d '\r\n' || true)"
  case "$BUILD_SA" in
    *@*.iam.gserviceaccount.com) ;;
    *) BUILD_SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null | tr -d '\r\n')-compute@developer.gserviceaccount.com" ;;
  esac
  warn "compte de service Cloud Build : $BUILD_SA"
  for r in roles/run.builder roles/storage.objectViewer roles/artifactregistry.writer roles/logging.logWriter; do
    if gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILD_SA" --role="$r" --condition=None --quiet >/dev/null 2>&1; then
      ok "$r"
    else
      warn "$r : non appliqué"
    fi
  done
  warn "propagation des droits IAM (20 s)…"
  sleep 20
}

if deploy_run; then
  ok "nouvelle révision déployée"
elif grep -q "missing required IAM permissions" "$LOG"; then
  warn "droits IAM manquants sur le compte de service Cloud Build — correction automatique puis nouvel essai"
  fix_build_permissions
  if deploy_run; then
    ok "nouvelle révision déployée (après correction des droits)"
  else
    deploy_diagnose
    die "Le déploiement a échoué de nouveau (voir les 40 lignes ci-dessus)."
  fi
else
  deploy_diagnose
  die "Le déploiement a échoué.
   → recopie-moi les 40 lignes ci-dessus (la ligne « ERROR » est la plus utile)."
fi

# ── 5 · vérification ---------------------------------------------------------
cyan "5/6 · vérification du serveur"
sleep 5
BODY="$(curl -s -m 30 "$HEALTH_URL" || true)"
# Le nom affiché par gcloud peut différer de celui utilisé par l'app : si la
# réponse n'est pas concluante, on réessaie avec le nom de l'app (même service).
if ! has "$BODY" '"authConfigured":true' && [ "https://$HOST/health" != "$HEALTH_URL" ]; then
  warn "pas de réponse concluante sur $(host_of "$HEALTH_URL") — essai avec le nom utilisé par l'app"
  HEALTH_URL="https://$HOST/health"
  BODY="$(curl -s -m 30 "$HEALTH_URL" || true)"
fi
printf '%s\n' "$BODY"
has "$BODY" '"authConfigured":true' \
  || die "Le serveur répond mais n'a pas chargé la clé (authConfigured manquant).
   → relance le script ; si l'erreur persiste, envoie-moi la réponse ci-dessus."
ok "le serveur peut signer les jetons ($(host_of "$HEALTH_URL"))"

# Marqueur de capacité : /health ne renvoie « authChangePassword » que sur un
# build qui connaît POST /api/auth/change-password. Sans ce contrôle, un
# déploiement qui n'a PAS pris le nouveau token-server.js (fichier non
# re-téléversé, ancienne révision encore servie) passait inaperçu : l'app
# répondait ensuite « Unknown grant_type "" » et « Change My Password » semblait
# sans effet. Mieux vaut échouer ICI, au moment du déploiement.
has "$BODY" '"authChangePassword":true' \
  || die "Le serveur déployé ne connaît pas POST /api/auth/change-password (marqueur authChangePassword absent de /health).
   → le token-server.js téléversé est l'ANCIEN : re-dépose-le dans Cloud Shell
     (avec package.json) puis relance le script."
ok "le serveur connaît le changement de mot de passe (authChangePassword)"

# Preuve que la révision qui répond est bien CELLE QU'ON VIENT DE CONSTRUIRE :
# l'étiquette passée à l'étape 4 doit apparaître dans /health. Sans ce contrôle,
# une ancienne révision qui continue de servir le trafic passait pour un succès
# (mêmes routes, mêmes réglages) — c'est le « déploiement qui n'a pas pris ».
if has "$BODY" "\"version\":\"$BUILD_TAG\""; then
  ok "la révision qui répond est celle construite à l'instant ($BUILD_TAG)"
else
  warn "la révision qui répond N'EST PAS celle construite à l'instant."
  warn "  attendu : \"version\":\"$BUILD_TAG\"  —  reçu : $(printf '%s' "$BODY" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  warn "  → une ancienne révision sert encore le trafic (déploiement interrompu,"
  warn "    ou trafic non basculé). Regarde $LOG et relance le script."
fi

# CORS — indispensable pour « ⬆ Publier les comptes » : le navigateur n'envoie
# cet appel (en-tête X-Admin-Token) que si le préflight l'autorise. Sinon il
# l'annule lui-même et l'app affiche « Serveur de jetons injoignable (Failed to
# fetch) » : la requête n'arrive JAMAIS ici (elle n'apparaît dans aucun log).
APP_ORIGIN="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --platform=managed --format='yaml(spec.template.spec.containers[0].env)' 2>/dev/null \
  | awk '/name: ALLOWED_ORIGINS/{getline; sub(/^[[:space:]]*value:[[:space:]]*/,""); sub(/,.*$/,""); print; exit}' || true)"
if [ -z "$APP_ORIGIN" ]; then
  warn "CORS non vérifié (ALLOWED_ORIGINS illisible sur le service)"
else
  ACAH="$(curl -s -i -m 20 -X OPTIONS "https://$HOST/api/auth/accounts" \
    -H "Origin: $APP_ORIGIN" -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type,x-admin-token' \
    | tr -d '\r' | awk 'tolower($1)=="access-control-allow-headers:"{sub(/^[^:]*:[[:space:]]*/,""); print; exit}' || true)"
  case "$ACAH" in
    *[Xx]-[Aa]dmin-[Tt]oken*)
      ok "l'app pourra publier les comptes (X-Admin-Token autorisé par CORS)" ;;
    *)
      warn "CORS : X-Admin-Token NON autorisé pour l'origine $APP_ORIGIN"
      warn "  → l'app afficherait « Serveur de jetons injoignable (Failed to fetch) »"
      warn "  → vérifie que le token-server.js téléversé contient bien CORS_ALLOW_HEADERS, puis relance" ;;
  esac
fi

# ── 6 · contrôle des réglages préservés -------------------------------------
cyan "6/6 · contrôle que le Drive et le reste sont intacts"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --platform=managed \
  --format='yaml(spec.template.spec.containers[0].volumeMounts,spec.template.spec.serviceAccountName)' || true

# ── Résumé -------------------------------------------------------------------
if [ "$TOKEN_REUSED" = "1" ]; then
  printf '\n\033[1;32m======== ADMIN_TOKEN — INCHANGÉ (rien à recoller) =========\n'
else
  printf '\n\033[1;33m======== ADMIN_TOKEN — À COPIER MAINTENANT ================\n'
fi
printf '%s\n' "$ADMIN_TOKEN"
printf '==========================================================\033[0m\n'
cat <<EOF

  Il te reste DEUX choses à faire dans l'application :

   1. Drive : rien à changer. Chaque personne écrit dans ton Drive exactement
      comme aujourd'hui (aucune connexion Google pour elle).

   2. Comptes : ouvre l'app, connecte-toi en superutilisateur, puis
        Setup → Équipe & accès → 🛡️ Sécurité serveur
      - vérifie « Signature de jetons : configurée »
      - jeton : si le cadre ci-dessus indique INCHANGÉ, celui déjà enregistré dans
        ce navigateur convient — ne recopie rien ; sinon colle l'ADMIN_TOKEN ci-dessus
      - presse « ⬆ Publier les comptes »
      ⚠️ AVANT de publier les règles Firestore (étape 6 du document), vérifie que
         l'avertissement « N fiche(s) sans mot de passe » est ABSENT : une fiche
         sans mot de passe ne pourra plus se connecter.

  Si tu perds l'ADMIN_TOKEN, relis-le avec :
     gcloud run services describe $SERVICE --project $PROJECT --region $REGION \\
       --format='value(spec.template.spec.containers[0].env)'
EOF
if [ -n "$OTHERS" ]; then
  cat <<EOF

  ⚠️  Un service « fantôme » du même nom existe dans un AUTRE projet (voir
     l'avertissement de l'étape 1/6). Le vrai service — celui que l'app utilise —
     est resté intact, mais pour éviter toute confusion supprime le fantôme :
       gcloud run services delete $SERVICE --project <projet concerné> --region $REGION --quiet
EOF
fi

