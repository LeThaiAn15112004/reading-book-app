/**
 * The speech models the app may download for audiobook transcription (spec 004, task T013a).
 *
 * EVERYTHING in `TRANSCRIPTION_MODELS` was produced by `specs/004-audiobook-transcription/model-manifest.md`
 * (2026-10-27): the revisions are full 40-hex commit ids, the sizes and SHA-256 values were computed on our own
 * downloads of exactly these URLs and cross-checked with the Hugging Face Hub's metadata. Do NOT edit a value
 * by hand: a new revision or dtype needs a new verified download and a manifest update first.
 *
 * Runtime: the Whisper `automatic-speech-recognition` pipeline of `@huggingface/transformers` with `dtype: 'q8'`
 * (the `_quantized` ONNX files). Models are never bundled and never fetched without the user's consent — this
 * module is only data.
 */

export const MODEL_HOST = 'https://huggingface.co'

export type TranscriptionModelId = 'whisper-tiny' | 'whisper-base' | 'whisper-small'

export interface TranscriptionModelFile {
  /** Path inside the repository, forward slashes (also the path inside the local model folder). */
  path: string
  bytes: number
  /** Lower-case hex SHA-256 of the file. */
  sha256: string
}

export interface TranscriptionModelSpec {
  id: TranscriptionModelId
  label: string
  repo: string
  /** Full commit id; downloads use it, never a branch name. */
  revision: string
  /** The transformers.js dtype these files belong to. */
  dtype: 'q8'
  files: readonly TranscriptionModelFile[]
  /** Sum of `files[].bytes`. */
  totalBytes: number
}

export const TRANSCRIPTION_MODELS: readonly TranscriptionModelSpec[] = [
  {
    id: 'whisper-tiny',
    label: 'Fast (smallest, least accurate)',
    repo: 'onnx-community/whisper-tiny',
    revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    dtype: 'q8',
    files: [
      { path: 'config.json', bytes: 2243, sha256: '46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d' },
      { path: 'generation_config.json', bytes: 3772, sha256: 'f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1' },
      { path: 'preprocessor_config.json', bytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
      { path: 'tokenizer.json', bytes: 2480466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
      { path: 'tokenizer_config.json', bytes: 282683, sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce' },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 10124990, sha256: '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 30719241, sha256: '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3' },
    ],
    totalBytes: 43613734,
  },
  {
    id: 'whisper-base',
    label: 'Balanced',
    repo: 'onnx-community/whisper-base',
    revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    dtype: 'q8',
    files: [
      { path: 'config.json', bytes: 2243, sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b' },
      { path: 'generation_config.json', bytes: 3832, sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0' },
      { path: 'preprocessor_config.json', bytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
      { path: 'tokenizer.json', bytes: 2480466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
      { path: 'tokenizer_config.json', bytes: 282682, sha256: '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573' },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 23201314, sha256: '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 53693315, sha256: 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b' },
    ],
    totalBytes: 79664191,
  },
  {
    id: 'whisper-small',
    label: 'Best quality (largest, slowest)',
    repo: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    dtype: 'q8',
    files: [
      { path: 'config.json', bytes: 2227, sha256: '457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18' },
      { path: 'generation_config.json', bytes: 3893, sha256: 'f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0' },
      { path: 'preprocessor_config.json', bytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
      { path: 'tokenizer.json', bytes: 2480466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
      { path: 'tokenizer_config.json', bytes: 282683, sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce' },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 92326160, sha256: 'a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 156750845, sha256: 'ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9' },
    ],
    totalBytes: 251846613,
  },
]

export function findTranscriptionModel(id: string): TranscriptionModelSpec | undefined {
  return TRANSCRIPTION_MODELS.find((model) => model.id === id)
}

/** The exact URL of one file at the pinned revision. */
export function modelFileUrl(spec: Pick<TranscriptionModelSpec, 'repo' | 'revision'>, file: Pick<TranscriptionModelFile, 'path'>): string {
  return `${MODEL_HOST}/${spec.repo}/resolve/${spec.revision}/${file.path}`
}
