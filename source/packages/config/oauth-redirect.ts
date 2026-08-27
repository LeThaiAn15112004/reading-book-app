/**
 * Cross-platform OAuth redirect target for Cloud Sources (Google Drive / Dropbox / OneDrive).
 *
 * Both the desktop app (registered via `electron-builder.json5` → `protocols`, handled through
 * `app.on('open-url')` / `second-instance` in `electron/main.ts`) and the mobile app (registered via
 * `app.json` → `expo.scheme`) must register this exact custom scheme with the OS so the OAuth
 * provider can hand control back to whichever app started the flow — a fixed loopback port (desktop)
 * or `expo-linking`'s dev-server URL (mobile, non-standalone builds) cannot survive store submission.
 *
 * The mobile app is not yet wired into the `packages/*` workspace graph (see root CLAUDE.md), so it
 * cannot import this constant directly; `Linking.createURL(OAUTH_CALLBACK_PATH)` in the mobile app
 * must be kept in sync with `OAUTH_CUSTOM_SCHEME`/`OAUTH_CALLBACK_PATH` below by hand.
 */
export const OAUTH_CUSTOM_SCHEME = 'readmate-reader';
export const OAUTH_CALLBACK_PATH = 'oauth/callback';
export const OAUTH_REDIRECT_URI = `${OAUTH_CUSTOM_SCHEME}://${OAUTH_CALLBACK_PATH}`;

/**
 * Google's OAuth 2.0 policy for "Desktop app" API clients rejects custom URI scheme redirects
 * (the `readmate-reader://` flow above) with `Error 400: invalid_request` — Desktop clients must
 * use the loopback IP address flow (RFC 8252 §7.3) instead: redirect to a fixed port on
 * 127.0.0.1, caught by a short-lived local HTTP server started for the duration of the sign-in.
 * This exact URI must be registered as an authorized redirect URI on the Desktop app OAuth
 * client in Google Cloud Console.
 */
export const GOOGLE_OAUTH_LOOPBACK_HOST = '127.0.0.1';
export const GOOGLE_OAUTH_LOOPBACK_PORT = 8730;
export const GOOGLE_OAUTH_LOOPBACK_CALLBACK_PATH = '/oauth2callback';
export const GOOGLE_OAUTH_LOOPBACK_REDIRECT_URI =
  `http://${GOOGLE_OAUTH_LOOPBACK_HOST}:${GOOGLE_OAUTH_LOOPBACK_PORT}${GOOGLE_OAUTH_LOOPBACK_CALLBACK_PATH}`;
