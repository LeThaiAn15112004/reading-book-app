/**
 * Spoken languages the Whisper models know (spec 004, FR-005) and how a default is chosen. Pure data + functions: Main uses the
 * list to reject an unknown language (`UNSUPPORTED_LANGUAGE`), the dialog uses it for its picker.
 */

export interface TranscriptionLanguage {
  /** Whisper language code. */
  code: string
  /** English name, as the model documents it. */
  name: string
}

/** Auto-detect: the model decides per window. */
export const AUTO_LANGUAGE = 'auto'

export const WHISPER_LANGUAGES: readonly TranscriptionLanguage[] = [
  { code: 'en', name: 'English' }, { code: 'zh', name: 'Chinese' }, { code: 'de', name: 'German' }, { code: 'es', name: 'Spanish' },
  { code: 'ru', name: 'Russian' }, { code: 'ko', name: 'Korean' }, { code: 'fr', name: 'French' }, { code: 'ja', name: 'Japanese' },
  { code: 'pt', name: 'Portuguese' }, { code: 'tr', name: 'Turkish' }, { code: 'pl', name: 'Polish' }, { code: 'ca', name: 'Catalan' },
  { code: 'nl', name: 'Dutch' }, { code: 'ar', name: 'Arabic' }, { code: 'sv', name: 'Swedish' }, { code: 'it', name: 'Italian' },
  { code: 'id', name: 'Indonesian' }, { code: 'hi', name: 'Hindi' }, { code: 'fi', name: 'Finnish' }, { code: 'vi', name: 'Vietnamese' },
  { code: 'he', name: 'Hebrew' }, { code: 'uk', name: 'Ukrainian' }, { code: 'el', name: 'Greek' }, { code: 'ms', name: 'Malay' },
  { code: 'cs', name: 'Czech' }, { code: 'ro', name: 'Romanian' }, { code: 'da', name: 'Danish' }, { code: 'hu', name: 'Hungarian' },
  { code: 'ta', name: 'Tamil' }, { code: 'no', name: 'Norwegian' }, { code: 'th', name: 'Thai' }, { code: 'ur', name: 'Urdu' },
  { code: 'hr', name: 'Croatian' }, { code: 'bg', name: 'Bulgarian' }, { code: 'lt', name: 'Lithuanian' }, { code: 'la', name: 'Latin' },
  { code: 'mi', name: 'Maori' }, { code: 'ml', name: 'Malayalam' }, { code: 'cy', name: 'Welsh' }, { code: 'sk', name: 'Slovak' },
  { code: 'te', name: 'Telugu' }, { code: 'fa', name: 'Persian' }, { code: 'lv', name: 'Latvian' }, { code: 'bn', name: 'Bengali' },
  { code: 'sr', name: 'Serbian' }, { code: 'az', name: 'Azerbaijani' }, { code: 'sl', name: 'Slovenian' }, { code: 'kn', name: 'Kannada' },
  { code: 'et', name: 'Estonian' }, { code: 'mk', name: 'Macedonian' }, { code: 'br', name: 'Breton' }, { code: 'eu', name: 'Basque' },
  { code: 'is', name: 'Icelandic' }, { code: 'hy', name: 'Armenian' }, { code: 'ne', name: 'Nepali' }, { code: 'mn', name: 'Mongolian' },
  { code: 'bs', name: 'Bosnian' }, { code: 'kk', name: 'Kazakh' }, { code: 'sq', name: 'Albanian' }, { code: 'sw', name: 'Swahili' },
  { code: 'gl', name: 'Galician' }, { code: 'mr', name: 'Marathi' }, { code: 'pa', name: 'Punjabi' }, { code: 'si', name: 'Sinhala' },
  { code: 'km', name: 'Khmer' }, { code: 'sn', name: 'Shona' }, { code: 'yo', name: 'Yoruba' }, { code: 'so', name: 'Somali' },
  { code: 'af', name: 'Afrikaans' }, { code: 'oc', name: 'Occitan' }, { code: 'ka', name: 'Georgian' }, { code: 'be', name: 'Belarusian' },
  { code: 'tg', name: 'Tajik' }, { code: 'sd', name: 'Sindhi' }, { code: 'gu', name: 'Gujarati' }, { code: 'am', name: 'Amharic' },
  { code: 'yi', name: 'Yiddish' }, { code: 'lo', name: 'Lao' }, { code: 'uz', name: 'Uzbek' }, { code: 'fo', name: 'Faroese' },
  { code: 'ht', name: 'Haitian Creole' }, { code: 'ps', name: 'Pashto' }, { code: 'tk', name: 'Turkmen' }, { code: 'nn', name: 'Nynorsk' },
  { code: 'mt', name: 'Maltese' }, { code: 'sa', name: 'Sanskrit' }, { code: 'lb', name: 'Luxembourgish' }, { code: 'my', name: 'Myanmar' },
  { code: 'bo', name: 'Tibetan' }, { code: 'tl', name: 'Tagalog' }, { code: 'mg', name: 'Malagasy' }, { code: 'as', name: 'Assamese' },
  { code: 'tt', name: 'Tatar' }, { code: 'haw', name: 'Hawaiian' }, { code: 'ln', name: 'Lingala' }, { code: 'ha', name: 'Hausa' },
  { code: 'ba', name: 'Bashkir' }, { code: 'jw', name: 'Javanese' }, { code: 'su', name: 'Sundanese' },
]

const KNOWN_CODES: ReadonlySet<string> = new Set(WHISPER_LANGUAGES.map((l) => l.code))

/** `auto` or one of the Whisper codes (case-insensitive input is NOT accepted: callers pass what the picker gave). */
export function isSupportedTranscriptionLanguage(value: unknown): value is string {
  return typeof value === 'string' && (value === AUTO_LANGUAGE || KNOWN_CODES.has(value))
}

/** A few ISO 639-2/3 codes and legacy tags mapped to the Whisper code; everything else must already be a Whisper code. */
const TAG_ALIASES: Readonly<Record<string, string>> = {
  eng: 'en', vie: 'vi', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja',
  kor: 'ko', zho: 'zh', chi: 'zh', nld: 'nl', dut: 'nl', pol: 'pl', tur: 'tr', ara: 'ar', hin: 'hi', swe: 'sv', ind: 'id',
  he: 'he', iw: 'he', nb: 'no', jv: 'jw',
}

/** Whisper code for a language tag such as `en`, `en-US`, `vie`, `pt_BR`; `null` when the tag is empty or not mapped. */
export function whisperLanguageForTag(tag: string | null | undefined): string | null {
  if (typeof tag !== 'string') return null
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  if (!primary) return null
  const code = TAG_ALIASES[primary] ?? primary
  return KNOWN_CODES.has(code) ? code : null
}

/**
 * The language a transcription starts with (FR-005): the audiobook's own language tag when it maps to a Whisper language,
 * otherwise the app's language when it does, otherwise auto-detect.
 */
export function resolveDefaultTranscriptionLanguage(bookLanguageTag?: string | null, appLanguage?: string | null): string {
  return whisperLanguageForTag(bookLanguageTag) ?? whisperLanguageForTag(appLanguage) ?? AUTO_LANGUAGE
}
