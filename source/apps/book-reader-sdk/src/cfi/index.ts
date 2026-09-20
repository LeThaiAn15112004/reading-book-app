export {
  buildCfiRange,
  cfiBaseForSpineIndex,
  cfiChapterSignature,
  cfiRangesOverlap,
  isRangeCfi,
  isWrappedCfi,
  spineIndexFromCfi,
  splitCfiRange,
  splitTopLevelCommas,
  unwrapCfi,
  wrapCfi,
  type SplitCfiRange,
} from './cfi-string.js'
export {
  compareCfi,
  isTrivialSectionStartCfi,
  parseCfi,
  type CfiSegment,
  type CfiStep,
  type ParsedCfi,
} from './cfi-parse.js'
export { decodeCfiLocation, encodeCfiLocation, tryEncodeCfiLocation } from './cfi-codec.js'
