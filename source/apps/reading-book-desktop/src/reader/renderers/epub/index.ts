export {
  EpubRenderer,
  type EpubPagePreview,
  type EpubRendererApi,
} from './EpubRenderer'
export {
  CfiCodec,
  cfiCodec,
  tryEncodeCfi,
  type EpubCfiEncodeInput,
  type EpubCfiDecodeResult,
} from './cfi-codec'
export {
  cfiChapterSignature,
  elementFromCfi,
  findRangeByText,
  isTrivialSectionStartCfi,
  parseCfi,
  rangeBetweenBoundaries,
  rangeMatchesText,
  resolveCfiBoundary,
  resolveCfiRange,
  splitCfiComponents,
  type CfiBoundary,
  type CfiDomOptions,
} from './cfi-dom-range'
export {
  cfiRangesOverlap,
  elementToHighlightHandleRect,
  emptyHighlightHandleRect,
  iframeRangeToViewportRect,
  rangeToHighlightHandleRect,
  splitCfiRange,
  toEpubjsDisplayCfi,
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
