import * as Linking from 'expo-linking'

/**
 * Path segment for the Cloud Sources OAuth callback (Google Drive / Dropbox / OneDrive), shared
 * with the desktop app's redirect URI. Keep this in sync by hand with `OAUTH_CALLBACK_PATH` in
 * `packages/config/oauth-redirect.ts` — the mobile app is not yet wired into the `packages/*`
 * workspace (see root CLAUDE.md), so it cannot import that constant directly.
 */
const OAUTH_CALLBACK_PATH = 'oauth/callback'

/**
 * Redirect URI Cloud Sources auth services (`packages/shared/services/*-auth.ts`) should be given
 * as `redirectUri` when initiating a connect flow from the mobile app. In a standalone/production
 * build this resolves via `app.json`'s `expo.scheme` to `readmate-reader://oauth/callback`, matching
 * the URI registered in each provider's OAuth app console and the desktop app's redirect (see
 * `packages/config/oauth-redirect.ts`). Under Expo Go / dev builds it instead resolves to the
 * Expo-hosted dev URL, which is expected and only usable for local testing.
 */
export function getOAuthRedirectUri(): string {
  return Linking.createURL(OAUTH_CALLBACK_PATH)
}
