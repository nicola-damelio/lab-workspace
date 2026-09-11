# Shared "Lab Workspace" Drive token server

A zero-dependency Node (≥ 18) HTTPS endpoint that lets **every** browser that
opens the app save files to the shared **Lab Workspace** Google Drive folder —
**without any personal Google Drive / Google login**.

This replaces **only the file-storage step**. The app's own access control is
unchanged: every user still signs in to the Lab Workspace with their scientist
account + password and keeps the same permissions, on every browser (the shared
operators/settings are loaded from the Firestore appConfig for all sessions).

## How it works

| Who / what               | Role |
| ------------------------ | ---- |
| `token-server.js`        | Holds the workspace **owner's** permanent Drive *refresh token* (the only token that never expires) and the OAuth client **secret**. |
| The web app (browser)    | Never holds a secret. On load and ~every hour it POSTs `{ grant_type: 'workspace' }` to this server and receives a short-lived (~1 h) **access token**, which it uses to talk to Google Drive directly — same as today. |
| The owner (one time)     | Opens the app with `?drive-bootstrap=1` and clicks **Connect Drive**. A normal Google consent popup appears; this server stores the resulting refresh token. Done — every lab machine now works forever. |

If the server is briefly unreachable the app shows "Drive unavailable", keeps
files locally, and **retries automatically every minute** — no user action.

## Team sign-in (server-side password check) — recommended

The app's login screen alone never protected the data: it runs in the browser.
This server can now do the real check and hand out a **signed Firebase token**,
which is what the Firestore rules require (`firestore.rules` at the repo root).

| Endpoint | Purpose |
| -------- | ------- |
| `POST /api/auth/login` `{ name, password }` | verifies the password server-side (PBKDF2-SHA256; the app's legacy SHA-256 fingerprints are hardened on first successful login) and answers `{ token }` — a Firebase **custom token** carrying `claims { lab: true, name, role }`. |
| `GET /api/auth/roster` | `{ members: [{ id, name, role }] }` — fills the login screen's name list. **No password, no hash.** |
| `POST /api/auth/accounts` (header `X-Admin-Token`) | replaces the server-side copy of the team (the app publishes it from *Setup → Équipe & accès → 🛡️ Sécurité serveur*). |
| `GET /api/auth/status` | `{ configured, accounts, savedAt, adminPushEnabled }`. |

Enable it with three extra environment variables (see `deploy-cloud-run.ps1`
`-FirebaseServiceAccountFile` / `-AdminToken`):

| Variable | Meaning |
| -------- | ------- |
| `FIREBASE_SERVICE_ACCOUNT` (or `…_B64`, or `FIREBASE_SA_FILE`) | the Firebase service-account JSON whose key signs the custom tokens. Empty = `/api/auth/*` answers `501 auth_not_configured`. |
| `ADMIN_TOKEN` | shared secret required by `POST /api/auth/accounts`. Empty = publication disabled. |
| `ACCOUNTS_FILE` | where the server keeps its copy of the team (default `./workspace-accounts.json`, `0600`; on Cloud Run: `/data/workspace-accounts.json`). |

Until the Firestore rules are published, **nothing changes** for the team: the
app keeps its historical local login as a fallback. The full procedure (order,
verification, rollback) is in **`docs/SECURITY-SETUP.md`**.

## Deploy on Google Cloud Run (recommended)

The zero-dependency server is published as a **single-instance Cloud Run
service with a Cloud Storage bucket mounted as a `/data` volume** (FUSE): the
credential file keeps working unchanged and survives every instance recycle /
scale-to-zero, so **no code change and no database** is needed. Cost stays
inside the Cloud Run free tier for a lab.

Prerequisites (one time):

1. A Google Cloud project **with billing enabled** (Cloud Run needs it even
   inside the free tier) — typically the project that owns the OAuth client
   `GOOGLE_DRIVE_CLIENT_ID`.
2. `gcloud` CLI installed and authenticated (`gcloud auth login`), with the
   project selected (`gcloud config set project YOUR_PROJECT_ID`).
3. ⚠️ **OAuth consent screen**: if it still shows **Testing**, Google expires
   refresh tokens after 7 days. Publish the app (**In production** — no review
   needed for an internal app) *before* bootstrapping, or the credential
   silently dies every week.
4. **OAuth client secret** (since 2025 Google no longer lets you view/download
   the secret of an already-created client): if you do not have the
   `client_secret.json` saved from when the client was created, **create a new
   OAuth Web client** (Credentials → + Create credentials → OAuth client ID →
   Web application) and **download the JSON immediately** — the secret is shown
   only at creation. Point the app at the new client ID
   (`GOOGLE_DRIVE_CLIENT_ID` in `src/data/constants.js`) and pass the same ID
   to the scripts (`-ClientId` / `-i`): the browser asks that client for the
   consent code and the server exchanges it, so **both must use the same ID**.

Publish (PowerShell, from this repo — re-running it just redeploys):

```powershell
cd server
# -a is optional (default: http://localhost:5173). When the app gets a real
# public address, re-run the script with -a "https://your-app.example.com".
.\deploy-cloud-run.ps1 -AppOrigin "https://your-app.example.com" `
  -ClientSecretFile "$HOME\Downloads\client_secret.json" `
  -ClientId "NEW-CLIENT-ID.apps.googleusercontent.com"   # only if you created a new client
```

If you prefer **Cloud Shell / Linux** (no install — gcloud is already there):
upload the four files `server/token-server.js`, `server/package.json`,
`server/deploy-cloud-run.sh` and the downloaded `client_secret.json` into one
Cloud Shell folder and run:

```bash
bash deploy-cloud-run.sh -a "https://your-app.example.com" -p "YOUR_PROJECT_ID" \
  -c "client_secret.json" \
  -i "NEW-CLIENT-ID.apps.googleusercontent.com"   # only if you created a new client
```

The script enables `run` / `cloudbuild` / `secretmanager`, creates a dedicated
service account, stores the OAuth client **secret** in Secret Manager, creates
a small credential bucket, grants only the needed roles and deploys the
service (`--max-instances 1` keeps the single credential file consistent;
`--source .` = this `server/` folder; Cloud Run injects `PORT`, so the server
listens on 8080 automatically).

Manual equivalent (gcloud CLI):

```bash
gcloud run deploy drive-token-server --source . \
  --project $PROJECT --region $REGION --allow-unauthenticated \
  --service-account drive-token-sa@$PROJECT.iam.gserviceaccount.com \
  --execution-environment gen2 --max-instances 1 --memory 512Mi --cpu 1 \
  --add-volume name=tokenstore,type=cloud-storage,bucket=$PROJECT-token-store \
  --add-volume-mount volume=tokenstore,mount-path=/data \
  --set-env-vars STORE_FILE=/data/workspace-shared-token.json,\
SHARED_EMAIL=nicola.damelio@gmail.com,ALLOWED_ORIGINS=https://your-app.example.com \
  --set-secrets GOOGLE_CLIENT_SECRET=drive-token-client-secret:latest
```

After the first deploy:

1. Open the printed service URL + `/health` in a browser →
   `{ "ok": true, "initialized": false, ... }`.
2. Paste that URL into `GOOGLE_TOKEN_EXCHANGE_URL` in
   `src/data/constants.js` (shared mode is already `true`), rebuild and
   redeploy the app.
3. **One-time owner bootstrap**: open the deployed app with
   `?drive-bootstrap=1`, click **Connect Drive**, approve the Google consent.
   `/health` now reports `"initialized": true` and every browser mints Drive
   tokens from the server with **no Google popup**.

To reset the credential: delete the file in the `*-token-store` bucket and
repeat the bootstrap. The OAuth consent-screen and `gmail.send` notes below
apply to Cloud Run exactly as to a self-hosted box.

## Deploy — alternative: your own always-on machine

1. Get the OAuth client **secret** for the Web OAuth client
   `GOOGLE_DRIVE_CLIENT_ID` (Google Cloud Console → APIs & Services →
   Credentials → your client → download JSON — possible only if you saved it
   before the 2025 policy change; otherwise create a new OAuth Web client and
   download its JSON at creation).
   - The Google Drive API must be enabled for that project and the scope
     `https://www.googleapis.com/auth/drive.file` added to the consent screen.
   - ⚠️ If the OAuth consent screen is still in **Testing** status, Google
     expires refresh tokens after 7 days. Publish the app ("In production" —
     no verification needed for an internal app) for the permanent token to
     really be permanent.
2. Run this server on any always-on machine/VM and expose it over **HTTPS**
   (reverse proxy: Caddy/nginx, or your host's TLS). Do **not** put it on the
   public web without HTTPS.

   ```bash
   export GOOGLE_CLIENT_SECRET='...'          # required
   export SHARED_EMAIL='nicola.damelio@gmail.com' # the workspace owner (protects the credential)
   export ALLOWED_ORIGINS='https://lab.example.com'  # comma-separated app origin(s)
   export PORT=8787
   node server/token-server.js
   ```

   In development add your Vite origin, e.g. `http://localhost:5173`.
   Verify: `curl http://localhost:8787/health` →
   `{ "ok": true, "initialized": false, ... }`.

3. Activate shared mode in the app: paste the server's HTTPS URL into
   `GOOGLE_TOKEN_EXCHANGE_URL` in `src/data/constants.js`
   (`GOOGLE_DRIVE_SHARED_MODE` is already `true`), rebuild and redeploy.

4. **One-time owner bootstrap:** open the deployed app with
   `?drive-bootstrap=1` in the URL, click **Connect Drive** in the sidebar and
   approve the Google consent. The server now holds the permanent credential
   (`curl http://localhost:8787/health` → `"initialized": true`). Ordinary
   users never see a Google popup again (they still log in to the Lab Workspace
   app as usual — only the Google Drive step is gone).

## Endpoints (POST, JSON body)

| grant_type                | Purpose |
| ------------------------- | ------- |
| `workspace`               | Mint `{ access_token, expires_in }` from the stored workspace credential (used by the app). |
| `authorization_code`      | Owner bootstrap — exchanges the GIS code and **stores** the refresh token server-side (never returned to the browser). |
| `refresh_token`           | Legacy per-user refresh (older builds). |
| GET `/health`             | Status + `initialized` flag. |

## Rotating / resetting the credential

Delete the store file (default `./workspace-shared-token.json`) and repeat the
owner bootstrap, **or** restart the server with
`WORKSPACE_REFRESH_TOKEN=<token>` to pre-seed it. If the stored credential is
revoked (Google password change, manual revoke, 7-day testing expiry) the
server automatically drops it and answers `503 workspace_not_initialized`, so
the app tells the owner to re-bootstrap.

## Failure modes covered

- **Server unreachable** → client keeps files locally, shows "Drive
  unavailable", retries every minute, reconnects silently when the server is
  back.
- **Server up, credential missing** → the app explains that the one-time
  owner setup (`?drive-bootstrap=1`) is still required.
- **Credential revoked** → server clears it; owner repeats the one-time setup.
