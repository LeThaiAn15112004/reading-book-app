/**
 * Rasterize EPUB view / section documents into compact thumbnail data URLs.
 * Runs via canvas + SVG foreignObject (no extra deps). Prefer idle scheduling
 * at the call site so capture does not contend with reading interaction.
 */

export const PREVIEW_THUMB_MAX_WIDTH = 160
export const PREVIEW_THUMB_MAX_HEIGHT = 220

const PREVIEW_JPEG_QUALITY = 0.72

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('preview image decode failed'))
    img.src = src
  })
}

/** Serialize a same-origin document into a scaled JPEG data URL. */
export async function documentToPreviewDataUrl(
  doc: Document,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): Promise<string | null> {
  const sw = Math.max(1, Math.floor(sourceWidth))
  const sh = Math.max(1, Math.floor(sourceHeight))
  if (sw <= 0 || sh <= 0) return null

  const scale = Math.min(maxWidth / sw, maxHeight / sh, 1)
  const tw = Math.max(1, Math.round(sw * scale))
  const th = Math.max(1, Math.round(sh * scale))

  const root = doc.documentElement
  if (!root) return null

  // Clone into an XHTML foreignObject payload; strip scripts for safety/size.
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, style[data-epubjs]').forEach((el) => el.remove())

  let serialized: string
  try {
    serialized = new XMLSerializer().serializeToString(clone)
  } catch {
    serialized = clone.outerHTML
  }

  // Ensure XHTML namespace so foreignObject can parse the payload.
  if (!/xmlns=/.test(serialized.slice(0, 200))) {
    serialized = serialized.replace(
      /^<([a-zA-Z0-9:]+)/,
      '<$1 xmlns="http://www.w3.org/1999/xhtml"',
    )
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}">
  <foreignObject width="100%" height="100%" style="overflow:hidden">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${sw}px;height:${sh}px;transform:scale(${scale});transform-origin:0 0;overflow:hidden;background:#fff;">
      ${serialized}
    </div>
  </foreignObject>
</svg>`

  try {
    const img = await loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    )
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, tw, th)
    ctx.drawImage(img, 0, 0, tw, th)
    return canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY)
  } catch {
    return null
  }
}

/**
 * Capture the live EPUB host (visible iframe views + optional cover image)
 * into a thumbnail-sized JPEG data URL.
 */
export async function captureHostPreview(
  host: HTMLElement,
  maxWidth = 160,
  maxHeight = 220,
): Promise<string | null> {
  const hostRect = host.getBoundingClientRect()
  if (hostRect.width < 8 || hostRect.height < 8) return null

  const scale = Math.min(
    maxWidth / hostRect.width,
    maxHeight / hostRect.height,
    1,
  )
  const tw = Math.max(1, Math.round(hostRect.width * scale))
  const th = Math.max(1, Math.round(hostRect.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, tw, th)

  let painted = false

  // Synthetic cover image (sibling overlay may sit on the reading surface).
  const coverImg = host.parentElement?.querySelector<HTMLImageElement>(
    '[data-epub-synthetic-cover] img',
  )
  if (coverImg?.naturalWidth) {
    try {
      const ir = coverImg.getBoundingClientRect()
      const dx = (ir.left - hostRect.left) * scale
      const dy = (ir.top - hostRect.top) * scale
      ctx.drawImage(
        coverImg,
        dx,
        dy,
        Math.max(1, ir.width * scale),
        Math.max(1, ir.height * scale),
      )
      painted = true
    } catch {
      /* tainted / not ready */
    }
  }

  const frames = host.querySelectorAll('iframe')
  for (const frame of frames) {
    const doc = frame.contentDocument
    if (!doc?.documentElement) continue
    const fr = frame.getBoundingClientRect()
    if (fr.width < 4 || fr.height < 4) continue
    const url = await documentToPreviewDataUrl(
      doc,
      frame.clientWidth || fr.width,
      frame.clientHeight || fr.height,
      Math.max(1, Math.round(fr.width * scale)),
      Math.max(1, Math.round(fr.height * scale)),
    )
    if (!url) continue
    try {
      const img = await loadImage(url)
      ctx.drawImage(
        img,
        (fr.left - hostRect.left) * scale,
        (fr.top - hostRect.top) * scale,
        Math.max(1, fr.width * scale),
        Math.max(1, fr.height * scale),
      )
      painted = true
    } catch {
      /* skip frame */
    }
  }

  if (!painted) return null
  return canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY)
}

/**
 * Rasterize an HTML document string into a JPEG data URL via a hidden iframe.
 * Used for fake/demo chapters and any wrapped spine markup fallback.
 */
export async function htmlToPreviewDataUrl(
  html: string,
  maxWidth = PREVIEW_THUMB_MAX_WIDTH,
  maxHeight = PREVIEW_THUMB_MAX_HEIGHT,
): Promise<string | null> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:420px;height:560px;visibility:hidden;pointer-events:none;border:0'
  document.body.appendChild(iframe)

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve()
      iframe.onerror = () => reject(new Error('preview iframe load failed'))
      iframe.srcdoc = html
    })
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    const doc = iframe.contentDocument
    if (!doc?.documentElement) return null
    const body = doc.body
    const sw = Math.max(
      body?.scrollWidth ?? 0,
      body?.clientWidth ?? 0,
      iframe.clientWidth,
      320,
    )
    const sh = Math.max(
      body?.scrollHeight ?? 0,
      body?.clientHeight ?? 0,
      iframe.clientHeight,
      400,
    )
    return documentToPreviewDataUrl(doc, sw, sh, maxWidth, maxHeight)
  } catch {
    return null
  } finally {
    iframe.remove()
  }
}

/** Wrap raw section markup for sandboxed thumbnail iframes. */
export function wrapSpinePreviewHtml(
  bodyInnerHtml: string,
  opts?: { background?: string; color?: string },
): string {
  const background = opts?.background ?? '#ffffff'
  const color = opts?.color ?? '#1e293b'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  html,body{margin:0;padding:0;background:${background};color:${color};
    font:16px/1.45 Georgia,"Times New Roman",serif;overflow:hidden;}
  body{padding:18px 16px;}
  img,svg,video{max-width:100%;height:auto;}
  a{color:inherit;text-decoration:none;}
</style></head><body>${bodyInnerHtml}</body></html>`
}
