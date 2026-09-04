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

## Deploy

1. Get the OAuth client **secret** for the existing Web OAuth client
   `GOOGLE_DRIVE_CLIENT_ID` (Google Cloud Console → APIs & Services →
   Credentials → your client → download JSON).
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
   export SHARED_EMAIL='nicola@u-picardie.fr' # the workspace owner (protects the credential)
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
