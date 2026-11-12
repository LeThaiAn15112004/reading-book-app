import type { BookSignatureDto } from './bookSignatureStore'
import type { MessageKey } from '@core'

type SignatureStatusDto = BookSignatureDto['status']

export type SignatureTone = 'ok' | 'warn' | 'neutral'

export interface SignatureLabel {
  /** Short value for a details row / pill (catalogue key, spec 012). */
  label: MessageKey
  /** One sentence for the signature panel (catalogue key). */
  detail: MessageKey
  tone: SignatureTone
}

export const SIGNATURE_LABELS: Record<SignatureStatusDto, SignatureLabel> = {
  valid: {
    label: 'reader.tools.signature.valid',
    detail: 'reader.tools.signature.validDetail',
    tone: 'ok',
  },
  unsigned: {
    label: 'reader.tools.signature.unsigned',
    detail: 'reader.tools.signature.unsignedDetail',
    tone: 'neutral',
  },
  invalid: {
    label: 'reader.tools.signature.invalid',
    detail: 'reader.tools.signature.invalidDetail',
    tone: 'warn',
  },
  unsupported: {
    label: 'reader.tools.signature.unsupported',
    detail: 'reader.tools.signature.unsupportedDetail',
    tone: 'neutral',
  },
}

export const SIGNATURE_CHECKING: MessageKey = 'reader.tools.signature.checkingShort'
export const SIGNATURE_UNAVAILABLE: MessageKey = 'reader.tools.signature.unavailable'
