/**
 * Deterministic TXT fixtures for the TXT reader E2E specs (no external tools, no personal books).
 *
 * The "reading" fixture is Vietnamese + emoji text written the way Windows tools write it: a UTF-8
 * BOM and CRLF line breaks. `TXT_CANON` is what the reader must show — no BOM, LF only.
 *
 * Usage: imported by the E2E specs.
 */

export const TXT_TITLE_LINE = 'Chương 1: Khởi đầu'
export const TXT_NEEDLE_LINE = 'Dòng thứ ba có từ khóa NEEDLE ở giữa câu.'
export const TXT_QUOTE_A = TXT_TITLE_LINE
export const TXT_QUOTE_B = 'NEEDLE'
export const TXT_QUOTE_C = 'Câu cuối cùng — hết đoạn đầu. 😀'
export const TXT_LAST_LINE = 'Dòng cuối cùng của tài liệu.'
export const TXT_FILLER_LINES = 160

function fillerLine(n) {
  return `Dòng số ${String(n).padStart(3, '0')}: tiếng Việt có dấu, trời đẹp quá — an ninh, chuyện kể, thành phố.`
}

/** The canonical text the reader shows for the reading fixture. */
export const TXT_CANON = [
  TXT_TITLE_LINE,
  '',
  'Trời hôm nay rất đẹp, tôi đi dạo trong công viên 🌳 và nghe chim hót.',
  TXT_NEEDLE_LINE,
  TXT_QUOTE_C,
  '',
  ...Array.from({ length: TXT_FILLER_LINES }, (_, i) => fillerLine(i + 1)),
  TXT_LAST_LINE,
].join('\n')

/** UTF-8 BOM + CRLF — the bytes on disk. */
export function buildTxtBytes() {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TXT_CANON.replace(/\n/g, '\r\n'), 'utf8')])
}

/** Plain LF, no BOM. */
export function buildLfTxtBytes(text) {
  return Buffer.from(text, 'utf8')
}

export const HOSTILE_TEXT = [
  '<script>window.__txtPwned = 1</script>',
  '<img src=x onerror="window.__txtPwned = 2">',
  '<b>bold?</b> &amp; &lt;i&gt; javascript:alert(3)',
].join('\n')

/** A text file whose content looks like markup / script. It must be shown as text and nothing else. */
export function buildHostileTxtBytes() {
  return Buffer.from(HOSTILE_TEXT, 'utf8')
}

/** ~`chars` UTF-16 units of wrapped Vietnamese prose, for size / speed checks. */
export function buildLongText(chars) {
  const paragraph =
    'Trời hôm nay rất đẹp, tôi đi dạo trong công viên và nghe chim hót. Những chiếc lá vàng rơi trên con đường nhỏ, ' +
    'gió thổi nhẹ qua mái tóc, và cả thành phố như đang thở chậm lại trong buổi chiều muộn. '
  const out = []
  let length = 0
  let n = 0
  while (length < chars) {
    const line = `[${String(n++).padStart(6, '0')}] ${paragraph}${paragraph}`
    out.push(line)
    length += line.length + 1
  }
  return out.join('\n')
}
