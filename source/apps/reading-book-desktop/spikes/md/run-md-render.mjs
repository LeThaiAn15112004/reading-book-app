/**
 * Markdown reader, renderer side (docs/implementation_plan/markdown_reader.md): the REAL
 * `MdRenderer` component + `decodeMdSource` are loaded through Vite's SSR loader (so the TSX and the
 * CSS import work without Electron) and rendered to static HTML. Checks structure, GFM, the security
 * policy (no raw HTML, no navigable links, no remote / escaping images) and failure handling.
 * No window, no Electron, no files: pure string in → HTML out.
 *
 * Run: npm run spike:md:render
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  plugins: [react()],
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      '@reading-book/book-reader-sdk': path.resolve(root, '../book-reader-sdk/src/index.ts'),
      '@reading-book/config': path.resolve(root, '../../packages/config'),
    },
  },
  ssr: { noExternal: ['react-markdown', 'remark-gfm'] },
})

// useLayoutEffect has no effect in static server rendering (React warns); nothing else is expected.
const realConsoleError = console.error
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return
  realConsoleError(...args)
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

try {
  const { MdRenderer, decodeMdSource } = await server.ssrLoadModule('/src/reader/renderers/md/index.ts')

  const noop = () => {}
  function render(markdown, extra = {}) {
    return renderToStaticMarkup(
      createElement(MdRenderer, {
        bookId: 'bk-1',
        source: markdown,
        lossy: false,
        margin: 'normal',
        chromeHidden: false,
        onMarginClick: noop,
        onProgress: noop,
        onOpenExternal: noop,
        ...extra,
      }),
    )
  }
  const bytes = (text) => new TextEncoder().encode(text).buffer

  console.log('1. decoding')
  await check('BOM and CRLF are normalised; Vietnamese, combining marks and emoji are kept exactly', () => {
    const nfd = 'Tiếng Việt'.normalize('NFD')
    const raw = '\uFEFF# Chào 🌳\r\n\r\n' + nfd + ' 👨‍👩‍👧\r\n'
    const out = decodeMdSource(bytes(raw))
    assert.equal(out.lossy, false)
    assert.equal(out.text, '# Chào 🌳\n\n' + nfd + ' 👨‍👩‍👧\n')
  })
  await check('invalid UTF-8 is flagged, not silently altered', () => {
    const out = decodeMdSource(new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x41]).buffer)
    assert.equal(out.lossy, true)
    assert.ok(out.text.includes('\uFFFD') && out.text.endsWith('A'))
  })
  await check('an empty file decodes to an empty string', () => {
    assert.deepEqual(decodeMdSource(new ArrayBuffer(0)), { text: '', lossy: false })
  })

  console.log('2. structure')
  await check('H1–H6, paragraphs, hard breaks, rules', () => {
    const html = render('# a\n## b\n### c\n#### d\n##### e\n###### f\n\nline one  \nline two\n\n---\n\nlast')
    for (const n of [1, 2, 3, 4, 5, 6]) assert.match(html, new RegExp(`<h${n}>`))
    assert.match(html, /line one<br\/>\s*line two/)
    assert.match(html, /<hr\/>/)
    assert.match(html, /<p>last<\/p>/)
  })
  await check('ordered, unordered and nested lists; task list items', () => {
    const html = render('- a\n  - a1\n- b\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo')
    assert.match(html, /<ul>[\s\S]*<li>a[\s\S]*<ul>[\s\S]*<li>a1<\/li>/)
    assert.match(html, /<ol>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>/)
    assert.match(html, /<input type="checkbox" disabled="" checked=""\/> done/)
    assert.match(html, /<input type="checkbox" disabled=""\/> todo/)
  })
  await check('bold, italic, strikethrough, inline code, fenced code with language', () => {
    const html = render('**b** *i* ~~s~~ `c<d>`\n\n```js\nconst x = "<b>";\n```')
    assert.match(html, /<strong>b<\/strong>/)
    assert.match(html, /<em>i<\/em>/)
    assert.match(html, /<del>s<\/del>/)
    assert.match(html, /<code>c&lt;d&gt;<\/code>/)
    assert.match(html, /<pre><code class="language-js">const x = &quot;&lt;b&gt;&quot;;\n<\/code><\/pre>/)
  })
  await check('GFM table is wrapped for horizontal scrolling and keeps alignment', () => {
    const html = render('| A | B |\n|:--|--:|\n| 1 | 2 |')
    assert.match(html, /<div class="md-table-wrap"><table>/)
    assert.match(html, /<th[^>]*>A<\/th>/)
    assert.match(html, /<td[^>]*>2<\/td>/)
  })
  await check('blockquote and Unicode text reach the DOM intact', () => {
    const html = render('> Trích dẫn 🙂\n\nTiếng Việt: ắ ằ ẳ ẵ ặ')
    assert.match(html, /<blockquote>[\s\S]*Trích dẫn 🙂/)
    assert.ok(html.includes('Tiếng Việt: ắ ằ ẳ ẵ ặ'))
  })

  console.log('3. security')
  await check('raw HTML is dropped (script, iframe, img onerror, style, event handlers)', () => {
    const html = render(
      'before\n\n<script>alert(1)</script>\n\n<iframe src="https://evil"></iframe>\n\n<img src=x onerror="alert(1)">\n\n<style>*{display:none}</style>\n\n<a href="https://x" onclick="alert(1)">h</a>\n\nafter',
    )
    assert.ok(!/<script|<iframe|onerror|onclick|<style|alert\(1\)/i.test(html), html)
    assert.ok(html.includes('before') && html.includes('after'))
  })
  await check('inline HTML in a paragraph is dropped too', () => {
    const html = render('hello <b onmouseover="x()">bold</b> <script>x()</script> world')
    assert.ok(!/<script|onmouseover|<b[ >]/i.test(html), html)
    assert.ok(html.includes('hello') && html.includes('world'))
  })
  await check('links never carry an href; javascript:/file:/data: become inert text', () => {
    const html = render(
      '[web](https://example.com) [mail](mailto:a@b.co) [anchor](#intro) [js](javascript:alert(1)) [file](file:///C:/x) [data](data:text/html,x) [rel](./other.md)',
    )
    assert.ok(!/href=/i.test(html), html)
    assert.equal((html.match(/role="link"/g) ?? []).length, 3)
    assert.equal((html.match(/md-link-blocked/g) ?? []).length, 4)
    assert.ok(!/javascript:/i.test(html.replace(/>[^<]*</g, '><')), 'no javascript: in attributes')
  })
  await check('remote and escaping images are not rendered as <img>', () => {
    const html = render(
      '![r](https://example.com/a.png) ![p](//example.com/a.png) ![t](../secret.png) ![a](/etc/a.png) ![d](data:image/png;base64,AAAA) ![f](file:///C:/a.png) ![w](C:\\a.png)',
    )
    assert.ok(!/<img/i.test(html), html)
    assert.equal((html.match(/data-md-image="blocked"/g) ?? []).length, 7)
  })
  await check('a relative image is served only through the Main protocol, with an encoded path', () => {
    const html = render('![logo](img/a%20b.png) ![v](ảnh/bìa.png)')
    const srcs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(srcs, [
      'rb-md-asset://local/bk-1/img/a%20b.png',
      `rb-md-asset://local/bk-1/${encodeURIComponent('ảnh')}/${encodeURIComponent('bìa.png')}`,
    ])
    assert.match(html, /referrerPolicy|referrerpolicy="no-referrer"/i)
  })
  await check('a hostile book id cannot break out of the URL', () => {
    const html = render('![x](a.png)', { bookId: 'x/../../y"onerror="1' })
    const src = html.match(/<img[^>]*src="([^"]+)"/)[1]
    assert.ok(src.startsWith('rb-md-asset://local/x%2F..%2F..%2Fy%22onerror%3D%221/'), src)
  })

  console.log('4. failure handling')
  await check('empty / whitespace-only file shows the empty state', () => {
    for (const text of ['', '   \n\n\t']) {
      const html = render(text)
      assert.match(html, /data-md-empty/)
      assert.match(html, /This Markdown file is empty/)
    }
  })
  await check('invalid UTF-8 shows a notice', () => {
    assert.match(render('x', { lossy: true }), /data-md-notice="lossy"/)
    assert.ok(!/data-md-notice/.test(render('x')))
  })
  await check('malformed Markdown never throws and keeps the text', () => {
    for (const text of [
      '```\nunclosed fence',
      '[broken](',
      '![img](',
      '| a | b\n|--\n| 1',
      '**bold *mixed** italic*',
      '<div>\n# inside html',
      '#'.repeat(50) + ' x',
      '\u0000\u0001 control chars',
      '[a]: <> "title"\n\n[a]',
      '> '.repeat(200) + 'deep',
      '- '.repeat(200) + 'deep',
    ]) {
      const html = render(text)
      assert.ok(html.includes('data-md-content'), text)
    }
  })
  await check('a large document is split: only the first pieces mount at once, all content is reachable', () => {
    const block = '## Title\n\nParagraph with **bold**, *italic*, `code` and a [link](https://example.com).\n\n- item\n- item\n\n'
    const text = block.repeat(Math.ceil((1024 * 1024) / block.length))
    const start = Date.now()
    const first = render(text)
    const firstMs = Date.now() - start
    const segments = Number(first.match(/data-md-segments="(\d+)"/)[1])
    assert.ok(segments > 10, `expected many pieces, got ${segments}`)
    assert.match(first, /data-md-mounted="2"/)
    assert.match(first, /data-md-loading/)
    const all = render(text, { eagerSegments: segments })
    assert.ok(!/data-md-loading/.test(all))
    assert.equal((all.match(/<h2>Title<\/h2>/g) ?? []).length, text.match(/## Title/g).length)
    console.log(`    (1 MB → ${segments} pieces; first paint ${firstMs} ms)`)
  })
  await check('reference-style links keep working across pieces', () => {
    const filler = 'Plain paragraph of filler text to push the document over the split size.\n\n'.repeat(900)
    const text = 'Start [see][ref].\n\n' + filler + 'Later [again][ref].\n\n' + filler + '[ref]: https://example.com/target\n'
    const html = render(text, { eagerSegments: 99 })
    assert.ok(Number(html.match(/data-md-segments="(\d+)"/)[1]) > 1)
    assert.equal((html.match(/role="link"/g) ?? []).length, 2)
    assert.ok(!html.includes('[ref]'), 'definition text must not be shown, and no literal [text][ref] left')
  })
} finally {
  await server.close()
}
console.log(`\nMarkdown render checks: ${passed} passed`)
