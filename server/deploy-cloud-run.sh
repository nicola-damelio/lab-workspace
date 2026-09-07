#!/usr/bin/env bash
# ============================================================================
# server/deploy-cloud-run.sh - one-shot publisher for the shared "Lab
# Workspace" Drive token server on Google Cloud Run (Linux / Cloud Shell twin
# of deploy-cloud-run.ps1).
#
# The credential FILE keeps working on Cloud Run because a Cloud Storage
# bucket is mounted as a /data volume (FUSE): the server stores its token
# there, untouched code, surviving every instance recycle / scale-to-zero.
#
# REQUIREMENTS
#   1. gcloud available and authenticated. Easiest: Google Cloud Shell
#      (cloud.google.com/shell) - gcloud is preinstalled and already logged
#      in with the account you used to open the console.
#   2. The Google Cloud project has billing enabled.
#   3. The OAuth client secret for GOOGLE_DRIVE_CLIENT_ID, as a downloaded
#      client_secret.json (or any plain-text file with the secret).
#
# EXAMPLE (run from the folder containing token-server.js and this script)
#   bash deploy-cloud-run.sh \
#     -a "https://your-app.example.com" \
#     -p "YOUR_PROJECT_ID" \
#     -c "$HOME/client_secret.json"
#
# What it does: enables the required APIs, creates a dedicated least-privilege
# service account, stores the OAuth client secret in Secret Manager, creates a
# small credential bucket, grants only the needed roles, and deploys the Cloud
# Run service (max 1 instance so the single credential file is never written
# concurrently). Re-running it just redeploys / patches the same service.
#
# At the end it prints the service HTTPS URL to paste into
#   src/data/constants.js  ->  GOOGLE_TOKEN_EXCHANGE_URL
# ============================================================================
set -euo pipefail

REGION="europe-west1"
SERVICE="drive-token-server"
SHARED_EMAIL="nicola.damelio@gmail.com"
PROJECT=""
APP_ORIGIN="http://localhost:5173"
CLIENT_ID=""
CLIENT_SECRET_FILE=""
BUCKET=""

usage() {
  cat <<'EOF'
Usage: bash deploy-cloud-run.sh [options]

Options:
  -a APP_ORIGIN   Origin(s) of the web app, comma-separated, e.g.
                  https://your-app.example.com
                  (default: http://localhost:5173)
  -p PROJECT      Google Cloud project ID (default: gcloud config project)
  -r REGION       Cloud Run region (default: europe-west1)
  -s SERVICE      Cloud Run service name (default: drive-token-server)
  -e EMAIL        Workspace owner e-mail (default: nicola.damelio@gmail.com)
  -i CLIENT_ID    OAuth web-client ID to use (default: the ID hard-coded in
                  token-server.js)
  -c FILE         Path to client_secret.json (or plain-text secret file)
                  (default: $GOOGLE_CLIENT_SECRET env var)
  -b BUCKET       Credential bucket name (default: <project>-token-store)
  -h              Show this help
EOF
  exit 1
}

while getopts "a:p:r:s:e:i:c:b:h" opt; do
  case "$opt" in
    a) APP_ORIGIN="$OPTARG" ;;
    p) PROJECT="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    s) SERVICE="$OPTARG" ;;
    e) SHARED_EMAIL="$OPTARG" ;;
    i) CLIENT_ID="$OPTARG" ;;
    c) CLIENT_SECRET_FILE="$OPTARG" ;;
    b) BUCKET="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

die() { echo; echo "ERROR: $*" >&2; echo "Nothing was changed that could not simply be re-run." >&2; exit 1; }

# --- Pre-flight checks -----------------------------------------------------
command -v gcloud >/dev/null 2>&1 || die 'gcloud not found. Use Google Cloud Shell (https://cloud.google.com/shell) or install the SDK.'
ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format 'value(account)' 2>/dev/null | head -n1 || true)"
[ -n "$ACTIVE_ACCOUNT" ] || die 'No active gcloud account. Run "gcloud auth login" first.'
if [ -z "$PROJECT" ]; then
  PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
fi
[ -n "$PROJECT" ] || die 'No project given. Use -p PROJECT_ID or run "gcloud config set project PROJECT_ID".'
echo "Account: $ACTIVE_ACCOUNT"
echo "Project: $PROJECT"
echo "Region:  $REGION"

# --- Resolve the OAuth client secret ----------------------------------------
extract_secret() {
  local f="$1"
  if command -v python3 >/dev/null 2>&1; then
    local out
    out="$(python3 - "$f" 2>/dev/null <<'PY' || true
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get('web', {}).get('client_secret', '').strip())
except Exception:
    raise SystemExit(1)
PY
)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  fi
  # Fallback: treat the whole file as the secret.
  tr -d '\r\n' < "$f"
}
SECRET=""
if [ -n "$CLIENT_SECRET_FILE" ]; then
  [ -f "$CLIENT_SECRET_FILE" ] || die "ClientSecretFile not found: $CLIENT_SECRET_FILE"
  SECRET="$(extract_secret "$CLIENT_SECRET_FILE")"
elif [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  SECRET="$GOOGLE_CLIENT_SECRET"
fi
[ -n "$SECRET" ] || die 'OAuth client secret missing. Use -c "path/to/client_secret.json" or export GOOGLE_CLIENT_SECRET.'
if [[ "$SECRET" =~ [[:space:]] ]]; then
  echo "WARNING: the client secret contains whitespace - check that the downloaded JSON was selected." >&2
fi

# --- Enable APIs (idempotent, may take a couple of minutes) -------------------
echo; echo "Enabling required APIs (first run only, can take a minute)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com --project "$PROJECT" || \
  die 'Could not enable the required APIs. Check that billing is enabled: https://console.cloud.google.com/billing'
echo 'APIs enabled.'

# --- Dedicated service account ------------------------------------------------
SA_NAME="drive-token-sa"
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name 'Drive token server'
fi
for ROLE in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA_EMAIL" --role "$ROLE" --quiet >/dev/null 2>&1 || true
done
echo "Service account ready: $SA_EMAIL"
# --- Store the client secret in Secret Manager --------------------------------
SECRET_NAME="drive-token-client-secret"
if ! gcloud secrets describe "$SECRET_NAME" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET_NAME" --project "$PROJECT" --replication-policy automatic
fi
TMP_SECRET="$(mktemp)"
trap 'rm -f "$TMP_SECRET"' EXIT
printf '%s' "$SECRET" > "$TMP_SECRET"
gcloud secrets versions add "$SECRET_NAME" --data-file="$TMP_SECRET" --project "$PROJECT" >/dev/null || \
  die "Could not store the secret value in $SECRET_NAME."
gcloud secrets add-iam-policy-binding "$SECRET_NAME" --member "serviceAccount:$SA_EMAIL" \
  --role roles/secretmanager.secretAccessor --project "$PROJECT" --quiet >/dev/null 2>&1 || true
echo 'Client secret stored in Secret Manager.'

# --- Credential bucket ----------------------------------------------------------
if [ -z "$BUCKET" ]; then
  BUCKET="$(printf '%s' "$PROJECT" | tr -cd 'a-z0-9-')-token-store"
  BUCKET="${BUCKET:0:60}"
  BUCKET="${BUCKET%-}"
fi
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Creating bucket gs://$BUCKET ..."
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" || \
    die "Could not create bucket gs://$BUCKET (name must be globally unique - use -b to override)."
fi
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA_EMAIL" \
  --role roles/storage.objectAdmin >/dev/null 2>&1 || gsutil iam ch "serviceAccount:$SA_EMAIL:objectAdmin" "gs://$BUCKET" || \
  die "Could not grant bucket access to $SA_EMAIL."
echo "Credential bucket ready: gs://$BUCKET"
# --- Build identity: Artifact Registry + source staging bucket ------------------
# 'gcloud run deploy --source' builds with the Compute Engine default service
# account (COMPUTE_SA). That build account needs to read/write the Artifact
# Registry repository and read the 'run-sources-*' staging bucket that receives
# the uploaded source zip. Create both up-front and grant the roles so a deploy
# works on a brand-new project with no manual IAM fixing.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)' 2>/dev/null || true)"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
if [ -n "$PROJECT_NUMBER" ]; then
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$COMPUTE_SA" \
    --role roles/logging.logWriter --quiet >/dev/null 2>&1 || true
fi
AR_REPO="cloud-run-source-deploy"
if ! gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Creating Artifact Registry repository $AR_REPO (docker) ..."
  gcloud artifacts repositories create "$AR_REPO" --repository-format docker \
    --location "$REGION" --project "$PROJECT" >/dev/null || \
    die "Could not create the Artifact Registry repository $AR_REPO."
fi
if [ -n "$PROJECT_NUMBER" ]; then
  gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --project "$PROJECT" \
    --member "serviceAccount:$COMPUTE_SA" --role roles/artifactregistry.writer --quiet >/dev/null 2>&1 || true
fi
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --project "$PROJECT" \
  --member "serviceAccount:$SA_EMAIL" --role roles/artifactregistry.reader --quiet >/dev/null 2>&1 || true
RUN_SRC_BUCKET="run-sources-$PROJECT-$REGION"
if ! gcloud storage buckets describe "gs://$RUN_SRC_BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$RUN_SRC_BUCKET" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 || true
fi
if [ -n "$PROJECT_NUMBER" ]; then
  gcloud storage buckets add-iam-policy-binding "gs://$RUN_SRC_BUCKET" --project "$PROJECT" \
    --member "serviceAccount:$COMPUTE_SA" --role roles/storage.objectViewer --quiet >/dev/null 2>&1 || true
fi
echo "Build identity ready: repository $AR_REPO + staging bucket $RUN_SRC_BUCKET"
# --- Deploy ---------------------------------------------------------------------
ORIGINS="$(printf '%s' "$APP_ORIGIN" | tr ',' '\n' | sed -e 's#/$##' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' | paste -sd, -)"
case ",$ORIGINS," in
  *,http://localhost:5173,*) : ;;
  *) ORIGINS="$ORIGINS,http://localhost:5173" ;;
esac
# Stamp the git commit into /health so "did my deploy actually happen?" is a
# one-line check: fetch "<url>/health" and read the "version" field.
CODE_VERSION="$(git -C "$(dirname "$0")" rev-parse --short HEAD 2>/dev/null || echo 'dev')"
# Pass the environment via a YAML file (--env-vars-file) rather than
# --set-env-vars: gcloud parses --set-env-vars as a comma-separated KEY=VALUE
# list, so a comma INSIDE a value (two allowed origins, e.g. localhost + the
# production Vercel URL) is misread as the start of a new key and gcloud aborts
# with "Bad syntax for dict arg". The file form needs no in-flag escaping.
ENV_FILE="$(mktemp)"
trap 'rm -f "$TMP_SECRET" "$ENV_FILE"' EXIT
{
  printf 'STORE_FILE: "/data/workspace-shared-token.json"\n'
  printf 'SHARED_EMAIL: "%s"\n' "$SHARED_EMAIL"
  printf 'ALLOWED_ORIGINS: "%s"\n' "$ORIGINS"
  printf 'CODE_VERSION: "%s"\n' "$CODE_VERSION"
  if [ -n "$CLIENT_ID" ]; then
    printf 'GOOGLE_CLIENT_ID: "%s"\n' "$CLIENT_ID"
  fi
} > "$ENV_FILE"

echo; echo "Deploying Cloud Run service '$SERVICE' (build + push, first time can take ~3-5 min)..."
gcloud run deploy "$SERVICE" \
  --source "$(cd "$(dirname "$0")" && pwd)" \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --service-account "$SA_EMAIL" \
  --execution-environment gen2 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60 \
  --add-volume name=tokenstore,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount volume=tokenstore,mount-path=/data \
  --env-vars-file "$ENV_FILE" \
  --set-secrets "GOOGLE_CLIENT_SECRET=$SECRET_NAME:latest" || \
  die "gcloud run deploy failed. Tip: run 'gcloud components update' if a flag was rejected."

# --- Done ------------------------------------------------------------------------
URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)' 2>/dev/null || true)"
echo
echo "==================== DEPLOYED ===================="
echo "Service URL:  $URL"
echo "Health check: $URL/health   (expect { \"ok\": true, \"initialized\": false, \"version\": \"$CODE_VERSION\" })"
echo
echo 'NEXT STEPS'
echo '  1. Paste the Service URL into GOOGLE_TOKEN_EXCHANGE_URL in src/data/constants.js'
echo '     (shared mode is already enabled), rebuild and redeploy the app.'
echo '  2. One-time owner bootstrap: open the DEPLOYED app with ?drive-bootstrap=1 in the'
echo '     URL, click "Connect Drive" and approve the Google consent.'
echo '  3. Verify: open "<Service URL>/health" again -> "initialized": true.'
echo '     Other browsers/machines now use Drive with no Google popup.'
echo '================================================='
