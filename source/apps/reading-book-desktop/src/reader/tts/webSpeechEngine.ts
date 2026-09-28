import type { TtsEngine, TtsSpeakHandlers, TtsSpeakRequest, TtsVoiceMatch } from '@reading-book/book-reader-sdk'

const VOICES_TIMEOUT_MS = 1500
/** Chromium's `resume()` sometimes leaves the engine silent; re-speak if nothing started by then. */
const RESUME_CHECK_MS = 350

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth()
  if (!s) return Promise.resolve([])
  const now = s.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      s.removeEventListener('voiceschanged', done)
      window.clearTimeout(timer)
      resolve(s.getVoices())
    }
    const timer = window.setTimeout(done, VOICES_TIMEOUT_MS)
    s.addEventListener('voiceschanged', done)
  })
}

function normalizeLang(lang: string): string {
  return lang.trim().replace('_', '-').toLowerCase()
}

/** Exact tag (local voices first) → same primary language → engine default. */
function pickVoice(voices: SpeechSynthesisVoice[], lang: string): { voice: SpeechSynthesisVoice | null; exact: boolean } {
  const wanted = normalizeLang(lang)
  const primary = wanted.split('-')[0] ?? ''
  const byLocal = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) =>
    Number(b.localService) - Number(a.localService)
  const exact = voices.filter((v) => normalizeLang(v.lang) === wanted).sort(byLocal)
  if (exact[0]) return { voice: exact[0], exact: true }
  const samePrimary = voices
    .filter((v) => primary && normalizeLang(v.lang).split('-')[0] === primary)
    .sort(byLocal)
  if (samePrimary[0]) return { voice: samePrimary[0], exact: true }
  return { voice: voices.find((v) => v.default) ?? null, exact: primary === '' }
}

type Current = {
  request: TtsSpeakRequest
  handlers: TtsSpeakHandlers
  voice: SpeechSynthesisVoice | null
  /** Char index of the last word boundary reached, relative to `request.text`. */
  boundary: number
  utterance: SpeechSynthesisUtterance
}

export function createWebSpeechEngine(): TtsEngine {
  let current: Current | null = null
  const voiceCache = new Map<string, SpeechSynthesisVoice | null>()

  const utter = (
    request: TtsSpeakRequest,
    handlers: TtsSpeakHandlers,
    voice: SpeechSynthesisVoice | null,
    offset: number,
  ) => {
    const s = synth()
    if (!s) {
      handlers.onError('speech-synthesis-unavailable')
      return
    }
    const utterance = new SpeechSynthesisUtterance(request.text.slice(offset))
    utterance.lang = voice?.lang ?? request.lang
    if (voice) utterance.voice = voice
    utterance.rate = request.rate
    utterance.volume = request.volume
    const entry: Current = { request, handlers, voice, boundary: offset, utterance }
    utterance.onboundary = (event) => {
      if (current === entry && event.name === 'word') entry.boundary = offset + event.charIndex
    }
    utterance.onend = () => {
      if (current !== entry) return
      current = null
      handlers.onEnd()
    }
    utterance.onerror = (event) => {
      if (current !== entry) return
      // `cancel()` from our own replace/stop surfaces as interrupted/canceled — not a failure.
      if (event.error === 'interrupted' || event.error === 'canceled') return
      current = null
      handlers.onError(event.error)
    }
    current = entry
    s.speak(utterance)
  }

  return {
    isSupported: () => synth() !== null,

    resolveVoice: async (lang): Promise<TtsVoiceMatch> => {
      const { voice, exact } = pickVoice(await loadVoices(), lang)
      voiceCache.set(normalizeLang(lang), voice)
      return { name: voice?.name ?? null, exact }
    },

    speak: (request, handlers) => {
      const s = synth()
      current = null
      s?.cancel()
      // A paused synth stays paused across cancel(); the new utterance would never start.
      if (s?.paused) s.resume()
      const voice = voiceCache.get(normalizeLang(request.lang)) ?? null
      utter(request, handlers, voice, 0)
    },

    pause: () => {
      synth()?.pause()
    },

    resume: () => {
      const s = synth()
      if (!s) return
      const paused = current
      s.resume()
      window.setTimeout(() => {
        if (!paused || current !== paused) return
        if (s.speaking && !s.paused) return
        current = null
        s.cancel()
        utter(paused.request, paused.handlers, paused.voice, paused.boundary)
      }, RESUME_CHECK_MS)
    },

    cancel: () => {
      current = null
      const s = synth()
      s?.cancel()
      if (s?.paused) s.resume()
    },
  }
}
