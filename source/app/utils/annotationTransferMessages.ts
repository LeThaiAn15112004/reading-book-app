import type { AnnotationExportResult } from '../bridge'
import { getT } from '../i18n'

/** Toast text for the result of an annotation export; null when nothing should be shown (the user cancelled). */
export function annotationExportMessage(
  result: AnnotationExportResult,
  what: 'annotation' | 'readable copy' = 'annotation',
): { message: string; variant: 'success' | 'error' | 'info' } | null {
  // Shown at once in a short toast, so it is translated now (spec 012).
  const t = getT()
  if (result.ok) {
    return {
      message:
        what === 'annotation'
          ? t('reader.annotations.export.exported', { count: result.exported })
          : t('reader.annotations.export.savedReadable', { count: result.exported }),
      variant: 'success',
    }
  }
  switch (result.errorCode) {
    case 'cancelled':
      return null
    case 'empty':
      return { message: t('reader.annotations.export.empty'), variant: 'info' }
    case 'not_found':
      return { message: t('reader.annotations.export.notFound'), variant: 'error' }
    default:
      return {
        message:
          result.message ||
          (what === 'annotation' ? t('reader.annotations.export.failed') : t('reader.annotations.export.failedReadable')),
        variant: 'error',
      }
  }
}
