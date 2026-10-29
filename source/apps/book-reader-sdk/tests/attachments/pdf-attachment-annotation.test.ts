import { describe, expect, it } from 'vitest'
import * as attachmentAnnotation from '../../src/attachments/pdf-attachment-annotation.js'

// Placeholder until T009 adds the payload / icon-box / size cases (specs/007-pdf-file-attachment/tasks.md).
describe('pdf-attachment-annotation', () => {
  it('module loads', () => {
    expect(attachmentAnnotation).toBeDefined()
  })
})
