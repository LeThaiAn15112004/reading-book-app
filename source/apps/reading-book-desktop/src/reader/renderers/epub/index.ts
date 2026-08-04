export { EpubRenderer, type EpubRendererApi } from './EpubRenderer'
export {
  CfiCodec,
  cfiCodec,
  tryEncodeCfi,
  type EpubCfiEncodeInput,
  type EpubCfiDecodeResult,
} from './cfi-codec'
export {
  cfiRangesOverlap,
  elementToHighlightHandleRect,
  emptyHighlightHandleRect,
  iframeRangeToViewportRect,
  rangeToHighlightHandleRect,
  splitCfiRange,
  viewportRectToHighlightHandleRect,
  type SplitCfiRange,
} from './selection-cfi'
export {
  openEpubjs,
  buildEpubSelectionPayloadFromDocument,
  epubFrameContextFromView,
  injectEpubThemeStyles,
  applyEpubThemeVars,
  applyEpubFontSize,
  buildEpubNavState,
  EPUB_BASE_FONT_PX,
  type EpubFrameSelectionContext,
  type EpubjsHandle,
  type EpubNavState,
  type EpubPageLayout,
  type EpubPageMode,
  type EpubSelectionPayload,
  type EpubTocItem,
} from './openEpubjs'
