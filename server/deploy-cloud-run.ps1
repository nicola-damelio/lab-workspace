# ============================================================================
# server/deploy-cloud-run.ps1 - one-shot publisher for the shared "Lab
# Workspace" Drive token server on Google Cloud Run.
#
# The credential FILE keeps working on Cloud Run because a Cloud Storage
# bucket is mounted as a /data volume (FUSE): the server stores its token
# there, untouched code, surviving every instance recycle / scale-to-zero.
#
# REQUIREMENTS
#   1. gcloud CLI installed and authenticated:
#        gcloud auth login
#        gcloud config set project YOUR_PROJECT
#   2. The Google Cloud project has billing enabled. Cloud Run is free-tier
#      friendly and this service is tiny (1 instance, ~512 MiB).
#   3. The OAuth client secret for the existing web client
#      GOOGLE_DRIVE_CLIENT_ID (Google Cloud Console -> Credentials -> your
#      client -> "Download JSON"), passed as a file path:
#        .\deploy-cloud-run.ps1 -ClientSecretFile "$HOME\Downloads\client_secret.json"
#      (plain-text secret files work too), or via the environment variable
#      GOOGLE_CLIENT_SECRET with the switch -ClientSecretFromEnv.
#
# EXAMPLE
#   cd server
#   .\deploy-cloud-run.ps1 `
#     -AppOrigin "https://cell-experiment-tracker.firebaseapp.com" `
#     -Project "cell-experiment-tracker" `
#     -Region "europe-west1" `
#     -ClientSecretFile "$HOME\Downloads\client_secret.json"
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
param(
  [string]$AppOrigin = 'http://localhost:5173',  # origin(s) of the web app, comma-separated
  [string]$Project = '',
  [string]$Region = 'europe-west1',
  [string]$Service = 'drive-token-server',
  [string]$SharedEmail = 'nicola.damelio@gmail.com',
  [string]$ClientId = '',  # OAuth web-client ID (if it differs from the token-server default)
  [string]$ClientSecretFile = '',
  [switch]$ClientSecretFromEnv,
  [string]$Bucket = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail {
  param([string]$Message)
  Write-Host "`nERROR: $Message" -ForegroundColor Red
  Write-Host 'Nothing was changed that could not simply be re-run.' -ForegroundColor DarkGray
  exit 1
}

# Runs gcloud with the given argument list; returns $true when it exits 0.
function GcloudOk {
  param([string[]]$GcloudArgs)
  & gcloud @GcloudArgs *> $null
  return $LASTEXITCODE -eq 0
}

# --- Pre-flight checks -----------------------------------------------------
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Fail 'gcloud CLI not found on PATH. Install it from https://cloud.google.com/sdk and run "gcloud auth login".'
}
$active = (& gcloud auth list --filter=status:ACTIVE --format 'value(account)' 2>$null | Select-Object -First 1)
if (-not $active) {
  Fail 'No active gcloud account. Run "gcloud auth login" first.'
}
if (-not $Project) { $Project = (& gcloud config get-value project 2>$null) }
if (-not $Project) {
  Fail 'No project given. Add -Project "YOUR_PROJECT_ID" or run "gcloud config set project YOUR_PROJECT_ID".'
}
Write-Host "Account:  $active"
Write-Host "Project:  $Project"
Write-Host "Region:   $Region"

# --- Resolve the OAuth client secret ---------------------------------------
$secretValue = ''
if ($ClientSecretFile) {
  if (-not (Test-Path -LiteralPath $ClientSecretFile)) { Fail "ClientSecretFile not found: $ClientSecretFile" }
  $raw = Get-Content -LiteralPath $ClientSecretFile -Raw
  try {
    $parsed = $raw | ConvertFrom-Json
    if ($parsed.web -and $parsed.web.client_secret) { $secretValue = [string]$parsed.web.client_secret }
  } catch { $secretValue = '' }
  if (-not $secretValue) { $secretValue = $raw.Trim() }
} elseif ($ClientSecretFromEnv) {
  $secretValue = [string]$env:GOOGLE_CLIENT_SECRET
}
if (-not $secretValue) {
  Fail 'OAuth client secret missing. Use -ClientSecretFile "path\to\client_secret.json" or -ClientSecretFromEnv with $env:GOOGLE_CLIENT_SECRET.'
}
if ($secretValue -match '\s') {
  Write-Host 'WARNING: the client secret contains whitespace - double-check the downloaded JSON was selected.' -ForegroundColor Yellow
}
# --- Enable APIs (idempotent, may take a couple of minutes) -----------------
Write-Host "`nEnabling required APIs (first run only, can take a minute)..." -ForegroundColor Cyan
if (-not (GcloudOk @('services','enable','run.googleapis.com','cloudbuild.googleapis.com','secretmanager.googleapis.com','artifactregistry.googleapis.com','--project',$Project))) {
  Fail 'Could not enable the required APIs. Check that billing is enabled for this project: https://console.cloud.google.com/billing'
}
Write-Host 'APIs enabled.'

# --- Dedicated service account ----------------------------------------------
$SaName  = 'drive-token-sa'
$SaEmail = "$SaName@$Project.iam.gserviceaccount.com"
if (-not (GcloudOk @('iam','service-accounts','describe',$SaEmail,'--project',$Project))) {
  if (-not (GcloudOk @('iam','service-accounts','create',$SaName,'--project',$Project,'--display-name','Drive token server'))) {
    Fail "Could not create service account $SaEmail."
  }
}
foreach ($role in @('roles/logging.logWriter','roles/monitoring.metricWriter')) {
  try {
    & gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$SaEmail" --role $role --quiet *> $null
  } catch { }  # binding already present on re-runs
}
Write-Host "Service account ready: $SaEmail"
# --- Store the client secret in Secret Manager -------------------------------
$SecretName = 'drive-token-client-secret'
if (-not (GcloudOk @('secrets','describe',$SecretName,'--project',$Project))) {
  if (-not (GcloudOk @('secrets','create',$SecretName,'--project',$Project,'--replication-policy','automatic'))) {
    Fail "Could not create the Secret Manager secret $SecretName."
  }
}
$tmpSecret = Join-Path $env:TEMP 'drive-token-client-secret.txt'
try {
  Set-Content -LiteralPath $tmpSecret -Value $secretValue -NoNewline -Encoding ascii
  if (-not (GcloudOk @('secrets','versions','add',$SecretName,'--data-file',$tmpSecret,'--project',$Project))) {
    Fail "Could not store the secret value in $SecretName."
  }
} finally {
  Remove-Item -LiteralPath $tmpSecret -Force -ErrorAction SilentlyContinue
}
try {
  & gcloud secrets add-iam-policy-binding $SecretName --member "serviceAccount:$SaEmail" --role roles/secretmanager.secretAccessor --project $Project --quiet *> $null
} catch { }
Write-Host 'Client secret stored in Secret Manager.'

# --- Credential bucket --------------------------------------------------------
if (-not $Bucket) {
  $Bucket = (($Project -replace '[^a-z0-9-]', '') + '-token-store')
  if ($Bucket.Length -gt 60) { $Bucket = $Bucket.Substring(0, 60).TrimEnd('-') }
}
if (-not (GcloudOk @('storage','buckets','describe',"gs://$Bucket",'--project',$Project))) {
  Write-Host "Creating bucket gs://$Bucket ..." -ForegroundColor Cyan
  if (-not (GcloudOk @('storage','buckets','create',"gs://$Bucket",'--project',$Project,'--location',$Region))) {
    Fail "Could not create bucket gs://$Bucket (name must be globally unique - pass -Bucket to override)."
  }
}
if (-not (GcloudOk @('storage','buckets','add-iam-policy-binding',"gs://$Bucket",'--member',"serviceAccount:$SaEmail",'--role','roles/storage.objectAdmin'))) {
  # Older SDK fallback
  & gsutil iam ch "serviceAccount:$SaEmail:objectAdmin" "gs://$Bucket" *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Could not grant bucket access to $SaEmail." }
}
Write-Host "Credential bucket ready: gs://$Bucket"
# --- Build identity: Artifact Registry + source staging bucket -----------------
# 'gcloud run deploy --source' builds with the Compute Engine default service
# account (COMPUTE_SA). That build account needs to read/write the Artifact
# Registry repository and read the 'run-sources-*' staging bucket that receives
# the uploaded source zip. Create both up-front and grant the roles so a deploy
# works on a brand-new project with no manual IAM fixing.
$projectNumber = (& gcloud projects describe $Project --format 'value(projectNumber)' 2>$null)
$computeSa = if ($projectNumber) { "$projectNumber-compute@developer.gserviceaccount.com" } else { '' }
if ($computeSa) {
  try { & gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$computeSa" --role roles/logging.logWriter --quiet *> $null } catch { }
}
$arRepo = 'cloud-run-source-deploy'
if (-not (GcloudOk @('artifacts','repositories','describe',$arRepo,'--location',$Region,'--project',$Project))) {
  Write-Host "Creating Artifact Registry repository $arRepo (docker) ..." -ForegroundColor Cyan
  if (-not (GcloudOk @('artifacts','repositories','create',$arRepo,'--repository-format','docker','--location',$Region,'--project',$Project))) {
    Fail "Could not create the Artifact Registry repository $arRepo."
  }
}
if ($computeSa) {
  try { & gcloud artifacts repositories add-iam-policy-binding $arRepo --location $Region --project $Project --member "serviceAccount:$computeSa" --role roles/artifactregistry.writer --quiet *> $null } catch { }
}
try { & gcloud artifacts repositories add-iam-policy-binding $arRepo --location $Region --project $Project --member "serviceAccount:$SaEmail" --role roles/artifactregistry.reader --quiet *> $null } catch { }
$runSrcBucket = "run-sources-$Project-$Region"
if (-not (GcloudOk @('storage','buckets','describe',"gs://$runSrcBucket",'--project',$Project))) {
  & gcloud storage buckets create "gs://$runSrcBucket" --project $Project --location $Region *> $null
}
if ($computeSa) {
  try { & gcloud storage buckets add-iam-policy-binding "gs://$runSrcBucket" --project $Project --member "serviceAccount:$computeSa" --role roles/storage.objectViewer --quiet *> $null } catch { }
}
Write-Host "Build identity ready: repository $arRepo + staging bucket $runSrcBucket"
# --- Deploy -------------------------------------------------------------------
$origins = @($AppOrigin -split ',' | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ }) -join ','
if ($origins -notmatch 'localhost:5173') { $origins = "$origins,http://localhost:5173" }
$envs = "STORE_FILE=/data/workspace-shared-token.json,SHARED_EMAIL=$SharedEmail,ALLOWED_ORIGINS=$origins"
$codeVersion = (& git -C $PSScriptRoot rev-parse --short HEAD 2>$null | Select-Object -First 1)
if (-not $codeVersion) { $codeVersion = 'dev' }
$envs += ",CODE_VERSION=$codeVersion"
if ($ClientId) { $envs += ",GOOGLE_CLIENT_ID=$ClientId" }

Write-Host "`nDeploying Cloud Run service '$Service' (build + push, first time can take ~3-5 min)..." -ForegroundColor Cyan
try {
  & gcloud run deploy $Service `
    --source $PSScriptRoot `
    --project $Project `
    --region $Region `
    --allow-unauthenticated `
    --service-account $SaEmail `
    --execution-environment gen2 `
    --max-instances 1 `
    --memory 512Mi `
    --cpu 1 `
    --timeout 60 `
    --add-volume name=tokenstore,type=cloud-storage,bucket=$Bucket `
    --add-volume-mount volume=tokenstore,mount-path=/data `
    --set-env-vars $envs `
    --set-secrets GOOGLE_CLIENT_SECRET=$SecretName:latest
} catch {
  Fail "gcloud run deploy failed: $($_.Exception.Message)`nTip: update the SDK (gcloud components update) if a flag was rejected."
}
if ($LASTEXITCODE -ne 0) { Fail 'gcloud run deploy exited with an error (see messages above).' }

# --- Done ---------------------------------------------------------------------
$url = (& gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)' 2>$null)
Write-Host "`n==================== DEPLOYED ====================" -ForegroundColor Green
Write-Host "Service URL:  $url" -ForegroundColor Green
Write-Host "Health check: $url/health   (expect { ""ok"": true, ""initialized"": false })"
Write-Host ''
Write-Host 'NEXT STEPS'
Write-Host '  1. Paste the Service URL into GOOGLE_TOKEN_EXCHANGE_URL in src/data/constants.js'
Write-Host '     (shared mode is already enabled), rebuild and redeploy the app.'
Write-Host '  2. One-time owner bootstrap: open the DEPLOYED app with ?drive-bootstrap=1 in the'
Write-Host '     URL, click "Connect Drive" and approve the Google consent.'
Write-Host '  3. Verify: open "<Service URL>/health" again -> "initialized": true.'
Write-Host '     Other browsers/machines now use Drive with no Google popup.'
Write-Host '================================================='
