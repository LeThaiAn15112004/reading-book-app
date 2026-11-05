// Serves the built web UI from Metro, for Expo Go only (specs/008, research R11): Expo Go cannot carry the native
// local server. Metro's config never ships in the app, so a release build has no part of this.
const fs = require('node:fs')
const path = require('node:path')

const PREFIX = '/readmate-ui'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
}

const MISSING_BUILD_PAGE =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<p style="font:16px sans-serif;padding:24px">The Readmate UI is not built yet. ' +
  'Run <code>npm run build:web</code> in reading-book-mobile, then reload.</p>'

function send(response, status, headers, body) {
  response.writeHead(status, headers)
  response.end(body)
}

/** The file for a URL path inside `dist`, or null. Never leaves `dist`. */
function resolveFile(dist, urlPath) {
  let relative
  try {
    relative = decodeURIComponent(urlPath.slice(PREFIX.length))
  } catch {
    return null
  }
  if (relative === '' || relative === '/') relative = '/index.html'
  const file = path.resolve(dist, `.${relative}`)
  if (file !== dist && !file.startsWith(dist + path.sep)) return null
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  return stat?.isFile() ? { file, size: stat.size } : null
}

function createUiMiddleware(dist) {
  const root = path.resolve(dist)
  return (request, response, next) => {
    const urlPath = (request.url ?? '').split(/[?#]/)[0]
    if (urlPath !== PREFIX && !urlPath.startsWith(`${PREFIX}/`)) return next()

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return send(response, 405, { Allow: 'GET, HEAD' })
    }
    if (!fs.existsSync(path.join(root, 'index.html'))) {
      return send(response, 503, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }, MISSING_BUILD_PAGE)
    }
    const found = resolveFile(root, urlPath)
    if (!found) return send(response, 404, { 'Cache-Control': 'no-store' })

    const headers = {
      'Content-Type': MIME[path.extname(found.file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': found.size,
      // A rebuild must show on the next reload.
      'Cache-Control': 'no-store',
    }
    if (request.method === 'HEAD') return send(response, 200, headers)
    response.writeHead(200, headers)
    fs.createReadStream(found.file)
      .on('error', () => response.destroy())
      .pipe(response)
  }
}

/** Wraps Metro's middleware, as `config.server.enhanceMiddleware` expects. */
function withUiMiddleware(dist, previous) {
  const serveUi = createUiMiddleware(dist)
  return (metroMiddleware, server) => {
    const inner = previous ? previous(metroMiddleware, server) : metroMiddleware
    return (request, response, next) => serveUi(request, response, () => inner(request, response, next))
  }
}

module.exports = { createUiMiddleware, withUiMiddleware }
