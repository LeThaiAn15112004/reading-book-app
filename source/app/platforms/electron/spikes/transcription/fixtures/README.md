# Fixtures for the transcription spikes

`smoke-speech.wav` — 16 kHz, mono, 16-bit PCM, about 6.7 s of synthetic speech. It was generated locally on
2026-10-27 with the Windows speech synthesizer (`System.Speech`, voice "Microsoft David Desktop", en-US, Rate -1) from
the reference text below, so there is no third-party recording and no licence to carry; the audio is test data only.

Reference text (what the spike compares the transcript with, word error rate after lower-casing and stripping
punctuation):

    The quick brown fox jumps over the lazy dog. Reading a good book is a quiet pleasure.

Used by `run-transcription-smoke.mjs` (task T014a). It is deliberately tiny and clean: it can show that the
engine loads and transcribes inside the real worker, NOT how accurate Whisper is on real audiobooks (that is T036).
