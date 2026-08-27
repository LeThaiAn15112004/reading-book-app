import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import {
  GOOGLE_OAUTH_LOOPBACK_CALLBACK_PATH,
  GOOGLE_OAUTH_LOOPBACK_HOST,
  GOOGLE_OAUTH_LOOPBACK_PORT,
} from '@reading-book/config'

export type LoopbackAuthResult = { code: string; state?: string } | { error: string }

function renderResultPage(ok: boolean): string {
  const title = ok ? 'Sign-in successful' : 'Sign-in failed'
  const message = ok
    ? 'You can close this tab and return to Readmate Reader.'
    : 'Something went wrong during sign-in. Please return to the app and try again.'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; color: #1f2933; }
  .card { background: #fff; padding: 32px 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); text-align: center; max-width: 360px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #52606d; margin: 0; }
</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body>
</html>`
}

/**
 * Runs Google's OAuth 2.0 loopback-redirect flow (RFC 8252 §7.3): opens `authUrl` in the system
 * browser, then binds a short-lived local HTTP server to `127.0.0.1:GOOGLE_OAUTH_LOOPBACK_PORT` to
 * catch the resulting `GET /oauth2callback?code=...&state=...` request. The server is torn down as
 * soon as a callback (or the timeout) arrives, so it never lingers between sign-in attempts. This
 * replaces the `readmate-reader://` custom-scheme flow used by Dropbox/OneDrive, which Google's
 * "Desktop app" OAuth client policy rejects with `Error 400: invalid_request`.
 */
export function openGoogleOAuthViaLoopback(
  authUrl: string,
  expectedState: string,
  timeoutMs: number,
): Promise<LoopbackAuthResult> {
  return new Promise((resolve) => {
    let settled = false
    let server: Server | undefined

    const finish = (result: LoopbackAuthResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server?.close()
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ error: 'Sign-in timed out. Please try connecting again.' })
    }, timeoutMs)

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${GOOGLE_OAUTH_LOOPBACK_HOST}:${GOOGLE_OAUTH_LOOPBACK_PORT}`)
      if (url.pathname !== GOOGLE_OAUTH_LOOPBACK_CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }

      const error = url.searchParams.get('error')
      const state = url.searchParams.get('state') ?? undefined
      const code = url.searchParams.get('code')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderResultPage(false))
        finish({ error: url.searchParams.get('error_description') ?? error })
        return
      }

      if (state !== expectedState || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderResultPage(false))
        finish({ error: 'Received an unexpected sign-in response.' })
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderResultPage(true))
      finish({ code, state })
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        error:
          err.code === 'EADDRINUSE'
            ? `Local sign-in port ${GOOGLE_OAUTH_LOOPBACK_PORT} is already in use. Close whatever is using it and try again.`
            : err.message,
      })
    })

    server.listen(GOOGLE_OAUTH_LOOPBACK_PORT, GOOGLE_OAUTH_LOOPBACK_HOST, () => {
      shell.openExternal(authUrl).catch(() => {
        finish({ error: 'Could not open the system browser to sign in.' })
      })
    })
  })
}
