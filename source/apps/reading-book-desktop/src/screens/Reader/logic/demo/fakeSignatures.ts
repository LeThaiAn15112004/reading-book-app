import type { ReaderSignature } from '@reading-book/shared/models'

/** Demo signatures for UI shell until detect/import fills `book_signatures`. */
export const FAKE_SIGNATURES: ReaderSignature[] = [
  {
    id: 'sig-demo-1',
    signerName: 'Nguyen Van A',
    signatureStatus: 'valid',
    signedAt: '2026-03-12T09:30:00.000Z',
  },
]
