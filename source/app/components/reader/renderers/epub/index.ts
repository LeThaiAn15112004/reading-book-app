export { EpubRenderer, type EpubRendererApi } from './EpubRenderer'
export {
  CfiCodec,
  cfiCodec,
  tryEncodeCfi,
  type EpubCfiEncodeInput,
  type EpubCfiDecodeResult,
  cfiChapterSignature,
  cfiCharacterOffset,
  characterOffsetToBoundary,
  collectDescendantTextNodes,
  documentTextLength,
  elementFromCfi,
  findRangeByText,
  isTrivialSectionStartCfi,
  parseCfi,
  rangeBetweenBoundaries,
  rangeMatchesText,
  rangeTextCoverage,
  resolveCfiBoundary,
  resolveCfiRange,
  splitCfiComponents,
  type CfiBoundary,
  type CfiDomOptions,
  cfiRangesOverlap,
  splitCfiRange,
  toEpubjsDisplayCfi,
  type SplitCfiRange,
} from './cfi'
export { openEpubjs } from './openEpubjs'
export {
  injectEpubThemeStyles,
  applyEpubThemeVars,
  applyEpubFontSize,
  EPUB_BASE_FONT_PX,
} from './epubjs/theme'
export { buildEpubNavState } from './epubjs/spine'
export { toArrayBuffer, waitForFrames } from './epubjs/host-layout'
export type {
  EpubjsHandle,
  EpubNavState,
  EpubPageLayout,
  EpubTocItem,
  EpubSelectionInfo,
  EpubHighlightClickInfo,
  EpubSearchTarget,
  ReadAloudMode,
  ReadAloudSection,
  ViewportRectLike,
} from './epubjs/types'
export {
  cfiFromLocation,
  displayedPagesFromLocation,
  type EpubDisplayedPages,
} from './progress'
