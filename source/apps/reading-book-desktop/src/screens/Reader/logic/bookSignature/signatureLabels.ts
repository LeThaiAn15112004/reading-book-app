import type { BookSignatureDto } from './bookSignatureStore'

type SignatureStatusDto = BookSignatureDto['status']

export type SignatureTone = 'ok' | 'warn' | 'neutral'

export interface SignatureLabel {
  /** Short value for a details row / pill. */
  label: string
  /** One sentence for the signature panel. */
  detail: string
  tone: SignatureTone
}

export const SIGNATURE_LABELS: Record<SignatureStatusDto, SignatureLabel> = {
  valid: {
    label: 'Signed · valid',
    detail:
      'This document carries a digital signature and it is intact. The signer’s certificate is not checked against a trust list.',
    tone: 'ok',
  },
  unsigned: {
    label: 'Not signed',
    detail: 'No digital signature was found in this document.',
    tone: 'neutral',
  },
  invalid: {
    label: 'Signature invalid',
    detail:
      'This document has a digital signature that does not verify — it may have been changed after it was signed.',
    tone: 'warn',
  },
  unsupported: {
    label: 'Can’t verify',
    detail:
      'Signatures can’t be verified for this file type, so it is unknown whether it is signed.',
    tone: 'neutral',
  },
}

export const SIGNATURE_CHECKING = 'Checking…'
export const SIGNATURE_UNAVAILABLE = 'Unavailable'
