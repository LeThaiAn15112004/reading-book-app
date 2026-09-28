/**
 * Text-to-speech port used by read-aloud. The store only talks to this interface, so the host picks
 * the engine (Web Speech on desktop, expo-speech on mobile, a cloud TTS) without touching the reader.
 */

export type TtsSpeakRequest = {
  text: string
  /** BCP-47 tag of the text, e.g. `vi-VN`. */
  lang: string
  /** 0.5–2, 1 = normal. */
  rate: number
  /** 0–1. */
  volume: number
}

export type TtsSpeakHandlers = {
  onEnd: () => void
  onError: (error: string) => void
}

export type TtsVoiceMatch = {
  /** Display name of the chosen voice, or null when the engine uses its own default. */
  name: string | null
  /** False when no voice for the requested language exists and a fallback voice is used. */
  exact: boolean
}

export interface TtsEngine {
  isSupported(): boolean
  resolveVoice(lang: string): Promise<TtsVoiceMatch>
  /** Speaks one utterance, replacing whatever is currently being spoken. */
  speak(request: TtsSpeakRequest, handlers: TtsSpeakHandlers): void
  pause(): void
  /** Continues from the paused point (word boundary at worst). */
  resume(): void
  /** Stops speaking; pending handlers of the current utterance never fire. */
  cancel(): void
}
