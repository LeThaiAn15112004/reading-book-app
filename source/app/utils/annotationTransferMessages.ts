import type { AnnotationExportResult } from '../bridge'

/** Toast text for the result of an annotation export; null when nothing should be shown (the user cancelled). */
export function annotationExportMessage(result: AnnotationExportResult, what = 'annotation'): { message: string; variant: 'success' | 'error' | 'info' } | null {
  if (result.ok) {
    return {
      message: what === 'annotation' ? `Exported ${result.exported} annotation${result.exported === 1 ? '' : 's'}.` : `Saved the ${what} (${result.exported} annotation${result.exported === 1 ? '' : 's'}).`,
      variant: 'success',
    }
  }
  switch (result.errorCode) {
    case 'cancelled':
      return null
    case 'empty':
      return { message: 'This book has no annotations to export.', variant: 'info' }
    case 'not_found':
      return { message: 'This book cannot be exported.', variant: 'error' }
    default:
      return { message: result.message || (what === 'annotation' ? 'Could not export the annotations.' : `Could not export the ${what}.`), variant: 'error' }
  }
}
