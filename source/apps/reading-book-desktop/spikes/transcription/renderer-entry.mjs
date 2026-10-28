// Bundle entry of `spike:transcription:store`: both renderer stores in ONE bundle, so the transcript store and the test drive the
// same instance of the audio player store (two bundles would each carry their own copy).
export { useTranscriptStore, isActiveJob, PASSAGE_FETCH_LIMIT, SEARCH_HIT_LIMIT } from '../../src/screens/AudioBook/logic/transcriptStore.ts'
export { useAudioPlayerStore } from '../../src/screens/AudioBook/logic/audioPlayerStore.ts'
