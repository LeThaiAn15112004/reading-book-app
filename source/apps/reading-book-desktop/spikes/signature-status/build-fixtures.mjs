/**
 * Builds the PDF fixtures for the signature-status checks (`run-signature-status.mjs`).
 * Output: spikes/signature-status/fixtures/*.pdf   (committed; re-run only to regenerate)
 *
 * The CMS signatures are produced by OpenSSL — an implementation independent of the verifier under
 * test — over the PDF's /ByteRange, exactly as a real PDF signer does. Certificates are throw-away
 * self-signed ones generated here; no key material is kept.
 *
 * The PDFs are structurally minimal (no cross-reference table): enough for a signature to be
 * embedded and verified, not meant to be opened in a viewer.
 *
 * Run: node spikes/signature-status/build-fixtures.mjs        (needs `openssl` on PATH)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, 'fixtures')
fs.mkdirSync(outDir, { recursive: true })
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sigfix-'))

const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] })

function makeIdentity(name, keyArgs) {
  const key = path.join(work, `${name}.key.pem`)
  const cert = path.join(work, `${name}.cert.pem`)
  openssl('req', '-x509', '-newkey', ...keyArgs, '-nodes', '-keyout', key, '-out', cert,
    '-subj', `/CN=${name}/O=Reading Book Test`, '-days', '36500')
  return { key, cert }
}

const CONTENTS_HEX_LEN = 8192 // 4096 reserved bytes
const PLACEHOLDER = '*'.repeat(10)

function basePdfParts({ signatureDict, annotation }) {
  return [
    '%PDF-1.7\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]${annotation ? ' /Annots [5 0 R]' : ''} >>\nendobj\n`,
    signatureDict ?? '',
    annotation ?? '',
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  ].join('')
}

/** A highlight annotation: looks "marked up" but is NOT a digital signature. */
const HIGHLIGHT =
  '5 0 obj\n<< /Type /Annot /Subtype /Highlight /Rect [10 10 100 30] /QuadPoints [10 30 100 30 10 10 100 10] /C [1 1 0] /Contents (a highlight) >>\nendobj\n'

function signatureDict(subFilter) {
  return (
    '4 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /' + subFilter +
    ` /ByteRange [0 ${PLACEHOLDER} ${PLACEHOLDER} ${PLACEHOLDER}] /Contents <${'0'.repeat(CONTENTS_HEX_LEN)}>` +
    ' /M (D:20260312093000Z) /Name (Fixture Signer) >>\nendobj\n'
  )
}

/** Returns the signed PDF bytes. `identity` null → leave /Contents empty (never signed). */
function buildSigned({ subFilter = 'adbe.pkcs7.detached', identity, md = 'sha256', extra = '' }) {
  const text = basePdfParts({ signatureDict: signatureDict(subFilter), annotation: null }) + extra
  const contentsAt = text.indexOf('/Contents <') + '/Contents '.length // index of '<'
  const gapStart = contentsAt
  const gapEnd = contentsAt + CONTENTS_HEX_LEN + 2 // one past '>'
  const total = Buffer.byteLength(text, 'latin1')
  const range = [0, gapStart, gapEnd, total - gapEnd]
  // Same-width numbers so nothing shifts.
  const withRange = text
    .replace(`[0 ${PLACEHOLDER} ${PLACEHOLDER} ${PLACEHOLDER}]`,
      `[0 ${String(range[1]).padStart(10)} ${String(range[2]).padStart(10)} ${String(range[3]).padStart(10)}]`)
  const buf = Buffer.from(withRange, 'latin1')
  if (!identity) return buf

  const signedContent = Buffer.concat([buf.subarray(0, gapStart), buf.subarray(gapEnd)])
  const dataFile = path.join(work, 'signed-content.bin')
  const sigFile = path.join(work, 'signature.der')
  fs.writeFileSync(dataFile, signedContent)
  openssl('cms', '-sign', '-binary', '-in', dataFile, '-signer', identity.cert, '-inkey', identity.key,
    '-outform', 'DER', '-out', sigFile, '-md', md)
  const hex = fs.readFileSync(sigFile).toString('hex').padEnd(CONTENTS_HEX_LEN, '0')
  if (hex.length !== CONTENTS_HEX_LEN) throw new Error('signature does not fit the reserved space')
  buf.write(hex, gapStart + 1, 'latin1')
  return buf
}

const write = (name, data) => fs.writeFileSync(path.join(outDir, name), data)

const rsa = makeIdentity('Fixture Signer', ['rsa:2048'])
const ec = makeIdentity('Fixture EC Signer', ['ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1'])

const signed = buildSigned({ identity: rsa })
write('signed-rsa.pdf', signed)
write('signed-ecdsa.pdf', buildSigned({ identity: ec }))
write('signed-sha1.pdf', buildSigned({ identity: rsa, md: 'sha1' }))
write('signed-cades.pdf', buildSigned({ identity: rsa, subFilter: 'ETSI.CAdES.detached' }))

// Never-signed documents: plain, and one carrying a highlight annotation (must still be unsigned).
write('unsigned.pdf', Buffer.from(basePdfParts({}), 'latin1'))
write('unsigned-annotated.pdf', Buffer.from(basePdfParts({ annotation: HIGHLIGHT }), 'latin1'))

// Invalid: a signed byte changed (MediaBox height 200 → 100) — digest no longer matches.
const tampered = Buffer.from(signed)
const box = tampered.indexOf('[0 0 200 200]')
tampered[box + 9] = "1".charCodeAt(0)
write('tampered-content.pdf', tampered)

// Invalid: signature value damaged (a byte inside the RSA signature at the end of the CMS blob).
const broken = Buffer.from(signed)
{
  const start = broken.indexOf('/Contents <') + '/Contents <'.length
  const hex = broken.subarray(start, start + CONTENTS_HEX_LEN).toString('latin1')
  const used = hex.replace(/0+$/, '')
  const at = start + used.length - 40 // well inside the trailing signature octets
  broken[at] = broken[at] === 0x31 ? 0x32 : 0x31
}
write('broken-signature.pdf', broken)

// Invalid: valid signature, then bytes appended (incremental update) that the signature doesn't cover.
write('modified-after-signing.pdf',
  Buffer.concat([signed, Buffer.from('6 0 obj\n<< /Type /Annot /Subtype /Text /Contents (added later) >>\nendobj\n', 'latin1')]))

// Unsupported: a signature the app has no verifier for (legacy raw RSA / SHA-1 hash forms).
write('signed-unsupported-subfilter.pdf', buildSigned({ identity: rsa, subFilter: 'adbe.x509.rsa_sha1' }))

// Invalid: signature dictionary present but never filled in.
write('empty-signature.pdf', buildSigned({ identity: null }))

fs.rmSync(work, { recursive: true, force: true })
console.log('fixtures written to', outDir)
