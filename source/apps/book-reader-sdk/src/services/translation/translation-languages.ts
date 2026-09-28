/**
 * Languages the translation UI offers, and which model translates a given pair.
 *
 * Routing: a dedicated OPUS-MT pair model when one exists (≈75–110 MB, fast, best quality for
 * that pair), otherwise the multilingual NLLB-200 model (one ≈600 MB+ download that covers every
 * pair below). Pair list = the `Xenova/opus-mt-*` ONNX conversions on the Hugging Face Hub.
 */

export interface TranslationLanguage {
  /** BCP-47 primary tag (plus script/region only where it changes the model, e.g. `zh-TW`). */
  code: string
  /** English name — what the search box matches first. */
  name: string
  /** Endonym, so a reader can find their language without knowing its English name. */
  nativeName: string
  /** FLORES-200 code used by NLLB. */
  nllbCode: string
}

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', nllbCode: 'eng_Latn' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', nllbCode: 'vie_Latn' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', nllbCode: 'zho_Hans' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', nllbCode: 'zho_Hant' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', nllbCode: 'jpn_Jpan' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', nllbCode: 'kor_Hang' },
  { code: 'fr', name: 'French', nativeName: 'Français', nllbCode: 'fra_Latn' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', nllbCode: 'deu_Latn' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', nllbCode: 'spa_Latn' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', nllbCode: 'por_Latn' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', nllbCode: 'ita_Latn' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', nllbCode: 'rus_Cyrl' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', nllbCode: 'ukr_Cyrl' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', nllbCode: 'pol_Latn' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', nllbCode: 'nld_Latn' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', nllbCode: 'swe_Latn' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', nllbCode: 'dan_Latn' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', nllbCode: 'nob_Latn' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', nllbCode: 'fin_Latn' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', nllbCode: 'est_Latn' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', nllbCode: 'lit_Latn' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', nllbCode: 'lvs_Latn' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', nllbCode: 'ces_Latn' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', nllbCode: 'slk_Latn' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', nllbCode: 'slv_Latn' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', nllbCode: 'hrv_Latn' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', nllbCode: 'srp_Cyrl' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', nllbCode: 'bul_Cyrl' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', nllbCode: 'hun_Latn' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', nllbCode: 'ron_Latn' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', nllbCode: 'ell_Grek' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', nllbCode: 'tur_Latn' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', nllbCode: 'arb_Arab' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', nllbCode: 'heb_Hebr' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', nllbCode: 'pes_Arab' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', nllbCode: 'urd_Arab' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', nllbCode: 'hin_Deva' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', nllbCode: 'ben_Beng' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', nllbCode: 'tam_Taml' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', nllbCode: 'tha_Thai' },
  { code: 'lo', name: 'Lao', nativeName: 'ລາວ', nllbCode: 'lao_Laoo' },
  { code: 'km', name: 'Khmer', nativeName: 'ខ្មែរ', nllbCode: 'khm_Khmr' },
  { code: 'my', name: 'Burmese', nativeName: 'မြန်မာ', nllbCode: 'mya_Mymr' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', nllbCode: 'ind_Latn' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', nllbCode: 'zsm_Latn' },
  { code: 'tl', name: 'Filipino', nativeName: 'Filipino', nllbCode: 'tgl_Latn' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', nllbCode: 'swh_Latn' },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', nllbCode: 'afr_Latn' },
  { code: 'xh', name: 'Xhosa', nativeName: 'isiXhosa', nllbCode: 'xho_Latn' },
]

const BY_CODE = new Map(TRANSLATION_LANGUAGES.map((language) => [language.code.toLowerCase(), language]))

export const NLLB_MODEL_ID = 'Xenova/nllb-200-distilled-600M'

/** `source>target` → OPUS-MT model id. Only pairs that exist as ONNX conversions. */
const OPUS_PAIRS: Readonly<Record<string, string>> = (() => {
  const pairs: Record<string, string> = {}
  const add = (source: string, target: string, suffix = `${source}-${target}`) => {
    pairs[`${source}>${target}`] = `Xenova/opus-mt-${suffix}`
  }
  for (const target of ['af', 'ar', 'cs', 'da', 'de', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'nl', 'ro', 'ru', 'sv', 'uk', 'vi', 'xh', 'zh']) {
    add('en', target)
  }
  add('en', 'ja', 'en-jap')
  for (const source of ['af', 'ar', 'cs', 'da', 'de', 'es', 'et', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'ru', 'sv', 'th', 'uk', 'vi', 'xh', 'zh']) {
    add(source, 'en')
  }
  add('tr', 'en', 'tc-big-tr-en')
  for (const pair of ['da-de', 'de-es', 'de-fr', 'es-de', 'es-fr', 'es-it', 'es-ru', 'fi-de', 'fr-de', 'fr-es', 'fr-ro', 'fr-ru', 'it-es', 'it-fr', 'nl-fr', 'no-de', 'ru-es', 'ru-fr', 'ru-uk', 'uk-ru']) {
    const [source = '', target = ''] = pair.split('-')
    add(source, target)
  }
  return pairs
})()

export interface TranslationRoute {
  modelId: string
  /** Language hints for multilingual models (FLORES codes); absent for pair models. */
  sourceLang?: string
  targetLang?: string
  /** True when the route needs the large NLLB download. */
  multilingual: boolean
}

export function findTranslationLanguage(code: string): TranslationLanguage | undefined {
  return BY_CODE.get(code.toLowerCase())
}

/**
 * Maps any BCP-47 tag (`en-US`, `pt_BR`, `zh-Hant-HK`, `vi`) to a catalog code, or null when
 * the language isn't offered. Traditional-script Chinese regions map to `zh-TW`.
 */
export function normalizeTranslationLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null
  const parts = tag.trim().replace(/_/g, '-').toLowerCase().split('-')
  const primary = parts[0] ?? ''
  if (primary === 'zh') {
    return parts.some((part) => part === 'hant' || part === 'tw' || part === 'hk' || part === 'mo') ? 'zh-TW' : 'zh'
  }
  if (primary === 'nb' || primary === 'nn') return 'no'
  if (primary === 'fil') return 'tl'
  if (primary === 'iw') return 'he'
  return BY_CODE.has(primary) ? primary : null
}

/** Model + hints for `source → target`, or null when either language isn't in the catalog. */
export function resolveTranslationRoute(source: string, target: string): TranslationRoute | null {
  const from = findTranslationLanguage(source)
  const to = findTranslationLanguage(target)
  if (!from || !to) return null
  const pair = OPUS_PAIRS[`${from.code}>${to.code}`]
  if (pair) return { modelId: pair, multilingual: false }
  return { modelId: NLLB_MODEL_ID, sourceLang: from.nllbCode, targetLang: to.nllbCode, multilingual: true }
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Filters the catalog for a search box: accent-insensitive match on English name, endonym or
 * code. Prefix matches rank before substring matches; catalog order breaks ties.
 */
export function searchTranslationLanguages(
  query: string,
  languages: readonly TranslationLanguage[] = TRANSLATION_LANGUAGES,
): TranslationLanguage[] {
  const needle = fold(query.trim())
  if (!needle) return [...languages]
  const scored: { language: TranslationLanguage; score: number; order: number }[] = []
  languages.forEach((language, order) => {
    const fields = [fold(language.name), fold(language.nativeName), language.code.toLowerCase()]
    if (fields[2] === needle) scored.push({ language, score: 0, order })
    else if (fields.some((field) => field.startsWith(needle) || field.includes(` ${needle}`))) {
      scored.push({ language, score: 1, order })
    } else if (fields.some((field) => field.includes(needle))) scored.push({ language, score: 2, order })
  })
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.language)
}
